---
title: Security
description: How Verdin protects the admin panel, the content API and the server, which settings harden a production instance, and how to report a vulnerability.
sidebar:
  order: 2
---

This page describes what Verdin does to protect a project and the settings you control.
Use it with the [production checklist](/deploy/production-checklist/) when you prepare
an instance for real traffic.

## What is closed by default

- **The content API.** Anonymous requests get nothing until you grant public
  permissions in **Settings → Public access**. An unknown, expired or malformed token is
  a `401`, never a fallback to the public role. See [Permissions](/concepts/permissions/).
- **The OpenAPI document** at `/api/_openapi.json` needs a valid API token until you make
  it public in **Settings → Features → API documentation**.
- **Optional features** such as GraphQL, end users, SSO and the MCP server stay off until
  an admin with the `features.manage` permission switches them on in
  **Settings → Features**.
- **Plugins** stay off until an admin switches each one on in **Settings → Plugins**.
- **Cross-origin browser calls.** No origin may call any API from a browser until you
  list it in `[api].cors_origins`.

## Admin sign-in

| Protection | Details |
| --- | --- |
| Password hashing | Argon2id with OWASP parameters, rehashed when they change. |
| Sessions | A 15-minute access token kept in the page's memory (never in `localStorage`), and a 30-day refresh token in an `HttpOnly`, `SameSite=Strict` cookie limited to `/admin/api/auth`. The refresh token rotates on every use; presenting an old one ends the whole session. |
| Secure cookies | The refresh cookie is `Secure` in `verdin start`. `[admin].secure_cookies = false` turns that off and logs a warning. |
| CSRF | Refresh and sign-out need an `X-Verdin-CSRF` header, which a cross-site form cannot send. |
| Lockout | Five failed attempts lock an account for 15 minutes. Failures count across the password and second-factor steps. Unknown emails and wrong passwords get the same answer, in the same time. |
| Rate limit | Sign-in, registration and refresh: `[admin].auth_rate_limit` requests per minute and client address (20). |
| Second factor | Authenticator apps (TOTP) and passkeys, with recovery codes. A role can require it (`requireTwoFactor`). See [Two-factor authentication](/guides/auth/two-factor/). |
| Super Admins | Only a Super Admin can create, edit, delete or reset a Super Admin, or grant that role. The last active Super Admin cannot be removed. |

The first admin is registered through the panel while no admin exists. Do it right after
the first start, or create it with `verdin admin create --email …` before exposing the
server.

## Admin panel and admin API

- The admin API (`/admin/api`) sends no CORS headers, whatever `[api].cors_origins`
  says: browsers only let the panel's own origin read its answers.
- The panel is served with a strict Content Security Policy (scripts from its own
  origin only), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: strict-origin-when-cross-origin`.
- Verdin does not send `Strict-Transport-Security`. Add it at the reverse proxy that
  terminates TLS.

## Content API

- **API tokens** are shown once. Verdin stores an HMAC-SHA256 of each token, keyed with
  `VERDIN_TOKEN_PEPPER`, and keeps a 10-character prefix for display. Tokens can expire
  and can be regenerated.
- **Field and locale permissions** limit what a role reads and writes, and `populate`,
  relation filters and relation sorts only reach types the caller may read.
- **Query limits**: `pageSize` up to `[api].max_page_size` (100), `populate` depth up to
  5, at most 100 filter conditions, query strings up to 16 KB, and at most 1,000
  populated entries per relation. Unknown or private fields in a query are a `400`.
- **GraphQL** has its own depth and complexity limits (`maxDepth`, `maxComplexity`) and
  an introspection switch in the feature's settings.
- **Rate limits**: `[api].public_rate_limit` per client address without a token and
  `[api].token_rate_limit` per API token or end user, in requests per minute. Both are
  off (`0`) by default. Requests with an unknown bearer token are limited per address.

### CORS

`[api].cors_origins` lists the browser origins allowed to call the content API and
GraphQL:

```toml title="verdin.toml"
[api]
cors_origins = ["https://www.example.com", "https://preview.example.com"]
```

Each entry is `scheme://host[:port]` without a path or trailing slash; `["*"]` allows any
origin and cannot be combined with others. Allowed methods are `GET`, `POST`, `PUT` and
`DELETE`, and allowed request headers `Authorization`, `Content-Type` and
`If-None-Match`. The start fails on an entry that is not an origin.

