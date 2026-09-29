---
title: Railway
description: 使用代码仓库中的 Dockerfile 把 Verdin 部署到 Railway，搭配 Railway PostgreSQL，媒体放在 S3 兼容存储或卷上。
sidebar:
  order: 6
---

本页把一个 Verdin 项目部署到 [Railway](https://railway.com)：一个由代码仓库中的小型 Dockerfile 构建的服务、一个 Railway PostgreSQL 数据库，以及放在 S3 兼容存储上的媒体（单实例时也可以放在卷上）。

:::note
Railway 的设置已于 2026-09-29 对照 [Railway 的文档](https://docs.railway.com/reference/config-as-code)进行核对；该方案未在真实的 Railway 账户上部署过。标有 `# yours` 或位于尖括号中的值需要你自己填写。
:::

## 1. 添加 Dockerfile、配置和 `railway.json`

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
provider = { name = "s3", bucket = "media", region = "auto",             # yours
             endpoint = "https://<account>.r2.cloudflarestorage.com",    # yours
             public_url = "https://media.example.com" }                  # yours
```

```json title="railway.json"
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "healthcheckPath": "/_ready",
    "healthcheckTimeout": 120,
    "restartPolicyType": "ON_FAILURE"
  }
}
```

不需要启动命令：镜像会运行 `start --migrate`，在提供服务之前执行安全迁移。不要把 `.env` 放进代码仓库。

## 2. 创建项目

1. 在 Railway 中，从你的 GitHub 仓库创建一个项目。Railway 会找到 `railway.json` 并构建 Dockerfile。
2. 向项目中添加一个 **PostgreSQL** 数据库。
3. 在 Verdin 服务的 **Variables** 中添加：

   | 变量 | 值 |
   | --- | --- |
   | `VERDIN_DATABASE_URL` | `${{Postgres.DATABASE_URL}}`（数据库服务的内网 URL；请使用你的数据库服务的名称） |
   | `VERDIN_ADMIN_JWT_SECRET` | 来自 `verdin secrets` |
   | `VERDIN_TOKEN_PEPPER` | 来自 `verdin secrets` |
   | `VERDIN_SERVER__PUBLIC_URL` | `https://<your-domain>` |
   | `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY` | 你的 S3 凭据 |

   在本地生成这两个密钥：

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets
   ```

4. 在服务的网络设置中点击 **Generate Domain**，并把目标端口设为 `1337`。Verdin 监听 `[server].port`，不会读取 Railway 的 `PORT` 变量。
5. 部署，打开 `https://<your-domain>/admin/` 并注册第一个管理员。

## 变体：把媒体或 SQLite 放在卷上

对于单实例，可以把上传文件甚至数据库放在挂载于 `/data` 的 Railway 卷上：

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

如果不使用 PostgreSQL，再设置 `VERDIN_DATABASE_URL=sqlite:///data/verdin.db`。请注意：

- 带卷的服务不能有副本，每次重新部署都会有短暂的停机。
- Railway 挂载的卷属于 root，而镜像以 uid `65532` 运行。请设置服务变量 `RAILWAY_RUN_UID=0`，让服务器能够写入该卷。

## 客户端地址

Railway 的边缘代理位于服务之前。本指南未核实其地址段，因此 `[server].trusted_proxies` 保持为空：这样所有访问者在速率限制中都会被算作同一个地址，所以除非你找到并信任该代理的地址段，否则请把 `[api].public_rate_limit` 保持为 `0`。
