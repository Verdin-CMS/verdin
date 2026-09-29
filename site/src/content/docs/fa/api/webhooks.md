---
title: "وب‌هوک‌ها"
description: "رویدادهای وب‌هوک، شکل payloadها، هدرها، تأیید امضا، تلاش‌های دوباره و گزارش ارسال‌ها."
sidebar:
  order: 6
---

وب‌هوک وقتی محتوا یا رسانه تغییر می‌کند، یک `POST` از نوع HTTP به URL شما می‌فرستد. این صفحه
مرجعی برای دریافت‌کننده‌هاست: رویدادها، payloadها، هدرها، امضاها و ارسال. برای ساختن و
مدیریت وب‌هوک‌ها در پنل مدیریت، [وب‌هوک‌ها](/fa/guides/integrations/webhooks/) را ببینید.

## رویدادها

| رویداد | زمان ارسال |
| --- | --- |
| `entry.create` | سندی ساخته شود، از هر APIای: REST، GraphQL، پنل مدیریت یا یک افزونه. |
| `entry.update` | سندی ذخیره شود. |
| `entry.publish` | سندی منتشر شود. ساختن یا به‌روزرسانی یک سند از طریق REST یا GraphQL بدون `status=draft` آن را منتشر می‌کند. |
| `entry.unpublish` | سندی از انتشار خارج شود. |
| `entry.discard-draft` | پیش‌نویس یک سند دور ریخته شود. |
| `entry.delete` | سندی حذف شود. |
| `media.create`، `media.update`، `media.delete` | فایلی بارگذاری، ویرایش یا حذف شود. حذف یک پوشه برای هر فایل درون آن `media.delete` می‌فرستد. |
| `releases.publish` | یک [بستهٔ انتشار](/fa/guides/content/releases/) اجرا شد، همین حالا یا در تاریخ خودش. |
| `review-workflows.updateEntryStage` | مدخلی به [مرحلهٔ بازبینی](/fa/guides/content/review-workflows/) دیگری رفت. |

هر وب‌هوک مشترک برخی رویدادهاست و می‌تواند به برخی نوع‌های محتوا محدود شود. رویدادهای رسانه
به هیچ نوع محتوایی وابسته نیستند.

## Payloadها

هر payload دارای `event` و `createdAt` (زمانی که رویداد در صف قرار گرفت) است. رویدادهای مدخل،
نوع محتوا و سند را هم اضافه می‌کنند:

```json
{
  "event": "entry.publish",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "model": "article",
  "uid": "api::article",
  "locale": null,
  "entry": {
    "id": 3,
    "documentId": "k2m7q4dx8n5t1v3b9c0e6a2wfr",
    "title": "Hello, Verdin",
    "slug": "hello-verdin",
    "createdAt": "2026-09-25T08:55:00.000Z",
    "updatedAt": "2026-09-25T09:00:00.000Z",
    "publishedAt": "2026-09-25T09:00:00.000Z"
  }
}
```

- `model` همان `singularName` نوع است، `uid` همان UID آن، و `locale` زبانِ نسخه‌ای که
  تغییر کرده است (در نوع‌هایی که بومی‌سازی‌شده نیستند `null`).
- `entry` سند است، همان‌طور که REST API آن را برمی‌گرداند، بدون روابط، رسانه، کامپوننت‌ها یا
  فیلدهای `private`.
- `entry.publish` نسخهٔ منتشرشده را حمل می‌کند. رویدادهای دیگر مدخل، پیش‌نویس را حمل می‌کنند، یا
  در نوع‌های بدون پیش‌نویس و انتشار، تنها نسخهٔ موجود را.
- `entry.delete` فقط `{ "documentId": … }` را حمل می‌کند.

رویدادهای رسانه شیء فایل را در `media` می‌فرستند، بدون `model`، `uid` یا `entry`:

```json
{
  "event": "media.create",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "media": { "id": 5, "documentId": "v3k9…", "name": "harbour.jpg", "mime": "image/jpeg", "url": "/uploads/harbour_4f1c.jpg" }
}
```

