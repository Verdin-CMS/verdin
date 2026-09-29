---
title: Fly.io
description: 使用你自己的镜像、PostgreSQL 和 Tigris 对象存储把 Verdin 部署到 Fly.io，或者使用单台 Machine 并把 SQLite 放在卷上。
sidebar:
  order: 4
---

本页把一个 Verdin 项目以基于官方镜像构建的小镜像形式部署到 [Fly.io](https://fly.io)。推荐的方案不在 Machine 上保存任何状态：数据库使用 PostgreSQL，媒体使用 Tigris（Fly 的 S3 兼容存储）。之后还介绍了一种把 SQLite 放在卷上的变体。

:::note
Fly 的配置格式已于 2026-09-29 对照 [Fly 的文档](https://docs.fly.io/reference/configuration/)进行核对；该方案未在真实的 Fly 账户上运行过。尖括号中的值以及标有 `# yours` 的值需要你自己填写。
:::

前提条件：已登录的 [`flyctl`](https://docs.fly.io/flyctl/install/)，以及一个已提交 `schema/` 目录的 Verdin 项目。

## 1. 添加 Dockerfile 和配置

在项目目录中添加一个 `Dockerfile`，把你的配置和 schema 复制到官方镜像中（参见[你自己的镜像](/zh-cn/deploy/docker/)）：

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

以及一个用于 Fly 的 `verdin.toml`：

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337
public_url = "https://my-verdin.fly.dev"       # yours: the app's URL or your domain

[schema]
path = "schema"

[log]
format = "json"

[upload]
provider = { name = "s3", bucket = "my-verdin-media",   # yours: the bucket name
             region = "auto", endpoint = "https://t3.storage.dev",
             public_url = "https://my-verdin-media.t3.tigrisfiles.io" }
```

确保 `.env` 不在构建上下文中：把它添加到 `.dockerignore`。

## 2. 编写 `fly.toml`

```toml title="fly.toml"
app = "my-verdin"                # yours
primary_region = "fra"           # yours

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 1337
  force_https = true
  # Keep a Machine running: webhooks, scheduled releases, plugin jobs and the
  # daily digest run inside the server process.
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "30s"
    interval = "15s"
    method = "GET"
    timeout = "5s"
    path = "/_ready"

[[vm]]
  memory = "512mb"               # adjust to your content and traffic
```

镜像的默认命令 `start --migrate` 会在每台 Machine 启动时执行安全迁移，因此不需要 `release_command`。（Fly 会在一台没有卷的临时 Machine 中运行 `release_command`，这对 SQLite 本来也行不通。）

## 3. 创建应用、数据库和存储桶

1. 创建应用但不部署。`--ha=false` 以一台 Machine 起步；在添加更多 Machine 之前，请阅读[运行多个实例](/zh-cn/deploy/scaling/)。

   ```sh frame="terminal"
   fly launch --no-deploy --copy-config --ha=false
   ```

2. 创建一个 PostgreSQL 数据库，例如使用 [Fly Managed Postgres](https://docs.fly.io/mpg/) 或任何 PostgreSQL 服务商，并记下其连接 URL。

3. 创建一个公开的 Tigris 存储桶。该命令会把 `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_ENDPOINT_URL_S3` 和 `BUCKET_NAME` 设置为应用的 secret；Verdin 读取前两个。把存储桶名称写入 `verdin.toml`。

   ```sh frame="terminal"
   fly storage create --public
   ```

4. 设置 Verdin 的密钥和数据库 URL：

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets | fly secrets import
   fly secrets set VERDIN_DATABASE_URL='postgres://<user>:<password>@<host>:5432/<db>?sslmode=require'
   ```

5. 部署，然后打开 `https://<app>.fly.dev/admin/` 并注册第一个管理员：

   ```sh frame="terminal"
   fly deploy
   ```

## 客户端地址和速率限制

Fly 的代理会把客户端地址添加到 `X-Forwarded-For` 中，根据 [Fly 的请求头文档](https://docs.fly.io/networking/request-headers/)，最右边的地址是你的应用自己的 IP。为了让 Verdin 找到客户端地址，请信任代理的地址段以及你的应用的地址（`fly ips list`）：

```toml title="verdin.toml"
[server]
trusted_proxies = ["172.16.0.0/12", "<app IPv4>", "<app IPv6>"]
```

这一点未在运行中的应用上验证过。在你确认之前，请把 `[api].public_rate_limit` 保持为 `0`：如果代理配置不正确，所有访问者都会被算作同一个地址。

## 变体：单台 Machine 搭配 SQLite

对于小型项目，也可以把数据库和上传文件放在 Fly 卷上。

- 在 `verdin.toml` 的 `[upload]` 下设置 `provider = { name = "local", dir = "/data/uploads" }`（默认目录相对于 `/app`，服务器无法写入），并把 `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` 设置为 secret。
- 在 `/data` 挂载一个卷：

  ```toml title="fly.toml"
  [mounts]
    source = "verdin_data"
    destination = "/data"
    initial_size = "1gb"
  ```

- 只运行一台 Machine（`fly scale count 1`）。一个卷只能挂载到一台 Machine 上，SQLite 也无法共享。
- Fly 创建的卷属于 root，而镜像以 uid `65532` 运行。如果启动时因 `/data` 权限错误而失败，请在 `Dockerfile` 中添加 `USER root`。

请备份该卷：Fly 会保留每日的卷快照，`verdin export` 则可以生成一份可移植的归档（参见[备份](/zh-cn/deploy/backups/)）。
