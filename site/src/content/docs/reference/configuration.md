---
title: Configuration reference
description: Every section and key of verdin.toml, with defaults, and the environment variables Verdin reads.
---

<!-- Written from crates/verdin/src/config.rs, crates/verdin-upload/src/config.rs and
crates/verdin-email/src/lib.rs. Keep it in step when keys change. -->

Configuration is layered: **built-in defaults ← `verdin.toml` ← environment**. The
file is optional; every key has a default. Unknown keys are rejected, so a typo fails
at start instead of being ignored.

- Override any key with `VERDIN_<SECTION>__<KEY>` (two underscores), for example
  `VERDIN_SERVER__PORT=8080` or `VERDIN_ADMIN__SECURE_COOKIES=false`.
- `VERDIN_DATABASE_URL` is a shorthand for `database.url`.
- The file is `verdin.toml` in the working directory, or the path given with
  `-c, --config` or `VERDIN_CONFIG`. Relative paths in it (schema, plugins, uploads,
  SQLite files) are resolved against the file's directory.
- A `.env` file next to the configuration is loaded first; variables already set in the
  environment win.

Secrets are never read from `verdin.toml`; see [Environment variables](#environment-variables).

## `[server]`

| Key | Default | Description |
| --- | --- | --- |
| `host` | `"0.0.0.0"` | Address to listen on. |
| `port` | `1337` | Port to listen on. |
| `public_url` | unset | Where browsers reach the server, e.g. `"https://cms.example.com"`. Used for links in emails and SSO callbacks; defaults to `http://localhost:{port}`. |
| `body_limit` | `"1mb"` | Largest request body of regular API requests (uploads have their own limit). A number of bytes or a string with `b`, `kb`, `mb` or `gb`. |
| `request_timeout_secs` | `30` | Time limit of regular API requests. |
| `sync_interval_secs` | `10` | How often to pick up settings changed by other instances (features, plugin switches, locales, review workflows); `0` turns it off (a single instance). |

## `[database]`

| Key | Default | Description |
| --- | --- | --- |
| `url` | unset | Connection URL: `postgres://…`, `mysql://…` (MySQL and MariaDB) or `sqlite://…`. Required; usually set through `VERDIN_DATABASE_URL`. |
| `pool_max` | `10` | Maximum connections in the pool. |

## `[schema]`

| Key | Default | Description |
| --- | --- | --- |
| `path` | `"schema"` | Schema directory, relative to the configuration file. |

## `[api]`

| Key | Default | Description |
| --- | --- | --- |
| `prefix` | `"/api"` | Path the content API is served under. Must start with `/` and not end with one. |
| `default_page_size` | `25` | Page size when a request sets none. Between 1 and `max_page_size`. |
| `max_page_size` | `100` | Largest page size a request may ask for. |
| `decimal_as_string` | `false` | Serialize decimals as strings (exact) instead of numbers (Strapi-compatible). |
| `public_rate_limit` | `0` | Requests per minute and client IP without a token (`0`: unlimited). |
| `token_rate_limit` | `0` | Requests per minute and API token or end user (`0`: unlimited). |
| `cache_ttl_secs` | `0` | Keep anonymous reads in memory this long (`0`: no cache); changes empty the cache. |
| `cache_entries` | `1000` | Maximum number of cached responses. |

## `[admin]`

| Key | Default | Description |
| --- | --- | --- |
| `path` | `"/admin"` | Path the admin panel is served under; its API lives at `{path}/api`. |
| `secure_cookies` | unset | Mark the refresh cookie `Secure`. Unset means yes in `verdin start` and no in `verdin dev` (plain-HTTP local development). |
| `auth_rate_limit` | `20` | Login, registration and refresh attempts per client IP per minute. |
| `assets_dir` | unset | Serve the admin panel from this directory (relative to the configuration file) instead of the copy embedded in the binary. |

### `[admin.branding]`

| Key | Default | Description |
| --- | --- | --- |
| `title` | `"Verdin"` | Shown in the sidebar, on the sign-in page and in the browser tab. |
| `logo` | unset | Image file (SVG, PNG, WebP), relative to the configuration file. |
| `favicon` | unset | Icon file (ICO, PNG, SVG), relative to the configuration file. |
| `accent` | unset | `#rrggbb` color of buttons, links and focus rings. |
| `translations` | `{}` | Admin texts replaced per language, for example `[admin.branding.translations.en]` with `"auth.login.title" = "Welcome to ACME"`. The keys are those of `admin/public/i18n/en.json`. |

## `[upload]`

| Key | Default | Description |
| --- | --- | --- |
| `provider` | `{ name = "local", dir = "public/uploads" }` | Where files are stored; see below. |
| `max_file_size` | `209715200` | Largest accepted file, in bytes (200 MB). |
| `responsive_formats` | `true` | Generate responsive formats for raster images. |
| `breakpoints` | large 1000, medium 750, small 500 | Responsive formats as `{ name, width }` tables (Strapi's `breakpoints`). Formats wider than the image are skipped. |
| `max_image_megapixels` | `100` | Decoding limit against decompression bombs, in megapixels. |
| `max_original_size` | unset | Raster originals larger than this many pixels (either side) are scaled down on upload, which also drops their metadata (EXIF, GPS). Unset keeps originals as sent. |

```toml
[upload]
breakpoints = [{ name = "large", width = 1000 }, { name = "small", width = 500 }]
```

### Local provider

Files under `dir` (relative to the project), served by Verdin at `/uploads`.

```toml
[upload]
provider = { name = "local", dir = "public/uploads" }
```

### `[upload.transforms]`

Image transformations of local files: `/uploads/<file>?preset=thumb`, or
`?w=&h=&fit=&format=&q=` with a signature. Renderings are cached on disk and dropped
when the file changes (its focal point included). Cover crops keep the file's focal
point in view; images are never enlarged. JPEG, PNG, WebP, TIFF and BMP can be
transformed (not GIFs, which may be animated).

| Key | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Serve transformations. |
| `presets` | `{}` | Named transformations, always allowed: `{ w, h, fit, format, q }`. |
| `allow_arbitrary` | `false` | Accept any parameters without a signature. Each distinct URL is rendered and cached, so only for trusted networks. |
| `max_size` | `4096` | Largest `w` or `h`, in pixels. |
| `cache_dir` | `".cache/transforms"` | Where renderings are kept (relative to the project; safe to delete). |

Parameters: `w`, `h` (pixels), `fit` (`cover`, the default, crops to the box; `inside`
fits within it; `fill` stretches), `format` (`jpeg`, `png`, `webp`; WebP output is
lossless) and `q` (JPEG quality, 1–100, default 80).

```toml
[upload.transforms.presets]
thumb = { w = 300, h = 300 }
hero = { w = 1600, h = 600, format = "webp" }
```

**Signed URLs.** With `VERDIN_IMAGE_SECRET` set, `s` is the hex HMAC-SHA256 of
`<file>?<canonical query>`, where the canonical query lists the non-default parameters
sorted by name (`fit`, `format`, `h`, `q`, `w`; `fit=cover` omitted):

```js
import { createHmac } from 'node:crypto';
const s = createHmac('sha256', process.env.VERDIN_IMAGE_SECRET)
  .update('photo_1a2b.jpg?format=webp&w=800')
  .digest('hex');
const url = `/uploads/photo_1a2b.jpg?format=webp&w=800&s=${s}`;
```

### S3 provider

Any S3-compatible service (AWS, Cloudflare R2, MinIO, Backblaze B2…). Credentials come
from the standard `AWS_*` environment variables (`AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`).

| Key | Default | Description |
| --- | --- | --- |
| `bucket` | required | Bucket name. |
| `region` | unset | Bucket region. |
| `endpoint` | unset | Custom endpoint for non-AWS services, e.g. `https://<account>.r2.cloudflarestorage.com`. |
| `public_url` | required | Public base URL of the bucket or its CDN; files are linked as `{public_url}/{key}`. |
| `prefix` | `""` | Key prefix inside the bucket. |
| `path_style` | `false` | Path-style requests (MinIO and most self-hosted services). |

```toml
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

## `[webhooks]`

| Key | Default | Description |
| --- | --- | --- |
| `allow_private_networks` | unset | Allow webhook URLs on loopback, private and link-local addresses. Unset means no in `verdin start` (an admin could otherwise reach internal services) and yes in `verdin dev`. |
| `timeout_secs` | `10` | Time limit of each delivery. |
| `retention_days` | `30` | Days the delivery log is kept. |

See [Webhooks](/guides/webhooks/).

## `[history]`

| Key | Default | Description |
| --- | --- | --- |
| `max_versions` | `50` | Versions kept per document (older ones are removed). |

## `[email]`

| Key | Default | Description |
| --- | --- | --- |
| `provider` | `"log"` | `log` (write emails to the log), `smtp`, `resend` or `postmark`. |
| `from` | `"Verdin <no-reply@localhost>"` | Sender. |
| `reply_to` | unset | Reply-to address. |

### `[email.smtp]`

| Key | Default | Description |
| --- | --- | --- |
| `host` | `"localhost"` | SMTP server. |
| `port` | `587` | SMTP port. |
| `username` | unset | SMTP user; the password comes from `VERDIN_EMAIL_SMTP_PASSWORD`. |
| `security` | `"starttls"` | `starttls`, `tls` (implicit, usually port 465) or `none` (local relays). |

## `[plugins]`

| Key | Default | Description |
| --- | --- | --- |
| `path` | `"plugins"` | Directory of plugins (one sub-directory each), relative to the configuration file. |
| `run_jobs` | `true` | Run the plugins' scheduled jobs on this instance (one instance when there are several). |

See [Plugins](/guides/plugins/).

## `[audit]`

| Key | Default | Description |
| --- | --- | --- |
| `retention_days` | `90` | Days audit log entries are kept. |

## `[digest]`

| Key | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Send the daily digest from this instance (one instance when there are several). |
| `hour_utc` | `8` | Hour (UTC, 0–23) the daily digest of unseen changes goes out. |

## `[log]`

| Key | Default | Description |
| --- | --- | --- |
| `format` | `"pretty"` | `pretty` or `json`. |
| `level` | unset (`info`) | Default filter; `RUST_LOG` takes precedence when set. |

## `[metrics]`

| Key | Default | Description |
| --- | --- | --- |
| `enabled` | `false` | Serve Prometheus metrics at `/_metrics`: HTTP requests by area (`api`, `admin_api`, `graphql`, `mcp`, `uploads`…), method and status class with latency histograms, pending webhook deliveries, open realtime streams and uptime. |
| `token` | unset | Scrapes need `Authorization: Bearer <token>`. `VERDIN_METRICS_TOKEN` wins over it. Without a token, anyone who reaches the port can read the metrics. |

## Environment variables

Besides the `VERDIN_<SECTION>__<KEY>` overrides, Verdin reads these variables:

| Variable | Description |
| --- | --- |
| `VERDIN_CONFIG` | Path of the configuration file (same as `--config`). |
| `VERDIN_DATABASE_URL` | Shorthand for `database.url`. |
| `VERDIN_ADMIN_JWT_SECRET` | Signs admin session tokens. Required, at least 32 bytes; generate it with `verdin secrets`. |
| `VERDIN_TOKEN_PEPPER` | Keyed hash for stored tokens. Required, at least 32 bytes; generate it with `verdin secrets`. |
| `VERDIN_ADMIN_PASSWORD` | Password for `verdin admin create` and `verdin admin reset-password` (otherwise read from stdin). |
| `VERDIN_EMAIL_SMTP_PASSWORD` | SMTP password. |
| `VERDIN_EMAIL_API_KEY` | API key of the Resend and Postmark providers. |
| `VERDIN_SSO_<ID>_SECRET` | Client secret of an SSO provider (see [Single sign-on](/guides/sso/)). |
| `VERDIN_OAUTH_<PROVIDER>_SECRET` | Client secret of an end-user OAuth provider (see [End users](/guides/end-users/)). |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Credentials of the S3 upload provider. |
| `RUST_LOG` | Log filter; takes precedence over `[log].level`. |
