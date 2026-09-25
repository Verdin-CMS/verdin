# Importing a Strapi project

`verdin import strapi` brings a Strapi v4 or v5 project into Verdin. It reads a Strapi export file and imports:

- content types and components (written as schema files)
- entries, including drafts, published versions and locales
- relations
- the media library: files, formats and folders
- locales

## 1. Export from Strapi

```sh
# in the Strapi project
npx strapi export --no-encrypt -f my-export      # my-export.tar.gz
```

Encrypted exports (`.tar.gz.enc`) are not read. Export again with `--no-encrypt`. `--no-compress` (`.tar`) and `--format dir` exports work too.

## 2. Import into Verdin

Start from a new project, or one that has no schema files with the same names:

```sh
verdin new my-site && cd my-site
verdin import strapi ../my-export.tar.gz
verdin dev
```

The command runs these steps in order:

1. Writes one schema file per `api::` content type and per component to `schema/`. Nothing is written if the converted schema does not validate.
2. Migrates the database.
3. Imports locales, folders, files, entries, relations, and the media attached to entries and components.
4. Prints a summary and any warnings, and writes `strapi-id-map.json` in the project directory.

`strapi-id-map.json` maps each Strapi document to its new Verdin id, and each file id to its new id. Verdin ids have 26 characters and Strapi's have 24, so every document gets a new id.

`--schema-only` stops after writing the schema files. `--force` overwrites existing schema files and imports into content types that already have entries.

## What is converted

| Strapi | Verdin |
|---|---|
| `api::…` content types, components | Schema files, keeping `collectionName`, draft & publish and i18n options |
| Relations between `api::` types | The same relations |
| Relations inside components | `oneWay` / `manyWay` references |
| Media fields (also in components) | Media fields |
| v5 rows (draft and published) | Draft and published versions |
| v4 rows | A draft, plus a published version when `publishedAt` is set; `localizations` become locales of one document |
| `plugin::i18n.locale` | Locales (Strapi's default stays the default) |
| `plugin::upload.file` / `folder` | Media library files (with their formats) and folders |

## What is not converted

Each of these is reported as a warning:

- relations to admin users, end users (`plugin::users-permissions`) or other plugins
- morph relations
- `password` fields
- custom fields, which are imported as their underlying type
- `unique` on text fields
- relation halves whose `inversedBy` / `mappedBy` does not match the other side

Admin users, roles, API tokens, webhooks, end users, releases and review workflows are not imported.
