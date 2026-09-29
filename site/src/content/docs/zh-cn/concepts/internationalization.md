---
title: "国际化"
description: "Verdin 如何为每个语言区域保留文档的一个版本、哪些字段是本地化的或共享的，以及各 API 如何选择语言区域。"
sidebar:
  order: 5
---

国际化（i18n）让一个文档的内容可以使用多种语言。本页介绍其模型：语言区域、本地化字段和共享字段，以及读写时如何选择语言区域。编辑的工作流程请参见[内容本地化](/zh-cn/guides/content/localizing-content/)。

## 语言区域

项目的语言区域列在 **设置 → 国际化** 中（需要 `locales.manage` 权限）。首次启动时会添加英语（`en`）作为默认语言区域。

- 始终有一个语言区域是默认的。未指定语言区域的请求会使用它，而且它不能被删除。
- 代码由两到三个小写字母表示的语言组成，后面可以跟子标签：`en`、`fr`、`pt-BR`、`zh-Hans`。

:::caution
删除一个语言区域也会删除以该语言区域写入的所有版本。
:::

## 本地化内容类型

当 schema 中声明时，内容类型就是本地化的。此时每个文档在每个语言区域都有一个版本，它们共享同一个 `documentId`：

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

启用[草稿与发布](/zh-cn/concepts/draft-and-publish/)后，每个语言区域都有自己的草稿和已发布版本，因此法语译文可以在英语原文之前或之后发布。没有 `pluginOptions.i18n.localized` 的类型不是本地化类型，会忽略 `locale` 参数。

## 哪些内容会本地化

在本地化类型中，每个属性都是本地化的，除非它声明了 `"pluginOptions": { "i18n": { "localized": false } }`。这样的**共享**字段在整个文档中只有一个值：

- 在某个语言区域中保存共享字段，会把它写入所有语言区域的草稿。
- 发布某个语言区域时，会把它的共享字段复制到其他语言区域的已发布版本。
- 这同样适用于关联和媒体：共享的关联在每个语言区域中都链接相同的文档。

系统字段跟随版本：每个语言区域都有自己的 `createdAt`、`updatedAt` 和 `publishedAt`。`unique` 和 `uid` 的值在每个语言区域内唯一，因此两个译文可以使用相同的 slug。

## 本地化类型之间的关联

关联链接的是文档而不是版本（参见[关联](/zh-cn/concepts/relations/#按文档关联而不是按行)），因此语言区域在读取时才确定：

- 当两个类型都是本地化类型时，法语文章会显示其分类的法语版本。通过该关联的过滤也在同一语言区域中匹配。
- 当目标类型不是本地化类型时，每个语言区域看到的都是同一个目标。

## 在 API 中选择语言区域

REST 和管理 API 以 Strapi v5 的格式接受 `locale` 查询参数；GraphQL 接受 `locale` 参数：

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

- 不带 `locale` 时，请求读写默认语言区域。
- 对文档尚不存在的语言区域发送 `PUT` 会创建该版本。
- `DELETE` 只删除所请求语言区域的版本。当文档不再有任何语言区域时，指向它的链接才会被删除。
- 本地化类型的 REST 响应包含 `locale`。未知的语言区域会返回 `400` 错误。
- webhook 负载、实时事件和内容历史都会记录发生变更的版本的语言区域。

## 按语言区域的权限

管理员角色可以把内容权限限定于部分语言区域，这样法语编辑只能读取或修改法语版本。参见[权限](/zh-cn/concepts/permissions/#字段和语言区域权限)。内容 API 的授权（公开访问、API 令牌、终端用户角色）适用于所有语言区域。

## 与 Strapi 对比

模型和参数与 Strapi v5 的 i18n 一致：本地化类型、`localized: false` 字段、`?locale=` 以及默认语言区域。在 Verdin 中，i18n 是核心的一部分并且始终开启：你在 schema 中按内容类型启用它。
