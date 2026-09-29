---
title: "API الإدارة"
description: "الـ API الذي تقوم عليه لوحة إدارة Verdin، للأتمتة: تسجيل الدخول والجلسات والأعراف ومجموعات المسارات الرئيسية."
sidebar:
  order: 4
  label: "الإدارة"
---

لوحة الإدارة عميل لـ API الإدارة، الذي يُقدَّم تحت `{admin.path}/api`
(`/admin/api` افتراضيًا). كل ما تفعله اللوحة يمكن لسكربت أن يفعله أيضًا: إنشاء المسؤولين
ورموز API، وإعداد الـ webhooks والميزات، وإدارة اللغات، أو العمل على المسودات وحزم
النشر. تشرح هذه الصفحة كيفية المصادقة وتسرد مجموعات المسارات.

:::caution[الاستقرار]
لا يقدّم API الإدارة أي ضمان للاستقرار قبل Verdin 1.0: قد تتغير المسارات وأجسام الطلبات في
الإصدارات الفرعية (minor)، ولا يسرد سجل التغييرات كل تغيير. لقراءة المحتوى وكتابته،
فضّل [REST](/ar/api/rest/) أو [GraphQL](/ar/api/graphql/) مع
[رمز API](/ar/guides/auth/api-tokens/). عقد استقرار لكل الواجهات مخطط له في 1.0.
:::

## تسجيل الدخول

لا يملك API الإدارة رموز API بعد: يسجّل السكربت الدخول كمستخدم مسؤول، ويُفضَّل أن يكون
دوره لا يسمح إلا بما يحتاجه السكربت.

```sh title="Terminal"
curl -s -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"bot@example.com","password":"…"}'
```

```json
{
  "data": {
    "user": { "id": 3, "email": "bot@example.com", "…": "…" },
    "accessToken": "eyJhbGciOiJIUzI1NiIs…",
    "accessTokenExpiresAt": "2026-09-29T10:15:00.000Z"
  }
}
```

أرسل رمز الوصول مع كل طلب آخر:

```sh title="Terminal"
curl -H "Authorization: Bearer $ACCESS_TOKEN" 'https://cms.example.com/admin/api/system/info'
```

| بيانات الاعتماد | مدة الصلاحية | المكان |
| --- | --- | --- |
| رمز الوصول (JWT) | 15 دقيقة | جسم الاستجابة. أرسله على شكل `Authorization: Bearer …`. |
| رمز التجديد | 30 يومًا | ملف تعريف الارتباط `verdin_refresh` (`HttpOnly`، `SameSite=Strict`، المسار `/admin/api/auth`، و`Secure` تحت `verdin start`). |

للحصول على رمز وصول جديد، استدعِ `POST /admin/api/auth/refresh` مع ملف تعريف الارتباط
وترويسة `X-Verdin-CSRF` (بأي قيمة). يجيب كما يجيب تسجيل الدخول ويدوّر رمز التجديد:
احفظ ملف تعريف الارتباط الجديد، لأن تقديم رمز تجديد مستخدَم مرة أخرى ينهي الجلسة بأكملها.
أما `POST /admin/api/auth/logout`، مع الترويسة نفسها، فينهي الجلسة.

```sh title="Terminal"
curl -s -b cookies.txt -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/refresh' \
  -H 'X-Verdin-CSRF: 1'
```

- **المصادقة الثنائية.** بالنسبة لحساب لديه عامل ثانٍ، يجيب تسجيل الدخول بـ
  `{ "data": { "twoFactorRequired": true, "twoFactorToken": "…", "methods": ["totp"] } }`.
  أكمله بـ `POST /admin/api/auth/login/two-factor` و
  `{ "twoFactorToken": "…", "code": "123456" }` (رمز TOTP أو رمز استرداد). راجع
  [المصادقة الثنائية](/ar/guides/auth/two-factor/).
- **حدود المعدل.** يُحدَّد تسجيل الدخول والتسجيل لكل عنوان IP للعميل بواسطة
  `[admin].auth_rate_limit` (20 في الدقيقة افتراضيًا)؛ وللتجديد ميزانية أكبر.
- **الإخفاقات.** بيانات الاعتماد الخاطئة والحسابات غير المعروفة والحسابات المقفلة كلها تجيب بـ
  `400 Invalid credentials`. خمس كلمات مرور خاطئة تقفل الحساب لمدة 15 دقيقة.
