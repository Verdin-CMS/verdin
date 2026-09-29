---
title: "GraphQL API"
description: "启用 Verdin 的 GraphQL 端点，以及它根据内容类型生成的 schema、查询、变更、连接、错误和限制。"
sidebar:
  order: 2
  label: "GraphQL"
---

Verdin 可以提供一个根据内容类型生成的 GraphQL API，其结构与 Strapi v5 的 GraphQL 插件相同。它与 REST API 共用权限、过滤、分页和校验：GraphQL 参数会被转换成与 REST 请求相同的查询。本页是参考文档，示例基于[博客示例](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog)。

## 启用

GraphQL 默认关闭。在 **设置 → 功能 → GraphQL** 中开启（需要 `features.manage` 权限）。更改会立即生效，无需重启，端点为：

```
POST /graphql
```

它位于服务器根路径下，而不在 REST 前缀下。以 JSON 形式发送 `{ "query", "variables", "operationName" }`。`GET /graphql?query=…` 也可以执行查询（变更需要 `POST`）。

```sh title="Terminal"
curl -X POST 'https://cms.example.com/graphql' \
  -H "Authorization: Bearer $VERDIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ articles(sort: [\"publishedAt:desc\"]) { documentId title } }"}'
```

调用方的身份验证方式与 REST API 相同：公开访问不带请求头，或者使用 API 令牌，或者使用终端用户的 JWT。格式错误的 `Authorization` 请求头或未知的令牌会返回 `401`。参见[权限](/zh-cn/concepts/permissions/)。来自其他源的浏览器需要配置 `[api].cors_origins`。

### 设置

| 设置 | 默认值 | 位置 | 作用 |
| --- | --- | --- | --- |
| **GraphiQL 调试台** | 在 `verdin dev` 中开启，在 `verdin start` 中关闭 | 功能设置 | 浏览器打开 `GET /graphql` 时提供 GraphiQL。它从 unpkg.com 加载。 |
| **内省** | 开启 | 功能设置 | 允许客户端和工具读取 schema。关闭后可对公众隐藏 schema。 |
| **已禁用的操作** | 无 | 功能设置 | 按内容类型把 `find`、`findOne`、`create`、`update` 或 `delete`（或所有查询、所有变更、全部）排除在 schema 之外，类似 Strapi 的 shadow CRUD 开关。不影响 REST。 |
| `maxDepth` | `10` | 管理 API | 允许的最大选择深度。 |
| `maxComplexity` | `1000` | 管理 API | 允许的最大查询复杂度（大致等于所选字段的数量）。 |

`maxDepth` 和 `maxComplexity` 在管理后台中还没有对应的字段。请通过[管理 API](/zh-cn/api/admin/) 设置：`GET /admin/api/features` 返回当前设置，`PUT /admin/api/features/graphql` 会整体替换它们，因此也要把想保留的设置一并发送：

```json
{ "enabled": true, "settings": { "playground": false, "introspection": true, "maxDepth": 8, "maxComplexity": 500 } }
```

## Schema

对于每个内容类型，schema 中都有一个以其 `singularName` 的 PascalCase 形式命名的对象类型（`article` → `Article`，`blog-post` → `BlogPost`），包含：

- `documentId: ID!`
- 所有非 `private` 的属性
- `createdAt`、`updatedAt` 和 `publishedAt`，类型为 `DateTime`
- 本地化类型上的 `locale: String`

| 属性 | GraphQL 类型 |
| --- | --- |
| `string`、`text`、`richtext`、`email`、`uid`、`enumeration` | `String` |
| `integer` | `Int` |
| `biginteger` | `Long`（与 REST 一样是字符串） |
| `float`、`decimal` | `Float` |
| `boolean` | `Boolean` |
| `date`、`time`、`datetime` | `Date`、`Time`、`DateTime` |
| `json`、`blocks` | `JSON` |
| 对一关联 | 目标的类型，例如 `Category` |
| 对多关联 | `[Tag!]!`，带有 `filters`、`pagination` 和 `sort` 参数 |
| `media` | `UploadFile`，`multiple` 时为 `[UploadFile!]!` |
| `component` | `ComponentSharedSeo`（来自 UID `shared.seo`），可重复时为列表 |
| `dynamiczone` | `[ArticleBlocksDynamicZone!]!`，即其组件的联合类型 |
| 多态关联 | `JSON`（带有 `__type` 的文档） |

根 `Query` 还有 `verdin: String!`，即服务器的版本。

## 查询

| 集合类型 `article` | 返回 |
| --- | --- |
| `articles(filters, pagination, sort, status, locale)` | `[Article!]!` |
| `articles_connection(filters, pagination, sort, status, locale)` | 带有 `nodes` 和 `pageInfo` 的 `ArticleEntityResponseCollection` |
| `article(documentId: ID!, status, locale)` | `Article` 或 `null` |

