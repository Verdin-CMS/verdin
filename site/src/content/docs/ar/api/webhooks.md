---
title: "Webhooks"
description: "أحداث الـ webhooks وأشكال الحمولات والترويسات والتحقق من التوقيع وإعادة المحاولة وسجل التسليم."
sidebar:
  order: 6
---

يرسل الـ webhook طلب HTTP `POST` إلى عنوان URL الخاص بك عندما يتغير المحتوى أو الوسائط. هذه الصفحة
مرجع للجهات المستقبِلة: الأحداث والحمولات والترويسات والتوقيعات والتسليم. لإنشاء
الـ webhooks وإدارتها في لوحة الإدارة، راجع [Webhooks](/ar/guides/integrations/webhooks/).

## الأحداث

| الحدث | يُرسل عندما |
| --- | --- |
| `entry.create` | يُنشأ مستند، من أي API: REST أو GraphQL أو لوحة الإدارة أو إضافة. |
| `entry.update` | يُحفظ مستند. |
| `entry.publish` | يُنشر مستند. إنشاء مستند أو تحديثه عبر REST أو GraphQL دون `status=draft` ينشره. |
| `entry.unpublish` | يُلغى نشر مستند. |
| `entry.discard-draft` | تُتجاهل مسودة مستند. |
| `entry.delete` | يُحذف مستند. |
| `media.create`، `media.update`، `media.delete` | يُرفع ملف أو يُعدَّل أو يُحذف. حذف مجلد يرسل `media.delete` لكل ملف فيه. |
| `releases.publish` | نُفّذت [حزمة نشر](/ar/guides/content/releases/)، الآن أو في موعدها. |
| `review-workflows.updateEntryStage` | انتقل إدخال إلى [مرحلة مراجعة](/ar/guides/content/review-workflows/) أخرى. |

يشترك الـ webhook في بعض الأحداث ويمكن حصره في بعض أنواع المحتوى. أحداث الوسائط
غير مرتبطة بنوع محتوى.

## الحمولات

لكل حمولة `event` و`createdAt` (وقت إدراج الحدث في الطابور). تضيف أحداث الإدخالات
نوع المحتوى والمستند:

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

- `model` هو `singularName` للنوع، و`uid` هو UID الخاص به، و`locale` لغة النسخة
  التي تغيّرت (`null` في الأنواع غير المترجمة).
- `entry` هو المستند كما يعيده REST API، دون العلاقات أو الوسائط أو المكوّنات أو
  حقول `private`.
- يحمل `entry.publish` النسخة المنشورة. وتحمل أحداث الإدخالات الأخرى المسودة، أو
  النسخة الوحيدة في الأنواع التي لا تستخدم المسودة والنشر.
- لا يحمل `entry.delete` إلا `{ "documentId": … }`.

ترسل أحداث الوسائط كائن الملف في `media`، دون `model` أو `uid` أو `entry`:

```json
{
  "event": "media.create",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "media": { "id": 5, "documentId": "v3k9…", "name": "harbour.jpg", "mime": "image/jpeg", "url": "/uploads/harbour_4f1c.jpg" }
}
```

يرسل `releases.publish` قيمة `release` مع نتيجة كل إجراء من إجراءاتها.
ويرسل `review-workflows.updateEntryStage`:

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

كما في أحداث الإدخالات، `model` هو الاسم المفرد و`uid` هو UID نوع المحتوى (قبل
0.10، كان `model` يحمل الـ UID هنا).

يرسل زر **إرسال حدث تجريبي** القيمة `{ "event": "trigger-test", "createdAt": … }`.

## الترويسات

| الترويسة | القيمة |
| --- | --- |
| `content-type` | `application/json` |
| `x-verdin-event` | اسم الحدث. |
| `x-verdin-delivery` | معرّف التسليم. يبقى كما هو عبر إعادات المحاولة: استخدمه لتجاهل التكرارات. |
| `x-verdin-signature` | `t=<unix seconds>,v1=<hex>`، عندما يكون الـ webhook موقَّعًا. |

يمكن للـ webhooks إضافة ترويساتها الخاصة، مثل رمز `authorization` لنقطة النهاية الخاصة بك. لا يمكن
تجاوز الترويسات المذكورة أعلاه.

## التحقق من التوقيعات

