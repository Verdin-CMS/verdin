---
title: "Internationalization"
description: "How Verdin keeps one version of a document per locale, which fields are localized or shared, and how the APIs pick a locale."
sidebar:
  order: 5
---

Internationalization (i18n) keeps a document's content in several languages. This page
explains the model: locales, localized and shared fields, and how reads and writes choose a
locale. For the editor's workflow, see
[Localizing content](/guides/content/localizing-content/).

## Locales

The project's locales are listed in **Settings → Internationalization** (permission
`locales.manage`). The first start adds English (`en`) as the default locale.

- One locale is always the default. Requests that name no locale use it, and it cannot be
  deleted.
- Codes are a language of two or three lowercase letters, optionally followed by subtags:
  `en`, `fr`, `pt-BR`, `zh-Hans`.

:::caution
Deleting a locale also deletes every version written in it.
:::

## Localized content types

A content type is localized when its schema says so. Each document then has one version per
locale, and all of them share the `documentId`:

```json title="schema/content-types/article.json (excerpt)"
{
  "kind": "collectionType",
  "singularName": "article",
  "pluralName": "articles",
  "displayName": "Article",
  "options": { "draftAndPublish": true },
  "pluginOptions": { "i18n": { "localized": true } },
  "attributes": {
    "title": { "type": "string", "required": true },
    "readingTime": { "type": "integer", "pluginOptions": { "i18n": { "localized": false } } }
  }
}
```

With [draft and publish](/concepts/draft-and-publish/), each locale has its own draft and
published version, so a French translation can be published before or after the English
text. Types without `pluginOptions.i18n.localized` are not localized and ignore `locale`
parameters.

## What is localized

In a localized type, every attribute is localized unless it says
`"pluginOptions": { "i18n": { "localized": false } }`. Such a **shared** field has one value
for the whole document:

- Saving a shared field in one locale writes it to the drafts of every locale.
- Publishing a locale copies its shared fields to the published versions of the other
  locales.
- This applies to relations and media too: a shared relation links the same documents in
  every locale.

System fields follow the version: each locale has its own `createdAt`, `updatedAt` and
`publishedAt`. `unique` and `uid` values are unique per locale, so two translations may share
a slug.

## Relations between localized types

Relations link documents, not versions (see
[Relations](/concepts/relations/#linked-by-document-not-by-row)), so the locale is chosen
when reading:

- When both types are localized, the French article shows the French version of its
  category. Filters through the relation match in the same locale.
- When the target type is not localized, every locale sees the same target.

## Choosing a locale in the APIs

REST and the admin API take `locale` as a query parameter, in the Strapi v5 format; GraphQL
takes a `locale` argument:

```http
GET /api/articles?locale=fr
PUT /api/articles/{documentId}?locale=fr
DELETE /api/articles/{documentId}?locale=fr
```

```graphql
query {
  articles(locale: "fr") {
    documentId
    title
  }
}
```

- Without `locale`, requests read and write the default locale.
- A `PUT` in a locale the document does not have yet creates that version.
- A `DELETE` removes only the version in the requested locale. Links that point at the
  document are removed once no locale is left.
- REST responses of localized types include `locale`. An unknown locale is a `400` error.
- Webhook payloads, realtime events and content history record the locale of the version
  that changed.

## Permissions per locale

Admin roles can limit content permissions to some locales, so a French editor can read or
change only French versions. See [Permissions](/concepts/permissions/#field-and-locale-permissions).
The content API's grants (public access, API tokens, end-user roles) apply to every locale.

## Compared with Strapi

The model and the parameters match Strapi v5's i18n: localized types, `localized: false`
fields, `?locale=` and the default locale. In Verdin, i18n is part of the core and always on:
you turn it on per content type in the schema.
