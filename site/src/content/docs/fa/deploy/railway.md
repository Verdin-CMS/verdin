---
title: Railway
description: Verdin را از Dockerfile مخزن خود روی Railway مستقر کنید، با PostgreSQL در Railway و رسانه روی ذخیره‌سازی سازگار با S3 یا یک volume.
sidebar:
  order: 6
---

این صفحه یک پروژهٔ Verdin را روی [Railway](https://railway.com) مستقر می‌کند: سرویسی که
از یک Dockerfile کوچک در مخزن شما ساخته می‌شود، یک پایگاه دادهٔ PostgreSQL در Railway، و رسانه روی
ذخیره‌سازی سازگار با S3 (یا یک volume برای یک نمونهٔ واحد).

:::note
تنظیمات Railway در تاریخ 2026-09-29 با [مستندات Railway](https://docs.railway.com/reference/config-as-code)
مقایسه شدند؛ این راه‌اندازی روی یک حساب واقعی Railway مستقر نشده است. مقادیری که با
`# yours` مشخص شده‌اند یا درون براکت‌های زاویه‌ای هستند را خودتان پر کنید.
:::

## 1. افزودن یک Dockerfile، یک پیکربندی و `railway.json`

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

به فرمان شروع نیازی نیست: ایمیج `start --migrate` را اجرا می‌کند که پیش از سرویس‌دهی،
مهاجرت‌های امن را اعمال می‌کند. `.env` را بیرون از مخزن نگه دارید.

## 2. ساخت پروژه

1. در Railway، یک پروژه از مخزن GitHub خود بسازید. Railway فایل
   `railway.json` را پیدا می‌کند و Dockerfile را می‌سازد.
2. یک پایگاه دادهٔ **PostgreSQL** به پروژه اضافه کنید.
3. در **Variables** سرویس Verdin، این موارد را اضافه کنید:

   | متغیر | مقدار |
   | --- | --- |
   | `VERDIN_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (URL خصوصی سرویس پایگاه داده؛ از نام سرویس پایگاه دادهٔ خود استفاده کنید) |
   | `VERDIN_ADMIN_JWT_SECRET` | از `verdin secrets` |
   | `VERDIN_TOKEN_PEPPER` | از `verdin secrets` |
   | `VERDIN_SERVER__PUBLIC_URL` | `https://<your-domain>` |
   | `AWS_ACCESS_KEY_ID`، `AWS_SECRET_ACCESS_KEY` | اطلاعات اعتبار S3 شما |

   دو کلید محرمانه را به‌صورت محلی بسازید:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets
   ```

4. در تنظیمات شبکهٔ سرویس، روی **Generate Domain** کلیک کنید و پورت مقصد آن را
   روی `1337` بگذارید. Verdin روی `[server].port` گوش می‌دهد و متغیر `PORT` در Railway را
   نمی‌خواند.
5. مستقر کنید، `https://<your-domain>/admin/` را باز کنید و نخستین مدیر را ثبت کنید.

## گونهٔ دیگر: رسانه یا SQLite روی یک volume

برای یک نمونهٔ واحد می‌توانید بارگذاری‌ها، و حتی پایگاه داده، را روی یک volume در Railway
که در `/data` mount شده نگه دارید:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

همراه با `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` اگر از PostgreSQL صرف‌نظر می‌کنید. به یاد داشته باشید:

- سرویسی که volume دارد نمی‌تواند رپلیکا داشته باشد، و هر استقرار دوباره یک قطعی کوتاه دارد.
- Railway volumeها را با مالکیت root mount می‌کند و ایمیج با uid `65532` اجرا می‌شود. متغیر
  سرویس `RAILWAY_RUN_UID=0` را تنظیم کنید تا سرور بتواند در volume بنویسد.

## نشانی کلاینت‌ها

proxy لبهٔ Railway جلوی سرویس قرار دارد. بازهٔ نشانی آن برای این راهنما تأیید نشده است،
پس `[server].trusted_proxies` خالی می‌ماند: در این حالت همهٔ بازدیدکنندگان برای محدودیت نرخ
یک نشانی واحد به حساب می‌آیند، پس `[api].public_rate_limit` را روی `0` نگه دارید مگر اینکه
بازهٔ proxy را پیدا کنید و به آن اعتماد کنید.
