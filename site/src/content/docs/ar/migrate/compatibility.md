---
title: التوافق مع Strapi
description: أي ميزات Strapi v5 وواجهاته يدعمها Verdin، أو يدعمها جزئيًا، أو لا يدعمها — REST وGraphQL والمستخدمون والصلاحيات والرفع وi18n والمسودة والنشر وامتدادات الشيفرة ولوحة الإدارة وميزات المؤسسات.
sidebar:
  order: 3
---

يحتفظ Verdin بنموذج المحتوى وواجهات المحتوى في Strapi v5 حتى تنتقل الواجهات الأمامية والمحتوى
(راجع [الترحيل من Strapi](/ar/migrate/from-strapi/)). لكنه ليس بديلًا مباشرًا لـ *قاعدة شيفرة*
Strapi: لا توجد بيئة تشغيل JavaScript، لذا تُعاد كتابة الشيفرة المخصصة كإضافات WebAssembly. تسرد هذه الصفحة
كل مجال مع حالته، حتى
Verdin 0.10.0.

**مدعوم** يعمل كما في Strapi v5 (مع ذكر الاختلافات). **جزئي** يغطي الحالات
الشائعة؛ وتقول الملاحظة ما الذي ينقص. **غير مدعوم** لا مقابل له.

## نموذج المحتوى

| الميزة | الحالة | ملاحظات |
| --- | --- | --- |
| أنواع المجموعات والأنواع المفردة | مدعوم | ملفات مخطط JSON قريبة من ملفات Strapi (`schema/content-types/*.json`). راجع [نموذج المحتوى](/ar/concepts/content-model/). |
| أنواع السمات البسيطة | مدعوم | `string`، `text`، `richtext` (Markdown)، `blocks`، `email`، `uid`، `integer`، `biginteger`، `float`، `decimal`، `boolean`، `date`، `time`، `datetime`، `enumeration`، `json`، `password`. يُستورد `timestamp` الخاص بـ Strapi كـ `datetime`. |
| المكوّنات والمناطق الديناميكية | مدعوم | بما في ذلك الوسائط وعلاقات `oneWay`/`manyWay` داخل المكوّنات. |
| العلاقات | مدعوم | واحد/متعدد إلى واحد/متعدد، وأحادية الاتجاه ومتعددة الأهداف أحادية الاتجاه، ومتعددة الأشكال `morphToOne` و`morphToMany` و`morphOne` و`morphMany`. |
| حقول الوسائط | مدعوم | مفردة أو متعددة، مع `allowedTypes`. |
| `unique` | جزئي | ليس على سمات `text` و`richtext` و`blocks` و`json`. |
| الحقول الشرطية (`conditions`) | مدعوم | شروط JSON Logic في Strapi 5.17؛ والحقول المخفية ليست مطلوبة. |
| الحقول المخصصة | جزئي | تعمل سمات `customField`؛ ويأتي حقل الإدخال في لوحة الإدارة من [إضافة](/ar/extending/plugins/) لـ Verdin، لا من إضافات React في Strapi. |
| منشئ أنواع المحتوى | مدعوم | في وضع التطوير (`verdin dev`) فقط، مثل Strapi. |

## REST API

