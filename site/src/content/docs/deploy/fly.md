---
title: Fly.io
description: Deploy Verdin to Fly.io with your own image, PostgreSQL and Tigris object storage, or a single Machine with SQLite on a volume.
sidebar:
  order: 4
---

This page deploys a Verdin project to [Fly.io](https://fly.io) as a small image built on
the official one. The recommended setup keeps no state on the Machine: PostgreSQL for
the database and Tigris (Fly's S3-compatible storage) for media. A variant with SQLite
on a volume follows.

:::note
Fly's formats were checked against [Fly's documentation](https://docs.fly.io/reference/configuration/)
on 2026-09-29; the setup was not run on a live Fly account. Values in angle brackets and
the ones marked `# yours` are yours to fill in.
:::

Prerequisites: [`flyctl`](https://docs.fly.io/flyctl/install/) signed in, and a Verdin
project with its `schema/` directory committed.

## 1. Add a Dockerfile and a configuration

In the project directory, add a `Dockerfile` that copies your configuration and schema
into the official image (see [Your own image](/deploy/docker/)):

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

and a `verdin.toml` for Fly:

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337
public_url = "https://my-verdin.fly.dev"       # yours: the app's URL or your domain

[schema]
path = "schema"

[log]
format = "json"

[upload]
provider = { name = "s3", bucket = "my-verdin-media",   # yours: the bucket name
             region = "auto", endpoint = "https://t3.storage.dev",
             public_url = "https://my-verdin-media.t3.tigrisfiles.io" }
```

Make sure `.env` stays out of the build context: add it to `.dockerignore`.

## 2. Write `fly.toml`

```toml title="fly.toml"
app = "my-verdin"                # yours
primary_region = "fra"           # yours

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 1337
  force_https = true
  # Keep a Machine running: webhooks, scheduled releases, plugin jobs and the
  # daily digest run inside the server process.
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "30s"
    interval = "15s"
    method = "GET"
    timeout = "5s"
    path = "/_ready"

[[vm]]
  memory = "512mb"               # adjust to your content and traffic
```

The image's default command, `start --migrate`, applies safe migrations when each
Machine starts, so no `release_command` is needed. (Fly runs `release_command` in a
temporary Machine without volumes, which would not work for SQLite anyway.)

## 3. Create the app, database and bucket

1. Create the app without deploying it. `--ha=false` starts with one Machine; read
   [Running several instances](/deploy/scaling/) before you add more.

   ```sh frame="terminal"
   fly launch --no-deploy --copy-config --ha=false
   ```

2. Create a PostgreSQL database, for example with
   [Fly Managed Postgres](https://docs.fly.io/mpg/) or any PostgreSQL provider, and note
   its connection URL.

3. Create a public Tigris bucket. The command sets `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3` and `BUCKET_NAME` as secrets of the
   app; Verdin reads the first two. Put the bucket name in `verdin.toml`.

   ```sh frame="terminal"
   fly storage create --public
   ```

4. Set Verdin's secrets and the database URL:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets | fly secrets import
   fly secrets set VERDIN_DATABASE_URL='postgres://<user>:<password>@<host>:5432/<db>?sslmode=require'
   ```

5. Deploy, then open `https://<app>.fly.dev/admin/` and register the first admin:

   ```sh frame="terminal"
   fly deploy
   ```

## Client addresses and rate limits

Fly's proxy adds the client to `X-Forwarded-For`, and according to
[Fly's request headers documentation](https://docs.fly.io/networking/request-headers/)
the rightmost address is your app's own IP. For Verdin to find the client, trust the
proxy's range and your app's addresses (`fly ips list`):

```toml title="verdin.toml"
[server]
trusted_proxies = ["172.16.0.0/12", "<app IPv4>", "<app IPv6>"]
```

This was not verified on a running app. Until you have checked it, leave
`[api].public_rate_limit` at `0`: without the right proxies, every visitor counts as the
same address.

## Variant: one Machine with SQLite

For a small project you can keep the database and uploads on a Fly volume instead.

- In `verdin.toml`, set `provider = { name = "local", dir = "/data/uploads" }` under
  `[upload]` (the default directory is relative to `/app`, which the server cannot
  write), and set `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` as a secret.
- Mount a volume at `/data`:

  ```toml title="fly.toml"
  [mounts]
    source = "verdin_data"
    destination = "/data"
    initial_size = "1gb"
  ```

- Run exactly one Machine (`fly scale count 1`). A volume attaches to one Machine, and
  SQLite cannot be shared.
- Fly creates volumes owned by root, and the image runs as uid `65532`. If the start
  fails with a permission error on `/data`, add `USER root` to your `Dockerfile`.

Back up the volume: Fly keeps daily volume snapshots, and `verdin export` gives you a
portable archive (see [Backups](/deploy/backups/)).
