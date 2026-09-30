---
title: چارت Helm
description: Verdin را با چارت Helm در deploy/helm/verdin روی Kubernetes نصب کنید — SQLite روی یک volume برای یک pod، یا چند رپلیکا با پایگاه داده خارجی، S3 و گذرگاه رویداد مشترک.
sidebar:
  order: 7
---

چارت در [`deploy/helm/verdin`](https://github.com/verdin-cms/verdin/tree/main/deploy/helm/verdin)
manifestهای [Kubernetes](/fa/deploy/kubernetes/) را بسته‌بندی می‌کند: یک Deployment با probeها، یک
Service، یک Ingress اختیاری، یک PersistentVolumeClaim برای `/data` و یک Secret با
کلیدهای محرمانهٔ سرور. هنوز در یک مخزن چارت منتشر نشده است؛ آن را از یک clone مخزن نصب کنید.

چارت در تاریخ 2026-09-30 با `helm lint --strict` و `helm template` (Helm 3) بررسی شد،
نه روی یک کلاستر زنده نصب.

## یک pod با SQLite

پیش‌فرض‌ها یک رپلیکا با SQLite اجرا می‌کنند، و بارگذاری‌ها، کش تصویر و نمایهٔ جستجو را روی
یک volume با حجم 5 GiB که در `/data` mount شده نگه می‌دارند:

```sh frame="terminal"
git clone --depth 1 https://github.com/verdin-cms/verdin
helm install cms verdin/deploy/helm/verdin \
  --set publicUrl=https://cms.example.com \
  --set ingress.enabled=true --set ingress.hosts[0].host=cms.example.com \
  --set ingress.hosts[0].paths[0].path=/
```

Deployment از راهبرد `Recreate` استفاده می‌کند، پس دو pod هرگز یک فایل پایگاه داده را باز
نمی‌کنند؛ هر ارتقا کمی downtime دارد.

## چند رپلیکا

بیش از یک رپلیکا به سه چیز نیاز دارد، و چارت بدون آن‌ها render نمی‌شود:

- یک پایگاه دادهٔ خارجی (`database.url` یا `database.existingSecret`: PostgreSQL، MySQL
  یا MariaDB)؛
- `cluster.bus: database`، تا رویدادهای بلادرنگ، حضور، ابطال کش و به‌روزرسانی‌های جستجو
  به هر pod برسند (بخش [گذرگاه رویداد مشترک](/fa/deploy/scaling/#گذرگاه-رویداد-مشترک) را ببینید)؛
- بدون volume از نوع ReadWriteOnce روی `/data`: رسانه روی S3 با `persistence.enabled: false`
  (هر pod آن‌وقت کش تصویر و نمایهٔ جستجوی خود را در یک `emptyDir` نگه می‌دارد)، یا یک
  storage class از نوع ReadWriteMany.

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

هر pod `start --migrate` را اجرا می‌کند؛ مهاجرت‌ها در پایگاه داده قفل می‌گیرند، پس یک بار
اجرا می‌شوند. گام‌های پرخطر یا مخرب هرگز هنگام شروع اجرا نمی‌شوند: پیش از rollout آن‌ها را با
`kubectl exec deploy/cms-verdin -- verdin migrate apply --allow …` اعمال کنید.
کارهای زمان‌بندی‌شدهٔ افزونه‌ها روی هر podی که `plugins.runJobs` در آن true باشد اجرا می‌شوند؛
[اجرای چند نمونه](/fa/deploy/scaling/) را ببینید.

## طرح‌واره

سرورهای تولید طرح‌واره را ویرایش نمی‌کنند، پس podها به طرح‌وارهٔ commit‌شدهٔ شما نیاز دارند:

- **ایمیج خودتان (توصیه‌شده).** `FROM ghcr.io/verdin-cms/verdin:0.11` به‌علاوهٔ
  `COPY schema /app/schema`، و `schema.path: /app/schema`. آن‌وقت هر ایمیج طرح‌واره‌ای را
  که با آن مهاجرت داده شده با خود دارد.
- **`schema.files`.** مسیرهای نسبت به پوشهٔ طرح‌واره و JSON آن‌ها، که در یک ConfigMap render می‌شوند
  و در `/etc/verdin/schema` mount می‌شوند:

  ```yaml
  schema:
    files:
      content-types/article.json: |
        { "kind": "collectionType", "singularName": "article", … }
  ```

  `helm upgrade … --set-file 'schema.files.content-types/article\.json=schema/content-types/article.json'`
  یک فایل را از دیسک می‌خواند.

بدون هیچ‌کدام، podها `/data/schema` را روی volume می‌خوانند.

## کلیدهای محرمانه

وقتی `secrets.existingSecret` خالی است، چارت یک Secret با
`VERDIN_ADMIN_JWT_SECRET` و `VERDIN_TOKEN_PEPPER` می‌سازد (هنگام نصب تصادفی، و در ارتقاها خوانده
و حفظ می‌شود)، به‌علاوهٔ URL پایگاه داده، اعتبارنامه‌های S3 و توکن متریک‌هایی که در values می‌دهید.
Secret و volume دارای `helm.sh/resource-policy: keep` هستند: `helm uninstall` آن‌ها را باقی می‌گذارد،
پس نصب دوباره داده‌هایش را می‌یابد و توکن‌های API همچنان کار می‌کنند. از Secret همراه پایگاه داده‌تان
نسخهٔ پشتیبان بگیرید.

برای مدیریت کلیدهای محرمانه توسط خودتان (Sealed Secrets، External Secrets، Vault)، یک Secret با همان
کلیدها بسازید و `secrets.existingSecret` را تنظیم کنید.

## مقدارها

| مقدار | پیش‌فرض | چه |
| --- | --- | --- |
| `image.repository`، `image.tag` | `ghcr.io/verdin-cms/verdin`، `appVersion` چارت | ایمیج. |
| `replicaCount` | `1` | [چند رپلیکا](#چند-رپلیکا) را ببینید. |
| `args` | `["start", "--migrate"]` | فرمان سرور. |
| `publicUrl` | | `VERDIN_SERVER__PUBLIC_URL`. |
| `trustedProxies` | `[]` | `VERDIN_SERVER__TRUSTED_PROXIES`. |
| `secrets.adminJwtSecret`، `secrets.tokenPepper`، `secrets.existingSecret` | تولیدشده | [کلیدهای محرمانه](#کلیدهای-محرمانه) را ببینید. |
| `database.url`، `database.existingSecret`، `database.existingSecretKey` | SQLite روی `/data` | پایگاه داده. |
| `cluster.bus`، `cluster.pollIntervalMs` | `none`، `1000` | `[cluster]`. نام هر pod همان `instance_id` آن است. |
| `s3.*` | غیرفعال | ارائه‌دهندهٔ بارگذاری S3: `bucket`، `region`، `endpoint`، `publicUrl`، `prefix`، `pathStyle`، اعتبارنامه‌ها یا `existingSecret`. |
| `schema.path`، `schema.files` | | [طرح‌واره](#طرحواره) را ببینید. |
| `configToml` | | یک `verdin.toml` کامل، mount‌شده در `/app/verdin.toml`. متغیرهای محیطی چارت همچنان اولویت دارند. |
| `metrics.enabled`، `metrics.token` | غیرفعال | متریک‌های Prometheus در `/_metrics`. |
| `plugins.runJobs` | `true` | `[plugins].run_jobs`. |
| `extraEnv`، `extraEnvFrom` | `[]` | متغیرهای بیشتر، مثلاً `VERDIN_TELEMETRY__ENABLED`. |
| `persistence.*` | فعال، 5Gi، ReadWriteOnce | volume مربوط به `/data` (`existingClaim`، `storageClass`، `accessModes`، `size`). |
| `service.*`، `ingress.*` | ClusterIP روی درگاه 80، بدون Ingress | شبکه. |
| `probes.*` | | startup و readiness روی `/_ready`، liveness روی `/_health`. |
| `resources`، `nodeSelector`، `tolerations`، `affinity`، `podAnnotations`، `podLabels` | | زمان‌بندی. |
| `podSecurityContext`، `securityContext` | uid 65532، ریشهٔ فقط‌خواندنی، بدون capability | امنیت. `/tmp` یک `emptyDir` است. |

`values.yaml` در چارت هر کلید را توضیح می‌دهد.
