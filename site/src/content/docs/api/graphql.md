---
title: "GraphQL API"
description: "Enabling Verdin's GraphQL endpoint, the schema it generates from your content types, queries, mutations, connections, errors and limits."
sidebar:
  order: 2
  label: "GraphQL"
---

Verdin can serve a GraphQL API generated from your content types, shaped like Strapi v5's
GraphQL plugin. It shares the REST API's permissions, filters, pagination and validation:
GraphQL arguments are translated into the same query that a REST request would make. This
page is the reference; examples use the
[blog example](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog).

## Enabling it

GraphQL is off by default. Turn it on in **Settings → Features → GraphQL** (permission
`features.manage`). The change applies at once, without a restart, and the endpoint is:

```
POST /graphql
```

It is served at the server's root, not under the REST prefix. Send
`{ "query", "variables", "operationName" }` as JSON. `GET /graphql?query=…` also runs queries
(mutations need `POST`).

```sh title="Terminal"
curl -X POST 'https://cms.example.com/graphql' \
  -H "Authorization: Bearer $VERDIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ articles(sort: [\"publishedAt:desc\"]) { documentId title } }"}'
```

Callers authenticate as on the REST API: no header for public access, an API token, or an end
user's JWT. A malformed `Authorization` header or an unknown token answers `401`. See
[Permissions](/concepts/permissions/). Browsers on other origins need `[api].cors_origins`.

### Settings

| Setting | Default | Where | Effect |
| --- | --- | --- | --- |
| **GraphiQL playground** | on in `verdin dev`, off in `verdin start` | Feature settings | Serves GraphiQL when a browser opens `GET /graphql`. It loads from unpkg.com. |
| **Introspection** | on | Feature settings | Lets clients and tools read the schema. Turn it off to hide the schema from the public. |
| **Disabled operations** | none | Feature settings | Per content type, leaves `find`, `findOne`, `create`, `update` or `delete` (or all queries, all mutations, everything) out of the schema, like Strapi's shadow CRUD switches. REST is not affected. |
| `maxDepth` | `10` | Admin API | Deepest selection allowed. |
| `maxComplexity` | `1000` | Admin API | Highest query complexity allowed (roughly, the number of fields selected). |

`maxDepth` and `maxComplexity` have no field in the panel yet. Set them with the
[admin API](/api/admin/): `GET /admin/api/features` returns the current settings, and
`PUT /admin/api/features/graphql` replaces them, so send the ones you want to keep too:

```json
{ "enabled": true, "settings": { "playground": false, "introspection": true, "maxDepth": 8, "maxComplexity": 500 } }
```

## Schema

For each content type, the schema has an object type named after its `singularName` in
PascalCase (`article` → `Article`, `blog-post` → `BlogPost`), with:

- `documentId: ID!`
- every attribute that is not `private`
- `createdAt`, `updatedAt` and `publishedAt`, as `DateTime`
- `locale: String`, on localized types

| Attribute | GraphQL type |
| --- | --- |
| `string`, `text`, `richtext`, `email`, `uid`, `enumeration` | `String` |
| `integer` | `Int` |
| `biginteger` | `Long` (a string, like REST) |
| `float`, `decimal` | `Float` |
| `boolean` | `Boolean` |
| `date`, `time`, `datetime` | `Date`, `Time`, `DateTime` |
| `json`, `blocks` | `JSON` |
| to-one relation | the target's type, e.g. `Category` |
| to-many relation | `[Tag!]!`, with `filters`, `pagination` and `sort` arguments |
| `media` | `UploadFile`, or `[UploadFile!]!` when `multiple` |
| `component` | `ComponentSharedSeo` (from the UID `shared.seo`), or a list when repeatable |
| `dynamiczone` | `[ArticleBlocksDynamicZone!]!`, a union of its components |
| polymorphic relation | `JSON` (documents with their `__type`) |

The root `Query` also has `verdin: String!`, the server's version.

## Queries

| Collection type `article` | Returns |
| --- | --- |
| `articles(filters, pagination, sort, status, locale)` | `[Article!]!` |
| `articles_connection(filters, pagination, sort, status, locale)` | `ArticleEntityResponseCollection` with `nodes` and `pageInfo` |
| `article(documentId: ID!, status, locale)` | `Article` or `null` |

| Single type `homepage` | Returns |
| --- | --- |
| `homepage(status, locale)` | `Homepage` or `null` |

Query and field names come from `pluralName` and `singularName` in camelCase
(`blog-posts` → `blogPosts`).

```graphql
query LatestArticles($page: Int) {
  articles_connection(
    filters: { category: { name: { eq: "News" } }, title: { containsi: "rust" } }
    sort: ["publishedAt:desc"]
    pagination: { page: $page, pageSize: 10 }
  ) {
    nodes {
      documentId
      title
      slug
      category { name }
      tags(sort: ["label:asc"]) { label }
      seo { metaTitle metaDescription }
      blocks {
        __typename
        ... on ComponentBlocksHero { title subtitle }
        ... on ComponentBlocksQuote { text author }
      }
    }
    pageInfo { page pageSize pageCount total }
  }
}
```

