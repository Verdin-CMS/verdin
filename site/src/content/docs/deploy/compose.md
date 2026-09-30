---
title: Docker Compose in production
description: A production Compose recipe for one server — Verdin, PostgreSQL and Caddy with automatic HTTPS, and optional RustFS for S3-compatible media.
sidebar:
  order: 3
---

[`deploy/compose/`](https://github.com/verdin-cms/verdin/tree/main/deploy/compose) is a
ready-made setup for one server: Verdin and PostgreSQL on a private network, and Caddy
in front with a certificate it gets and renews by itself. An override file adds RustFS,
an S3-compatible store on the same host, for media. [Docker](/deploy/docker/) explains
the image these files use.

The files were checked with `docker compose config` and `caddy validate` on 2026-09-30.

## Files

| File | What |
| --- | --- |
| `compose.yaml` | `verdin`, `db` (PostgreSQL 17) and `caddy`. Only Caddy publishes ports (80, 443 and 443/udp for HTTP/3). |
| `compose.s3.yaml` | Adds `rustfs` and a one-shot job that creates the public-read `media` bucket, and switches Verdin's upload provider to it. |
| `Caddyfile` | TLS for `$VERDIN_DOMAIN`, compression, `/media/*` to RustFS and everything else to Verdin. |
| `.env.example` | The variables Compose reads: domain, ACME email, image tag, passwords. |

## Set it up

Prerequisites: a server with Docker, a DNS record for your domain pointing at it, and
ports 80 and 443 open.

1. Copy the directory to the server and fill in `.env`:

   ```sh frame="terminal"
   cp .env.example .env                                  # VERDIN_DOMAIN, ACME_EMAIL
   echo "DB_PASSWORD=$(openssl rand -hex 24)" >> .env
   docker run --rm ghcr.io/verdin-cms/verdin:0.11 secrets > verdin.env
   ```

2. Put your committed schema in `schema/` (`content-types/` and `components/`). It is
   mounted read-only at `/app/schema`.
3. Start it:

   ```sh frame="terminal"
   docker compose up -d
   docker compose logs -f verdin
   ```

4. Open `https://<your domain>/admin/` and register the first admin.

Keep `.env` and `verdin.env` out of version control, and back them up: a new
`VERDIN_TOKEN_PEPPER` invalidates every API token.

## Media on S3

By default uploads go to the `verdin-data` volume. To store them in RustFS instead:

```sh frame="terminal"
echo "S3_SECRET_KEY=$(openssl rand -hex 24)" >> .env
docker compose -f compose.yaml -f compose.s3.yaml up -d
```

Files are then served by Caddy at `https://<your domain>/media/<key>`. For AWS S3,
Cloudflare R2 or another provider, leave out the RustFS services and set the
`VERDIN_UPLOAD__PROVIDER__*` variables and `AWS_*` credentials to that provider's
values (see [Storage](/internals/storage/)). Switching an existing site moves no files:
new uploads go to the new provider.

## Notes

- **Client addresses.** Verdin trusts `X-Forwarded-For` from the Compose network
  (`172.30.0.0/24`, fixed in `compose.yaml`), where Caddy is the only proxy. Change both
  if that range collides with one of your networks.
- **Realtime.** Caddy streams `text/event-stream` responses without buffering, so
  [realtime events](/guides/frontend/realtime/) work behind it unchanged.
- **Upgrades.** Change `VERDIN_VERSION` in `.env`, then `docker compose pull && docker compose up -d`.
  Read [Upgrading](/migrate/upgrading/) first.
- **Backups.** Dump PostgreSQL and keep the `verdin-data` volume (or the bucket); see
  [Backups](/deploy/backups/).
- **Admin commands.** The image has no shell: `docker compose exec verdin verdin admin create --email you@example.com`.
