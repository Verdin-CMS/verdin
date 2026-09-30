---
title: سرور Linux
description: Verdin را روی یک سرور Debian یا Ubuntu از بستهٔ .deb اجرا کنید — یک سرویس systemd، یک کاربر سیستمی verdin، وضعیت در /var/lib/verdin — پشت یک reverse proxy.
sidebar:
  order: 3
---

این صفحه Verdin را مستقیماً روی یک سرور Debian یا Ubuntu، بدون کانتینر، از بستهٔ `.deb` که به هر
نسخه پیوست است اجرا می‌کند. همین چیدمان روی توزیع‌های دیگر هم کار می‌کند، با باینری
[اسکریپت نصب](/fa/start/installation/) و فایل‌های
[`deploy/deb/`](https://github.com/verdin-cms/verdin/tree/main/deploy/deb) که دستی کپی شوند.

بسته در تاریخ 2026-09-30 با `cargo deb` ساخته و بازرسی شد؛ برای این راهنما روی یک سرور زنده
نصب نشد.

## بسته چه چیزی نصب می‌کند

| مسیر | چه |
| --- | --- |
| `/usr/bin/verdin` | باینری (static، پنل مدیریت درون آن). |
| `/etc/verdin/verdin.toml` | پیکربندی (یک conffile: ارتقاها ویرایش‌های شما را نگه می‌دارند). |
| `/etc/verdin/verdin.env` | در نخستین نصب ساخته می‌شود، با حالت `0640`: `VERDIN_ADMIN_JWT_SECRET` و `VERDIN_TOKEN_PEPPER` تازه، و `VERDIN_DATABASE_URL` (به‌طور پیش‌فرض SQLite). |
| `/var/lib/verdin/` | خانهٔ کاربر سیستمی `verdin`: پایگاه دادهٔ SQLite، `schema/`، `uploads/`، نمایهٔ جستجو و کش تصویر. |
| `/usr/lib/systemd/system/verdin.service` | سرویس، نصب‌شده اما فعال‌نشده. |

سرویس `verdin -c /etc/verdin/verdin.toml start --migrate` را با کاربر `verdin` اجرا می‌کند،
با sandbox سیستم systemd (سیستم فقط‌خواندنی، `/tmp` خصوصی، بدون امتیاز جدید)
و دسترسی نوشتن فقط به `/var/lib/verdin`. روی `127.0.0.1:1337` گوش می‌دهد.

## 1. نصب

```sh frame="terminal"
curl -fsSLO https://github.com/verdin-cms/verdin/releases/download/v0.11.0/verdin_0.11.0-1_amd64.deb
sudo apt install ./verdin_0.11.0-1_amd64.deb
```

روی سرورهای ARM در نام فایل `arm64` را به کار ببرید.

## 2. پیکربندی

1. طرح‌وارهٔ commit‌شدهٔ خود را در `/var/lib/verdin/schema/` کپی کنید (`content-types/` و
   `components/`)، با مالکیت `verdin`:

   ```sh frame="terminal"
   sudo rsync -a --chown=verdin:verdin schema/ /var/lib/verdin/schema/
   ```

2. برای PostgreSQL، MySQL یا MariaDB، `VERDIN_DATABASE_URL` را در
   `/etc/verdin/verdin.env` ویرایش کنید. دو کلید محرمانه را نگه دارید: یک `VERDIN_TOKEN_PEPPER` جدید
   همهٔ توکن‌های API را باطل می‌کند.
3. در `/etc/verdin/verdin.toml`، `[server].public_url` را روی نشانی‌ای که مرورگرها استفاده می‌کنند
   تنظیم کنید، و وقتی reverse proxy روی همان ماشین اجرا می‌شود `trusted_proxies = ["127.0.0.1"]`.
   هر کلید دیگر در [مرجع پیکربندی](/fa/reference/configuration/) آمده است.

## 3. راه‌اندازی

```sh frame="terminal"
sudo systemctl enable --now verdin
journalctl -u verdin -f
```

نخستین راه‌اندازی جدول‌ها را می‌سازد. نخستین مدیر را از خط فرمان بسازید (فایل محیطی سرویس
URL پایگاه داده را دارد):

```sh frame="terminal"
sudo -u verdin sh -c 'set -a; . /etc/verdin/verdin.env; verdin -c /etc/verdin/verdin.toml admin create --email you@example.com'
```

یا پنل مدیریت را از طریق proxy خود باز کنید و همان‌جا ثبت‌نام کنید.

## 4. یک reverse proxy جلوی آن بگذارید

Verdin روی رابط loopback HTTP ساده ارائه می‌کند. با Caddy، که گواهی را خودش می‌گیرد و
تمدید می‌کند:

```text title="/etc/caddy/Caddyfile"
cms.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:1337
}
```

nginx هم کار می‌کند؛ بافر را برای `/api/_events` خاموش کنید تا رویدادهای بلادرنگ
معطل نشوند (`proxy_buffering off;`).

## ارتقا و حذف

- **ارتقا:** `.deb` نسخهٔ بعدی را با `apt install ./verdin_….deb` نصب کنید. اگر سرویس در حال اجرا بود
  دوباره راه‌اندازی می‌شود، و `start --migrate` مهاجرت‌های امن را اعمال می‌کند.
  پیش از آن [ارتقای Verdin](/fa/migrate/upgrading/) را بخوانید.
- **حذف:** `apt remove verdin` سرویس را متوقف می‌کند و داده‌ها و پیکربندی را نگه می‌دارد؛
  `apt purge verdin` `/etc/verdin/verdin.env` (کلیدهای محرمانه) را هم حذف می‌کند. کاربر `verdin` و
  `/var/lib/verdin` هرگز توسط بسته حذف نمی‌شوند: پس از گرفتن [نسخهٔ پشتیبان](/fa/deploy/backups/)
  خودتان آن‌ها را حذف کنید.
