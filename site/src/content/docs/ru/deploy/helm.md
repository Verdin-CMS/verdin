---
title: Helm-чарт
description: Установка Verdin в Kubernetes с помощью Helm-чарта из deploy/helm/verdin — SQLite на томе для одного пода или несколько реплик с внешней базой данных, S3 и общей шиной событий.
sidebar:
  order: 7
---

Чарт в [`deploy/helm/verdin`](https://github.com/verdin-cms/verdin/tree/main/deploy/helm/verdin)
упаковывает манифесты из раздела [Kubernetes](/ru/deploy/kubernetes/): Deployment с пробами,
Service, необязательный Ingress, PersistentVolumeClaim для `/data` и Secret с серверными
секретами. Он пока не опубликован в репозитории чартов; устанавливайте его из клона
репозитория.

Чарт проверен командами `helm lint --strict` и `helm template` (Helm 3) 2026-09-30, но на
реальный кластер не устанавливался.

## Один под с SQLite

По умолчанию запускается одна реплика с SQLite, а загрузки, кеш изображений и поисковый
индекс лежат на томе в 5 ГиБ, смонтированном в `/data`:

```sh frame="terminal"
git clone --depth 1 https://github.com/verdin-cms/verdin
helm install cms verdin/deploy/helm/verdin \
  --set publicUrl=https://cms.example.com \
  --set ingress.enabled=true --set ingress.hosts[0].host=cms.example.com \
  --set ingress.hosts[0].paths[0].path=/
```

Deployment использует стратегию `Recreate`, поэтому два пода никогда не открывают один и тот
же файл базы данных; при каждом обновлении есть короткий простой.

## Несколько реплик

Для нескольких реплик нужны три вещи, и без них чарт отказывается формировать манифесты:

- внешняя база данных (`database.url` или `database.existingSecret`: PostgreSQL, MySQL или
  MariaDB);
- `cluster.bus: database`, чтобы события реального времени, присутствие, сброс кеша и
  обновления поиска доходили до каждого пода (см.
  [общую шину событий](/ru/deploy/scaling/#общая-шина-событий));
- никакого тома ReadWriteOnce на `/data`: медиа в S3 с `persistence.enabled: false` (каждый
  под тогда держит кеш изображений и поисковый индекс в `emptyDir`) или класс хранилища
  ReadWriteMany.

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

Каждый под запускает `start --migrate`; миграции берут блокировку в базе данных, поэтому
выполняются один раз. Рискованные и разрушительные шаги при запуске не выполняются никогда:
применяйте их командой `kubectl exec deploy/cms-verdin -- verdin migrate apply --allow …` до
выкатки. Запланированные задания плагинов выполняются на каждом поде, где `plugins.runJobs`
равно true; см. [Запуск нескольких экземпляров](/ru/deploy/scaling/).

## Схема

Продакшен-серверы не редактируют схему, поэтому подам нужна ваша закоммиченная схема:

- **Собственный образ (рекомендуется).** `FROM ghcr.io/verdin-cms/verdin:0.11` плюс
  `COPY schema /app/schema` и `schema.path: /app/schema`. Тогда каждый образ несёт схему, с
  которой он был мигрирован.
- **`schema.files`.** Пути относительно каталога схемы и их JSON, которые превращаются в
  ConfigMap и монтируются в `/etc/verdin/schema`:

  ```yaml
  schema:
    files:
      content-types/article.json: |
        { "kind": "collectionType", "singularName": "article", … }
  ```

  `helm upgrade … --set-file 'schema.files.content-types/article\.json=schema/content-types/article.json'`
  читает файл с диска.

Без того и другого поды читают `/data/schema` на томе.

## Секреты

Если `secrets.existingSecret` пуст, чарт создаёт Secret с `VERDIN_ADMIN_JWT_SECRET` и
`VERDIN_TOKEN_PEPPER` (случайные при установке, при обновлениях читаются обратно и
сохраняются), а также с URL базы данных, учётными данными S3 и токеном метрик, которые вы
передали в значениях. У Secret и тома стоит `helm.sh/resource-policy: keep`: `helm uninstall`
их оставляет, поэтому при переустановке данные находятся, а API-токены продолжают работать.
Делайте резервную копию Secret вместе с базой данных.

Чтобы управлять секретами самостоятельно (Sealed Secrets, External Secrets, Vault), создайте
Secret с этими ключами и задайте `secrets.existingSecret`.

## Значения

| Значение | По умолчанию | Что это |
| --- | --- | --- |
| `image.repository`, `image.tag` | `ghcr.io/verdin-cms/verdin`, `appVersion` чарта | Образ. |
| `replicaCount` | `1` | См. [Несколько реплик](#несколько-реплик). |
| `args` | `["start", "--migrate"]` | Команда сервера. |
| `publicUrl` | | `VERDIN_SERVER__PUBLIC_URL`. |
| `trustedProxies` | `[]` | `VERDIN_SERVER__TRUSTED_PROXIES`. |
| `secrets.adminJwtSecret`, `secrets.tokenPepper`, `secrets.existingSecret` | генерируются | См. [Секреты](#секреты). |
| `database.url`, `database.existingSecret`, `database.existingSecretKey` | SQLite в `/data` | База данных. |
| `cluster.bus`, `cluster.pollIntervalMs` | `none`, `1000` | `[cluster]`. Имя каждого пода — его `instance_id`. |
| `s3.*` | выключено | Провайдер загрузок S3: `bucket`, `region`, `endpoint`, `publicUrl`, `prefix`, `pathStyle`, учётные данные или `existingSecret`. |
| `schema.path`, `schema.files` | | См. [Схема](#схема). |
| `configToml` | | Весь `verdin.toml`, смонтированный в `/app/verdin.toml`. Переменные окружения чарта по-прежнему имеют приоритет. |
| `metrics.enabled`, `metrics.token` | выключено | Метрики Prometheus на `/_metrics`. |
| `plugins.runJobs` | `true` | `[plugins].run_jobs`. |
| `extraEnv`, `extraEnvFrom` | `[]` | Дополнительные переменные, например `VERDIN_TELEMETRY__ENABLED`. |
| `persistence.*` | включено, 5Gi, ReadWriteOnce | Том `/data` (`existingClaim`, `storageClass`, `accessModes`, `size`). |
| `service.*`, `ingress.*` | ClusterIP на порту 80, без Ingress | Сеть. |
| `probes.*` | | Пробы запуска и готовности на `/_ready`, живости на `/_health`. |
| `resources`, `nodeSelector`, `tolerations`, `affinity`, `podAnnotations`, `podLabels` | | Планирование. |
| `podSecurityContext`, `securityContext` | uid 65532, корень только для чтения, без capabilities | Безопасность. `/tmp` — это `emptyDir`. |

`values.yaml` в чарте документирует каждый ключ.
