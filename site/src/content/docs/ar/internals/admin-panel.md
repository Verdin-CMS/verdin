---
title: لوحة الإدارة
description: كيف تُنظَّم لوحة إدارة Verdin المبنية بـ Angular، وكيف تبني النماذج والقوائم من المخطط، وكيف تُبنى وتُضمَّن في الملف التنفيذي وتُترجم.
sidebar:
  order: 6
  label: لوحة الإدارة
---

هذه الصفحة للمساهمين في لوحة الإدارة الموجودة في `admin/`: كيف يُنظَّم تطبيق Angular، وكيف يحوّل مخطط المحتوى إلى نماذج وقوائم، وكيف ينتهي به المطاف داخل الملف التنفيذي `verdin`. أما كيفية استخدام اللوحة فتغطيها الأدلة؛ وكيفية عمل جانب الخادم من API الإدارة ففي [مرجع API الإدارة](/ar/api/admin/).

اللوحة تطبيق Angular 22 أحادي الصفحة: مكوّنات مستقلة (standalone)، واكتشاف تغييرات دون zone، وsignals، ومسارات تُحمَّل عند الحاجة، ومكوّنات spartan/ui على Tailwind CSS v4.

## البنية

```text
admin/
├── src/app/
│   ├── app.config.ts     # providers: router, HttpClient interceptors, Transloco, icons
│   ├── app.routes.ts     # lazy routes, guards (auth, permissions, unsaved changes)
│   ├── core/             # services and pure models: api, auth, schema, i18n, permissions…
│   ├── layout/           # the shell (sidebar, header), home, deploy button
│   ├── features/
│   │   ├── auth/         # login, first admin, invitations, password reset
│   │   ├── dashboard/    # home widgets
│   │   ├── content/      # lists, the entry editor, history, releases, review, import
│   │   │   ├── fields/   # schema-driven form controls and the form model
│   │   │   └── collab/   # comments and tasks
│   │   ├── builder/      # content-type builder (verdin dev only)
│   │   ├── media/        # media library
│   │   ├── releases/
│   │   ├── profile/      # own account, two-factor, passkeys, sessions
│   │   └── settings/     # users, roles, tokens, webhooks, locales, plugins, site features…
│   └── shared/
│       ├── ui/           # spartan helm components, owned by the project
│       └── components/   # app-level shared components (confirm dialog, page header…)
├── public/i18n/          # translation catalogs, one JSON file per language
├── scripts/check-i18n.mjs
└── e2e/                  # Playwright tests and the server they run against
```

**الحالة** تعيش في signals داخل خدمات قابلة للحقن في `core/` (`Auth`، `Schema`، `I18n`، `Theme`…). لا توجد مكتبة store.

**الوصول إلى الـ API** يمر عبر `core/api.ts`، وهو غلاف صغير قائم على الوعود (promises) فوق `HttpClient` في Angular، مع أنواع مكتوبة يدويًا في `core/types.ts`. تأتي تهيئة وقت التشغيل (مسار الإدارة، وبادئة الـ API، والوضع، والعلامة التجارية) من وسم `<meta name="verdin-config">` يحقنه الخادم.

**الجلسة.** يعيش رمز الوصول في الذاكرة فقط؛ ورمز التجديد ملف تعريف ارتباط `HttpOnly` محصور في مسارات المصادقة. يضيف معترض HTTP (interceptor) رمز bearer، وعند `401` يجدّد مرة واحدة ويعيد المحاولة؛ وإذا فشل التجديد يرسل المستخدم إلى صفحة تسجيل الدخول. تحمل طلبات التجديد وتسجيل الخروج الترويسة `X-Verdin-CSRF` التي يشترطها الخادم. تستعيد الحراس (guards) الجلسة من ملف تعريف الارتباط عند تحميل الصفحة. والـ `403` الذي يقول إن الدور يشترط المصادقة الثنائية يرسل المستخدم لإعدادها.

## نماذج مبنية على المخطط

ليس لمحرر الإدخال (`features/content/edit.ts`) أي شيفرة خاصة بكل نوع. فهو يقرأ أنواع المحتوى والمكوّنات من `GET /admin/api/content-types` و`GET /admin/api/components`، وتخطيط المحرر من إعدادات عرض التحرير، ويبني النموذج وقت التشغيل باستخدام **Signal Forms** (`@angular/forms/signals`):

