---
title: التخزين
description: كيف يرتّب Verdin المحتوى في قاعدة البيانات، من أسماء الجداول وأعمدة النظام إلى صفوف المسودة والنشر، وروابط العلاقات، وJSON المكوّنات، وجداول المنصة.
sidebar:
  order: 2
---

تصف هذه الصفحة الجداول التي يشتقها Verdin من مخططك وكيف يُخزَّن كل نوع من السمات. اقرأها قبل تغيير أي شيء في `crates/verdin-migrate/src/derive.rs` أو في خدمة المستندات، أو عندما تحتاج إلى الاستعلام من قاعدة البيانات مباشرة. لمعرفة ما يقبله كل نوع سمة، راجع [أنواع السمات](/ar/reference/attribute-types/).

لا تكتب هذه الجداول يدويًا أبدًا: [محرك الترحيل](/ar/internals/migrations/) ينشئها ويطوّرها من المخطط.

## أعراف التسمية

| الكائن | الاسم |
|---|---|
| جدول نوع المحتوى | `collectionName`، الذي يكون افتراضيًا `pluralName` مع تحويل الشرطات إلى شرطات سفلية (`blog-posts` ← `blog_posts`) |
| العمود | اسم السمة بصيغة snake case (`metaTitle` ← `meta_title`) |
| روابط العلاقات | `{table}_{column}_lnk` |
| روابط العلاقات متعددة الأشكال | `{table}_{column}_mph` |
| روابط الوسائط | `{table}_{column}_mda` |
| الفهرس | `{table}_{part}_uq` للفهارس الفريدة، و`{table}_{part}_idx` لغيرها |
| جدول المنصة | البادئة `vd_` (`vd_admin_users`، `vd_schema_snapshots`…) |

القواعد التي يفرضها مدقق المخطط (`crates/verdin-schema/src/naming.rs` و`validate.rs`):

- يطابق `collectionName` النمط `^[a-z][a-z0-9_]*$`، ولا يتجاوز 50 حرفًا، ولا يمكن أن يبدأ بـ `vd_`.
- `singularName` و`pluralName` بصيغة kebab case (`^[a-z][a-z0-9-]*$`، بلا شرطات في البداية أو النهاية أو مزدوجة). الأسماء `upload` و`uploads` و`auth` و`users` و`connect` محجوزة لأن API المحتوى يستخدم تلك المسارات.
- تبدأ أسماء السمات بحرف وتستمر بأحرف أو أرقام أو شرطات سفلية (قاعدة Strapi)، ولا تتجاوز 50 حرفًا.
- في أنواع المحتوى، `id` و`documentId` و`locale` و`publicationState` و`publishedAt` و`createdAt` و`updatedAt` و`createdBy` و`updatedBy` محجوزة، وكذلك أي اسم تتصادم صيغته بـ snake case معها. وفي المكوّنات، `id` محجوز.
- المعرّفات المولّدة محدودة بـ 60 حرفًا (يسمح PostgreSQL بـ 63، وMySQL بـ 64). يُقطع الاسم الأطول ويُمنح تجزئة من 8 أحرف للاسم الكامل، فتبقى الأسماء الطويلة المختلفة مختلفة وتكون النتيجة حتمية.

يُقتبس كل معرّف في SQL المولَّد، لذا فالكلمات المحجوزة في SQL أسماء سمات صالحة.

## أعمدة النظام

يبدأ كل جدول نوع محتوى بهذه الأعمدة:

```sql
id                 BIGINT       primary key, auto-increment
document_id        CHAR(26)     NOT NULL           -- ULID, shared by every version of a document
locale             VARCHAR(16)  NOT NULL DEFAULT '' -- '' for types that are not localized
publication_state  SMALLINT     NOT NULL           -- 0 = draft, 1 = published
published_at       <datetime>   NULL
created_at         <datetime>   NOT NULL
updated_at         <datetime>   NOT NULL
created_by_id      BIGINT       NULL               -- vd_admin_users.id
updated_by_id      BIGINT       NULL
UNIQUE (document_id, locale, publication_state)
INDEX  (publication_state, locale)
```

