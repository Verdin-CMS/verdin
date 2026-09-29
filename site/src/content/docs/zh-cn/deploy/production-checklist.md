---
title: 生产环境检查清单
description: Verdin 项目接入真实流量之前需要设置的事项：密钥、数据库、迁移、URL、代理、cookie、CORS、媒体存储、邮件、备份和监控。
sidebar:
  order: 1
---

在把 Verdin 项目交给真实用户之前，请逐项检查这份清单。每一项都链接到对应的说明页面。各平台页面（[Docker](/zh-cn/deploy/docker/)、[Fly.io](/zh-cn/deploy/fly/)、[Render](/zh-cn/deploy/render/)、[Railway](/zh-cn/deploy/railway/)、[Kubernetes](/zh-cn/deploy/kubernetes/)）会尽可能替你完成这些设置。

## 运行生产服务器

- [ ] **使用 `verdin start`，而不是 `verdin dev`。** `dev` 允许内容类型构建器重写 schema 文件，每次变更都会执行迁移，并为本地开发放宽 cookie 和 webhook 规则。请在开发环境中修改 schema，提交文件，然后部署它们。
- [ ] **在部署时执行迁移。** 数据库落后于 schema 时，`verdin start` 会拒绝运行。`verdin start --migrate` 会先执行待处理的*安全*步骤（这是 Docker 镜像的默认命令）。有风险或破坏性的步骤（类型变更、新增唯一约束、删除列）需要你亲自运行一次 `verdin migrate apply --allow risky|destructive`。参见 [Schema 迁移](/zh-cn/concepts/schema-migrations/)。
- [ ] **让 schema 随服务器一起发布。** 以只读方式挂载 `schema/` 目录，或者把它打包进镜像，确保运行的就是你提交的内容。

## 密钥

- [ ] **只生成一次两个必需的密钥**，使用 `verdin secrets` 生成，并保存在平台的密钥存储中：`VERDIN_ADMIN_JWT_SECRET` 为会话令牌签名，`VERDIN_TOKEN_PEPPER` 作为 API 令牌和其他已存储密钥的哈希密钥。缺少其中任何一个或长度不足 32 字节时，`verdin start` 会失败。密钥只从环境变量读取，绝不从 `verdin.toml` 读取。
- [ ] **保持它们不变。** 更换 `VERDIN_TOKEN_PEPPER` 会让所有 API 令牌失效，管理员的身份验证器应用验证码和恢复码也会失效。更换 `VERDIN_ADMIN_JWT_SECRET` 会使管理员和终端用户的短期访问令牌、已打开的预览链接以及正在进行的 OAuth 登录失效（管理后台和使用刷新令牌的客户端会自动续期）。同一项目的所有实例都需要相同的值。
- [ ] 把你用到的其他密钥也放在环境变量中：`VERDIN_EMAIL_SMTP_PASSWORD` 或 `VERDIN_EMAIL_API_KEY`、`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`、`VERDIN_METRICS_TOKEN`、`VERDIN_SSO_<ID>_SECRET`、`VERDIN_IMAGE_SECRET`。完整列表请参见[配置参考](/zh-cn/reference/configuration/)。

## 数据库

- [ ] **选择数据库引擎。** PostgreSQL（14 或更高版本）是常见的选择，如果要运行[多个实例](/zh-cn/deploy/scaling/)也应选择它。MySQL 8.4+ 和 MariaDB 10.11+ 的用法相同。SQLite 适合带持久磁盘的单实例。
- [ ] **设置 `VERDIN_DATABASE_URL`**：`postgres://…`、`mysql://…`（MySQL 和 MariaDB）或 `sqlite:///data/verdin.db`。对于需要 TLS 的 PostgreSQL 服务器，请加上 `?sslmode=require`。
- [ ] **设置连接池大小。** 每个实例最多打开 `[database].pool_max` 个连接（10）。请让 `实例数 × pool_max` 低于数据库服务器的连接上限。

## URL、代理和 cookie

- [ ] **通过 HTTPS 提供服务。** Verdin 使用普通 HTTP；请在反向代理、负载均衡器或平台的边缘节点上终止 TLS。
- [ ] **设置 `[server].public_url`**（`VERDIN_SERVER__PUBLIC_URL`）为浏览器使用的地址，例如 `https://cms.example.com`。邮件中的链接、SSO 回调、每日摘要和通行密钥都依赖它；通行密钥与其主机名绑定。
- [ ] **设置 `[server].trusted_proxies`** 为反向代理的地址（IP 或 CIDR 地址段）。只有这样，Verdin 才会从 `X-Forwarded-For` 读取客户端地址；否则，代理之后的所有客户端在速率限制和审计日志中都会共用同一个地址。
- [ ] **保持开启安全 cookie。** 在 `verdin start` 中，管理后台的刷新 cookie 默认带有 `Secure`。请不要设置 `[admin].secure_cookies`；在生产环境中把它设为 `false` 会在启动时记录一条警告。

## API

- [ ] **只授予公众需要的权限。** 在你授予公开权限（**设置 → 公开访问**）或创建 API 令牌之前，内容 API 是关闭的。参见[权限](/zh-cn/concepts/permissions/)。
- [ ] **设置 `[api].cors_origins`**，如果其他源上的浏览器需要调用内容 API 或 GraphQL，例如 `["https://www.example.com"]`。不设置时，只有同源页面才能从浏览器调用它们。管理 API 从不响应跨源请求。
- [ ] **考虑为匿名流量设置速率限制**：`[api].public_rate_limit` 和 `[api].token_rate_limit`（每分钟请求数；默认值 `0` 表示不限制）。

## 媒体

- [ ] **把上传文件存放在重新部署后依然保留的地方。** 默认的本地提供方写入磁盘：请为它提供持久卷，或者使用 S3 提供方（AWS S3、Cloudflare R2、Backblaze B2、MinIO、Tigris……）。在磁盘为临时存储的平台上，以及运行多个实例时，请使用 S3。参见[媒体](/zh-cn/concepts/media/)。

## 邮件

- [ ] **配置真正的邮件服务商。** 默认的 `[email].provider = "log"` 会把邮件写入日志，`verdin start` 会对此发出警告。邀请、密码重置、终端用户确认、评论提及和摘要都需要 `smtp`、`resend` 或 `postmark`，并且 `[email].from` 要设置为服务商接受的地址。

## 备份和监控

- [ ] **定期备份数据库和媒体存储**，并试着恢复一次。参见[备份](/zh-cn/deploy/backups/)。
- [ ] **让健康检查指向 `/_ready`**，存活检查指向 `/_health`。
- [ ] **以 JSON 格式输出日志**（`[log].format = "json"`，Docker 镜像的默认值），并收集标准错误输出。
- [ ] **抓取 `/_metrics`**，如果你使用 Prometheus，并配合 `VERDIN_METRICS_TOKEN`。参见[监控](/zh-cn/deploy/monitoring/)。

## 上线之前

- [ ] 首次启动后立即亲自注册第一个管理员：在还没有管理员之前，任何能访问 `/admin/` 的人都可以注册为 Super Admin。也可以用 `verdin admin create --email …` 通过命令行创建。
- [ ] 查看[安全模型](/zh-cn/deploy/security/)，并为 Super Admin 开启[双因素认证](/zh-cn/guides/auth/two-factor/)。
