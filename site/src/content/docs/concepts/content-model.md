---
title: "Content model"
description: "How Verdin describes your content: collection and single types, attributes, schema files in Strapi's format, and validation rules."
sidebar:
  order: 1
---

The content model is the set of content types and components your project defines. Verdin
derives everything else from it: the database tables, the REST and GraphQL APIs, the
OpenAPI document, validation and the admin panel's forms. This page explains the pieces and
the rules that apply to them.

## Content types

A content type describes one kind of document, such as an article or a homepage. It has a
`kind`:

| Kind | Holds | REST routes (blog example) |
| --- | --- | --- |
| `collectionType` | Any number of documents | `/api/articles`, `/api/articles/{documentId}` |
| `singleType` | At most one document | `/api/homepage` |

Collection types are served at their `pluralName`, single types at their `singularName`.
The first `PUT` to a single type creates its document. See the [REST API](/api/rest/) for
every route.

Each content type has a UID, `api::<singularName>` (`api::article`). Strapi writes the
same UID as `api::article.article`; Verdin accepts that form in schema files and in the
importer, and normalizes it to `api::article`.

Every document has system fields that you do not declare: `id`, `documentId` (a 26-character
lowercase ULID, stable across drafts, published versions and locales), `createdAt`,
`updatedAt`, `publishedAt`, and `locale` on [localized types](/concepts/internationalization/).

## Schema files

Content types and components are JSON files in the `schema/` directory of your project
(`[schema].path` in `verdin.toml`). You version them in git like code.

```
schema/
├── content-types/
│   ├── article.json
│   ├── category.json
│   ├── tag.json
│   └── homepage.json
└── components/
    ├── blocks/
    │   ├── hero.json
    │   └── quote.json
    └── shared/
        └── seo.json
```

The format is Strapi's `schema.json`, so most Strapi schemas load unchanged. This is the
article type of the [blog example](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog):

```json title="schema/content-types/article.json"
{
  "kind": "collectionType",
  "singularName": "article",
  "pluralName": "articles",
  "displayName": "Article",
  "options": { "draftAndPublish": true },
  "attributes": {
    "title": { "type": "string", "required": true, "maxLength": 200 },
    "slug": { "type": "uid", "targetField": "title", "required": true },
    "excerpt": { "type": "text", "maxLength": 500 },
    "body": { "type": "richtext" },
    "readingTime": { "type": "integer", "min": 0 },
    "featured": { "type": "boolean", "default": false },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "tags": { "type": "relation", "relation": "manyToMany", "target": "tag" },
    "seo": { "type": "component", "component": "shared.seo" },
    "blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"] }
  }
}
```

| Key | Required | Description |
| --- | --- | --- |
| `kind` | yes | `collectionType` or `singleType`. |
| `singularName` | yes | Kebab-case. Must match the file name (`article.json`). |
| `pluralName` | yes | Kebab-case, different from `singularName`. |
| `displayName` | yes | The name the admin panel shows. |
| `description` | no | Shown in the admin panel. |
| `collectionName` | no | Table name. Defaults to the snake_case `pluralName`. |
| `options.draftAndPublish` | no | Keep a draft and a published version of each document. Defaults to `false`. See [Draft and publish](/concepts/draft-and-publish/). |
| `pluginOptions.i18n.localized` | no | One version per locale. Defaults to `false`. See [Internationalization](/concepts/internationalization/). |
| `attributes` | no | The fields, in the order the API returns them. |
| `validations` | no | Cross-field rules; see [below](#cross-field-validations). |

Schemas are strict: an unknown key, an option a type does not support, or a reference to a
missing type or component is an error that names the file and the path, and the server does
not start. Run `verdin schema check` to validate the files without starting it.

Some names are taken:

- Attribute names start with a letter, then letters, digits and underscores, at most 50
  characters. They become snake_case columns (`metaTitle` → `meta_title`).
- `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`,
  `updatedAt`, `createdBy` and `updatedBy` are reserved on content types, and `id` inside
  components.
- `upload`, `uploads`, `auth`, `users` and `connect` cannot be a `singularName` or
  `pluralName`: those routes belong to the API.
- A content type has at most 60 `string`, `email`, `uid` and `enumeration` attributes, which
  keeps rows within MySQL's row size limit. Use `text` for some of them.

You edit the files in the admin's **Content-type builder**, available while the server runs
with `verdin dev`, or by hand. Either way, a change becomes a
[schema migration](/concepts/schema-migrations/). The editor's layout (field order, widths,
labels) is not part of the schema: admins configure it in the panel, and it is stored in the
database.

## Components

