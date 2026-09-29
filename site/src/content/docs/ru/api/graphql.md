---
title: "GraphQL API"
description: "Как включить эндпоинт GraphQL в Verdin, какую схему он строит по типам содержимого, запросы, мутации, connection-запросы, ошибки и ограничения."
sidebar:
  order: 2
  label: "GraphQL"
---

Verdin может отдавать GraphQL API, созданный на основе ваших типов содержимого и устроенный
как GraphQL-плагин Strapi v5. У него те же разрешения, фильтры, пагинация и валидация, что и
у REST API: аргументы GraphQL превращаются в тот же запрос, который сделал бы REST-запрос. Эта
страница — справочник; в примерах используется
[пример блога](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog).

## Включение

По умолчанию GraphQL выключен. Включите его в **Настройки → Функции → GraphQL** (разрешение
`features.manage`). Изменение применяется сразу, без перезапуска, а эндпоинт такой:

```
POST /graphql
```

Он доступен в корне сервера, а не под префиксом REST. Отправляйте
`{ "query", "variables", "operationName" }` в формате JSON. `GET /graphql?query=…` тоже
выполняет запросы (для мутаций нужен `POST`).

```sh title="Terminal"
curl -X POST 'https://cms.example.com/graphql' \
  -H "Authorization: Bearer $VERDIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ articles(sort: [\"publishedAt:desc\"]) { documentId title } }"}'
```

Клиенты аутентифицируются так же, как в REST API: без заголовка для публичного доступа, с
API-токеном или с JWT конечного пользователя. Некорректный заголовок `Authorization` или
неизвестный токен дают `401`. См. [Разрешения](/ru/concepts/permissions/). Браузерам с других
источников (origin) нужен `[api].cors_origins`.

### Настройки

| Настройка | По умолчанию | Где | Действие |
| --- | --- | --- | --- |
| **Песочница GraphiQL** | включена в `verdin dev`, выключена в `verdin start` | Настройки функции | Отдаёт GraphiQL, когда браузер открывает `GET /graphql`. Загружается с unpkg.com. |
| **Интроспекция** | включена | Настройки функции | Позволяет клиентам и инструментам читать схему. Выключите, чтобы скрыть схему от посторонних. |
| **Отключённые операции** | нет | Настройки функции | Для каждого типа содержимого исключает из схемы `find`, `findOne`, `create`, `update` или `delete` (или все запросы, все мутации, всё сразу), как переключатели shadow CRUD в Strapi. На REST это не влияет. |
| `maxDepth` | `10` | Admin API | Максимальная глубина выборки. |
| `maxComplexity` | `1000` | Admin API | Максимальная сложность запроса (примерно число выбранных полей). |

Для `maxDepth` и `maxComplexity` в панели пока нет полей. Задайте их через
[admin API](/ru/api/admin/): `GET /admin/api/features` возвращает текущие настройки, а
`PUT /admin/api/features/graphql` заменяет их, поэтому передавайте и те, что хотите сохранить:

```json
{ "enabled": true, "settings": { "playground": false, "introspection": true, "maxDepth": 8, "maxComplexity": 500 } }
```

## Схема

Для каждого типа содержимого в схеме есть объектный тип, названный по его `singularName` в
PascalCase (`article` → `Article`, `blog-post` → `BlogPost`), с полями:

- `documentId: ID!`
- все атрибуты, кроме `private`
- `createdAt`, `updatedAt` и `publishedAt` типа `DateTime`
- `locale: String` у локализованных типов

| Атрибут | Тип GraphQL |
| --- | --- |
| `string`, `text`, `richtext`, `email`, `uid`, `enumeration` | `String` |
| `integer` | `Int` |
| `biginteger` | `Long` (строка, как в REST) |
| `float`, `decimal` | `Float` |
| `boolean` | `Boolean` |
| `date`, `time`, `datetime` | `Date`, `Time`, `DateTime` |
| `json`, `blocks` | `JSON` |
| связь «к одному» | тип цели, например `Category` |
| связь «ко многим» | `[Tag!]!` с аргументами `filters`, `pagination` и `sort` |
| `media` | `UploadFile` или `[UploadFile!]!` при `multiple` |
| `component` | `ComponentSharedSeo` (из UID `shared.seo`) или список, если компонент повторяемый |
| `dynamiczone` | `[ArticleBlocksDynamicZone!]!` — объединение (union) её компонентов |
| полиморфная связь | `JSON` (документы со своим `__type`) |

В корневом `Query` также есть `verdin: String!` — версия сервера.

## Запросы

| Тип-коллекция `article` | Возвращает |
| --- | --- |
| `articles(filters, pagination, sort, status, locale)` | `[Article!]!` |
| `articles_connection(filters, pagination, sort, status, locale)` | `ArticleEntityResponseCollection` с `nodes` и `pageInfo` |
| `article(documentId: ID!, status, locale)` | `Article` или `null` |

