---
title: "Webhooks"
description: "Eventos de webhook, forma de los payloads, cabeceras, verificación de firmas, reintentos y el registro de envíos."
sidebar:
  order: 6
---

Un webhook envía un `POST` HTTP a tu URL cuando cambia el contenido o los medios. Esta página
es la referencia para los receptores: eventos, payloads, cabeceras, firmas y envío. Para crear
y gestionar webhooks en el panel de administración, consulta
[Webhooks](/es/guides/integrations/webhooks/).

## Eventos

| Evento | Se envía cuando |
| --- | --- |
| `entry.create` | Se crea un documento, desde cualquier API: REST, GraphQL, el panel de administración o un plugin. |
| `entry.update` | Se guarda un documento. |
| `entry.publish` | Se publica un documento. Crear o actualizar uno por REST o GraphQL sin `status=draft` lo publica. |
| `entry.unpublish` | Se despublica un documento. |
| `entry.discard-draft` | Se descarta el borrador de un documento. |
| `entry.delete` | Se elimina un documento. |
| `media.create`, `media.update`, `media.delete` | Se sube, se edita o se elimina un archivo. Eliminar una carpeta envía `media.delete` por cada archivo que contiene. |
| `releases.publish` | Se ejecutó un [lanzamiento](/es/guides/content/releases/), en el momento o en su fecha. |
| `review-workflows.updateEntryStage` | Una entrada pasó a otra [etapa de revisión](/es/guides/content/review-workflows/). |

Un webhook se suscribe a algunos eventos y puede limitarse a algunos tipos de contenido. Los
eventos de medios no están ligados a un tipo de contenido.

## Payloads

Todos los payloads tienen `event` y `createdAt` (el momento en que se encoló el evento). Los
eventos de entradas añaden el tipo de contenido y el documento:

```json
{
  "event": "entry.publish",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "model": "article",
  "uid": "api::article",
  "locale": null,
  "entry": {
    "id": 3,
    "documentId": "k2m7q4dx8n5t1v3b9c0e6a2wfr",
    "title": "Hello, Verdin",
    "slug": "hello-verdin",
    "createdAt": "2026-09-25T08:55:00.000Z",
    "updatedAt": "2026-09-25T09:00:00.000Z",
    "publishedAt": "2026-09-25T09:00:00.000Z"
  }
}
```

- `model` es el `singularName` del tipo, `uid` su UID y `locale` el idioma de la versión que
  ha cambiado (`null` en los tipos no localizados).
- `entry` es el documento tal como lo devuelve la API REST, sin relaciones, medios,
  componentes ni campos `private`.
- `entry.publish` lleva la versión publicada. Los demás eventos de entradas llevan el
  borrador, o la única versión en los tipos sin borrador y publicación.
- `entry.delete` solo lleva `{ "documentId": … }`.

Los eventos de medios envían el objeto del archivo en `media`, sin `model`, `uid` ni `entry`:

```json
{
  "event": "media.create",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "media": { "id": 5, "documentId": "v3k9…", "name": "harbour.jpg", "mime": "image/jpeg", "url": "/uploads/harbour_4f1c.jpg" }
}
```

`releases.publish` envía el `release` con el resultado de cada una de sus acciones.
`review-workflows.updateEntryStage` envía:

```json
{
  "event": "review-workflows.updateEntryStage",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "model": "article",
  "uid": "api::article",
  "entry": { "documentId": "k2m7q4…", "locale": "en" },
  "workflow": { "id": 1, "name": "Editorial" },
  "stages": { "from": { "id": 1, "name": "To do" }, "to": { "id": 2, "name": "In review" } }
}
```

Como en los eventos de entradas, `model` es el nombre en singular y `uid` el UID del tipo de
contenido (antes de la 0.10, `model` contenía aquí el UID).

El botón **Enviar evento de prueba** envía `{ "event": "trigger-test", "createdAt": … }`.

## Cabeceras

| Cabecera | Valor |
| --- | --- |
| `content-type` | `application/json` |
| `x-verdin-event` | El nombre del evento. |
| `x-verdin-delivery` | El id del envío. Se mantiene igual en los reintentos: úsalo para descartar duplicados. |
| `x-verdin-signature` | `t=<unix seconds>,v1=<hex>`, cuando el webhook está firmado. |

Los webhooks pueden añadir sus propias cabeceras, como un token `authorization` para tu
endpoint. Las cabeceras anteriores no se pueden sobrescribir.

## Verificar firmas