| 单一类型 `homepage` | 返回 |
| --- | --- |
| `homepage(status, locale)` | `Homepage` 或 `null` |

查询名和字段名来自 `pluralName` 和 `singularName` 的 camelCase 形式（`blog-posts` → `blogPosts`）。

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

同样的请求用 REST 表示：

```http
GET /api/articles?filters[category][name][$eq]=News&filters[title][$containsi]=rust
  &sort=publishedAt:desc&pagination[page]=1&pagination[pageSize]=10
  &populate[category][fields][0]=name&populate[tags][sort]=label:asc&populate[0]=seo&populate[1]=blocks
```

### 参数

- **`filters`**：一个 `ArticleFiltersInput`，每个属性对应一个字段，另外还有 `documentId`、时间戳字段，以及 `and`、`or` 和 `not`。标量字段接受诸如 `StringFilterInput` 的运算符输入，其运算符就是去掉 `$` 的 [REST 运算符](/zh-cn/api/rest/#过滤)：`eq`、`ne`、`containsi`、`in`、`between`、`null`…… 关联接受目标类型的过滤输入，不可重复的组件接受其组件的过滤输入。
- **`pagination`**：`{ page, pageSize }` 或 `{ start, limit }`，默认值和最大值与 REST 相同。
- **`sort`**：由 `"field"` 或 `"field:asc|desc"` 字符串组成的列表，与 REST 相同。
- **`status`**：`PUBLISHED`（默认）或 `DRAFT`，后者需要 `readDrafts` 授权。关联文档始终跟随其父文档的状态。
- **`locale`**：本地化类型的语言区域代码；否则使用默认语言区域。

只会加载你选择的内容：选择集会转换为 REST 的 `populate`，每一层关联是一次批量查询。`articles_connection` 的 `pageInfo` 会统计全部匹配数（`total`）和页数（`pageCount`）。

## 变更

| 集合类型 `article` | 返回 |
| --- | --- |
| `createArticle(data: ArticleInput!, status, locale)` | `Article` |
| `updateArticle(documentId: ID!, data: ArticleInput!, status, locale)` | `Article` |
| `deleteArticle(documentId: ID!, locale)` | `DeleteMutationResponse`（`{ documentId }`） |

| 单一类型 `homepage` | 返回 |
| --- | --- |
| `updateHomepage(data: HomepageInput!, status, locale)` | `Homepage`；第一次更新会创建该文档 |
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

- 与 REST 一样，除非指定 `status: DRAFT`，否则 `create` 和 `update` 会直接发布。没有单独的发布变更：要取消发布或丢弃草稿，请使用 REST 的[操作](/zh-cn/api/rest/#操作)。
- 输入与属性一一对应：关联接受 `ID` 或 `[ID!]`（即 `documentId`），媒体接受文件 id，组件接受各自的 `…Input` 类型，动态区域的条目是带有 `__component` 的 `JSON` 对象。反向（`mappedBy`）关联不在输入中。
- `delete` 变更删除 `locale` 所指定的版本（未指定时为默认语言区域），相当于 `DELETE /api/articles/{documentId}?locale=fr`。
- 执行的校验与 REST 相同。

## 错误

GraphQL 错误出现在 `200` 响应的 `errors` 列表中，错误码位于 `extensions.code`：

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

| 错误码 | 何时出现 |
| --- | --- |
| `FORBIDDEN` | 调用方缺少该操作的授权，或者在 `status: DRAFT` 时缺少 `readDrafts`。 |
| `BAD_USER_INPUT` | 参数或内容无效；`details` 列出校验问题及其路径。 |
| `NOT_FOUND` | 文档不存在（在更新和删除时）。 |
| `INTERNAL_SERVER_ERROR` | 意外错误，会记录在服务器日志中。 |

深度超过 `maxDepth` 或复杂度超过 `maxComplexity` 的查询会在执行前被拒绝。

## 限制

除了 REST API 的限制之外，GraphQL 还有自己的限制（`maxDepth`、`maxComplexity`）：每个列表最多 `[api].max_page_size` 个文档，关联最多嵌套 5 层，每个文档的每个关联最多 1,000 个关联文档，最多 100 个过滤条件。参见 [REST 限制](/zh-cn/api/rest/#限制)。

## 插件

[插件](/zh-cn/extending/plugins/)可以添加形如 `name(args: JSON): JSON` 的根查询和变更。已被内容类型占用的名称会被跳过。

## 与 Strapi 对比

类型名、查询名和变更名，带有 `nodes` 和 `pageInfo` 的 `_connection` 查询，`documentId` 参数，以及 `status` 和 `locale`，都遵循 Strapi v5 的 GraphQL 插件，本地化类型也有 `locale` 字段。类型不暴露 `id`，也没有 GraphQL 订阅；如需实时更新，请使用[实时 API](/zh-cn/api/realtime/)。
