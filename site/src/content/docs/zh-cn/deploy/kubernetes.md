---
title: Kubernetes
description: 在 Kubernetes 上运行 Verdin：带探针的 Deployment、Secret 以及面向 PostgreSQL 和 S3 的 Service，还有使用 PersistentVolumeClaim 的 SQLite 单副本方案。
sidebar:
  order: 7
---

本页在 Kubernetes 上运行一个 Verdin 项目。主方案是无状态的：PostgreSQL（或 MySQL/MariaDB）位于 Pod 之外，媒体放在 S3 兼容存储上，副本数量按需设置。之后还介绍了一个使用卷存放 SQLite 的单副本方案。

这些清单使用稳定的 API（`apps/v1`、`v1`），已于 2026-09-29 用 `kubeconform -strict` 对照 Kubernetes schema 校验过，但没有在真实集群上运行过。请替换所有尖括号中的值。

## 1. 构建镜像

把你的配置和 schema 打包进基于官方镜像的镜像中，这样每个版本都会带上它迁移时所用的 schema（参见[你自己的镜像](/zh-cn/deploy/docker/)）：

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337
public_url = "https://cms.example.com"
trusted_proxies = ["<pod CIDR of your ingress controller, e.g. 10.0.0.0/8>"]

[schema]
path = "schema"

[log]
format = "json"

[api]
cache_ttl_secs = 5         # short: each replica keeps its own cache

[metrics]
enabled = true             # token from VERDIN_METRICS_TOKEN

[upload]
provider = { name = "s3", bucket = "<bucket>", region = "<region>",
             public_url = "https://<bucket public URL or CDN>" }

[upload.transforms]
cache_dir = "/tmp/transforms"
```

把它推送到你的镜像仓库，命名为 `<registry>/verdin-site:<version>`。

## 2. Secret

```yaml title="secret.yaml"
apiVersion: v1
kind: Secret
metadata:
  name: verdin
type: Opaque
stringData:
  VERDIN_ADMIN_JWT_SECRET: "<from verdin secrets>"
  VERDIN_TOKEN_PEPPER: "<from verdin secrets>"
  VERDIN_DATABASE_URL: "postgres://<user>:<password>@<host>:5432/<db>"
  VERDIN_METRICS_TOKEN: "<random token>"
  AWS_ACCESS_KEY_ID: "<key>"
  AWS_SECRET_ACCESS_KEY: "<secret>"
```

也可以用 `kubectl create secret generic verdin --from-env-file=…` 根据 `verdin secrets` 的输出创建它，然后再添加其他项。

## 3. Deployment 和 Service

```yaml title="verdin.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: verdin
spec:
  replicas: 2
  selector:
    matchLabels: { app: verdin }
  template:
    metadata:
      labels: { app: verdin }
    spec:
      terminationGracePeriodSeconds: 30
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
      containers:
        - name: verdin
          image: <registry>/verdin-site:<version>
          args: ["start", "--migrate"]
          ports:
            - { name: http, containerPort: 1337 }
          envFrom:
            - secretRef: { name: verdin }
          env:
            # Scheduled plugin jobs on one replica only (see below).
            - { name: VERDIN_PLUGINS__RUN_JOBS, value: "false" }
          startupProbe:
            httpGet: { path: /_ready, port: http }
            periodSeconds: 5
            failureThreshold: 60        # up to 5 minutes for migrations
          readinessProbe:
            httpGet: { path: /_ready, port: http }
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /_health, port: http }
            periodSeconds: 20
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits: { memory: 1Gi }
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          volumeMounts:
            - { name: tmp, mountPath: /tmp }
      volumes:
        - name: tmp
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: verdin
spec:
  selector: { app: verdin }
  ports:
    - { name: http, port: 80, targetPort: http }
```

与任何 HTTP 服务一样，通过带 TLS 的 Ingress 或 Gateway 暴露该 Service。资源数值只是一个起点，而不是实测结果。

关于该清单的说明：

- **迁移。** 每个副本都会运行 `start --migrate`。迁移会在数据库中获取一个锁（PostgreSQL 上为 advisory lock，MySQL/MariaDB 上为 `GET_LOCK`），因此同时启动的副本只会执行一次迁移。有风险或破坏性的步骤永远不会在启动时执行：请在发布之前，用同一个镜像以一次性 Job 的方式运行 `verdin migrate apply --allow …`。
- **只读根文件系统。** 上传内容会经由 `/tmp` 以流的方式传输，因此它需要一个可写的 `emptyDir`。如果使用图片转换缓存和搜索索引，它们也需要可写目录（上面的 `/tmp/transforms`；同时设置 `VERDIN_SEARCH__DIR`）。
- **关闭。** Verdin 收到 `SIGTERM` 时停止。
- **插件任务。** 定时插件任务会在每个 `[plugins].run_jobs` 为 true 的副本上运行。可以额外运行一个 `replicas: 1` 且设置了 `VERDIN_PLUGINS__RUN_JOBS=true` 的 Deployment（使用相同的标签，因此它也会处理流量），或者接受任务在每个副本上都运行。webhook、定时发布计划和每日摘要会在数据库中被领取，只运行一次。参见[运行多个实例](/zh-cn/deploy/scaling/)。
- **实时。** 事件流（`/api/_events`）会一直停留在它所连接的 Pod 上。如果使用[实时](/zh-cn/guides/frontend/realtime/)功能，请在 Ingress 上使用会话亲和性。

## SQLite 单副本

SQLite 和本地上传需要一个 Pod 和一个持久卷：

```yaml title="verdin-sqlite.yaml"
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: verdin-data
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests: { storage: 5Gi }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: verdin
spec:
  replicas: 1
  strategy:
    type: Recreate              # never two pods on the same database file
  selector:
    matchLabels: { app: verdin }
  template:
    metadata:
      labels: { app: verdin }
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
        fsGroup: 65532          # lets the server write to the volume
      containers:
        - name: verdin
          image: <registry>/verdin-site:<version>
          ports:
            - { name: http, containerPort: 1337 }
          envFrom:
            - secretRef: { name: verdin }
          env:
            - { name: VERDIN_DATABASE_URL, value: "sqlite:///data/verdin.db" }
          readinessProbe:
            httpGet: { path: /_ready, port: http }
          livenessProbe:
            httpGet: { path: /_health, port: http }
          volumeMounts:
            - { name: data, mountPath: /data }
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: verdin-data }
```

这里 `verdin.toml` 使用 `provider = { name = "local", dir = "/data/uploads" }`，Secret 中的 `VERDIN_DATABASE_URL` 也不再需要（`env` 条目优先于 `envFrom`）。只有一个副本并带有 `volumeClaimTemplates` 条目的 `StatefulSet` 效果相同。`Recreate` 意味着每次发布都会有短暂的停机。

## 管理命令

在运行中的 Pod 里执行 CLI 命令；镜像中没有 shell，因此直接调用二进制文件：

```sh frame="terminal"
kubectl exec -it deploy/verdin -- verdin admin create --email you@example.com
kubectl exec deploy/verdin -- verdin migrate plan
```