| الميزة | الحالة | ملاحظات |
| --- | --- | --- |
| مسارات CRUD | مدعوم | `GET`/`POST /api/{pluralName}`، و`GET`/`PUT`/`DELETE /api/{pluralName}/{documentId}`، والأنواع المفردة على `/api/{singularName}`. تحمل الاستجابات `data` و`meta`، والأخطاء كائن `error` الخاص بـ Strapi. |
| `filters` | مدعوم | كل عوامل Strapi: `$eq`، `$eqi`، `$ne`، `$nei`، `$lt`، `$lte`، `$gt`، `$gte`، `$in`، `$notIn`، `$contains`، `$notContains`، `$containsi`، `$notContainsi`، `$null`، `$notNull`، `$between`، `$startsWith(i)`، `$endsWith(i)`، `$and`، `$or`، `$not`؛ عبر العلاقات، والمكوّنات، والمكوّنات القابلة للتكرار، والمناطق الديناميكية (`__component`). |
| `sort` | مدعوم | عدة حقول، و`:asc`/`:desc`، وحقل علاقة إلى واحد (`author.name:asc`). |
| `pagination` | مدعوم | `page`/`pageSize` أو `start`/`limit`، و`withCount`. `pageSize` محدود بـ `[api].max_page_size` (100). |
| `fields` | مدعوم | |
| `populate` | مدعوم | `*`، والقوائم، والكائنات المتداخلة، و`on` للمناطق الديناميكية، و`count`. عمق حتى 5؛ و1,000 إدخال مُعبّأ على الأكثر لكل علاقة. |
| `status` | مدعوم | `published` (الافتراضي) أو `draft`؛ وتحتاج قراءة المسودات إلى الصلاحية `readDrafts`. |
| `locale` | مدعوم | راجع i18n أدناه. |
| `hasPublishedVersion` | مدعوم | |
| البحث النصي الكامل `_q` | مدعوم | `$containsi` على الحقول النصية، مثل Strapi؛ وبحث مرتّب حسب الصلة مع `[search]`. |
| الكتابة في العلاقات | مدعوم | المعرّفات، و`connect` / `disconnect` / `set`، مع `position` (`before`، `after`، `start`، `end`). |
| النشر وإلغاء النشر وتجاهل المسودة | مدعوم | تنشر عمليات الكتابة ما لم يكن `?status=draft`، كما في Strapi v5. ويضيف Verdin ‏`POST /api/{pluralName}/{documentId}/actions/{publish,unpublish,discard-draft}`. |
| صيغة استجابة Strapi v4 و`publicationState` | غير مدعوم | يتحدث Verdin الإصدار v5 فقط: سمات مسطّحة، و`documentId`، و`status`. |
| مستند OpenAPI | جزئي | على `/api/_openapi.json` (بالرموز فقط افتراضيًا) ومرجع تفاعلي على `/api/docs`، بدلًا من `/documentation` في إضافة التوثيق. |

## GraphQL

| الميزة | الحالة | ملاحظات |
| --- | --- | --- |
| الاستعلامات | مدعوم | `articles`، و`articles_connection` مع `pageInfo`، و`article(documentId)`، والأنواع المفردة؛ و`filters`، `sort`، `pagination`، `status`، `locale`. معطّل حتى تفعّل **الإعدادات ← الميزات ← GraphQL**. |
| الطفرات | مدعوم | `create…`، `update…`، `delete…` مع `status` و`locale`. |
| المكوّنات والمناطق الديناميكية والوسائط | مدعوم | المناطق الديناميكية كاتحادات (unions)، والوسائط كـ `UploadFile`. |
| العلاقات متعددة الأشكال | جزئي | تُعاد كـ JSON، لا كاتحادات مُنمَّطة. |
| Shadow CRUD (تعطيل العمليات لكل نوع) | مدعوم | إعداد `disabled` في الميزة. |
| المحلّلات المخصصة وامتدادات المخطط | جزئي | حقول جذرية تحلّها الإضافات (`[[graphql]]` في `plugin.toml`)؛ لا يوجد `extensionService`. |
| طفرات Users & Permissions (`login`، `register`، `me`…) | غير مدعوم | استخدم مسارات REST. |
| استعلامات وطفرات الرفع وi18n (`uploadFiles`، `i18NLocales`…) | غير مدعوم | استخدم مسارات REST (`GET /api/i18n/locales`) ولوحة الإدارة. `localizations` في الأنواع المترجمة مدعوم. |
| الحدود، وGraphiQL | مدعوم | `maxDepth`، و`maxComplexity`، ومفاتيح الاستبطان وبيئة التجربة. |

## Users & Permissions (المستخدمون النهائيون)

فعّل **الإعدادات ← الميزات ← المستخدمون والصلاحيات**. راجع [المستخدمون النهائيون](/ar/guides/auth/end-users/).

