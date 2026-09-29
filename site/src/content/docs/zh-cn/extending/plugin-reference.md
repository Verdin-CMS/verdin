---
title: 插件参考
description: plugin.toml 清单、能力、钩子及其负载、宿主函数、路由、任务、GraphQL 字段、管理后台扩展点以及限制。
sidebar:
  order: 3
---

<!-- Written from crates/verdin-plugins (lib.rs, manifest.rs), crates/verdin-api/src/plugins.rs,
plugins_admin.rs, crates/verdin-graphql/src/lib.rs and admin/src/app/core/plugin-extensions.ts. -->

本页是 Verdin 与插件之间的完整约定：清单、Verdin 发送给每个导出函数的内容及其期望的返回值，以及模块可以调用的宿主函数。入门介绍请参见[插件](/zh-cn/extending/plugins/)；完整示例请参见[插件教程](/zh-cn/extending/plugin-tutorial/)。

## 插件目录

每个插件都是 `[plugins].path`（默认为 `plugins/`，与 `verdin.toml` 同级）下的一个目录：

| 文件 | 必需 | 内容 |
| --- | --- | --- |
| `plugin.toml` | 是 | 清单。 |
| `plugin.wasm` | 是 | 模块（可用 `wasm` 指定其他路径）。 |
| `admin/` | 否 | 管理后台加载的文件：`admin.script` 模块及其资源。 |

启动时，Verdin 按名称顺序加载每个包含 `plugin.toml` 的目录。如果某个目录的清单无效、模块缺失，或者其 `name` 已被另一个插件占用，该目录会被跳过，并在 **设置 → 插件** 中列出原因。

## 清单

```toml title="plugins/slugs/plugin.toml"
name = "slugs"
version = "1.0.0"
description = "Slugs from titles, and a color field"

[capabilities]
read = ["api::article"]
write = ["api::tag"]
http = ["api.example.com"]
kv = true

[limits]
timeout_ms = 5000
memory_mb = 64

[[hooks]]
on = "beforeCreate"
uid = "api::article"
function = "before_write"

[routes]
function = "handle"

[[jobs]]
schedule = "*/15 * * * *"
function = "refresh"

[[graphql]]
name = "slugStats"
function = "stats"

[admin]
script = "index.js"

[[admin.widgets]]
id = "stats"
title = "Slug stats"
element = "slugs-stats"

[[admin.fields]]
id = "color"
title = "Color"
element = "slugs-color"
type = "string"

[[settings]]
key = "separator"
label = "Separator"
type = "select"
options = ["-", "_"]
default = "-"
```

在任何表中，未知的键都是错误。

### 顶层键

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `name` | 必填 | 插件在 URL、设置和自定义字段中的 id：小写字母、数字和 `-`，以字母开头，最多 64 个字符。 |
| `version` | 必填 | 显示在管理后台和日志中。 |
| `description` | 未设置 | 显示在 **设置 → 插件** 中。 |
| `wasm` | `"plugin.wasm"` | 模块，相对于插件目录（不能包含 `..`，不能是绝对路径）。 |
| `wasi` | `false` | 为模块提供 WASI：时钟和随机数。无论如何都不提供文件或套接字。 |

### `[capabilities]`

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `read` | `[]` | `verdin_content` 可以读取（`findMany`、`findOne`）的内容类型：诸如 `api::article` 的 uid，或者 `"*"` 表示全部。 |
| `write` | `[]` | 可以执行 `create`、`update`、`delete`、`publish` 和 `unpublish` 的内容类型。隐含 `read`。 |
| `http` | `[]` | 模块可以发送 HTTP 请求的主机：`api.example.com` 或 `*.example.com`。 |
| `kv` | `false` | 插件自己的键值存储（`verdin_kv_get`、`verdin_kv_set`）。 |

能力只限制宿主调用。钩子会在其指定的类型上运行，与 `read` 无关；路由则任何人都可以访问。

