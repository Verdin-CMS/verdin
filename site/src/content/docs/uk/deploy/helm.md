---
title: Helm-чарт
description: Установлення Verdin у Kubernetes за допомогою Helm-чарта з deploy/helm/verdin — SQLite на томі для одного пода або кілька реплік із зовнішньою базою даних, S3 і спільною шиною подій.
sidebar:
  order: 7
---

Чарт у [`deploy/helm/verdin`](https://github.com/verdin-cms/verdin/tree/main/deploy/helm/verdin)
пакує маніфести з [Kubernetes](/uk/deploy/kubernetes/): Deployment із пробами, Service,
необов'язковий Ingress, PersistentVolumeClaim для `/data` і Secret із секретами сервера. Його
ще не опубліковано в репозиторії чартів; установлюйте його з клону репозиторію.

Чарт перевірено через `helm lint --strict` і `helm template` (Helm 3) 2026-09-30, але не
встановлювали на реальний кластер.

## Один под із SQLite

Типові значення запускають одну репліку із SQLite, завантаженнями, кешем зображень і пошуковим
індексом на томі 5 GiB, змонтованому в `/data`:

```sh frame="terminal"
git clone --depth 1 https://github.com/verdin-cms/verdin
helm install cms verdin/deploy/helm/verdin \
  --set publicUrl=https://cms.example.com \
  --set ingress.enabled=true --set ingress.hosts[0].host=cms.example.com \
  --set ingress.hosts[0].paths[0].path=/
```

Deployment використовує стратегію `Recreate`, тож два поди ніколи не відкривають той самий
файл бази даних; кожне оновлення має короткий простій.

## Кілька реплік

Більше ніж одна репліка потребує трьох речей, і без них чарт відмовляється рендеритися:

- зовнішня база даних (`database.url` або `database.existingSecret`: PostgreSQL, MySQL чи
  MariaDB);
- `cluster.bus: database`, щоб події реального часу, присутність, інвалідація кешу й оновлення
  пошуку доходили до кожного пода (див.
  [спільну шину подій](/uk/deploy/scaling/#спільна-шина-подій));
- жодного тому ReadWriteOnce на `/data`: медіа в S3 з `persistence.enabled: false` (кожен
  под тоді тримає свій кеш зображень і пошуковий індекс в `emptyDir`) або клас сховища
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

Кожен под запускає `start --migrate`; міграції беруть блокування в базі даних, тож виконуються
один раз. Ризиковані чи деструктивні кроки ніколи не виконуються під час запуску: застосуйте
їх через `kubectl exec deploy/cms-verdin -- verdin migrate apply --allow …` перед
розгортанням. Заплановані завдання плагінів виконуються на кожному поді, де `plugins.runJobs`
дорівнює true; див. [Кілька екземплярів](/uk/deploy/scaling/).

## Схема

Production-сервери не редагують схему, тож подам потрібна ваша закомічена схема:

- **Власний образ (рекомендовано).** `FROM ghcr.io/verdin-cms/verdin:0.11` плюс
  `COPY schema /app/schema` і `schema.path: /app/schema`. Тоді кожен образ несе схему, з якою
  його мігровано.
- **`schema.files`.** Шляхи відносно каталогу схеми та їхній JSON, що рендеряться в ConfigMap і
  монтуються в `/etc/verdin/schema`:

  ```yaml
  schema:
    files:
      content-types/article.json: |
        { "kind": "collectionType", "singularName": "article", … }
  ```

  `helm upgrade … --set-file 'schema.files.content-types/article\.json=schema/content-types/article.json'`
  читає файл з диска.

Без жодного з них поди читають `/data/schema` на томі.

## Секрети

Коли `secrets.existingSecret` порожній, чарт створює Secret із `VERDIN_ADMIN_JWT_SECRET` і
`VERDIN_TOKEN_PEPPER` (випадкові під час установлення, зчитуються назад і зберігаються під час
оновлень), а також URL бази даних, облікові дані S3 і токен метрик, які ви передаєте у
значеннях. Secret і том мають `helm.sh/resource-policy: keep`: `helm uninstall` їх залишає, тож
перевстановлення знаходить свої дані, а API-токени й далі працюють. Робіть резервну копію Secret
разом із базою даних.

Щоб керувати секретами самостійно (Sealed Secrets, External Secrets, Vault), створіть Secret з
цими ключами й задайте `secrets.existingSecret`.

## Значення

| Значення | Типово | Що |
| --- | --- | --- |
| `image.repository`, `image.tag` | `ghcr.io/verdin-cms/verdin`, `appVersion` чарта | Образ. |
| `replicaCount` | `1` | Див. [Кілька реплік](#кілька-реплік). |
| `args` | `["start", "--migrate"]` | Команда сервера. |
| `publicUrl` | | `VERDIN_SERVER__PUBLIC_URL`. |
| `trustedProxies` | `[]` | `VERDIN_SERVER__TRUSTED_PROXIES`. |
| `secrets.adminJwtSecret`, `secrets.tokenPepper`, `secrets.existingSecret` | згенеровані | Див. [Секрети](#секрети). |
| `database.url`, `database.existingSecret`, `database.existingSecretKey` | SQLite на `/data` | База даних. |
| `cluster.bus`, `cluster.pollIntervalMs` | `none`, `1000` | `[cluster]`. Назва кожного пода — це його `instance_id`. |
| `s3.*` | вимкнено | Провайдер завантажень S3: `bucket`, `region`, `endpoint`, `publicUrl`, `prefix`, `pathStyle`, облікові дані або `existingSecret`. |
| `schema.path`, `schema.files` | | Див. [Схема](#схема). |
| `configToml` | | Цілий `verdin.toml`, змонтований у `/app/verdin.toml`. Змінні середовища чарта й далі мають пріоритет. |
| `metrics.enabled`, `metrics.token` | вимкнено | Метрики Prometheus на `/_metrics`. |
| `plugins.runJobs` | `true` | `[plugins].run_jobs`. |
| `extraEnv`, `extraEnvFrom` | `[]` | Додаткові змінні, наприклад `VERDIN_TELEMETRY__ENABLED`. |
| `persistence.*` | увімкнено, 5Gi, ReadWriteOnce | Том `/data` (`existingClaim`, `storageClass`, `accessModes`, `size`). |
| `service.*`, `ingress.*` | ClusterIP на порту 80, без Ingress | Мережа. |
| `probes.*` | | Startup і readiness на `/_ready`, liveness на `/_health`. |
| `resources`, `nodeSelector`, `tolerations`, `affinity`, `podAnnotations`, `podLabels` | | Планування. |
| `podSecurityContext`, `securityContext` | uid 65532, коренева система лише для читання, без capabilities | Безпека. `/tmp` — це `emptyDir`. |

`values.yaml` у чарті документує кожен ключ.
