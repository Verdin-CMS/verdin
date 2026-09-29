---
title: Render
description: 使用 Blueprint 把 Verdin 部署到 Render：一个由代码仓库构建的 Docker Web 服务、一个 Render PostgreSQL 数据库，媒体放在 S3 兼容存储或磁盘上。
sidebar:
  order: 5
---

本页使用 Blueprint（`render.yaml`）把一个 Verdin 项目部署到 [Render](https://render.com)：一个由代码仓库中的小型 Dockerfile 构建的 Web 服务，以及一个 Render PostgreSQL 数据库。Render 的文件系统是临时的，因此媒体要放到 S3 兼容存储上；如果只运行一个实例，也可以放到持久磁盘上。

:::note
Blueprint 格式已于 2026-09-29 对照 [Render 的 Blueprint 参考](https://render.com/docs/blueprint-spec)进行核对；该方案未在真实的 Render 账户上部署过。标有 `# yours` 的值需要你自己填写。
:::

前提条件：你的 Verdin 项目（包含 `schema/`）位于 Render 可以读取的 Git 仓库中。

## 1. 添加 Dockerfile 和配置

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337

[schema]
path = "schema"

[log]
format = "json"

[upload]
# Cloudflare R2 as an example; any S3-compatible service works.
provider = { name = "s3", bucket = "media", region = "auto",             # yours
             endpoint = "https://<account>.r2.cloudflarestorage.com",    # yours
             public_url = "https://media.example.com" }                  # yours
```

不要把 `.env` 放进代码仓库，也不要放进镜像（`.dockerignore`）。

## 2. 编写 `render.yaml`

```yaml title="render.yaml"
services:
  - type: web
    name: verdin
    runtime: docker
    repo: https://github.com/<you>/<your-project>   # yours
    branch: main
    dockerfilePath: ./Dockerfile
    region: frankfurt                               # yours
    healthCheckPath: /_ready
    envVars:
      - key: VERDIN_DATABASE_URL
        fromDatabase:
          name: verdin-db
          property: connectionString
      - key: VERDIN_ADMIN_JWT_SECRET
        generateValue: true
      - key: VERDIN_TOKEN_PEPPER
        generateValue: true
      - key: VERDIN_SERVER__PUBLIC_URL
        value: https://verdin.onrender.com          # yours: the service URL or your domain
      - key: AWS_ACCESS_KEY_ID
        sync: false                                 # asked for when you create the Blueprint
      - key: AWS_SECRET_ACCESS_KEY
        sync: false

databases:
  - name: verdin-db
    databaseName: verdin
    user: verdin
    region: frankfurt                               # yours: the same region
    postgresMajorVersion: "17"
```

为服务和数据库添加 `plan` 即可选择实例类型（参见 Render 的价格页面）；不设置时，Render 使用其默认值。

`generateValue: true` 会在首次应用 Blueprint 时创建每个密钥，并在之后保持不变。不要重新生成它们：新的 `VERDIN_TOKEN_PEPPER` 会让所有 API 令牌失效。

## 3. 部署

1. 在 Render 控制台中，从代码仓库创建一个 **Blueprint**，并填写 `sync: false` 变量的值。
2. 等待首次部署完成。镜像的默认命令 `start --migrate` 会在首次启动时创建表，并在之后的部署中执行安全迁移。
3. 打开 `https://<service>.onrender.com/admin/` 并注册第一个管理员。

Render 在停止实例前会发送 `SIGTERM`；Verdin 收到后会完成手头的工作并退出。

## 变体：把媒体放在磁盘上

对于单实例，可以把上传文件存放在 Render 持久磁盘而不是 S3 上。在 `verdin.toml` 中设置本地提供方：

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

并为服务添加一个磁盘：

```yaml title="render.yaml"
    disk:
      name: verdin-data
      mountPath: /data
      sizeGB: 5
```

使用磁盘后，Render 不允许把服务扩展到多个实例，而且部署时会先停止旧实例再启动新实例，因此每次部署都会有短暂的停机。如果不想使用 Render 数据库，同一个磁盘也可以存放 SQLite 数据库（`sqlite:///data/verdin.db`）。请确认镜像的用户（uid `65532`）可以写入该磁盘；如果启动时因 `/data` 权限错误而失败，请在 `Dockerfile` 中添加 `USER root`。

## 客户端地址

Render 的代理位于服务之前。本指南未核实其地址段，因此 `[server].trusted_proxies` 保持为空：这样所有访问者在速率限制中都会被算作同一个地址，所以除非你找到并信任该代理的地址段，否则请把 `[api].public_rate_limit` 保持为 `0`。