- نموذج المستند signal لكائن عادي (`FormModel` في `fields/model.ts`)؛ وتُشتق شجرة الحقول ومدقّقاتها من المخطط.
- يعرض مكوّن `vd-fields` التكراري (`fields/fields.ts`) أي خريطة سمات مقابل شجرة حقول. تستخدم النصوص والتواريخ والأوقات حقول إدخال أصلية مربوطة بـ `[formField]`. وتتولى عناصر `FormValueControl` مخصصة الأرقام (قابلة لأن تكون فارغة؛ والأعداد الصحيحة الكبيرة تبقى سلاسل نصية)، والمفاتيح، والتعدادات، والتاريخ والوقت (توقيت محلي في حقل الإدخال، وUTC في النموذج)، وJSON، وMarkdown، و`blocks` (TipTap)، والوسائط، والعلاقات (منتقٍ بالبحث أثناء الكتابة مع الترتيب) والعلاقات متعددة الأشكال.
- المكوّنات مجموعات حقول متداخلة (fieldsets)؛ والمكوّنات القابلة للتكرار والمناطق الديناميكية قوائم قابلة لإعادة الترتيب. يمكن للإضافات تسجيل أنواع حقول مخصصة، تُعرض كعناصر مخصصة.
- يحوّل `toModel` مستندًا مُعبّأً إلى نموذج النموذج (تصبح العلاقات قيم `documentId`، والملفات معرّفات)، ويحوّل `toPayload` في الاتجاه المعاكس إلى حمولة `data`: تصبح السلاسل الفارغة `null`، وتُسقط مفاتيح العرض (`__key`) والجوانب للقراءة فقط (`mappedBy`، `morphOne`، `morphMany`). كلاهما مختبَر بالاختبارات الوحدوية في `fields/model.spec.ts`.
- يعطي التحقق المشتق من المخطط ملاحظات فورية. تُقيَّم الحقول الشرطية (`conditions.visible`) في المتصفح بمنفذ لمقيّم JSON Logic الخاص بالخادم (`core/logic.ts`). أما قواعد التحقق عبر الحقول فلا يتحقق منها إلا الخادم. يبقى الخادم هو المرجع: تُربط مدخلات `details.errors[].path` الخاصة به بالحقل المطابق.
- الحفظ صريح، مع تتبع التعديلات وتحذير عند مغادرة الصفحة (حارس مسار بالإضافة إلى `beforeunload`). تظهر أزرار **نشر** و**إلغاء النشر** و**تجاهل** بحسب حالة المستند. لا تحفظ لوحة الإدارة إلا المسودات؛ والنشر دائمًا إجراء منفصل.

تخطيط المحرر (ترتيب الحقول، والعروض، والتسميات، والأوصاف، والحقول للقراءة فقط، والحقل الذي يسمّي الإدخالات المرتبطة) يتشاركه كل المسؤولين ويُخزَّن على الخادم في `vd_settings`، ويُغيَّر من صفحة **إعداد العرض** بالصلاحية `views.manage`.

## القوائم

تستخدم قوائم المحتوى (`features/content/list.ts`) جدول spartan helm مع تقسيم إلى صفحات وترتيب وتصفية على جانب الخادم. تنعكس عوامل التصفية والبحث (`_q`) والصفحة في عنوان URL، فتصبح القائمة المصفّاة رابطًا قابلًا للمشاركة. يختار كل مسؤول الأعمدة الظاهرة والترتيب الافتراضي وحجم الصفحة لكل نوع (`list-view.ts`)؛ وتُحفظ هذه الاختيارات في تفضيلاته على الخادم، فتتبعه عبر المتصفحات. وتتحدث القوائم أيضًا مباشرة من بث أحداث الإدارة.

## منشئ أنواع المحتوى

لا يظهر **منشئ أنواع المحتوى** إلا عندما يعمل الخادم في وضع التطوير (`verdin dev`) ويملك المسؤول `schema.manage`. وهو يحرّر أنواع المحتوى والمكوّنات بصيغة ملفاتها: الحقول، وأنواع العلاقات وأهدافها (مع إنشاء السمة العكسية على الهدف)، والمكوّنات، والمناطق الديناميكية، والأطوال، والنطاقات، والعلامات `required` و`unique` و`private`.

