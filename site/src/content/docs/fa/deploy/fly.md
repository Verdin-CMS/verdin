---
title: Fly.io
description: Verdin را با ایمیج خودتان، PostgreSQL و ذخیره‌سازی اشیای Tigris روی Fly.io مستقر کنید، یا با یک Machine واحد و SQLite روی یک volume.
sidebar:
  order: 4
---

این صفحه یک پروژهٔ Verdin را به‌صورت یک ایمیج کوچک ساخته‌شده بر پایهٔ ایمیج رسمی روی
[Fly.io](https://fly.io) مستقر می‌کند. راه‌اندازی پیشنهادی هیچ وضعیتی روی Machine نگه نمی‌دارد: PostgreSQL برای
پایگاه داده و Tigris (ذخیره‌سازی سازگار با S3 در Fly) برای رسانه. در ادامه، گونه‌ای با SQLite
روی یک volume آمده است.

:::note
قالب‌های Fly در تاریخ 2026-09-29 با [مستندات Fly](https://docs.fly.io/reference/configuration/)
مقایسه شدند؛ این راه‌اندازی روی یک حساب واقعی Fly اجرا نشده است. مقادیر درون براکت‌های زاویه‌ای و
مقادیری که با `# yours` مشخص شده‌اند را خودتان پر کنید.
:::

پیش‌نیازها: [`flyctl`](https://docs.fly.io/flyctl/install/) با ورود انجام‌شده، و یک پروژهٔ Verdin
که پوشهٔ `schema/` آن commit شده باشد.

## 1. افزودن یک Dockerfile و یک پیکربندی

در پوشهٔ پروژه، یک `Dockerfile` اضافه کنید که پیکربندی و طرح‌وارهٔ شما را
در ایمیج رسمی کپی کند ([ایمیج خودتان](/fa/deploy/docker/) را ببینید):

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

و یک `verdin.toml` برای Fly:

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337
public_url = "https://my-verdin.fly.dev"       # yours: the app's URL or your domain

[schema]
path = "schema"

[log]
format = "json"

[upload]
provider = { name = "s3", bucket = "my-verdin-media",   # yours: the bucket name
             region = "auto", endpoint = "https://t3.storage.dev",
             public_url = "https://my-verdin-media.t3.tigrisfiles.io" }
```

مطمئن شوید `.env` بیرون از build context می‌ماند: آن را به `.dockerignore` اضافه کنید.

## 2. نوشتن `fly.toml`

```toml title="fly.toml"
app = "my-verdin"                # yours
primary_region = "fra"           # yours

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 1337
  force_https = true
  # Keep a Machine running: webhooks, scheduled releases, plugin jobs and the
  # daily digest run inside the server process.
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "30s"
    interval = "15s"
    method = "GET"
    timeout = "5s"
    path = "/_ready"

[[vm]]
  memory = "512mb"               # adjust to your content and traffic
```

فرمان پیش‌فرض ایمیج، `start --migrate`، هنگام شروع هر
Machine مهاجرت‌های امن را اعمال می‌کند، پس به `release_command` نیازی نیست. (Fly فرمان `release_command` را در یک
Machine موقت بدون volume اجرا می‌کند که به هر حال برای SQLite کار نمی‌کرد.)

## 3. ساخت اپ، پایگاه داده و باکت

1. اپ را بدون استقرار بسازید. `--ha=false` با یک Machine شروع می‌کند؛ پیش از افزودن Machineهای بیشتر
   [اجرای چند نمونه](/fa/deploy/scaling/) را بخوانید.

   ```sh frame="terminal"
   fly launch --no-deploy --copy-config --ha=false
   ```

2. یک پایگاه دادهٔ PostgreSQL بسازید، برای مثال با
   [Fly Managed Postgres](https://docs.fly.io/mpg/) یا هر ارائه‌دهندهٔ PostgreSQL دیگری، و
   URL اتصال آن را یادداشت کنید.

3. یک باکت عمومی Tigris بسازید. این فرمان `AWS_ACCESS_KEY_ID`،
   `AWS_SECRET_ACCESS_KEY`، `AWS_ENDPOINT_URL_S3` و `BUCKET_NAME` را به‌عنوان secretهای
   اپ تنظیم می‌کند؛ Verdin دو مورد اول را می‌خواند. نام باکت را در `verdin.toml` بنویسید.

   ```sh frame="terminal"
   fly storage create --public
   ```

4. کلیدهای محرمانهٔ Verdin و URL پایگاه داده را تنظیم کنید:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets | fly secrets import
   fly secrets set VERDIN_DATABASE_URL='postgres://<user>:<password>@<host>:5432/<db>?sslmode=require'
   ```

5. مستقر کنید، سپس `https://<app>.fly.dev/admin/` را باز کنید و نخستین مدیر را ثبت کنید:

   ```sh frame="terminal"
   fly deploy
   ```

## نشانی کلاینت‌ها و محدودیت نرخ

proxy در Fly کلاینت را به `X-Forwarded-For` اضافه می‌کند و بر اساس
[مستندات سرآیندهای درخواست Fly](https://docs.fly.io/networking/request-headers/)
راست‌ترین نشانی، IP خود اپ شماست. برای اینکه Verdin کلاینت را پیدا کند، به بازهٔ
proxy و نشانی‌های اپ خود (`fly ips list`) اعتماد کنید:

```toml title="verdin.toml"
[server]
trusted_proxies = ["172.16.0.0/12", "<app IPv4>", "<app IPv6>"]
```

این مورد روی یک اپ در حال اجرا تأیید نشده است. تا زمانی که آن را بررسی نکرده‌اید،
`[api].public_rate_limit` را روی `0` بگذارید: بدون proxyهای درست، همهٔ بازدیدکنندگان یک
نشانی واحد به حساب می‌آیند.

## گونهٔ دیگر: یک Machine با SQLite

برای یک پروژهٔ کوچک می‌توانید پایگاه داده و بارگذاری‌ها را به‌جای آن روی یک volume در Fly نگه دارید.

- در `verdin.toml`، زیر `[upload]` مقدار `provider = { name = "local", dir = "/data/uploads" }` را
  تنظیم کنید (پوشهٔ پیش‌فرض نسبت به `/app` است که سرور نمی‌تواند در آن
  بنویسد)، و `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` را به‌عنوان secret تنظیم کنید.
- یک volume در `/data` mount کنید:

  ```toml title="fly.toml"
  [mounts]
    source = "verdin_data"
    destination = "/data"
    initial_size = "1gb"
  ```

- دقیقاً یک Machine اجرا کنید (`fly scale count 1`). یک volume فقط به یک Machine متصل می‌شود، و
  SQLite را نمی‌توان به اشتراک گذاشت.
- Fly volumeها را با مالکیت root می‌سازد و ایمیج با uid `65532` اجرا می‌شود. اگر شروع
  با خطای دسترسی روی `/data` شکست خورد، `USER root` را به `Dockerfile` خود اضافه کنید.

از volume نسخهٔ پشتیبان بگیرید: Fly روزانه snapshot از volumeها نگه می‌دارد، و `verdin export`
یک آرشیو قابل‌حمل به شما می‌دهد ([پشتیبان‌گیری](/fa/deploy/backups/) را ببینید).
