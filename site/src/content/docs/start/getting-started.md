---
title: Getting started
description: Run Verdin with Docker or the binary, create the first admin and read content from the API.
---

Verdin runs as a single binary with the admin panel built in. Pick Docker or the
binary, then follow the same first steps in the admin panel.

## With Docker

Generate the secrets once, then start in development mode (SQLite in a volume, the
content-type builder enabled):

```sh
docker run --rm ghcr.io/verdin-cms/verdin secrets > verdin.env
docker run -p 1337:1337 --env-file verdin.env -v verdin-data:/data ghcr.io/verdin-cms/verdin dev
```

`verdin secrets` prints fresh values for `VERDIN_ADMIN_JWT_SECRET` and
`VERDIN_TOKEN_PEPPER`. Secrets come from the environment only, never from
`verdin.toml`.

## With the binary

Download a build from the [releases](https://github.com/verdin-cms/verdin/releases),
then scaffold a project:

```sh
verdin new my-site            # verdin.toml, schema/, .env with fresh secrets, SQLite
cd my-site && verdin dev
```

`verdin new` takes `--database sqlite|postgres|mysql|mariadb` (SQLite by default) to
choose the database the generated `.env` points at. The `.env` file next to
`verdin.toml` is loaded on start; variables already set in the environment win.

## First steps in the admin panel

1. Open <http://localhost:1337/admin/> and create the first admin.
2. Model a type in the **Content-type builder** and add an entry.
3. Allow `find` for it in **Settings → Public access**.
4. Read it from the content API:

   ```sh
   curl localhost:1337/api/articles
   ```

The content API is closed until you grant public permissions or create API tokens.

## Development and production mode

| Command | Use it for |
| --- | --- |
| `verdin dev` | Development: safe migrations apply automatically and the content-type builder can edit the schema files. |
| `verdin start` | Production. It refuses to run while the database is behind the schema. |
| `verdin start --migrate` | Production, applying pending safe migrations before starting (the Docker image's default command). |

In production, keep the schema in version control and mount it read-only. With Docker:

```sh
docker run -p 1337:1337 --env-file verdin.env \
  -e VERDIN_DATABASE_URL=postgres://user:pass@db:5432/verdin \
  -v ./schema:/data/schema:ro ghcr.io/verdin-cms/verdin
```

## Schema and migrations

Content types live in `schema/content-types/<singularName>.json` and components in
`schema/components/<category>/<name>.json`, in the Strapi format (see the
[architecture](/reference/architecture/)).

```sh
verdin schema check                      # validate every schema file
verdin migrate plan                      # steps, risk level and exact SQL
verdin migrate apply                     # safe steps only
verdin migrate apply --allow risky       # also type changes and new unique constraints
verdin migrate apply --allow destructive # also dropped columns and tables
verdin migrate apply --rename-column articles.title=headline --rename-table posts=articles
```

On MySQL and MariaDB (no transactional DDL) an interrupted migration resumes from the
failed step on the next `migrate apply`.

## Admin users from the command line

```sh
verdin admin create --email other@example.com      # password from VERDIN_ADMIN_PASSWORD or stdin
verdin admin reset-password --email you@example.com
```

`reset-password` also unlocks the account and ends its sessions.

## Other commands

| Command | What it does |
| --- | --- |
| `verdin types -o src/verdin-types.ts` | Writes TypeScript definitions of the content API (standard output without `-o`). |
| `verdin import strapi <export>` | Imports a Strapi project; see [Importing from Strapi](/start/importing-from-strapi/). |
| `verdin version` | Prints version information. |

Every command takes `-c, --config <path>` (default `verdin.toml`, or `VERDIN_CONFIG`).
Settings are described in the [configuration reference](/reference/configuration/).

## Health checks

`GET /_health` answers while the process is up. `GET /_ready` also checks the database
and answers 503 when it cannot be reached — point load balancers at it (see
[Running several instances](/guides/scaling/)).
