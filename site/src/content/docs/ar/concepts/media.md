---
title: "الوسائط"
description: "مكتبة الوسائط، وحقول الوسائط، وصيغ الصور، وموفّرو التخزين (محلي أو S3) والمجلدات، وكيف تُربط الملفات بالمحتوى."
sidebar:
  order: 8
---

تحتوي مكتبة الوسائط على الصور ومقاطع الفيديو والصوت والملفات الأخرى التي يستخدمها محتواك. تشرح هذه
الصفحة كيف تُخزَّن الملفات وتُوصف وتُربط بالمستندات. لتقديم صور بأحجام معدّلة
على موقعك، راجع [الصور](/ar/guides/frontend/images/).

## الملفات

كل عملية رفع سجل ملف بشكل Strapi، لذا تقرأه الواجهات الأمامية المكتوبة لـ Strapi
دون تغيير (`formats` مختصرة):

```json
{
  "id": 5,
  "documentId": "v3k…",
  "name": "harbour.jpg",
  "alternativeText": "Boats in the harbour at dawn",
  "caption": null,
  "width": 2400,
  "height": 1600,
  "focalPoint": { "x": 0.4, "y": 0.6 },
  "formats": {
    "thumbnail": { "url": "/uploads/harbour_thumbnail_4f1c.jpg", "width": 234, "height": 156 },
    "large": { "url": "/uploads/harbour_large_4f1c.jpg", "width": 1000, "height": 667 }
  },
  "hash": "harbour_4f1c",
  "ext": ".jpg",
  "mime": "image/jpeg",
  "size": 812.4,
  "url": "/uploads/harbour_4f1c.jpg",
  "previewUrl": null,
  "provider": "local",
  "provider_metadata": null,
  "createdAt": "2026-09-25T09:00:00.000Z",
  "updatedAt": "2026-09-25T09:00:00.000Z",
  "publishedAt": "2026-09-25T09:00:00.000Z"
}
```

- `size` بالكيلوبايت، كما في Strapi.
- يأتي نوع MIME من بايتات الملف، لا مما يدّعيه العميل أبدًا.
- يحدد `focalPoint` الجزء من الصورة الذي يجب إبقاؤه ظاهرًا عند قصّها.

ليس للملفات مسودة: يصبح الملف المرفوع متاحًا بمجرد تخزينه.

## مكتبة الوسائط

في لوحة الإدارة، تسرد **مكتبة الوسائط** الملفات مع البحث، والتصفية حسب النوع، والمجلدات.
يرفع المسؤولون الملفات، أو يستوردونها من عنوان URL، ويعدّلون اسمها ونصها البديل وتعليقها ونقطة
التركيز، ويستبدلون محتوى الملف مع الإبقاء على معرّفه، ويرون **مكان استخدامه**:
حقول الوسائط، والوسائط داخل المكوّنات، وكتل النص المنسّق، وMarkdown الذي يحتوي على عنوان URL الخاص به.

تنظّم **المجلدات** المكتبة للمحررين. لا تُظهرها كائنات الملفات في استجابات الـ API،
لكن الرفع عبر API المحتوى يمكنه تسمية معرّف مجلد في `fileInfo` الخاص به.
حذف مجلد يحذف الملفات التي فيه.

يُتحكم في وصول المسؤولين بالصلاحيات `media.read` و`media.create` و`media.update` و
`media.delete`. لا يستطيع الدور المدمج Author تعديل وحذف إلا الملفات التي
رفعها. راجع [الصلاحيات](/ar/concepts/permissions/).

## حقول الوسائط

يربط نوع المحتوى الملفات عبر سمة `media`:

```json
"cover": { "type": "media", "allowedTypes": ["images"] },
"gallery": { "type": "media", "multiple": true, "allowedTypes": ["images", "videos"] }
```

| الخيار | الافتراضي | الوصف |
| --- | --- | --- |
| `multiple` | `false` | يحمل قائمة ملفات بدلًا من ملف واحد. |
| `allowedTypes` | أي ملف | أيٌّ من `images` و`videos` و`audios` و`files` (أي شيء آخر)، ويُتحقق منه في كل كتابة مقابل نوع MIME المخزّن. |

تتصرف حقول الوسائط مثل العلاقات: لكل نسخة من المستند روابطها الخاصة، والنشر
ينسخها، ويُتحقق من `required` عند النشر. تُخزَّن في جدول ربط لكل
حقل. داخل [المكوّنات](/ar/concepts/components-and-dynamic-zones/)، يخزّن JSON المكوّن
معرّفات الملفات بدلًا من ذلك.