| الميزة | الحالة | ملاحظات |
| --- | --- | --- |
| `POST /api/auth/local`، `/auth/local/register` | مدعوم | أشكال الطلب والاستجابة نفسها. |
| تأكيد البريد الإلكتروني، ونسيان كلمة المرور وإعادة تعيينها وتغييرها | مدعوم | `/auth/email-confirmation`، `/auth/send-email-confirmation`، `/auth/forgot-password`، `/auth/reset-password`، `/auth/change-password`. |
| رموز التجديد | مدعوم | `jwtManagement: "refresh"`، `/auth/refresh`، `/auth/logout`. |
| `/api/users`، `/users/me`، `/users/count` | مدعوم | JSON عادي، والصلاحيات على `plugin::users-permissions.user`. |
| موفّرو OAuth | جزئي | GitHub وGoogle وMicrosoft وDiscord وFacebook وGitLab وLinkedIn وأي موفّر OAuth 2؛ لا كل الإعدادات المسبقة في Strapi. |
| مسارات الأدوار والصلاحيات (`/api/users-permissions/roles`، `/permissions`) | غير مدعوم | أدِر الأدوار في **الإعدادات ← المستخدمون النهائيون**. |
| المستخدمون المستوردون | مدعوم | تستمر تجزئات bcrypt في العمل؛ وتُعاد تجزئتها بـ Argon2id عند تسجيل الدخول. |

## مكتبة الوسائط وAPI الرفع

| الميزة | الحالة | ملاحظات |
| --- | --- | --- |
| `POST /api/upload` | مدعوم | Multipart ‏`files` و`fileInfo`؛ ويحدّث `?id=` معلومات ملف، أو يستبدل الملف عند إرسال واحد. |
| الربط عند الرفع (`ref`، `refId`، `field`) | غير مدعوم | ارفع، ثم عيّن حقل الوسائط بمعرّف الملف. |
| `GET /api/upload/files`، `/files/{id}`، `DELETE /files/{id}` | جزئي | يأخذ السرد `pagination[page]` و`pagination[pageSize]` و`sort` و`filters[name][$containsi]` فقط. |
| الصيغ المتجاوبة، ونقاط التوقف | مدعوم | `thumbnail` بالإضافة إلى `[upload].breakpoints`. |
| المجلدات، ونقاط التركيز، والنص البديل، والتعليقات | مدعوم | |
| موفّرو الرفع | جزئي | القرص المحلي والتخزين المتوافق مع S3 (AWS وR2 وB2 وMinIO وTigris…). لا Cloudinary ولا حزم موفّرين أخرى. |
| تحويلات الصور | خاص بـ Verdin | `/uploads/<file>?preset=…` وعناوين URL موقّعة (الموفّر المحلي). |

## التدويل

| الميزة | الحالة | ملاحظات |
| --- | --- | --- |
| الأنواع المترجمة والحقول غير المترجمة | مدعوم | `pluginOptions.i18n.localized`، لكل سمة أيضًا. |
| `?locale=` في REST، و`locale` في GraphQL | مدعوم | اللغة غير المعروفة تعطي `400`. |
| `localizations` في الاستجابات | مدعوم | فقط عند تعبئته (`populate=localizations`، `populate=*`)، بالخيارات نفسها كالعلاقة. وهو أيضًا حقل GraphQL. يستبعده API الإدارة. |
| `GET /api/i18n/locales` | مدعوم | مصفوفة بسيطة بشكل Strapi. يحتاج إلى `find` على `plugin::i18n.locale` (صف **اللغات** في شبكة الصلاحيات)، مثل `listLocales` في Strapi. يُشتق `documentId` من رمز اللغة. تُدار اللغات في لوحة الإدارة (**الإعدادات ← التدويل**). |

## المسودة والنشر

| الميزة | الحالة | ملاحظات |
| --- | --- | --- |
| نسخ مسودة ومنشورة لكل مستند | مدعوم | لكل لغة. راجع [المسودة والنشر](/ar/concepts/draft-and-publish/). |
| تجاهل المسودة | مدعوم | |
| النشر المجدول | مدعوم | عبر [حزم النشر](/ar/guides/content/releases/). |

## تخصيص الخادم

راجع [نقل الشيفرة المخصصة](/ar/migrate/porting-custom-code/) لمعرفة كيف تنقل كلًا من هذه.

