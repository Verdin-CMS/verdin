---
title: "نموذج المحتوى"
description: "كيف يصف Verdin محتواك: أنواع المجموعات والأنواع المفردة، والسمات، وملفات المخطط بصيغة Strapi، وقواعد التحقق."
sidebar:
  order: 1
---

نموذج المحتوى هو مجموعة أنواع المحتوى والمكوّنات التي يعرّفها مشروعك. يشتق Verdin
كل شيء آخر منه: جداول قاعدة البيانات، وواجهات REST وGraphQL، ومستند
OpenAPI، والتحقق، ونماذج لوحة الإدارة. تشرح هذه الصفحة الأجزاء
والقواعد التي تنطبق عليها.

## أنواع المحتوى

يصف نوع المحتوى نوعًا واحدًا من المستندات، مثل مقالة أو صفحة رئيسية. وله
`kind`:

| النوع | يحتوي على | مسارات REST (مثال المدونة) |
| --- | --- | --- |
| `collectionType` | أي عدد من المستندات | `/api/articles`، `/api/articles/{documentId}` |
| `singleType` | مستند واحد على الأكثر | `/api/homepage` |

تُقدَّم أنواع المجموعات على `pluralName` الخاص بها، والأنواع المفردة على `singularName`.
أول `PUT` إلى نوع مفرد ينشئ مستنده. راجع [REST API](/ar/api/rest/) للاطلاع على
كل المسارات.

لكل نوع محتوى UID، هو `api::<singularName>` (`api::article`). يكتب Strapi
الـ UID نفسه على شكل `api::article.article`؛ ويقبل Verdin هذه الصيغة في ملفات المخطط وفي
أداة الاستيراد، ويوحّدها إلى `api::article`.

لكل مستند حقول نظام لا تعلنها أنت: `id`، و`documentId` (معرّف ULID من 26 حرفًا
صغيرًا، ثابت عبر المسودات والنسخ المنشورة واللغات)، و`createdAt`،
و`updatedAt`، و`publishedAt`، و`locale` في [الأنواع المترجمة](/ar/concepts/internationalization/).

## ملفات المخطط

أنواع المحتوى والمكوّنات ملفات JSON في مجلد `schema/` في مشروعك
(`[schema].path` في `verdin.toml`). تضعها تحت إدارة الإصدارات في git مثل الشيفرة.

```
schema/
├── content-types/
│   ├── article.json
│   ├── category.json
│   ├── tag.json
│   └── homepage.json
└── components/
    ├── blocks/
    │   ├── hero.json
    │   └── quote.json
    └── shared/
        └── seo.json
```

الصيغة هي `schema.json` الخاصة بـ Strapi، لذا تُحمَّل معظم مخططات Strapi دون تغيير. هذا
نوع المقالة في [مثال المدونة](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog):

```json title="schema/content-types/article.json"
{
  "kind": "collectionType",
  "singularName": "article",
  "pluralName": "articles",
  "displayName": "Article",
  "options": { "draftAndPublish": true },
  "attributes": {
    "title": { "type": "string", "required": true, "maxLength": 200 },
    "slug": { "type": "uid", "targetField": "title", "required": true },
    "excerpt": { "type": "text", "maxLength": 500 },
    "body": { "type": "richtext" },
    "readingTime": { "type": "integer", "min": 0 },
    "featured": { "type": "boolean", "default": false },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "tags": { "type": "relation", "relation": "manyToMany", "target": "tag" },
    "seo": { "type": "component", "component": "shared.seo" },
    "blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"] }
  }
}
```