Server-side frontends (Astro, Next.js on the server) call the API without a browser and
need no CORS entry.

## Requests and uploads

| Setting | Default | Protects against |
| --- | --- | --- |
| `[server].body_limit` | `"1mb"` | Large request bodies on the regular APIs. |
| `[server].request_timeout_secs` | `30` | Slow requests holding connections. |
| `[upload].max_file_size` | 200 MB | Large uploads (uploads have their own limit instead of `body_limit`). |
| `[upload].max_image_megapixels` | `100` | Decompression bombs. |

The type of an uploaded file comes from its bytes, not from the type the client sends;
the file name is only a fallback, and never for types browsers run actively (such
files are stored as `application/octet-stream`). Rich text `blocks` links must be `http(s)`, `mailto:` or relative.

## Client addresses behind a proxy

Rate limits and audit logs use the client's address. Behind a reverse proxy every
request comes from the proxy, so list the proxy in `[server].trusted_proxies`:

```toml title="verdin.toml"
[server]
trusted_proxies = ["10.0.0.0/8"]   # the proxies' IPs or CIDR ranges
```

Verdin then reads `X-Forwarded-For` from right to left and takes the first address that
is not a trusted proxy. Requests from any other address keep their connection address,
so a client cannot forge its address by sending the header itself. Do not list ranges
that untrusted clients can connect from.

## Outgoing requests

Webhooks, deploy hooks, CDN purge webhooks and uploads from a URL make requests that an
admin chooses. In `verdin start` they refuse loopback, private and link-local addresses
(IPv6 forms that embed private IPv4 addresses included), so an admin cannot use them to
reach services on your internal network. `[webhooks].allow_private_networks = true`
lifts that; do it only when every admin is trusted with the internal network.

## Secrets

`VERDIN_ADMIN_JWT_SECRET` and `VERDIN_TOKEN_PEPPER` are read from the environment only
and must each be at least 32 bytes (`verdin secrets` prints fresh ones). The pepper also
seals admins' TOTP secrets and derives the key that hashes form submitters' addresses.
Store both in your platform's secret manager and never commit `.env`.

Request logs hide the values of query parameters whose names look secret (`token`,
`code`, `password`, `key`, `signature`…) and the secret part of deploy callback URLs.

## Metrics

`/_metrics` is off unless `[metrics].enabled = true`. When it is on and no token is set,
anyone who reaches the port can read it. Set `VERDIN_METRICS_TOKEN` (or
`[metrics].token`) and scrape with `Authorization: Bearer <token>`, or block the path at
the proxy. See [Monitoring](/deploy/monitoring/).

## Plugins

Plugins are WebAssembly modules run by Extism in a sandbox. A module has no file system,
network or database of its own: everything goes through host functions limited by the
capabilities in its `plugin.toml` (content types it reads or writes, HTTP hosts, its own
key-value store), with a time and memory limit per call (`[limits]`, 5 s and 64 MB in the
example manifest). Admins see what a plugin asks for before switching it on. Plugin
admin scripts run in the panel's page, so install only plugins you trust. See
[Plugins](/extending/plugins/).

## Exports and backups

`verdin export` archives contain private fields and password hashes. Store them like
database dumps. See [Backups](/deploy/backups/).

## Reporting a vulnerability

Do not open a public issue for a security problem. The repository has no `SECURITY.md`
policy yet; report it privately through the **Security** tab of
[github.com/Verdin-CMS/verdin](https://github.com/Verdin-CMS/verdin) (**Report a
vulnerability**), with the version, the steps to reproduce and the impact you see.
Security fixes are listed under **Security** in the [changelog](/project/changelog/).
