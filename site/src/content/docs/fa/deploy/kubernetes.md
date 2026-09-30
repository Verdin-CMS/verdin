---
title: Kubernetes
description: Verdin را روی Kubernetes اجرا کنید — یک Deployment با probeها، یک Secret و یک Service برای PostgreSQL و S3، و یک راه‌اندازی تک‌رپلیکا با PersistentVolumeClaim برای SQLite.
sidebar:
  order: 7
---

این صفحه یک پروژهٔ Verdin را روی Kubernetes اجرا می‌کند. راه‌اندازی اصلی بدون وضعیت است: PostgreSQL
(یا MySQL/MariaDB) بیرون از podها، رسانه روی ذخیره‌سازی سازگار با S3، و هر تعداد
رپلیکا که لازم دارید. در ادامه یک راه‌اندازی تک‌رپلیکا با یک volume برای SQLite آمده است. [چارت Helm](/fa/deploy/helm/)
این manifestها را با مقدارهایی برای هر تنظیم بسته‌بندی می‌کند.

manifestها از APIهای پایدار (`apps/v1`، `v1`) استفاده می‌کنند و در تاریخ 2026-09-29 با
`kubeconform -strict` در برابر طرح‌واره‌های Kubernetes اعتبارسنجی شدند، اما روی یک کلاستر واقعی اجرا نشده‌اند. هر مقدار درون
براکت‌های زاویه‌ای را جایگزین کنید.

## 1. ساخت ایمیج

پیکربندی و طرح‌وارهٔ خود را در ایمیجی بر پایهٔ ایمیج رسمی قرار دهید، تا
هر نسخه همان طرح‌واره‌ای را منتشر کند که با آن مهاجرت داده شده است (بخش
[ایمیج خودتان](/fa/deploy/docker/) را ببینید):

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

آن را با نام `<registry>/verdin-site:<version>` به registry خود push کنید.

## 2. Secretها

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

یا آن را از خروجی `verdin secrets` با
`kubectl create secret generic verdin --from-env-file=…` بسازید و بقیه را اضافه کنید.

## 3. Deployment و Service

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

Service را مانند هر سرویس HTTP دیگری از طریق Ingress یا Gateway خود با TLS در دسترس قرار دهید.
اعداد منابع یک نقطهٔ شروع هستند، نه نتیجهٔ اندازه‌گیری.

نکته‌هایی دربارهٔ manifest:

- **مهاجرت‌ها.** هر رپلیکا `start --migrate` را اجرا می‌کند. مهاجرت‌ها یک قفل در
  پایگاه داده می‌گیرند (یک advisory lock در PostgreSQL، `GET_LOCK` در MySQL/MariaDB)، بنابراین رپلیکاهایی
  که با هم شروع می‌شوند آن‌ها را یک بار اعمال می‌کنند. گام‌های پرخطر یا مخرب هرگز هنگام شروع
  اعمال نمی‌شوند: پیش از rollout، `verdin migrate apply --allow …` را به‌صورت یک Job یک‌باره با همان ایمیج
  اجرا کنید.
- **سیستم فایل ریشهٔ فقط‌خواندنی.** بارگذاری‌ها به‌صورت جریانی از `/tmp` عبور می‌کنند، پس به یک
  `emptyDir` قابل نوشتن نیاز دارد. اگر از کش تبدیل تصویر و نمایهٔ جستجو استفاده کنید، آن‌ها هم
  به پوشه‌های قابل نوشتن نیاز دارند (`/tmp/transforms` در بالا؛
  `VERDIN_SEARCH__DIR` را هم تنظیم کنید).
- **خاموش شدن.** Verdin با `SIGTERM` متوقف می‌شود.
- **کارهای افزونه‌ها.** کارهای زمان‌بندی‌شدهٔ افزونه‌ها روی هر رپلیکایی اجرا می‌شوند که در آن
  `[plugins].run_jobs` برابر true باشد. یک Deployment اضافی با `replicas: 1` و
  `VERDIN_PLUGINS__RUN_JOBS=true` اجرا کنید (با همان labelها، تا ترافیک هم سرویس دهد)، یا بپذیرید
  که کارها روی هر رپلیکا اجرا شوند. وب‌هوک‌ها، بسته‌های انتشار زمان‌بندی‌شده و خلاصهٔ روزانه
  در پایگاه داده رزرو می‌شوند و یک بار اجرا می‌شوند. [اجرای چند نمونه](/fa/deploy/scaling/) را ببینید.
- **بلادرنگ، حضور، کش‌ها و جستجو.** `[cluster].bus = "database"` رویدادهای بقیه را به هر pod
  می‌رساند (بخش [گذرگاه رویداد مشترک](/fa/deploy/scaling/#گذرگاه-رویداد-مشترک) را ببینید).
  بدون آن، جریان‌های رویداد (`/api/_events`) روی podی که به آن متصل می‌شوند می‌مانند: اگر از
  [بلادرنگ](/fa/guides/frontend/realtime/) استفاده می‌کنید، session affinity را روی Ingress فعال کنید.

## تک‌رپلیکا با SQLite

SQLite و بارگذاری‌های محلی به یک pod و یک volume پایدار نیاز دارند:

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

در اینجا `verdin.toml` از `provider = { name = "local", dir = "/data/uploads" }` استفاده می‌کند، و
`VERDIN_DATABASE_URL` درون Secret لازم نیست (مدخل `env` بر
`envFrom` اولویت دارد). یک `StatefulSet` با یک رپلیکا و یک مدخل `volumeClaimTemplates` هم
به همین شکل کار می‌کند. `Recreate` یعنی در هر rollout یک قطعی کوتاه رخ می‌دهد.

## فرمان‌های مدیریتی

فرمان‌های CLI را در یک pod در حال اجرا اجرا کنید؛ ایمیج shell ندارد، پس فایل باینری را فراخوانی کنید:

```sh frame="terminal"
kubectl exec -it deploy/verdin -- verdin admin create --email you@example.com
kubectl exec deploy/verdin -- verdin migrate plan
```
