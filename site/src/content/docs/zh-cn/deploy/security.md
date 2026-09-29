---
title: 安全
description: Verdin 如何保护管理后台、内容 API 和服务器，哪些设置可以加固生产实例，以及如何报告漏洞。
sidebar:
  order: 2
---

本页介绍 Verdin 为保护项目所做的工作，以及你可以控制的设置。在为真实流量准备实例时，请结合[生产环境检查清单](/zh-cn/deploy/production-checklist/)使用。

## 默认关闭的内容

- **内容 API。** 在你于 **设置 → 公开访问** 中授予公开权限之前，匿名请求得不到任何内容。未知、过期或格式错误的令牌返回 `401`，绝不会回退为公开角色。参见[权限](/zh-cn/concepts/permissions/)。
- **OpenAPI 文档**位于 `/api/_openapi.json`，在你于 **设置 → 功能 → API 文档** 中将其设为公开之前，需要有效的 API 令牌才能访问。
- **可选功能**，例如 GraphQL、终端用户、SSO 和 MCP 服务器，在拥有 `features.manage` 权限的管理员于 **设置 → 功能** 中开启之前保持关闭。
- **插件**在管理员于 **设置 → 插件** 中逐个开启之前保持关闭。
- **跨源浏览器调用。** 在你把某个源列入 `[api].cors_origins` 之前，任何源都不能从浏览器调用任何 API。

## 管理员登录

| 保护措施 | 详情 |
| --- | --- |
| 密码哈希 | 使用 OWASP 推荐参数的 Argon2id，参数变化时会重新哈希。 |
| 会话 | 一个有效期 15 分钟的访问令牌，保存在页面内存中（从不放在 `localStorage` 中）；以及一个有效期 30 天的刷新令牌，保存在限定于 `/admin/api/auth` 的 `HttpOnly`、`SameSite=Strict` cookie 中。刷新令牌每次使用都会轮换；出示旧的刷新令牌会结束整个会话。 |
| 安全 cookie | 在 `verdin start` 中，刷新 cookie 带有 `Secure`。`[admin].secure_cookies = false` 会关闭它并记录一条警告。 |
| CSRF | 刷新和退出登录需要 `X-Verdin-CSRF` 请求头，跨站表单无法发送该请求头。 |
| 锁定 | 连续五次失败会将账户锁定 15 分钟。密码步骤和第二因素步骤的失败会合并计数。未知邮箱和错误密码得到的响应相同，耗时也相同。 |
| 速率限制 | 登录、注册和刷新：每个客户端地址每分钟 `[admin].auth_rate_limit` 次请求（20）。 |
| 第二因素 | 身份验证器应用（TOTP）和通行密钥，以及恢复码。角色可以强制要求它（`requireTwoFactor`）。参见[双因素认证](/zh-cn/guides/auth/two-factor/)。 |
| Super Admin | 只有 Super Admin 才能创建、编辑、删除或重置 Super Admin，或者授予该角色。最后一个处于活动状态的 Super Admin 不能被移除。 |

在还没有任何管理员时，第一个管理员通过管理后台注册。请在首次启动后立即完成注册，或者在暴露服务器之前用 `verdin admin create --email …` 创建它。

## 管理后台和管理 API

- 无论 `[api].cors_origins` 如何设置，管理 API（`/admin/api`）都不会发送 CORS 响应头：浏览器只允许管理后台自己的源读取其响应。
- 管理后台以严格的内容安全策略（只允许来自自身源的脚本）、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff` 和 `Referrer-Policy: strict-origin-when-cross-origin` 提供服务。
- Verdin 不发送 `Strict-Transport-Security`。请在终止 TLS 的反向代理上添加它。

## 内容 API

- **API 令牌**只显示一次。Verdin 以 `VERDIN_TOKEN_PEPPER` 为密钥存储每个令牌的 HMAC-SHA256，并保留一个 10 个字符的前缀用于显示。令牌可以过期，也可以重新生成。
- **字段和语言区域权限**限制角色能读写的内容，`populate`、关联过滤和关联排序也只能访问调用方有权读取的类型。
- **查询限制**：`pageSize` 最大为 `[api].max_page_size`（100），`populate` 深度最大为 5，最多 100 个过滤条件，查询字符串最大 16 KB，每个关联最多 populate 1,000 个条目。查询中出现未知或 private 字段会返回 `400`。
- **GraphQL** 有自己的深度和复杂度限制（`maxDepth`、`maxComplexity`），并在功能设置中提供内省开关。
- **速率限制**：`[api].public_rate_limit` 按客户端地址限制不带令牌的请求，`[api].token_rate_limit` 按 API 令牌或终端用户限制，单位为每分钟请求数。两者默认关闭（`0`）。带有未知 bearer 令牌的请求按地址限制。

### CORS

`[api].cors_origins` 列出允许调用内容 API 和 GraphQL 的浏览器源：

```toml title="verdin.toml"
[api]
cors_origins = ["https://www.example.com", "https://preview.example.com"]
```

每一项都是不带路径和结尾斜杠的 `scheme://host[:port]`；`["*"]` 允许任何源，且不能与其他项组合使用。允许的方法为 `GET`、`POST`、`PUT` 和 `DELETE`，允许的请求头为 `Authorization`、`Content-Type` 和 `If-None-Match`。如果某一项不是合法的源，启动会失败。