عند الكتابة، أرسل معرّفات الملفات: `5`، أو `{ "id": 5 }`، أو `[5, 6]`، أو `null` لتفريغ الحقل. وعند
القراءة، لا تُعاد حقول الوسائط إلا عند تعبئتها (`populate=cover`)، ككائنات ملفات.
حذف ملف يزيله من كل مستند استخدمه.

## صيغ الصور

عند رفع صورة نقطية، يولّد Verdin صيغ Strapi بصيغة الصورة نفسها،
مع احترام اتجاه EXIF الخاص بها:

| الصيغة | الحجم |
| --- | --- |
| `thumbnail` | ضمن 245 × 156 |
| `large` | بعرض 1000 px |
| `medium` | بعرض 750 px |
| `small` | بعرض 500 px |

تُتخطّى الصيغة عندما لا يكون الأصل أكبر منها. يغيّر `[upload].breakpoints` العروض
والأسماء، ويوقفها `responsive_formats = false`. يصغّر `max_original_size` الأصول
الكبيرة عند الرفع، وهو ما يحذف أيضًا بياناتها الوصفية (EXIF، GPS).
ويرفض `max_image_megapixels` (100 افتراضيًا) الصور التي تستهلك ذاكرة كبيرة جدًا عند
فك ترميزها. مع الموفّر المحلي، يمكن لـ `/uploads` أيضًا تغيير حجم الصور وتحويلها عند الطلب؛
راجع [الصور](/ar/guides/frontend/images/).

## موفّرو التخزين

يخزّن الملفاتِ موفّرٌ، يُعيَّن في `[upload].provider`:

| الموفّر | يخزّن الملفات | يقدّمها |
| --- | --- | --- |
| `local` (الافتراضي) | في `public/uploads` (الخيار `dir`)، نسبةً إلى المشروع | على `/uploads` في خادم Verdin |
| `s3` | في أي حاوية متوافقة مع S3: AWS S3، Cloudflare R2، Backblaze B2، MinIO، RustFS… | من `public_url` الخاص بالحاوية أو بالـ CDN |

```toml title="verdin.toml"
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

تأتي بيانات اعتماد S3 من متغيرات البيئة القياسية `AWS_*`، لا من
`verdin.toml` أبدًا. كل خيار موجود في
[مرجع التهيئة](/ar/reference/configuration/).

الأسماء المخزّنة بالشكل `{slug}_{random}{ext}` ولا تتغير أبدًا، لذا يمكن تخزين عناوين URL مؤقتًا إلى الأبد.
مع عدة نسخ من Verdin، استخدم S3: الملفات المحلية موجودة فقط على النسخة التي
استقبلتها.

## الأمان

- تُبَث عمليات الرفع إلى ملفات مؤقتة، ولا تُحفظ في الذاكرة أبدًا، وتحدّها
  `[upload].max_file_size` (200 MB افتراضيًا)، مع 20 ملفًا على الأكثر لكل طلب.
- تحمل الملفات المقدَّمة من `/uploads` الترويستين `Content-Security-Policy: sandbox` و
  `X-Content-Type-Options: nosniff`. كل ما ليس صورة أو فيديو أو صوتًا أو PDF أو
  نصًا عاديًا يُرسل كتنزيل، فلا يستطيع ملف HTML أو SVG مرفوع تشغيل سكربتات على
  نطاقك. وتُخزَّن كائنات هذه الأنواع كتنزيلات على S3 أيضًا.

## الوسائط عبر API المحتوى

لدى API المحتوى مسارات الرفع الخاصة بـ Strapi، ويُتحقق منها مقابل الصلاحيات على **مكتبة الوسائط**
(`plugin::upload`):

| المسار | الصلاحية |
| --- | --- |
| `POST /api/upload` (multipart `files`، و`fileInfo` اختياري) | `create` |
| `POST /api/upload?id={id}` (`fileInfo` جديد، واختياريًا ملف جديد) | `update` |
| `GET /api/upload/files` | `find` |
| `GET /api/upload/files/{id}` | `findOne` |
| `DELETE /api/upload/files/{id}` | `delete` |

كما في Strapi، تجيب هذه المسارات بكائنات ومصفوفات ملفات عادية، دون غلاف `data`. راجع
[REST API](/ar/api/rest/#مكتبة-الوسائط). ترسل التغييرات أحداث `media.create` و`media.update` و
`media.delete` عبر [الـ webhook](/ar/api/webhooks/) و[الوقت الفعلي](/ar/api/realtime/).