الـ webhooks موقَّعة افتراضيًا. `v1` هو HMAC-SHA256 بترميز hex لـ `<t>.<raw body>`، بمفتاح هو
سرّ الـ webhook (`whsec_…`). يُعرض السرّ مرة واحدة، عند إنشاء الـ webhook أو عند تدوير
سرّه.

للتحقق من تسليم:

1. قسّم الترويسة إلى `t` و`v1`.
2. ارفضه إذا كان `t` بعيدًا عن ساعتك بأكثر من بضع دقائق.
3. احسب HMAC على `t` ونقطة وجسم الطلب **الخام**. لا تحلّل JSON ثم تعيد تسلسله
   أولًا: ستختلف البايتات.
4. قارنه بـ `v1` في زمن ثابت.

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

مع Express، اقرأ الجسم الخام وتحقق منه قبل تحليله:

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

في Python:

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

## التسليم وإعادة المحاولة

تُدرج عمليات التسليم في طابور داخل قاعدة البيانات عند اعتماد التغيير، ويرسلها عامل
في الخلفية. نقطة النهاية البطيئة أو الفاشلة لا تبطئ أبدًا المحررين أو عمليات الكتابة عبر الـ API، وتصمد
عمليات التسليم أمام إعادة التشغيل.

- **النجاح**: أي إجابة `2xx`.
- **الإخفاق**: أي حالة أخرى، بما في ذلك إعادات التوجيه (التي لا تُتبع)، أو خطأ
  اتصال، أو انتهاء المهلة (`[webhooks].timeout_secs`، 10 ثوانٍ افتراضيًا).
- **إعادة المحاولة**: يُعاد تسليم فاشل بعد 30 ثانية، ودقيقتين، و10 دقائق، وساعة
  و6 ساعات، أي ست محاولات إجمالًا. ثم يُعلَّم بأنه فاشل.
- تعطيل webhook أو حذفه يوقف إعادات المحاولة المعلّقة الخاصة به.
- تتشارك عدة نسخ الطابور؛ وتستحوذ إحداها على كل تسليم.

أجب بسرعة بـ `2xx` ونفّذ العمل البطيء بعد ذلك. قد تصل عمليات التسليم أكثر من مرة
(إعادة محاولة بعد انتهاء المهلة، مثلًا) وبغير ترتيب: استخدم `x-verdin-delivery` لتخطي
التكرارات، وأعِد جلب المستند عندما يكون الترتيب مهمًا.

## سجل التسليم

لصفحة كل webhook في **الإعدادات ← Webhooks** **سجل التسليم**، الأحدث أولًا. لكل
تسليم يعرض الحالة (**قيد الانتظار**، **جارٍ الإرسال**، **نجح**، **فشل**)، وحالة HTTP،
وأول 2 KB من جسم الاستجابة، والخطأ، وعدد المحاولات، ووقت المحاولة
التالية، والمدة والحمولة التي أُرسلت. يمكن إعادة محاولة تسليم فاشل
من السجل.

تُحذف عمليات التسليم المنتهية بعد `[webhooks].retention_days` (30 افتراضيًا).

البيانات نفسها متاحة من [API الإدارة](/ar/api/admin/):
`GET /admin/api/webhooks/{id}/deliveries` و`POST /admin/api/webhooks/deliveries/{id}/retry`.

## قيود عناوين URL

تحت `verdin start`، لا يجوز أن تشير عناوين URL للـ webhooks إلى عناوين loopback أو خاصة أو link-local أو
عناوين محجوزة أخرى، سواء كُتبت كعناوين IP أو كأسماء مضيفين تُحَلّ إليها. لا يستطيع
المسؤول استخدام الـ webhooks للوصول إلى خدمات داخلية. يسمح بها `verdin dev`، لتتمكن من
الاختبار على `localhost`؛ ويتجاوز `[webhooks].allow_private_networks` الإعداد الافتراضي. تُرفض عناوين URL
التي تحتوي على بيانات اعتماد (`https://user:pass@…`): ضعها في ترويسة.

## مقارنة مع Strapi

تتبع الحمولات حمولات Strapi (`event`، `createdAt`، `model`، `uid`، `entry`). يضيف Verdin
التوقيعات وإعادة المحاولة وسجل التسليم وعوامل تصفية لكل نوع محتوى. حدث Strapi
`entry.draft-discard` اسمه `entry.discard-draft`.
