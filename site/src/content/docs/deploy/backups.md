---
title: Backups
description: Back up a Verdin project with database dumps and media storage copies, or move it with verdin export and verdin import verdin.
sidebar:
  order: 9
---

A Verdin project's data lives in two places: the **database** (content, admins, roles,
tokens, settings, history, audit logs) and the **media storage** (the files of the
media library, on disk or in a bucket). The schema files are in your repository. Back up
both stores; `verdin export` adds a portable archive of the content.

| Method | Contains | Use it for |
| --- | --- | --- |
| Database dump + media copy | Everything | Disaster recovery of the same project |
| `verdin export` | Schema, locales, media, every version of every entry | Moving content to another instance or database engine; an extra, portable copy |

## Database dumps

Use your database's own tools, or your provider's automatic backups:

```sh frame="terminal"
# PostgreSQL
pg_dump --format=custom --file=verdin-$(date +%F).dump "$VERDIN_DATABASE_URL"

# MySQL / MariaDB
mysqldump --single-transaction --routines -h <host> -u <user> -p <database> > verdin-$(date +%F).sql

# SQLite: a consistent copy while the server runs
sqlite3 /data/verdin.db ".backup '/backups/verdin-$(date +%F).db'"
```

Do not copy a live SQLite file with `cp`: use `.backup` (or stop the server first).

A dump contains password hashes, API token hashes and private fields. Encrypt it and
keep it away from the servers it protects. To restore one, you also need the same
`VERDIN_TOKEN_PEPPER` and `VERDIN_ADMIN_JWT_SECRET`: without the pepper, API tokens and
admins' authenticator-app codes stop working.

## Media storage

- **Local provider**: copy the upload directory (`[upload].provider.dir`,
  `/data/uploads` in the Docker image) with your usual file backup, after the database
  dump so that no file referenced by the dump is missing.
- **S3 provider**: turn on versioning or replication on the bucket, or copy it with
  your provider's tools.

The image-transformation cache and the search index can be rebuilt and need no backup.

## `verdin export`

`verdin export` writes a project's schema, content and media to one `.tar.gz`, and
`verdin import verdin` restores it into the same project or another instance, on any
database engine.

```sh frame="terminal"
verdin export backup-2026-09-28.tar.gz            # schema, locales, media and entries
verdin export content-only.tar.gz --no-media      # without media files
verdin import verdin backup-2026-09-28.tar.gz     # into this project
```

Run them with the project's configuration (the same `verdin.toml` and environment as
the server). In a container: `docker compose exec verdin verdin export /data/backup.tar.gz`.

### What is included

- **Schema files**, as they are.
- **Locales.** An empty project takes them all, the default one included. A project
  that has locales only gets the missing ones.
- **Media folders and files**, with their responsive formats. Files keep their
  `documentId`; their numeric ids change.
- **Every version of every entry**: drafts, published versions and all locales, with
  their dates, relations (by `documentId`) and media, including relations and media
  inside components and dynamic zones. Private fields and password hashes are included.

**Not included**: admin users, roles, API tokens, webhooks, feature settings, review
workflows and releases. Recreate them on the target, or restore a database dump
instead.

:::caution
An export contains private fields and password hashes. Store it like a database dump.
:::

### Importing

1. The import writes the schema files and migrates the database with safe steps only.
2. Schema files that already exist and differ make it stop, unless you pass `--force`.
3. Content types that already have entries make it stop too, unless you pass
   `--force`; the entries are then added next to the existing ones.
4. Imported documents keep their `documentId`, so importing into a project that already
   has the same documents fails.

The import does not trigger webhooks or plugin hooks, and it does not write history.

### Archive format

A gzipped tar archive:

| Path | Contents |
| --- | --- |
| `manifest.json` | `format: "verdin-export"`, format version, Verdin version, versions per content type |
| `schema/…` | The schema files |
| `locales.json` | `{ default, locales: [{ code, name }] }` |
| `folders.json`, `files.jsonl` | Media folders and files, one JSON object per line |
| `assets/{hash}{ext}` | The stored objects of the files and their formats |
| `entries/{uid}.jsonl` | One version per line: `documentId`, `locale`, `published`, dates, `data`, `relations`, `media` |

To bring in a Strapi project instead, see [Migrating from Strapi](/migrate/from-strapi/).

## Test your restores

Restore into a scratch database now and then,
start Verdin on it with `verdin start`, and check that you can sign in and read entries
and media.
