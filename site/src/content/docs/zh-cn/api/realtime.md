---
title: "实时 API"
description: "Verdin 实时事件流所用的 Server-Sent Events 协议：端点、身份验证、事件名和消息格式，以及管理后台的在线状态协议。"
sidebar:
  order: 5
  label: "实时"
---

Verdin 会在内容和媒体的变更提交时，通过 [Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events)（SSE）推送这些变更。每个订阅者只会收到它有权读取的内容的事件。本页介绍该协议；如何在前端中使用，请参见[实时更新](/zh-cn/guides/frontend/realtime/)。

## 启用

实时功能默认关闭。在 **设置 → 功能 → 实时协作** 中开启（需要 `features.manage` 权限）。关闭时，这些端点返回 `404`。

## 内容事件流

```
GET /api/_events
GET /api/_events?types=api::article,api::category
```

| 参数 | 说明 |
| --- | --- |
| `types` | 可选，以逗号分隔的内容类型 UID；`plugin::upload` 表示媒体库。Strapi 的 `api::article.article` 写法同样有效。不传时，会收到你有权读取的所有类型。 |

身份验证方式与 REST API 相同：在 `Authorization: Bearer …` 中携带 API 令牌或终端用户的 JWT，公开访问则不带请求头。令牌无效时，会在事件流打开前返回 `401`。

```sh title="Terminal"
curl -N -H "Authorization: Bearer $VERDIN_TOKEN" \
  'https://cms.example.com/api/_events?types=api::article'
```

```text
event: ready
data: {}

event: entry.publish
data: {"event":"entry.publish","uid":"api::article","documentId":"k2m7q4dx8n5t1v3b9c0e6a2wfr","locale":"en"}

event: media.create
data: {"event":"media.create","uid":"plugin::upload","documentId":"v3k9…","fileId":5}
```

## 消息

第一个事件始终是 `ready`。之后每次变更都是一个以该变更命名的 SSE 事件，其 `data` 是一个 JSON 对象：

| 字段 | 出现条件 | 说明 |
| --- | --- | --- |
| `event` | 始终 | 事件名，与 SSE 的 `event:` 行相同。 |
| `uid` | 始终 | 内容类型 UID，媒体为 `plugin::upload`。 |
| `documentId` | 始终 | 发生变更的文档或文件。 |
| `locale` | 本地化类型 | 发生变更的版本的语言区域。 |
| `fileId` | 媒体事件 | 文件的数字 id，与媒体字段中使用的相同。 |
| `actorId` | 管理后台事件流 | 做出变更的管理员（当变更由管理员做出时）。 |

| 事件 | 发送时机 | 接收者 |
| --- | --- | --- |
| `entry.create`、`entry.update`、`entry.discard-draft` | 文档被创建、保存，或其草稿被丢弃 | 在启用草稿与发布的类型上，为拥有 `readDrafts` 的调用方（这些事件只改变草稿）。在其他类型上，为拥有 `find` 或 `findOne` 的调用方。 |
| `entry.publish`、`entry.unpublish`、`entry.delete` | 文档被发布、取消发布或删除 | 在该类型上拥有 `find` 或 `findOne` 的调用方 |
| `media.create`、`media.update`、`media.delete` | 文件被上传、编辑或删除 | 在媒体库上拥有 `find` 或 `findOne` 的调用方 |

事件只携带 id，不携带内容。要读取内容，请以调用方的常规权限通过 REST 或 GraphQL API 获取该文档或文件。所有 API 都会产生事件：REST、GraphQL、管理后台、发布计划和插件。

## 连接生命周期

- 服务器每 15 秒发送一条保活注释。
- 内容事件流在一小时后结束。请重新连接（浏览器的 `EventSource` 会自动重连），重连时也会再次校验令牌。
- 名为 `lagged` 的事件（`data: {"missed": 12}`）表示客户端读取太慢，丢失了相应数量的事件。请重新获取客户端所展示的数据。
- 没有重放：客户端断开期间发生的事件之后不会补发。

浏览器的 `EventSource` 无法发送 `Authorization` 请求头。公开访问可以直接使用；使用令牌时，请使用带流式响应体读取器的 `fetch`，或者支持自定义请求头的 SSE 客户端。

## 管理后台事件流

管理后台使用管理员的访问令牌打开自己的事件流：

```
GET /admin/api/events?types=api::article
```

对于管理员有权读取的类型（需要 `content.read` 和 `media.read`），它会推送同样的内容和媒体事件（包括草稿），此外还有：

- 管理员所做变更中的 `actorId`；
- `presence` 事件（见下文）；
- `comment.create`、`comment.update`、`comment.delete`、`comment.resolve`、`comment.reopen`、`task.create`、`task.update` 和 `task.delete`，并附带该条目的 `uid`、`documentId` 和 `locale`。

管理后台事件流在 15 分钟后结束，即访问令牌的有效期：请用新的访问令牌重新连接。

### 在线状态

条目编辑器会告诉服务器谁正在查看某个条目：

```
POST /admin/api/presence
{ "uid": "api::article", "documentId": "k2m7q4…", "locale": "en", "editing": true }
```

- 编辑器打开期间，大约每 20 秒发送一次。`editing: true` 表示该管理员有未保存的更改。编辑器关闭时发送 `"leave": true`。
- 在线状态在最后一次心跳 45 秒后过期。
- 响应会列出正在查看该条目的人：`{ "data": [{ "userId": 3, "name": "Ada Lovelace", "editing": true, "holdsLock": true }] }`。
- `GET /admin/api/presence?uid=&documentId=&locale=` 读取同一个列表。
- 列表发生变化时，管理后台事件流会收到一个 `presence` 事件，其中包含该条目的 `uid`、`documentId`、`locale`，以及位于 `presence` 中的列表。

第一个仍在编辑的管理员持有软锁（`holdsLock`）。编辑器会向其他人显示该锁，但不会阻止他们保存。读取在线状态需要该类型上的 `content.read`。

## 多个实例

启用共享事件总线（`[cluster].bus = "database"`）后，每个实例的事件流都会带有所有实例的事件，在线状态和软锁在每个实例上也都一致。来自其他实例的事件会在 `[cluster].poll_interval_ms` 内到达（MySQL、MariaDB、SQLite），或者立即到达（PostgreSQL，`LISTEN/NOTIFY`）。没有总线时，事件和在线状态只属于客户端所连接的那个实例：请对 `/api/_events` 和 `/admin/api/events` 使用会话保持（sticky session），或者让实时客户端都连接同一个实例。参见[扩缩容](/zh-cn/deploy/scaling/#共享事件总线)。
