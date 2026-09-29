---
title: "Admin API"
description: "APIای که پشت پنل مدیریت Verdin قرار دارد، برای خودکارسازی: ورود، نشست‌ها، قراردادها و گروه‌های اصلی مسیرها."
sidebar:
  order: 4
  label: "مدیریت"
---

پنل مدیریت یک کلاینت Admin API است که زیر `{admin.path}/api` ارائه می‌شود (به‌طور پیش‌فرض
`/admin/api`). هر کاری که پنل انجام می‌دهد، یک اسکریپت هم می‌تواند انجام دهد: ساخت مدیران و
توکن‌های API، پیکربندی وب‌هوک‌ها و قابلیت‌ها، مدیریت زبان‌ها، یا کار با پیش‌نویس‌ها و بسته‌های
انتشار. این صفحه توضیح می‌دهد چگونه احراز هویت کنید و گروه‌های مسیرها را فهرست می‌کند.

:::caution[پایداری]
Admin API پیش از Verdin 1.0 هیچ تضمین پایداری ندارد: مسیرها و بدنه‌ها ممکن است در نسخه‌های
فرعی تغییر کنند و changelog همهٔ تغییرات را فهرست نمی‌کند. برای خواندن و نوشتن محتوا، API
[REST](/fa/api/rest/) یا [GraphQL](/fa/api/graphql/) را با یک
[توکن API](/fa/guides/auth/api-tokens/) ترجیح دهید. قرارداد پایداری برای همهٔ APIها برای 1.0
برنامه‌ریزی شده است.
:::

## ورود

Admin API هنوز توکن API ندارد: یک اسکریپت به‌عنوان یک کاربر مدیر وارد می‌شود، و بهتر است
کاربری باشد که نقشش فقط اجازهٔ کارهایی را بدهد که اسکریپت لازم دارد.

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

توکن دسترسی را در هر درخواست دیگر بفرستید:

```sh title="Terminal"
curl -H "Authorization: Bearer $ACCESS_TOKEN" 'https://cms.example.com/admin/api/system/info'
```

| اعتبارنامه | طول عمر | کجا |
| --- | --- | --- |
| توکن دسترسی (JWT) | 15 دقیقه | بدنهٔ پاسخ. آن را به شکل `Authorization: Bearer …` بفرستید. |
| توکن تازه‌سازی | 30 روز | کوکی `verdin_refresh` (`HttpOnly`، `SameSite=Strict`، مسیر `/admin/api/auth`، و `Secure` زیر `verdin start`). |

برای گرفتن یک توکن دسترسی جدید، `POST /admin/api/auth/refresh` را با کوکی و یک هدر
`X-Verdin-CSRF` (با هر مقداری) فراخوانی کنید. پاسخی مانند ورود می‌دهد و توکن تازه‌سازی را
می‌چرخاند: کوکی جدید را ذخیره کنید، چون ارائهٔ دوبارهٔ یک توکن تازه‌سازی استفاده‌شده کل نشست را
پایان می‌دهد. `POST /admin/api/auth/logout`، با همان هدر، نشست را پایان می‌دهد.

```sh title="Terminal"
curl -s -b cookies.txt -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/refresh' \
  -H 'X-Verdin-CSRF: 1'
```

- **تأیید دومرحله‌ای.** برای حسابی که عامل دوم دارد، ورود با
  `{ "data": { "twoFactorRequired": true, "twoFactorToken": "…", "methods": ["totp"] } }` پاسخ
  می‌دهد. آن را با `POST /admin/api/auth/login/two-factor` و
  `{ "twoFactorToken": "…", "code": "123456" }` (یک کد TOTP یا کد بازیابی) کامل کنید. نگاه
  کنید به [تأیید دومرحله‌ای](/fa/guides/auth/two-factor/).
- **محدودیت نرخ.** ورود و ثبت‌نام به ازای IP هر کلاینت با `[admin].auth_rate_limit` (به‌طور
  پیش‌فرض 20 بار در دقیقه) محدود می‌شوند؛ تازه‌سازی‌ها سهمیهٔ بزرگ‌تری دارند.
- **شکست‌ها.** اعتبارنامه‌های نادرست، حساب‌های ناشناخته و حساب‌های قفل‌شده همه با
  `400 Invalid credentials` پاسخ می‌دهند. پنج گذرواژهٔ نادرست حساب را به مدت 15 دقیقه قفل
  می‌کند.
