---
title: 配置参考
description: verdin.toml 的每个部分和键及其默认值，以及 Verdin 读取的环境变量。
sidebar:
  order: 1
  label: 配置
---

<!-- Written from crates/verdin/src/config.rs, crates/verdin-upload/src/config.rs and
crates/verdin-email/src/lib.rs, crates/verdin-upload/src/transform.rs,
crates/verdin-search/src/lib.rs, crates/verdin-api/src/cdn.rs and crates/verdin-api/src/ai.rs.
Keep it in step when keys change. -->

配置是分层的：**内置默认值 ← `verdin.toml` ← 环境变量**。配置文件是可选的；每个键都有默认值。未知的键会被拒绝，因此拼写错误会在启动时失败，而不是被忽略。

- 用 `VERDIN_<SECTION>__<KEY>`（两个下划线）覆盖任何键，例如 `VERDIN_SERVER__PORT=8080` 或 `VERDIN_ADMIN__SECURE_COOKIES=false`。嵌套的表再多加一个 `__`：`VERDIN_ADMIN__BRANDING__TITLE=ACME`。这里同样会拒绝未知的键，因此任何以 `VERDIN_` 开头且包含 `__` 的变量都必须对应一个真实存在的键。
- `VERDIN_DATABASE_URL` 是 `database.url` 的简写。
- 配置文件是工作目录中的 `verdin.toml`，或者通过 `-c, --config` 或 `VERDIN_CONFIG` 指定的路径。其中的相对路径（schema、插件、上传文件、SQLite 文件）都相对于该文件所在的目录解析。
- 配置文件旁边的 `.env` 文件会最先加载；环境中已设置的变量优先。

