---
title: Storage
description: How Verdin lays content out in the database, from table names and system columns to draft and published rows, relation links, component JSON and platform tables.
sidebar:
  order: 2
---

This page describes the tables Verdin derives from your schema and how each kind of attribute is stored. Read it before changing anything in `crates/verdin-migrate/src/derive.rs` or the Document Service, or when you need to query the database directly. For what each attribute type accepts, see [attribute types](/reference/attribute-types/).

You never write these tables by hand: the [migration engine](/internals/migrations/) creates and evolves them from the schema.

## Naming conventions

| Object | Name |
|---|---|
| Content type table | `collectionName`, which defaults to `pluralName` with dashes turned into underscores (`blog-posts` → `blog_posts`) |
| Column | The attribute name in snake case (`metaTitle` → `meta_title`) |
| Relation links | `{table}_{column}_lnk` |
| Polymorphic relation links | `{table}_{column}_mph` |
| Media links | `{table}_{column}_mda` |
| Index | `{table}_{part}_uq` for unique indexes, `{table}_{part}_idx` for others |
| Platform table | `vd_` prefix (`vd_admin_users`, `vd_schema_snapshots`…) |

Rules the schema validator enforces (`crates/verdin-schema/src/naming.rs` and `validate.rs`):

- A `collectionName` matches `^[a-z][a-z0-9_]*$`, is at most 50 characters, and cannot start with `vd_`.
- `singularName` and `pluralName` are kebab case (`^[a-z][a-z0-9-]*$`, no leading, trailing or doubled dashes). `upload`, `uploads`, `auth`, `users` and `connect` are reserved because the content API uses those routes.
- Attribute names start with a letter and continue with letters, digits or underscores (Strapi's rule), and are at most 50 characters.
- On content types, `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`, `updatedAt`, `createdBy` and `updatedBy` are reserved, and so is any name whose snake case collides with them. On components, `id` is reserved.
- Generated identifiers are capped at 60 characters (PostgreSQL allows 63, MySQL 64). A longer name is cut and given an 8-character hash of the full name, so distinct long names stay distinct and the result is deterministic.

Every identifier is quoted in generated SQL, so SQL reserved words are valid attribute names.

## System columns

Every content type table starts with these columns:

```sql
id                 BIGINT       primary key, auto-increment
document_id        CHAR(26)     NOT NULL           -- ULID, shared by every version of a document
locale             VARCHAR(16)  NOT NULL DEFAULT '' -- '' for types that are not localized
publication_state  SMALLINT     NOT NULL           -- 0 = draft, 1 = published
published_at       <datetime>   NULL
created_at         <datetime>   NOT NULL
updated_at         <datetime>   NOT NULL
created_by_id      BIGINT       NULL               -- vd_admin_users.id
updated_by_id      BIGINT       NULL
UNIQUE (document_id, locale, publication_state)
INDEX  (publication_state, locale)
```

- `document_id` is a lowercase ULID generated on create. It stays the same across the draft, the published version and every locale.
- Types that are not localized use `locale = ''` rather than `NULL`, because NULLs never collide in unique indexes on any engine, which would break the `(document_id, locale, publication_state)` constraint.
- The state column is `publication_state`, not `state`, because `state` is a common attribute name.

Attribute columns follow, one per scalar attribute. **Every attribute column is nullable.** As in Strapi v5, drafts may be incomplete, so `required` is checked when a version is published (or on every write to types without draft and publish), not by the database. That also makes adding a required attribute a safe migration.

`unique` attributes, and every `uid`, get a unique index on `(column, locale, publication_state)`. A draft and its published version can share a value, two published documents cannot, and the database enforces it without races. A violation is reported as a `ValidationError` on that field.

## Draft and publish

Verdin follows Strapi v5's model. See [draft and publish](/concepts/draft-and-publish/) for the user view; this is what happens in the table.

- A document has at most one draft row (`publication_state = 0`) and one published row (`publication_state = 1`) per locale.
- Writes from the admin panel target the draft row.
- **Publish** checks `required` attributes and validation rules on the draft, then copies the draft's attribute values onto the published row (updating it, or inserting it the first time), in one transaction. The draft's relation and media links are copied with it.
- **Unpublish** deletes the published row. Its links go with it through `ON DELETE CASCADE`.
- **Discard draft** overwrites the draft with the published row's values and links.
- Content types without draft and publish only ever have a published row.
- For localized types, attributes that are not localized are shared: publishing one locale copies them to the other locales' published rows.

## Relations: linked by document id

**This is the main difference from Strapi's storage.** Strapi links rows by row id and has to rewrite links when you publish. Verdin stores a relation as *source row → target document*:

```sql
-- articles_category_lnk
id                  BIGINT   primary key, auto-increment
source_id           BIGINT   NOT NULL REFERENCES articles(id) ON DELETE CASCADE
target_document_id  CHAR(26) NOT NULL
position            DOUBLE   NOT NULL   -- 1..n, rewritten on every write
UNIQUE (source_id, target_document_id)
UNIQUE (source_id)                      -- to-one kinds only
INDEX  (target_document_id)
```

- The target row is chosen at read time, in the version being read: a published article sees published categories, a draft sees drafts. If a category is unpublished, it disappears from published articles without any link being touched.
- Publishing copies only the source row's own links.
- Only the **owning** side (the attribute with `inversedBy`, or a one-way relation) has a link table. The inverse side (`mappedBy`) reads the same table in reverse, and it is read-only: writing it is a validation error that names the owning attribute.
- "At most one target" (`oneToOne`, `manyToOne`, `oneWay`) is the unique index on `source_id`. "A target belongs to one source document" (`oneToOne`, `oneToMany`) cannot be an index, because a draft and its published version legitimately share targets. The Document Service enforces it by *moving* the target: linking it removes the links other documents hold to it in the same state, which is Strapi's behaviour.
- There is no foreign key on `target_document_id`, because `document_id` is not unique in the target table. The Document Service rejects links to documents that do not exist and, when the last version of a document is deleted, removes the links that point at it in the same transaction.
- Link rows keep an `id` primary key, so link tables look like every other table to the migration engine and to SQLite table rebuilds.
- Renaming a table renames its link tables with it. Migrations run with SQLite's `foreign_keys` off, so rebuilding a table does not cascade into its link tables.

**Polymorphic relations** (`morphToOne`, `morphToMany`) link documents of any content type. Their links live in `{table}_{column}_mph` with `source_id`, `target_type` (the target's uid), `target_document_id` and `position`, a unique `(source_id, target_type, target_document_id)`, and for `morphToOne` a unique `source_id`. The inverse sides (`morphOne`, `morphMany`) have no table: they read the owner's links that point at them, and they are read-only. Deleting a document removes the polymorphic links to it. See [relations](/concepts/relations/) for what you can and cannot do with them.

## Components and dynamic zones: a JSON column

A component attribute or a dynamic zone is **one JSON column** on the document row (`jsonb` on PostgreSQL, `json` on MySQL and MariaDB, `text` on SQLite). Strapi stores each component in its own table with polymorphic join tables; a column avoids those joins and makes publish and history a plain copy.

```json
// "seo" column (a single component)
{ "id": 1, "metaTitle": "…", "metaDescription": "…" }

// "blocks" column (a dynamic zone)
[
  { "id": 1, "__component": "blocks.hero", "title": "…" },
  { "id": 2, "__component": "blocks.quote", "text": "…", "author": "…" }
]
```

- Every component item has an integer `id`, unique within its attribute. New items get the next free number.
- Data is validated against the component schema on every write.
- Publish and discard copy the JSON as is.
- **Relations and media inside components** are stored in the JSON itself: `documentId`s for relations (only `oneWay` and `manyWay` are allowed there) and file ids for media. They are checked on write and resolved with batched queries when the component is populated. Polymorphic relations and `password` attributes cannot be inside components.
- **Filtering** needs dialect-specific JSON functions. Scalar fields of single components are read through a JSON path (`#>>` on PostgreSQL, `JSON_VALUE` on MySQL and MariaDB, `json_extract` on SQLite). Repeatable components use `EXISTS` over the array items (`jsonb_array_elements`, `JSON_TABLE`, `json_each`). Dynamic zones can be filtered by `__component` only, because their items have different fields.

See [components and dynamic zones](/concepts/components-and-dynamic-zones/) for the modelling side.

## Platform tables

The platform tables are part of every derived model, so the migration engine creates and evolves them exactly like content tables; they show up as safe steps in `verdin migrate plan`. They are defined in `crates/verdin-migrate/src/system.rs`.

| Area | Tables |
|---|---|
| Migrations | `vd_schema_snapshots`, `vd_migrations_journal` (owned by the migration engine, created on first use) |
| Admins | `vd_admin_users`, `vd_admin_roles`, `vd_admin_user_roles`, `vd_admin_permissions`, `vd_sessions` (refresh tokens), `vd_admin_tokens` (invitation and reset links), `vd_admin_two_factor`, `vd_admin_passkeys`, `vd_spent_challenges` |
| Content API access | `vd_api_tokens`, `vd_api_token_permissions`, `vd_public_permissions` |
| End users | `vd_users`, `vd_user_roles`, `vd_user_role_permissions`, `vd_end_user_sessions` |
| Instance | `vd_settings` (feature switches, edit-view layouts, one-off upgrade markers), `vd_locales`, `vd_cluster_events` (the shared event bus, see [Several instances](/deploy/scaling/)) |
| Media | `vd_files`, `vd_folders` |
| Content workflow | `vd_history_versions`, `vd_releases`, `vd_release_actions`, `vd_workflows`, `vd_workflow_stages`, `vd_document_stages` |
| Collaboration | `vd_comments`, `vd_tasks`, `vd_document_views`, `vd_document_votes`, `vd_polls`, `vd_poll_votes` |
| Integrations | `vd_webhooks`, `vd_webhook_deliveries`, `vd_deploy_targets`, `vd_deployments`, `vd_plugin_kv`, `vd_audit_logs` |
| Site features | `vd_redirects`, `vd_menus`, `vd_forms`, `vd_form_submissions` |

## Media tables

Files are rows of `vd_files` in Strapi's shape (`name`, `alternative_text`, `caption`, `width`, `height`, `formats`, `hash`, `ext`, `mime`, `size`, `url`, `provider`…), plus `focal_point`, `folder_id` and `folder_path`. Folders (`vd_folders`) keep Strapi's `path` of `path_id`s, such as `/1/4`.

A media attribute is a link table `{table}_{column}_mda` with `source_id` (the content row), `file_id` (a `vd_files` row) and `position`. It has a unique `(source_id, file_id)` and, when the attribute is not `multiple`, a unique `source_id`. Both columns are foreign keys with `ON DELETE CASCADE`, so deleting a file or a row removes its links. Media links follow the same draft and publish rules as relation links: each version owns its links and publishing copies them.

How uploads, formats and storage providers work is in [media](/concepts/media/).
