---
title: Fly.io
description: انشر Verdin على Fly.io بصورتك الخاصة، مع PostgreSQL وتخزين الكائنات Tigris، أو على Machine واحدة مع SQLite على وحدة تخزين.
sidebar:
  order: 4
---

تنشر هذه الصفحة مشروع Verdin على [Fly.io](https://fly.io) كصورة صغيرة مبنية على
الصورة الرسمية. لا يحتفظ الإعداد الموصى به بأي حالة على الـ Machine: PostgreSQL
لقاعدة البيانات وTigris (تخزين Fly المتوافق مع S3) للوسائط. ويلي ذلك بديل مع SQLite
على وحدة تخزين.

:::note
رُوجعت صيغ Fly مقابل [توثيق Fly](https://docs.fly.io/reference/configuration/)
في 2026-09-29؛ ولم يُشغَّل الإعداد على حساب Fly فعلي. القيم بين أقواس الزاوية
وتلك المعلَّمة بـ `# yours` عليك أنت ملؤها.
:::

المتطلبات: [`flyctl`](https://docs.fly.io/flyctl/install/) مع تسجيل الدخول، ومشروع Verdin
اعتُمد مجلد `schema/` الخاص به.

## 1. أضف Dockerfile وتهيئة

في مجلد المشروع، أضف `Dockerfile` ينسخ تهيئتك ومخططك
إلى الصورة الرسمية (راجع [صورتك الخاصة](/ar/deploy/docker/)):

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

وملف `verdin.toml` لـ Fly:

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

تأكد من بقاء `.env` خارج سياق البناء: أضفه إلى `.dockerignore`.

## 2. اكتب `fly.toml`

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

يطبّق الأمر الافتراضي للصورة، `start --migrate`، الترحيلات الآمنة عند بدء كل
Machine، لذا لا حاجة إلى `release_command`. (يشغّل Fly الأمر `release_command` في
Machine مؤقتة بلا وحدات تخزين، وهو ما لن يعمل مع SQLite على أي حال.)

## 3. أنشئ التطبيق وقاعدة البيانات والحاوية

1. أنشئ التطبيق دون نشره. يبدأ `--ha=false` بـ Machine واحدة؛ اقرأ
   [تشغيل عدة نسخ](/ar/deploy/scaling/) قبل أن تضيف المزيد.

   ```sh frame="terminal"
   fly launch --no-deploy --copy-config --ha=false
   ```

2. أنشئ قاعدة بيانات PostgreSQL، مثلًا باستخدام
   [Fly Managed Postgres](https://docs.fly.io/mpg/) أو أي موفّر PostgreSQL، ودوّن
   عنوان URL للاتصال بها.

3. أنشئ حاوية Tigris عامة. يعيّن الأمر `AWS_ACCESS_KEY_ID` و
   `AWS_SECRET_ACCESS_KEY` و`AWS_ENDPOINT_URL_S3` و`BUCKET_NAME` كأسرار
   للتطبيق؛ ويقرأ Verdin الأوّلين. ضع اسم الحاوية في `verdin.toml`.

   ```sh frame="terminal"
   fly storage create --public
   ```

4. عيّن أسرار Verdin وعنوان URL لقاعدة البيانات:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets | fly secrets import
   fly secrets set VERDIN_DATABASE_URL='postgres://<user>:<password>@<host>:5432/<db>?sslmode=require'
   ```

5. انشر، ثم افتح `https://<app>.fly.dev/admin/` وسجّل المسؤول الأول:

   ```sh frame="terminal"
   fly deploy
   ```

## عناوين العملاء وحدود المعدل

يضيف وكيل Fly العميل إلى `X-Forwarded-For`، ووفقًا لـ
[توثيق ترويسات الطلبات في Fly](https://docs.fly.io/networking/request-headers/)
فإن العنوان الأبعد إلى اليمين هو عنوان IP الخاص بتطبيقك. ليعثر Verdin على العميل، اجعله يثق
بنطاق الوكيل وعناوين تطبيقك (`fly ips list`):

```toml title="verdin.toml"
[server]
trusted_proxies = ["172.16.0.0/12", "<app IPv4>", "<app IPv6>"]
```

لم يُتحقق من ذلك على تطبيق قيد التشغيل. إلى أن تتحقق منه، اترك
`[api].public_rate_limit` على `0`: بدون الوكلاء الصحيحين، يُحسب كل زائر
على أنه العنوان نفسه.

## بديل: Machine واحدة مع SQLite

لمشروع صغير يمكنك إبقاء قاعدة البيانات والملفات المرفوعة على وحدة تخزين Fly بدلًا من ذلك.

- في `verdin.toml`، عيّن `provider = { name = "local", dir = "/data/uploads" }` تحت
  `[upload]` (المجلد الافتراضي نسبي إلى `/app`، الذي لا يستطيع الخادم
  الكتابة فيه)، وعيّن `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` كسرّ.
- ركّب وحدة تخزين على `/data`:

  ```toml title="fly.toml"
  [mounts]
    source = "verdin_data"
    destination = "/data"
    initial_size = "1gb"
  ```

- شغّل Machine واحدة بالضبط (`fly scale count 1`). تُربط وحدة التخزين بـ Machine واحدة، و
  لا يمكن مشاركة SQLite.
- ينشئ Fly وحدات تخزين مملوكة لـ root، بينما تعمل الصورة بـ uid `65532`. إذا فشل
  البدء بخطأ صلاحيات على `/data`، أضف `USER root` إلى `Dockerfile` الخاص بك.

انسخ وحدة التخزين احتياطيًا: يحتفظ Fly بلقطات يومية لوحدات التخزين، ويمنحك `verdin export`
أرشيفًا محمولًا (راجع [النسخ الاحتياطية](/ar/deploy/backups/)).
