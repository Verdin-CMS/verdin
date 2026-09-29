---
title: Production checklist
description: What to set before a Verdin project takes real traffic — secrets, database, migrations, URLs, proxies, cookies, CORS, media storage, email, backups and monitoring.
sidebar:
  order: 1
---

Go through this list before you put a Verdin project in front of real users. Each item
links to the page that explains it. The platform pages ([Docker](/deploy/docker/),
[Fly.io](/deploy/fly/), [Render](/deploy/render/), [Railway](/deploy/railway/),
[Kubernetes](/deploy/kubernetes/)) apply these settings for you where they can.

## Run the production server

- [ ] **Use `verdin start`, not `verdin dev`.** `dev` lets the content-type builder
      rewrite schema files, applies migrations on every change and relaxes cookie and
      webhook rules for local work. Change the schema in development, commit the files,
      and deploy them.
- [ ] **Apply migrations at deploy time.** `verdin start` refuses to run while the
      database is behind the schema. `verdin start --migrate` applies the pending *safe*
      steps first (this is the Docker image's default command). Risky or destructive
      steps (type changes, new unique constraints, dropped columns) need
      `verdin migrate apply --allow risky|destructive`, run once by you. See
      [Schema migrations](/concepts/schema-migrations/).
- [ ] **Ship the schema with the server.** Mount the `schema/` directory read-only, or
      bake it into your image, so that what runs is what you committed.

## Secrets

- [ ] **Generate the two required secrets once** with `verdin secrets` and keep them in
      your platform's secret store: `VERDIN_ADMIN_JWT_SECRET` signs session tokens, and
      `VERDIN_TOKEN_PEPPER` keys the hashes of API tokens and other stored secrets.
      `verdin start` fails if either is missing or shorter than 32 bytes. Secrets are
      read from the environment only, never from `verdin.toml`.
- [ ] **Keep them stable.** Changing `VERDIN_TOKEN_PEPPER` makes every API token stop
      working, and admins' authenticator-app codes and recovery codes too. Changing
      `VERDIN_ADMIN_JWT_SECRET` voids the short-lived access tokens of admins and end
      users, open preview links and OAuth sign-ins in progress (the admin panel and
      clients with refresh tokens renew them by themselves). Every
      instance of a project needs the same values.
- [ ] Put the other secrets you use in the environment too: `VERDIN_EMAIL_SMTP_PASSWORD`
      or `VERDIN_EMAIL_API_KEY`, `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`,
      `VERDIN_METRICS_TOKEN`, `VERDIN_SSO_<ID>_SECRET`, `VERDIN_IMAGE_SECRET`. The full
      list is in the [configuration reference](/reference/configuration/).

## Database

- [ ] **Choose the engine.** PostgreSQL (14 or later) is the usual choice and the one to
      pick if you will run [several instances](/deploy/scaling/). MySQL 8.4+ and MariaDB
      10.11+ work the same way. SQLite suits a single instance with a persistent disk.
- [ ] **Set `VERDIN_DATABASE_URL`**: `postgres://…`, `mysql://…` (MySQL and MariaDB) or
      `sqlite:///data/verdin.db`. Add `?sslmode=require` for PostgreSQL servers that need
      TLS.
- [ ] **Size the pool.** Each instance opens up to `[database].pool_max` connections (10).
      Keep `instances × pool_max` below the server's connection limit.

## URLs, proxies and cookies

- [ ] **Serve over HTTPS.** Verdin speaks plain HTTP; terminate TLS at a reverse proxy,
      load balancer or your platform's edge.
- [ ] **Set `[server].public_url`** (`VERDIN_SERVER__PUBLIC_URL`) to the address browsers
      use, such as `https://cms.example.com`. Links in emails, SSO callbacks, the daily
      digest and passkeys depend on it; passkeys are bound to its host.
- [ ] **Set `[server].trusted_proxies`** to the addresses of your reverse proxies (IPs or
      CIDR ranges). Only then does Verdin read the client address from
      `X-Forwarded-For`; without it, every client behind the proxy shares one address for
      rate limits and audit logs.
- [ ] **Keep secure cookies on.** In `verdin start` the admin refresh cookie is `Secure`
      by default. Leave `[admin].secure_cookies` unset; setting it to `false` in
      production logs a warning at start.

## APIs

- [ ] **Grant only what the public needs.** The content API is closed until you grant
      public permissions (**Settings → Public access**) or create API tokens. See
      [Permissions](/concepts/permissions/).
- [ ] **Set `[api].cors_origins`** if a browser on another origin calls the content API
      or GraphQL, for example `["https://www.example.com"]`. Without it, only
      same-origin pages can call them from a browser. The admin API never answers
      cross-origin requests.
- [ ] **Consider rate limits** for anonymous traffic: `[api].public_rate_limit` and
      `[api].token_rate_limit` (requests per minute; `0`, the default, is unlimited).

## Media

- [ ] **Store uploads where they survive a redeploy.** The default local provider writes
      to disk: give it a persistent volume, or use the S3 provider (AWS S3, Cloudflare
      R2, Backblaze B2, MinIO, Tigris…). On platforms with ephemeral disks, and with
      several instances, use S3. See [Media](/concepts/media/).

## Email

- [ ] **Configure a real provider.** The default `[email].provider = "log"` writes
      emails to the log, and `verdin start` warns about it. Invitations, password resets,
      end-user confirmations, comment mentions and the digest need `smtp`, `resend` or
      `postmark`, and `[email].from` set to an address your provider accepts.

## Backups and monitoring

- [ ] **Back up the database and the media storage** on a schedule, and try a restore.
      See [Backups](/deploy/backups/).
- [ ] **Point health checks at `/_ready`** and liveness checks at `/_health`.
- [ ] **Log as JSON** (`[log].format = "json"`, the Docker image's default) and collect
      standard error.
- [ ] **Scrape `/_metrics`** if you use Prometheus, with a `VERDIN_METRICS_TOKEN`. See
      [Monitoring](/deploy/monitoring/).

## Before going live

- [ ] Register the first admin yourself right after the first start: until an admin
      exists, anyone who reaches `/admin/` can register as Super Admin. You can also
      create it from the command line with `verdin admin create --email …`.
- [ ] Review the [security model](/deploy/security/) and turn on
      [two-factor authentication](/guides/auth/two-factor/) for Super Admins.