| Strapi | الحالة | Verdin |
| --- | --- | --- |
| خطافات دورة الحياة، وmiddlewares خدمة المستندات | جزئي | خطافات before/after في إضافات WebAssembly، يمكنها تغيير الكتابة أو رفضها. بلا JavaScript. |
| المتحكمات والخدمات والمسارات المخصصة | جزئي | مسارات الإضافات تحت `/api/plugins/<name>/`. |
| السياسات والـ middlewares | غير مدعوم | الصلاحيات وحدود المعدل مدمجة. |
| `register` / `bootstrap` | جزئي | دالة البدء في الإضافة، تعمل عند بدء الإضافة أو تشغيلها أو تغيّر إعداداتها؛ يمكنها تهيئة المحتوى واستبدال صلاحيات الدور العام. |
| مهام Cron | جزئي | مهام الإضافات. |
| Document Service / Entity Service بـ JavaScript | غير مدعوم | لا توجد بيئة تشغيل JavaScript. |
| إضافات npm من سوق Strapi | غير مدعوم | |
| Webhooks | مدعوم | موقّعة، ويُعاد إرسالها، وتُسجَّل؛ و`entry.draft-discard` اسمه `entry.discard-draft`. راجع [Webhooks](/ar/guides/integrations/webhooks/). |
| رموز API (للقراءة فقط، وصول كامل، مخصص) | مدعوم | الأنواع نفسها، مع انتهاء صلاحية اختياري وإعادة توليد. |
| رموز النقل، و`strapi transfer` | غير مدعوم | استخدم `verdin export` و`verdin import verdin`. |
| ملفات `strapi export` | مدعوم (الاستيراد) | `verdin import strapi`؛ ولا تُقرأ عمليات التصدير المشفّرة. |
| `config/*.js`، `.env` | جزئي | `verdin.toml` ومتغيرات البيئة. |
| أنواع TypeScript | مدعوم | `verdin types`. |
| موفّرو البريد الإلكتروني | جزئي | SMTP وResend وPostmark. |

## لوحة الإدارة

| الميزة | الحالة | ملاحظات |
| --- | --- | --- |
| مدير المحتوى، ومكتبة الوسائط، ومنشئ أنواع المحتوى | مدعوم | لوحة Angular خاصة، لا لوحة React الخاصة بـ Strapi. |
| المستخدمون المسؤولون، والأدوار، والأدوار المخصصة | مدعوم | Super Admin وEditor وAuthor مدمجة، بالإضافة إلى الأدوار المخصصة. |
| صلاحيات على مستوى الحقول واللغات | مدعوم | |
| شروط RBAC | جزئي | الشرط المدمج `is-creator` فقط؛ لا شروط مخصصة. |
| تخصيص لوحة الإدارة (`src/admin/app`) | جزئي | الشعار، والأيقونة المفضلة، والعنوان، ولون التمييز، والنصوص في `[admin.branding]`؛ والأدوات والحقول المخصصة من الإضافات. لا صفحات مخصصة، ولا مناطق حقن، ولا امتدادات React. |
| API الإدارة (`/admin/…`) | غير مدعوم | API الإدارة في Verdin خاص به؛ لا تبنِ على API الخاص بـ Strapi. |
| تهيئة عرض التحرير وعرض القائمة | مدعوم | |

## ميزات المؤسسات

كل شيء في Verdin مفتوح المصدر؛ وهذه ميزات للمؤسسات أو مدفوعة في Strapi.

| ميزة Strapi | الحالة | ملاحظات |
| --- | --- | --- |
| SSO | جزئي | موفّرو OpenID Connect، مع ربط المجموعات بالأدوار. لا SAML ولا استراتيجيات passport أخرى. راجع [تسجيل الدخول الموحّد](/ar/guides/auth/sso/). |
| سجلات التدقيق | مدعوم | راجع [سجلات التدقيق](/ar/guides/content/audit-logs/). |
| مسارات المراجعة | مدعوم | تحدّ الأدوار لكل مرحلة من يستطيع نقل الإدخالات *إلى* مرحلة، وتنطبق مرحلة النشر المطلوبة على كل API. راجع [مسارات المراجعة](/ar/guides/content/review-workflows/). |
| حزم النشر | مدعوم | مجدولة أو فورية. |
| سجل المحتوى | مدعوم | `[history].max_versions` نسخة لكل مستند. |
| المعاينة والمعاينة المباشرة | مدعوم | عناوين URL للمعاينة برموز قصيرة الأمد، ومعاينة جنبًا إلى جنب، و[التحرير المرئي](/ar/guides/frontend/visual-editing/). |
| أدوار الإدارة المخصصة | مدعوم | بلا حد لعددها. |
