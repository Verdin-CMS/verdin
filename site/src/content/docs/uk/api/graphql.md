---
title: "GraphQL API"
description: "Як увімкнути GraphQL-ендпоінт Verdin, схема, яку він генерує з ваших типів вмісту, запити, мутації, з'єднання, помилки та обмеження."
sidebar:
  order: 2
  label: "GraphQL"
---

Verdin може віддавати GraphQL API, згенероване з ваших типів вмісту, у формі GraphQL-плагіна
Strapi v5. Воно має ті самі дозволи, фільтри, пагінацію та валідацію, що й REST API: аргументи
GraphQL перетворюються на той самий запит, який зробив би REST-запит. Ця сторінка — довідник;
приклади використовують
[приклад блогу](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog).

## Увімкнення

Типово GraphQL вимкнено. Увімкніть його в **Налаштування → Функції → GraphQL** (дозвіл
`features.manage`). Зміна застосовується одразу, без перезапуску, а ендпоінт такий:

```
POST /graphql
```

Він доступний у корені сервера, а не під префіксом REST. Надсилайте
`{ "query", "variables", "operationName" }` у форматі JSON. `GET /graphql?query=…` також
виконує запити (мутаціям потрібен `POST`).

```sh title="Terminal"
curl -X POST 'https://cms.example.com/graphql' \
  -H "Authorization: Bearer $VERDIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ articles(sort: [\"publishedAt:desc\"]) { documentId title } }"}'
```

Клієнти автентифікуються так само, як у REST API: без заголовка для публічного доступу, з
API-токеном або з JWT кінцевого користувача. Некоректний заголовок `Authorization` або
невідомий токен дає `401`. Див. [Дозволи](/uk/concepts/permissions/). Браузерам з інших
origin потрібен `[api].cors_origins`.

### Налаштування

| Налаштування | Типово | Де | Дія |
| --- | --- | --- | --- |
| **Пісочниця GraphiQL** | увімкнено у `verdin dev`, вимкнено у `verdin start` | Налаштування функції | Показує GraphiQL, коли браузер відкриває `GET /graphql`. Завантажується з unpkg.com. |
| **Інтроспекція** | увімкнено | Налаштування функції | Дозволяє клієнтам та інструментам читати схему. Вимкніть, щоб приховати схему від публіки. |
| **Вимкнені операції** | немає | Налаштування функції | Для кожного типу вмісту прибирає зі схеми `find`, `findOne`, `create`, `update` чи `delete` (або всі запити, всі мутації, усе), як перемикачі shadow CRUD у Strapi. На REST не впливає. |
| `maxDepth` | `10` | Admin API | Найбільша дозволена глибина вибірки. |
| `maxComplexity` | `1000` | Admin API | Найбільша дозволена складність запиту (приблизно кількість вибраних полів). |

Для `maxDepth` і `maxComplexity` поки немає поля в панелі. Задайте їх через
[admin API](/uk/api/admin/): `GET /admin/api/features` повертає поточні налаштування, а
`PUT /admin/api/features/graphql` замінює їх, тож надсилайте й ті, які хочете зберегти:

```json
{ "enabled": true, "settings": { "playground": false, "introspection": true, "maxDepth": 8, "maxComplexity": 500 } }
```

## Схема

Для кожного типу вмісту схема має об'єктний тип, названий за його `singularName` у
PascalCase (`article` → `Article`, `blog-post` → `BlogPost`), з такими полями:

- `documentId: ID!`
- кожен атрибут, який не є `private`
- `createdAt`, `updatedAt` і `publishedAt` як `DateTime`
- `locale: String` у локалізованих типах

| Атрибут | Тип GraphQL |
| --- | --- |
| `string`, `text`, `richtext`, `email`, `uid`, `enumeration` | `String` |
| `integer` | `Int` |
| `biginteger` | `Long` (рядок, як у REST) |
| `float`, `decimal` | `Float` |
| `boolean` | `Boolean` |
| `date`, `time`, `datetime` | `Date`, `Time`, `DateTime` |
| `json`, `blocks` | `JSON` |
| зв'язок to-one | тип цілі, напр. `Category` |
| зв'язок to-many | `[Tag!]!` з аргументами `filters`, `pagination` і `sort` |
| `media` | `UploadFile` або `[UploadFile!]!`, коли `multiple` |
| `component` | `ComponentSharedSeo` (з UID `shared.seo`) або список, якщо повторюваний |
| `dynamiczone` | `[ArticleBlocksDynamicZone!]!`, об'єднання (union) його компонентів |
| поліморфний зв'язок | `JSON` (документи з їхнім `__type`) |

Кореневий `Query` також має `verdin: String!` — версію сервера.

## Запити

| Тип колекції `article` | Повертає |
| --- | --- |
| `articles(filters, pagination, sort, status, locale)` | `[Article!]!` |
| `articles_connection(filters, pagination, sort, status, locale)` | `ArticleEntityResponseCollection` з `nodes` і `pageInfo` |
| `article(documentId: ID!, status, locale)` | `Article` або `null` |

