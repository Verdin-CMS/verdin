---
title: "REST API"
description: "Routes, query parameters (filters, sort, pagination, fields, populate, locale, status), request bodies, responses, errors and limits of Verdin's Strapi v5 compatible REST API."
sidebar:
  order: 1
  label: "REST"
---

Every content type gets REST routes under the content API prefix, `/api` by default
(`[api].prefix`). Routes, parameters and response shapes follow Strapi v5, so most frontends
written for Strapi work unchanged. This page is the reference; examples use the
[blog example](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog) (articles,
categories, tags and a homepage).

The server also describes the routes of *your* schema in an OpenAPI 3.1 document at
`GET /api/_openapi.json`. The [example content API](/api/example/) pages render the blog's
document, and the [API playground](/api/playground/) lets you try requests.

## Authentication

| `Authorization` header | Caller | Permissions |
| --- | --- | --- |
| none | Public | **Settings → Public access** |
| `Bearer vd_…` | API token | The token's type and grants |
| `Bearer <JWT>` | End user | Their end-user role |

An unknown, expired or malformed token is `401`; it never falls back to public access. A
valid caller without the grant gets `403`. See [Permissions](/concepts/permissions/).

```sh title="Terminal"
curl -H "Authorization: Bearer $VERDIN_TOKEN" 'https://cms.example.com/api/articles'
```

Browsers on other origins can call the API only when `[api].cors_origins` lists them.

## Routes

Collection types are served at their `pluralName`:

| Method and path | Action | Answers |
| --- | --- | --- |
| `GET /api/articles` | `find` | `200`, a page of documents |
| `GET /api/articles/{documentId}` | `findOne` | `200`, one document |
| `POST /api/articles` | `create` | `201`, the created document |
| `PUT /api/articles/{documentId}` | `update` | `200`, the updated document |
| `DELETE /api/articles/{documentId}` | `delete` | `204`, no body |

Single types are served at their `singularName`:

| Method and path | Action | Answers |
| --- | --- | --- |
| `GET /api/homepage` | `find` | `200`, or `404` before the first write |
| `PUT /api/homepage` | `update` | `200`; the first `PUT` creates the document |
| `DELETE /api/homepage` | `delete` | `204` |

`POST` on a single type answers `405`.

### Actions

Types with [draft and publish](/concepts/draft-and-publish/) have three more routes, which
need the `publish` grant. Strapi has no REST equivalent.

| Method and path | Effect | Answers |
| --- | --- | --- |
| `POST /api/articles/{documentId}/actions/publish` | Publishes the draft. | The published version |
| `POST /api/articles/{documentId}/actions/unpublish` | Deletes the published version. | The draft |
| `POST /api/articles/{documentId}/actions/discard-draft` | Replaces the draft with the published version. | The draft |

All three take `?locale=` on localized types.

## Writing

`POST` and `PUT` take a JSON body with a `data` object:

```sh title="Terminal"
curl -X POST 'https://cms.example.com/api/articles' \
  -H "Authorization: Bearer $VERDIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "data": {
      "title": "Hello, Verdin",
      "slug": "hello-verdin",
      "category": "k2m7q4…",
      "tags": ["a7c1…", "p9x3…"],
      "seo": { "metaTitle": "Hello, Verdin" }
    }
  }'
```

- `PUT` is a partial update: attributes you leave out keep their value. Components and
  dynamic zones you send replace the stored value.
- On draft and publish types, `POST` and `PUT` write the draft **and publish it**, as in
  Strapi v5. Add `?status=draft` to write the draft only. If publishing fails validation,
  nothing is written.
- Unknown keys, system fields (`id`, `documentId`, timestamps) and inverse (`mappedBy`)
  relation sides are validation errors.
