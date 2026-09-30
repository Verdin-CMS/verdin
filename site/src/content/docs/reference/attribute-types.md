---
title: Attribute types reference
description: Every attribute type of a Verdin schema file, with its options, validations, database storage and API representation.
sidebar:
  order: 4
  label: Attribute types
---

<!-- Written from crates/verdin-schema (convert.rs, validate.rs, model.rs),
crates/verdin-migrate/src/derive.rs and sql.rs (storage), and crates/verdin-content
(input.rs, output.rs, blocks.rs) (API). -->

Attributes are the fields of a content type or component, declared under `attributes` in
its schema file. This page lists every `type`, the options it accepts, how Verdin
validates and stores it, and how it looks in the API. The format is Strapi v5's; the
differences are listed [at the end](#differences-from-strapi).

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
    "readingTime": { "type": "integer", "min": 0 },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "seo": { "type": "component", "component": "shared.seo" }
  }
}
```

Schema files are strict: an unknown key, or an option the type does not take, is an error
that `verdin schema check` reports with its path (`attributes.title.maxLength`).

## Options every attribute takes

| Option | Default | Description |
| --- | --- | --- |
| `type` | required | One of the types below. |
| `required` | `false` | A value must be present. Checked when an entry is published (drafts may be incomplete), and on every write of a type without draft and publish. Applies inside components and dynamic zones too. |
| `private` | `false` | Never returned by the content API, and not usable in `filters` or `sort`. `password` attributes are always private. |
| `configurable` | `true` | Strapi's flag for the admin's builder; kept as written. |
| `pluginOptions.i18n.localized` | `true` | In a localized content type, `false` shares the value across locales instead of one value per locale. |
| `customField` | unset | `plugin::<plugin>.<field>` (or `global::<field>`): the admin edits the attribute with a plugin's custom field. The `type` is how the value is stored. See [Plugins](/extending/plugins/). |
| `conditions` | unset | Strapi's conditional fields (`{ "visible": <JSON Logic> }`). The editor hides the field while the rule is false, and the server does not require a hidden field. |
| `default` | unset | Value of new entries when the write leaves the attribute out. Must be valid for the type. Not every type takes one (see each type). |

Attribute names start with a letter, then letters, digits and `_`, at most 50 characters.
On content types, `id`, `documentId`, `locale`, `publicationState`, `publishedAt`,
`createdAt`, `updatedAt`, `createdBy` and `updatedBy` are reserved; on components, `id`.
Two names that map to the same column (`metaTitle` and `meta_title`) are an error.

### Where values are stored

Each attribute of a content type is a column of the type's table (`collectionName`, or
the plural name), named in `snake_case`. Relations and media live in link tables instead.
A draft and its published version are two rows, one per locale in localized types.

Column types per database:

| Column | PostgreSQL | MySQL and MariaDB | SQLite |
| --- | --- | --- | --- |
| varchar | `varchar(255)` | `varchar(255)` | `text` |
| text | `text` | `longtext` | `text` |
| integer | `integer` | `int` | `integer` |
| bigint | `bigint` | `bigint` | `integer` |
| double | `double precision` | `double` | `real` |
| decimal | `numeric(p,s)` | `decimal(p,s)` | `text` (exact) |
| boolean | `boolean` | `tinyint(1)` | `integer` |
| date | `date` | `date` | `text` |
| time | `time(3)` | `time(3)` | `text` |
| datetime | `timestamptz(3)` | `datetime(3)` | `text` |
| json | `jsonb` | `json` | `text` |

A content type may have at most 60 `string`, `email`, `uid` and `enumeration` attributes
(MySQL's row size limit); use `text` for more.

### `unique`

Types that take `unique: true` get a unique index on `(column, locale, publication_state)`:
two published entries, or two drafts, in the same locale cannot share a value, while a
draft and its own published version can. A write that breaks it fails with a validation
error on the attribute. Inside components, `unique` is accepted but not enforced
(component values are stored as JSON).

## Text

### `string`

A single line of text.

| Option | Description |
| --- | --- |
| `minLength`, `maxLength` | Length bounds in characters. `maxLength` is at most 255. |
| `regex` | A pattern the value must match. JavaScript-like syntax, look-around and backreferences included. |
| `unique` | See [`unique`](#unique). |
| `default` | A string within the bounds that matches `regex`. |

Stored as `varchar(255)`. API: a string.

### `text`

Longer plain text (a textarea in the admin).

| Option | Description |
| --- | --- |
| `minLength`, `maxLength` | Length bounds, no upper limit. |
| `default` | A string within the bounds. |

Stored as `text` (`longtext` on MySQL). API: a string.

### `richtext`

Markdown text. Same options, storage and API as `text`; the admin edits it with the
Markdown editor.

### `blocks`

Rich text as Strapi's blocks JSON: a list of `paragraph`, `heading` (`level` 1 to 6),
`list` (`format` `ordered` or `unordered`, with `list-item` children, nested up to 8
levels), `quote`, `code` (optional `language`) and `image` blocks. Inline children are
`text` nodes, with the marks `bold`, `italic`, `underline`, `strikethrough` and `code`,
and `link` nodes. At most 10,000 blocks.

No options, no `default`. Stored as JSON. API: the list of blocks, as written.

```json
[
  { "type": "heading", "level": 2, "children": [{ "type": "text", "text": "Hello" }] },
  { "type": "paragraph", "children": [{ "type": "text", "text": "bold", "bold": true }] }
]
```

### `email`

An email address (`name@domain.tld`, no spaces).

| Option | Description |
| --- | --- |
| `minLength`, `maxLength` | Length bounds; `maxLength` at most 255. |
| `unique` | See [`unique`](#unique). |
| `default` | An email address. |

Stored as `varchar(255)`. API: a string.

### `password`

A secret, hashed on write with Argon2id.

| Option | Description |
| --- | --- |
| `minLength`, `maxLength` | Length bounds of the password as sent. |

No `default`. Always private: never returned, filtered or sorted. Not allowed inside
components. Stored as `varchar(255)` (the hash). Imports keep existing bcrypt and Argon2
hashes as they are, so imported accounts can still sign in.

### `uid`

An identifier for URLs, like a slug. The admin generates it from `targetField`.

| Option | Description |
| --- | --- |
| `targetField` | A `string` or `text` attribute of the same type to generate the value from. |
| `minLength`, `maxLength` | Length bounds; `maxLength` at most 255. |
| `regex` | The pattern values must match; without it, `^[A-Za-z0-9\-_.~]*$`. |
| `default` | A valid value. |

Always unique (see [`unique`](#unique)). Stored as `varchar(255)`. API: a string.

### `enumeration`

One value out of a fixed list.

| Option | Description |
| --- | --- |
| `enum` | The values: at least one, each 1 to 255 characters, no duplicates. |
| `default` | One of the values. |

Stored as `varchar(255)`. API: a string. Writes of any other value fail.

## Numbers

### `integer`

A 32-bit integer (−2,147,483,648 to 2,147,483,647).

| Option | Description |
| --- | --- |
| `min`, `max` | Bounds (integers). |
| `unique` | See [`unique`](#unique). |
| `default` | An integer within the bounds. |

Stored as `integer`. API: a number. Writes accept numbers and integer strings.

### `biginteger`

A 64-bit integer. Same options as `integer`.

Stored as `bigint`. API: a string (`"9007199254740993"`), as in Strapi, because JavaScript
numbers lose precision beyond 2⁵³. Writes accept strings and numbers.

### `float`

A double-precision floating-point number. Same options as `integer`, with number bounds.

Stored as `double precision` (`double`, `real`). API: a number.

### `decimal`

An exact decimal number.

| Option | Default | Description |
| --- | --- | --- |
| `precision` | `10` | Total digits, 1 to 38. |
| `scale` | `2` | Digits after the decimal point, at most `precision`. |
| `min`, `max` | | Bounds. |
| `unique` | | See [`unique`](#unique). |
| `default` | | A number within the bounds. |

Values are rounded to `scale` digits (half away from zero, like the databases do), and
rejected when they have more than `precision - scale` digits before the point. Writes
accept numbers and numeric strings. Stored as `numeric(precision,scale)` (`text` on
SQLite, so nothing is rounded). API: a number, like Strapi returns it. Whole values are
integers (`25`, not `25.0`) and others are the shortest float that reads back the same
(`12.5`). With [`[api].decimal_as_string`](/reference/configuration/) the API returns an
exact string instead.

## Dates and booleans

### `boolean`

`true` or `false`. Takes `default`. Stored as `boolean` (`tinyint(1)`, `integer`). API: a
boolean.

### `date`

A calendar date, `YYYY-MM-DD`. Takes `unique` and `default`. Stored as `date`. API:
`"2026-09-29"`.

### `time`

A time of day, `HH:MM`, `HH:MM:SS` or `HH:MM:SS.mmm`. Takes `unique` and `default`. Stored
with millisecond precision. API: `"14:30:00.000"`.

### `datetime`

A point in time: an ISO 8601 timestamp with a zone (`Z` or `+02:00`). Takes `unique` and
`default`. Stored in UTC with millisecond precision. API: `"2026-09-29T12:30:00.000Z"`.

## `json`

Any JSON value. Takes `default` (any JSON). Stored as `jsonb` (`json`, `text`). API: the
value as written. In `filters`, JSON attributes only support `$null` and `$notNull`, and
they cannot be sorted on.

## Media

### `media`

Files from the media library.

| Option | Default | Description |
| --- | --- | --- |
| `multiple` | `false` | Hold a list of files instead of one. |
| `allowedTypes` | any | Kinds of files: `images`, `videos`, `audios`, `files` (anything else). |

No `default`. Stored in a link table `{table}_{attribute}_mda`, in order. Writes take file
ids: `12`, `{ "id": 12 }`, a list of them, or `null`. API: only with `populate`; a file
object (`url`, `mime`, `width`, `formats`…, as in Strapi), a list of them, or `null`. See
[Media](/concepts/media/).

## Relations

### `relation`

Links to documents of another content type.

| Option | Description |
| --- | --- |
| `relation` | `oneToOne`, `oneToMany`, `manyToOne`, `manyToMany`, `oneWay`, `manyWay`, or a polymorphic kind (below). |
| `target` | The target content type: `article`, `api::article` or `api::article.article`. |
| `inversedBy` | On the owning side of a two-way relation: the attribute of the target that mirrors it. |
| `mappedBy` | On the other side: the owning attribute of the target. |

The two sides of a two-way relation must agree: `oneToMany` mirrors `manyToOne`,
`oneToOne` and `manyToMany` mirror themselves, and the `mappedBy` side names an attribute
whose `inversedBy` points back. `oneWay` and `manyWay` have no other side.

Links are stored in `{table}_{attribute}_lnk` on the owning side (the side without
`mappedBy`), pointing at the target's `documentId`, in order. Writes take `documentId`s:

| Write | Meaning |
| --- | --- |
| `"d8f3…"`, `{ "documentId": "d8f3…" }`, a list of them | Replace the links. |
| `null` or `[]` | Remove every link. |
| `{ "set": [...] }` | Replace the links. |
| `{ "connect": [...], "disconnect": [...] }` | Add and remove links. A `connect` item may carry `position`: `{ "before": id }`, `{ "after": id }`, `{ "start": true }` or `{ "end": true }`. |

API: only with `populate`, as the related documents (at most 1,000 per entry and
relation), or `{ "count": n }` with `populate[tags][count]=true`. See
[Relations](/concepts/relations/).

Inside components, only `oneWay` and `manyWay` are allowed; the component stores the
`documentId`s.

### Polymorphic relations

`relation` also takes the polymorphic kinds, which link documents of any content type:

| `relation` | Options | Description |
| --- | --- | --- |
| `morphToOne` | none | Links one document of any type. |
| `morphToMany` | none | Links documents of any types. |
| `morphOne` | `target`, `morphBy` | Inverse side: reads the links of `target`'s `morphToOne` or `morphToMany` attribute `morphBy`. |
| `morphMany` | `target`, `morphBy` | Same, for many. |

Owners store `(type, documentId)` pairs in `{table}_{attribute}_mph`. Writes take
`{ "__type": "api::article", "documentId": "…" }` items (one, a list, `null` or
`{ "set": [...] }`). Populated items carry their type in `__type`. Not allowed inside
components.

## Components and dynamic zones

### `component`

A group of fields defined in `schema/components/<category>/<name>.json`.

| Option | Default | Description |
| --- | --- | --- |
| `component` | required | The component uid, `category.name` (`shared.seo`). |
| `repeatable` | `false` | Hold a list of items instead of one. |
| `min`, `max` | | Number of items; only with `repeatable`. |

No `default`: new items get their own attributes' defaults. Stored as JSON in the
entry's row, each item with an `id`. Writes take the item object (or a list), with `id`
to keep an existing item. API: only with `populate`, the whole item or list. In
`filters`, you can filter on a component's fields
(`filters[seo][metaTitle][$eq]=…`). See
[Components and dynamic zones](/concepts/components-and-dynamic-zones/).

### `dynamiczone`

A list of items, each one of several components.

| Option | Description |
| --- | --- |
| `components` | The allowed component uids: at least one, no duplicates. |
| `min`, `max` | Number of items. |

Each item carries `__component` with its uid. Stored as JSON in the entry's row. API:
only with `populate`, the whole list. Filter by component with
`filters[blocks][__component][$eq]=blocks.hero`. Dynamic zones cannot be nested inside
components.

## Cross-field validations

Besides per-attribute options, a content type can declare rules over several fields in
`validations`, checked whenever `required` is:

```json
"validations": [
  {
    "rule": { "<=": [{ "var": "startDate" }, { "var": "endDate" }] },
    "message": "The end date must be after the start date",
    "field": "endDate"
  }
]
```

`rule` is a JSON Logic expression over the entry that must hold. It may use `var`, `==`,
`!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`, `and`, `or`, `in`, `if`, `?:`, `+`, `-`,
`*`, `/`, `%`, `min`, `max` and `cat`. `message` is reported at `field` (an attribute of
the type) or on the entry. This is a Verdin addition; Strapi has no equivalent.

## Differences from Strapi

- **Components are stored as JSON** in the entry's row, not in component tables with join
  tables. Reads need no joins; as a consequence, `password` attributes, polymorphic
  relations and two-way relations cannot be inside components, and `unique` is not
  enforced there.
- **Populated components come whole.** `populate` on a component or dynamic zone returns
  all its fields; you cannot pick nested fields as in Strapi.
- **Strict schema files.** Unknown keys and options a type does not take are errors, where
  Strapi ignores them. In `pluginOptions`, only `i18n.localized` is read; the rest is
  ignored.
- **`string`, `email` and `uid` are capped at 255 characters**, the column size, instead
  of failing at the database.
- **`conditions`** (conditional fields) work as in Strapi 5.17: hidden fields are not required.
- **`validations`** are Verdin's own.
- The rest matches Strapi v5: the type names, their options, `biginteger` values as
  strings, relation writes with `connect`, `disconnect`, `set` and `position`, and the
  blocks format.