密钥永远不会从 `verdin.toml` 读取；参见[环境变量](#环境变量)。

## `[server]`

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `host` | `"0.0.0.0"` | 监听的地址。 |
| `port` | `1337` | 监听的端口。 |
| `public_url` | 未设置 | 浏览器访问服务器的地址，例如 `"https://cms.example.com"`。用于邮件中的链接和 SSO 回调；默认为 `http://localhost:{port}`。 |
| `body_limit` | `"1mb"` | 常规 API 请求的最大请求体（上传有自己的限制）。可以是字节数，或者带有 `b`、`kb`、`mb` 或 `gb` 的字符串。 |
| `request_timeout_secs` | `30` | 常规 API 请求的时间限制。 |
| `sync_interval_secs` | `10` | 多久读取一次其他实例修改的设置（功能、插件开关、语言区域、审核工作流）；`0` 表示关闭（单实例）。 |
| `trusted_proxies` | `[]` | 其 `X-Forwarded-For` 可用于确定客户端的反向代理（IP 或 CIDR 地址段，例如 `["10.0.0.0/8"]`）。速率限制和审计日志使用该地址；不设置时，代理之后的所有客户端共用同一个地址。 |

## `[database]`

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `url` | 未设置 | 连接 URL：`postgres://…`、`mysql://…`（MySQL 和 MariaDB）或 `sqlite://…`。必填；通常通过 `VERDIN_DATABASE_URL` 设置。 |
| `pool_max` | `10` | 连接池中的最大连接数。 |

## `[schema]`

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `path` | `"schema"` | schema 目录，相对于配置文件。 |

## `[api]`

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `prefix` | `"/api"` | 提供内容 API 的路径。必须以 `/` 开头，且不能以 `/` 结尾。 |
| `default_page_size` | `25` | 请求未设置时的每页大小。介于 1 和 `max_page_size` 之间。 |
| `max_page_size` | `100` | 请求可以要求的最大每页大小。 |
| `decimal_as_string` | `false` | 把小数序列化为字符串（精确），而不是数字（与 Strapi 兼容）。 |
| `public_rate_limit` | `0` | 不带令牌时每个客户端 IP 每分钟的请求数（`0`：不限制）。 |
| `token_rate_limit` | `0` | 每个 API 令牌或终端用户每分钟的请求数（`0`：不限制）。 |
| `cache_ttl_secs` | `0` | 匿名读取在内存中保留的时长（`0`：不缓存）；变更会清空缓存。 |
| `cache_entries` | `1000` | 缓存响应的最大数量。 |
| `cors_origins` | `[]` | 允许从其他网站调用内容 API 和 GraphQL 的浏览器源（`["https://www.example.com"]`：scheme、主机和端口，不带路径），或者 `["*"]` 表示任意源（只能单独使用：`*` 不能与其他源组合）。为空时：只有同源页面才能从浏览器调用它们。管理 API 从不接受跨源调用。 |

## `[admin]`

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `path` | `"/admin"` | 提供管理后台的路径；其 API 位于 `{path}/api`。 |
| `secure_cookies` | 未设置 | 把刷新 cookie 标记为 `Secure`。未设置时，在 `verdin start` 中为是，在 `verdin dev` 中为否（便于基于普通 HTTP 的本地开发）。 |
| `auth_rate_limit` | `20` | 每个客户端 IP 每分钟的登录、注册和刷新尝试次数。 |
| `assets_dir` | 未设置 | 从该目录（相对于配置文件）提供管理后台，而不是使用嵌入在二进制文件中的副本。 |

### `[admin.branding]`

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `title` | `"Verdin"` | 显示在侧边栏、登录页和浏览器标签页上。 |
| `logo` | 未设置 | 图片文件（SVG、PNG、WebP），相对于配置文件。 |
| `favicon` | 未设置 | 图标文件（ICO、PNG、SVG），相对于配置文件。 |
| `accent` | 未设置 | 按钮、链接和焦点环的 `#rrggbb` 颜色。 |
| `translations` | `{}` | 按语言替换管理后台文字，例如 `[admin.branding.translations.en]` 中设置 `"auth.login.title" = "Welcome to ACME"`。键就是 `admin/public/i18n/en.json` 中的键。 |

## `[upload]`

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `provider` | `{ name = "local", dir = "public/uploads" }` | 文件的存储位置；见下文。 |
| `max_file_size` | `209715200` | 接受的最大文件，单位为字节（200 MB）。 |
| `responsive_formats` | `true` | 为光栅图片生成响应式格式。 |
| `breakpoints` | large 1000、medium 750、small 500 | 以 `{ name, width }` 表表示的响应式格式（Strapi 的 `breakpoints`）。宽于图片的格式会被跳过。 |
| `max_image_megapixels` | `100` | 用于防范解压炸弹的解码限制，单位为百万像素。 |
| `max_original_size` | 未设置 | 任意一边超过该像素数的光栅原图会在上传时被缩小，同时丢弃其元数据（EXIF、GPS）。未设置时按原样保留原图。 |

```toml
[upload]
breakpoints = [{ name = "large", width = 1000 }, { name = "small", width = 500 }]
```

### 本地提供方

文件存放在 `dir`（相对于项目）下，由 Verdin 在 `/uploads` 提供。

```toml
[upload]
provider = { name = "local", dir = "public/uploads" }
```

### `[upload.transforms]`

本地文件的图片转换：`/uploads/<file>?preset=thumb`，或者带签名的 `?w=&h=&fit=&format=&q=`。渲染结果缓存在磁盘上，文件变化时（包括其焦点）会被丢弃。cover 裁剪会让文件的焦点保持在视野中；图片永远不会被放大。可以转换 JPEG、PNG、WebP、TIFF 和 BMP（不包括可能是动图的 GIF）。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 提供转换。 |
| `presets` | `{}` | 具名转换，始终允许：`{ w, h, fit, format, q }`。 |
| `allow_arbitrary` | `false` | 接受任何不带签名的参数。每个不同的 URL 都会被渲染并缓存，因此只适用于受信任的网络。 |
| `max_size` | `4096` | `w` 或 `h` 的最大值，单位为像素。 |
| `cache_dir` | `".cache/transforms"` | 渲染结果的存放位置（相对于项目；可以放心删除）。 |

参数：`w`、`h`（像素）、`fit`（默认的 `cover` 裁剪到框内；`inside` 完整放入框内；`fill` 拉伸）、`format`（`jpeg`、`png`、`webp`；WebP 输出是无损的）以及 `q`（JPEG 质量，1–100，默认 80）。

```toml
[upload.transforms.presets]
thumb = { w = 300, h = 300 }
hero = { w = 1600, h = 600, format = "webp" }
```

**签名 URL。** 设置了 `VERDIN_IMAGE_SECRET` 时，`s` 是对 `<file>?<canonical query>` 计算出的十六进制 HMAC-SHA256，其中规范查询按名称排序（`fit`、`format`、`h`、`q`、`w`；省略 `fit=cover`）列出非默认的参数：

```js
import { createHmac } from 'node:crypto';
const s = createHmac('sha256', process.env.VERDIN_IMAGE_SECRET)
  .update('photo_1a2b.jpg?format=webp&w=800')
  .digest('hex');
const url = `/uploads/photo_1a2b.jpg?format=webp&w=800&s=${s}`;
```

### S3 提供方

任何 S3 兼容服务（AWS、Cloudflare R2、MinIO、Backblaze B2……）。凭据来自标准的 `AWS_*` 环境变量（`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`）。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `bucket` | 必填 | 存储桶名称。 |
| `region` | 未设置 | 存储桶所在区域。 |
| `endpoint` | 未设置 | 非 AWS 服务的自定义端点，例如 `https://<account>.r2.cloudflarestorage.com`。 |
| `public_url` | 必填 | 存储桶或其 CDN 的公开基础 URL；文件以 `{public_url}/{key}` 的形式链接。 |
| `prefix` | `""` | 存储桶内的键前缀。 |
| `path_style` | `false` | 路径风格的请求（MinIO 和大多数自托管服务）。 |

```toml
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

## `[webhooks]`

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `allow_private_networks` | 未设置 | 允许 webhook URL 使用回环地址、私有地址和链路本地地址；同样适用于部署目标和 `[cdn]` webhook。未设置时，在 `verdin start` 中为否（否则管理员可能访问到内部服务），在 `verdin dev` 中为是。 |
| `timeout_secs` | `10` | 每次投递的时间限制。 |
| `retention_days` | `30` | 投递日志的保留天数。 |

参见 [Webhook](/zh-cn/guides/integrations/webhooks/)。

## `[history]`

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `max_versions` | `50` | 每个文档保留的版本数（更旧的会被删除）。 |

## `[email]`

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `provider` | `"log"` | `log`（把邮件写入日志）、`smtp`、`resend` 或 `postmark`。 |
| `from` | `"Verdin <no-reply@localhost>"` | 发件人。 |
| `reply_to` | 未设置 | 回复地址。 |

### `[email.smtp]`

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `host` | `"localhost"` | SMTP 服务器。 |
| `port` | `587` | SMTP 端口。 |
| `username` | 未设置 | SMTP 用户；密码来自 `VERDIN_EMAIL_SMTP_PASSWORD`。 |
| `security` | `"starttls"` | `starttls`、`tls`（隐式 TLS，通常为 465 端口）或 `none`（本地中继）。 |

## `[plugins]`

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `path` | `"plugins"` | 插件目录（每个插件一个子目录），相对于配置文件。 |
| `run_jobs` | `true` | 在此实例上运行插件的定时任务（有多个实例时只在一个实例上开启）。 |

参见[插件](/zh-cn/extending/plugins/)。

## `[audit]`

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `retention_days` | `90` | 审计日志条目的保留天数。 |

## `[digest]`

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 从此实例发送每日摘要（有多个实例时只在一个实例上开启）。 |
| `hour_utc` | `8` | 未查看更改的每日摘要发出的时间（UTC 小时，0–23）。 |

## `[log]`

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `format` | `"pretty"` | `pretty` 或 `json`。 |
| `level` | 未设置（`info`） | 默认过滤器；设置了 `RUST_LOG` 时以其为准。 |

## `[metrics]`

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 在 `/_metrics` 提供 Prometheus 指标：按领域（`api`、`admin_api`、`graphql`、`mcp`、`uploads`……）、方法和状态码类别统计的 HTTP 请求及延迟直方图、待发送的 webhook 投递、打开的实时事件流以及运行时间。 |
| `token` | 未设置 | 抓取需要 `Authorization: Bearer <token>`。`VERDIN_METRICS_TOKEN` 优先于它。没有令牌时，任何能访问该端口的人都可以读取指标。 |

## `[ai]`

管理后台中的 AI 操作（在 设置 → 功能 中开启 **AI 操作** 功能）：把条目翻译为另一个语言区域、为图片撰写替代文本、总结文本、建议 SEO 元数据。它们返回建议；未经编辑确认不会保存任何内容。密钥从 `VERDIN_AI_KEY` 读取（本地服务器不需要）。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `provider` | `"none"` | `anthropic`、`openai` 或 `openai-compatible`（Ollama、LM Studio、vLLM……）。 |
| `model` | `anthropic` 为 `claude-sonnet-5` | 模型；其他提供商必须设置。 |
| `base_url` | 提供商的默认端点 | 其他端点，例如 `http://localhost:11434/v1`。 |
| `max_tokens` | `2048` | 回答的最大长度。 |

```toml
[ai]
provider = "anthropic"
```

每位管理员每分钟最多可以发出 30 个 AI 请求。内容和图片会被发送给提供商：请选择你的组织允许的提供商。

## `[cdn]`

在内容发生公开变更时清除 CDN 缓存。内容 API 的响应会被打上 `vd` 和 `vd-<singularName>` 标签（`Cache-Tag` 和 `Surrogate-Key` 响应头）。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `provider` | `"none"` | `cloudflare`、`fastly` 或 `webhook`。 |
| `zone_id` | 未设置 | Cloudflare 区域（按标签清除）。 |
| `service_id` | 未设置 | Fastly 服务（按 surrogate key 清除）。 |
| `url` | 未设置 | `webhook`：接收 `POST { "tags": [...] }`。 |
| `debounce_ms` | `1000` | 清除之前合并变更的时间窗口。 |

API 令牌从 `VERDIN_CDN_TOKEN` 读取（对 webhook 以 bearer 令牌的形式发送）。

## `[search]`

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 使用全文索引（Tantivy）而不是 `$containsi` 对 `_q` 的结果排序。 |
| `dir` | `"data/search"` | 索引目录，相对于项目。删除它后，下次启动时会重建索引。 |
| `memory_mb` | `50` | 建立索引的内存预算。 |

索引位于实例的磁盘上，只跟踪该实例的写入：有多个实例时，请只在一个实例上提供搜索（或在部署后重建）。

## 环境变量

除了 `VERDIN_<SECTION>__<KEY>` 覆盖项之外，Verdin 还读取以下变量：

| 变量 | 说明 |
| --- | --- |
| `VERDIN_CONFIG` | 配置文件的路径（与 `--config` 相同）。 |
| `VERDIN_DATABASE_URL` | `database.url` 的简写。 |
| `VERDIN_ADMIN_JWT_SECRET` | 为管理员会话令牌签名。必填，至少 32 字节；用 `verdin secrets` 生成。 |
| `VERDIN_TOKEN_PEPPER` | 已存储令牌的哈希密钥。必填，至少 32 字节；用 `verdin secrets` 生成。 |
| `VERDIN_ADMIN_PASSWORD` | `verdin admin create` 和 `verdin admin reset-password` 所用的密码（否则从标准输入读取）；参见[命令行参考](/zh-cn/reference/cli/)。 |
| `VERDIN_EMAIL_SMTP_PASSWORD` | SMTP 密码。 |
| `VERDIN_EMAIL_API_KEY` | Resend 和 Postmark 提供方的 API 密钥。 |
| `VERDIN_SSO_<ID>_SECRET` | SSO 提供商的客户端密钥；`<ID>` 是提供商 id 的大写形式，`-` 改为 `_`（参见[单点登录](/zh-cn/guides/auth/sso/)）。 |
| `VERDIN_OAUTH_<PROVIDER>_SECRET` | 终端用户 OAuth 提供商的客户端密钥，命名方式与 SSO 相同（参见[终端用户](/zh-cn/guides/auth/end-users/)）。 |
| `VERDIN_AI_KEY` | `[ai]` 提供商的 API 密钥。 |
| `VERDIN_CDN_TOKEN` | `[cdn]` 提供方的 API 令牌。 |
| `VERDIN_IMAGE_SECRET` | 为图片转换 URL 签名（参见 [`[upload.transforms]`](#uploadtransforms)）。 |
| `VERDIN_METRICS_TOKEN` | 开启 `[metrics].enabled` 时抓取 `/_metrics` 所用的 bearer 令牌；优先于 `[metrics].token`。 |
| `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY` | S3 上传提供方的凭据。 |
| `RUST_LOG` | 日志过滤器；优先于 `[log].level`。 |
