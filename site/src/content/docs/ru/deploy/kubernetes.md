---
title: Kubernetes
description: Запуск Verdin в Kubernetes — Deployment с пробами, Secret и Service для PostgreSQL и S3, а также конфигурация с одной репликой и PersistentVolumeClaim для SQLite.
sidebar:
  order: 7
---

На этой странице проект Verdin запускается в Kubernetes. Основная конфигурация не хранит
состояния: PostgreSQL (или MySQL/MariaDB) вне подов, медиа в S3-совместимом хранилище и
столько реплик, сколько нужно. Ниже описана конфигурация с одной репликой и томом для SQLite.

Манифесты используют стабильные API (`apps/v1`, `v1`) и проверены по схемам Kubernetes с
помощью `kubeconform -strict` 2026-09-29, но на реальном кластере не запускались. Замените
все значения в угловых скобках.

## 1. Соберите образ

Вшейте конфигурацию и схему в образ на основе официального, чтобы каждый релиз поставлял ту
схему, с которой была выполнена миграция (см. [Собственный образ](/ru/deploy/docker/)):

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

Отправьте его в свой реестр как `<registry>/verdin-site:<version>`.

## 2. Секреты

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

Или создайте его из вывода `verdin secrets` командой
`kubectl create secret generic verdin --from-env-file=…` и добавьте остальные значения.

## 3. Deployment и Service

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

Опубликуйте Service через свой Ingress или Gateway с TLS, как любой HTTP-сервис. Значения
ресурсов — отправная точка, а не результат измерений.

Замечания к манифесту:

- **Миграции.** Каждая реплика выполняет `start --migrate`. Миграции берут блокировку в
  базе данных (advisory lock в PostgreSQL, `GET_LOCK` в MySQL/MariaDB), поэтому реплики,
  которые запускаются одновременно, применяют их один раз. Рискованные и разрушительные шаги
  при запуске никогда не применяются: перед выкаткой выполните
  `verdin migrate apply --allow …` как разовый Job с тем же образом.
- **Корневая файловая система только для чтения.** Загрузки записываются потоком через
  `/tmp`, поэтому ему нужен `emptyDir` с правом записи. Кешу преобразований изображений и
  поисковому индексу, если вы их используете, тоже нужны каталоги с правом записи
  (`/tmp/transforms` выше; задайте также `VERDIN_SEARCH__DIR`).
- **Остановка.** Verdin останавливается по `SIGTERM`.
- **Задания плагинов.** Запланированные задания плагинов выполняются на каждой реплике, где
  `[plugins].run_jobs` равно true. Запустите отдельный Deployment с `replicas: 1` и
  `VERDIN_PLUGINS__RUN_JOBS=true` (с теми же метками, чтобы он тоже обслуживал трафик) или
  смиритесь с тем, что задания выполняются на каждой реплике. Вебхуки, запланированные релизы
  и ежедневная сводка забираются через базу данных и выполняются один раз. См.
  [Запуск нескольких экземпляров](/ru/deploy/scaling/).
- **Реальное время.** Потоки событий (`/api/_events`) остаются на том поде, к которому
  подключились. Если вы используете [реальное время](/ru/guides/frontend/realtime/),
  включите привязку сессий (session affinity) на Ingress.

## Одна реплика с SQLite

Для SQLite и локальных загрузок нужны один под и постоянный том:

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

Здесь `verdin.toml` использует `provider = { name = "local", dir = "/data/uploads" }`, а
`VERDIN_DATABASE_URL` в Secret не нужен (запись в `env` имеет приоритет над `envFrom`).
`StatefulSet` с одной репликой и записью `volumeClaimTemplates` работает так же. `Recreate`
означает короткий простой при каждой выкатке.

## Команды администрирования

Выполняйте команды CLI в работающем поде; в образе нет оболочки, поэтому вызывайте бинарник
напрямую:

```sh frame="terminal"
kubectl exec -it deploy/verdin -- verdin admin create --email you@example.com
kubectl exec deploy/verdin -- verdin migrate plan
```