يُرسل كل تغيير أولًا إلى `POST /admin/api/schema/plan`، الذي يتحقق من المخطط المرتقب ويعيد خطوات الترحيل مع مخاطرها، وSQL الخاص بها، واقتراحات إعادة التسمية التي يمكن للمستخدم قبولها. التأكيد يستدعي `POST /admin/api/schema/apply` مع مستوى المخاطر المقبول وإعادات التسمية. يرحّل الخادم، ويكتب `schema/*.json`، ويستبدل التطبيق العامل بالمخطط الجديد دون إعادة تشغيل. راجع [محرك الترحيل](/ar/internals/migrations/) لما يحدث على الخادم.

## البناء والتوزيع

- يكتب `ng build` بناء الإنتاج في `admin/dist/admin/browser`، مع `<base href="/admin/">`.
- يضمّن الخادم ذلك المجلد باستخدام `rust-embed` عند تصريفه مع الميزة `embed-admin`، التي تستخدمها إصدارات الإنتاج وصورة Docker. بدون الميزة، أو عند تعيين `[admin].assets_dir`، يقدّم الملفات من القرص. ويتغلب `assets_dir` على البناء المضمَّن.
- يعيد الخادم كتابة `<base href>` إلى `[admin].path` ويحقن تهيئة وقت التشغيل كوسم `<meta>`، لا كسكربت مضمَّن. تغيير `admin.path` لا يتطلب أبدًا إعادة بناء اللوحة.
- المسارات غير المعروفة دون امتداد ملف ترجع إلى `index.html` للتوجيه من جانب العميل. تُخزَّن الحزم ذات البصمة (`main-ABC123.js`) مؤقتًا كـ `immutable` لمدة سنة؛ وكل ما عداها `no-cache`.
- تحمل كل استجابة إدارة سياسة أمان محتوى صارمة (`script-src 'self'`، `frame-ancestors 'none'`، `base-uri 'self'`…)، و`X-Frame-Options: DENY`، و`X-Content-Type-Options: nosniff` و`Referrer-Policy: strict-origin-when-cross-origin`. تضمين الـ CSS الحرج في Angular معطّل في `angular.json` لأنه يعتمد على معالجات أحداث مضمّنة تمنعها السياسة.

للعمل على الواجهة الأمامية، شغّل الخادم، ثم `npm start` في `admin/`: يمرّر `ng serve` المسارين `/admin/api` و`/api` إلى `http://localhost:1337` (`admin/proxy.conf.json`).

## الترجمات

تُترجم اللوحة وقت التشغيل باستخدام Transloco، لا بـ i18n وقت التصريف في Angular، فيقدّم بناء واحد كل اللغات ويستطيع المستخدمون التبديل دون إعادة تحميل.

- الكتالوجات ملفات JSON مسطّحة في `admin/public/i18n/` (`en.json` هو المصدر)، تُحمَّل عند الطلب.
- تستخدم الرسائل ICU MessageFormat (`{name}`، `{count, plural, one {# entry} other {# entries}}`)، ويفسّرها FormatJS (`intl-messageformat`) عبر محوّل Transloco مخصص. يفسّر FormatJS الرسائل بدلًا من تصريفها إلى دوال، فلا تحتاج سياسة CSP إلى `unsafe-eval`.
- مفاتيح الرسائل مُنمَّطة من `en.json` (`core/i18n/keys.ts`): استخدام مفتاح غير موجود خطأ تصريف.
- يتحقق `npm run i18n:check` من كل كتالوج مقابل `en.json`: المفاتيح نفسها، وصيغة ICU صالحة، والوسائط نفسها، وكل فئة جمع في اللغة. ويشغّله CI.
- توفر خدمة `I18n` أيضًا تنسيقًا يراعي اللغة واليوم الأول من الأسبوع، مأخوذين من الإعدادات الإقليمية للمتصفح مع إمكانية التجاوز لكل مستخدم.

كيفية إضافة لغة أو تحديثها موجودة في [الترجمة](/ar/project/translating/).
