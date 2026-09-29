---
title: "Realtime API"
description: "The Server-Sent Events protocol of Verdin's realtime stream: endpoint, authentication, event names and message shapes, and the admin's presence protocol."
sidebar:
  order: 5
  label: "Realtime"
---

Verdin streams content and media changes as they commit, over
[Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events) (SSE).
Each subscriber receives only events about what it may read. This page describes the
protocol; for using it in a frontend, see [Realtime updates](/guides/frontend/realtime/).

## Enabling it

Realtime is off by default. Turn it on in **Settings → Features → Realtime** (permission
`features.manage`). While it is off, the endpoints answer `404`.

## Content stream

```
GET /api/_events
GET /api/_events?types=api::article,api::category
```

| Parameter | Description |
| --- | --- |
| `types` | Optional, comma-separated content type UIDs; `plugin::upload` is the media library. The Strapi form `api::article.article` works too. Without it, you receive every type you may read. |

Authenticate as on the REST API: an API token or an end user's JWT in
`Authorization: Bearer …`, or no header for public access. An invalid token answers `401`
before the stream opens.

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

## Messages

The first event is always `ready`. Then each change is an SSE event named after it, whose
`data` is a JSON object:

| Field | Present | Description |
| --- | --- | --- |
| `event` | always | The event name, as in the SSE `event:` line. |
| `uid` | always | The content type UID, or `plugin::upload` for media. |
| `documentId` | always | The changed document or file. |
| `locale` | localized types | The locale of the version that changed. |
| `fileId` | media events | The file's numeric id, as used in media fields. |
| `actorId` | admin stream | The admin who made the change, when an admin made it. |

| Events | Sent when | Who receives them |
| --- | --- | --- |
| `entry.create`, `entry.update`, `entry.discard-draft` | A document is created, saved, or its draft discarded | On draft and publish types, callers with `readDrafts` (these events only change drafts). On other types, callers with `find` or `findOne`. |
| `entry.publish`, `entry.unpublish`, `entry.delete` | A document is published, unpublished or deleted | Callers with `find` or `findOne` on the type |
| `media.create`, `media.update`, `media.delete` | A file is uploaded, edited or deleted | Callers with `find` or `findOne` on the media library |

Events carry ids, not content. Fetch the document or file with the REST or GraphQL API to read
it, with the caller's usual permissions. Events come from every API: REST, GraphQL, the admin
panel, releases and plugins.

## Connection lifetime

- The server sends a keep-alive comment every 15 seconds.
- A content stream ends after one hour. Reconnect (browsers' `EventSource` does it on its
  own), which also checks the token again.
- An event named `lagged`, with `data: {"missed": 12}`, means the client read too slowly and
  that many events were dropped. Refetch what the client shows.
- There is no replay: events that happen while a client is disconnected are not sent later.

Browsers' `EventSource` cannot send an `Authorization` header. For public access it works as
is; with a token, use `fetch` with a streaming body reader, or an SSE client that supports
headers.

## Admin stream

The admin panel opens its own stream with the admin's access token:

```
GET /admin/api/events?types=api::article
```

It carries the same content and media events for the types the admin may read (with
`content.read` and `media.read`), drafts included, plus:

- `actorId` on changes made by admins;
- `presence` events (below);
- `comment.create`, `comment.update`, `comment.delete`, `comment.resolve`,
  `comment.reopen`, `task.create`, `task.update` and `task.delete`, with `uid`,
  `documentId` and `locale` of the entry.

An admin stream ends after 15 minutes, the life of an access token: reconnect with a fresh
one.

### Presence

The entry editor tells the server who is on an entry:

```
POST /admin/api/presence
{ "uid": "api::article", "documentId": "k2m7q4…", "locale": "en", "editing": true }
```

- Send it about every 20 seconds while the editor is open. `editing: true` means the admin has
  unsaved changes. Send `"leave": true` when the editor closes.
- A presence expires 45 seconds after the last heartbeat.
- The answer lists who is on the entry: `{ "data": [{ "userId": 3, "name": "Ada Lovelace", "editing": true, "holdsLock": true }] }`.
- `GET /admin/api/presence?uid=&documentId=&locale=` reads the same list.
- When the list changes, admin streams receive a `presence` event with the entry's `uid`,
  `documentId`, `locale` and the list in `presence`.

The first admin still editing holds a soft lock (`holdsLock`). The editor shows it to the
others, but it does not block their saves. Reading presence needs `content.read` on the type.

## Several instances

Events and presence are those of the instance a client is connected to. Behind a load
balancer, route `/api/_events` and `/admin/api/events` with sticky sessions, or run realtime
clients against one instance. See [Scaling](/deploy/scaling/).
