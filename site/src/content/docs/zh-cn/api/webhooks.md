---
title: "Webhook"
description: "Webhook 的事件、负载格式、请求头、签名校验、重试以及投递日志。"
sidebar:
  order: 6
---

当内容或媒体发生变化时，webhook 会向你的 URL 发送一个 HTTP `POST`。本页是面向接收方的参考文档：事件、负载、请求头、签名和投递。要在管理后台中创建和管理 webhook，请参见 [Webhook](/zh-cn/guides/integrations/webhooks/)。

## 事件

| 事件 | 发送时机 |
| --- | --- |
| `entry.create` | 文档被创建，来源可以是任何 API：REST、GraphQL、管理后台或插件。 |
| `entry.update` | 文档被保存。 |
| `entry.publish` | 文档被发布。通过 REST 或 GraphQL 创建或更新文档而不带 `status=draft` 时会将其发布。 |
| `entry.unpublish` | 文档被取消发布。 |
| `entry.discard-draft` | 文档的草稿被丢弃。 |
| `entry.delete` | 文档被删除。 |
| `media.create`、`media.update`、`media.delete` | 文件被上传、编辑或删除。删除文件夹时，会为其中的每个文件发送 `media.delete`。 |
| `releases.publish` | 一个[发布计划](/zh-cn/guides/content/releases/)已执行（立即执行或在设定的日期执行）。 |
| `review-workflows.updateEntryStage` | 条目移动到了另一个[审核阶段](/zh-cn/guides/content/review-workflows/)。 |

一个 webhook 订阅部分事件，并且可以限定于部分内容类型。媒体事件不与内容类型绑定。

## 负载

每个负载都包含 `event` 和 `createdAt`（事件进入队列的时间）。条目事件还会加上内容类型和文档：

```json
{
  "event": "entry.publish",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "model": "article",
  "uid": "api::article",
  "locale": null,
  "entry": {
    "id": 3,
    "documentId": "k2m7q4dx8n5t1v3b9c0e6a2wfr",
    "title": "Hello, Verdin",
    "slug": "hello-verdin",
    "createdAt": "2026-09-25T08:55:00.000Z",
    "updatedAt": "2026-09-25T09:00:00.000Z",
    "publishedAt": "2026-09-25T09:00:00.000Z"
  }
}
```

- `model` 是该类型的 `singularName`，`uid` 是它的 UID，`locale` 是发生变更的版本的语言区域（在未本地化的类型上为 `null`）。
- `entry` 是 REST API 返回的文档，但不包含关联、媒体、组件和 `private` 字段。
- `entry.publish` 携带已发布的版本。其他条目事件携带草稿；在未启用草稿与发布的类型上，携带唯一的版本。
- `entry.delete` 只携带 `{ "documentId": … }`。

媒体事件在 `media` 中发送文件对象，不包含 `model`、`uid` 或 `entry`：

```json
{
  "event": "media.create",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "media": { "id": 5, "documentId": "v3k9…", "name": "harbour.jpg", "mime": "image/jpeg", "url": "/uploads/harbour_4f1c.jpg" }
}
```

`releases.publish` 发送 `release` 及其每个操作的结果。`review-workflows.updateEntryStage` 发送：

```json
{
  "event": "review-workflows.updateEntryStage",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "model": "article",
  "uid": "api::article",
  "entry": { "documentId": "k2m7q4…", "locale": "en" },
  "workflow": { "id": 1, "name": "Editorial" },
  "stages": { "from": { "id": 1, "name": "To do" }, "to": { "id": 2, "name": "In review" } }
}
```

与条目事件一样，`model` 是单数名称，`uid` 是内容类型的 UID（在 0.10 之前，这里的 `model` 存放的是 UID）。

**发送测试事件** 按钮会发送 `{ "event": "trigger-test", "createdAt": … }`。

## 请求头

| 请求头 | 值 |
| --- | --- |
| `content-type` | `application/json` |
| `x-verdin-event` | 事件名。 |
| `x-verdin-delivery` | 投递 id。重试时保持不变：可用它忽略重复投递。 |
| `x-verdin-signature` | `t=<unix seconds>,v1=<hex>`，webhook 启用签名时发送。 |

