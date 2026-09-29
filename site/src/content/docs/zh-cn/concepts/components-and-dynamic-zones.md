---
title: "组件和动态区域"
description: "可复用的字段组和混合区块列表，Verdin 为什么把它们以 JSON 形式存放在文档中，以及这对关联、媒体、过滤和 populate 意味着什么。"
sidebar:
  order: 2
---

组件让你可以在多个内容类型之间复用一组字段，动态区域则让编辑可以用一系列区块拼出一个页面。本页说明两者如何建模和存储，以及这如何影响它们的读取、写入和过滤。schema 格式本身请参见[内容模型](/zh-cn/concepts/content-model/)。

## 组件

组件是一组字段，在 `schema/components/<category>/` 下有自己的文件。博客示例中的 `shared.seo` 包含一个 meta 标题和描述：

```json title="schema/components/shared/seo.json"
{
  "displayName": "SEO",
  "attributes": {
    "metaTitle": { "type": "string", "maxLength": 60 },
    "metaDescription": { "type": "text", "maxLength": 160 }
  }
}
```

内容类型通过 `component` 属性使用它。`repeatable: true` 会把它变成一个列表，并且可以用 `min` 和 `max` 限定项数：

```json
"seo": { "type": "component", "component": "shared.seo" },
"links": { "type": "component", "component": "shared.link", "repeatable": true, "max": 10 }
```

组件可以包含其他组件。组件不能直接或间接地包含自身；schema 检查会拒绝这种循环。

## 动态区域

动态区域是一个列表，其中每一项可以是它所列出的任意一个组件。博客示例的文章正文混合使用了 hero 和引用：

```json
"blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"], "max": 20 }
```

每一项在 `__component` 中说明自己是哪个组件。`min` 和 `max` 限定项数。动态区域只能属于内容类型：组件不能包含动态区域。

## 以 JSON 存储

Verdin 把组件或动态区域的值存放在文档所在行的一个 JSON 列中（PostgreSQL 上为 `jsonb`，MySQL 和 MariaDB 上为 `json`，SQLite 上为文本）：

```json
// the "seo" column
{ "id": 1, "metaTitle": "Rust for CMS authors", "metaDescription": "…" }

// the "blocks" column
[
  { "__component": "blocks.hero", "id": 1, "title": "Hello", "subtitle": "…" },
  { "__component": "blocks.quote", "id": 2, "text": "…", "author": "Ferris" }
]
```

Strapi 把每个组件存放在单独的表中，通过多态链接表进行 join。而把值和文档存放在一起意味着：

- 读取文档及其组件时无需 join，无论嵌套多深。
- 发布、丢弃草稿以及[内容历史](/zh-cn/guides/content/content-history/)都会原样复制该值。
- 给组件添加字段不会改变任何表：迁移为空。
- 按组件字段过滤使用各数据库的 JSON 函数，某些过滤不可用（参见[过滤](#过滤)）。

每一项都带有一个 `id`，它是在该属性值内唯一的正整数。Verdin 会为新项分配 `id`；更新列表时请回传 `id`，以保持各项稳定。

## 组件内的关联和媒体

组件可以包含关联和媒体，它们存放在 JSON 本身中：关联存 `documentId`，媒体存文件 id。

- 组件内的关联必须是 `oneWay` 或 `manyWay`：它们指向目标，没有反向一侧。参见[关联](/zh-cn/concepts/relations/#组件内的关联)。
- 每个引用在写入时都会被检查：目标文档或文件必须存在，文件还必须符合字段的 `allowedTypes`。
- populate 组件时，引用会通过批量查询解析，使用与文档相同的状态和语言区域。已被删除的目标，或者在正在读取的版本中没有对应版本的目标，会被省略。
- 多态关联（`morphToOne`、`morphToMany`）和 `password` 字段不能放在组件中。

## 读取

与 Strapi 一样，组件和动态区域只有在 populate 时才会返回：

```http
GET /api/articles?populate[0]=seo&populate[1]=blocks
GET /api/articles?populate=*
```

被 populate 的组件会完整返回，包括嵌套组件以及已解析的关联和媒体。Strapi 需要为每个嵌套组件写一层 `populate`；为了兼容，Verdin 接受这些嵌套选项但会忽略它们。动态区域的各项按存储顺序返回，每一项都带有其 `__component`。

在 GraphQL 中，组件是一个以其 UID 命名的对象类型（`ComponentSharedSeo`），动态区域是一个联合类型（`ArticleBlocksDynamicZone`），需要用片段查询。参见 [GraphQL API](/zh-cn/api/graphql/)。

## 写入

发送属性的完整值。它会替换已存储的值：

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

每次写入时，该值都会对照组件的 schema 进行校验：未知的键、错误的类型以及动态区域不允许的 `__component` 都会报错，并带有 `["blocks", 1, "text"]` 这样的路径。与顶层字段一样，组件内的 `required` 字段在文档发布时检查。

## 过滤

| 对象 | 示例 | 说明 |
| --- | --- | --- |
| 组件的字段 | `filters[seo][metaTitle][$containsi]=rust` | 标量字段，包括嵌套组件中的字段。 |
| 可重复组件的字段 | `filters[links][url][$contains]=github` | 只要有某一项满足即算匹配。 |
| 动态区域 | `filters[blocks][__component][$eq]=blocks.quote` | 只能按 `__component` 过滤：不同组件的项有不同的字段。 |

不能按组件字段排序，组件内的 `json` 字段也不能用于过滤。运算符请参见 [REST API](/zh-cn/api/rest/#过滤)。
