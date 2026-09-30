---
title: Docker Compose في الإنتاج
description: وصفة Compose للإنتاج لخادم واحد — Verdin وPostgreSQL وCaddy مع HTTPS تلقائي، وRustFS اختياري لوسائط متوافقة مع S3.
sidebar:
  order: 3
---

[`deploy/compose/`](https://github.com/verdin-cms/verdin/tree/main/deploy/compose) إعداد
جاهز لخادم واحد: Verdin وPostgreSQL على شبكة خاصة، وأمامهما Caddy
بشهادة يحصل عليها ويجدّدها بنفسه. ويضيف ملف override خدمة RustFS،
وهي مخزن متوافق مع S3 على المضيف نفسه، للوسائط. يشرح [Docker](/ar/deploy/docker/)
الصورة التي تستخدمها هذه الملفات.

فُحصت الملفات بـ `docker compose config` و`caddy validate` في 2026-09-30.

## الملفات

| الملف | ماذا |
| --- | --- |
| `compose.yaml` | `verdin` و`db` (PostgreSQL 17) و`caddy`. لا ينشر منافذ إلا Caddy (80 و443 و443/udp لـ HTTP/3). |
| `compose.s3.yaml` | يضيف `rustfs` ومهمة لمرة واحدة تنشئ الحاوية `media` للقراءة العامة، ويحوّل موفّر الرفع في Verdin إليها. |
| `Caddyfile` | TLS لـ `$VERDIN_DOMAIN`، والضغط، و`/media/*` إلى RustFS وكل ما عداه إلى Verdin. |
| `.env.example` | المتغيرات التي يقرؤها Compose: النطاق، وبريد ACME، ووسم الصورة، وكلمات المرور. |

## أعدّه

المتطلبات: خادم عليه Docker، وسجل DNS لنطاقك يشير إليه، ومنفذا
80 و443 مفتوحان.

1. انسخ المجلد إلى الخادم واملأ `.env`:

   ```sh frame="terminal"
   cp .env.example .env                                  # VERDIN_DOMAIN, ACME_EMAIL
   echo "DB_PASSWORD=$(openssl rand -hex 24)" >> .env
   docker run --rm ghcr.io/verdin-cms/verdin:0.11 secrets > verdin.env
   ```

2. ضع مخططك المعتمد في `schema/` (`content-types/` و`components/`). يُركَّب
   للقراءة فقط على `/app/schema`.
3. شغّله:

   ```sh frame="terminal"
   docker compose up -d
   docker compose logs -f verdin
   ```

4. افتح `https://<your domain>/admin/` وسجّل المسؤول الأول.

أبقِ `.env` و`verdin.env` خارج إدارة الإصدارات، وانسخهما احتياطيًا: فـ
`VERDIN_TOKEN_PEPPER` جديد يبطل كل رمز API.

## الوسائط على S3

افتراضيًا تذهب الرفوعات إلى وحدة التخزين `verdin-data`. لتخزينها في RustFS بدلًا من ذلك:

```sh frame="terminal"
echo "S3_SECRET_KEY=$(openssl rand -hex 24)" >> .env
docker compose -f compose.yaml -f compose.s3.yaml up -d
```

تُقدَّم الملفات حينها عبر Caddy على `https://<your domain>/media/<key>`. أما مع AWS S3
أو Cloudflare R2 أو موفّر آخر، فاترك خدمات RustFS وعيّن متغيرات
`VERDIN_UPLOAD__PROVIDER__*` وبيانات اعتماد `AWS_*` بقيم ذلك الموفّر
(راجع [التخزين](/ar/internals/storage/)). تحويل موقع قائم لا ينقل أي ملف:
الرفوعات الجديدة تذهب إلى الموفّر الجديد.

## ملاحظات

- **عناوين العملاء.** يثق Verdin بـ `X-Forwarded-For` من شبكة Compose
  (`172.30.0.0/24`، ثابتة في `compose.yaml`)، حيث Caddy هو الوكيل الوحيد. غيّر الاثنين
  إن تعارض هذا النطاق مع إحدى شبكاتك.
- **الوقت الفعلي.** يبث Caddy استجابات `text/event-stream` دون تخزين مؤقت، فتعمل
  [أحداث الوقت الفعلي](/ar/guides/frontend/realtime/) خلفه دون تغيير.
- **الترقيات.** غيّر `VERDIN_VERSION` في `.env`، ثم `docker compose pull && docker compose up -d`.
  اقرأ [ترقية Verdin](/ar/migrate/upgrading/) أولًا.
- **النسخ الاحتياطية.** أفرغ PostgreSQL واحتفظ بوحدة التخزين `verdin-data` (أو الحاوية)؛ راجع
  [النسخ الاحتياطية](/ar/deploy/backups/).
- **أوامر الإدارة.** لا تحتوي الصورة على shell: `docker compose exec verdin verdin admin create --email you@example.com`.
