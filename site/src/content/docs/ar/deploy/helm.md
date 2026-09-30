---
title: مخطط Helm
description: ثبّت Verdin على Kubernetes بمخطط Helm في deploy/helm/verdin — SQLite على وحدة تخزين لـ pod واحد، أو عدة نسخ متماثلة مع قاعدة بيانات خارجية وS3 وناقل الأحداث المشترك.
sidebar:
  order: 7
---

يجمّع المخطط في [`deploy/helm/verdin`](https://github.com/verdin-cms/verdin/tree/main/deploy/helm/verdin)
ملفات manifest الخاصة بـ [Kubernetes](/ar/deploy/kubernetes/): Deployment مع probes، و
Service، وIngress اختياري، وPersistentVolumeClaim لـ `/data`، وSecret بأسرار
الخادم. لم يُنشر بعد في مستودع مخططات؛ ثبّته من نسخة مستنسخة
من المستودع.

فُحص المخطط بـ `helm lint --strict` و`helm template` (Helm 3) في
2026-09-30، ولم يُثبَّت على عنقود فعلي.

## pod واحد مع SQLite

تشغّل القيم الافتراضية نسخة متماثلة واحدة مع SQLite والرفوعات وذاكرة الصور المؤقتة وفهرس البحث
على وحدة تخزين بحجم 5 GiB مركّبة على `/data`:

```sh frame="terminal"
git clone --depth 1 https://github.com/verdin-cms/verdin
helm install cms verdin/deploy/helm/verdin \
  --set publicUrl=https://cms.example.com \
  --set ingress.enabled=true --set ingress.hosts[0].host=cms.example.com \
  --set ingress.hosts[0].paths[0].path=/
```

يستخدم الـ Deployment استراتيجية `Recreate`، فلا يفتح pod‏ان أبدًا ملف قاعدة البيانات نفسه؛
وفي كل ترقية توقف قصير.

## عدة نسخ متماثلة

أكثر من نسخة متماثلة واحدة تحتاج إلى ثلاثة أشياء، ويرفض المخطط التصيير بدونها:

- قاعدة بيانات خارجية (`database.url` أو `database.existingSecret`: PostgreSQL أو MySQL
  أو MariaDB)؛
- `cluster.bus: database`، لكي تصل أحداث الوقت الفعلي والحضور وإبطال ذاكرة التخزين المؤقت وتحديثات البحث
  إلى كل pod (راجع [ناقل الأحداث المشترك](/ar/deploy/scaling/#ناقل-الأحداث-المشترك))؛
- ألا تكون وحدة تخزين ReadWriteOnce على `/data`: وسائط على S3 مع `persistence.enabled: false`
  (فيحتفظ كل pod حينها بذاكرة صوره المؤقتة وفهرس بحثه في `emptyDir`)، أو
  storage class من نوع ReadWriteMany.

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

يشغّل كل pod الأمر `start --migrate`؛ وتمسك الترحيلات قفلًا في قاعدة البيانات، فتعمل
مرة واحدة. لا تعمل الخطوات المحفوفة بالمخاطر أو المُدمِّرة عند البدء أبدًا: طبّقها بـ
`kubectl exec deploy/cms-verdin -- verdin migrate apply --allow …` قبل أن تطرح الإصدار.
تعمل مهام الإضافات المجدولة على كل pod تكون فيه `plugins.runJobs` صحيحة؛ راجع
[تشغيل عدة نسخ](/ar/deploy/scaling/).

## المخطط

لا تعدّل خوادم الإنتاج المخطط، فتحتاج الـ pods إلى مخططك المعتمد:

- **صورتك الخاصة (موصى بها).** `FROM ghcr.io/verdin-cms/verdin:0.11` مع
  `COPY schema /app/schema`، و`schema.path: /app/schema`. تحمل كل صورة حينها
  المخطط الذي رُحِّلت به.
- **`schema.files`.** مسارات نسبية إلى مجلد المخطط مع محتوى JSON الخاص بها، تُصيَّر
  في ConfigMap وتُركَّب على `/etc/verdin/schema`:

  ```yaml
  schema:
    files:
      content-types/article.json: |
        { "kind": "collectionType", "singularName": "article", … }
  ```

  يقرأ `helm upgrade … --set-file 'schema.files.content-types/article\.json=schema/content-types/article.json'`
  ملفًا من القرص.

بدون أي منهما، تقرأ الـ pods المجلد `/data/schema` على وحدة التخزين.

## الأسرار

عندما يكون `secrets.existingSecret` فارغًا، ينشئ المخطط Secret فيه
`VERDIN_ADMIN_JWT_SECRET` و`VERDIN_TOKEN_PEPPER` (عشوائيان عند التثبيت، ويُقرآن من جديد و
يُحتفظ بهما عند الترقيات)، إضافة إلى عنوان قاعدة البيانات وبيانات اعتماد S3 ورمز المقاييس التي تمررها في
القيم. يحمل الـ Secret ووحدة التخزين `helm.sh/resource-policy: keep`: فيتركهما `helm uninstall`،
وبذلك تجد إعادة التثبيت بياناتها وتظل رموز API تعمل. انسخ الـ Secret احتياطيًا
مع قاعدة بياناتك.

لإدارة الأسرار بنفسك (Sealed Secrets وExternal Secrets وVault)، أنشئ Secret
بهذه المفاتيح وعيّن `secrets.existingSecret`.

## القيم

| القيمة | الافتراضي | ماذا |
| --- | --- | --- |
| `image.repository`، `image.tag` | `ghcr.io/verdin-cms/verdin`، و`appVersion` الخاص بالمخطط | الصورة. |
| `replicaCount` | `1` | راجع [عدة نسخ متماثلة](#عدة-نسخ-متماثلة). |
| `args` | `["start", "--migrate"]` | أمر الخادم. |
| `publicUrl` | | `VERDIN_SERVER__PUBLIC_URL`. |
| `trustedProxies` | `[]` | `VERDIN_SERVER__TRUSTED_PROXIES`. |
| `secrets.adminJwtSecret`، `secrets.tokenPepper`، `secrets.existingSecret` | مولَّد | راجع [الأسرار](#الأسرار). |
| `database.url`، `database.existingSecret`، `database.existingSecretKey` | SQLite على `/data` | قاعدة البيانات. |
| `cluster.bus`، `cluster.pollIntervalMs` | `none`، `1000` | `[cluster]`. اسم كل pod هو `instance_id` الخاص به. |
| `s3.*` | معطّل | موفّر الرفع S3: `bucket` و`region` و`endpoint` و`publicUrl` و`prefix` و`pathStyle` وبيانات الاعتماد أو `existingSecret`. |
| `schema.path`، `schema.files` | | راجع [المخطط](#المخطط). |
| `configToml` | | ملف `verdin.toml` كاملًا، يُركَّب على `/app/verdin.toml`. وتظل متغيرات البيئة في المخطط هي الأغلب. |
| `metrics.enabled`، `metrics.token` | معطّل | مقاييس Prometheus على `/_metrics`. |
| `plugins.runJobs` | `true` | `[plugins].run_jobs`. |
| `extraEnv`، `extraEnvFrom` | `[]` | متغيرات إضافية، مثل `VERDIN_TELEMETRY__ENABLED`. |
| `persistence.*` | مفعّل، 5Gi، ReadWriteOnce | وحدة التخزين `/data` (`existingClaim` و`storageClass` و`accessModes` و`size`). |
| `service.*`، `ingress.*` | ClusterIP على المنفذ 80، بلا Ingress | الشبكة. |
| `probes.*` | | بدء وجاهزية على `/_ready`، وحياة على `/_health`. |
| `resources`، `nodeSelector`، `tolerations`، `affinity`، `podAnnotations`، `podLabels` | | الجدولة. |
| `podSecurityContext`، `securityContext` | uid 65532، جذر للقراءة فقط، بلا قدرات | الأمان. `/tmp` هو `emptyDir`. |

يوثّق `values.yaml` في المخطط كل مفتاح.
