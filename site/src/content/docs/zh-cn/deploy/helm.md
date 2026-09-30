---
title: Helm chart
description: 使用 deploy/helm/verdin 中的 Helm chart 在 Kubernetes 上安装 Verdin：单个 Pod 使用卷上的 SQLite，或者多个副本搭配外部数据库、S3 和共享事件总线。
sidebar:
  order: 7
---

[`deploy/helm/verdin`](https://github.com/verdin-cms/verdin/tree/main/deploy/helm/verdin) 中的 chart 把 [Kubernetes](/zh-cn/deploy/kubernetes/) 的清单打包起来：带探针的 Deployment、Service、可选的 Ingress、用于 `/data` 的 PersistentVolumeClaim，以及包含服务器密钥的 Secret。它尚未发布到 chart 仓库；请从仓库的克隆中安装。

该 chart 已于 2026-09-30 用 `helm lint --strict` 和 `helm template`（Helm 3）检查过，没有安装到真实集群上。

## 使用 SQLite 的单个 Pod

默认设置运行一个副本，SQLite、上传内容、图片缓存和搜索索引都放在挂载于 `/data` 的 5 GiB 卷上：

```sh frame="terminal"
git clone --depth 1 https://github.com/verdin-cms/verdin
helm install cms verdin/deploy/helm/verdin \
  --set publicUrl=https://cms.example.com \
  --set ingress.enabled=true --set ingress.hosts[0].host=cms.example.com \
  --set ingress.hosts[0].paths[0].path=/
```

Deployment 使用 `Recreate` 策略，因此不会有两个 Pod 同时打开同一个数据库文件；每次升级都会有短暂的停机。

## 多个副本

多于一个副本需要三样东西，缺少任何一样 chart 都会拒绝渲染：

- 外部数据库（`database.url` 或 `database.existingSecret`：PostgreSQL、MySQL 或 MariaDB）；
- `cluster.bus: database`，这样实时事件、在线状态、缓存失效和搜索更新才会到达每个 Pod（参见[共享事件总线](/zh-cn/deploy/scaling/#共享事件总线)）；
- `/data` 上没有 ReadWriteOnce 卷：媒体放在 S3 上并设置 `persistence.enabled: false`（每个 Pod 会把图片缓存和搜索索引保存在 `emptyDir` 中），或者使用 ReadWriteMany 存储类。

```yaml title="values-production.yaml"
replicaCount: 3
image:
  repository: registry.example.com/verdin-site   # your image, schema baked in
  tag: "2026-09-30"
schema:
  path: /app/schema
publicUrl: https://cms.example.com
trustedProxies: ["10.0.0.0/8"]                    # the pod CIDR of your ingress controller
database:
  existingSecret: verdin-database                  # key VERDIN_DATABASE_URL
cluster:
  bus: database
persistence:
  enabled: false
s3:
  enabled: true
  bucket: media
  region: auto
  endpoint: https://<account>.r2.cloudflarestorage.com
  publicUrl: https://media.example.com
  existingSecret: verdin-s3                        # AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
metrics:
  enabled: true
  token: "<random token>"
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: cms.example.com
      paths: [{ path: /, pathType: Prefix }]
  tls:
    - secretName: cms-example-com-tls
      hosts: [cms.example.com]
```

```sh frame="terminal"
helm upgrade --install cms verdin/deploy/helm/verdin -f values-production.yaml
```

每个 Pod 都运行 `start --migrate`；迁移会在数据库中获取锁，因此只会执行一次。有风险或破坏性的步骤永远不会在启动时执行：请在发布之前用 `kubectl exec deploy/cms-verdin -- verdin migrate apply --allow …` 应用它们。定时插件任务会在每个 `plugins.runJobs` 为 true 的 Pod 上运行；参见[运行多个实例](/zh-cn/deploy/scaling/)。

## Schema

生产服务器不会编辑 schema，因此 Pod 需要你已提交的 schema：

- **你自己的镜像（推荐）。** `FROM ghcr.io/verdin-cms/verdin:0.11` 加上 `COPY schema /app/schema`，并设置 `schema.path: /app/schema`。这样每个镜像都带有它迁移时所用的 schema。
- **`schema.files`。** 相对于 schema 目录的路径及其 JSON，会渲染到 ConfigMap 中并挂载在 `/etc/verdin/schema`：

  ```yaml
  schema:
    files:
      content-types/article.json: |
        { "kind": "collectionType", "singularName": "article", … }
  ```

  `helm upgrade … --set-file 'schema.files.content-types/article\.json=schema/content-types/article.json'` 会从磁盘读取文件。

两者都没有时，Pod 会读取卷上的 `/data/schema`。

## 密钥

`secrets.existingSecret` 为空时，chart 会创建一个 Secret，其中包含 `VERDIN_ADMIN_JWT_SECRET` 和 `VERDIN_TOKEN_PEPPER`（安装时随机生成，升级时读回并保留），以及你在 values 中传入的数据库 URL、S3 凭据和指标令牌。该 Secret 和卷带有 `helm.sh/resource-policy: keep`：`helm uninstall` 会保留它们，因此重新安装后能找到自己的数据，API 令牌仍然有效。请把该 Secret 与你的数据库一起备份。

如果要自己管理密钥（Sealed Secrets、External Secrets、Vault），请创建一个包含这些键的 Secret，并设置 `secrets.existingSecret`。

## Values

| Value | 默认值 | 说明 |
| --- | --- | --- |
| `image.repository`、`image.tag` | `ghcr.io/verdin-cms/verdin`，chart 的 `appVersion` | 镜像。 |
| `replicaCount` | `1` | 参见[多个副本](#多个副本)。 |
| `args` | `["start", "--migrate"]` | 服务器的命令。 |
| `publicUrl` | | `VERDIN_SERVER__PUBLIC_URL`。 |
| `trustedProxies` | `[]` | `VERDIN_SERVER__TRUSTED_PROXIES`。 |
| `secrets.adminJwtSecret`、`secrets.tokenPepper`、`secrets.existingSecret` | 自动生成 | 参见[密钥](#密钥)。 |
| `database.url`、`database.existingSecret`、`database.existingSecretKey` | `/data` 上的 SQLite | 数据库。 |
| `cluster.bus`、`cluster.pollIntervalMs` | `none`、`1000` | `[cluster]`。每个 Pod 的名称就是它的 `instance_id`。 |
| `s3.*` | 已禁用 | S3 上传提供方：`bucket`、`region`、`endpoint`、`publicUrl`、`prefix`、`pathStyle`、凭据或 `existingSecret`。 |
| `schema.path`、`schema.files` | | 参见 [Schema](#schema)。 |
| `configToml` | | 一份完整的 `verdin.toml`，挂载在 `/app/verdin.toml`。chart 的环境变量仍然优先。 |
| `metrics.enabled`、`metrics.token` | 已禁用 | `/_metrics` 上的 Prometheus 指标。 |
| `plugins.runJobs` | `true` | `[plugins].run_jobs`。 |
| `extraEnv`、`extraEnvFrom` | `[]` | 更多变量，例如 `VERDIN_TELEMETRY__ENABLED`。 |
| `persistence.*` | 已启用，5Gi，ReadWriteOnce | `/data` 卷（`existingClaim`、`storageClass`、`accessModes`、`size`）。 |
| `service.*`、`ingress.*` | 80 端口的 ClusterIP，无 Ingress | 网络。 |
| `probes.*` | | `/_ready` 上的启动和就绪探针，`/_health` 上的存活探针。 |
| `resources`、`nodeSelector`、`tolerations`、`affinity`、`podAnnotations`、`podLabels` | | 调度。 |
| `podSecurityContext`、`securityContext` | uid 65532，只读根文件系统，无 capabilities | 安全。`/tmp` 是一个 `emptyDir`。 |

chart 中的 `values.yaml` 记录了每个键。
