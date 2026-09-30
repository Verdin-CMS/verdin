---
title: Kubernetes
description: Запуск Verdin у Kubernetes — Deployment із пробами, Secret і Service для PostgreSQL і S3, а також конфігурація з однією реплікою та PersistentVolumeClaim для SQLite.
sidebar:
  order: 7
---

На цій сторінці проєкт Verdin запускається в Kubernetes. Основна конфігурація не має стану:
PostgreSQL (або MySQL/MariaDB) поза подами, медіа в S3-сумісному сховищі й стільки реплік,
скільки потрібно. Далі наведено конфігурацію з однією реплікою та томом для SQLite.
[Helm-чарт](/uk/deploy/helm/) пакує ці маніфести зі значеннями для кожного налаштування.

Маніфести використовують стабільні API (`apps/v1`, `v1`) і перевірені за схемами Kubernetes
через `kubeconform -strict` 2026-09-29, але не запускалися на реальному кластері. Замініть усі
значення в кутових дужках.

## 1. Зберіть образ

Вбудуйте конфігурацію та схему в образ на основі офіційного, щоб кожен реліз постачав схему,
з якою його мігрували (див. [Власний образ](/uk/deploy/docker/)):

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
cache_ttl_secs = 60        # emptied on every replica by the event bus

[cluster]
bus = "database"           # realtime, presence, caches and search across replicas

[metrics]
enabled = true             # token from VERDIN_METRICS_TOKEN

[upload]
provider = { name = "s3", bucket = "<bucket>", region = "<region>",
             public_url = "https://<bucket public URL or CDN>" }

[upload.transforms]
cache_dir = "/tmp/transforms"
```

Завантажте його у свій реєстр як `<registry>/verdin-site:<version>`.

## 2. Секрети

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

Або створіть його з виводу `verdin secrets` через
`kubectl create secret generic verdin --from-env-file=…` і додайте решту.

## 3. Deployment і Service

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

Відкрийте Service через свій Ingress або Gateway з TLS, як для будь-якого HTTP-сервісу. Значення
ресурсів — це відправна точка, а не результат вимірювань.

Примітки до маніфесту:

- **Міграції.** Кожна репліка запускає `start --migrate`. Міграції беруть блокування в базі
  даних (advisory lock у PostgreSQL, `GET_LOCK` у MySQL/MariaDB), тож репліки, що стартують
  разом, застосовують їх один раз. Ризиковані чи деструктивні кроки ніколи не застосовуються
  під час запуску: виконайте `verdin migrate apply --allow …` як разовий Job з тим самим образом
  перед викочуванням.
- **Коренева файлова система лише для читання.** Завантаження проходять потоком через `/tmp`,
  тож йому потрібен `emptyDir` із записом. Кеш трансформацій зображень і пошуковий індекс,
  якщо ви їх використовуєте, теж потребують каталогів із записом (`/tmp/transforms` вище;
  задайте також `VERDIN_SEARCH__DIR`).
- **Завершення.** Verdin зупиняється за `SIGTERM`.
- **Завдання плагінів.** Заплановані завдання плагінів виконуються на кожній репліці, де
  `[plugins].run_jobs` дорівнює true. Запустіть ще один Deployment з `replicas: 1` і
  `VERDIN_PLUGINS__RUN_JOBS=true` (з тими самими мітками, щоб він теж обслуговував трафік) або
  змиріться з тим, що завдання виконуються на кожній репліці. Вебхуки, заплановані релізи та
  щоденний дайджест забираються через базу даних і виконуються один раз. Див.
  [Кілька екземплярів](/uk/deploy/scaling/).
- **Реальний час, присутність, кеші та пошук.** `[cluster].bus = "database"` доставляє кожному
  поду події інших (див. [спільну шину подій](/uk/deploy/scaling/#спільна-шина-подій)). Без
  неї потоки подій (`/api/_events`) залишаються на поді, до якого підключилися: використовуйте
  session affinity на Ingress, якщо користуєтеся
  [реальним часом](/uk/guides/frontend/realtime/).

## Одна репліка із SQLite

SQLite і локальні завантаження потребують одного пода й постійного тому:

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

Тут `verdin.toml` використовує `provider = { name = "local", dir = "/data/uploads" }`, а
`VERDIN_DATABASE_URL` у Secret не потрібен (запис `env` має пріоритет над `envFrom`).
`StatefulSet` з однією реплікою та записом `volumeClaimTemplates` працює так само. `Recreate`
означає короткий простій під час кожного викочування.

## Команди адміністрування

Запускайте команди CLI в запущеному поді; в образі немає shell, тож викликайте бінарник:

```sh frame="terminal"
kubectl exec -it deploy/verdin -- verdin admin create --email you@example.com
kubectl exec deploy/verdin -- verdin migrate plan
```