- `document_id` معرّف ULID بأحرف صغيرة يُولَّد عند الإنشاء. يبقى كما هو عبر المسودة والنسخة المنشورة وكل اللغات.
- تستخدم الأنواع غير المترجمة `locale = ''` بدلًا من `NULL`، لأن قيم NULL لا تتصادم أبدًا في الفهارس الفريدة على أي محرك، ما سيكسر القيد `(document_id, locale, publication_state)`.
- عمود الحالة هو `publication_state`، لا `state`، لأن `state` اسم سمة شائع.

تلي ذلك أعمدة السمات، عمود لكل سمة بسيطة. **كل عمود سمة يقبل القيمة الفارغة.** كما في Strapi v5، يمكن أن تكون المسودات غير مكتملة، لذا يُتحقق من `required` عند نشر نسخة (أو في كل كتابة للأنواع التي لا تستخدم المسودة والنشر)، لا من قاعدة البيانات. وهذا يجعل أيضًا إضافة سمة مطلوبة ترحيلًا آمنًا.

تحصل سمات `unique`، وكل `uid`، على فهرس فريد على `(column, locale, publication_state)`. يمكن لمسودة ونسختها المنشورة أن تتشاركا قيمة، ولا يمكن لمستندين منشورين ذلك، وتفرض قاعدة البيانات هذا دون حالات سباق. ويُبلَّغ عن الانتهاك كـ `ValidationError` على ذلك الحقل.

## المسودة والنشر

يتبع Verdin نموذج Strapi v5. راجع [المسودة والنشر](/ar/concepts/draft-and-publish/) لرؤية المستخدم؛ وهذا ما يحدث في الجدول.

- للمستند صف مسودة واحد على الأكثر (`publication_state = 0`) وصف منشور واحد (`publication_state = 1`) لكل لغة.
- تستهدف عمليات الكتابة من لوحة الإدارة صف المسودة.
- **النشر** يتحقق من سمات `required` وقواعد التحقق على المسودة، ثم ينسخ قيم سمات المسودة إلى الصف المنشور (بتحديثه، أو بإدراجه في المرة الأولى)، في معاملة واحدة. وتُنسخ روابط العلاقات والوسائط الخاصة بالمسودة معه.
- **إلغاء النشر** يحذف الصف المنشور. وتذهب روابطه معه عبر `ON DELETE CASCADE`.
- **تجاهل المسودة** يكتب فوق المسودة بقيم الصف المنشور وروابطه.
- أنواع المحتوى التي لا تستخدم المسودة والنشر ليس لها إلا صف منشور.
- في الأنواع المترجمة، تكون السمات غير المترجمة مشتركة: نشر لغة ينسخها إلى الصفوف المنشورة في اللغات الأخرى.

## العلاقات: مرتبطة بمعرّف المستند

**هذا هو الفرق الرئيسي عن تخزين Strapi.** يربط Strapi الصفوف بمعرّف الصف وعليه إعادة كتابة الروابط عند النشر. أما Verdin فيخزّن العلاقة على شكل *الصف المصدر ← المستند الهدف*:

```sql
-- articles_category_lnk
id                  BIGINT   primary key, auto-increment
source_id           BIGINT   NOT NULL REFERENCES articles(id) ON DELETE CASCADE
target_document_id  CHAR(26) NOT NULL
position            DOUBLE   NOT NULL   -- 1..n, rewritten on every write
UNIQUE (source_id, target_document_id)
UNIQUE (source_id)                      -- to-one kinds only
INDEX  (target_document_id)
```

