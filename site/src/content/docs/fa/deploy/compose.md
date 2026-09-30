---
title: Docker Compose در محیط تولید
description: یک دستورالعمل Compose برای تولید روی یک سرور — Verdin، PostgreSQL و Caddy با HTTPS خودکار، و RustFS اختیاری برای رسانهٔ سازگار با S3.
sidebar:
  order: 3
---

[`deploy/compose/`](https://github.com/verdin-cms/verdin/tree/main/deploy/compose) یک راه‌اندازی آماده
برای یک سرور است: Verdin و PostgreSQL روی یک شبکهٔ خصوصی، و Caddy جلوی آن‌ها با گواهی‌ای که خودش می‌گیرد و
تمدید می‌کند. یک فایل override، RustFS را اضافه می‌کند، یک ذخیره‌گاه سازگار با S3 روی همان میزبان، برای
رسانه. [Docker](/fa/deploy/docker/) ایمیجی را که این فایل‌ها استفاده می‌کنند توضیح می‌دهد.

این فایل‌ها در تاریخ 2026-09-30 با `docker compose config` و `caddy validate` بررسی شدند.

## فایل‌ها

| فایل | چه |
| --- | --- |
| `compose.yaml` | `verdin`، `db` (PostgreSQL 17) و `caddy`. فقط Caddy درگاه منتشر می‌کند (80، 443 و 443/udp برای HTTP/3). |
| `compose.s3.yaml` | `rustfs` و یک کار یک‌باره را اضافه می‌کند که باکت `media` با خواندن عمومی را می‌سازد، و ارائه‌دهندهٔ بارگذاری Verdin را به آن تغییر می‌دهد. |
| `Caddyfile` | TLS برای `$VERDIN_DOMAIN`، فشرده‌سازی، `/media/*` به RustFS و هر چیز دیگر به Verdin. |
| `.env.example` | متغیرهایی که Compose می‌خواند: دامنه، ایمیل ACME، تگ ایمیج، گذرواژه‌ها. |

## راه‌اندازی

پیش‌نیازها: یک سرور با Docker، یک رکورد DNS برای دامنهٔ شما که به آن اشاره کند، و
درگاه‌های 80 و 443 باز.

1. پوشه را روی سرور کپی کنید و `.env` را پر کنید:

   ```sh frame="terminal"
   cp .env.example .env                                  # VERDIN_DOMAIN, ACME_EMAIL
   echo "DB_PASSWORD=$(openssl rand -hex 24)" >> .env
   docker run --rm ghcr.io/verdin-cms/verdin:0.11 secrets > verdin.env
   ```

2. طرح‌وارهٔ commit‌شدهٔ خود را در `schema/` بگذارید (`content-types/` و `components/`). به‌صورت
   فقط‌خواندنی در `/app/schema` mount می‌شود.
3. آن را راه بیندازید:

   ```sh frame="terminal"
   docker compose up -d
   docker compose logs -f verdin
   ```

4. `https://<your domain>/admin/` را باز کنید و نخستین مدیر را ثبت کنید.

`.env` و `verdin.env` را از کنترل نسخه دور نگه دارید و از آن‌ها نسخهٔ پشتیبان بگیرید: یک
`VERDIN_TOKEN_PEPPER` جدید همهٔ توکن‌های API را باطل می‌کند.

## رسانه روی S3

به‌طور پیش‌فرض بارگذاری‌ها به volume با نام `verdin-data` می‌روند. برای ذخیرهٔ آن‌ها در RustFS:

```sh frame="terminal"
echo "S3_SECRET_KEY=$(openssl rand -hex 24)" >> .env
docker compose -f compose.yaml -f compose.s3.yaml up -d
```

آن‌وقت فایل‌ها توسط Caddy در `https://<your domain>/media/<key>` ارائه می‌شوند. برای AWS S3،
Cloudflare R2 یا ارائه‌دهندهٔ دیگر، سرویس‌های RustFS را کنار بگذارید و متغیرهای
`VERDIN_UPLOAD__PROVIDER__*` و اعتبارنامه‌های `AWS_*` را روی مقدارهای آن ارائه‌دهنده تنظیم کنید
(بخش [ذخیره‌سازی](/fa/internals/storage/) را ببینید). تغییر ارائه‌دهنده در یک سایت موجود هیچ فایلی را جابه‌جا نمی‌کند:
بارگذاری‌های جدید به ارائه‌دهندهٔ جدید می‌روند.

## نکته‌ها

- **نشانی کلاینت‌ها.** Verdin به `X-Forwarded-For` از شبکهٔ Compose (`172.30.0.0/24`، ثابت در
  `compose.yaml`) اعتماد می‌کند، جایی که Caddy تنها proxy است. اگر این بازه با یکی از شبکه‌های شما
  تداخل دارد هر دو را تغییر دهید.
- **بلادرنگ.** Caddy پاسخ‌های `text/event-stream` را بدون بافر جریان می‌دهد، بنابراین
  [رویدادهای بلادرنگ](/fa/guides/frontend/realtime/) پشت آن بدون تغییر کار می‌کنند.
- **ارتقاها.** `VERDIN_VERSION` را در `.env` تغییر دهید، سپس `docker compose pull && docker compose up -d`.
  پیش از آن [ارتقای Verdin](/fa/migrate/upgrading/) را بخوانید.
- **پشتیبان‌گیری.** از PostgreSQL dump بگیرید و volume با نام `verdin-data` (یا باکت) را نگه دارید؛
  [پشتیبان‌گیری](/fa/deploy/backups/) را ببینید.
- **فرمان‌های مدیریت.** ایمیج shell ندارد: `docker compose exec verdin verdin admin create --email you@example.com`.