| Поодинокий тип `homepage` | Повертає |
| --- | --- |
| `homepage(status, locale)` | `Homepage` або `null` |

Назви запитів і полів походять від `pluralName` і `singularName` у camelCase
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

Той самий запит через REST:

```http
GET /api/articles?filters[category][name][$eq]=News&filters[title][$containsi]=rust
  &sort=publishedAt:desc&pagination[page]=1&pagination[pageSize]=10
  &populate[category][fields][0]=name&populate[tags][sort]=label:asc&populate[0]=seo&populate[1]=blocks
```

### Аргументи

- **`filters`**: `ArticleFiltersInput` з полем для кожного атрибута, а також `documentId`,
  мітки часу та `and`, `or` і `not`. Скалярні поля приймають вхідні типи операторів, як-от
  `StringFilterInput`, чиї оператори — це [оператори REST](/uk/api/rest/#фільтри) без `$`:
  `eq`, `ne`, `containsi`, `in`, `between`, `null`… Зв'язки приймають вхідний тип фільтрів
  цілі, а неповторювані компоненти — тип фільтрів свого компонента.
- **`pagination`**: `{ page, pageSize }` або `{ start, limit }`, з типовими й максимальними
  значеннями REST.
- **`sort`**: список рядків `"field"` або `"field:asc|desc"`, як у REST.
- **`status`**: `PUBLISHED` (типово) або `DRAFT`, для якого потрібен дозвіл `readDrafts`.
  Пов'язані документи завжди мають той самий статус, що й батьківський.
- **`locale`**: код локалі для локалізованих типів; інакше типова локаль.

Завантажується лише те, що ви вибрали: вибірка стає REST-параметром `populate`, а кожен
рівень зв'язків — це один пакетний запит. `pageInfo` у `articles_connection` рахує всі
збіги (`total`) і сторінки (`pageCount`).

## Мутації

| Тип колекції `article` | Повертає |
| --- | --- |
| `createArticle(data: ArticleInput!, status, locale)` | `Article` |
| `updateArticle(documentId: ID!, data: ArticleInput!, status, locale)` | `Article` |
| `deleteArticle(documentId: ID!, locale)` | `DeleteMutationResponse` (`{ documentId }`) |

| Поодинокий тип `homepage` | Повертає |
| --- | --- |
| `updateHomepage(data: HomepageInput!, status, locale)` | `Homepage`; перше оновлення створює документ |
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

- Як і в REST, `create` та `update` публікують, якщо не вказано `status: DRAFT`. Окремих
  мутацій для публікації немає: щоб зняти з публікації або відкинути чернетку, використовуйте
  REST-[дії](/uk/api/rest/#дії).
- Вхідні типи відображають атрибути: зв'язки приймають `ID` або `[ID!]` (`documentId`), медіа —
  id файлів, компоненти — свій тип `…Input`, а елементи динамічної зони — це `JSON`-об'єкти з
  `__component`. Зворотних (`mappedBy`) зв'язків у вхідних типах немає.
- Мутації `delete` видаляють версію в `locale` (без нього — у типовій локалі), як
  `DELETE /api/articles/{documentId}?locale=fr`.
- Виконується та сама валідація, що й у REST.

## Помилки

Помилки GraphQL приходять у списку `errors` відповіді `200`, з кодом у `extensions.code`:

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

| Код | Коли |
| --- | --- |
| `FORBIDDEN` | Клієнт не має дозволу на операцію або `readDrafts` для `status: DRAFT`. |
| `BAD_USER_INPUT` | Некоректні аргументи або вміст; `details` перелічує помилки валідації з їхніми шляхами. |
| `NOT_FOUND` | Документ не існує (при оновленні та видаленні). |
| `INTERNAL_SERVER_ERROR` | Неочікувана помилка, записана в журнал сервера. |

Запити, глибші за `maxDepth` або складніші за `maxComplexity`, відхиляються ще до виконання.

## Обмеження

GraphQL має власні обмеження (`maxDepth`, `maxComplexity`) на додачу до обмежень REST API:
щонайбільше `[api].max_page_size` документів у списку, вкладеність зв'язків щонайбільше на
5 рівнів, щонайбільше 1 000 пов'язаних документів на документ і зв'язок і щонайбільше
100 умов фільтра. Див. [обмеження REST](/uk/api/rest/#обмеження).

## Плагіни

[Плагіни](/uk/extending/plugins/) можуть додавати кореневі запити й мутації виду
`name(args: JSON): JSON`. Назви, які вже використовують типи вмісту, пропускаються.

## Порівняно зі Strapi

Назви типів, запитів і мутацій, запити `_connection` з `nodes` і `pageInfo`, аргументи
`documentId`, `status` і `locale` відповідають GraphQL-плагіну Strapi v5, а локалізовані типи
мають поле `locale`. Типи не відкривають `id`, і GraphQL-підписок немає; для оновлень у
реальному часі використовуйте [Realtime API](/uk/api/realtime/).