- يُختار الصف الهدف وقت القراءة، في النسخة المقروءة: ترى المقالة المنشورة تصنيفات منشورة، وترى المسودة مسودات. إذا أُلغي نشر تصنيف، يختفي من المقالات المنشورة دون المساس بأي رابط.
- ينسخ النشر روابط الصف المصدر الخاصة به فقط.
- لا يملك جدول ربط إلا الجانب **المالك** (السمة التي تحمل `inversedBy`، أو علاقة أحادية الاتجاه). يقرأ الجانب العكسي (`mappedBy`) الجدول نفسه بشكل معكوس، وهو للقراءة فقط: كتابته خطأ تحقق يسمّي السمة المالكة.
- "هدف واحد على الأكثر" (`oneToOne`، `manyToOne`، `oneWay`) هو الفهرس الفريد على `source_id`. أما "الهدف ينتمي إلى مستند مصدر واحد" (`oneToOne`، `oneToMany`) فلا يمكن أن يكون فهرسًا، لأن المسودة ونسختها المنشورة تتشاركان الأهداف بشكل مشروع. تفرضه خدمة المستندات عبر *نقل* الهدف: ربطه يزيل الروابط التي تملكها مستندات أخرى إليه في الحالة نفسها، وهو سلوك Strapi.
- لا يوجد مفتاح أجنبي على `target_document_id`، لأن `document_id` ليس فريدًا في الجدول الهدف. ترفض خدمة المستندات الروابط إلى مستندات غير موجودة، وعند حذف آخر نسخة من مستند، تزيل الروابط التي تشير إليه في المعاملة نفسها.
- تحتفظ صفوف الربط بمفتاح أساسي `id`، فتبدو جداول الربط مثل أي جدول آخر لمحرك الترحيل ولإعادات بناء جداول SQLite.
- إعادة تسمية جدول تعيد تسمية جداول الربط الخاصة به معه. تعمل الترحيلات مع إيقاف `foreign_keys` في SQLite، فلا تتتالى إعادة بناء جدول إلى جداول الربط الخاصة به.

**العلاقات متعددة الأشكال** (`morphToOne`، `morphToMany`) تربط مستندات من أي نوع محتوى. تعيش روابطها في `{table}_{column}_mph` مع `source_id` و`target_type` (uid الهدف) و`target_document_id` و`position`، وقيد فريد `(source_id, target_type, target_document_id)`، ولـ `morphToOne` قيد فريد على `source_id`. ليس للجانبين العكسيين (`morphOne`، `morphMany`) جدول: فهما يقرآن روابط المالك التي تشير إليهما، وهما للقراءة فقط. حذف مستند يزيل الروابط متعددة الأشكال إليه. راجع [العلاقات](/ar/concepts/relations/) لما يمكنك فعله وما لا يمكنك فعله بها.

## المكوّنات والمناطق الديناميكية: عمود JSON

سمة المكوّن أو المنطقة الديناميكية هي **عمود JSON واحد** في صف المستند (`jsonb` على PostgreSQL، و`json` على MySQL وMariaDB، و`text` على SQLite). يخزّن Strapi كل مكوّن في جدوله الخاص مع جداول ربط متعددة الأشكال؛ أما العمود فيتجنب عمليات الـ join هذه ويجعل النشر والسجل نسخًا بسيطًا.

```json
// "seo" column (a single component)
{ "id": 1, "metaTitle": "…", "metaDescription": "…" }

// "blocks" column (a dynamic zone)
[
  { "id": 1, "__component": "blocks.hero", "title": "…" },
  { "id": 2, "__component": "blocks.quote", "text": "…", "author": "…" }
]
```

- لكل عنصر مكوّن `id` صحيح، فريد ضمن سمته. تحصل العناصر الجديدة على الرقم الحر التالي.
- يُتحقق من البيانات مقابل مخطط المكوّن في كل كتابة.
- ينسخ النشر والتجاهل الـ JSON كما هو.
- **العلاقات والوسائط داخل المكوّنات** تُخزَّن في الـ JSON نفسه: قيم `documentId` للعلاقات (لا يُسمح هناك إلا بـ `oneWay` و`manyWay`) ومعرّفات الملفات للوسائط. يُتحقق منها عند الكتابة وتُحَلّ باستعلامات مجمّعة عند تعبئة المكوّن. لا يمكن أن تكون العلاقات متعددة الأشكال وسمات `password` داخل المكوّنات.
- **التصفية** تحتاج إلى دوال JSON خاصة بكل لهجة. تُقرأ الحقول البسيطة للمكوّنات المفردة عبر مسار JSON (`#>>` على PostgreSQL، و`JSON_VALUE` على MySQL وMariaDB، و`json_extract` على SQLite). وتستخدم المكوّنات القابلة للتكرار `EXISTS` على عناصر المصفوفة (`jsonb_array_elements`، `JSON_TABLE`، `json_each`). ولا يمكن تصفية المناطق الديناميكية إلا حسب `__component`، لأن لعناصرها حقولًا مختلفة.

