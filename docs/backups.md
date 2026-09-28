# Backups and moving a project

`verdin export` writes a project's schema, content and media to one `.tar.gz`, and
`verdin import verdin` restores it, into the same project or another instance.

```sh
verdin export backup-2026-09-28.tar.gz            # schema, locales, media and entries
verdin export content-only.tar.gz --no-media      # without media files
verdin import verdin backup-2026-09-28.tar.gz     # into this project
```

## What is included

- **Schema files**, copied as they are.
- **Locales.** An empty project takes them all, the default one included. A project
  that has locales only gets the missing ones.
- **Media folders and files**, with their responsive formats. Files keep their
  `documentId`; their numeric ids change.
- **Every version of every entry**: drafts, published versions and all locales, with
  their dates, relations (by `documentId`) and media. Private fields and password
  hashes are included. Relations and media inside components and dynamic zones are
  kept too.

Admin users, roles, API tokens, webhooks, feature settings, review workflows and
releases are **not** included.

Treat an export like a database dump: it contains private fields and password hashes.

## Importing

The import first writes the schema files and migrates the database with safe steps
only. Schema files that already exist and differ make it stop, unless you pass
`--force`. Content types that already have entries also make it stop, unless you pass
`--force`, in which case the entries are added next to the existing ones. Imported
documents keep their `documentId`, so importing into a project that already has the
same documents fails.

The import does not trigger webhooks or plugin hooks, and it does not write history.

## Format

A gzipped tar archive:

| Path | |
|---|---|
| `manifest.json` | `format: "verdin-export"`, format version, Verdin version, versions per content type |
| `schema/…` | The schema files |
| `locales.json` | `{ default, locales: [{ code, name }] }` |
| `folders.json`, `files.jsonl` | Media folders and files, one JSON object per line |
| `assets/{hash}{ext}` | The stored objects of the files and their formats |
| `entries/{uid}.jsonl` | One version per line: `documentId`, `locale`, `published`, dates, `data`, `relations`, `media` |

To import a Strapi project, see [importing from Strapi](importing-from-strapi.md).
