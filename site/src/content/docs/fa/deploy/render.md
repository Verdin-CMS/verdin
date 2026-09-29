---
title: Render
description: Verdin را با یک Blueprint روی Render مستقر کنید — یک وب‌سرویس Docker ساخته‌شده از مخزن شما، یک پایگاه دادهٔ PostgreSQL در Render، و رسانه روی ذخیره‌سازی سازگار با S3 یا یک دیسک.
sidebar:
  order: 5
---

این صفحه یک پروژهٔ Verdin را با یک Blueprint
(`render.yaml`) روی [Render](https://render.com) مستقر می‌کند: یک وب‌سرویس ساخته‌شده از یک Dockerfile کوچک در مخزن شما، و یک
پایگاه دادهٔ PostgreSQL در Render. سیستم فایل Render ناپایدار است، پس رسانه به
ذخیره‌سازی سازگار با S3 می‌رود، یا اگر یک نمونه اجرا می‌کنید، به یک دیسک پایدار.

:::note
قالب Blueprint در تاریخ 2026-09-29 با [مرجع Blueprint در Render](https://render.com/docs/blueprint-spec)
مقایسه شد؛ روی یک حساب واقعی Render مستقر نشده است. مقادیری که با `# yours` مشخص شده‌اند را
خودتان پر کنید.
:::

پیش‌نیازها: پروژهٔ Verdin شما (همراه با `schema/`) در یک مخزن Git که Render بتواند آن را بخواند.

## 1. افزودن یک Dockerfile و یک پیکربندی

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

`.env` را بیرون از مخزن و بیرون از ایمیج (`.dockerignore`) نگه دارید.

## 2. نوشتن `render.yaml`

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

برای انتخاب نوع نمونه، یک `plan` به سرویس و پایگاه داده اضافه کنید (صفحهٔ
قیمت‌گذاری Render را ببینید)؛ بدون آن، Render از مقدار پیش‌فرض خود استفاده می‌کند.

`generateValue: true` هر کلید محرمانه را یک بار، هنگام نخستین اعمال Blueprint، می‌سازد و
پس از آن نگه می‌دارد. آن‌ها را دوباره نسازید: یک `VERDIN_TOKEN_PEPPER` جدید باعث می‌شود همهٔ توکن‌های
API از کار بیفتند.

## 3. استقرار

1. در داشبورد Render، از مخزن یک **Blueprint** بسازید و مقادیر
   متغیرهای `sync: false` را وارد کنید.
2. منتظر نخستین استقرار بمانید. فرمان پیش‌فرض ایمیج، `start --migrate`، در نخستین اجرا
   جدول‌ها را می‌سازد و در استقرارهای بعدی مهاجرت‌های امن را اعمال می‌کند.
3. `https://<service>.onrender.com/admin/` را باز کنید و نخستین مدیر را ثبت کنید.

Render پیش از متوقف کردن یک نمونه `SIGTERM` می‌فرستد؛ Verdin با دریافت آن کار را تمام می‌کند و خارج می‌شود.

## گونهٔ دیگر: رسانه روی دیسک

برای یک نمونهٔ واحد می‌توانید بارگذاری‌ها را به‌جای S3 روی یک دیسک پایدار Render ذخیره کنید.
ارائه‌دهندهٔ محلی را در `verdin.toml` تنظیم کنید:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

و یک دیسک به سرویس اضافه کنید:

```yaml title="render.yaml"
    disk:
      name: verdin-data
      mountPath: /data
      sizeGB: 5
```

با یک دیسک، Render اجازه نمی‌دهد سرویس را به چند نمونه مقیاس دهید، و
استقرارها نمونهٔ قدیمی را پیش از شروع نمونهٔ جدید متوقف می‌کنند، پس هر استقرار یک قطعی
کوتاه دارد. همین دیسک می‌تواند یک پایگاه دادهٔ SQLite (`sqlite:///data/verdin.db`) را هم نگه دارد اگر
پایگاه دادهٔ Render نمی‌خواهید. بررسی کنید که کاربر ایمیج (uid `65532`) بتواند در
دیسک بنویسد؛ اگر شروع با خطای دسترسی روی `/data` شکست خورد، `USER root` را به
`Dockerfile` خود اضافه کنید.

## نشانی کلاینت‌ها

proxy در Render جلوی سرویس قرار دارد. بازهٔ نشانی آن برای
این راهنما تأیید نشده است، پس `[server].trusted_proxies` خالی می‌ماند: در این حالت همهٔ بازدیدکنندگان برای محدودیت نرخ
یک نشانی واحد به حساب می‌آیند، پس `[api].public_rate_limit` را روی `0` نگه دارید مگر اینکه
بازهٔ proxy را پیدا کنید و به آن اعتماد کنید.
