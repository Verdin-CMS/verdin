---
title: Railway
description: Deploy Verdin to Railway from your repository's Dockerfile, with Railway PostgreSQL and media on S3-compatible storage or a volume.
sidebar:
  order: 6
---

This page deploys a Verdin project to [Railway](https://railway.com): a service built
from a small Dockerfile in your repository, a Railway PostgreSQL database, and media on
S3-compatible storage (or a volume for a single instance).

:::note
Railway's settings were checked against [Railway's documentation](https://docs.railway.com/reference/config-as-code)
on 2026-09-29; the setup was not deployed on a live Railway account. Values marked
`# yours` or in angle brackets are yours to fill in.
:::

## 1. Add a Dockerfile, a configuration and `railway.json`

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
provider = { name = "s3", bucket = "media", region = "auto",             # yours
             endpoint = "https://<account>.r2.cloudflarestorage.com",    # yours
             public_url = "https://media.example.com" }                  # yours
```

```json title="railway.json"
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "healthcheckPath": "/_ready",
    "healthcheckTimeout": 120,
    "restartPolicyType": "ON_FAILURE"
  }
}
```

No start command is needed: the image runs `start --migrate`, which applies safe
migrations before it serves. Keep `.env` out of the repository.

## 2. Create the project

1. In Railway, create a project from your GitHub repository. Railway finds
   `railway.json` and builds the Dockerfile.
2. Add a **PostgreSQL** database to the project.
3. In the Verdin service's **Variables**, add:

   | Variable | Value |
   | --- | --- |
   | `VERDIN_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (the database service's private URL; use your database service's name) |
   | `VERDIN_ADMIN_JWT_SECRET` | from `verdin secrets` |
   | `VERDIN_TOKEN_PEPPER` | from `verdin secrets` |
   | `VERDIN_SERVER__PUBLIC_URL` | `https://<your-domain>` |
   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | your S3 credentials |

   Generate the two secrets locally:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets
   ```

4. In the service's networking settings, click **Generate Domain** and set its target
   port to `1337`. Verdin listens on `[server].port` and does not read Railway's `PORT`
   variable.
5. Deploy, open `https://<your-domain>/admin/` and register the first admin.

## Variant: media or SQLite on a volume

For a single instance you can keep uploads, and even the database, on a Railway volume
mounted at `/data`:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

with `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` if you skip PostgreSQL. Keep in mind:

- A service with a volume cannot have replicas, and each redeploy has a short downtime.
- Railway mounts volumes owned by root, and the image runs as uid `65532`. Set the
  service variable `RAILWAY_RUN_UID=0` so the server can write to the volume.

## Client addresses

Railway's edge proxy sits in front of the service. Its address range was not verified
for this guide, so `[server].trusted_proxies` stays empty: every visitor then counts as
the same address for rate limits, so keep `[api].public_rate_limit` at `0` unless you
find and trust the proxy's range.