- **نخستین مدیر.** در یک نمونهٔ تازه، `POST /admin/api/auth/register-first-admin` حساب
  مدیر ارشد را می‌سازد؛ فقط تا وقتی کار می‌کند که هیچ مدیری وجود نداشته باشد.
  `verdin admin create` همین کار را از خط فرمان انجام می‌دهد.

## قراردادها

- بدنه‌ها و پاسخ‌ها JSON هستند. پاسخ‌ها نتیجهٔ خود را در `data` قرار می‌دهند
  (`{ "data": … }`)؛ مسیرهای محتوا `meta` را هم برمی‌گردانند، مانند REST API.
- مسیرهای محتوا بدنه‌های `{ "data": { … } }` می‌گیرند، مانند REST API. مسیرهای تنظیمات اشیای
  JSON ساده می‌گیرند.
- خطاها [شکل خطای REST](/fa/api/rest/#خطاها) را دارند. مسیر قابلیتی که خاموش است با `404` پاسخ
  می‌دهد. مدیری که نقشش تأیید دومرحله‌ای را الزامی می‌کند تا وقتی آن را راه‌اندازی نکند
  `403 TwoFactorRequiredError` می‌گیرد.
- هر مسیر [مجوزهای](/fa/concepts/permissions/) مدیر را بررسی می‌کند: مسیرهای محتوا کنش‌های
  محتوا روی آن نوع را، و مسیرهای تنظیمات کنش تنظیمات خودشان را.
- Admin API هرگز به درخواست‌های cross-origin پاسخ نمی‌دهد: آن را از یک سرور یا اسکریپت
  فراخوانی کنید، نه از صفحه‌های سایتی دیگر.
- تغییرات موفق در [گزارش حسابرسی](/fa/guides/content/audit-logs/) ثبت می‌شوند.

## گروه‌های مسیرها

مسیرها نسبت به `/admin/api` هستند. مسیریاب‌ها در
[`crates/verdin-api/src/admin.rs`](https://github.com/Verdin-CMS/verdin/blob/main/crates/verdin-api/src/admin.rs)
و ماژول‌های `*_admin.rs` کنار آن قرار دارند.

| گروه | مسیرها | مجوز |
| --- | --- | --- |
| ورود و حساب | `GET /auth/status`، `POST /auth/login`، `/auth/refresh`، `/auth/logout`، `GET /auth/me`، `GET\|PUT /users/me`، `GET /auth/sessions`، `DELETE /auth/sessions/{id}`، دعوت‌نامه‌ها و بازنشانی گذرواژه زیر `/auth/*` | واردشده (مسیرهای ورود عمومی هستند) |
| دومرحله‌ای | `/auth/two-factor/*`، `POST /auth/login/two-factor`، `POST /auth/login/passkey/options`، `DELETE /users/{id}/two-factor` | واردشده؛ `users.manage` برای بازنشانی مدیری دیگر |
| SSO | `GET /auth/sso`، `GET /auth/sso/{id}`، `GET /auth/sso/{id}/callback` | عمومی |
| کاربران مدیر | `GET\|POST /users`، `GET\|PUT\|DELETE /users/{id}`، `POST /users/{id}/invite` | `users.manage` |
| نقش‌ها و دسترسی عمومی | `GET\|POST /roles`، `GET\|PUT\|DELETE /roles/{id}`، `GET\|PUT /public-permissions` | `roles.manage` |
| توکن‌های API | `GET\|POST /api-tokens`، `GET\|PUT\|DELETE /api-tokens/{id}`، `POST /api-tokens/{id}/regenerate` | `tokens.manage` |
| طرح‌واره | `GET /content-types`، `GET /components`، `GET\|PUT\|DELETE /content-types/{uid}/edit-view`؛ `GET /schema`، `POST /schema/plan`، `POST /schema/apply` فقط در `verdin dev` | واردشده؛ `views.manage` برای نماهای ویرایش؛ `schema.manage` برای سازنده |
| محتوا | `GET\|POST /content/{uid}`، `GET\|PUT\|DELETE /content/{uid}/{documentId}`، `POST /content/{uid}/{documentId}/actions/{publish\|unpublish\|discard-draft}`، `POST …/clone`، `GET …/locales`، `GET …/usage`، `GET /content/{uid}/uid-available`، `GET /content/{uid}/stats` | کنش‌های محتوا روی `{uid}` |
| درون‌ریزی و خروجی گرفتن | `GET /content/{uid}/export`، `POST /content/{uid}/import` | کنش‌های محتوا روی `{uid}` |
| تاریخچه | `GET /history/{uid}/{documentId}`، `GET /history/versions/{id}`، `POST /history/versions/{id}/restore` | کنش‌های محتوا روی آن نوع |
| بسته‌های انتشار | `GET\|POST /releases`، `GET\|PUT\|DELETE /releases/{id}`، `POST /releases/{id}/actions`، `DELETE /releases/{id}/actions/{actionId}`، `POST /releases/{id}/publish` | `releases.manage` |
| گردش‌کارهای بازبینی | `GET\|POST /review-workflows`، `GET\|PUT\|DELETE /review-workflows/{id}`، `GET\|PUT /content/{uid}/{documentId}/review`، `GET /review/*` | `workflows.manage` برای پیکربندی |
| رسانه | `POST /upload`، `POST /upload/from-url`، `GET /upload/files`، `GET\|PUT\|DELETE /upload/files/{id}`، `POST /upload/files/{id}/replace`، `GET /upload/files/{id}/usage`، `/upload/folders…` | `media.*` |
| زبان‌ها | `GET\|POST /i18n/locales`، `PUT\|DELETE /i18n/locales/{code}` | `locales.manage` برای تغییر |
| وب‌هوک‌ها | `GET\|POST /webhooks`، `GET\|PUT\|DELETE /webhooks/{id}`، `POST\|DELETE /webhooks/{id}/secret`، `POST /webhooks/{id}/trigger`، `GET /webhooks/{id}/deliveries`، `POST /webhooks/deliveries/{id}/retry` | `webhooks.manage` |
| کاربران نهایی | `GET\|POST /end-users`، `GET\|PUT\|DELETE /end-users/{id}`، `GET\|POST /end-user-roles`، `PUT\|DELETE /end-user-roles/{id}` | `endusers.manage` |
| قابلیت‌ها | `GET /features`، `PUT /features/{id}`، `POST /email/test` | `features.manage` برای تغییر |
| افزونه‌ها | `GET /plugins`، `GET /plugins/extensions`، `PUT /plugins/{name}`، `GET /plugins/{name}/logs` | `plugins.manage` |
| استقرارها و CDN | `/deploy/targets…`، `GET /deploy/deployments`، `GET /deploy/cdn`، `POST /deploy/cdn/purge` | `deploy.manage`؛ `deploy.trigger` برای راه‌اندازی |
| سایت | `/site/redirects…`، `/site/menus…`، `/site/forms…` و ارسال‌های فرم | `site.manage` |
| همکاری | `/comments…`، `/tasks…`، `/engagement/*`، `/polls…` | دسترسی خواندن روی نوع مدخل |
| بلادرنگ | `GET /events`، `GET\|POST /presence` | نگاه کنید به [Realtime API](/fa/api/realtime/#جریان-مدیریت) |
| هوش مصنوعی | `GET /ai`، `POST /ai/translate`، `/ai/alt-text`، `/ai/summarize`، `/ai/seo` | نگاه کنید به [اقدامات هوش مصنوعی](/fa/guides/integrations/ai-actions/) |
| گزارش‌های حسابرسی | `GET /audit-logs` | `audit.read` |
| سیستم | `GET /system/info` (نسخه، پایگاه داده و حالت) | واردشده |

## مسیرهای محتوا

مسیرهای محتوا همان Document Service (سرویس سند) را اجرا می‌کنند که REST API اجرا می‌کند، با
قواعد مدیریت:

- `{uid}` همان UID نوع محتواست، مانند `api::article`.
- خواندن‌ها **پیش‌نویس‌ها** را برمی‌گردانند مگر اینکه `status=published` بدهید. آن‌ها
  [پارامترهای کوئری](/fa/api/rest/#پارامترهای-کوئری) REST را می‌گیرند، به‌علاوهٔ
  `unseen=true` برای سندهایی که مدیر از آخرین تغییرشان آن‌ها را باز نکرده است.
- نوشتن‌ها فقط پیش‌نویس را ذخیره می‌کنند. انتشار همیشه یک کنش صریح است.
- نوشتن‌ها مدیر را به‌عنوان سازنده یا آخرین ویرایشگر ثبت می‌کنند. محدودیت‌های فیلد، زبان و
  `is-creator` در نقش‌های مدیر بر خواندن‌ها و نوشتن‌ها اعمال می‌شوند.

```sh title="Terminal"
curl -X PUT 'https://cms.example.com/admin/api/content/api::article/k2m7q4…?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"data":{"title":"Bonjour, Verdin"}}'
curl -X POST 'https://cms.example.com/admin/api/content/api::article/k2m7q4…/actions/publish?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```