- **المسؤول الأول.** على نسخة جديدة، ينشئ `POST /admin/api/auth/register-first-admin` حساب
  Super Admin؛ ولا يعمل إلا ما دام لا يوجد أي مسؤول. ويفعل `verdin admin create` الشيء نفسه من
  سطر الأوامر.

## الأعراف

- أجسام الطلبات والاستجابات بصيغة JSON. تغلّف الاستجابات نتيجتها في `data`
  (`{ "data": … }`)؛ وتعيد مسارات المحتوى أيضًا `meta`، مثل REST API.
- تأخذ مسارات المحتوى أجسامًا بشكل `{ "data": { … } }`، مثل REST API. وتأخذ مسارات الإعدادات
  كائنات JSON عادية.
- للأخطاء [شكل أخطاء REST](/ar/api/rest/#الأخطاء). مسار ميزة معطّلة يجيب بـ `404`.
  والمسؤول الذي يتطلب دوره المصادقة الثنائية يحصل على
  `403 TwoFactorRequiredError` حتى يُعدّها.
- يتحقق كل مسار من [صلاحيات](/ar/concepts/permissions/) المسؤول: مسارات المحتوى تتحقق من
  إجراءات المحتوى على النوع، ومسارات الإعدادات من إجراء الإعدادات الخاص بها.
- لا يجيب API الإدارة أبدًا على الطلبات عبر المصادر (cross-origin): استدعِه من خادم أو سكربت، لا
  من صفحات موقع آخر.
- تُسجَّل التغييرات الناجحة في [سجل التدقيق](/ar/guides/content/audit-logs/).

## مجموعات المسارات

المسارات نسبية إلى `/admin/api`. الموجّهات موجودة في
[`crates/verdin-api/src/admin.rs`](https://github.com/Verdin-CMS/verdin/blob/main/crates/verdin-api/src/admin.rs)
وفي وحدات `*_admin.rs` المجاورة له.

| المجموعة | المسارات | الصلاحية |
| --- | --- | --- |
| تسجيل الدخول والحساب | `GET /auth/status`، `POST /auth/login`، `/auth/refresh`، `/auth/logout`، `GET /auth/me`، `GET\|PUT /users/me`، `GET /auth/sessions`، `DELETE /auth/sessions/{id}`، والدعوات وإعادة تعيين كلمة المرور تحت `/auth/*` | مسجّل الدخول (مسارات تسجيل الدخول عامة) |
| المصادقة الثنائية | `/auth/two-factor/*`، `POST /auth/login/two-factor`، `POST /auth/login/passkey/options`، `DELETE /users/{id}/two-factor` | مسجّل الدخول؛ و`users.manage` لإعادة تعيينها لمسؤول آخر |
| SSO | `GET /auth/sso`، `GET /auth/sso/{id}`، `GET /auth/sso/{id}/callback` | عام |
| المستخدمون المسؤولون | `GET\|POST /users`، `GET\|PUT\|DELETE /users/{id}`، `POST /users/{id}/invite` | `users.manage` |
| الأدوار والوصول العام | `GET\|POST /roles`، `GET\|PUT\|DELETE /roles/{id}`، `GET\|PUT /public-permissions` | `roles.manage` |
| رموز API | `GET\|POST /api-tokens`، `GET\|PUT\|DELETE /api-tokens/{id}`، `POST /api-tokens/{id}/regenerate` | `tokens.manage` |
| المخطط | `GET /content-types`، `GET /components`، `GET\|PUT\|DELETE /content-types/{uid}/edit-view`؛ و`GET /schema`، `POST /schema/plan`، `POST /schema/apply` في `verdin dev` فقط | مسجّل الدخول؛ و`views.manage` لعروض التحرير؛ و`schema.manage` للمنشئ |
| المحتوى | `GET\|POST /content/{uid}`، `GET\|PUT\|DELETE /content/{uid}/{documentId}`، `POST /content/{uid}/{documentId}/actions/{publish\|unpublish\|discard-draft}`، `POST …/clone`، `GET …/locales`، `GET …/usage`، `GET /content/{uid}/uid-available`، `GET /content/{uid}/stats` | إجراءات المحتوى على `{uid}` |
| الاستيراد والتصدير | `GET /content/{uid}/export`، `POST /content/{uid}/import` | إجراءات المحتوى على `{uid}` |
| السجل | `GET /history/{uid}/{documentId}`، `GET /history/versions/{id}`، `POST /history/versions/{id}/restore` | إجراءات المحتوى على النوع |
| حزم النشر | `GET\|POST /releases`، `GET\|PUT\|DELETE /releases/{id}`، `POST /releases/{id}/actions`، `DELETE /releases/{id}/actions/{actionId}`، `POST /releases/{id}/publish` | `releases.manage` |
| مسارات المراجعة | `GET\|POST /review-workflows`، `GET\|PUT\|DELETE /review-workflows/{id}`، `GET\|PUT /content/{uid}/{documentId}/review`، `GET /review/*` | `workflows.manage` للإعداد |
| الوسائط | `POST /upload`، `POST /upload/from-url`، `GET /upload/files`، `GET\|PUT\|DELETE /upload/files/{id}`، `POST /upload/files/{id}/replace`، `GET /upload/files/{id}/usage`، `/upload/folders…` | `media.*` |
| اللغات | `GET\|POST /i18n/locales`، `PUT\|DELETE /i18n/locales/{code}` | `locales.manage` للتغيير |
| Webhooks | `GET\|POST /webhooks`، `GET\|PUT\|DELETE /webhooks/{id}`، `POST\|DELETE /webhooks/{id}/secret`، `POST /webhooks/{id}/trigger`، `GET /webhooks/{id}/deliveries`، `POST /webhooks/deliveries/{id}/retry` | `webhooks.manage` |
| المستخدمون النهائيون | `GET\|POST /end-users`، `GET\|PUT\|DELETE /end-users/{id}`، `GET\|POST /end-user-roles`، `PUT\|DELETE /end-user-roles/{id}` | `endusers.manage` |
| الميزات | `GET /features`، `PUT /features/{id}`، `POST /email/test` | `features.manage` للتغيير |
| الإضافات | `GET /plugins`، `GET /plugins/extensions`، `PUT /plugins/{name}`، `GET /plugins/{name}/logs` | `plugins.manage` |
| النشر (deploy) وCDN | `/deploy/targets…`، `GET /deploy/deployments`، `GET /deploy/cdn`، `POST /deploy/cdn/purge` | `deploy.manage`؛ و`deploy.trigger` للبدء |
| الموقع | `/site/redirects…`، `/site/menus…`، `/site/forms…` وإرسالات النماذج | `site.manage` |
| التعاون | `/comments…`، `/tasks…`، `/engagement/*`، `/polls…` | صلاحية القراءة على نوع الإدخال |
| الوقت الفعلي | `GET /events`، `GET\|POST /presence` | راجع [API الوقت الفعلي](/ar/api/realtime/#بث-الإدارة) |
| الذكاء الاصطناعي | `GET /ai`، `POST /ai/translate`، `/ai/alt-text`، `/ai/summarize`، `/ai/seo` | راجع [إجراءات الذكاء الاصطناعي](/ar/guides/integrations/ai-actions/) |
| سجلات التدقيق | `GET /audit-logs` | `audit.read` |
| النظام | `GET /system/info` (الإصدار وقاعدة البيانات والوضع) | مسجّل الدخول |

## مسارات المحتوى

تشغّل مسارات المحتوى خدمة المستندات (Document Service) نفسها التي يشغّلها REST API، مع قواعد الإدارة:

- `{uid}` هو UID نوع المحتوى، مثل `api::article`.
- تعيد القراءات **المسودات** ما لم تمرّر `status=published`. وتأخذ
  [معاملات الاستعلام](/ar/api/rest/#معاملات-الاستعلام) الخاصة بـ REST، بالإضافة إلى `unseen=true`
  للمستندات التي لم يفتحها المسؤول منذ آخر تغيير لها.
- تحفظ عمليات الكتابة المسودة فقط. النشر دائمًا إجراء صريح.
- تسجّل عمليات الكتابة المسؤول بصفته المنشئ أو آخر محرر. وتنطبق قيود الحقول واللغات و`is-creator`
  في أدوار المسؤول على القراءة والكتابة.

```sh title="Terminal"
curl -X PUT 'https://cms.example.com/admin/api/content/api::article/k2m7q4…?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"data":{"title":"Bonjour, Verdin"}}'
curl -X POST 'https://cms.example.com/admin/api/content/api::article/k2m7q4…/actions/publish?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```