`releases.publish` شیء `release` را همراه با نتیجهٔ هر یک از کنش‌هایش می‌فرستد.
`review-workflows.updateEntryStage` این را می‌فرستد:

```json
{
  "event": "review-workflows.updateEntryStage",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "model": "article",
  "uid": "api::article",
  "entry": { "documentId": "k2m7q4…", "locale": "en" },
  "workflow": { "id": 1, "name": "Editorial" },
  "stages": { "from": { "id": 1, "name": "To do" }, "to": { "id": 2, "name": "In review" } }
}
```

مانند رویدادهای مدخل، `model` نام مفرد است و `uid` همان UID نوع محتوا (پیش از
0.10، `model` در اینجا UID را نگه می‌داشت).

دکمهٔ **ارسال رویداد آزمایشی** مقدار `{ "event": "trigger-test", "createdAt": … }` را می‌فرستد.

## هدرها

| هدر | مقدار |
| --- | --- |
| `content-type` | `application/json` |
| `x-verdin-event` | نام رویداد. |
| `x-verdin-delivery` | شناسهٔ ارسال. در تلاش‌های دوباره ثابت می‌ماند: از آن برای نادیده گرفتن موارد تکراری استفاده کنید. |
| `x-verdin-signature` | `t=<unix seconds>,v1=<hex>`، وقتی وب‌هوک امضاشده باشد. |

وب‌هوک‌ها می‌توانند هدرهای خودشان را اضافه کنند، مثلاً یک توکن `authorization` برای نقطهٔ پایانی شما.
هدرهای بالا را نمی‌توان بازنویسی کرد.

## تأیید امضاها

وب‌هوک‌ها به‌طور پیش‌فرض امضا می‌شوند. `v1` مقدار hex از HMAC-SHA256 روی `<t>.<raw body>` است، با
کلید محرمانهٔ وب‌هوک (`whsec_…`). کلید محرمانه فقط یک بار نشان داده می‌شود: وقتی وب‌هوک ساخته
می‌شود یا کلید محرمانه‌اش چرخانده می‌شود.

برای بررسی یک ارسال:

1. هدر را به `t` و `v1` تقسیم کنید.
2. اگر `t` بیش از چند دقیقه با ساعت شما فاصله دارد، آن را رد کنید.
3. HMAC را روی `t`، یک نقطه و بدنهٔ **خام** درخواست محاسبه کنید. JSON را پیش از آن parse و
   دوباره serialize نکنید: بایت‌ها فرق خواهند کرد.
4. آن را در زمان ثابت با `v1` مقایسه کنید.

```js title="verify.mjs"
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, header, rawBody, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=')));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const received = parts.v1 ?? '';
  return (
    received.length === expected.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  );
}
```

با Express، بدنهٔ خام را بخوانید و پیش از parse کردن، آن را تأیید کنید:

```js title="server.mjs"
import express from 'express';
import { verify } from './verify.mjs';

const app = express();

app.post('/hooks/verdin', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body.toString('utf8');
  if (!verify(process.env.VERDIN_WEBHOOK_SECRET, req.get('x-verdin-signature') ?? '', rawBody)) {
    return res.sendStatus(401);
  }
  const payload = JSON.parse(rawBody);
  console.log(req.get('x-verdin-delivery'), payload.event, payload.entry?.documentId);
  res.sendStatus(204);
});

app.listen(3000);
```

در Python:

```python title="verify.py"
import hashlib
import hmac
import time


def verify(secret: str, header: str, raw_body: bytes, tolerance: int = 300) -> bool:
    parts = dict(part.split("=", 1) for part in header.split(","))
    if abs(time.time() - int(parts["t"])) > tolerance:
        return False
    signed = parts["t"].encode() + b"." + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))
```

## ارسال و تلاش‌های دوباره

