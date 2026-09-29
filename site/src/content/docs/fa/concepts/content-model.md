---
title: "مدل محتوا"
description: "Verdin چگونه محتوای شما را توصیف می‌کند: نوع‌های مجموعه‌ای و تکی، ویژگی‌ها، فایل‌های طرح‌واره در قالب Strapi و قواعد اعتبارسنجی."
sidebar:
  order: 1
---

مدل محتوا مجموعهٔ نوع‌های محتوا و کامپوننت‌هایی است که پروژهٔ شما تعریف می‌کند. Verdin همه‌چیز
دیگر را از آن به دست می‌آورد: جدول‌های پایگاه داده، APIهای REST و GraphQL، سند OpenAPI،
اعتبارسنجی و فرم‌های پنل مدیریت. این صفحه اجزا و قواعدی را که بر آن‌ها اعمال می‌شود توضیح
می‌دهد.

## نوع‌های محتوا

یک نوع محتوا یک گونه از سند را توصیف می‌کند، مانند یک مقاله یا یک صفحهٔ اصلی. هر نوع محتوا یک
`kind` دارد:

| گونه | نگه می‌دارد | مسیرهای REST (مثال وبلاگ) |
| --- | --- | --- |
| `collectionType` | هر تعداد سند | `/api/articles`، `/api/articles/{documentId}` |
| `singleType` | حداکثر یک سند | `/api/homepage` |

نوع‌های مجموعه‌ای در `pluralName` خود و نوع‌های تکی در `singularName` خود ارائه می‌شوند.
نخستین `PUT` به یک نوع تکی سند آن را می‌سازد. برای همهٔ مسیرها نگاه کنید به
[REST API](/fa/api/rest/).

هر نوع محتوا یک UID دارد، `api::<singularName>` (`api::article`). Strapi همین UID را به شکل
`api::article.article` می‌نویسد؛ Verdin این شکل را در فایل‌های طرح‌واره و در ابزار درون‌ریزی
می‌پذیرد و آن را به `api::article` یکسان‌سازی می‌کند.

هر سند فیلدهای سیستمی دارد که آن‌ها را تعریف نمی‌کنید: `id`، `documentId` (یک ULID با 26
نویسهٔ کوچک، پایدار در میان پیش‌نویس‌ها، نسخه‌های منتشرشده و زبان‌ها)، `createdAt`،
`updatedAt`، `publishedAt`، و `locale` در [نوع‌های بومی‌سازی‌شده](/fa/concepts/internationalization/).

## فایل‌های طرح‌واره

نوع‌های محتوا و کامپوننت‌ها فایل‌های JSON در پوشهٔ `schema/` پروژهٔ شما هستند
(`[schema].path` در `verdin.toml`). آن‌ها را مانند کد در git نسخه‌بندی می‌کنید.

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

قالب همان `schema.json` در Strapi است، بنابراین بیشتر طرح‌واره‌های Strapi بدون تغییر بارگذاری
می‌شوند. این نوع article از [مثال وبلاگ](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog)
است:

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

