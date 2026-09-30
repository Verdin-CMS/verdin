---
title: "API en tiempo real"
description: "El protocolo Server-Sent Events del flujo en tiempo real de Verdin: endpoint, autenticación, nombres de eventos y forma de los mensajes, y el protocolo de presencia del panel de administración."
sidebar:
  order: 5
  label: "Tiempo real"
---

Verdin emite los cambios de contenido y de medios en cuanto se confirman, mediante
[Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events) (SSE).
Cada suscriptor recibe solo los eventos sobre lo que puede leer. Esta página describe el
protocolo; para usarlo en un frontend, consulta
[Actualizaciones en tiempo real](/es/guides/frontend/realtime/).

## Activarla

El tiempo real está desactivado por defecto. Actívalo en
**Configuración → Funcionalidades → Tiempo real** (permiso `features.manage`). Mientras está
desactivado, los endpoints responden `404`.

## Flujo de contenido

```
GET /api/_events
GET /api/_events?types=api::article,api::category
```

| Parámetro | Descripción |
| --- | --- |
| `types` | Opcional, UIDs de tipos de contenido separados por comas; `plugin::upload` es la biblioteca de medios. También funciona la forma de Strapi `api::article.article`. Sin él, recibes todos los tipos que puedes leer. |

Autentícate igual que en la API REST: un token de API o el JWT de un usuario final en
`Authorization: Bearer …`, o sin cabecera para el acceso público. Un token no válido responde
`401` antes de que se abra el flujo.

```sh title="Terminal"
curl -N -H "Authorization: Bearer $VERDIN_TOKEN" \
  'https://cms.example.com/api/_events?types=api::article'
```

```text
event: ready
data: {}

event: entry.publish
data: {"event":"entry.publish","uid":"api::article","documentId":"k2m7q4dx8n5t1v3b9c0e6a2wfr","locale":"en"}

event: media.create
data: {"event":"media.create","uid":"plugin::upload","documentId":"v3k9…","fileId":5}
```

## Mensajes

El primer evento es siempre `ready`. Después, cada cambio es un evento SSE con su nombre,
cuyo `data` es un objeto JSON:

| Campo | Presente | Descripción |
| --- | --- | --- |
| `event` | siempre | El nombre del evento, igual que en la línea `event:` de SSE. |
| `uid` | siempre | El UID del tipo de contenido, o `plugin::upload` para los medios. |
| `documentId` | siempre | El documento o el archivo que ha cambiado. |
| `locale` | tipos localizados | El idioma de la versión que ha cambiado. |
| `fileId` | eventos de medios | El id numérico del archivo, el que se usa en los campos de medios. |
| `actorId` | flujo de administración | El administrador que hizo el cambio, cuando lo hizo un administrador. |

| Eventos | Se envían cuando | Quién los recibe |
| --- | --- | --- |
| `entry.create`, `entry.update`, `entry.discard-draft` | Se crea o se guarda un documento, o se descarta su borrador | En los tipos con borrador y publicación, los clientes con `readDrafts` (estos eventos solo cambian borradores). En los demás tipos, los clientes con `find` o `findOne`. |
| `entry.publish`, `entry.unpublish`, `entry.delete` | Se publica, se despublica o se elimina un documento | Los clientes con `find` o `findOne` sobre el tipo |
| `media.create`, `media.update`, `media.delete` | Se sube, se edita o se elimina un archivo | Los clientes con `find` o `findOne` sobre la biblioteca de medios |

Los eventos llevan ids, no contenido. Para leer el documento o el archivo, pídelo a la API
REST o GraphQL, con los permisos habituales del cliente. Los eventos proceden de todas las
APIs: REST, GraphQL, el panel de administración, los lanzamientos y los plugins.

## Duración de la conexión

- El servidor envía un comentario de keep-alive cada 15 segundos.
- Un flujo de contenido termina al cabo de una hora. Vuelve a conectar (el `EventSource` de
  los navegadores lo hace solo), lo que además vuelve a comprobar el token.
- Un evento llamado `lagged`, con `data: {"missed": 12}`, significa que el cliente leyó
  demasiado despacio y se descartaron esos eventos. Vuelve a pedir lo que muestra el cliente.
- No hay reenvío: los eventos que ocurren mientras un cliente está desconectado no se envían
  después.

El `EventSource` de los navegadores no puede enviar una cabecera `Authorization`. Para el
acceso público funciona tal cual; con un token, usa `fetch` con un lector del cuerpo en
streaming, o un cliente SSE que admita cabeceras.

## Flujo de administración

El panel de administración abre su propio flujo con el token de acceso del administrador:

```
GET /admin/api/events?types=api::article
```

Lleva los mismos eventos de contenido y de medios para los tipos que el administrador puede
leer (con `content.read` y `media.read`), borradores incluidos, y además:

- `actorId` en los cambios hechos por administradores;
- eventos `presence` (ver más abajo);
- `comment.create`, `comment.update`, `comment.delete`, `comment.resolve`,
  `comment.reopen`, `task.create`, `task.update` y `task.delete`, con el `uid`, el
  `documentId` y el `locale` de la entrada.

Un flujo de administración termina a los 15 minutos, la vida de un token de acceso: vuelve a
conectar con uno nuevo.

### Presencia

El editor de entradas le dice al servidor quién está en una entrada:

```
POST /admin/api/presence
{ "uid": "api::article", "documentId": "k2m7q4…", "locale": "en", "editing": true }
```

- Envíalo cada 20 segundos aproximadamente mientras el editor esté abierto. `editing: true`
  significa que el administrador tiene cambios sin guardar. Envía `"leave": true` al cerrar el
  editor.
- Una presencia caduca 45 segundos después del último latido.
- La respuesta enumera quién está en la entrada: `{ "data": [{ "userId": 3, "name": "Ada Lovelace", "editing": true, "holdsLock": true }] }`.
- `GET /admin/api/presence?uid=&documentId=&locale=` lee la misma lista.
- Cuando la lista cambia, los flujos de administración reciben un evento `presence` con el
  `uid`, el `documentId` y el `locale` de la entrada y la lista en `presence`.

El primer administrador que sigue editando tiene un bloqueo blando (`holdsLock`). El editor
se lo muestra a los demás, pero no impide que guarden. Leer la presencia requiere
`content.read` sobre el tipo.

## Varias instancias

Con el bus de eventos compartido (`[cluster].bus = "database"`), los flujos de cada instancia
llevan los eventos de todas, y la presencia y los bloqueos suaves son los mismos en todas las
instancias. Los eventos de otra instancia llegan en `[cluster].poll_interval_ms` (MySQL,
MariaDB, SQLite) o al instante (PostgreSQL, `LISTEN/NOTIFY`). Sin el bus, los eventos y la
presencia son los de la instancia a la que está conectado cada cliente: enruta
`/api/_events` y `/admin/api/events` con sesiones persistentes (sticky sessions), o conecta
los clientes de tiempo real a una sola instancia.
Consulta [Varias instancias](/es/deploy/scaling/#bus-de-eventos-compartido).
