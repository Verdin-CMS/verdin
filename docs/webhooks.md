# Webhooks

Webhooks send an HTTP `POST` to your URL when content or media changes. Typical uses are
rebuilding a static site, purging a CDN, syncing a search index or notifying a chat.
Manage them in **Settings → Webhooks** (permission `webhooks.manage`). The whole feature
can be switched off in **Settings → Features**.

## Events

| Event | When |
|---|---|
| `entry.create` | A document is created, from any API: REST, GraphQL or the admin. |
| `entry.update` | A document is saved. |
| `entry.publish` | A document is published. This includes creating one through the REST API without `status=draft`. |
| `entry.unpublish` | A document is unpublished. |
| `entry.discard-draft` | A document's draft is discarded. |
| `entry.delete` | A document is deleted. |
| `media.create` / `media.update` / `media.delete` | A media library file is uploaded, edited or deleted. Deleting a folder also sends `media.delete` for each file in it. |

A webhook can be limited to some content types. Media events are not tied to a content type.

## Payload

```json
{
  "event": "entry.publish",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "model": "article",
  "uid": "api::article",
  "entry": { "id": 3, "documentId": "01J…", "title": "Hello", "publishedAt": "2026-09-25T09:00:00.000Z" }
}
```

`entry` is the document as the content API returns it, without relations or private
fields. Publish events carry the published version; other events carry the draft (or
the document itself, for types without draft & publish). Delete events carry only
`{ "documentId": … }`.

Media events send the file in a `media` key instead of `entry`, with no `model` or `uid`.
The test button sends `{ "event": "trigger-test", "createdAt": … }`.

## Headers and signature

Every delivery sends these headers:

- `content-type: application/json`
- `x-verdin-event`: the event name
- `x-verdin-delivery`: the delivery id, which stays the same across retries. Use it to ignore duplicates.
- `x-verdin-signature: t=<unix seconds>,v1=<hex>`: sent when the webhook is signed. Webhooks are signed by default.

You can add custom headers, such as an `authorization` token for your endpoint.

`v1` is the HMAC-SHA256 of `"<t>.<raw body>"`, keyed with the webhook's secret
(`whsec_…`). The secret is shown once, when the webhook is created or its secret is
rotated. To check a delivery:

1. Recompute the HMAC over the raw request body, not over re-serialized JSON.
2. Compare it in constant time.
3. Reject timestamps older than a few minutes.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(secret, header, rawBody, toleranceSeconds = 300) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((part) => part.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return v1?.length === expected.length && timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}
```

```python
import hashlib, hmac, time

def verify(secret: str, header: str, raw_body: bytes, tolerance: int = 300) -> bool:
    parts = dict(part.split("=", 1) for part in header.split(","))
    if abs(time.time() - int(parts["t"])) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{parts['t']}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts["v1"])
```

## Delivery and retries

Deliveries are queued in the database when the change commits and sent by a background
worker, so a slow endpoint never slows down editors.

- **Success:** any `2xx` response.
- **Failure:** anything else, including redirects, which are not followed, and a timeout. The default timeout is 10 s.
- **Retries:** after a failure, the delivery is retried after 30 s, 2 min, 10 min, 1 h and 6 h. After that it is marked failed.

The log on the webhook's page shows each delivery with:

- its status
- the HTTP status and the start of the response body
- the error, if any
- the attempt count and the next attempt time
- the payload that was sent

Deliveries can be retried from the log. Finished deliveries are removed after 30 days.

## Security

When the server runs with `verdin start`, webhook URLs may not point at loopback, private,
link-local or other reserved addresses. This applies to IP literals and to host names,
which are checked when resolved, so an admin cannot use webhooks to reach internal
services (SSRF). `verdin dev` allows them so you can test against `localhost`. Credentials
in the URL (`https://user:pass@…`) are refused. Put them in a header instead.

```toml
[webhooks]
allow_private_networks = false   # default: false in `start`, true in `dev`
timeout_secs = 10
retention_days = 30
```

Webhooks work like Strapi's, with these differences:

- deliveries are signed
- deliveries are retried
- each delivery is logged
- a webhook can be filtered by content type
- Strapi's `entry.draft-discard` is called `entry.discard-draft`