### `[limits]`

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `timeout_ms` | `5000` | 单次调用的时间限制，单位为毫秒。 |
| `memory_mb` | `64` | 模块可使用的最大内存，单位为 MB。 |

两者都必须为正数。

### `[[hooks]]`

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `on` | 必填 | 事件，见下文。 |
| `uid` | `"*"` | 内容类型（`api::article`），或者 `"*"` 表示全部。 |
| `function` | 必填 | 要调用的导出函数。 |

事件：

| 写入之前 | 写入之后 |
| --- | --- |
| `beforeCreate` | `afterCreate` |
| `beforeUpdate` | `afterUpdate` |
| `beforeDelete` | `afterDelete` |
| `beforePublish` | `afterPublish` |
| `beforeUnpublish` | `afterUnpublish` |
| `beforeDiscardDraft` | `afterDiscardDraft` |

这些名称沿用 Strapi 的生命周期名称。钩子会在来自管理后台、REST 和 GraphQL API 以及发布计划的写入时运行，但不会在插件执行的写入（参见[插件执行的写入](#插件执行的写入)）或 `verdin import` 命令执行的写入时运行。

### `[routes]`

| 键 | 说明 |
| --- | --- |
| `function` | 处理所有发往 `/api/plugins/<name>` 和 `/api/plugins/<name>/…` 的请求的导出函数，任意方法。 |

该路径跟随 `[api].prefix`。

### `[[jobs]]`

| 键 | 说明 |
| --- | --- |
| `schedule` | Cron 表达式，使用 UTC，秒字段可选：`*/15 * * * *`、`0 0 3 * * *`。 |
| `function` | 要调用的导出函数。 |

### `[[graphql]]`

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `name` | 必填 | 字段名：以小写字母开头，之后可以是字母、数字和 `_`。 |
| `function` | 必填 | 解析该字段的导出函数。 |
| `mutation` | `false` | 把该字段添加到 `Mutation` 而不是 `Query`。 |
| `description` | 未设置 | 该字段在 schema 中的描述。 |

每个条目都会添加 `name(args: JSON): JSON`。已被内容类型占用的名称，或者已被另一个插件先占用的名称，会被跳过，并在日志中记录一条警告。

### `[admin]`

| 键 | 说明 |
| --- | --- |
| `script` | `admin/` 下定义自定义元素的 ES 模块（不能包含 `..`，不能是绝对路径）。 |
| `[[admin.widgets]]` | 仪表盘小组件类型：`id`、`title`、`element`，可选的 `description`。 |
| `[[admin.fields]]` | 自定义字段：`id`、`title`、`element`、`type`（值存储时所用的属性类型，例如 `string` 或 `json`），可选的 `description`。 |

`element` 是一个自定义元素名：小写字母、数字和 `-`，至少包含一个 `-`（`slugs-color`）。

### `[[settings]]`

声明 **设置 → 插件 → 设置** 中的表单。如果没有声明，设置就是一个自由格式的 JSON 对象。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `key` | 必填 | 设置对象中的键：字母、数字和 `_`，不能以数字开头，必须唯一。 |
| `label` | 必填 | 表单标签。 |
| `type` | `"string"` | `string`、`text`、`url`、`number`、`integer`、`boolean` 或 `select`。 |
| `description` | 未设置 | 字段下方的帮助文本。 |
| `required` | `false` | 必须有值（文本类型不能为空），除非设置了 `default`。 |
| `options` | `[]` | `select` 的选项（`select` 必须提供）。 |
| `default` | 未设置 | 键缺失或为 `null` 时使用。必须符合该字段。 |
| `min`、`max` | 未设置 | `number` 和 `integer` 值的范围；`string` 和 `text` 的长度范围。 |

`url` 值为空或是 `http(s)://` URL。声明了表单时，服务器会拒绝带有未知键、类型错误、值超出范围或缺少必填值的设置（400）。

## 导出函数

每个导出函数接收一个 JSON 文档并返回一个 JSON 文档（或者什么都不返回）。空输出视为 `null`；不是 JSON 的输出视为失败。

### before 钩子

输入：

```json
{
  "event": "beforeUpdate",
  "uid": "api::article",
  "documentId": "01m3p88ry359w82nsx496mep5t",
  "locale": "en",
  "data": { "title": "Hello" }
}
```

| 字段 | 说明 |
| --- | --- |
| `event` | 钩子的事件。 |
| `uid` | 内容类型。 |
| `documentId` | 文档；在 `beforeCreate` 中为 `null`。 |
| `locale` | 在本地化类型上，为写入的语言区域（请求未指定时为默认语言区域）；在其他类型上为 `null`。 |
| `data` | 正在写入的数据，与请求发送的一致：用于创建和更新。其他事件中为 `null`。更新时只包含发送的字段。 |

输出：

| 输出 | 作用 |
| --- | --- |
| `{ "data": { … } }` | 替换要写入的数据。它会像原始数据一样经过校验。 |
| `{ "error": "message" }` | 拒绝写入：调用方会收到带有该消息的 400。 |
| `{}` 或其他任何内容 | 写入照常进行。 |

当有多个钩子匹配时，它们先按插件顺序（目录名）、再按清单中的顺序运行；每个钩子看到的是前一个钩子返回的数据。失败的钩子（trap、超时、无效输出）会被记录并跳过：写入照常进行。

### after 钩子

输入：`{ "event", "uid", "documentId", "locale" }`，在写入提交之后发送。输出会被忽略；失败会被记录。如果需要条目的字段，请用 `verdin_content` 读取（需要 `read` 能力）。

### 路由

输入：

```json
{
  "method": "GET",
  "path": "/stats",
  "query": "page=2&sort=title",
  "headers": { "accept": "application/json", "user-agent": "curl/8.7.1" },
  "body": "",
  "actor": { "kind": "public" }
}
```

| 字段 | 说明 |
| --- | --- |
| `method` | HTTP 方法。 |
| `path` | `/api/plugins/<name>` 之后的路径，以 `/` 开头（插件根路径为 `/`）。 |
| `query` | 原始查询字符串，不带 `?`（没有时为空）。 |
| `headers` | 只包含 `content-type`、`accept`、`user-agent` 和 `accept-language`（如果存在）。 |
| `body` | 字符串形式的请求体（无效的 UTF-8 会被替换）。 |
| `actor` | 调用者：`{ "kind": "public" }`、`{ "kind": "token", "id": 3 }`（API 令牌）或 `{ "kind": "user", "id": 12 }`（已登录的终端用户）。 |

带有无效令牌的 `Authorization` 请求头会在调用插件之前以 401 拒绝。公开访问和 API 令牌的权限不会被应用：请自行检查 `actor`。

输出：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `status` | `200` | HTTP 状态码。 |
| `headers` | 无 | 响应头。只保留 `content-type`、`cache-control`、`location`、`etag`、`last-modified` 和 `content-disposition`。 |
| `body` | 空 | 字符串会原样发送（除非你设置了 `content-type`，否则为 `text/plain`）；其他任何 JSON 值以 `application/json` 发送。 |

已停用或未知的插件，或者没有 `[routes]` 的插件，返回 404。调用失败时返回 502 以及 `{ "data": null, "error": { "status": 502, "name": "PluginError", … } }`。路由与内容 API 共用 `[server].body_limit` 和 `[server].request_timeout_secs`。

### 任务

输入：`{ "scheduledAt": "2026-09-29T03:00:00+00:00" }`，即本次运行计划执行的时间。输出会被忽略；失败会被记录。任务只在插件开启时运行，并且只在 `[plugins].run_jobs = true` 的实例上运行。服务器宕机期间错过的运行不会补跑。

### GraphQL 字段

输入：`{ "args": …, "actor": … }`，其中 `args` 是该字段的 `args` 参数（任意 JSON，或 `null`），`actor` 与路由中的相同。输出即该字段的值。失败或插件已停用时，返回错误码为 `PLUGIN_ERROR` 的 GraphQL 错误。与路由一样，由插件自行检查访问权限。

## 宿主函数

从 `extism:host/user` 命名空间导入它们（在 Rust 中为 `extern "ExtismHost"`）。它们以字符串形式接收和返回 JSON；`extism-pdk` 中的 `Json<Value>` 会处理转换。

| 函数 | 输入 | 输出 |
| --- | --- | --- |
| `verdin_log` | `{ "level": "info" \| "warn" \| "error", "message": "…" }` | 无 |
| `verdin_content` | 内容请求（见下文） | 结果，或 `{ "error": "…" }` |
| `verdin_kv_get` | 键，普通字符串 | 存储的 JSON 值，或 `null` |
| `verdin_kv_set` | `{ "key": "…", "value": … }` | 无 |
| `verdin_config` | 无 | 设置对象，已填入声明的默认值 |

### `verdin_log`

写入服务器日志（带有插件名称）以及 **设置 → 插件 → 日志** 中该插件的日志。其他级别视为 `info`。插件日志在内存中保留最近 200 条消息，每条截断为 2,000 个字符。

### `verdin_content`

```json
{ "op": "findMany", "uid": "api::article", "query": { "filters": { "title": { "$eq": "x" } }, "sort": ["title"] } }
```

| 字段 | 使用者 | 说明 |
| --- | --- | --- |
| `op` | 全部 | `findMany`、`findOne`、`create`、`update`、`delete`、`publish` 或 `unpublish`。 |
| `uid` | 全部 | 内容类型。必须在能力范围内。 |
| `documentId` | `findOne`、`update`、`delete`、`publish`、`unpublish` | 文档。 |
| `query` | `findMany`、`findOne` | 以 JSON 对象表示的 REST API 参数：`filters`、`sort`、`fields`、`populate`、`pagination`、`status`。 |
| `data` | `create`、`update` | 要写入的字段，与 REST 请求中的 `data` 相同。 |
| `status` | `create`、`update` | `"draft"` 只保存草稿。否则写入会被发布，与不带 `?status=draft` 的 REST 写入相同。 |
| `locale` | 全部 | 要读写的语言区域。 |

结果：

| `op` | 结果 |
| --- | --- |
| `findMany` | `{ "documents": [...], "meta": { "pagination": {…} } }` |
| `findOne` | `{ "document": {…} }`（未找到时为 `null`） |
| `create`、`update` | `{ "documentId": "…" }` |
| `delete` | `{ "deleted": true }` |
| `publish` | `{ "published": true }` |
| `unpublish` | `{ "unpublished": true }` |

超出能力范围的调用、未知的操作、校验错误或文档不存在时，会改为返回 `{ "error": "…" }`。除非查询要求 `"status": "draft"`，否则读取返回已发布版本。

#### 插件执行的写入

通过 `verdin_content` 执行的写入会跳过所有插件的 **before** 钩子，因此插件不会在那里因自己的修改而陷入循环。其他一切照常适用：校验、审核阶段、webhook、历史记录、审计日志，以及所有插件（包括执行写入的插件）的 **after** 钩子。如果 after 钩子会写入它所监听的类型，请加以防护。

### `verdin_kv_get` 和 `verdin_kv_set`

每个插件一个键值存储，位于 Verdin 的数据库中，由所有实例共享。键为 1 到 255 字节；值可以是任意 JSON。设置为 `null` 会删除该键。没有 `kv` 能力时，读取返回 `null`，写入会被忽略。

### `verdin_config`

返回在 **设置 → 插件** 中保存的设置，并为缺失的键填入每个已声明设置的 `default`。没有保存任何内容时返回 `{}`。

### HTTP

在 `http` 中列出主机后，使用 Extism 的 HTTP 支持（Rust 中为 `extism_pdk::http::request`）。发往其他主机的请求会失败。

## 管理后台扩展点

管理后台会向服务器请求已启用插件的扩展，并以 ES 模块的形式从 `/admin/plugins/<name>/<script>`（位于 `[admin].path` 下）导入每个 `admin.script`，每个只导入一次。插件开启期间，插件 `admin/` 目录下的文件会在该位置提供，并带有 `X-Content-Type-Options: nosniff` 和 `Cache-Control: no-cache`。模块必须定义清单中指定的自定义元素；3 秒内未定义的元素会被省略。

### 小组件

每个 `[[admin.widgets]]` 条目都是管理员可以添加到仪表盘的一种小组件类型。该元素会收到一个 `context` 属性：

| 属性 | 说明 |
| --- | --- |
| `apiBase` | 内容 API 的基础路径，例如 `/api`。 |
| `adminApiBase` | 管理 API 的基础路径，例如 `/admin/api`。 |
| `fetch(path, init)` | 带有已登录管理员凭据的 `fetch`。相对路径相对于 `adminApiBase` 解析；位于任一基础路径下的路径和绝对 URL 保持不变。 |

```js title="plugins/slugs/admin/index.js"
class SlugStats extends HTMLElement {
  set context(context) {
    // Admin API, with the admin's session.
    context.fetch('auth/me').then((response) => response.json())
      .then(({ data }) => { this.textContent = `Hello ${data.firstname ?? data.email}`; });
    // The plugin's own route, on the content API: sent without the admin's session.
    context.fetch(`${context.apiBase}/plugins/slugs/stats`).then((response) => response.json())
      .then((stats) => { this.title = JSON.stringify(stats); });
  }
}
customElements.define('slugs-stats', SlugStats);
```

`context.fetch` 只在管理 API 请求中发送管理员的会话。位于 `context.apiBase` 下的路径（内容 API，包括你的插件的路由）不带会话，因为内容 API 不接受管理员会话；这些请求以公开角色的权限进行响应。在 0.10 之前，它在这些请求中也会发送会话，导致请求失败；为 0.9 编写的、调用普通 `fetch` 的小组件仍然可以正常工作。

### 自定义字段

每个 `[[admin.fields]]` 条目都是一个字段，属性可以通过 `"customField": "plugin::<name>.<id>"` 使用它；属性的 `type` 必须与该字段存储值的方式一致。**内容类型构建器** 会提供它。该元素会收到：

| 属性 | 说明 |
| --- | --- |
| `value` | 当前值。 |
| `disabled` | 是否禁止编辑。 |
| `attribute` | schema 中该属性的定义。 |
| `locale` | 正在编辑的语言区域。 |

它通过一个 `change` 事件报告新值，事件的 `detail` 就是该值（如果没有 `detail`，则通过其自身的 `value` 属性）。当插件关闭或其元素缺失时，编辑器会显示对应存储类型的常规输入控件。参见[属性类型](/zh-cn/reference/attribute-types/)。

## 运行时和限制

| 限制项 | 值 |
| --- | --- |
| 每次调用的时间 | `[limits].timeout_ms`，默认 5,000 ms |
| 内存 | `[limits].memory_mb`，默认 64 MB |
| 并发 | 每个插件同一时间只处理一次调用；调用之间相互等待 |
| 模块实例 | 每个插件一个，首次使用时构建；调用失败后重建（其内存会丢失） |
| 日志 | 每个插件 200 条消息，每条 2,000 个字符，保存在内存中 |
| KV 键 | 1 到 255 字节 |
| 路由请求头 | `content-type`、`accept`、`user-agent`、`accept-language` |
| 路由响应头 | `content-type`、`cache-control`、`location`、`etag`、`last-modified`、`content-disposition` |

对清单或模块的修改在重启后生效；开关和设置立即生效。管理插件需要 `plugins.manage`（参见[权限参考](/zh-cn/reference/permissions/)）。
