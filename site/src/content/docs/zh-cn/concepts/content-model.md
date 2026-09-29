---
title: "内容模型"
description: "Verdin 如何描述你的内容：集合类型和单一类型、属性、Strapi 格式的 schema 文件，以及校验规则。"
sidebar:
  order: 1
---

内容模型是项目中定义的内容类型和组件的集合。Verdin 从中推导出其他一切：数据库表、REST 和 GraphQL API、OpenAPI 文档、校验以及管理后台的表单。本页介绍其中的各个部分以及适用于它们的规则。

## 内容类型

一个内容类型描述一类文档，例如文章或首页。它有一个 `kind`：

| 种类 | 容纳 | REST 路由（博客示例） |
| --- | --- | --- |
| `collectionType` | 任意数量的文档 | `/api/articles`、`/api/articles/{documentId}` |
| `singleType` | 至多一个文档 | `/api/homepage` |

集合类型以其 `pluralName` 提供服务，单一类型以其 `singularName` 提供服务。对单一类型的第一次 `PUT` 会创建其文档。所有路由请参见 [REST API](/zh-cn/api/rest/)。

每个内容类型都有一个 UID，即 `api::<singularName>`（`api::article`）。Strapi 把同一个 UID 写作 `api::article.article`；Verdin 在 schema 文件和导入器中都接受这种写法，并将其规范化为 `api::article`。

每个文档都有无需声明的系统字段：`id`、`documentId`（26 个字符的小写 ULID，在草稿、已发布版本和各语言区域之间保持不变）、`createdAt`、`updatedAt`、`publishedAt`，以及[本地化类型](/zh-cn/concepts/internationalization/)上的 `locale`。

## Schema 文件

内容类型和组件是项目 `schema/` 目录（`verdin.toml` 中的 `[schema].path`）下的 JSON 文件。你可以像代码一样用 git 对它们进行版本管理。

```
schema/
├── content-types/
│   ├── article.json
│   ├── category.json
│   ├── tag.json
│   └── homepage.json
└── components/
    ├── blocks/
    │   ├── hero.json
    │   └── quote.json
    └── shared/
        └── seo.json
```

格式就是 Strapi 的 `schema.json`，因此大多数 Strapi schema 无需修改即可加载。下面是[博客示例](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog)中的文章类型：

```json title="schema/content-types/article.json"
{
  "kind": "collectionType",
  "singularName": "article",
  "pluralName": "articles",
  "displayName": "Article",
  "options": { "draftAndPublish": true },
  "attributes": {
    "title": { "type": "string", "required": true, "maxLength": 200 },
    "slug": { "type": "uid", "targetField": "title", "required": true },
    "excerpt": { "type": "text", "maxLength": 500 },
    "body": { "type": "richtext" },
    "readingTime": { "type": "integer", "min": 0 },
    "featured": { "type": "boolean", "default": false },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "tags": { "type": "relation", "relation": "manyToMany", "target": "tag" },
    "seo": { "type": "component", "component": "shared.seo" },
    "blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"] }
  }
}
```