- Relations take `documentId`s, lists, `null`, or `{ connect, disconnect, set }`; see
  [Relations](/concepts/relations/#writing). Media fields take file ids.
- The response is the written version, read with the request's `fields` and `populate`.
- `DELETE` removes every version of the document (on localized types, the version in the
  requested locale).

## Query parameters

| Parameter | Example | Default |
| --- | --- | --- |
| [`filters`](#filters) | `filters[title][$containsi]=rust` | none |
| [`sort`](#sort) | `sort=publishedAt:desc` | by `id`, ascending |
| [`pagination`](#pagination) | `pagination[page]=2&pagination[pageSize]=10` | page 1, 25 per page |
| [`fields`](#fields) | `fields[0]=title&fields[1]=slug` | every scalar field |
| [`populate`](#populate) | `populate[category][fields][0]=name` | nothing |
| [`status`](#status) | `status=draft` | `published` |
| [`hasPublishedVersion`](#status) | `hasPublishedVersion=false` | none |
| [`locale`](#locale) | `locale=fr` | the default locale |
| [`_q`](#search) | `_q=ownership` | none |

Parameters use Strapi's bracket notation. Lists can be written with indexes
(`sort[0]=a&sort[1]=b`), with empty brackets (`sort[]=a`) or by repeating the key
(`sort=a&sort=b`). Encode brackets and values as usual in a URL; clients such as
[`qs`](https://github.com/ljharb/qs) or the [typed client](/guides/frontend/typed-client/)
build these strings for you.

An unknown parameter, an unknown or `private` field, or a malformed value is a `400`
`ValidationError` that names the problem. Nothing is silently ignored.

## Filters

`filters[field][operator]=value`. A bare value means `$eq`: `filters[slug]=hello-verdin`.

```http
GET /api/articles?filters[title][$containsi]=rust&filters[readingTime][$lte]=5
```

Several conditions at the same level must all match. Combine them with logical operators:

```http
GET /api/articles?filters[$or][0][featured][$eq]=true&filters[$or][1][readingTime][$gt]=10
GET /api/articles?filters[$not][category][name][$eq]=News
```

| Operator | Matches | Types |
| --- | --- | --- |
| `$eq`, `$ne` | Equal, not equal | all scalars |
| `$eqi`, `$nei` | Equal, not equal, ignoring case | text |
| `$lt`, `$lte`, `$gt`, `$gte` | Less than, less or equal, greater than, greater or equal | all scalars but booleans |
| `$between` | Within two values, inclusive: `[$between][0]=1&[$between][1]=5` | all scalars but booleans |
| `$in`, `$notIn` | In, not in a list: `[$in][0]=a&[$in][1]=b` | all scalars |
| `$contains`, `$notContains` | Contains, does not contain | text |
| `$containsi`, `$notContainsi` | Same, ignoring case | text |
| `$startsWith`, `$startsWithi` | Starts with (ignoring case) | text |
| `$endsWith`, `$endsWithi` | Ends with (ignoring case) | text |
| `$null`, `$notNull` | Is empty, is set: `[$null]=true` | all fields |
| `$and`, `$or` | Every, some condition of a list | logical |
| `$not` | Negates a filter object | logical |

- Text types are `string`, `text`, `richtext`, `email`, `uid` and `enumeration`. `json` and
  `blocks` take only `$null` and `$notNull`.
- Values are converted to the field's type: integers, numbers, `true`/`false` (or `1`/`0`),
  dates as `YYYY-MM-DD`, times as `HH:MM:SS`, datetimes as ISO 8601.
- You can filter on `id`, `documentId`, `createdAt`, `updatedAt`, `publishedAt` and, on
  localized types, `locale`.
- Text comparisons behave the same on every database: `$eq`, `$contains` and the other
  operators without `i` are exact, and the `…i` variants ignore case (and accents on MySQL
  and MariaDB; SQLite folds only ASCII letters).
- A request has at most 100 conditions.

### Filtering through relations

Filter on the fields of related documents, on either side of the relation and nested:

```http
GET /api/articles?filters[category][name][$eq]=News
GET /api/articles?filters[tags][label][$in][0]=rust&filters[tags][label][$in][1]=cms
GET /api/categories?filters[articles][tags][label][$eq]=rust
GET /api/articles?filters[category][$null]=true
```

A to-many condition matches when some related document matches. Related documents are
matched in the version and locale being read. Polymorphic relations and media fields cannot
be filtered.

### Filtering on components and dynamic zones

```http
GET /api/articles?filters[seo][metaTitle][$containsi]=rust
GET /api/articles?filters[blocks][__component][$eq]=blocks.quote
```

Scalar fields of components can be filtered, nested ones included; a repeatable component
matches when some item matches. Dynamic zones are filtered by `__component` only. See
[Components and dynamic zones](/concepts/components-and-dynamic-zones/#filtering).

## Sort

```http
GET /api/articles?sort=publishedAt:desc
GET /api/articles?sort[0]=featured:desc&sort[1]=title:asc
GET /api/articles?sort=title,createdAt:desc
GET /api/articles?sort=category.name:asc
```

- `field` or `field:asc|desc`; the direction defaults to `asc`.
- Any scalar field but `json` and `blocks` can be sorted, system fields included.
- `relation.field` sorts by a field of a to-one relation.
- Empty values come last in both directions, and ties are broken by `id`, so pages are
  stable.

## Pagination

Page-based or offset-based, not both:

| Parameter | Default | Notes |
| --- | --- | --- |
| `pagination[page]` | `1` | From 1. |
| `pagination[pageSize]` | `25` (`[api].default_page_size`) | Capped at `[api].max_page_size` (100). |
| `pagination[start]` | `0` | Offset. |
| `pagination[limit]` | `25` | Capped at the maximum; `-1` asks for the maximum. |
| `pagination[withCount]` | `true` | `false` skips counting and leaves `total` and `pageCount` out. |

The response's `meta.pagination` follows the mode you used:

```json
{ "page": 2, "pageSize": 10, "pageCount": 9, "total": 87 }
{ "start": 20, "limit": 10, "total": 87 }
```

## Fields

`fields` selects scalar attributes:

```http
GET /api/articles?fields[0]=title&fields[1]=slug
GET /api/articles?fields=title,slug
```

`id` and `documentId` are always returned. Relations, media, components and dynamic zones
are never selected by `fields`: use `populate`.

## Populate

Relations, media, components and dynamic zones are returned only when populated:

| Form | Populates |
| --- | --- |
| `populate=*` | Every relation, media field, component and dynamic zone, one level deep |
| `populate=category,tags` or `populate[0]=category&populate[1]=tags` | The named fields |
| `populate[category]=true` | The named field (`false` leaves it out) |
| `populate[category][fields][0]=name` | The field, with options |

Each populated relation accepts `fields`, `filters`, `sort`, `populate` (nested, up to 5
levels in all) and `count`:

```http
GET /api/articles?populate[category][fields][0]=name
  &populate[tags][filters][label][$startsWith]=r&populate[tags][sort]=label:asc
  &populate[category][populate][articles][count]=true
```

- A to-one relation is an object or `null`; a to-many relation is an array, in link order or
  in the populate's `sort` order.
- `count=true` returns `{ "count": 12 }` instead of the documents (to-many relations only).
- At most 1,000 related documents are returned per document and relation; `count` is exact.
- Components and dynamic zones come back whole, nested components and their relations and
  media included. Strapi's per-level options for them (`populate[blocks][on][…]`) are
  accepted and ignored.
- Media fields come back as file objects.
- Polymorphic relations accept only `count`.
- Related documents are read in the same status and locale as the document. Populating a
  type the caller cannot read is a `400`; `populate=*` skips it.

Each level is one batched query per relation, so deep populates stay fast and never return
duplicate rows.

## Status

On draft and publish types, `status` picks the version:

- `status=published` (the default) reads published versions.
- `status=draft` reads drafts, and needs the `readDrafts` grant besides `find` or `findOne`.

`hasPublishedVersion=true|false` keeps documents that have, or do not have, a published
version: `?status=draft&hasPublishedVersion=false` lists documents never published. It is a
`400` on types without draft and publish.

On writes, `status=draft` saves the draft without publishing it. See
[Draft and publish](/concepts/draft-and-publish/).

## Locale

`locale=fr` reads and writes the French version of localized types. Without it, requests use
the default locale. An invalid or unknown code is a `400`. Types that are not localized
ignore it. See [Internationalization](/concepts/internationalization/).

## Search

`_q` finds documents whose text fields contain the words, ignoring case (at most 200
characters):

```http
GET /api/articles?_q=rust ownership
```

Without a search index this matches, as in Strapi, any non-private `string`, `text`,
`richtext`, `email`, `uid` or `enumeration` field. With `[search] enabled = true`, results are
ranked by relevance unless you pass `sort`. Other filters and pagination still apply. See
[Search](/guides/content/search/).

## Responses

A list:

```json
{
  "data": [
    {
      "id": 12,
      "documentId": "k2m7q4dx8n5t1v3b9c0e6a2wfr",
      "title": "Hello, Verdin",
      "slug": "hello-verdin",
      "excerpt": null,
      "body": "…",
      "readingTime": 4,
      "featured": false,
      "createdAt": "2026-09-25T09:00:00.000Z",
      "updatedAt": "2026-09-25T09:30:00.000Z",
      "publishedAt": "2026-09-25T09:30:00.000Z"
    }
  ],
  "meta": { "pagination": { "page": 1, "pageSize": 25, "pageCount": 1, "total": 1 } }
}
```

One document: `{ "data": { … }, "meta": {} }`.

- Documents are flat, like Strapi v5: no `attributes` wrapper.
- Attributes come in schema order, between `id`/`documentId` and the timestamps; localized
  types add `locale`. `private` fields never appear.
- `biginteger` values are strings. `decimal` values are numbers, rounded to their scale
  (strings with `[api].decimal_as_string = true`). Dates are `YYYY-MM-DD`, times
  `HH:MM:SS.mmm`, and datetimes `YYYY-MM-DDTHH:MM:SS.mmmZ` in UTC.

Successful reads carry an `ETag`; send it back in `If-None-Match` to get `304 Not Modified`.
They also carry `Cache-Tag` and `Surrogate-Key` headers for CDN purges (see
[Deploys and CDN](/guides/integrations/deploys-and-cdn/)).

## Errors

Errors have Strapi's shape:

```json
{
  "data": null,
  "error": {
    "status": 400,
    "name": "ValidationError",
    "message": "title is a required field (and 1 more errors)",
    "details": {
      "errors": [
        { "path": ["title"], "message": "title is a required field", "name": "ValidationError" },
        { "path": ["seo", "metaTitle"], "message": "must be at most 60 characters", "name": "ValidationError" }
      ]
    }
  }
}
```

| Status | `name` | When |
| --- | --- | --- |
| `400` | `ValidationError` | Invalid parameters, body or content. `details.errors` lists content problems with their path. |
| `401` | `UnauthorizedError` | Malformed, unknown or expired token. |
| `403` | `ForbiddenError` | The caller lacks the grant (for drafts, `readDrafts`). |
| `404` | `NotFoundError` | Unknown route, content type or document. |
| `405` | `MethodNotAllowedError` | `POST` on a single type, or `PUT` or `DELETE` on a collection type's route. |
| `408` | | The request took longer than `[server].request_timeout_secs` (30 s). |
| `413` | | The body is larger than `[server].body_limit` (1 MB). |
| `429` | `RateLimitError` | Over `[api].public_rate_limit` or `[api].token_rate_limit`. `Retry-After` says when to retry. |
| `500` | `ApplicationError` | An unexpected error; details are only in the server log. |

## Limits

| Limit | Value |
| --- | --- |
| Page size | `[api].max_page_size`, 100 by default |
| Populate depth | 5 levels |
| Related documents per document and relation | 1,000 |
| Filter conditions | 100 |
| Bracket nesting in a parameter | 12 levels |
| Parameters per request | 1,000 |
| Query string | 16 KB |
| `_q` | 200 characters |

Only the page sizes are configurable. Every field name in `filters`, `sort`, `fields` and
`populate` is checked against the schema, and values are always bound as SQL parameters.

## Media library

Strapi's upload routes, checked against the **Media library** grants. They answer plain
objects and arrays, without `data`, like Strapi:

| Route | Grant | Body or parameters |
| --- | --- | --- |
| `POST /api/upload` | `create` | Multipart: `files` (up to 20), optional `fileInfo` JSON (`name`, `alternativeText`, `caption`, `folder`, `focalPoint`), one per file or one for all |
| `POST /api/upload?id={id}` | `update` | Multipart `fileInfo`, and optionally a new file that replaces the content |
| `GET /api/upload/files` | `find` | `pagination[page]`, `pagination[pageSize]`, `sort`, `filters[name][$containsi]` |
| `GET /api/upload/files/{id}` | `findOne` | |
| `DELETE /api/upload/files/{id}` | `delete` | |

See [Media](/concepts/media/).

## Other routes under the prefix

| Routes | Page |
| --- | --- |
| `/api/auth/*`, `/api/users/*`, `/api/connect/*` | [End users](/guides/auth/end-users/) (when the feature is on) |
| `/api/_events` | [Realtime API](/api/realtime/) (when the feature is on) |
| `/api/_redirects`, `/api/_menus/{slug}`, `/api/_forms/{slug}` | [Redirects](/guides/frontend/redirects/), [Menus](/guides/frontend/menus/), [Forms](/guides/frontend/forms/) |
| `/api/_openapi.json`, `/api/docs` | The OpenAPI document (API tokens only, unless made public in **Settings → Features → API documentation**) and its interactive reference (when public) |
| `/api/plugins/{name}/*` | Routes of [plugins](/extending/plugins/) |
