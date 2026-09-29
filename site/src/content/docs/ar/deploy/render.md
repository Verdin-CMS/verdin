---
title: Render
description: انشر Verdin على Render باستخدام Blueprint — خدمة ويب Docker مبنية من مستودعك، وقاعدة بيانات PostgreSQL من Render، والوسائط على تخزين متوافق مع S3 أو على قرص.
sidebar:
  order: 5
---

تنشر هذه الصفحة مشروع Verdin على [Render](https://render.com) باستخدام Blueprint
(`render.yaml`): خدمة ويب مبنية من Dockerfile صغير في مستودعك، وقاعدة بيانات
PostgreSQL من Render. نظام الملفات في Render مؤقت، لذا تذهب الوسائط إلى
تخزين متوافق مع S3، أو إلى قرص دائم إن كنت تشغّل نسخة واحدة.

:::note
رُوجعت صيغة Blueprint مقابل [مرجع Blueprint في Render](https://render.com/docs/blueprint-spec)
في 2026-09-29؛ ولم تُنشر على حساب Render فعلي. القيم المعلَّمة بـ `# yours`
عليك أنت ملؤها.
:::

المتطلبات: مشروع Verdin الخاص بك (مع `schema/`) في مستودع Git يستطيع Render قراءته.

## 1. أضف Dockerfile وتهيئة

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337

[schema]
path = "schema"

[log]
format = "json"

[upload]
# Cloudflare R2 as an example; any S3-compatible service works.
provider = { name = "s3", bucket = "media", region = "auto",             # yours
             endpoint = "https://<account>.r2.cloudflarestorage.com",    # yours
             public_url = "https://media.example.com" }                  # yours
```

أبقِ `.env` خارج المستودع وخارج الصورة (`.dockerignore`).

## 2. اكتب `render.yaml`

```yaml title="render.yaml"
services:
  - type: web
    name: verdin
    runtime: docker
    repo: https://github.com/<you>/<your-project>   # yours
    branch: main
    dockerfilePath: ./Dockerfile
    region: frankfurt                               # yours
    healthCheckPath: /_ready
    envVars:
      - key: VERDIN_DATABASE_URL
        fromDatabase:
          name: verdin-db
          property: connectionString
      - key: VERDIN_ADMIN_JWT_SECRET
        generateValue: true
      - key: VERDIN_TOKEN_PEPPER
        generateValue: true
      - key: VERDIN_SERVER__PUBLIC_URL
        value: https://verdin.onrender.com          # yours: the service URL or your domain
      - key: AWS_ACCESS_KEY_ID
        sync: false                                 # asked for when you create the Blueprint
      - key: AWS_SECRET_ACCESS_KEY
        sync: false

databases:
  - name: verdin-db
    databaseName: verdin
    user: verdin
    region: frankfurt                               # yours: the same region
    postgresMajorVersion: "17"
```

أضف `plan` إلى الخدمة وقاعدة البيانات لاختيار نوع النسخة (راجع صفحة الأسعار
في Render)؛ وبدونه، يستخدم Render الخيار الافتراضي.

ينشئ `generateValue: true` كل سرّ مرة واحدة، عند تطبيق الـ Blueprint لأول مرة، و
يحتفظ به بعد ذلك. لا تعِد توليدها: قيمة `VERDIN_TOKEN_PEPPER` جديدة تجعل كل رمز API
يتوقف عن العمل.

## 3. انشر

1. في لوحة تحكم Render، أنشئ **Blueprint** من المستودع وأدخل
   قيم متغيرات `sync: false`.
2. انتظر النشر الأول. ينشئ الأمر الافتراضي للصورة، `start --migrate`،
   الجداول عند التشغيل الأول ويطبّق الترحيلات الآمنة في عمليات النشر اللاحقة.
3. افتح `https://<service>.onrender.com/admin/` وسجّل المسؤول الأول.

يرسل Render إشارة `SIGTERM` قبل أن يوقف نسخة؛ فينهي Verdin عمله ويخرج عند استلامها.

## بديل: الوسائط على قرص

لنسخة واحدة يمكنك تخزين الملفات المرفوعة على قرص Render دائم بدلًا من S3.
عيّن الموفّر المحلي في `verdin.toml`:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

وأضف قرصًا إلى الخدمة:

```yaml title="render.yaml"
    disk:
      name: verdin-data
      mountPath: /data
      sizeGB: 5
```

مع قرص، لا يسمح لك Render بتوسيع الخدمة إلى عدة نسخ، و
توقف عمليات النشر النسخة القديمة قبل بدء الجديدة، فيكون لكل نشر توقف
قصير. يمكن للقرص نفسه أن يحمل قاعدة بيانات SQLite (`sqlite:///data/verdin.db`) إن كنت
لا تريد قاعدة بيانات من Render. تحقق من أن مستخدم الصورة (uid `65532`) يستطيع الكتابة على
القرص؛ وإذا فشل البدء بخطأ صلاحيات على `/data`، أضف `USER root` إلى
`Dockerfile` الخاص بك.

## عناوين العملاء

يقف وكيل Render أمام الخدمة. لم يُتحقق من نطاق عناوينه لـ
هذا الدليل، لذا يُترك `[server].trusted_proxies` فارغًا: عندئذ يُحسب كل زائر
على أنه العنوان نفسه في حدود المعدل، فأبقِ `[api].public_rate_limit` على `0` ما لم
تعثر على نطاق الوكيل وتثق به.
