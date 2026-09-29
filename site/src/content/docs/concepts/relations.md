---
title: "Relations"
description: "Relation kinds, how Verdin links documents by documentId, ordering, polymorphic relations, and what oneWay and manyWay mean inside components."
sidebar:
  order: 3
---

A relation links documents of two content types, such as an article and its category. This
page explains the relation kinds, how links are stored and resolved, and the rules for
writing, ordering and reading them. For the request syntax, see the
[REST API](/api/rest/#writing).

## Kinds

A relation is an attribute of `type: "relation"` with a `relation` kind and a `target`
content type:

| Kind | A document links to | A target is linked from | Inverse side |
| --- | --- | --- | --- |
| `oneWay` | one target | any number of documents | none |
| `manyWay` | many targets | any number of documents | none |
| `manyToOne` | one target | any number of documents | `oneToMany` |
| `oneToMany` | many targets | one document | `manyToOne` |
| `oneToOne` | one target | one document | `oneToOne` |
| `manyToMany` | many targets | any number of documents | `manyToMany` |

The blog example links articles to a category (with an inverse side) and to tags (without
one):

```json title="schema/content-types/article.json (excerpt)"
"category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
"tags": { "type": "relation", "relation": "manyToMany", "target": "tag" }
```

```json title="schema/content-types/category.json (excerpt)"
"articles": { "type": "relation", "relation": "oneToMany", "target": "article", "mappedBy": "category" }
```

- The side with `inversedBy` (or with neither key) is the **owning** side: it stores the
  links and is the one you write.
- The side with `mappedBy` is the **inverse** side: it reads the owner's links in reverse
  and is read-only. Writing it is a validation error that names the owning attribute.
- The two sides must agree: `mappedBy` names an attribute of the target that points back
  with `inversedBy`, with the matching inverse kind from the table.
- `oneWay` and `manyWay` never have an inverse side.

The content-type builder creates the inverse attribute on the target for you.

## Linked by document, not by row

A document has several rows: a draft and a published version, and one of each per locale.
Verdin stores a relation as a link from the source **row** to the target **document**
(its `documentId`), in a link table named `{table}_{field}_lnk`. The target row is chosen
when the relation is read:

- A published article sees the published version of its category; its draft sees the
  category's draft. Types without draft and publish have one version, which every reader
  sees.
- When the target is localized too, reads resolve it in the same locale. A target type that
  is not localized is shared by every locale.
- Unpublishing a category hides it from published articles without touching any link;
  publishing it again brings it back.
- Publishing an article copies only its own links to the published version.

Strapi links row ids instead, so it has to rewrite links whenever a draft is published.
Verdin never does, which keeps publishing a single copy of the draft row.

Integrity is kept by Verdin rather than by foreign keys: linking a document that does not
exist is a validation error, and deleting a document removes the links pointing at it in the
same transaction.

### One document per target

For `oneToOne` and `oneToMany`, a target belongs to at most one source document. Linking a
target that another document holds **moves** it: the other document's link is removed in the
same write. This is Strapi's behaviour. It is enforced per version: a draft and its
published version may hold the same target.

## Writing

On the owning side, `data` takes a `documentId`, a list of them, or an object that describes
a change:

| Input | Effect |
| --- | --- |
| `"k2m…"` or `{ "documentId": "k2m…" }` | Link one target (to-one relations). |
| `["k2m…", "p9x…"]` | Replace every link, in this order. |
| `null` or `[]` | Remove every link. |
| `{ "set": ["k2m…"] }` | Replace every link. |
| `{ "connect": [...], "disconnect": [...] }` | Add and remove links, keeping the others. |

Connecting a new target to a to-one relation replaces the previous one. `set` cannot be
combined with `connect` or `disconnect`.

In the admin panel, a relation field lists the linked entries. **Link an entry** (or
**Link entries** for to-many relations) opens a dialog that searches the target type's
entries, across their text fields, and in the entry's locale when the target is localized.
Choose one entry, or tick several and add them; entries already linked are marked.

## Ordering

To-many relations keep the order of their links. A list or `set` stores the order you send.
`connect` items can say where they go:

```json
{
  "data": {
    "tags": {
      "connect": [
        { "documentId": "k2m…", "position": { "before": "p9x…" } },
        { "documentId": "a7c…", "position": { "end": true } }
      ]
    }
  }
}
```

`position` is `{ "before": documentId }`, `{ "after": documentId }`, `{ "start": true }` or
`{ "end": true }`. Positions are renumbered on every write. Reads return related documents in
link order unless the populate asks for a `sort`.

## Reading

Relations are returned only when you populate them:

```http
GET /api/articles?populate[category][fields][0]=name&populate[tags][sort]=label:asc
```

A to-one relation is an object or `null`; a to-many relation is an array. Each populated
relation can take its own `fields`, `filters`, `sort`, `populate` and `count`, up to five
levels deep. Every level is one batched query per relation (`WHERE … IN (…)`), not a join,
so deep populates do not multiply rows. At most 1,000 related documents are returned per
document and relation; `count` gives the exact number.

You can filter through relations (`filters[category][name][$eq]=News`), on either side, and
sort by a field of a to-one relation (`sort=category.name:asc`). Populating, filtering or
sorting through a relation to a type the caller cannot read is refused (`populate=*` skips
it), so relations never reveal content that the caller's
[permissions](/concepts/permissions/) hide.

## Relations inside components

A [component](/concepts/components-and-dynamic-zones/) can hold relations, but only `oneWay`
and `manyWay`:

```json title="schema/components/shared/related.json"
{
  "displayName": "Related",
  "attributes": {
    "label": { "type": "string" },
    "articles": { "type": "relation", "relation": "manyWay", "target": "article" }
  }
}
```

The component's JSON stores the `documentId`s themselves: a string for `oneWay`, an array for
`manyWay`. That is why the other kinds are not allowed there:

- An inverse side would have to search the JSON of every document to find who links to it.
- "One document per target" (`oneToOne`, `oneToMany`) cannot be enforced without such a
  search either.

Inside components, the order of a `manyWay` list is the array's order. References are
checked on write and resolved when the component is populated, in the document's status and
locale; targets that no longer exist are left out. They cannot be filtered on.

## Polymorphic relations

`morphToOne` and `morphToMany` link documents of any content type. Their links store the
target's type next to its `documentId`, and writes name both:

```json
{ "data": { "related": [{ "__type": "api::article", "documentId": "k2m…" }, { "__type": "api::page", "documentId": "p9x…" }] } }
```

Populated items are the target documents with their `__type`, read in the request's status
and locale. The inverse sides `morphOne` and `morphMany` name the owner type (`target`) and its
attribute (`morphBy`), and are read-only. Polymorphic relations cannot be filtered or sorted
on, and cannot be inside components.