| المفتاح | مطلوب | الوصف |
| --- | --- | --- |
| `kind` | نعم | `collectionType` أو `singleType`. |
| `singularName` | نعم | بصيغة kebab-case. يجب أن يطابق اسم الملف (`article.json`). |
| `pluralName` | نعم | بصيغة kebab-case، ومختلف عن `singularName`. |
| `displayName` | نعم | الاسم الذي تعرضه لوحة الإدارة. |
| `description` | لا | يُعرض في لوحة الإدارة. |
| `collectionName` | لا | اسم الجدول. افتراضيًا `pluralName` بصيغة snake_case. |
| `options.draftAndPublish` | لا | الاحتفاظ بمسودة ونسخة منشورة لكل مستند. افتراضيًا `false`. راجع [المسودة والنشر](/ar/concepts/draft-and-publish/). |
| `pluginOptions.i18n.localized` | لا | نسخة واحدة لكل لغة. افتراضيًا `false`. راجع [التدويل](/ar/concepts/internationalization/). |
| `attributes` | لا | الحقول، بالترتيب الذي يعيدها به الـ API. |
| `validations` | لا | قواعد عبر الحقول؛ راجع [أدناه](#التحقق-عبر-الحقول). |

المخططات صارمة: المفتاح غير المعروف، أو الخيار الذي لا يدعمه نوع ما، أو الإشارة إلى
نوع أو مكوّن مفقود، خطأ يسمّي الملف والمسار، ولا يبدأ الخادم.
شغّل `verdin schema check` للتحقق من الملفات دون تشغيله.

بعض الأسماء محجوزة:

- تبدأ أسماء السمات بحرف، ثم أحرف وأرقام وشرطات سفلية، بحد أقصى 50
  حرفًا. وتصبح أعمدة بصيغة snake_case (`metaTitle` ← `meta_title`).
- `id` و`documentId` و`locale` و`publicationState` و`publishedAt` و`createdAt`
  و`updatedAt` و`createdBy` و`updatedBy` محجوزة في أنواع المحتوى، و`id` داخل
  المكوّنات.
- لا يمكن أن تكون `upload` و`uploads` و`auth` و`users` و`connect` قيمة لـ `singularName` أو
  `pluralName`: فتلك المسارات تخص الـ API.
- لنوع المحتوى 60 سمة على الأكثر من الأنواع `string` و`email` و`uid` و`enumeration`، ما
  يبقي الصفوف ضمن حد حجم الصف في MySQL. استخدم `text` لبعضها.

تحرّر الملفات في **منشئ أنواع المحتوى** في لوحة الإدارة، المتاح ما دام الخادم يعمل
بـ `verdin dev`، أو يدويًا. في الحالتين، يصبح التغيير
[ترحيلًا للمخطط](/ar/concepts/schema-migrations/). تخطيط المحرر (ترتيب الحقول، والعروض،
والتسميات) ليس جزءًا من المخطط: يضبطه المسؤولون في اللوحة، ويُخزَّن في
قاعدة البيانات.

## المكوّنات

المكوّن مجموعة حقول قابلة لإعادة الاستخدام، مثل `shared.seo` (عنوان وصفي ووصف
وصفي). الـ UID الخاص به هو `<category>.<name>`، مأخوذ من مساره:
`schema/components/shared/seo.json` هو `shared.seo`. لملف المكوّن `displayName`،
و`description` و`icon` اختياريان، و`attributes`.

المنطقة الديناميكية قائمة تمزج عدة مكوّنات، مثل جسم مقالة مكوّن من
كتل hero واقتباسات. يُخزَّن كلاهما داخل المستند بصيغة JSON؛ راجع
[المكوّنات والمناطق الديناميكية](/ar/concepts/components-and-dynamic-zones/).

## السمات

لكل سمة `type` وخيارات تعتمد عليه. القائمة الكاملة للأنواع وخياراتها
وأنواع أعمدتها لكل قاعدة بيانات موجودة في
[مرجع أنواع السمات](/ar/reference/attribute-types/).

| الفئة | الأنواع |
| --- | --- |
| النص | `string`، `text`، `richtext` (Markdown)، `blocks` (النص المنسّق المهيكل في Strapi)، `email`، `uid`، `password`، `enumeration` |
| الأرقام | `integer`، `biginteger`، `float`، `decimal` |
| التواريخ | `date`، `time`، `datetime` |
| قيم بسيطة أخرى | `boolean`، `json` |
| الروابط | `relation` (راجع [العلاقات](/ar/concepts/relations/))، `media` (راجع [الوسائط](/ar/concepts/media/)) |
| البنية | `component`، `dynamiczone` |

الخيارات الشائعة:

| الخيار | الأثر |
| --- | --- |
| `required` | يجب تعيين القيمة عند نشر نسخة (أو في كل كتابة، للأنواع التي لا تستخدم المسودة والنشر). يمكن أن تكون المسودات غير مكتملة. |
| `private` | لا يعيده API المحتوى أبدًا، ولا يصفّيه ولا يرتّبه ولا يعبّئه. سمات `password` خاصة دائمًا. |
| `default` | القيمة المستخدمة عندما يُغفل مستند جديد الحقل. يُتحقق منها مقابل قواعد السمة نفسها. |
| `unique` | لا يجوز لمستندين أن يتشاركا القيمة، لكل لغة ونسخة. متاح في `string` و`email` وأنواع الأرقام والتاريخ والوقت؛ و`uid` فريد دائمًا. |
| `configurable` | `false` تقفل السمة في منشئ أنواع المحتوى: لا يمكن تحريرها أو إعادة تسميتها أو حذفها هناك. |
| `pluginOptions.i18n.localized` | `false` تشارك القيمة عبر اللغات. |

كل عمود سمة يقبل القيمة الفارغة (nullable) في قاعدة البيانات. كما في Strapi v5، يفرض Verdin
`required` عند النشر، لا عبر قيد `NOT NULL`، لذا فإن إضافة سمة مطلوبة إلى
نوع يحتوي على صفوف بالفعل تغيير آمن.

## التحقق

يُتحقق من كل عملية كتابة مقابل المخطط قبل أن يصل أي شيء إلى قاعدة البيانات:

- **الأنواع والقيود**، في كل كتابة: أنواع القيم، و`minLength`/`maxLength`، و`min`/`max`،
  و`regex`، وقيم `enum`، وعدد العناصر في المكوّنات القابلة للتكرار والمناطق الديناميكية،
  وأنواع المكوّنات التي تسمح بها المنطقة الديناميكية، وأنواع الملفات التي يقبلها حقل الوسائط.
  المفاتيح غير المعروفة وحقول النظام في المدخلات أخطاء.
- **الحقول المطلوبة والقواعد عبر الحقول**، عند نشر نسخة، وفي كل كتابة
  للأنواع التي لا تستخدم المسودة والنشر. وتنطبق أيضًا داخل المكوّنات والمناطق الديناميكية.
- **التفرّد**، عبر فهارس فريدة في قاعدة البيانات، فلا يمكن لعمليتي كتابة متزامنتين أن
  تنجحا معًا.

الفحص الفاشل يجيب بـ `400` مع `ValidationError` يسرد `details.errors` فيه كل
مشكلة مع مسارها، مثل `["seo", "metaTitle"]` أو `["blocks", 2, "text"]`. راجع
[الأخطاء](/ar/api/rest/#الأخطاء).

### التحقق عبر الحقول

يمكن لنوع المحتوى أن يعلن قواعد تقارن بين حقوله، مكتوبة بـ
[JSON Logic](https://jsonlogic.com). يشترط نوع الحدث هذا أن يلي تاريخُ النهاية تاريخَ
البداية، ويحدّ التذاكر المبيعة بعدد المقاعد:

```json title="schema/content-types/event.json"
{
  "kind": "collectionType",
  "singularName": "event",
  "pluralName": "events",
  "displayName": "Event",
  "attributes": {
    "startDate": { "type": "date", "required": true },
    "endDate": { "type": "date" },
    "seats": { "type": "integer", "min": 0 },
    "sold": { "type": "integer", "min": 0 }
  },
  "validations": [
    {
      "rule": { "or": [{ "!": { "var": "endDate" } }, { "<=": [{ "var": "startDate" }, { "var": "endDate" }] }] },
      "message": "must be after the start date",
      "field": "endDate"
    },
    { "rule": { "<=": [{ "var": "sold" }, { "var": "seats" }] }, "message": "more tickets sold than seats" }
  ]
}
```

- القاعدة التي لا تتحقق خطأ تحقق يحمل `message`، عند `field` إن وُجد، أو
  على مستوى المستند (`path: []`).
- تُنفَّذ القواعد عندما يُنفَّذ `required`: عند النشر، وفي كل كتابة للأنواع التي لا تستخدم المسودة
  والنشر. يمكن للمسودات أن تخالفها.
- يقرأ `var` حقول المستند نفسه، مع مسارات منقّطة داخل المكوّنات. العلاقات
  والوسائط غير متاحة للقواعد.
- تكون المقارنات رقمية عندما يكون الطرفان رقمين، ونصية عندما يكونان سلسلتين، لذا
  تُقارن تواريخ ISO والأوقات والتاريخ والوقت بشكل صحيح. الحقل الفارغ هو `null`: احمِ الحقول
  الاختيارية، كما تفعل القاعدة الأولى.
- العوامل المسموح بها: `var`، `==`، `!=`، `===`، `!==`، `<`، `>`، `<=`، `>=`، `!`، `!!`، `and`،
  `or`، `in`، `if`، `?:`، `+`، `-`، `*`، `/`، `%`، `min`، `max`، `cat`. العامل غير المعروف،
  أو `field` غير المعروف، أو `message` الفارغ، خطأ في المخطط.

يتحقق الخادم من القواعد؛ وتعرض لوحة الإدارة رسائلها على الحقول التي تسمّيها
عندما يفشل النشر. لا مقابل لذلك في Strapi. تُقبل الحقول الشرطية في Strapi (`conditions`)
في ملفات المخطط ويُحتفظ بها، لكنها لا تُطبَّق بعد.
