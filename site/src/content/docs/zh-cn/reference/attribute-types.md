---
title: 属性类型参考
description: Verdin schema 文件中的每种属性类型，及其选项、校验、数据库存储和 API 表示形式。
sidebar:
  order: 4
  label: 属性类型
---

<!-- Written from crates/verdin-schema (convert.rs, validate.rs, model.rs),
crates/verdin-migrate/src/derive.rs and sql.rs (storage), and crates/verdin-content
(input.rs, output.rs, blocks.rs) (API). -->

属性是内容类型或组件的字段，在其 schema 文件的 `attributes` 下声明。本页列出每种 `type`、它接受的选项、Verdin 如何校验和存储它，以及它在 API 中的样子。格式与 Strapi v5 相同；差异列在[末尾](#与-strapi-的差异)。

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
    "readingTime": { "type": "integer", "min": 0 },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "seo": { "type": "component", "component": "shared.seo" }
  }
}
```

schema 文件是严格的：未知的键，或者类型不接受的选项，都是错误，`verdin schema check` 会连同其路径（`attributes.title.maxLength`）一起报告。

## 所有属性都接受的选项

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `type` | 必填 | 下列类型之一。 |
| `required` | `false` | 必须有值。在条目发布时检查（草稿可以不完整），对未启用草稿与发布的类型则在每次写入时检查。同样适用于组件和动态区域内部。 |
| `private` | `false` | 内容 API 永远不会返回，也不能用于 `filters` 或 `sort`。`password` 属性始终是 private。 |
| `configurable` | `true` | Strapi 用于管理后台构建器的标志；按原样保留。 |
| `pluginOptions.i18n.localized` | `true` | 在本地化内容类型中，`false` 表示该值在所有语言区域之间共享，而不是每个语言区域一个值。 |
| `customField` | 未设置 | `plugin::<plugin>.<field>`（或 `global::<field>`）：管理后台用插件的自定义字段编辑该属性。`type` 表示值的存储方式。参见[插件](/zh-cn/extending/plugins/)。 |
| `conditions` | 未设置 | Strapi 的条件字段（`{ "visible": <JSON Logic> }`）。规则为假时编辑器会隐藏该字段，服务器也不会要求填写隐藏的字段。 |
| `default` | 未设置 | 写入时省略该属性时新条目使用的值。必须对该类型有效。并非所有类型都接受默认值（参见各类型）。 |

属性名以字母开头，之后是字母、数字和 `_`，最多 50 个字符。在内容类型中，`id`、`documentId`、`locale`、`publicationState`、`publishedAt`、`createdAt`、`updatedAt`、`createdBy` 和 `updatedBy` 是保留名；在组件中，`id` 是保留名。两个映射到同一列的名称（`metaTitle` 和 `meta_title`）是错误。

### 值的存储位置

内容类型的每个属性都是该类型表（`collectionName`，或复数名称）中的一列，以 `snake_case` 命名。关联和媒体则存放在链接表中。草稿及其已发布版本是两行，在本地化类型中每个语言区域各一行。

各数据库的列类型：

| 列 | PostgreSQL | MySQL 和 MariaDB | SQLite |
| --- | --- | --- | --- |
| varchar | `varchar(255)` | `varchar(255)` | `text` |
| text | `text` | `longtext` | `text` |
| integer | `integer` | `int` | `integer` |
| bigint | `bigint` | `bigint` | `integer` |
| double | `double precision` | `double` | `real` |
| decimal | `numeric(p,s)` | `decimal(p,s)` | `text`（精确） |
| boolean | `boolean` | `tinyint(1)` | `integer` |
| date | `date` | `date` | `text` |
| time | `time(3)` | `time(3)` | `text` |
| datetime | `timestamptz(3)` | `datetime(3)` | `text` |
| json | `jsonb` | `json` | `text` |

一个内容类型最多有 60 个 `string`、`email`、`uid` 和 `enumeration` 属性（MySQL 的行大小限制）；更多的请使用 `text`。

### `unique`

接受 `unique: true` 的类型会在 `(column, locale, publication_state)` 上获得一个唯一索引：同一语言区域中的两个已发布条目或两个草稿不能共享一个值，而草稿及其自身的已发布版本可以。违反它的写入会以该属性上的校验错误失败。在组件内部，`unique` 会被接受但不会强制执行（组件的值以 JSON 存储）。

## 文本

### `string`

单行文本。

| 选项 | 说明 |
| --- | --- |
| `minLength`、`maxLength` | 以字符计的长度范围。`maxLength` 最大为 255。 |
| `regex` | 值必须匹配的模式。类似 JavaScript 的语法，支持环视和反向引用。 |
| `unique` | 参见 [`unique`](#unique)。 |
| `default` | 一个在长度范围内且匹配 `regex` 的字符串。 |

以 `varchar(255)` 存储。API：字符串。

### `text`

较长的纯文本（管理后台中为多行文本框）。

| 选项 | 说明 |
| --- | --- |
| `minLength`、`maxLength` | 长度范围，没有上限。 |
| `default` | 一个在长度范围内的字符串。 |

以 `text` 存储（MySQL 上为 `longtext`）。API：字符串。

### `richtext`

Markdown 文本。选项、存储和 API 与 `text` 相同；管理后台用 Markdown 编辑器编辑它。

### `blocks`

以 Strapi 的 blocks JSON 表示的富文本：由 `paragraph`、`heading`（`level` 1 到 6）、`list`（`format` 为 `ordered` 或 `unordered`，带有 `list-item` 子节点，最多嵌套 8 层）、`quote`、`code`（可选的 `language`）和 `image` 区块组成的列表。内联子节点为 `text` 节点（带有 `bold`、`italic`、`underline`、`strikethrough` 和 `code` 标记）以及 `link` 节点。最多 10,000 个区块。

没有选项，没有 `default`。以 JSON 存储。API：按原样返回的区块列表。

```json
[
  { "type": "heading", "level": 2, "children": [{ "type": "text", "text": "Hello" }] },
  { "type": "paragraph", "children": [{ "type": "text", "text": "bold", "bold": true }] }
]
```

### `email`

邮箱地址（`name@domain.tld`，不含空格）。

| 选项 | 说明 |
| --- | --- |
| `minLength`、`maxLength` | 长度范围；`maxLength` 最大为 255。 |
| `unique` | 参见 [`unique`](#unique)。 |
| `default` | 一个邮箱地址。 |

以 `varchar(255)` 存储。API：字符串。

### `password`

一个密文，写入时用 Argon2id 哈希。

| 选项 | 说明 |
| --- | --- |
| `minLength`、`maxLength` | 所发送密码的长度范围。 |

没有 `default`。始终是 private：永远不会被返回、用于过滤或排序。不允许放在组件中。以 `varchar(255)` 存储（哈希值）。导入时会原样保留已有的 bcrypt 和 Argon2 哈希，因此导入的账户仍然可以登录。

### `uid`

用于 URL 的标识符，例如 slug。管理后台会根据 `targetField` 生成它。

| 选项 | 说明 |
| --- | --- |
| `targetField` | 同一类型中用于生成该值的 `string` 或 `text` 属性。 |
| `minLength`、`maxLength` | 长度范围；`maxLength` 最大为 255。 |
| `regex` | 值必须匹配的模式；不设置时为 `^[A-Za-z0-9\-_.~]*$`。 |
| `default` | 一个有效的值。 |

始终唯一（参见 [`unique`](#unique)）。以 `varchar(255)` 存储。API：字符串。

### `enumeration`

固定列表中的一个值。

| 选项 | 说明 |
| --- | --- |
| `enum` | 可选值：至少一个，每个 1 到 255 个字符，不能重复。 |
| `default` | 可选值之一。 |

以 `varchar(255)` 存储。API：字符串。写入其他任何值都会失败。

## 数字

### `integer`

32 位整数（−2,147,483,648 到 2,147,483,647）。

| 选项 | 说明 |
| --- | --- |
| `min`、`max` | 范围（整数）。 |
| `unique` | 参见 [`unique`](#unique)。 |
| `default` | 一个在范围内的整数。 |

以 `integer` 存储。API：数字。写入时接受数字和整数字符串。

### `biginteger`

64 位整数。选项与 `integer` 相同。

以 `bigint` 存储。API：与 Strapi 一样为字符串（`"9007199254740993"`），因为 JavaScript 数字在超过 2⁵³ 后会丢失精度。写入时接受字符串和数字。

### `float`

双精度浮点数。选项与 `integer` 相同，范围为数字。

以 `double precision`（`double`、`real`）存储。API：数字。

### `decimal`

精确的十进制数。

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `precision` | `10` | 总位数，1 到 38。 |
| `scale` | `2` | 小数点后的位数，最多为 `precision`。 |
| `min`、`max` | | 范围。 |
| `unique` | | 参见 [`unique`](#unique)。 |
| `default` | | 一个在范围内的数字。 |

值会被舍入到 `scale` 位（与数据库一样四舍五入，远离零），小数点前超过 `precision - scale` 位时会被拒绝。写入时接受数字和数字字符串。以 `numeric(precision,scale)` 存储（SQLite 上为 `text`，因此不会舍入）。API：数字，与 Strapi 返回的一致。整数值为整数（`25`，而不是 `25.0`），其他值为读回后相同的最短浮点数（`12.5`）。设置 [`[api].decimal_as_string`](/zh-cn/reference/configuration/) 后，API 改为返回精确的字符串。

## 日期和布尔值

### `boolean`

`true` 或 `false`。接受 `default`。以 `boolean`（`tinyint(1)`、`integer`）存储。API：布尔值。

### `date`

日历日期，`YYYY-MM-DD`。接受 `unique` 和 `default`。以 `date` 存储。API：`"2026-09-29"`。

### `time`

一天中的时刻，`HH:MM`、`HH:MM:SS` 或 `HH:MM:SS.mmm`。接受 `unique` 和 `default`。以毫秒精度存储。API：`"14:30:00.000"`。

### `datetime`

一个时间点：带时区（`Z` 或 `+02:00`）的 ISO 8601 时间戳。接受 `unique` 和 `default`。以 UTC、毫秒精度存储。API：`"2026-09-29T12:30:00.000Z"`。

## `json`

任意 JSON 值。接受 `default`（任意 JSON）。以 `jsonb`（`json`、`text`）存储。API：按原样返回的值。在 `filters` 中，JSON 属性只支持 `$null` 和 `$notNull`，并且不能用于排序。

## 媒体

### `media`

媒体库中的文件。

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `multiple` | `false` | 存放文件列表，而不是单个文件。 |
| `allowedTypes` | 任意 | 文件种类：`images`、`videos`、`audios`、`files`（其他任何文件）。 |

没有 `default`。按顺序存储在链接表 `{table}_{attribute}_mda` 中。写入时接受文件 id：`12`、`{ "id": 12 }`、它们的列表，或者 `null`。API：只在 populate 时返回；一个文件对象（`url`、`mime`、`width`、`formats`……，与 Strapi 相同）、它们的列表，或者 `null`。参见[媒体](/zh-cn/concepts/media/)。

## 关联

### `relation`

指向另一个内容类型的文档的链接。

| 选项 | 说明 |
| --- | --- |
| `relation` | `oneToOne`、`oneToMany`、`manyToOne`、`manyToMany`、`oneWay`、`manyWay`，或者一种多态种类（见下文）。 |
| `target` | 目标内容类型：`article`、`api::article` 或 `api::article.article`。 |
| `inversedBy` | 位于双向关联的拥有方：目标上与之对应的属性。 |
| `mappedBy` | 位于另一侧：目标上的拥有方属性。 |

双向关联的两侧必须一致：`oneToMany` 对应 `manyToOne`，`oneToOne` 和 `manyToMany` 对应自身，`mappedBy` 一侧指向的属性，其 `inversedBy` 必须指回来。`oneWay` 和 `manyWay` 没有另一侧。

链接按顺序存储在拥有方（不带 `mappedBy` 的一侧）的 `{table}_{attribute}_lnk` 中，指向目标的 `documentId`。写入时接受 `documentId`：

| 写入 | 含义 |
| --- | --- |
| `"d8f3…"`、`{ "documentId": "d8f3…" }`、它们的列表 | 替换链接。 |
| `null` 或 `[]` | 移除所有链接。 |
| `{ "set": [...] }` | 替换链接。 |
| `{ "connect": [...], "disconnect": [...] }` | 添加和移除链接。`connect` 的项可以带有 `position`：`{ "before": id }`、`{ "after": id }`、`{ "start": true }` 或 `{ "end": true }`。 |

API：只在 populate 时返回关联的文档（每个条目每个关联最多 1,000 个），或者使用 `populate[tags][count]=true` 时返回 `{ "count": n }`。参见[关联](/zh-cn/concepts/relations/)。

在组件内部，只允许 `oneWay` 和 `manyWay`；组件存储的是 `documentId`。

### 多态关联

`relation` 还接受多态种类，它们可以链接任意内容类型的文档：

| `relation` | 选项 | 说明 |
| --- | --- | --- |
| `morphToOne` | 无 | 链接任意类型的一个文档。 |
| `morphToMany` | 无 | 链接任意类型的多个文档。 |
| `morphOne` | `target`、`morphBy` | 反向一侧：读取 `target` 的 `morphToOne` 或 `morphToMany` 属性 `morphBy` 的链接。 |
| `morphMany` | `target`、`morphBy` | 同上，用于多个。 |

拥有方在 `{table}_{attribute}_mph` 中存储 `(type, documentId)` 对。写入时接受 `{ "__type": "api::article", "documentId": "…" }` 项（一个、一个列表、`null` 或 `{ "set": [...] }`）。populate 后的各项在 `__type` 中带有其类型。不允许放在组件中。

## 组件和动态区域

### `component`

在 `schema/components/<category>/<name>.json` 中定义的一组字段。

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `component` | 必填 | 组件 uid，`category.name`（`shared.seo`）。 |
| `repeatable` | `false` | 存放项的列表，而不是单个项。 |
| `min`、`max` | | 项数；只与 `repeatable` 一起使用。 |

没有 `default`：新项使用其自身属性的默认值。以 JSON 存储在条目所在的行中，每一项都带有一个 `id`。写入时接受项对象（或列表），带上 `id` 可以保留已有的项。API：只在 populate 时返回整个项或列表。在 `filters` 中，可以按组件的字段过滤（`filters[seo][metaTitle][$eq]=…`）。参见[组件和动态区域](/zh-cn/concepts/components-and-dynamic-zones/)。

### `dynamiczone`

一个项的列表，每一项是若干组件之一。

| 选项 | 说明 |
| --- | --- |
| `components` | 允许的组件 uid：至少一个，不能重复。 |
| `min`、`max` | 项数。 |

每一项都在 `__component` 中带有其 uid。以 JSON 存储在条目所在的行中。API：只在 populate 时返回整个列表。用 `filters[blocks][__component][$eq]=blocks.hero` 按组件过滤。动态区域不能嵌套在组件中。

## 跨字段校验

除了针对单个属性的选项之外，内容类型还可以在 `validations` 中声明涉及多个字段的规则，它们在 `required` 被检查的时机进行检查：

```json
"validations": [
  {
    "rule": { "<=": [{ "var": "startDate" }, { "var": "endDate" }] },
    "message": "The end date must be after the start date",
    "field": "endDate"
  }
]
```

`rule` 是一个针对条目、必须成立的 JSON Logic 表达式。它可以使用 `var`、`==`、`!=`、`===`、`!==`、`<`、`>`、`<=`、`>=`、`!`、`!!`、`and`、`or`、`in`、`if`、`?:`、`+`、`-`、`*`、`/`、`%`、`min`、`max` 和 `cat`。`message` 会报告在 `field`（该类型的一个属性）或条目本身上。这是 Verdin 新增的功能；Strapi 没有对应功能。

## 与 Strapi 的差异

- **组件以 JSON 存储**在条目所在的行中，而不是存放在带有连接表的组件表中。读取无需 join；因此，`password` 属性、多态关联和双向关联不能放在组件中，`unique` 在那里也不会被强制执行。
- **populate 的组件会完整返回。** 对组件或动态区域使用 `populate` 会返回其所有字段；你不能像在 Strapi 中那样挑选嵌套字段。
- **严格的 schema 文件。** 未知的键和类型不接受的选项都是错误，而 Strapi 会忽略它们。在 `pluginOptions` 中只读取 `i18n.localized`；其余会被忽略。
- **`string`、`email` 和 `uid` 最多 255 个字符**，即列的大小，而不是在数据库层面失败。
- **`conditions`** （条件字段）的行为与 Strapi 5.17 相同：隐藏的字段不是必填项。
- **`validations`** 是 Verdin 独有的。
- 其余部分与 Strapi v5 一致：类型名称、它们的选项、以字符串表示的 `biginteger` 值、使用 `connect`、`disconnect`、`set` 和 `position` 的关联写入，以及 blocks 格式。
