---
title: "关联"
description: "关联的种类、Verdin 如何按 documentId 链接文档、排序、多态关联，以及 oneWay 和 manyWay 在组件内的含义。"
sidebar:
  order: 3
---

关联把两个内容类型的文档链接起来，例如一篇文章和它的分类。本页介绍关联的种类、链接如何存储和解析，以及写入、排序和读取关联的规则。请求语法请参见 [REST API](/zh-cn/api/rest/#写入)。

## 种类

关联是一个 `type: "relation"` 的属性，带有一个 `relation` 种类和一个 `target` 内容类型：

| 种类 | 一个文档链接到 | 一个目标可被链接自 | 反向一侧 |
| --- | --- | --- | --- |
| `oneWay` | 一个目标 | 任意数量的文档 | 无 |
| `manyWay` | 多个目标 | 任意数量的文档 | 无 |
| `manyToOne` | 一个目标 | 任意数量的文档 | `oneToMany` |
| `oneToMany` | 多个目标 | 一个文档 | `manyToOne` |
| `oneToOne` | 一个目标 | 一个文档 | `oneToOne` |
| `manyToMany` | 多个目标 | 任意数量的文档 | `manyToMany` |

博客示例把文章链接到一个分类（带反向一侧）和若干标签（不带反向一侧）：

```json title="schema/content-types/article.json (excerpt)"
"category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
"tags": { "type": "relation", "relation": "manyToMany", "target": "tag" }
```

```json title="schema/content-types/category.json (excerpt)"
"articles": { "type": "relation", "relation": "oneToMany", "target": "article", "mappedBy": "category" }
```

- 带有 `inversedBy`（或两个键都没有）的一侧是**拥有方**：它存储链接，也是你写入的一侧。
- 带有 `mappedBy` 的一侧是**反向方**：它反向读取拥有方的链接，并且是只读的。写入它会产生一个指明拥有方属性的校验错误。
- 两侧必须一致：`mappedBy` 指向目标上的一个属性，该属性通过 `inversedBy` 指回来，并且种类与表中对应的反向种类相匹配。
- `oneWay` 和 `manyWay` 永远没有反向一侧。

内容类型构建器会自动在目标上创建反向属性。

## 按文档关联，而不是按行

一个文档有多行：一个草稿和一个已发布版本，每个语言区域各一份。Verdin 把关联存储为从源**行**到目标**文档**（其 `documentId`）的链接，存放在名为 `{table}_{field}_lnk` 的链接表中。目标行在读取关联时才确定：

- 已发布的文章看到的是其分类的已发布版本；它的草稿看到的是分类的草稿。未启用草稿与发布的类型只有一个版本，所有读者看到的都是它。
- 当目标也是本地化类型时，读取会在同一语言区域中解析它。非本地化的目标类型由所有语言区域共享。
- 取消发布一个分类会让它从已发布的文章中隐藏，而不会触碰任何链接；再次发布它就会重新出现。
- 发布一篇文章只会把它自己的链接复制到已发布版本。

Strapi 链接的是行 id，因此每次发布草稿时都必须重写链接。Verdin 从不需要这样做，发布始终只是复制一次草稿行。

完整性由 Verdin 而不是外键来保证：链接一个不存在的文档会产生校验错误，删除一个文档会在同一事务中移除指向它的链接。

### 每个目标一个文档

对于 `oneToOne` 和 `oneToMany`，一个目标最多属于一个源文档。链接一个已被其他文档持有的目标会**移动**它：在同一次写入中移除另一个文档的链接。这与 Strapi 的行为一致。该规则按版本执行：草稿和它的已发布版本可以持有同一个目标。

## 写入

在拥有方一侧，`data` 接受一个 `documentId`、一个 `documentId` 列表，或者一个描述变更的对象：

| 输入 | 作用 |
| --- | --- |
| `"k2m…"` 或 `{ "documentId": "k2m…" }` | 链接一个目标（对一关联）。 |
| `["k2m…", "p9x…"]` | 按此顺序替换所有链接。 |
| `null` 或 `[]` | 移除所有链接。 |
| `{ "set": ["k2m…"] }` | 替换所有链接。 |
| `{ "connect": [...], "disconnect": [...] }` | 添加和移除链接，保留其他链接。 |

向对一关联 connect 一个新目标会替换之前的目标。`set` 不能与 `connect` 或 `disconnect` 组合使用。

在管理后台中，关联字段会列出已链接的条目。**链接一个条目**（对多关联为 **链接条目**）会打开一个对话框，在目标类型的条目中跨文本字段进行搜索；当目标是本地化类型时，在该条目的语言区域中搜索。选择一个条目，或者勾选多个条目后一并添加；已链接的条目会被标记出来。

## 排序

对多关联会保持其链接的顺序。列表或 `set` 会按你发送的顺序存储。`connect` 的各项可以指定位置：

```json
{
  "data": {
    "tags": {
      "connect": [
        { "documentId": "k2m…", "position": { "before": "p9x…" } },
        { "documentId": "a7c…", "position": { "end": true } }
      ]
    }
  }
}
```

`position` 可以是 `{ "before": documentId }`、`{ "after": documentId }`、`{ "start": true }` 或 `{ "end": true }`。每次写入时位置都会重新编号。除非 populate 要求 `sort`，否则读取时按链接顺序返回关联文档。

## 读取

关联只有在 populate 时才会返回：

```http
GET /api/articles?populate[category][fields][0]=name&populate[tags][sort]=label:asc
```

对一关联是一个对象或 `null`；对多关联是一个数组。每个被 populate 的关联都可以有自己的 `fields`、`filters`、`sort`、`populate` 和 `count`，最深五层。每一层对每个关联执行一次批量查询（`WHERE … IN (…)`），而不是 join，因此深层 populate 不会让行数成倍增加。每个文档的每个关联最多返回 1,000 个关联文档；`count` 给出精确的数量。

可以通过关联进行过滤（`filters[category][name][$eq]=News`），关联的任一侧均可，也可以按对一关联的字段排序（`sort=category.name:asc`）。通过关联对调用方无权读取的类型进行 populate、过滤或排序会被拒绝（`populate=*` 会跳过它），因此关联永远不会泄露调用方[权限](/zh-cn/concepts/permissions/)所隐藏的内容。

## 组件内的关联

[组件](/zh-cn/concepts/components-and-dynamic-zones/)可以包含关联，但只能是 `oneWay` 和 `manyWay`：

```json title="schema/components/shared/related.json"
{
  "displayName": "Related",
  "attributes": {
    "label": { "type": "string" },
    "articles": { "type": "relation", "relation": "manyWay", "target": "article" }
  }
}
```

组件的 JSON 直接存储 `documentId`：`oneWay` 为字符串，`manyWay` 为数组。这就是其他种类不能在组件中使用的原因：

- 反向一侧必须搜索每个文档的 JSON 才能找出谁链接了它。
- 没有这种搜索，也无法保证“每个目标一个文档”（`oneToOne`、`oneToMany`）。

在组件内部，`manyWay` 列表的顺序就是数组的顺序。引用在写入时检查，在 populate 组件时按文档的状态和语言区域解析；已不存在的目标会被省略。它们不能用于过滤。

## 多态关联

`morphToOne` 和 `morphToMany` 可以链接任意内容类型的文档。它们的链接在 `documentId` 旁边存储目标的类型，写入时需要同时指定两者：

```json
{ "data": { "related": [{ "__type": "api::article", "documentId": "k2m…" }, { "__type": "api::page", "documentId": "p9x…" }] } }
```

populate 得到的各项是带有 `__type` 的目标文档，按请求的状态和语言区域读取。反向一侧 `morphOne` 和 `morphMany` 指明拥有方类型（`target`）及其属性（`morphBy`），并且是只读的。多态关联不能用于过滤或排序，也不能放在组件中。
