---
title: 生产环境中的 Docker Compose
description: 适用于单台服务器的生产 Compose 方案：Verdin、PostgreSQL 和自动 HTTPS 的 Caddy，以及可选的、用于 S3 兼容媒体存储的 RustFS。
sidebar:
  order: 3
---

[`deploy/compose/`](https://github.com/verdin-cms/verdin/tree/main/deploy/compose) 是一套适用于单台服务器的现成配置：Verdin 和 PostgreSQL 位于私有网络中，前面是 Caddy，它会自己获取并续期证书。一个覆盖文件会添加 RustFS，即同一台主机上的 S3 兼容存储，用于存放媒体。这些文件所用的镜像请参见 [Docker](/zh-cn/deploy/docker/)。

这些文件已于 2026-09-30 用 `docker compose config` 和 `caddy validate` 检查过。

## 文件

| 文件 | 说明 |
| --- | --- |
| `compose.yaml` | `verdin`、`db`（PostgreSQL 17）和 `caddy`。只有 Caddy 发布端口（80、443，以及用于 HTTP/3 的 443/udp）。 |
| `compose.s3.yaml` | 添加 `rustfs` 和一个一次性任务（创建公开可读的 `media` 存储桶），并把 Verdin 的上传提供方切换为它。 |
| `Caddyfile` | `$VERDIN_DOMAIN` 的 TLS、压缩，`/media/*` 转发给 RustFS，其余所有请求转发给 Verdin。 |
| `.env.example` | Compose 读取的变量：域名、ACME 邮箱、镜像标签、密码。 |

## 设置

前提条件：一台装有 Docker 的服务器、一条指向它的域名 DNS 记录，以及开放的 80 和 443 端口。

1. 把该目录复制到服务器，并填写 `.env`：

   ```sh frame="terminal"
   cp .env.example .env                                  # VERDIN_DOMAIN, ACME_EMAIL
   echo "DB_PASSWORD=$(openssl rand -hex 24)" >> .env
   docker run --rm ghcr.io/verdin-cms/verdin:0.11 secrets > verdin.env
   ```

2. 把你已提交的 schema 放在 `schema/`（`content-types/` 和 `components/`）中。它会以只读方式挂载到 `/app/schema`。
3. 启动：

   ```sh frame="terminal"
   docker compose up -d
   docker compose logs -f verdin
   ```

4. 打开 `https://<your domain>/admin/` 并注册第一个管理员。

请不要把 `.env` 和 `verdin.env` 纳入版本控制，并备份它们：新的 `VERDIN_TOKEN_PEPPER` 会使所有 API 令牌失效。

## S3 上的媒体

默认情况下，上传内容保存到 `verdin-data` 卷。要改为存放到 RustFS：

```sh frame="terminal"
echo "S3_SECRET_KEY=$(openssl rand -hex 24)" >> .env
docker compose -f compose.yaml -f compose.s3.yaml up -d
```

之后文件由 Caddy 在 `https://<your domain>/media/<key>` 提供。对于 AWS S3、Cloudflare R2 或其他提供商，请去掉 RustFS 服务，并把 `VERDIN_UPLOAD__PROVIDER__*` 变量和 `AWS_*` 凭据设置为该提供商的值（参见[存储](/zh-cn/internals/storage/)）。切换现有站点不会移动任何文件：新的上传会进入新的提供方。

## 说明

- **客户端地址。** Verdin 信任来自 Compose 网络（`172.30.0.0/24`，固定在 `compose.yaml` 中）的 `X-Forwarded-For`，那里 Caddy 是唯一的代理。如果该网段与你的某个网络冲突，请同时修改两处。
- **实时。** Caddy 不缓冲地流式传输 `text/event-stream` 响应，因此[实时事件](/zh-cn/guides/frontend/realtime/)在它之后无需改动即可工作。
- **升级。** 修改 `.env` 中的 `VERDIN_VERSION`，然后执行 `docker compose pull && docker compose up -d`。请先阅读[升级](/zh-cn/migrate/upgrading/)。
- **备份。** 转储 PostgreSQL 并保留 `verdin-data` 卷（或存储桶）；参见[备份](/zh-cn/deploy/backups/)。
- **管理命令。** 镜像中没有 shell：`docker compose exec verdin verdin admin create --email you@example.com`。
