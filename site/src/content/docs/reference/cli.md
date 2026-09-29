---
title: Command line reference
description: Every command, subcommand and flag of the verdin binary, with what it reads, writes and prints.
sidebar:
  order: 2
  label: Command line
---

<!-- Written from crates/verdin/src/cli.rs and crates/verdin/src/new.rs. `npm run check-cli`
(site/scripts/check-cli.mjs) fails when a subcommand or flag in cli.rs is missing here. -->

`verdin` is the only binary: it creates projects, runs the server, applies migrations,
manages admin users and moves content in and out. This page lists every command and flag.

```text title="Terminal"
verdin [OPTIONS] <COMMAND>
```

| Command | What it does |
| --- | --- |
| [`verdin new`](#verdin-new) | Create a project directory. |
| [`verdin dev`](#verdin-dev) | Run the server in development mode. |
| [`verdin start`](#verdin-start) | Run the server in production mode. |
| [`verdin schema check`](#verdin-schema-check) | Validate the schema files. |
| [`verdin migrate plan`](#verdin-migrate-plan) | Show the migration steps and their SQL. |
| [`verdin migrate apply`](#verdin-migrate-apply) | Apply the migration steps. |
| [`verdin admin create`](#verdin-admin-create) | Create a Super Admin. |
| [`verdin admin reset-password`](#verdin-admin-reset-password) | Set an admin's password. |
| [`verdin types`](#verdin-types) | Generate TypeScript definitions of the content API. |
| [`verdin import strapi`](#verdin-import-strapi) | Import a Strapi export. |
| [`verdin import verdin`](#verdin-import-verdin) | Import a Verdin export. |
| [`verdin export`](#verdin-export) | Write the project to a `.tar.gz` archive. |
| [`verdin healthcheck`](#verdin-healthcheck) | Check that the local server answers. |
| [`verdin secrets`](#verdin-secrets) | Print new secrets. |
| [`verdin version`](#verdin-version) | Print the version. |

## Global options

| Option | Default | Description |
| --- | --- | --- |
| `-c, --config <CONFIG>` | `verdin.toml` | The project's configuration file. Also read from `VERDIN_CONFIG`. The project root is the file's directory: the schema, plugins, uploads and relative SQLite paths are resolved against it. |
| `-h, --help` | | Print help for the command. |
| `-V, --version` | | Print the version. |

`verdin help <COMMAND>` prints the same help as `--help`.

Every command except `new`, `secrets` and `version` loads the project first:

1. It reads the `.env` file next to the configuration file, if there is one. Variables
   already set in the environment win.
2. It loads `verdin.toml` (optional) and the `VERDIN_*` overrides. See the
   [configuration reference](/reference/configuration/).
3. It starts logging to standard error, with `[log]` and `RUST_LOG`.

Commands that open the database need `VERDIN_DATABASE_URL` or `[database].url`. Commands
that touch admin accounts or run the server also need `VERDIN_ADMIN_JWT_SECRET` and
`VERDIN_TOKEN_PEPPER`.

## `verdin new`

```text title="Terminal"
verdin new <DIR> [--database <DATABASE>]
```

Creates a project in `DIR`, which must not exist or must be empty:

| File | Contents |
| --- | --- |
| `verdin.toml` | `[server]`, `[api]` and `[admin]` with their defaults. |
| `.env` | `VERDIN_DATABASE_URL`, and fresh `VERDIN_ADMIN_JWT_SECRET` and `VERDIN_TOKEN_PEPPER`. Readable only by you (mode `0600` on Unix). |
| `.gitignore` | `.env`, `data/`, SQLite files and `.cache/`. |
| `schema/content-types/`, `schema/components/` | Empty schema directories. |
| `data/` | For the SQLite database (SQLite only). |

| Argument or option | Default | Description |
| --- | --- | --- |
| `<DIR>` | | Directory to create. |
| `--database <DATABASE>` | `sqlite` | Database the `.env` points at: `sqlite`, `postgres`, `mysql` or `mariadb`. |

With `sqlite`, the URL is `sqlite://data/verdin.db`. With the others it is a local server
URL with the user `verdin`, the password `change-me` and a database named after the
directory (lowercase letters, digits and `_`): edit it before you start.

```text title="Terminal"
$ verdin new blog --database postgres
created blog

  cd blog
  verdin dev

then open http://localhost:1337/admin/ to register the first admin
```

## `verdin dev`

```text title="Terminal"
verdin dev
```

Runs the server in development mode. Compared with `verdin start`:

- Pending migrations with the risk level `safe` apply at startup. Riskier steps stop the
  server; review them with [`verdin migrate plan`](#verdin-migrate-plan).
- The admin panel's **Content-type builder** edits the schema files and the server
  reloads the schema.
- The refresh cookie is not marked `Secure` (unless `[admin].secure_cookies` says so), so
  you can sign in over plain HTTP.
- Webhooks and deploy targets may call loopback and private addresses (unless
  `[webhooks].allow_private_networks` says otherwise).

It stops on Ctrl+C or `SIGTERM`.

## `verdin start`

```text title="Terminal"
verdin start [--migrate]
```

Runs the server in production mode. It refuses to start when the database is behind the
schema, so a deploy never changes tables you have not reviewed.

| Option | Description |
| --- | --- |
| `--migrate` | Apply pending `safe` migration steps before starting. Risky and destructive steps still need `verdin migrate apply`. |

Before listening, it checks the configuration (`[api].prefix` and `[admin].path` look like
`/api`, page sizes are consistent, `[server].trusted_proxies` and `[api].cors_origins`
parse) and creates the built-in roles. It logs a warning when `[admin].secure_cookies` is
`false` or `[email].provider` is `log`. When there is no admin yet, it logs the address of
the admin panel, where the first visitor registers the first Super Admin.

It stops on Ctrl+C or `SIGTERM`.

## `verdin schema check`

```text title="Terminal"
verdin schema check
```

Validates the schema files (`[schema].path`) without touching the database. It prints a
summary, or fails with the errors, each with its file and attribute path:

```text title="Terminal"
$ verdin schema check
schema ok: 4 content types, 3 components
```

Use it in CI before a deploy. See [Attribute types](/reference/attribute-types/) for what
each attribute accepts.

## `verdin migrate plan`

```text title="Terminal"
verdin migrate plan [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Compares the database with the schema and prints what `verdin migrate apply` would do,
without changing anything: numbered steps, each with its risk level and its SQL. It prints
`database is up to date` when there is nothing to do.

| Option | Description |
| --- | --- |
| `--rename-table <OLD=NEW>` | Treat the table `OLD` as renamed to `NEW` (keeps its rows) instead of dropping one and creating the other. Repeatable. |
| `--rename-column <TABLE.OLD=NEW>` | Treat the column `OLD` of `TABLE` as renamed to `NEW` (keeps its values). `TABLE` is the table's new name. Repeatable. |

Risk levels:

| Level | Meaning |
| --- | --- |
| `safe` | Cannot lose data or fail on existing rows: new tables, new columns that are nullable or have a default, renames, indexes that are not unique. |
| `risky` | May fail on existing rows or convert values: column type changes, new columns that are not nullable and have no default, unique indexes on existing tables. |
| `destructive` | Drops columns or tables. |

When a step is above `safe`, the plan ends with the flag it needs
(`requires: verdin migrate apply --allow risky`). When a dropped column or table looks like
a renamed one, it lists the rename flags to pass. When a previous migration was
interrupted, it shows how many steps were applied and the last error.

```text title="Terminal"
verdin migrate plan --rename-column articles.summary=excerpt
```

See [Schema migrations](/concepts/schema-migrations/).

## `verdin migrate apply`

```text title="Terminal"
verdin migrate apply [--allow <ALLOW>] [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Applies the plan. It takes the same rename options as `verdin migrate plan`; pass the same
ones you reviewed.

| Option | Default | Description |
| --- | --- | --- |
| `--allow <ALLOW>` | `safe` | Highest risk level to apply: `safe`, `risky` or `destructive`. A plan with a step above it is refused before anything runs. |
| `--rename-table <OLD=NEW>` | | As in `verdin migrate plan`. |
| `--rename-column <TABLE.OLD=NEW>` | | As in `verdin migrate plan`. |

It prints `applied N steps`, or `database is up to date`. After an interruption (a lost
connection, a step that failed), fix the cause and run it again: it resumes at the step
that did not complete.

## `verdin admin create`

```text title="Terminal"
verdin admin create --email <EMAIL>
```

Creates a Super Admin. The password is read from `VERDIN_ADMIN_PASSWORD`, or from standard
input when that is unset. The database must be up to date with the schema.

| Option | Description |
| --- | --- |
| `--email <EMAIL>` | The new admin's email address. |

```text title="Terminal"
$ VERDIN_ADMIN_PASSWORD='a long passphrase' verdin admin create --email ada@example.com
created Super Admin ada@example.com (id 1)
```

Use it to create the first admin of a server that is not reachable in a browser yet;
otherwise the first visitor of the admin panel registers it.

## `verdin admin reset-password`

```text title="Terminal"
verdin admin reset-password --email <EMAIL>
```

Sets the password of an admin, unlocks the account after failed sign-ins and ends all its
sessions. The password is read as for `verdin admin create`.

| Option | Description |
| --- | --- |
| `--email <EMAIL>` | The admin's email address. |

It does not remove second factors; an admin with **Manage users** can reset those in
**Settings → Users**.

## `verdin types`

```text title="Terminal"
verdin types [-o <OUT>]
```

Generates TypeScript definitions of the content API (one interface per content type and
component) from the schema, and prints them to standard output. It does not need the
database.

| Option | Description |
| --- | --- |
| `-o, --out <OUT>` | Write to this file instead. |

```text title="Terminal"
verdin types --out ../web/src/verdin.d.ts
```

See [Typed client](/guides/frontend/typed-client/).

## `verdin import strapi`

```text title="Terminal"
verdin import strapi <PATH> [--schema-only] [--force]
```

Imports a Strapi v4 or v5 project from an export made with `strapi export --no-encrypt`: a
`.tar.gz`, a `.tar` or an unpacked directory. It writes the content types and components
as schema files, then imports entries, locales, media, relations and folders.

| Argument or option | Description |
| --- | --- |
| `<PATH>` | The export file or directory. |
| `--schema-only` | Only write the schema files. |
| `--force` | Overwrite existing schema files, and import into content types that already have entries. |

It prints what it wrote and imported, with warnings for what it could not carry over, and
writes `strapi-id-map.json` in the project root: the Strapi ids and their new Verdin
`documentId`s and file ids, for fixing links in your frontend.

See [Migrate from Strapi](/migrate/from-strapi/).

## `verdin import verdin`

```text title="Terminal"
verdin import verdin <PATH> [--force]
```

Imports an archive written by `verdin export`: schema files, locales, media and entries.

| Argument or option | Description |
| --- | --- |
| `<PATH>` | The `.tar.gz` file. |
| `--force` | Overwrite schema files that differ, and import into content types that already have entries. |

## `verdin export`

```text title="Terminal"
verdin export <OUTPUT> [--no-media]
```

Writes the project's schema, content and media to a `.tar.gz` archive: a backup, or a way
to move a project to another instance with `verdin import verdin`. The archive holds
every version of every entry (drafts, published versions, locales) with its relations.
Admin accounts, API tokens and settings are not included.

| Argument or option | Description |
| --- | --- |
| `<OUTPUT>` | The archive to write. |
| `--no-media` | Leave the media library out: files, folders and the entries' links to them. |

```text title="Terminal"
$ verdin export backup.tar.gz
exported to backup.tar.gz: 42 documents (57 versions), 18 files, 3 folders, 2 locales
```

See [Backups](/deploy/backups/).

## `verdin healthcheck`

```text title="Terminal"
verdin healthcheck [--port <PORT>]
```

Asks `GET /_health` of the server on this machine (`127.0.0.1`, the `[server].port` of the
configuration) and exits with status 0 when it answers `200`, 1 otherwise, printing why.
It needs no shell, `curl` or HTTP client, so the Docker image uses it as its
`HEALTHCHECK`; use it the same way in Compose or any supervisor that runs a command.

| Option | Description |
| --- | --- |
| `--port <PORT>` | Check this port instead of `[server].port`. |

```text title="Terminal"
$ verdin healthcheck
ok
```

See [Monitoring](/deploy/monitoring/).

## `verdin secrets`

```text title="Terminal"
verdin secrets
```

Prints a fresh `VERDIN_ADMIN_JWT_SECRET` and `VERDIN_TOKEN_PEPPER`, ready for a `.env`
file or your platform's secret store. It reads no project.

Changing `VERDIN_ADMIN_JWT_SECRET` signs every admin out. Changing `VERDIN_TOKEN_PEPPER`
invalidates stored tokens (API tokens among them), so keep it once in use.

## `verdin version`

```text title="Terminal"
verdin version
```

Prints `verdin` and the version, like `verdin --version`.