Los webhooks se firman por defecto. `v1` es el HMAC-SHA256 en hexadecimal de
`<t>.<raw body>`, con el secreto del webhook (`whsec_…`) como clave. El secreto se muestra
una sola vez, al crear el webhook o al rotar su secreto.

Para comprobar un envío:

1. Separa la cabecera en `t` y `v1`.
2. Recházalo si `t` se aleja más de unos minutos de tu reloj.
3. Calcula el HMAC sobre `t`, un punto y el cuerpo **sin procesar** de la petición. No
   parsees y vuelvas a serializar el JSON antes: los bytes serían distintos.
4. Compáralo con `v1` en tiempo constante.

```js title="verify.mjs"
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, header, rawBody, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=')));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const received = parts.v1 ?? '';
  return (
    received.length === expected.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  );
}
```

Con Express, lee el cuerpo sin procesar y verifícalo antes de parsearlo:

```js title="server.mjs"
import express from 'express';
import { verify } from './verify.mjs';

const app = express();

app.post('/hooks/verdin', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body.toString('utf8');
  if (!verify(process.env.VERDIN_WEBHOOK_SECRET, req.get('x-verdin-signature') ?? '', rawBody)) {
    return res.sendStatus(401);
  }
  const payload = JSON.parse(rawBody);
  console.log(req.get('x-verdin-delivery'), payload.event, payload.entry?.documentId);
  res.sendStatus(204);
});

app.listen(3000);
```

En Python:

```python title="verify.py"
import hashlib
import hmac
import time


def verify(secret: str, header: str, raw_body: bytes, tolerance: int = 300) -> bool:
    parts = dict(part.split("=", 1) for part in header.split(","))
    if abs(time.time() - int(parts["t"])) > tolerance:
        return False
    signed = parts["t"].encode() + b"." + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))
```

## Envío y reintentos

Los envíos se encolan en la base de datos cuando se confirma el cambio, y un proceso en
segundo plano los envía. Un endpoint lento o que falla nunca ralentiza a los editores ni las
escrituras de la API, y los envíos sobreviven a un reinicio.

- **Éxito**: cualquier respuesta `2xx`.
- **Fallo**: cualquier otro estado, incluidas las redirecciones (que no se siguen), un error
  de conexión o un tiempo de espera agotado (`[webhooks].timeout_secs`, 10 segundos por
  defecto).
- **Reintentos**: un envío fallido se reintenta a los 30 segundos, 2 minutos, 10 minutos,
  1 hora y 6 horas, seis intentos en total. Después se marca como fallido.
- Desactivar o eliminar un webhook detiene sus reintentos pendientes.
- Varias instancias comparten la cola; cada envío lo reclama una de ellas.

Responde rápido con un `2xx` y haz el trabajo lento después. Los envíos pueden llegar más de
una vez (por ejemplo, un reintento tras un tiempo de espera agotado) y desordenados: usa
`x-verdin-delivery` para saltarte los duplicados y vuelve a pedir el documento cuando el orden
importe.

## Registro de envíos

La página de cada webhook en **Configuración → Webhooks** tiene un **Registro de envíos**,
con los más recientes primero. Para cada envío muestra el estado (**Pendiente**,
**Enviando**, **Correcto**, **Fallido**), el estado HTTP, los primeros 2 KB del cuerpo de la
respuesta, el error, el número de intentos, la hora del siguiente intento, la duración y el
payload que se envió. Un envío fallido se puede reintentar desde el registro.

Los envíos terminados se eliminan pasados `[webhooks].retention_days` (30 por defecto).

Los mismos datos están disponibles en la [API de administración](/es/api/admin/):
`GET /admin/api/webhooks/{id}/deliveries` y `POST /admin/api/webhooks/deliveries/{id}/retry`.

## Restricciones de URL

Con `verdin start`, las URLs de los webhooks no pueden apuntar a direcciones de loopback,
privadas, de enlace local u otras reservadas, tanto si se escriben como direcciones IP como si
son nombres de host que resuelven a ellas. Un administrador no puede usar los webhooks para
llegar a servicios internos. `verdin dev` las permite, para que puedas probar contra
`localhost`; `[webhooks].allow_private_networks` cambia el comportamiento por defecto. Las
URLs con credenciales (`https://user:pass@…`) se rechazan: ponlas en una cabecera.

## Comparación con Strapi

Los payloads siguen los de Strapi (`event`, `createdAt`, `model`, `uid`, `entry`). Verdin
añade firmas, reintentos, un registro de envíos y filtros por tipo de contenido. El evento
`entry.draft-discard` de Strapi se llama `entry.discard-draft`.
