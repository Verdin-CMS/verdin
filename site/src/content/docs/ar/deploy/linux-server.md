---
title: خادم Linux
description: شغّل Verdin على خادم Debian أو Ubuntu من حزمة .deb — خدمة systemd، ومستخدم نظام verdin، والحالة في /var/lib/verdin — خلف وكيل عكسي.
sidebar:
  order: 3
---

تشغّل هذه الصفحة Verdin مباشرة على خادم Debian أو Ubuntu، دون حاويات، من
حزمة `.deb` المرفقة بكل إصدار. ويعمل التخطيط نفسه على توزيعات أخرى بالملف التنفيذي من
[سكربت التثبيت](/ar/start/installation/) والملفات الموجودة تحت
[`deploy/deb/`](https://github.com/verdin-cms/verdin/tree/main/deploy/deb)
منسوخة يدويًا.

بُنيت الحزمة وفُحصت بـ `cargo deb` في 2026-09-30؛ ولم تُثبَّت
على خادم فعلي من أجل هذا الدليل.

## ما الذي تثبّته الحزمة

| المسار | ماذا |
| --- | --- |
| `/usr/bin/verdin` | الملف التنفيذي (ساكن، ولوحة الإدارة مدمجة فيه). |
| `/etc/verdin/verdin.toml` | التهيئة (conffile: تحتفظ الترقيات بتعديلاتك). |
| `/etc/verdin/verdin.env` | يُنشأ عند أول تثبيت، بالصلاحيات `0640`: قيمتان جديدتان لـ `VERDIN_ADMIN_JWT_SECRET` و`VERDIN_TOKEN_PEPPER`، و`VERDIN_DATABASE_URL` (SQLite افتراضيًا). |
| `/var/lib/verdin/` | مجلد المنزل لمستخدم النظام `verdin`: قاعدة بيانات SQLite، و`schema/`، و`uploads/`، وفهرس البحث وذاكرة الصور المؤقتة. |
| `/usr/lib/systemd/system/verdin.service` | الخدمة، مثبّتة لكن غير مفعّلة. |

تشغّل الخدمة `verdin -c /etc/verdin/verdin.toml start --migrate` بصفة المستخدم `verdin`،
مع عزل systemd (نظام للقراءة فقط، و`/tmp` خاص، وبلا صلاحيات جديدة)
وصلاحية كتابة على `/var/lib/verdin` فقط. وتستمع على `127.0.0.1:1337`.

## 1. ثبّت

```sh frame="terminal"
curl -fsSLO https://github.com/verdin-cms/verdin/releases/download/v0.11.0/verdin_0.11.0-1_amd64.deb
sudo apt install ./verdin_0.11.0-1_amd64.deb
```

استخدم `arm64` في اسم الملف على خوادم ARM.

## 2. هيّئ

1. انسخ مخططك المعتمد إلى `/var/lib/verdin/schema/` (`content-types/` و
   `components/`)، بملكية `verdin`:

   ```sh frame="terminal"
   sudo rsync -a --chown=verdin:verdin schema/ /var/lib/verdin/schema/
   ```

2. لـ PostgreSQL أو MySQL أو MariaDB، عدّل `VERDIN_DATABASE_URL` في
   `/etc/verdin/verdin.env`. أبقِ السرّين: فـ `VERDIN_TOKEN_PEPPER` جديد
   يبطل كل رمز API.
3. في `/etc/verdin/verdin.toml`، عيّن `[server].public_url` بالعنوان الذي تستخدمه المتصفحات،
   و`trusted_proxies = ["127.0.0.1"]` عندما يعمل الوكيل العكسي على الجهاز نفسه.
   كل مفتاح آخر موجود في [مرجع التهيئة](/ar/reference/configuration/).

## 3. شغّل

```sh frame="terminal"
sudo systemctl enable --now verdin
journalctl -u verdin -f
```

ينشئ أول تشغيل الجداول. أنشئ المسؤول الأول من سطر الأوامر (يحتوي ملف بيئة
الخدمة على عنوان قاعدة البيانات):

```sh frame="terminal"
sudo -u verdin sh -c 'set -a; . /etc/verdin/verdin.env; verdin -c /etc/verdin/verdin.toml admin create --email you@example.com'
```

أو افتح لوحة الإدارة عبر وكيلك وسجّل هناك.

## 4. ضع وكيلًا عكسيًا أمامه

يقدّم Verdin HTTP عاديًا على واجهة loopback. مع Caddy، الذي يحصل على
الشهادة ويجدّدها بنفسه:

```text title="/etc/caddy/Caddyfile"
cms.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:1337
}
```

يعمل nginx أيضًا؛ أوقف التخزين المؤقت (buffering) لـ `/api/_events` لكي لا تُحتجز أحداث الوقت الفعلي
(`proxy_buffering off;`).

## الترقيات والإزالة

- **الترقية:** ثبّت ملف `.deb` للإصدار التالي بـ `apt install ./verdin_….deb`.
  تُعاد تشغيل الخدمة إن كانت تعمل، ويطبّق `start --migrate` الترحيلات الآمنة.
  اقرأ [ترقية Verdin](/ar/migrate/upgrading/) أولًا.
- **الإزالة:** يوقف `apt remove verdin` الخدمة ويُبقي البيانات والتهيئة؛
  ويحذف `apt purge verdin` أيضًا `/etc/verdin/verdin.env` (الأسرار).
  لا تحذف الحزمة أبدًا المستخدم `verdin` ولا `/var/lib/verdin`:
  احذفهما بنفسك بعد أن تأخذ [نسخة احتياطية](/ar/deploy/backups/).
