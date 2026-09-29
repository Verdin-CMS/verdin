---
title: "Webhooks"
description: "Esdeveniments de webhook, forma de les càrregues, capçaleres, verificació de signatures, reintents i el registre d'enviaments."
sidebar:
  order: 6
---

Un webhook envia un `POST` HTTP a la teva URL quan canvia el contingut o la multimèdia. Aquesta
pàgina és la referència per als receptors: esdeveniments, càrregues, capçaleres, signatures i
enviament. Per crear i gestionar webhooks al tauler d'administració, consulta
[Webhooks](/ca/guides/integrations/webhooks/).

## Esdeveniments

| Esdeveniment | S'envia quan |
| --- | --- |
| `entry.create` | Es crea un document, des de qualsevol API: REST, GraphQL, el tauler d'administració o un connector. |
| `entry.update` | Es desa un document. |
| `entry.publish` | Es publica un document. Crear-ne o actualitzar-ne un per REST o GraphQL sense `status=draft` el publica. |
| `entry.unpublish` | Es despublica un document. |
| `entry.discard-draft` | Es descarta l'esborrany d'un document. |
| `entry.delete` | S'elimina un document. |
| `media.create`, `media.update`, `media.delete` | Es puja, s'edita o s'elimina un fitxer. Eliminar una carpeta envia `media.delete` per a cada fitxer que conté. |
| `releases.publish` | S'ha executat un [llançament](/ca/guides/content/releases/), ara o a la seva data. |
| `review-workflows.updateEntryStage` | Una entrada ha passat a una altra [etapa de revisió](/ca/guides/content/review-workflows/). |

Un webhook se subscriu a alguns esdeveniments i es pot limitar a alguns tipus de contingut. Els
esdeveniments de multimèdia no estan lligats a cap tipus de contingut.

## Càrregues

Totes les càrregues tenen `event` i `createdAt` (quan es va posar l'esdeveniment a la cua). Els
esdeveniments d'entrada hi afegeixen el tipus de contingut i el document:

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

- `model` és el `singularName` del tipus, `uid` el seu UID i `locale` l'idioma de la versió que
  ha canviat (`null` als tipus no localitzats).
- `entry` és el document tal com el retorna l'API REST, sense relacions, mitjans, components ni
  camps `private`.
- `entry.publish` porta la versió publicada. Els altres esdeveniments d'entrada porten
  l'esborrany, o l'única versió als tipus sense esborrany i publicació.
- `entry.delete` només porta `{ "documentId": … }`.

Els esdeveniments de multimèdia envien l'objecte de fitxer a `media`, sense `model`, `uid` ni
`entry`:

```json
{
  "event": "media.create",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "media": { "id": 5, "documentId": "v3k9…", "name": "harbour.jpg", "mime": "image/jpeg", "url": "/uploads/harbour_4f1c.jpg" }
}
```

`releases.publish` envia el `release` amb el resultat de cadascuna de les seves accions.
`review-workflows.updateEntryStage` envia:

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

Com als esdeveniments d'entrada, `model` és el nom singular i `uid` l'UID del tipus de contingut
(abans de la 0.10, aquí `model` contenia l'UID).

El botó **Envia un esdeveniment de prova** envia `{ "event": "trigger-test", "createdAt": … }`.

## Capçaleres

| Capçalera | Valor |
| --- | --- |
| `content-type` | `application/json` |
| `x-verdin-event` | El nom de l'esdeveniment. |
| `x-verdin-delivery` | L'id de l'enviament. Es manté igual entre reintents: fes-lo servir per ignorar duplicats. |
| `x-verdin-signature` | `t=<unix seconds>,v1=<hex>`, quan el webhook està signat. |

Els webhooks poden afegir les seves pròpies capçaleres, com ara un token `authorization` per al
teu endpoint. Les capçaleres anteriors no es poden sobreescriure.

## Verificació de signatures

Els webhooks se signen per defecte. `v1` és l'HMAC-SHA256 en hexadecimal de `<t>.<raw body>`,
amb el secret del webhook (`whsec_…`) com a clau. El secret es mostra un sol cop, quan es crea
el webhook o se'n renova el secret.

Per comprovar un enviament:

1. Separa la capçalera en `t` i `v1`.
2. Rebutja'l si `t` s'allunya més d'uns quants minuts del teu rellotge.
3. Calcula l'HMAC sobre `t`, un punt i el cos de la petició **en brut**. No analitzis i tornis a
   serialitzar el JSON abans: els bytes serien diferents.
4. Compara'l amb `v1` en temps constant.

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

Amb Express, llegeix el cos en brut i verifica'l abans d'analitzar-lo:

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

## Enviament i reintents

Els enviaments es posen a la cua a la base de dades quan es confirma el canvi, i un procés en
segon pla els envia. Un endpoint lent o que falla mai no alenteix els editors ni les escriptures
de l'API, i els enviaments sobreviuen a un reinici.

- **Èxit**: qualsevol resposta `2xx`.
- **Error**: qualsevol altre estat, incloses les redireccions (que no se segueixen), un error de
  connexió o un temps d'espera esgotat (`[webhooks].timeout_secs`, 10 segons per defecte).
- **Reintents**: un enviament fallit es torna a intentar al cap de 30 segons, 2 minuts, 10
  minuts, 1 hora i 6 hores, sis intents en total. Després es marca com a fallit.
- Desactivar o eliminar un webhook atura els seus reintents pendents.
- Diverses instàncies comparteixen la cua; cada enviament el reclama una sola.

Respon ràpidament amb un `2xx` i fes la feina lenta després. Els enviaments poden arribar més
d'una vegada (un reintent després d'un temps d'espera, per exemple) i desordenats: fes servir
`x-verdin-delivery` per saltar duplicats, i torna a obtenir el document quan l'ordre importi.

## Registre d'enviaments

La pàgina de cada webhook a **Configuració → Webhooks** té un **Registre d’enviaments**, amb els
més recents primer. Per a cada enviament mostra l'estat (**Pendent**, **Enviant**,
**Correcte**, **Fallit**), l'estat HTTP, els primers 2 KB del cos de la resposta, l'error, el
nombre d'intents, l'hora del proper intent, la durada i la càrrega enviada. Un enviament fallit
es pot tornar a intentar des del registre.

Els enviaments acabats s'eliminen al cap de `[webhooks].retention_days` (30 per defecte).

Les mateixes dades són disponibles des de l'[API d'administració](/ca/api/admin/):
`GET /admin/api/webhooks/{id}/deliveries` i `POST /admin/api/webhooks/deliveries/{id}/retry`.

## Restriccions d'URL

Amb `verdin start`, les URL dels webhooks no poden apuntar a adreces de loopback, privades,
d'enllaç local ni altres adreces reservades, tant si s'escriuen com a adreces IP com si són noms
de host que s'hi resolen. Un administrador no pot fer servir webhooks per arribar a serveis
interns. `verdin dev` les permet, perquè puguis provar contra `localhost`;
`[webhooks].allow_private_networks` canvia el comportament per defecte. Les URL amb credencials
(`https://user:pass@…`) es rebutgen: posa-les en una capçalera.

## Comparació amb Strapi

Les càrregues segueixen les de Strapi (`event`, `createdAt`, `model`, `uid`, `entry`). Verdin hi
afegeix signatures, reintents, un registre d'enviaments i filtres per tipus de contingut.
L'esdeveniment `entry.draft-discard` de Strapi s'anomena `entry.discard-draft`.