A component is a reusable group of fields, such as `shared.seo` (a meta title and a meta
description). Its UID is `<category>.<name>`, taken from its path:
`schema/components/shared/seo.json` is `shared.seo`. A component file has `displayName`,
optional `description` and `icon`, and `attributes`.

A dynamic zone is a list that mixes several components, such as an article body made of
hero and quote blocks. Both are stored inside the document as JSON; see
[Components and dynamic zones](/concepts/components-and-dynamic-zones/).

## Attributes

Each attribute has a `type` and options that depend on it. The full list of types, their
options and their column types per database is in the
[attribute types reference](/reference/attribute-types/).

| Category | Types |
| --- | --- |
| Text | `string`, `text`, `richtext` (Markdown), `blocks` (Strapi's structured rich text), `email`, `uid`, `password`, `enumeration` |
| Numbers | `integer`, `biginteger`, `float`, `decimal` |
| Dates | `date`, `time`, `datetime` |
| Other scalars | `boolean`, `json` |
| Links | `relation` (see [Relations](/concepts/relations/)), `media` (see [Media](/concepts/media/)) |
| Structure | `component`, `dynamiczone` |

Common options:

| Option | Effect |
| --- | --- |
| `required` | The value must be set when a version is published (or on every write, for types without draft and publish). Drafts may be incomplete. |
| `private` | Never returned, filtered, sorted or populated by the content API. `password` attributes are always private. |
| `default` | Value used when a new document leaves the field out. Checked against the attribute's own rules. |
| `unique` | No two documents may share the value, per locale and version. Available on `string`, `email`, number, date and time types; `uid` is always unique. |
| `configurable` | `false` locks the attribute in the content-type builder: it cannot be edited, renamed or deleted there. |
| `pluginOptions.i18n.localized` | `false` shares the value across locales. |

Every attribute column is nullable in the database. As in Strapi v5, `required` is enforced
by Verdin when publishing, not by a `NOT NULL` constraint, so adding a required attribute to
a type that already has rows is a safe change.

## Validation

Every write is checked against the schema before anything reaches the database:

- **Types and constraints**, on every write: value types, `minLength`/`maxLength`, `min`/`max`,
  `regex`, `enum` values, the number of items in repeatable components and dynamic zones,
  the component types a dynamic zone allows, and the file types a media field accepts.
  Unknown keys and system fields in the input are errors.
- **Required fields and cross-field rules**, when a version is published, and on every write
  to types without draft and publish. They also apply inside components and dynamic zones.
- **Uniqueness**, by unique indexes in the database, so two concurrent writes cannot both
  succeed.

A failed check answers `400` with a `ValidationError` whose `details.errors` lists each
problem with its path, such as `["seo", "metaTitle"]` or `["blocks", 2, "text"]`. See
[Errors](/api/rest/#errors).

### Cross-field validations

A content type can declare rules that compare its own fields, written in
[JSON Logic](https://jsonlogic.com). This event type requires the end date to follow the
start date, and caps sold tickets at the number of seats:

```json title="schema/content-types/event.json"
{
  "kind": "collectionType",
  "singularName": "event",
  "pluralName": "events",
  "displayName": "Event",
  "attributes": {
    "startDate": { "type": "date", "required": true },
    "endDate": { "type": "date" },
    "seats": { "type": "integer", "min": 0 },
    "sold": { "type": "integer", "min": 0 }
  },
  "validations": [
    {
      "rule": { "or": [{ "!": { "var": "endDate" } }, { "<=": [{ "var": "startDate" }, { "var": "endDate" }] }] },
      "message": "must be after the start date",
      "field": "endDate"
    },
    { "rule": { "<=": [{ "var": "sold" }, { "var": "seats" }] }, "message": "more tickets sold than seats" }
  ]
}
```

- A rule that does not hold is a validation error with `message`, at `field` when given, or
  at the document (`path: []`).
- Rules run when `required` does: on publish, and on every write to types without draft and
  publish. Drafts may break them.
- `var` reads the document's own fields, with dotted paths into components. Relations and
  media are not available to rules.
- Comparisons are numeric when both sides are numbers and textual when both are strings, so
  ISO dates, times and datetimes compare correctly. An empty field is `null`: guard optional
  fields, as the first rule does.
- Allowed operators: `var`, `==`, `!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`, `and`,
  `or`, `in`, `if`, `?:`, `+`, `-`, `*`, `/`, `%`, `min`, `max`, `cat`. An unknown operator,
  an unknown `field` or an empty `message` is a schema error.

The server checks the rules; the admin panel shows their messages on the fields they name
when a publish fails. Strapi has no equivalent. Strapi's conditional fields (`conditions`)
are accepted in schema files and kept, but not applied yet.
