---
title: "Components and dynamic zones"
description: "Reusable field groups and mixed block lists, why Verdin stores them as JSON on the document, and what that means for relations, media, filtering and populate."
sidebar:
  order: 2
---

Components let you reuse a group of fields across content types, and dynamic zones let
editors build a page from a list of blocks. This page explains how both are modeled and
stored, and how that shapes reading, writing and filtering them. The schema format itself
is in [Content model](/concepts/content-model/).

## Components

A component is a group of fields with its own file under `schema/components/<category>/`.
The blog example's `shared.seo` holds a meta title and description:

```json title="schema/components/shared/seo.json"
{
  "displayName": "SEO",
  "attributes": {
    "metaTitle": { "type": "string", "maxLength": 60 },
    "metaDescription": { "type": "text", "maxLength": 160 }
  }
}
```

A content type uses it through a `component` attribute. `repeatable: true` makes it a list,
optionally bounded with `min` and `max` items:

```json
"seo": { "type": "component", "component": "shared.seo" },
"links": { "type": "component", "component": "shared.link", "repeatable": true, "max": 10 }
```

Components can contain other components. A component cannot contain itself, directly or
through others; the schema check rejects such cycles.

## Dynamic zones

A dynamic zone is a list whose items can be any of the components it names. The blog's
article body mixes heroes and quotes:

```json
"blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"], "max": 20 }
```

Each item says which component it is in `__component`. `min` and `max` bound the number of
items. Dynamic zones belong to content types only: a component cannot contain one.

## Stored as JSON

Verdin stores a component or dynamic zone value in one JSON column of the document's row
(`jsonb` on PostgreSQL, `json` on MySQL and MariaDB, text on SQLite):

```json
// the "seo" column
{ "id": 1, "metaTitle": "Rust for CMS authors", "metaDescription": "…" }

// the "blocks" column
[
  { "__component": "blocks.hero", "id": 1, "title": "Hello", "subtitle": "…" },
  { "__component": "blocks.quote", "id": 2, "text": "…", "author": "Ferris" }
]
```

Strapi keeps each component in its own table, joined through polymorphic link tables.
Storing the value with the document instead means:

- Reading a document with its components needs no joins, however deep they nest.
- Publishing, discarding a draft and [content history](/guides/content/content-history/)
  copy the value as it is.
- Adding a field to a component changes no table: the migration is empty.
- Filtering on component fields uses each database's JSON functions, and some filters are
  not available (see [Filtering](#filtering)).

Every item carries an `id`, a positive integer unique within the attribute's value. Verdin
assigns one to new items; send the `id` back when you update a list to keep items stable.

## Relations and media inside components

A component can hold relations and media, stored in the JSON itself: `documentId`s for
relations and file ids for media.

- Relations inside components must be `oneWay` or `manyWay`: they point at their targets and
  have no inverse side. See [Relations](/concepts/relations/#relations-inside-components).
- Every reference is checked on write: the target document or file must exist, and files
  must match the field's `allowedTypes`.
- When the component is populated, references are resolved with batched queries, in the
  same status and locale as the document. A target that was deleted, or that has no version
  in the one being read, is left out.
- Polymorphic relations (`morphToOne`, `morphToMany`) and `password` fields cannot be inside
  components.

## Reading

Components and dynamic zones are returned only when you populate them, as in Strapi:

```http
GET /api/articles?populate[0]=seo&populate[1]=blocks
GET /api/articles?populate=*
```

A populated component comes back whole, nested components and resolved relations and media
included. Strapi needs a `populate` level for each nested component; Verdin accepts those
nested options for compatibility and ignores them. Dynamic zone items come back in their
stored order, each with its `__component`.

In GraphQL, a component is an object type named after its UID (`ComponentSharedSeo`) and a
dynamic zone is a union (`ArticleBlocksDynamicZone`) that you query with fragments. See
[GraphQL API](/api/graphql/).

## Writing

Send the whole value of the attribute. It replaces what was stored:

```json
{
  "data": {
    "seo": { "metaTitle": "Rust for CMS authors" },
    "blocks": [
      { "__component": "blocks.hero", "title": "Hello" },
      { "__component": "blocks.quote", "text": "Fast and small.", "author": "Ferris" }
    ]
  }
}
```

The value is validated against the component's schema on every write: unknown keys, wrong
types and a `__component` the dynamic zone does not allow are errors with paths such as
`["blocks", 1, "text"]`. `required` fields inside components are checked when the document
is published, like top-level ones.

## Filtering

| What | Example | Notes |
| --- | --- | --- |
| Fields of a component | `filters[seo][metaTitle][$containsi]=rust` | Scalar fields, nested components included. |
| Fields of a repeatable component | `filters[links][url][$contains]=github` | Matches when some item matches. |
| Dynamic zones | `filters[blocks][__component][$eq]=blocks.quote` | Only by `__component`: items of different components have different fields. |

You cannot sort by component fields, and `json` fields inside components cannot be
filtered. See [REST API](/api/rest/#filters) for the operators.