服务端前端（Astro、服务端的 Next.js）不通过浏览器调用 API，无需配置 CORS。

## 请求和上传

| 设置 | 默认值 | 防范 |
| --- | --- | --- |
| `[server].body_limit` | `"1mb"` | 常规 API 上过大的请求体。 |
| `[server].request_timeout_secs` | `30` | 占用连接的慢请求。 |
| `[upload].max_file_size` | 200 MB | 过大的上传（上传使用自己的限制，而不是 `body_limit`）。 |
| `[upload].max_image_megapixels` | `100` | 解压炸弹。 |

上传文件的类型根据其字节内容判断，而不是根据客户端发送的类型；文件名只作为后备依据，并且对于浏览器会主动执行的类型从不使用文件名（这类文件以 `application/octet-stream` 存储）。富文本 `blocks` 中的链接必须是 `http(s)`、`mailto:` 或相对链接。

## 代理之后的客户端地址

速率限制和审计日志使用客户端地址。在反向代理之后，所有请求都来自代理，因此请把代理列在 `[server].trusted_proxies` 中：

```toml title="verdin.toml"
[server]
trusted_proxies = ["10.0.0.0/8"]   # the proxies' IPs or CIDR ranges
```

之后 Verdin 会从右向左读取 `X-Forwarded-For`，取第一个不属于受信任代理的地址。来自其他任何地址的请求保留其连接地址，因此客户端无法通过自行发送该请求头来伪造地址。不要列出不受信任的客户端可能连接的地址段。

## 出站请求

webhook、部署钩子、CDN 清除 webhook 以及从 URL 上传，都会发出由管理员指定目标的请求。在 `verdin start` 中，它们会拒绝回环地址、私有地址和链路本地地址（包括内嵌私有 IPv4 地址的 IPv6 形式），因此管理员无法借助它们访问内部网络中的服务。`[webhooks].allow_private_networks = true` 会解除这一限制；只有在所有管理员都可以被信任访问内部网络时才这样做。

## 密钥

`VERDIN_ADMIN_JWT_SECRET` 和 `VERDIN_TOKEN_PEPPER` 只从环境变量读取，并且每个都至少需要 32 字节（`verdin secrets` 会输出新的值）。pepper 还会加密管理员的 TOTP 密钥，并派生出用于对表单提交者地址做哈希的密钥。请把两者都保存在平台的密钥管理器中，绝不要提交 `.env`。

请求日志会隐藏名称看起来像密钥的查询参数的值（`token`、`code`、`password`、`key`、`signature`……）以及部署回调 URL 中的密钥部分。

## 指标

除非设置 `[metrics].enabled = true`，否则 `/_metrics` 是关闭的。开启后如果没有设置令牌，任何能访问该端口的人都可以读取它。请设置 `VERDIN_METRICS_TOKEN`（或 `[metrics].token`）并以 `Authorization: Bearer <token>` 抓取，或者在代理上屏蔽该路径。参见[监控](/zh-cn/deploy/monitoring/)。

## 插件

插件是由 Extism 在沙箱中运行的 WebAssembly 模块。模块没有自己的文件系统、网络或数据库：一切都要通过宿主函数，并受其 `plugin.toml` 中声明的能力限制（它读写的内容类型、HTTP 主机、它自己的键值存储），每次调用还有时间和内存限制（`[limits]`，示例清单中为 5 秒和 64 MB）。管理员在开启插件之前可以看到它申请的能力。插件的管理后台脚本运行在管理后台页面中，因此请只安装你信任的插件。参见[插件](/zh-cn/extending/plugins/)。

## 导出和备份

`verdin export` 生成的归档包含 private 字段和密码哈希。请像对待数据库转储一样存放它们。参见[备份](/zh-cn/deploy/backups/)。

## 报告漏洞

不要为安全问题创建公开 issue。请遵循代码仓库的[安全策略](https://github.com/Verdin-CMS/verdin/blob/main/SECURITY.md)：通过[代码仓库](https://github.com/Verdin-CMS/verdin/security)的 **Security** 标签页（**Report a vulnerability**）私下报告，并附上版本、复现步骤以及你观察到的影响。安全修复会列在[更新日志](/zh-cn/project/changelog/)的 **Security** 部分。
