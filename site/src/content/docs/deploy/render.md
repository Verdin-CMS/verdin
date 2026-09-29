---
title: Render
description: Deploy Verdin to Render with a Blueprint — a Docker web service built from your repository, a Render PostgreSQL database, and media on S3-compatible storage or a disk.
sidebar:
  order: 5
---

This page deploys a Verdin project to [Render](https://render.com) with a Blueprint
(`render.yaml`): a web service built from a small Dockerfile in your repository, and a
Render PostgreSQL database. Render's filesystem is ephemeral, so media goes to
S3-compatible storage, or to a persistent disk if you run one instance.

:::note
The Blueprint format was checked against [Render's Blueprint reference](https://render.com/docs/blueprint-spec)
on 2026-09-29; it was not deployed on a live Render account. Values marked `# yours` are
yours to fill in.
:::

Prerequisites: your Verdin project (with `schema/`) in a Git repository Render can read.

## 1. Add a Dockerfile and a configuration

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337

[schema]
path = "schema"

[log]
format = "json"

[upload]
# Cloudflare R2 as an example; any S3-compatible service works.
provider = { name = "s3", bucket = "media", region = "auto",             # yours
             endpoint = "https://<account>.r2.cloudflarestorage.com",    # yours
             public_url = "https://media.example.com" }                  # yours
```

Keep `.env` out of the repository and out of the image (`.dockerignore`).

## 2. Write `render.yaml`

```yaml title="render.yaml"
services:
  - type: web
    name: verdin
    runtime: docker
    repo: https://github.com/<you>/<your-project>   # yours
    branch: main
    dockerfilePath: ./Dockerfile
    region: frankfurt                               # yours
    healthCheckPath: /_ready
    envVars:
      - key: VERDIN_DATABASE_URL
        fromDatabase:
          name: verdin-db
          property: connectionString
      - key: VERDIN_ADMIN_JWT_SECRET
        generateValue: true
      - key: VERDIN_TOKEN_PEPPER
        generateValue: true
      - key: VERDIN_SERVER__PUBLIC_URL
        value: https://verdin.onrender.com          # yours: the service URL or your domain
      - key: AWS_ACCESS_KEY_ID
        sync: false                                 # asked for when you create the Blueprint
      - key: AWS_SECRET_ACCESS_KEY
        sync: false

databases:
  - name: verdin-db
    databaseName: verdin
    user: verdin
    region: frankfurt                               # yours: the same region
    postgresMajorVersion: "17"
```

Add a `plan` to the service and the database to pick an instance type (see Render's
pricing page); without one, Render uses its default.

`generateValue: true` creates each secret once, when the Blueprint is first applied, and
keeps it afterwards. Do not regenerate them: a new `VERDIN_TOKEN_PEPPER` makes every API
token stop working.

## 3. Deploy

1. In the Render dashboard, create a **Blueprint** from the repository and enter the
   values for the `sync: false` variables.
2. Wait for the first deploy. The image's default command, `start --migrate`, creates
   the tables on the first start and applies safe migrations on later deploys.
3. Open `https://<service>.onrender.com/admin/` and register the first admin.

Render sends `SIGTERM` before it stops an instance; Verdin finishes and exits on it.

## Variant: media on a disk

For a single instance you can store uploads on a Render persistent disk instead of S3.
Set the local provider in `verdin.toml`:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

and add a disk to the service:

```yaml title="render.yaml"
    disk:
      name: verdin-data
      mountPath: /data
      sizeGB: 5
```

With a disk, Render does not let you scale the service to several instances, and
deploys stop the old instance before the new one starts, so each deploy has a short
downtime. The same disk can hold a SQLite database (`sqlite:///data/verdin.db`) if you
do not want a Render database. Check that the image's user (uid `65532`) can write to
the disk; if the start fails with a permission error on `/data`, add `USER root` to your
`Dockerfile`.

## Client addresses

Render's proxy sits in front of the service. Its address range was not verified for
this guide, so `[server].trusted_proxies` is left empty: every visitor then counts as
the same address for rate limits, so keep `[api].public_rate_limit` at `0` unless you
find and trust the proxy's range.