webhook 可以添加自己的请求头，例如供你的端点使用的 `authorization` 令牌。上面列出的请求头不能被覆盖。

## 校验签名

webhook 默认启用签名。`v1` 是以 webhook 密钥（`whsec_…`）为密钥、对 `<t>.<raw body>` 计算出的十六进制 HMAC-SHA256。密钥只会在创建 webhook 或轮换密钥时显示一次。

校验一次投递的步骤：

1. 把请求头拆分为 `t` 和 `v1`。
2. 如果 `t` 与你的时钟相差超过几分钟，则拒绝。
3. 对 `t`、一个点号和**原始**请求体计算 HMAC。不要先解析 JSON 再重新序列化：那样字节会不同。
4. 以恒定时间与 `v1` 进行比较。

```js title="verify.mjs"
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, header, rawBody, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=')));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const received = parts.v1 ?? '';
  return (
    received.length === expected.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  );
}
```

使用 Express 时，先读取原始请求体并校验，然后再解析：

```js title="server.mjs"
import express from 'express';
import { verify } from './verify.mjs';

const app = express();

app.post('/hooks/verdin', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body.toString('utf8');
  if (!verify(process.env.VERDIN_WEBHOOK_SECRET, req.get('x-verdin-signature') ?? '', rawBody)) {
    return res.sendStatus(401);
  }
  const payload = JSON.parse(rawBody);
  console.log(req.get('x-verdin-delivery'), payload.event, payload.entry?.documentId);
  res.sendStatus(204);
});

app.listen(3000);
```

使用 Python：

```python title="verify.py"
import hashlib
import hmac
import time


def verify(secret: str, header: str, raw_body: bytes, tolerance: int = 300) -> bool:
    parts = dict(part.split("=", 1) for part in header.split(","))
    if abs(time.time() - int(parts["t"])) > tolerance:
        return False
    signed = parts["t"].encode() + b"." + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))
```

## 投递与重试

变更提交时，投递会进入数据库中的队列，由后台 worker 发送。响应缓慢或出错的端点永远不会拖慢编辑或 API 写入，投递在重启后依然保留。

- **成功**：任何 `2xx` 响应。
- **失败**：任何其他状态码，包括重定向（不会跟随）、连接错误或超时（`[webhooks].timeout_secs`，默认 10 秒）。
- **重试**：失败的投递会在 30 秒、2 分钟、10 分钟、1 小时和 6 小时后重试，总共尝试六次。之后标记为失败。
- 停用或删除 webhook 会停止其待处理的重试。
- 多个实例共享同一个队列；每次投递只会被其中一个实例领取。

请尽快返回 `2xx`，之后再处理耗时的工作。投递可能不止一次到达（例如超时后的重试），也可能乱序到达：请用 `x-verdin-delivery` 跳过重复投递，在顺序重要时重新获取文档。

## 投递日志

**设置 → Webhook** 中每个 webhook 的页面都有一个 **投递日志**，最新的排在最前。每次投递会显示状态（**等待中**、**发送中**、**成功**、**失败**）、HTTP 状态码、响应体的前 2 KB、错误、尝试次数、下次尝试时间、耗时以及发送的负载。失败的投递可以在日志中重试。

已完成的投递会在 `[webhooks].retention_days`（默认 30 天）后删除。

同样的数据也可以通过[管理 API](/zh-cn/api/admin/) 获取：`GET /admin/api/webhooks/{id}/deliveries` 和 `POST /admin/api/webhooks/deliveries/{id}/retry`。

## URL 限制

在 `verdin start` 下，webhook URL 不能指向回环地址、私有地址、链路本地地址或其他保留地址，无论是直接写成 IP 地址，还是写成解析到这些地址的主机名。管理员无法借助 webhook 访问内部服务。`verdin dev` 允许这些地址，便于你对 `localhost` 进行测试；`[webhooks].allow_private_networks` 可以覆盖默认行为。带凭据的 URL（`https://user:pass@…`）会被拒绝：请把凭据放在请求头中。

## 与 Strapi 对比

负载遵循 Strapi 的格式（`event`、`createdAt`、`model`、`uid`、`entry`）。Verdin 额外提供了签名、重试、投递日志和按内容类型过滤。Strapi 的 `entry.draft-discard` 事件在 Verdin 中叫做 `entry.discard-draft`。