| Одиночный тип `homepage` | Возвращает |
| --- | --- |
| `homepage(status, locale)` | `Homepage` или `null` |

Имена запросов и полей берутся из `pluralName` и `singularName` в camelCase
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

Тот же запрос через REST:

```http
GET /api/articles?filters[category][name][$eq]=News&filters[title][$containsi]=rust
  &sort=publishedAt:desc&pagination[page]=1&pagination[pageSize]=10
  &populate[category][fields][0]=name&populate[tags][sort]=label:asc&populate[0]=seo&populate[1]=blocks
```

### Аргументы

- **`filters`**: `ArticleFiltersInput` с полем для каждого атрибута, а также `documentId`,
  временные метки и `and`, `or` и `not`. Скалярные поля принимают входные типы операторов,
  например `StringFilterInput`, операторы которых — это [операторы REST](/ru/api/rest/#фильтры)
  без `$`: `eq`, `ne`, `containsi`, `in`, `between`, `null`… Связи принимают входной тип
  фильтров цели, а неповторяемые компоненты — входной тип своего компонента.
- **`pagination`**: `{ page, pageSize }` или `{ start, limit }`, со значениями по умолчанию и
  максимумом как в REST.
- **`sort`**: список строк `"field"` или `"field:asc|desc"`, как в REST.
- **`status`**: `PUBLISHED` (по умолчанию) или `DRAFT`, для которого нужно право
  `readDrafts`. Связанные документы всегда следуют статусу родителя.
- **`locale`**: код локали для локализованных типов; иначе — локаль по умолчанию.

Загружается только то, что вы выбрали: выборка превращается в `populate` REST, и каждый
уровень связей — это один пакетный запрос. `pageInfo` в `articles_connection` считает все
совпадения (`total`) и страницы (`pageCount`).

## Мутации

| Тип-коллекция `article` | Возвращает |
| --- | --- |
| `createArticle(data: ArticleInput!, status, locale)` | `Article` |
| `updateArticle(documentId: ID!, data: ArticleInput!, status, locale)` | `Article` |
| `deleteArticle(documentId: ID!, locale)` | `DeleteMutationResponse` (`{ documentId }`) |

| Одиночный тип `homepage` | Возвращает |
| --- | --- |
| `updateHomepage(data: HomepageInput!, status, locale)` | `Homepage`; первое обновление создаёт документ |
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

- Как и в REST, `create` и `update` публикуют документ, если не указан `status: DRAFT`.
  Отдельных мутаций публикации нет: чтобы снять с публикации или отменить черновик,
  используйте [действия](/ru/api/rest/#действия) REST.
- Входные типы повторяют атрибуты: связи принимают `ID` или `[ID!]` (значения `documentId`),
  медиа — id файлов, компоненты — свой тип `…Input`, а элементы динамической зоны — объекты
  `JSON` с `__component`. Обратных связей (`mappedBy`) во входных типах нет.
- Мутации `delete` удаляют версию в `locale` (без него — в локали по умолчанию), как
  `DELETE /api/articles/{documentId}?locale=fr`.
- Выполняется та же валидация, что и в REST.

## Ошибки

Ошибки GraphQL приходят в списке `errors` ответа `200`, с кодом в `extensions.code`:

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

| Код | Когда |
| --- | --- |
| `FORBIDDEN` | У клиента нет права на операцию или права `readDrafts` для `status: DRAFT`. |
| `BAD_USER_INPUT` | Неверные аргументы или содержимое; `details` перечисляет ошибки валидации с их путями. |
| `NOT_FOUND` | Документ не существует (при обновлении и удалении). |
| `INTERNAL_SERVER_ERROR` | Непредвиденная ошибка, записанная в лог сервера. |

Запросы глубже `maxDepth` или сложнее `maxComplexity` отклоняются до выполнения.

## Ограничения

У GraphQL есть собственные ограничения (`maxDepth`, `maxComplexity`) поверх ограничений REST
API: не более `[api].max_page_size` документов в списке, вложенность связей не более 5
уровней, не более 1000 связанных документов на документ и связь и не более 100 условий
фильтра. См. [ограничения REST](/ru/api/rest/#ограничения).

## Плагины

[Плагины](/ru/extending/plugins/) могут добавлять корневые запросы и мутации вида
`name(args: JSON): JSON`. Имена, уже занятые типами содержимого, пропускаются.

## Сравнение со Strapi

Имена типов, запросов и мутаций, запросы `_connection` с `nodes` и `pageInfo`, аргументы
`documentId`, `status` и `locale` повторяют GraphQL-плагин Strapi v5, а у локализованных типов
есть поле `locale`. Типы не отдают `id`, и подписок GraphQL нет; для обновлений в реальном
времени используйте [realtime API](/ru/api/realtime/).