| کلید | الزامی | توضیح |
| --- | --- | --- |
| `kind` | بله | `collectionType` یا `singleType`. |
| `singularName` | بله | به شکل kebab-case. باید با نام فایل (`article.json`) یکی باشد. |
| `pluralName` | بله | به شکل kebab-case، متفاوت با `singularName`. |
| `displayName` | بله | نامی که پنل مدیریت نشان می‌دهد. |
| `description` | خیر | در پنل مدیریت نمایش داده می‌شود. |
| `collectionName` | خیر | نام جدول. پیش‌فرض آن `pluralName` به شکل snake_case است. |
| `options.draftAndPublish` | خیر | از هر سند یک پیش‌نویس و یک نسخهٔ منتشرشده نگه می‌دارد. پیش‌فرض `false` است. نگاه کنید به [پیش‌نویس و انتشار](/fa/concepts/draft-and-publish/). |
| `pluginOptions.i18n.localized` | خیر | یک نسخه برای هر زبان. پیش‌فرض `false` است. نگاه کنید به [بین‌المللی‌سازی](/fa/concepts/internationalization/). |
| `attributes` | خیر | فیلدها، به ترتیبی که API برمی‌گرداند. |
| `validations` | خیر | قواعد بین‌فیلدی؛ نگاه کنید به [پایین‌تر](#اعتبارسنجیهای-بینفیلدی). |

طرح‌واره‌ها سخت‌گیرند: یک کلید ناشناخته، گزینه‌ای که یک نوع پشتیبانی نمی‌کند، یا ارجاع به
نوع یا کامپوننتی که وجود ندارد، خطایی است که نام فایل و مسیر را اعلام می‌کند و سرور اجرا
نمی‌شود. برای اعتبارسنجی فایل‌ها بدون اجرای سرور، `verdin schema check` را اجرا کنید.

برخی نام‌ها رزرو شده‌اند:

- نام ویژگی‌ها با یک حرف شروع می‌شوند و بعد از آن حروف، ارقام و زیرخط می‌آیند، حداکثر 50
  نویسه. این نام‌ها به ستون‌هایی با شکل snake_case تبدیل می‌شوند (`metaTitle` → `meta_title`).
- `id`، `documentId`، `locale`، `publicationState`، `publishedAt`، `createdAt`،
  `updatedAt`، `createdBy` و `updatedBy` در نوع‌های محتوا رزرو شده‌اند، و `id` درون
  کامپوننت‌ها.
- `upload`، `uploads`، `auth`، `users` و `connect` نمی‌توانند `singularName` یا
  `pluralName` باشند: این مسیرها متعلق به API هستند.
- یک نوع محتوا حداکثر 60 ویژگی از نوع `string`، `email`، `uid` و `enumeration` دارد، تا ردیف‌ها
  در محدودهٔ اندازهٔ ردیف MySQL بمانند. برای برخی از آن‌ها از `text` استفاده کنید.

فایل‌ها را در **سازندهٔ نوع محتوا** در پنل مدیریت ویرایش می‌کنید، که وقتی سرور با `verdin dev`
اجرا می‌شود در دسترس است، یا به‌صورت دستی. در هر دو حالت، یک تغییر به یک
[مهاجرت طرح‌واره](/fa/concepts/schema-migrations/) تبدیل می‌شود. چیدمان ویرایشگر (ترتیب
فیلدها، عرض‌ها، برچسب‌ها) بخشی از طرح‌واره نیست: مدیران آن را در پنل پیکربندی می‌کنند و در
پایگاه داده ذخیره می‌شود.

## کامپوننت‌ها

کامپوننت یک گروه فیلد قابل‌استفادهٔ مجدد است، مانند `shared.seo` (یک عنوان متا و یک توضیح
متا). UID آن `<category>.<name>` است که از مسیرش گرفته می‌شود:
`schema/components/shared/seo.json` همان `shared.seo` است. فایل کامپوننت `displayName`،
`description` و `icon` اختیاری، و `attributes` دارد.

ناحیهٔ پویا (dynamic zone) فهرستی است که چند کامپوننت را با هم ترکیب می‌کند، مانند بدنهٔ مقاله‌ای
که از بلوک‌های hero و نقل‌قول ساخته شده است. هر دو به‌صورت JSON درون سند ذخیره می‌شوند؛ نگاه
کنید به [کامپوننت‌ها و ناحیه‌های پویا](/fa/concepts/components-and-dynamic-zones/).

## ویژگی‌ها

هر ویژگی یک `type` و گزینه‌هایی دارد که به آن بستگی دارند. فهرست کامل نوع‌ها، گزینه‌هایشان و
نوع ستونشان در هر پایگاه داده در [مرجع نوع‌های ویژگی](/fa/reference/attribute-types/) آمده است.

| دسته | نوع‌ها |
| --- | --- |
| متن | `string`، `text`، `richtext` (Markdown)، `blocks` (متن غنی ساخت‌یافتهٔ Strapi)، `email`، `uid`، `password`، `enumeration` |
| اعداد | `integer`، `biginteger`، `float`، `decimal` |
| تاریخ‌ها | `date`، `time`، `datetime` |
| دیگر اسکالرها | `boolean`، `json` |
| پیوندها | `relation` (نگاه کنید به [روابط](/fa/concepts/relations/))، `media` (نگاه کنید به [رسانه](/fa/concepts/media/)) |
| ساختار | `component`، `dynamiczone` |

گزینه‌های رایج:

| گزینه | اثر |
| --- | --- |
| `required` | مقدار باید هنگام انتشار یک نسخه تعیین شده باشد (یا در هر نوشتن، برای نوع‌های بدون پیش‌نویس و انتشار). پیش‌نویس‌ها می‌توانند ناقص باشند. |
| `private` | هرگز توسط content API برگردانده، فیلتر، مرتب یا populate نمی‌شود. ویژگی‌های `password` همیشه private هستند. |
| `default` | مقداری که وقتی یک سند جدید فیلد را حذف کند به کار می‌رود. با قواعد خودِ ویژگی بررسی می‌شود. |
| `unique` | هیچ دو سندی نمی‌توانند یک مقدار مشترک داشته باشند، به ازای هر زبان و نسخه. در نوع‌های `string`، `email`، عددی، تاریخ و زمان در دسترس است؛ `uid` همیشه یکتاست. |
| `configurable` | مقدار `false` ویژگی را در سازندهٔ نوع محتوا قفل می‌کند: آنجا نمی‌توان آن را ویرایش، تغییر نام یا حذف کرد. |
| `pluginOptions.i18n.localized` | مقدار `false` مقدار را میان زبان‌ها مشترک می‌کند. |

هر ستون ویژگی در پایگاه داده nullable است. مانند Strapi v5، `required` هنگام انتشار توسط
Verdin اعمال می‌شود، نه با قید `NOT NULL`، بنابراین افزودن یک ویژگی الزامی به نوعی که از قبل
ردیف دارد تغییری ایمن است.

## اعتبارسنجی

هر نوشتن پیش از رسیدن به پایگاه داده با طرح‌واره بررسی می‌شود:

- **نوع‌ها و قیدها**، در هر نوشتن: نوع مقدارها، `minLength`/`maxLength`، `min`/`max`،
  `regex`، مقدارهای `enum`، تعداد آیتم‌ها در کامپوننت‌های تکرارشونده و ناحیه‌های پویا،
  نوع‌های کامپوننتی که یک ناحیهٔ پویا مجاز می‌داند، و نوع‌های فایلی که یک فیلد رسانه می‌پذیرد.
  کلیدهای ناشناخته و فیلدهای سیستمی در ورودی خطا هستند.
- **فیلدهای الزامی و قواعد بین‌فیلدی**، هنگام انتشار یک نسخه، و در هر نوشتن برای نوع‌های
  بدون پیش‌نویس و انتشار. این‌ها درون کامپوننت‌ها و ناحیه‌های پویا هم اعمال می‌شوند.
- **یکتایی**، با ایندکس‌های یکتا در پایگاه داده، بنابراین دو نوشتن هم‌زمان نمی‌توانند هر دو
  موفق شوند.

یک بررسی ناموفق با `400` و یک `ValidationError` پاسخ می‌دهد که `details.errors` آن هر مشکل را
با مسیرش فهرست می‌کند، مانند `["seo", "metaTitle"]` یا `["blocks", 2, "text"]`. نگاه کنید به
[خطاها](/fa/api/rest/#خطاها).

### اعتبارسنجی‌های بین‌فیلدی

یک نوع محتوا می‌تواند قواعدی تعریف کند که فیلدهای خودش را با هم مقایسه می‌کنند و با
[JSON Logic](https://jsonlogic.com) نوشته می‌شوند. این نوع event الزام می‌کند که تاریخ پایان
بعد از تاریخ شروع باشد و تعداد بلیت‌های فروخته‌شده از تعداد صندلی‌ها بیشتر نشود:

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

- قاعده‌ای که برقرار نباشد یک خطای اعتبارسنجی با `message` است، روی `field` اگر داده شده
  باشد، یا روی سند (`path: []`).
- قواعد هر وقت `required` اجرا می‌شود اجرا می‌شوند: هنگام انتشار، و در هر نوشتن برای
  نوع‌های بدون پیش‌نویس و انتشار. پیش‌نویس‌ها می‌توانند آن‌ها را نقض کنند.
- `var` فیلدهای خودِ سند را می‌خواند، با مسیرهای نقطه‌دار برای ورود به کامپوننت‌ها. روابط و
  رسانه در دسترس قواعد نیستند.
- وقتی هر دو طرف عدد باشند مقایسه عددی است و وقتی هر دو رشته باشند متنی، بنابراین تاریخ‌ها،
  زمان‌ها و تاریخ‌وزمان‌های ISO درست مقایسه می‌شوند. یک فیلد خالی `null` است: از فیلدهای
  اختیاری محافظت کنید، همان‌طور که قاعدهٔ اول این کار را می‌کند.
- عملگرهای مجاز: `var`، `==`، `!=`، `===`، `!==`، `<`، `>`، `<=`، `>=`، `!`، `!!`، `and`،
  `or`، `in`، `if`، `?:`، `+`، `-`، `*`، `/`، `%`، `min`، `max`، `cat`. یک عملگر ناشناخته،
  یک `field` ناشناخته یا یک `message` خالی خطای طرح‌واره است.

سرور قواعد را بررسی می‌کند؛ وقتی انتشار ناموفق باشد، پنل مدیریت پیام‌هایشان را روی فیلدهایی
که نام می‌برند نشان می‌دهد. Strapi معادلی برای این ندارد. فیلدهای شرطی Strapi (`conditions`)
در فایل‌های طرح‌واره پذیرفته و نگه داشته می‌شوند، اما هنوز اعمال نمی‌شوند.