| 键 | 必填 | 说明 |
| --- | --- | --- |
| `kind` | 是 | `collectionType` 或 `singleType`。 |
| `singularName` | 是 | kebab-case。必须与文件名一致（`article.json`）。 |
| `pluralName` | 是 | kebab-case，且与 `singularName` 不同。 |
| `displayName` | 是 | 管理后台中显示的名称。 |
| `description` | 否 | 在管理后台中显示。 |
| `collectionName` | 否 | 表名。默认为 `pluralName` 的 snake_case 形式。 |
| `options.draftAndPublish` | 否 | 为每个文档保留一个草稿和一个已发布版本。默认为 `false`。参见[草稿与发布](/zh-cn/concepts/draft-and-publish/)。 |
| `pluginOptions.i18n.localized` | 否 | 每个语言区域一个版本。默认为 `false`。参见[国际化](/zh-cn/concepts/internationalization/)。 |
| `attributes` | 否 | 字段，按 API 返回它们的顺序排列。 |
| `validations` | 否 | 跨字段规则；参见[下文](#跨字段校验)。 |

schema 是严格的：未知的键、类型不支持的选项，或者引用了不存在的类型或组件，都会产生一个指明文件和路径的错误，服务器也不会启动。运行 `verdin schema check` 可以在不启动服务器的情况下校验这些文件。

有些名称已被占用：

- 属性名以字母开头，之后可以是字母、数字和下划线，最多 50 个字符。它们会变成 snake_case 的列名（`metaTitle` → `meta_title`）。
- `id`、`documentId`、`locale`、`publicationState`、`publishedAt`、`createdAt`、`updatedAt`、`createdBy` 和 `updatedBy` 在内容类型中是保留名，组件中则保留 `id`。
- `upload`、`uploads`、`auth`、`users` 和 `connect` 不能用作 `singularName` 或 `pluralName`：这些路由属于 API 本身。
- 一个内容类型最多有 60 个 `string`、`email`、`uid` 和 `enumeration` 属性，以使行大小不超过 MySQL 的限制。其中一些可以改用 `text`。

你可以在管理后台的 **内容类型构建器** 中编辑这些文件（服务器以 `verdin dev` 运行时可用），也可以手动编辑。无论哪种方式，变更都会成为一次 [schema 迁移](/zh-cn/concepts/schema-migrations/)。编辑器的布局（字段顺序、宽度、标签）不属于 schema：管理员在管理后台中配置，并存储在数据库中。

## 组件

组件是一组可复用的字段，例如 `shared.seo`（一个 meta 标题和一个 meta 描述）。它的 UID 是 `<category>.<name>`，取自其路径：`schema/components/shared/seo.json` 就是 `shared.seo`。组件文件包含 `displayName`、可选的 `description` 和 `icon`，以及 `attributes`。

动态区域是一个混合多种组件的列表，例如由 hero 区块和引用区块组成的文章正文。两者都以 JSON 形式存储在文档内部；参见[组件和动态区域](/zh-cn/concepts/components-and-dynamic-zones/)。

## 属性

每个属性都有一个 `type` 以及取决于类型的选项。所有类型、它们的选项以及在各数据库中的列类型，请参见[属性类型参考](/zh-cn/reference/attribute-types/)。

| 类别 | 类型 |
| --- | --- |
| 文本 | `string`、`text`、`richtext`（Markdown）、`blocks`（Strapi 的结构化富文本）、`email`、`uid`、`password`、`enumeration` |
| 数字 | `integer`、`biginteger`、`float`、`decimal` |
| 日期 | `date`、`time`、`datetime` |
| 其他标量 | `boolean`、`json` |
| 链接 | `relation`（参见[关联](/zh-cn/concepts/relations/)）、`media`（参见[媒体](/zh-cn/concepts/media/)） |
| 结构 | `component`、`dynamiczone` |

常用选项：

| 选项 | 作用 |
| --- | --- |
| `required` | 发布版本时必须设置该值（对于未启用草稿与发布的类型，则是每次写入时）。草稿可以不完整。 |
| `private` | 内容 API 永远不会返回、过滤、排序或 populate 该字段。`password` 属性始终是 private。 |
| `default` | 新文档未提供该字段时使用的值。会按照该属性自身的规则进行检查。 |
| `unique` | 在同一语言区域和版本中，任意两个文档的值都不能相同。适用于 `string`、`email`、数字、日期和时间类型；`uid` 始终唯一。 |
| `configurable` | `false` 会在内容类型构建器中锁定该属性：无法在其中编辑、重命名或删除。 |
| `pluginOptions.i18n.localized` | `false` 表示该值在所有语言区域之间共享。 |

在数据库中，每个属性列都可以为空。与 Strapi v5 一样，`required` 由 Verdin 在发布时强制执行，而不是通过 `NOT NULL` 约束，因此给已有数据的类型添加必填属性是一个安全的变更。

## 校验

每次写入在到达数据库之前都会对照 schema 进行检查：

- **类型和约束**，每次写入时检查：值的类型、`minLength`/`maxLength`、`min`/`max`、`regex`、`enum` 值、可重复组件和动态区域的项数、动态区域允许的组件类型，以及媒体字段接受的文件类型。输入中的未知键和系统字段都会报错。
- **必填字段和跨字段规则**，在发布版本时检查，对于未启用草稿与发布的类型则在每次写入时检查。它们同样适用于组件和动态区域内部。
- **唯一性**，由数据库中的唯一索引保证，因此两个并发写入不可能同时成功。

检查失败时返回 `400` 和一个 `ValidationError`，其 `details.errors` 列出每个问题及其路径，例如 `["seo", "metaTitle"]` 或 `["blocks", 2, "text"]`。参见[错误](/zh-cn/api/rest/#错误)。

### 跨字段校验

内容类型可以声明比较其自身字段的规则，用 [JSON Logic](https://jsonlogic.com) 编写。下面这个活动类型要求结束日期晚于开始日期，并且售出的票数不超过座位数：

```json title="schema/content-types/event.json"
{
  "kind": "collectionType",
  "singularName": "event",
  "pluralName": "events",
  "displayName": "Event",
  "attributes": {
    "startDate": { "type": "date", "required": true },
    "endDate": { "type": "date" },
    "seats": { "type": "integer", "min": 0 },
    "sold": { "type": "integer", "min": 0 }
  },
  "validations": [
    {
      "rule": { "or": [{ "!": { "var": "endDate" } }, { "<=": [{ "var": "startDate" }, { "var": "endDate" }] }] },
      "message": "must be after the start date",
      "field": "endDate"
    },
    { "rule": { "<=": [{ "var": "sold" }, { "var": "seats" }] }, "message": "more tickets sold than seats" }
  ]
}
```

- 不成立的规则会产生一个带有 `message` 的校验错误，位置在 `field`（如果给出），否则在文档本身（`path: []`）。
- 规则与 `required` 在相同的时机执行：发布时，以及对未启用草稿与发布的类型的每次写入时。草稿可以违反这些规则。
- `var` 读取文档自身的字段，可以用点号路径访问组件内部。规则无法使用关联和媒体。
- 两边都是数字时按数值比较，两边都是字符串时按文本比较，因此 ISO 格式的日期、时间和日期时间都能正确比较。空字段为 `null`：请像第一条规则那样对可选字段做保护。
- 允许的运算符：`var`、`==`、`!=`、`===`、`!==`、`<`、`>`、`<=`、`>=`、`!`、`!!`、`and`、`or`、`in`、`if`、`?:`、`+`、`-`、`*`、`/`、`%`、`min`、`max`、`cat`。未知的运算符、未知的 `field` 或空的 `message` 都是 schema 错误。

服务器负责检查规则；发布失败时，管理后台会在规则指定的字段上显示其消息。Strapi 没有对应功能。Strapi 的条件字段（`conditions`）在 schema 文件中会被接受并保留，但目前还不会生效。
