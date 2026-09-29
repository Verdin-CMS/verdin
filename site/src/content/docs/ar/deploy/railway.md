---
title: Railway
description: انشر Verdin على Railway من ملف Dockerfile في مستودعك، مع PostgreSQL من Railway والوسائط على تخزين متوافق مع S3 أو على وحدة تخزين.
sidebar:
  order: 6
---

تنشر هذه الصفحة مشروع Verdin على [Railway](https://railway.com): خدمة مبنية
من Dockerfile صغير في مستودعك، وقاعدة بيانات PostgreSQL من Railway، والوسائط على
تخزين متوافق مع S3 (أو وحدة تخزين لنسخة واحدة).

:::note
رُوجعت إعدادات Railway مقابل [توثيق Railway](https://docs.railway.com/reference/config-as-code)
في 2026-09-29؛ ولم يُنشر الإعداد على حساب Railway فعلي. القيم المعلَّمة
بـ `# yours` أو بين أقواس الزاوية عليك أنت ملؤها.
:::

## 1. أضف Dockerfile وتهيئة و`railway.json`

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
provider = { name = "s3", bucket = "media", region = "auto",             # yours
             endpoint = "https://<account>.r2.cloudflarestorage.com",    # yours
             public_url = "https://media.example.com" }                  # yours
```

```json title="railway.json"
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "healthcheckPath": "/_ready",
    "healthcheckTimeout": 120,
    "restartPolicyType": "ON_FAILURE"
  }
}
```

لا حاجة إلى أمر بدء: تشغّل الصورة `start --migrate`، الذي يطبّق الترحيلات
الآمنة قبل أن يبدأ التقديم. أبقِ `.env` خارج المستودع.

## 2. أنشئ المشروع

1. في Railway، أنشئ مشروعًا من مستودع GitHub الخاص بك. يعثر Railway على
   `railway.json` ويبني الـ Dockerfile.
2. أضف قاعدة بيانات **PostgreSQL** إلى المشروع.
3. في **Variables** الخاصة بخدمة Verdin، أضف:

   | المتغير | القيمة |
   | --- | --- |
   | `VERDIN_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (عنوان URL الخاص لخدمة قاعدة البيانات؛ استخدم اسم خدمة قاعدة بياناتك) |
   | `VERDIN_ADMIN_JWT_SECRET` | من `verdin secrets` |
   | `VERDIN_TOKEN_PEPPER` | من `verdin secrets` |
   | `VERDIN_SERVER__PUBLIC_URL` | `https://<your-domain>` |
   | `AWS_ACCESS_KEY_ID`، `AWS_SECRET_ACCESS_KEY` | بيانات اعتماد S3 الخاصة بك |

   ولّد السرّين محليًا:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets
   ```

4. في إعدادات الشبكة للخدمة، انقر **Generate Domain** وعيّن المنفذ
   الهدف إلى `1337`. يستمع Verdin على `[server].port` ولا يقرأ متغير `PORT`
   الخاص بـ Railway.
5. انشر، ثم افتح `https://<your-domain>/admin/` وسجّل المسؤول الأول.

## بديل: الوسائط أو SQLite على وحدة تخزين

لنسخة واحدة يمكنك إبقاء الملفات المرفوعة، وحتى قاعدة البيانات، على وحدة تخزين Railway
مركّبة على `/data`:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

مع `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` إن تخطّيت PostgreSQL. ضع في اعتبارك:

- لا يمكن أن يكون لخدمة ذات وحدة تخزين نسخ متماثلة، ولكل إعادة نشر توقف قصير.
- يركّب Railway وحدات تخزين مملوكة لـ root، بينما تعمل الصورة بـ uid `65532`. عيّن
  متغير الخدمة `RAILWAY_RUN_UID=0` ليتمكن الخادم من الكتابة في وحدة التخزين.

## عناوين العملاء

يقف وكيل الحافة في Railway أمام الخدمة. لم يُتحقق من نطاق عناوينه
لهذا الدليل، لذا يبقى `[server].trusted_proxies` فارغًا: عندئذ يُحسب كل زائر
على أنه العنوان نفسه في حدود المعدل، فأبقِ `[api].public_rate_limit` على `0` ما لم
تعثر على نطاق الوكيل وتثق به.