The same request over REST:

```http
GET /api/articles?filters[category][name][$eq]=News&filters[title][$containsi]=rust
  &sort=publishedAt:desc&pagination[page]=1&pagination[pageSize]=10
  &populate[category][fields][0]=name&populate[tags][sort]=label:asc&populate[0]=seo&populate[1]=blocks
```

### Arguments

- **`filters`**: an `ArticleFiltersInput` with one field per attribute, plus `documentId`,
  the timestamps, and `and`, `or` and `not`. Scalar fields take operator inputs such as
  `StringFilterInput`, whose operators are the [REST operators](/api/rest/#filters) without
  the `$`: `eq`, `ne`, `containsi`, `in`, `between`, `null`… Relations take the target's
  filters input, and non-repeatable components their component's.
- **`pagination`**: `{ page, pageSize }` or `{ start, limit }`, with the REST defaults and
  maximum.
- **`sort`**: a list of `"field"` or `"field:asc|desc"` strings, as in REST.
- **`status`**: `PUBLISHED` (the default) or `DRAFT`, which needs the `readDrafts` grant.
  Related documents always follow their parent's status.
- **`locale`**: a locale code for localized types; the default locale otherwise.

Only what you select is loaded: the selection becomes the REST `populate`, and each level of
relations is one batched query. `pageInfo` of `articles_connection` counts every match
(`total`) and pages (`pageCount`).

## Mutations

| Collection type `article` | Returns |
| --- | --- |
| `createArticle(data: ArticleInput!, status, locale)` | `Article` |
| `updateArticle(documentId: ID!, data: ArticleInput!, status, locale)` | `Article` |
| `deleteArticle(documentId: ID!, locale)` | `DeleteMutationResponse` (`{ documentId }`) |

| Single type `homepage` | Returns |
| --- | --- |
| `updateHomepage(data: HomepageInput!, status, locale)` | `Homepage`; the first update creates the document |
| `deleteHomepage(locale)` | `DeleteMutationResponse` |

```graphql
mutation {
  createArticle(
    data: { title: "Hello, Verdin", slug: "hello-verdin", category: "k2m7q4…", tags: ["a7c1…"] }
    status: DRAFT
  ) {
    documentId
    publishedAt
  }
}
```

- As on REST, `create` and `update` publish unless `status: DRAFT`. There are no separate
  publish mutations: use the REST [actions](/api/rest/#actions) to unpublish or discard a
  draft.
- Inputs mirror the attributes: relations take `ID` or `[ID!]` (`documentId`s), media take
  file ids, components their `…Input` type, and dynamic zone items are `JSON` objects with a
  `__component`. Inverse (`mappedBy`) relations are not in the inputs.
- `delete` mutations remove the version in `locale` (the default locale without it), like
  `DELETE /api/articles/{documentId}?locale=fr`.
- The same validation runs as on REST.

## Errors

GraphQL errors come in the `errors` list of a `200` response, with a code in
`extensions.code`:

```json
{
  "data": { "createArticle": null },
  "errors": [
    {
      "message": "title is a required field",
      "path": ["createArticle"],
      "extensions": {
        "code": "BAD_USER_INPUT",
        "details": [{ "path": ["title"], "message": "title is a required field", "name": "ValidationError" }]
      }
    }
  ]
}
```

| Code | When |
| --- | --- |
| `FORBIDDEN` | The caller lacks the grant for the operation, or `readDrafts` for `status: DRAFT`. |
| `BAD_USER_INPUT` | Invalid arguments or content; `details` lists validation problems with their paths. |
| `NOT_FOUND` | The document does not exist (on updates and deletes). |
| `INTERNAL_SERVER_ERROR` | An unexpected error, logged on the server. |

Queries deeper than `maxDepth` or more complex than `maxComplexity` are rejected before they
run.

## Limits

GraphQL has its own limits (`maxDepth`, `maxComplexity`) on top of the REST API's: at most
`[api].max_page_size` documents per list, relations nested at most 5 levels, at most 1,000
related documents per document and relation, and at most 100 filter conditions. See
[REST limits](/api/rest/#limits).

## Plugins

[Plugins](/extending/plugins/) can add root queries and mutations of the form
`name(args: JSON): JSON`. Names already used by content types are skipped.

## Compared with Strapi

Type, query and mutation names, `_connection` queries with `nodes` and `pageInfo`,
`documentId` arguments, `status` and `locale` follow Strapi v5's GraphQL plugin, and localized types
have a `locale` field. Types do not expose `id`, and there are no GraphQL subscriptions; for live updates, use
the [realtime API](/api/realtime/).
