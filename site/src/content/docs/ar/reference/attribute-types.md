---
title: مرجع أنواع السمات
description: كل نوع سمة في ملف مخطط Verdin، مع خياراته، والتحقق منه، وتخزينه في قاعدة البيانات، وتمثيله في الـ API.
sidebar:
  order: 4
  label: أنواع السمات
---

<!-- Written from crates/verdin-schema (convert.rs, validate.rs, model.rs),
crates/verdin-migrate/src/derive.rs and sql.rs (storage), and crates/verdin-content
(input.rs, output.rs, blocks.rs) (API). -->

السمات هي حقول نوع المحتوى أو المكوّن، وتُعلن تحت `attributes` في
ملف مخططه. تسرد هذه الصفحة كل `type`، والخيارات التي يقبلها، وكيف يتحقق منه Verdin
ويخزّنه، وكيف يبدو في الـ API. الصيغة هي صيغة Strapi v5؛ والاختلافات
مسرودة [في النهاية](#الاختلافات-عن-strapi).

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
    "readingTime": { "type": "integer", "min": 0 },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "seo": { "type": "component", "component": "shared.seo" }
  }
}
```

ملفات المخطط صارمة: المفتاح غير المعروف، أو الخيار الذي لا يأخذه النوع، خطأ
يبلّغ عنه `verdin schema check` مع مساره (`attributes.title.maxLength`).

## الخيارات التي تأخذها كل سمة

| الخيار | الافتراضي | الوصف |
| --- | --- | --- |
| `type` | مطلوب | أحد الأنواع أدناه. |
| `required` | `false` | يجب وجود قيمة. يُتحقق منه عند نشر إدخال (يمكن أن تكون المسودات غير مكتملة)، وفي كل كتابة لنوع لا يستخدم المسودة والنشر. وينطبق داخل المكوّنات والمناطق الديناميكية أيضًا. |
| `private` | `false` | لا يعيده API المحتوى أبدًا، ولا يمكن استخدامه في `filters` أو `sort`. سمات `password` خاصة دائمًا. |
| `configurable` | `true` | علامة Strapi لمنشئ لوحة الإدارة؛ يُحتفظ بها كما كُتبت. |
| `pluginOptions.i18n.localized` | `true` | في نوع محتوى مترجم، `false` تشارك القيمة عبر اللغات بدلًا من قيمة لكل لغة. |
| `customField` | غير معيَّن | `plugin::<plugin>.<field>` (أو `global::<field>`): تحرّر لوحة الإدارة السمة بحقل مخصص من إضافة. ويحدد `type` كيفية تخزين القيمة. راجع [الإضافات](/ar/extending/plugins/). |
| `conditions` | غير معيَّن | الحقول الشرطية في Strapi (`{ "visible": <JSON Logic> }`). يُخفي المحرّر الحقل ما دامت القاعدة خاطئة، ولا يشترط الخادم تعبئة الحقل المخفي. |
| `default` | غير معيَّن | قيمة الإدخالات الجديدة عندما تُغفل الكتابة السمة. يجب أن تكون صالحة للنوع. لا يأخذها كل نوع (راجع كل نوع). |

تبدأ أسماء السمات بحرف، ثم أحرف وأرقام و`_`، بحد أقصى 50 حرفًا.
في أنواع المحتوى، `id` و`documentId` و`locale` و`publicationState` و`publishedAt` و
`createdAt` و`updatedAt` و`createdBy` و`updatedBy` محجوزة؛ وفي المكوّنات، `id`.
الاسمان اللذان يقابلان العمود نفسه (`metaTitle` و`meta_title`) خطأ.

### أين تُخزَّن القيم

كل سمة من نوع محتوى عمود في جدول النوع (`collectionName`، أو
الاسم الجمع)، مسمّى بصيغة `snake_case`. أما العلاقات والوسائط فتعيش في جداول ربط بدلًا من ذلك.
المسودة ونسختها المنشورة صفّان، واحد لكل لغة في الأنواع المترجمة.

أنواع الأعمدة لكل قاعدة بيانات:

| العمود | PostgreSQL | MySQL وMariaDB | SQLite |
| --- | --- | --- | --- |
| varchar | `varchar(255)` | `varchar(255)` | `text` |
| text | `text` | `longtext` | `text` |
| integer | `integer` | `int` | `integer` |
| bigint | `bigint` | `bigint` | `integer` |
| double | `double precision` | `double` | `real` |
| decimal | `numeric(p,s)` | `decimal(p,s)` | `text` (دقيق) |
| boolean | `boolean` | `tinyint(1)` | `integer` |
| date | `date` | `date` | `text` |
| time | `time(3)` | `time(3)` | `text` |
| datetime | `timestamptz(3)` | `datetime(3)` | `text` |
| json | `jsonb` | `json` | `text` |

يمكن أن يكون لنوع المحتوى 60 سمة على الأكثر من `string` و`email` و`uid` و`enumeration`
(حد حجم الصف في MySQL)؛ استخدم `text` للمزيد.

### `unique`

الأنواع التي تأخذ `unique: true` تحصل على فهرس فريد على `(column, locale, publication_state)`:
لا يمكن لإدخالين منشورين، أو مسودتين، في اللغة نفسها مشاركة قيمة، بينما يمكن لـ
مسودة ونسختها المنشورة ذلك. الكتابة التي تخالفه تفشل بخطأ تحقق
على السمة. داخل المكوّنات، يُقبل `unique` لكنه لا يُفرض
(تُخزَّن قيم المكوّنات بصيغة JSON).

## النص

### `string`

سطر واحد من النص.

| الخيار | الوصف |
| --- | --- |
| `minLength`، `maxLength` | حدود الطول بالمحارف. `maxLength` لا يتجاوز 255. |
| `regex` | نمط يجب أن تطابقه القيمة. صيغة شبيهة بـ JavaScript، بما في ذلك look-around والمراجع الخلفية. |
| `unique` | راجع [`unique`](#unique). |
| `default` | سلسلة نصية ضمن الحدود تطابق `regex`. |

يُخزَّن كـ `varchar(255)`. الـ API: سلسلة نصية.

### `text`

نص عادي أطول (textarea في لوحة الإدارة).

| الخيار | الوصف |
| --- | --- |
| `minLength`، `maxLength` | حدود الطول، بلا حد أعلى. |
| `default` | سلسلة نصية ضمن الحدود. |

يُخزَّن كـ `text` (`longtext` في MySQL). الـ API: سلسلة نصية.

### `richtext`

نص Markdown. الخيارات والتخزين والـ API نفسها التي لـ `text`؛ وتحرّره لوحة الإدارة بمحرر
Markdown.

### `blocks`

نص منسّق بصيغة JSON للكتل في Strapi: قائمة من كتل `paragraph`، و`heading` (`level` من 1 إلى 6)،
و`list` (`format` ‏`ordered` أو `unordered`، مع أبناء `list-item`، متداخلة حتى 8
مستويات)، و`quote`، و`code` (`language` اختياري) و`image`. الأبناء المضمّنون
عُقد `text`، مع العلامات `bold` و`italic` و`underline` و`strikethrough` و`code`،
وعُقد `link`. 10,000 كتلة على الأكثر.

بلا خيارات، وبلا `default`. يُخزَّن كـ JSON. الـ API: قائمة الكتل، كما كُتبت.

```json
[
  { "type": "heading", "level": 2, "children": [{ "type": "text", "text": "Hello" }] },
  { "type": "paragraph", "children": [{ "type": "text", "text": "bold", "bold": true }] }
]
```

### `email`

عنوان بريد إلكتروني (`name@domain.tld`، بلا مسافات).

| الخيار | الوصف |
| --- | --- |
| `minLength`، `maxLength` | حدود الطول؛ و`maxLength` لا يتجاوز 255. |
| `unique` | راجع [`unique`](#unique). |
| `default` | عنوان بريد إلكتروني. |

يُخزَّن كـ `varchar(255)`. الـ API: سلسلة نصية.

### `password`

سرّ، يُجزَّأ عند الكتابة بـ Argon2id.

| الخيار | الوصف |
| --- | --- |
| `minLength`، `maxLength` | حدود طول كلمة المرور كما أُرسلت. |

بلا `default`. خاص دائمًا: لا يُعاد ولا يُصفّى ولا يُرتَّب أبدًا. غير مسموح داخل
المكوّنات. يُخزَّن كـ `varchar(255)` (التجزئة). تحتفظ عمليات الاستيراد بتجزئات bcrypt وArgon2
الموجودة كما هي، فتستطيع الحسابات المستوردة تسجيل الدخول.

### `uid`

معرّف لعناوين URL، مثل slug. تولّده لوحة الإدارة من `targetField`.

| الخيار | الوصف |
| --- | --- |
| `targetField` | سمة `string` أو `text` من النوع نفسه لتوليد القيمة منها. |
| `minLength`، `maxLength` | حدود الطول؛ و`maxLength` لا يتجاوز 255. |
| `regex` | النمط الذي يجب أن تطابقه القيم؛ وبدونه، `^[A-Za-z0-9\-_.~]*$`. |
| `default` | قيمة صالحة. |

فريد دائمًا (راجع [`unique`](#unique)). يُخزَّن كـ `varchar(255)`. الـ API: سلسلة نصية.

### `enumeration`

قيمة واحدة من قائمة ثابتة.

| الخيار | الوصف |
| --- | --- |
| `enum` | القيم: واحدة على الأقل، كل منها من 1 إلى 255 حرفًا، بلا تكرار. |
| `default` | إحدى القيم. |

يُخزَّن كـ `varchar(255)`. الـ API: سلسلة نصية. تفشل الكتابة بأي قيمة أخرى.

## الأرقام

### `integer`

عدد صحيح من 32 بت (من −2,147,483,648 إلى 2,147,483,647).

| الخيار | الوصف |
| --- | --- |
| `min`، `max` | الحدود (أعداد صحيحة). |
| `unique` | راجع [`unique`](#unique). |
| `default` | عدد صحيح ضمن الحدود. |

يُخزَّن كـ `integer`. الـ API: رقم. تقبل الكتابة الأرقام والسلاسل النصية للأعداد الصحيحة.

### `biginteger`

عدد صحيح من 64 بت. الخيارات نفسها التي لـ `integer`.

يُخزَّن كـ `bigint`. الـ API: سلسلة نصية (`"9007199254740993"`)، كما في Strapi، لأن أرقام JavaScript
تفقد الدقة بعد 2⁵³. تقبل الكتابة السلاسل النصية والأرقام.

### `float`

رقم عشري بفاصلة عائمة مزدوج الدقة. الخيارات نفسها التي لـ `integer`، بحدود رقمية.

يُخزَّن كـ `double precision` (`double`، `real`). الـ API: رقم.

### `decimal`

رقم عشري دقيق.

| الخيار | الافتراضي | الوصف |
| --- | --- | --- |
| `precision` | `10` | إجمالي الأرقام، من 1 إلى 38. |
| `scale` | `2` | الأرقام بعد الفاصلة العشرية، بحد أقصى `precision`. |
| `min`، `max` | | الحدود. |
| `unique` | | راجع [`unique`](#unique). |
| `default` | | رقم ضمن الحدود. |

تُقرَّب القيم إلى `scale` رقمًا (نصف بعيدًا عن الصفر، كما تفعل قواعد البيانات)، و
تُرفض عندما يكون لها أكثر من `precision - scale` رقمًا قبل الفاصلة. تقبل الكتابة
الأرقام والسلاسل الرقمية. يُخزَّن كـ `numeric(precision,scale)` (`text` في
SQLite، فلا يُقرَّب شيء). الـ API: رقم، كما يعيده Strapi. القيم الصحيحة
أعداد صحيحة (`25` لا `25.0`)، وغيرها أقصر عدد عشري يُقرأ بالقيمة نفسها
(`12.5`). ومع [`[api].decimal_as_string`](/ar/reference/configuration/) يعيد الـ API
سلسلة نصية دقيقة بدلًا من ذلك.

## التواريخ والقيم المنطقية

### `boolean`

`true` أو `false`. يأخذ `default`. يُخزَّن كـ `boolean` (`tinyint(1)`، `integer`). الـ API:
قيمة منطقية.

### `date`

تاريخ تقويمي، `YYYY-MM-DD`. يأخذ `unique` و`default`. يُخزَّن كـ `date`. الـ API:
`"2026-09-29"`.

### `time`

وقت من اليوم، `HH:MM` أو `HH:MM:SS` أو `HH:MM:SS.mmm`. يأخذ `unique` و`default`. يُخزَّن
بدقة المللي ثانية. الـ API: `"14:30:00.000"`.

### `datetime`

لحظة زمنية: طابع زمني ISO 8601 مع منطقة (`Z` أو `+02:00`). يأخذ `unique` و
`default`. يُخزَّن بتوقيت UTC بدقة المللي ثانية. الـ API: `"2026-09-29T12:30:00.000Z"`.

## `json`

أي قيمة JSON. يأخذ `default` (أي JSON). يُخزَّن كـ `jsonb` (`json`، `text`). الـ API: القيمة
كما كُتبت. في `filters`، لا تدعم سمات JSON إلا `$null` و`$notNull`، و
لا يمكن الترتيب حسبها.

## الوسائط

### `media`

ملفات من مكتبة الوسائط.

| الخيار | الافتراضي | الوصف |
| --- | --- | --- |
| `multiple` | `false` | يحمل قائمة ملفات بدلًا من ملف واحد. |
| `allowedTypes` | أي نوع | أنواع الملفات: `images`، `videos`، `audios`، `files` (أي شيء آخر). |

بلا `default`. يُخزَّن في جدول ربط `{table}_{attribute}_mda`، بالترتيب. تأخذ الكتابة
معرّفات الملفات: `12`، أو `{ "id": 12 }`، أو قائمة منها، أو `null`. الـ API: مع `populate` فقط؛ كائن
ملف (`url`، `mime`، `width`، `formats`…، كما في Strapi)، أو قائمة منها، أو `null`. راجع
[الوسائط](/ar/concepts/media/).

## العلاقات

### `relation`

روابط إلى مستندات نوع محتوى آخر.

| الخيار | الوصف |
| --- | --- |
| `relation` | `oneToOne`، `oneToMany`، `manyToOne`، `manyToMany`، `oneWay`، `manyWay`، أو نوع متعدد الأشكال (أدناه). |
| `target` | نوع المحتوى الهدف: `article` أو `api::article` أو `api::article.article`. |
| `inversedBy` | على الجانب المالك لعلاقة ثنائية الاتجاه: سمة الهدف التي تعكسها. |
| `mappedBy` | على الجانب الآخر: السمة المالكة في الهدف. |

يجب أن يتوافق جانبا العلاقة ثنائية الاتجاه: `oneToMany` يعكس `manyToOne`،
و`oneToOne` و`manyToMany` يعكسان نفسيهما، ويسمّي جانب `mappedBy` سمة
يشير `inversedBy` فيها إليه. ليس لـ `oneWay` و`manyWay` جانب آخر.

تُخزَّن الروابط في `{table}_{attribute}_lnk` على الجانب المالك (الجانب الذي لا يحمل
`mappedBy`)، مشيرة إلى `documentId` الخاص بالهدف، بالترتيب. تأخذ الكتابة قيم `documentId`:

| الكتابة | المعنى |
| --- | --- |
| `"d8f3…"`، `{ "documentId": "d8f3…" }`، قائمة منها | استبدال الروابط. |
| `null` أو `[]` | إزالة كل الروابط. |
| `{ "set": [...] }` | استبدال الروابط. |
| `{ "connect": [...], "disconnect": [...] }` | إضافة روابط وإزالتها. يمكن لعنصر `connect` أن يحمل `position`: `{ "before": id }`، أو `{ "after": id }`، أو `{ "start": true }` أو `{ "end": true }`. |

الـ API: مع `populate` فقط، كمستندات مرتبطة (1,000 على الأكثر لكل إدخال و
علاقة)، أو `{ "count": n }` مع `populate[tags][count]=true`. راجع
[العلاقات](/ar/concepts/relations/).

داخل المكوّنات، لا يُسمح إلا بـ `oneWay` و`manyWay`؛ ويخزّن المكوّن
قيم `documentId`.

### العلاقات متعددة الأشكال

يأخذ `relation` أيضًا الأنواع متعددة الأشكال، التي تربط مستندات من أي نوع محتوى:

| `relation` | الخيارات | الوصف |
| --- | --- | --- |
| `morphToOne` | لا شيء | يربط مستندًا واحدًا من أي نوع. |
| `morphToMany` | لا شيء | يربط مستندات من أي أنواع. |
| `morphOne` | `target`، `morphBy` | جانب عكسي: يقرأ روابط السمة `morphBy` من نوع `morphToOne` أو `morphToMany` في `target`. |
| `morphMany` | `target`، `morphBy` | نفسه، للمتعدد. |

يخزّن المالكون أزواج `(type, documentId)` في `{table}_{attribute}_mph`. تأخذ الكتابة
عناصر `{ "__type": "api::article", "documentId": "…" }` (واحدًا، أو قائمة، أو `null` أو
`{ "set": [...] }`). تحمل العناصر المُعبّأة نوعها في `__type`. غير مسموح داخل
المكوّنات.

## المكوّنات والمناطق الديناميكية

### `component`

مجموعة حقول معرّفة في `schema/components/<category>/<name>.json`.

| الخيار | الافتراضي | الوصف |
| --- | --- | --- |
| `component` | مطلوب | uid المكوّن، `category.name` (`shared.seo`). |
| `repeatable` | `false` | يحمل قائمة عناصر بدلًا من عنصر واحد. |
| `min`، `max` | | عدد العناصر؛ مع `repeatable` فقط. |

بلا `default`: تحصل العناصر الجديدة على القيم الافتراضية لسماتها الخاصة. يُخزَّن كـ JSON في
صف الإدخال، ولكل عنصر `id`. تأخذ الكتابة كائن العنصر (أو قائمة)، مع `id`
للإبقاء على عنصر موجود. الـ API: مع `populate` فقط، العنصر أو القائمة كاملة. في
`filters`، يمكنك التصفية على حقول مكوّن
(`filters[seo][metaTitle][$eq]=…`). راجع
[المكوّنات والمناطق الديناميكية](/ar/concepts/components-and-dynamic-zones/).

### `dynamiczone`

قائمة عناصر، كل منها أحد عدة مكوّنات.

| الخيار | الوصف |
| --- | --- |
| `components` | قيم uid المكوّنات المسموح بها: واحدة على الأقل، بلا تكرار. |
| `min`، `max` | عدد العناصر. |

يحمل كل عنصر `__component` مع الـ uid الخاص به. يُخزَّن كـ JSON في صف الإدخال. الـ API:
مع `populate` فقط، القائمة كاملة. صفِّ حسب المكوّن بـ
`filters[blocks][__component][$eq]=blocks.hero`. لا يمكن أن تتداخل المناطق الديناميكية داخل
المكوّنات.

## التحقق عبر الحقول

إلى جانب خيارات كل سمة، يمكن لنوع المحتوى أن يعلن قواعد على عدة حقول في
`validations`، يُتحقق منها كلما يُتحقق من `required`:

```json
"validations": [
  {
    "rule": { "<=": [{ "var": "startDate" }, { "var": "endDate" }] },
    "message": "The end date must be after the start date",
    "field": "endDate"
  }
]
```

`rule` تعبير JSON Logic على الإدخال يجب أن يتحقق. يمكنه استخدام `var` و`==` و
`!=` و`===` و`!==` و`<` و`>` و`<=` و`>=` و`!` و`!!` و`and` و`or` و`in` و`if` و`?:` و`+` و`-` و
`*` و`/` و`%` و`min` و`max` و`cat`. يُبلَّغ عن `message` عند `field` (سمة من
النوع) أو على مستوى الإدخال. هذه إضافة من Verdin؛ لا مقابل لها في Strapi.

## الاختلافات عن Strapi

- **تُخزَّن المكوّنات بصيغة JSON** في صف الإدخال، لا في جداول مكوّنات مع جداول
  ربط. لا تحتاج القراءات إلى عمليات join؛ ونتيجةً لذلك، لا يمكن أن تكون سمات `password` والعلاقات
  متعددة الأشكال والعلاقات ثنائية الاتجاه داخل المكوّنات، ولا يُفرض `unique`
  هناك.
- **تعود المكوّنات المُعبّأة كاملة.** يعيد `populate` على مكوّن أو منطقة ديناميكية
  كل حقوله؛ ولا يمكنك اختيار حقول متداخلة كما في Strapi.
- **ملفات مخطط صارمة.** المفاتيح غير المعروفة والخيارات التي لا يأخذها النوع أخطاء، بينما
  يتجاهلها Strapi. في `pluginOptions`، لا يُقرأ إلا `i18n.localized`؛ ويُتجاهل الباقي.
- **`string` و`email` و`uid` محدودة بـ 255 حرفًا**، وهو حجم العمود، بدلًا
  من الفشل في قاعدة البيانات.
- **`conditions`** (الحقول الشرطية) تعمل كما في Strapi 5.17: الحقول المخفية غير مطلوبة.
- **`validations`** خاصة بـ Verdin.
- الباقي يطابق Strapi v5: أسماء الأنواع، وخياراتها، وقيم `biginteger` كسلاسل
  نصية، والكتابة في العلاقات بـ `connect` و`disconnect` و`set` و`position`، وصيغة
  الكتل.