ارسال‌ها هنگام commit شدن تغییر در پایگاه داده صف می‌شوند و یک worker پس‌زمینه آن‌ها را
می‌فرستد. یک نقطهٔ پایانی کند یا خراب هرگز ویرایشگران یا نوشتن‌های API را کند نمی‌کند، و ارسال‌ها
پس از راه‌اندازی دوباره هم باقی می‌مانند.

- **موفقیت**: هر پاسخ `2xx`.
- **شکست**: هر وضعیت دیگر، از جمله تغییرمسیرها (که دنبال نمی‌شوند)، خطای اتصال
  یا پایان مهلت (`[webhooks].timeout_secs`، به‌طور پیش‌فرض 10 ثانیه).
- **تلاش‌های دوباره**: یک ارسال ناموفق پس از 30 ثانیه، 2 دقیقه، 10 دقیقه، 1 ساعت
  و 6 ساعت دوباره فرستاده می‌شود، در مجموع شش تلاش. پس از آن ناموفق علامت‌گذاری می‌شود.
- غیرفعال کردن یا حذف یک وب‌هوک، تلاش‌های دوبارهٔ در انتظار آن را متوقف می‌کند.
- چند نمونه صف را به اشتراک می‌گذارند؛ هر ارسال را یکی از آن‌ها برمی‌دارد.

سریع با یک `2xx` پاسخ دهید و کارهای کند را بعد انجام دهید. ارسال‌ها ممکن است بیش از یک بار برسند
(مثلاً یک تلاش دوباره پس از پایان مهلت) و بی‌ترتیب باشند: از `x-verdin-delivery` برای رد کردن
موارد تکراری استفاده کنید و وقتی ترتیب اهمیت دارد، سند را دوباره دریافت کنید.

## گزارش ارسال‌ها

صفحهٔ هر وب‌هوک در **تنظیمات ← وب‌هوک‌ها** یک **گزارش ارسال‌ها** دارد، جدیدترین‌ها اول. برای هر
ارسال، وضعیت (**در انتظار**، **در حال ارسال**، **موفق**، **ناموفق**)، وضعیت HTTP،
2 KB نخست بدنهٔ پاسخ، خطا، تعداد تلاش‌ها، زمان تلاش بعدی، مدت‌زمان و payloadی که فرستاده شد را
نشان می‌دهد. یک ارسال ناموفق را می‌توان از همین گزارش دوباره فرستاد.

ارسال‌های پایان‌یافته پس از `[webhooks].retention_days` (به‌طور پیش‌فرض 30) حذف می‌شوند.

همین داده‌ها از طریق [API مدیریت](/fa/api/admin/) هم در دسترس است:
`GET /admin/api/webhooks/{id}/deliveries` و `POST /admin/api/webhooks/deliveries/{id}/retry`.

## محدودیت‌های URL

در `verdin start`، URLهای وب‌هوک نمی‌توانند به نشانی‌های loopback، خصوصی، link-local یا دیگر
نشانی‌های رزروشده اشاره کنند، چه به‌صورت نشانی IP نوشته شده باشند و چه به‌صورت نام میزبانی که به
آن‌ها resolve می‌شود. یک مدیر نمی‌تواند با وب‌هوک‌ها به سرویس‌های داخلی دسترسی پیدا کند. `verdin dev`
آن‌ها را مجاز می‌کند تا بتوانید روی `localhost` تست کنید؛ `[webhooks].allow_private_networks` پیش‌فرض را
تغییر می‌دهد. URLهای دارای اطلاعات ورود (`https://user:pass@…`) پذیرفته نمی‌شوند: آن‌ها را در یک هدر بگذارید.

## مقایسه با Strapi

Payloadها از Strapi پیروی می‌کنند (`event`، `createdAt`، `model`، `uid`، `entry`). Verdin
امضاها، تلاش‌های دوباره، گزارش ارسال‌ها و فیلتر بر اساس نوع محتوا را اضافه می‌کند. رویداد
`entry.draft-discard` در Strapi اینجا `entry.discard-draft` نام دارد.
