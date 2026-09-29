---
title: "Webhooks"
description: "Webhook events, payload shapes, headers, signature verification, retries and the delivery log."
sidebar:
  order: 6
---

A webhook sends an HTTP `POST` to your URL when content or media changes. This page is the
reference for receivers: events, payloads, headers, signatures and delivery. To create and
manage webhooks in the admin panel, see [Webhooks](/guides/integrations/webhooks/).

## Events

| Event | Sent when |
| --- | --- |
| `entry.create` | A document is created, from any API: REST, GraphQL, the admin panel or a plugin. |
| `entry.update` | A document is saved. |
| `entry.publish` | A document is published. Creating or updating one over REST or GraphQL without `status=draft` publishes it. |
| `entry.unpublish` | A document is unpublished. |
| `entry.discard-draft` | A document's draft is discarded. |
| `entry.delete` | A document is deleted. |
| `media.create`, `media.update`, `media.delete` | A file is uploaded, edited or deleted. Deleting a folder sends `media.delete` for each file in it. |
| `releases.publish` | A [release](/guides/content/releases/) ran, now or at its date. |
| `review-workflows.updateEntryStage` | An entry moved to another [review stage](/guides/content/review-workflows/). |

A webhook subscribes to some events and can be limited to some content types. Media events
are not tied to a content type.

## Payloads

Every payload has `event` and `createdAt` (when the event was queued). Entry events add the
content type and the document:

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

- `model` is the type's `singularName`, `uid` its UID, and `locale` the locale of the version
  that changed (`null` on types that are not localized).
- `entry` is the document as the REST API returns it, without relations, media, components or
  `private` fields.
- `entry.publish` carries the published version. Other entry events carry the draft, or the
  only version on types without draft and publish.
- `entry.delete` carries only `{ "documentId": … }`.

Media events send the file object in `media`, with no `model`, `uid` or `entry`:

```json
{
  "event": "media.create",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "media": { "id": 5, "documentId": "v3k9…", "name": "harbour.jpg", "mime": "image/jpeg", "url": "/uploads/harbour_4f1c.jpg" }
}
```

`releases.publish` sends the `release` with the result of each of its actions.
`review-workflows.updateEntryStage` sends:

```json
{
  "event": "review-workflows.updateEntryStage",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "model": "api::article",
  "entry": { "documentId": "k2m7q4…", "locale": "en" },
  "workflow": { "id": 1, "name": "Editorial" },
  "stages": { "from": { "id": 1, "name": "To do" }, "to": { "id": 2, "name": "In review" } }
}
```

In this event `model` is the content type's UID.

The **Send test event** button sends `{ "event": "trigger-test", "createdAt": … }`.

## Headers

| Header | Value |
| --- | --- |
| `content-type` | `application/json` |
| `x-verdin-event` | The event name. |
| `x-verdin-delivery` | The delivery id. It stays the same across retries: use it to ignore duplicates. |
| `x-verdin-signature` | `t=<unix seconds>,v1=<hex>`, when the webhook is signed. |

Webhooks can add their own headers, such as an `authorization` token for your endpoint. The
headers above cannot be overridden.

## Verifying signatures

Webhooks are signed by default. `v1` is the hex HMAC-SHA256 of `<t>.<raw body>`, keyed with
the webhook's secret (`whsec_…`). The secret is shown once, when the webhook is created or its
secret is rotated.

To check a delivery:

1. Split the header into `t` and `v1`.
2. Reject it if `t` is more than a few minutes away from your clock.
3. Compute the HMAC over `t`, a dot and the **raw** request body. Do not parse and re-serialize
   the JSON first: the bytes would differ.
4. Compare it with `v1` in constant time.

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

With Express, read the raw body and verify it before parsing:

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

In Python:

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

## Delivery and retries

Deliveries are queued in the database when the change commits, and a background worker sends
them. A slow or failing endpoint never slows down editors or API writes, and deliveries
survive a restart.

- **Success**: any `2xx` answer.
- **Failure**: any other status, including redirects (which are not followed), a connection
  error or a timeout (`[webhooks].timeout_secs`, 10 seconds by default).
- **Retries**: a failed delivery is retried after 30 seconds, 2 minutes, 10 minutes, 1 hour
  and 6 hours, six attempts in all. Then it is marked failed.
- Disabling or deleting a webhook stops its pending retries.
- Several instances share the queue; each delivery is claimed by one of them.

Answer quickly with a `2xx` and do slow work afterwards. Deliveries can arrive more than once
(a retry after a timeout, for example) and out of order: use `x-verdin-delivery` to skip
duplicates, and refetch the document when order matters.

## Delivery log

Each webhook's page in **Settings → Webhooks** has a **Delivery log**, newest first. For each
delivery it shows the status (**Pending**, **Sending**, **Succeeded**, **Failed**), the HTTP
status, the first 2 KB of the response body, the error, the number of attempts, the next
attempt time, the duration and the payload that was sent. A failed delivery can be retried
from the log.

Finished deliveries are removed after `[webhooks].retention_days` (30 by default).

The same data is available from the [admin API](/api/admin/):
`GET /admin/api/webhooks/{id}/deliveries` and `POST /admin/api/webhooks/deliveries/{id}/retry`.

## URL restrictions

Under `verdin start`, webhook URLs may not point at loopback, private, link-local or other
reserved addresses, whether written as IP addresses or as host names that resolve to them. An
admin cannot use webhooks to reach internal services. `verdin dev` allows them, so you can
test against `localhost`; `[webhooks].allow_private_networks` overrides the default. URLs
with credentials (`https://user:pass@…`) are refused: put them in a header.

## Compared with Strapi

Payloads follow Strapi's (`event`, `createdAt`, `model`, `uid`, `entry`). Verdin adds
signatures, retries, a delivery log and per-content-type filters. Strapi's
`entry.draft-discard` event is called `entry.discard-draft`.