راجع [المكوّنات والمناطق الديناميكية](/ar/concepts/components-and-dynamic-zones/) لجانب النمذجة.

## جداول المنصة

جداول المنصة جزء من كل نموذج مشتق، لذا ينشئها محرك الترحيل ويطوّرها تمامًا مثل جداول المحتوى؛ وتظهر كخطوات آمنة في `verdin migrate plan`. وهي معرّفة في `crates/verdin-migrate/src/system.rs`.

| المجال | الجداول |
|---|---|
| الترحيلات | `vd_schema_snapshots`، `vd_migrations_journal` (يملكها محرك الترحيل، وتُنشأ عند أول استخدام) |
| المسؤولون | `vd_admin_users`، `vd_admin_roles`، `vd_admin_user_roles`، `vd_admin_permissions`، `vd_sessions` (رموز التجديد)، `vd_admin_tokens` (روابط الدعوة وإعادة التعيين)، `vd_admin_two_factor`، `vd_admin_passkeys`، `vd_spent_challenges` |
| الوصول إلى API المحتوى | `vd_api_tokens`، `vd_api_token_permissions`، `vd_public_permissions` |
| المستخدمون النهائيون | `vd_users`، `vd_user_roles`، `vd_user_role_permissions`، `vd_end_user_sessions` |
| النسخة | `vd_settings` (مفاتيح الميزات، وتخطيطات عروض التحرير، وعلامات الترقية لمرة واحدة)، `vd_locales` |
| الوسائط | `vd_files`، `vd_folders` |
| سير عمل المحتوى | `vd_history_versions`، `vd_releases`، `vd_release_actions`، `vd_workflows`، `vd_workflow_stages`، `vd_document_stages` |
| التعاون | `vd_comments`، `vd_tasks`، `vd_document_views`، `vd_document_votes`، `vd_polls`، `vd_poll_votes` |
| التكاملات | `vd_webhooks`، `vd_webhook_deliveries`، `vd_deploy_targets`، `vd_deployments`، `vd_plugin_kv`، `vd_audit_logs` |
| ميزات الموقع | `vd_redirects`، `vd_menus`، `vd_forms`، `vd_form_submissions` |

## جداول الوسائط

الملفات صفوف في `vd_files` بشكل Strapi (`name`، `alternative_text`، `caption`، `width`، `height`، `formats`، `hash`، `ext`، `mime`، `size`، `url`، `provider`…)، بالإضافة إلى `focal_point` و`folder_id` و`folder_path`. وتحتفظ المجلدات (`vd_folders`) بـ `path` الخاص بـ Strapi المكوّن من قيم `path_id`، مثل `/1/4`.

سمة الوسائط جدول ربط `{table}_{column}_mda` مع `source_id` (صف المحتوى)، و`file_id` (صف في `vd_files`) و`position`. وله قيد فريد `(source_id, file_id)` و، عندما لا تكون السمة `multiple`، قيد فريد على `source_id`. العمودان مفتاحان أجنبيان مع `ON DELETE CASCADE`، فحذف ملف أو صف يزيل روابطه. تتبع روابط الوسائط قواعد المسودة والنشر نفسها التي تتبعها روابط العلاقات: كل نسخة تملك روابطها والنشر ينسخها.

كيفية عمل الرفع والصيغ وموفّري التخزين موجودة في [الوسائط](/ar/concepts/media/).
