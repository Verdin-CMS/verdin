---
title: Kubernetes
description: شغّل Verdin على Kubernetes — Deployment مع probes، وSecret وService لـ PostgreSQL وS3، وإعداد بنسخة متماثلة واحدة مع PersistentVolumeClaim لـ SQLite.
sidebar:
  order: 7
---

تشغّل هذه الصفحة مشروع Verdin على Kubernetes. الإعداد الرئيسي عديم الحالة (stateless): PostgreSQL
(أو MySQL/MariaDB) خارج الـ pods، والوسائط على تخزين متوافق مع S3، وعدد
النسخ المتماثلة (replicas) الذي تحتاجه. ويلي ذلك إعداد بنسخة متماثلة واحدة مع وحدة تخزين لـ SQLite.

تستخدم ملفات manifest واجهات API مستقرة (`apps/v1`، `v1`) وقد تُحقق منها مقابل
مخططات Kubernetes بـ `kubeconform -strict` في 2026-09-29، ولم تُشغَّل على عنقود فعلي. استبدل كل قيمة
بين أقواس الزاوية.

## 1. ابنِ صورتك

ضمّن تهيئتك ومخططك في صورة مبنية على الصورة الرسمية، حتى
يشحن كل إصدار المخطط الذي رُحِّل به (راجع
[صورتك الخاصة](/ar/deploy/docker/)):

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

ادفعها إلى السجل (registry) الخاص بك باسم `<registry>/verdin-site:<version>`.

## 2. الأسرار

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

أو أنشئه من مخرجات `verdin secrets` باستخدام
`kubectl create secret generic verdin --from-env-file=…`، ثم أضف البقية.

## 3. Deployment وService

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

اكشف الـ Service عبر Ingress أو Gateway مع TLS، كما تفعل مع أي خدمة HTTP.
أرقام الموارد نقطة بداية، لا قياس.

ملاحظات على ملف manifest:

- **الترحيلات.** تشغّل كل نسخة متماثلة `start --migrate`. تأخذ الترحيلات قفلًا في
  قاعدة البيانات (قفل استشاري على PostgreSQL، و`GET_LOCK` على MySQL/MariaDB)، لذا فإن النسخ
  التي تبدأ معًا تطبّقها مرة واحدة. لا تُطبَّق الخطوات المحفوفة بالمخاطر أو المُدمِّرة أبدًا عند
  البدء: شغّل `verdin migrate apply --allow …` كـ Job لمرة واحدة بالصورة نفسها
  قبل طرح الإصدار.
- **نظام ملفات جذر للقراءة فقط.** تُبَث الملفات المرفوعة عبر `/tmp`، لذا يحتاج إلى
  `emptyDir` قابل للكتابة. تحتاج ذاكرة التخزين المؤقت لتحويلات الصور وفهرس البحث أيضًا إلى
  مجلدات قابلة للكتابة إن كنت تستخدمهما (`/tmp/transforms` أعلاه؛ وعيّن
  `VERDIN_SEARCH__DIR` أيضًا).
- **الإيقاف.** يتوقف Verdin عند `SIGTERM`.
- **مهام الإضافات.** تعمل مهام الإضافات المجدولة على كل نسخة متماثلة تكون فيها
  `[plugins].run_jobs` صحيحة. شغّل Deployment إضافيًا بـ `replicas: 1` و
  `VERDIN_PLUGINS__RUN_JOBS=true` (بالتسميات نفسها، فيقدّم الحركة أيضًا)، أو اقبل
  أن تعمل المهام على كل نسخة. أما الـ webhooks وحزم النشر المجدولة والملخص اليومي
  فتُحجز في قاعدة البيانات وتُنفَّذ مرة واحدة. راجع [تشغيل عدة نسخ](/ar/deploy/scaling/).
- **الوقت الفعلي.** تبقى تدفقات الأحداث (`/api/_events`) على الـ pod الذي تتصل به. استخدم
  تقارب الجلسة (session affinity) على الـ Ingress إن كنت تستخدم [الوقت الفعلي](/ar/guides/frontend/realtime/).

## نسخة متماثلة واحدة مع SQLite

يحتاج SQLite والملفات المرفوعة محليًا إلى pod واحد ووحدة تخزين دائمة:

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

هنا يستخدم `verdin.toml` القيمة `provider = { name = "local", dir = "/data/uploads" }`، ولا حاجة إلى
`VERDIN_DATABASE_URL` في الـ Secret (مدخل `env` يتغلب على
`envFrom`). ويعمل `StatefulSet` بنسخة متماثلة واحدة ومدخل `volumeClaimTemplates`
بالطريقة نفسها. يعني `Recreate` توقفًا قصيرًا مع كل طرح.

## أوامر الإدارة

شغّل أوامر CLI في pod قيد التشغيل؛ لا تحتوي الصورة على shell، لذا استدعِ الملف التنفيذي:

```sh frame="terminal"
kubectl exec -it deploy/verdin -- verdin admin create --email you@example.com
kubectl exec deploy/verdin -- verdin migrate plan
```
