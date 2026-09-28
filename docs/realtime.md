# Realtime events

Verdin streams changes as they happen over [Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events).
Each subscriber only receives events about what it may read.

## Content API

Turn it on in **Settings → Features → Realtime**. Then open `GET /api/_events`, with an
API token or an end user's JWT in `Authorization: Bearer …`, or with no token for the
public role:

```sh
curl -N -H "Authorization: Bearer $TOKEN" "https://cms.example.com/api/_events?types=api::article,api::page"
```

`types` (optional) limits the stream to some content types; `plugin::upload` is the
media library. The first event is `ready`. Then each change is an event named after it:

```
event: entry.publish
data: {"event":"entry.publish","uid":"api::article","documentId":"01j9…","locale":"en"}
```

| Events | Who receives them |
|---|---|
| `entry.create`, `entry.update`, `entry.discard-draft` on draft & publish types | Callers with `readDrafts` on the type, since these events only change drafts |
| Other `entry.*` events | Callers with `find` or `findOne` on the type |
| `media.create`, `media.update`, `media.delete` | Callers with `find` or `findOne` on the media library |

The admin's stream also names the admin who made a change (`actorId`).

Events carry ids, not content: fetch the entry to read it, with the caller's usual
permissions. A stream ends after an hour. Reconnect then (`EventSource` does it
automatically), which also checks the token again. An event named `lagged` means the
client read too slowly and missed some events; refetch what it shows.

Browsers' `EventSource` cannot send headers. Use `fetch` with a streaming reader, or an
SSE client that supports headers, when a token is needed.

## Admin

The admin panel opens `GET /admin/api/events` with the admin's access token. It receives
content and media events for the types the admin can read, plus `presence` events.

**Presence.** The entry editor calls `POST /admin/api/presence` about every 20 seconds
with `{ uid, documentId, locale, editing }`, and with `leave: true` when it closes. The
answer, and the `presence` events, list who is on the entry: `{ userId, name, editing,
holdsLock }`. The first admin still editing holds a soft lock. The editor shows it to
the others, but it does not block their saves. A presence expires 45 seconds after the
last heartbeat. `GET /admin/api/presence?uid=&documentId=&locale=` reads it.

## Several instances

Events and presence are those of the instance a client is connected to. Behind a load
balancer, use sticky sessions for `/api/_events` and `/admin/api/events`, or run the
realtime clients against a single instance.
