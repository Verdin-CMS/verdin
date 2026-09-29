---
title: سازگاری با Strapi
description: کدام قابلیت‌ها و APIهای Strapi v5 در Verdin پشتیبانی می‌شوند، به‌طور جزئی پشتیبانی می‌شوند یا پشتیبانی نمی‌شوند — REST، GraphQL، کاربران و مجوزها، بارگذاری‌ها، i18n، پیش‌نویس و انتشار، گسترش‌های کد، پنل مدیریت و قابلیت‌های Enterprise.
sidebar:
  order: 2
---

Verdin مدل محتوا و APIهای محتوای Strapi v5 را حفظ می‌کند تا فرانت‌اندها و محتوا بتوانند منتقل
شوند (ببینید [مهاجرت از Strapi](/fa/migrate/from-strapi/)). Verdin جایگزین بی‌دردسری برای یک
*کدبیس* Strapi نیست: runtime مربوط به JavaScript وجود ندارد، پس کد سفارشی به‌صورت افزونه‌های
WebAssembly بازسازی می‌شود. این صفحه هر حوزه را با وضعیتش، بر اساس Verdin 0.10.0، فهرست می‌کند.

**پشتیبانی می‌شود** یعنی مانند Strapi v5 کار می‌کند (تفاوت‌ها ذکر شده‌اند). **جزئی** موارد رایج را
پوشش می‌دهد؛ یادداشت می‌گوید چه چیزی کم است. **پشتیبانی نمی‌شود** معادلی ندارد.

## مدل محتوا

| قابلیت | وضعیت | یادداشت |
| --- | --- | --- |
| نوع‌های مجموعه‌ای و نوع‌های تکی | پشتیبانی می‌شود | فایل‌های طرح‌وارهٔ JSON نزدیک به Strapi (`schema/content-types/*.json`). ببینید [مدل محتوا](/fa/concepts/content-model/). |
| نوع‌های ویژگی اسکالر | پشتیبانی می‌شود | `string`، `text`، `richtext` (Markdown)، `blocks`، `email`، `uid`، `integer`، `biginteger`، `float`، `decimal`، `boolean`، `date`، `time`، `datetime`، `enumeration`، `json`، `password`. `timestamp` در Strapi به‌صورت `datetime` درون‌ریزی می‌شود. |
| کامپوننت‌ها و ناحیه‌های پویا | پشتیبانی می‌شود | از جمله رسانه و روابط `oneWay`/`manyWay` درون کامپوننت‌ها. |
| روابط | پشتیبانی می‌شود | یک/چند به یک/چند، یک‌طرفه و چندطرفه، و روابط چندریختی `morphToOne`، `morphToMany`، `morphOne`، `morphMany`. |
| فیلدهای رسانه | پشتیبانی می‌شود | تکی یا چندتایی، `allowedTypes`. |
| `unique` | جزئی | نه روی ویژگی‌های `text`، `richtext`، `blocks` و `json`. |
| فیلدهای شرطی (`conditions`) | پشتیبانی می‌شود | شرط‌های JSON Logic در Strapi 5.17؛ فیلدهای پنهان الزامی نیستند. |
| فیلدهای سفارشی | جزئی | ویژگی‌های `customField` کار می‌کنند؛ ورودی پنل مدیریت از یک [افزونهٔ](/fa/extending/plugins/) Verdin می‌آید، نه از افزونه‌های React در Strapi. |
| سازندهٔ نوع محتوا | پشتیبانی می‌شود | فقط در حالت توسعه (`verdin dev`)، مانند Strapi. |

## REST API

| قابلیت | وضعیت | یادداشت |
| --- | --- | --- |
| مسیرهای CRUD | پشتیبانی می‌شود | `GET`/`POST /api/{pluralName}`، `GET`/`PUT`/`DELETE /api/{pluralName}/{documentId}`، نوع‌های تکی در `/api/{singularName}`. پاسخ‌ها `data` و `meta` دارند و خطاها شیء `error` در Strapi را. |
| `filters` | پشتیبانی می‌شود | همهٔ عملگرهای Strapi: `$eq`، `$eqi`، `$ne`، `$nei`، `$lt`، `$lte`، `$gt`، `$gte`، `$in`، `$notIn`، `$contains`، `$notContains`، `$containsi`، `$notContainsi`، `$null`، `$notNull`، `$between`، `$startsWith(i)`، `$endsWith(i)`، `$and`، `$or`، `$not`؛ از طریق روابط، کامپوننت‌ها، کامپوننت‌های تکرارشونده و ناحیه‌های پویا (`__component`). |
| `sort` | پشتیبانی می‌شود | چند فیلد، `:asc`/`:desc`، و فیلدِ یک رابطهٔ to-one (`author.name:asc`). |
| `pagination` | پشتیبانی می‌شود | `page`/`pageSize` یا `start`/`limit`، `withCount`. `pageSize` با `[api].max_page_size` (100) محدود می‌شود. |
| `fields` | پشتیبانی می‌شود | |
| `populate` | پشتیبانی می‌شود | `*`، فهرست‌ها، اشیای تودرتو، `on` برای ناحیه‌های پویا، `count`. عمق تا 5؛ حداکثر 1,000 مدخل populate‌شده برای هر رابطه. |
| `status` | پشتیبانی می‌شود | `published` (پیش‌فرض) یا `draft`؛ خواندن پیش‌نویس‌ها به مجوز `readDrafts` نیاز دارد. |
| `locale` | پشتیبانی می‌شود | بخش بین‌المللی‌سازی را در ادامه ببینید. |
| `hasPublishedVersion` | پشتیبانی می‌شود | |
| جستجوی تمام‌متن `_q` | پشتیبانی می‌شود | `$containsi` روی فیلدهای متنی، مانند Strapi؛ جستجوی رتبه‌بندی‌شده با `[search]`. |
| نوشتن روابط | پشتیبانی می‌شود | شناسه‌ها، `connect` / `disconnect` / `set`، با `position` (`before`، `after`، `start`، `end`). |
| انتشار، لغو انتشار، دور انداختن پیش‌نویس | پشتیبانی می‌شود | نوشتن‌ها منتشر می‌کنند مگر با `?status=draft`، مانند Strapi v5. Verdin مسیر `POST /api/{pluralName}/{documentId}/actions/{publish,unpublish,discard-draft}` را اضافه می‌کند. |
| قالب پاسخ Strapi v4 و `publicationState` | پشتیبانی نمی‌شود | Verdin فقط v5 را می‌فهمد: ویژگی‌های تخت، `documentId`، `status`. |
| سند OpenAPI | جزئی | در `/api/_openapi.json` (به‌طور پیش‌فرض فقط با توکن) و یک مرجع تعاملی در `/api/docs`، به‌جای `/documentation` افزونهٔ documentation. |

## GraphQL

| قابلیت | وضعیت | یادداشت |
| --- | --- | --- |
| کوئری‌ها | پشتیبانی می‌شود | `articles`، `articles_connection` با `pageInfo`، `article(documentId)`، نوع‌های تکی؛ `filters`، `sort`، `pagination`، `status`، `locale`. تا وقتی **تنظیمات ← قابلیت‌ها ← GraphQL** را روشن نکنید خاموش است. |
| mutationها | پشتیبانی می‌شود | `create…`، `update…`، `delete…` با `status` و `locale`. |
| کامپوننت‌ها، ناحیه‌های پویا، رسانه | پشتیبانی می‌شود | ناحیه‌های پویا به‌صورت union، رسانه به‌صورت `UploadFile`. |
| روابط چندریختی | جزئی | به‌صورت JSON برگردانده می‌شوند، نه به‌صورت union تایپ‌شده. |
| Shadow CRUD (غیرفعال کردن عملیات برای هر نوع) | پشتیبانی می‌شود | تنظیم `disabled` این قابلیت. |
| resolverهای سفارشی و گسترش‌های طرح‌واره | جزئی | فیلدهای ریشه که افزونه‌ها resolve می‌کنند (`[[graphql]]` در `plugin.toml`)؛ بدون `extensionService`. |
| mutationهای Users & Permissions (`login`، `register`، `me`…) | پشتیبانی نمی‌شود | از مسیرهای REST استفاده کنید. |
| کوئری‌ها/mutationهای بارگذاری و i18n (`uploadFiles`، `i18NLocales`…) | پشتیبانی نمی‌شود | از مسیرهای REST و پنل مدیریت استفاده کنید. |
| محدودیت‌ها، GraphiQL | پشتیبانی می‌شود | کلیدهای `maxDepth`، `maxComplexity`، introspection و playground. |

## Users & Permissions (کاربران نهایی)

**تنظیمات ← قابلیت‌ها ← کاربران و مجوزها** را روشن کنید. ببینید [کاربران نهایی](/fa/guides/auth/end-users/).

| قابلیت | وضعیت | یادداشت |
| --- | --- | --- |
| `POST /api/auth/local`، `/auth/local/register` | پشتیبانی می‌شود | همان شکل درخواست و پاسخ. |
| تأیید ایمیل، فراموشی/بازنشانی/تغییر گذرواژه | پشتیبانی می‌شود | `/auth/email-confirmation`، `/auth/send-email-confirmation`، `/auth/forgot-password`، `/auth/reset-password`، `/auth/change-password`. |
| توکن‌های refresh | پشتیبانی می‌شود | `jwtManagement: "refresh"`، `/auth/refresh`، `/auth/logout`. |
| `/api/users`، `/users/me`، `/users/count` | پشتیبانی می‌شود | JSON ساده، مجوزها روی `plugin::users-permissions.user`. |
| providerهای OAuth | جزئی | GitHub، Google، Microsoft، Discord، Facebook، GitLab، LinkedIn و هر provider مبتنی بر OAuth 2؛ نه همهٔ presetهای Strapi. |
| مسیرهای نقش‌ها و مجوزها (`/api/users-permissions/roles`، `/permissions`) | پشتیبانی نمی‌شود | نقش‌ها را در **تنظیمات ← کاربران نهایی** مدیریت کنید. |
| کاربران درون‌ریزی‌شده | پشتیبانی می‌شود | هش‌های Bcrypt همچنان کار می‌کنند؛ هنگام ورود با Argon2id دوباره هش می‌شوند. |

## کتابخانهٔ رسانه و API بارگذاری

| قابلیت | وضعیت | یادداشت |
| --- | --- | --- |
| `POST /api/upload` | پشتیبانی می‌شود | `files` و `fileInfo` به‌صورت multipart؛ `?id=` اطلاعات یک فایل را به‌روز می‌کند، یا اگر فایلی فرستاده شود آن را جایگزین می‌کند. |
| پیوند دادن هنگام بارگذاری (`ref`، `refId`، `field`) | پشتیبانی نمی‌شود | بارگذاری کنید، سپس فیلد رسانه را با شناسهٔ فایل تنظیم کنید. |
| `GET /api/upload/files`، `/files/{id}`، `DELETE /files/{id}` | جزئی | فهرست فقط `pagination[page]`، `pagination[pageSize]`، `sort` و `filters[name][$containsi]` را می‌پذیرد. |
| قالب‌های واکنش‌گرا، breakpointها | پشتیبانی می‌شود | `thumbnail` به‌علاوهٔ `[upload].breakpoints`. |
| پوشه‌ها، نقطه‌های کانونی، متن جایگزین، زیرنویس‌ها | پشتیبانی می‌شود | |
| providerهای بارگذاری | جزئی | دیسک محلی و ذخیره‌سازی سازگار با S3 (AWS، R2، B2، MinIO، Tigris…). بدون Cloudinary یا بسته‌های provider دیگر. |
| تبدیل تصویر | فقط Verdin | `/uploads/<file>?preset=…` و URLهای امضاشده (provider محلی). |

## بین‌المللی‌سازی

| قابلیت | وضعیت | یادداشت |
| --- | --- | --- |
| نوع‌های بومی‌سازی‌شده و فیلدهای غیربومی‌سازی‌شده | پشتیبانی می‌شود | `pluginOptions.i18n.localized`، برای هر ویژگی هم. |
| `?locale=` در REST، `locale` در GraphQL | پشتیبانی می‌شود | زبان (locale) ناشناخته به `400` می‌انجامد. |
| `localizations` در پاسخ‌ها | پشتیبانی نمی‌شود | زبان دیگر را با همان `documentId` و `?locale=` بخوانید. |
| `GET /api/i18n/locales` | پشتیبانی نمی‌شود | زبان‌ها در پنل مدیریت (**تنظیمات ← بین‌المللی‌سازی**) مدیریت می‌شوند. |

## پیش‌نویس و انتشار

| قابلیت | وضعیت | یادداشت |
| --- | --- | --- |
| نسخه‌های پیش‌نویس و منتشرشده برای هر سند | پشتیبانی می‌شود | برای هر زبان. ببینید [پیش‌نویس و انتشار](/fa/concepts/draft-and-publish/). |
| دور انداختن پیش‌نویس | پشتیبانی می‌شود | |
| انتشار زمان‌بندی‌شده | پشتیبانی می‌شود | از طریق [بسته‌های انتشار](/fa/guides/content/releases/). |

## سفارشی‌سازی سرور

| Strapi | وضعیت | Verdin |
| --- | --- | --- |
| هوک‌های lifecycle، middlewareهای Document Service (سرویس سند) | جزئی | هوک‌های before/after در افزونه‌های WebAssembly که می‌توانند یک نوشتن را تغییر دهند یا رد کنند. بدون JavaScript. |
| کنترلرها، سرویس‌ها و مسیرهای سفارشی | جزئی | مسیرهای افزونه زیر `/api/plugins/<name>/`. |
| policyها و middlewareها | پشتیبانی نمی‌شود | مجوزها و محدودیت نرخ درخواست داخلی هستند. |
| کارهای cron | جزئی | کارهای (job) افزونه. |
| Document Service / Entity Service در JavaScript | پشتیبانی نمی‌شود | runtime مربوط به JavaScript وجود ندارد. |
| افزونه‌های npm از بازارچهٔ Strapi | پشتیبانی نمی‌شود | |
| وب‌هوک‌ها | پشتیبانی می‌شود | امضاشده، با تلاش دوباره و ثبت در لاگ؛ `entry.draft-discard` همان `entry.discard-draft` است. ببینید [وب‌هوک‌ها](/fa/guides/integrations/webhooks/). |
| توکن‌های API (فقط‌خواندنی، دسترسی کامل، سفارشی) | پشتیبانی می‌شود | همان گونه‌ها، انقضای اختیاری، تولید دوباره. |
| توکن‌های انتقال، `strapi transfer` | پشتیبانی نمی‌شود | از `verdin export` و `verdin import verdin` استفاده کنید. |
| فایل‌های `strapi export` | پشتیبانی می‌شود (درون‌ریزی) | `verdin import strapi`؛ خروجی‌های رمزنگاری‌شده خوانده نمی‌شوند. |
| `config/*.js`، `.env` | جزئی | `verdin.toml` و متغیرهای محیطی. |
| نوع‌های TypeScript | پشتیبانی می‌شود | `verdin types`. |
| providerهای ایمیل | جزئی | SMTP، Resend و Postmark. |

## پنل مدیریت

| قابلیت | وضعیت | یادداشت |
| --- | --- | --- |
| مدیر محتوا، کتابخانهٔ رسانه، سازندهٔ نوع محتوا | پشتیبانی می‌شود | یک پنل Angular مستقل، نه پنل مدیریت React در Strapi. |
| کاربران مدیر، نقش‌ها، نقش‌های سفارشی | پشتیبانی می‌شود | مدیر ارشد، Editor و Author به‌صورت داخلی، به‌علاوهٔ نقش‌های سفارشی. |
| مجوزهای سطح فیلد و زبان | پشتیبانی می‌شود | |
| شرط‌های RBAC | جزئی | فقط شرط داخلی `is-creator`؛ بدون شرط‌های سفارشی. |
| سفارشی‌سازی پنل مدیریت (`src/admin/app`) | جزئی | لوگو، favicon، عنوان، رنگ تأکیدی و متن‌ها در `[admin.branding]`؛ ویجت‌ها و فیلدهای سفارشی از افزونه‌ها. بدون صفحه‌های سفارشی، injection zoneها یا گسترش‌های React. |
| API پنل مدیریت (`/admin/…`) | پشتیبانی نمی‌شود | API پنل مدیریت Verdin مخصوص خودش است؛ روی API در Strapi بنا نکنید. |
| پیکربندی نمای ویرایش و نمای فهرست | پشتیبانی می‌شود | |

## قابلیت‌های Enterprise

همه‌چیز در Verdin متن‌باز است؛ این‌ها در Strapi قابلیت‌های Enterprise یا پولی هستند.

| قابلیت Strapi | وضعیت | یادداشت |
| --- | --- | --- |
| SSO | جزئی | providerهای OpenID Connect، با نگاشت گروه به نقش. بدون SAML یا راهبردهای passport دیگر. ببینید [ورود یکپارچه](/fa/guides/auth/sso/). |
| گزارش‌های حسابرسی | پشتیبانی می‌شود | ببینید [گزارش‌های حسابرسی](/fa/guides/content/audit-logs/). |
| گردش‌کار بازبینی | پشتیبانی می‌شود | نقش‌ها برای هر مرحله تعیین می‌کنند چه کسی مدخل‌ها را *به* یک مرحله منتقل کند، و یک مرحلهٔ الزامی انتشار برای همهٔ APIها اعمال می‌شود. ببینید [گردش‌کار بازبینی](/fa/guides/content/review-workflows/). |
| بسته‌های انتشار | پشتیبانی می‌شود | زمان‌بندی‌شده یا فوری. |
| تاریخچهٔ محتوا | پشتیبانی می‌شود | `[history].max_versions` نسخه برای هر سند. |
| پیش‌نمایش و پیش‌نمایش زنده | پشتیبانی می‌شود | URLهای پیش‌نمایش با توکن‌های کوتاه‌عمر، پیش‌نمایش کنار هم و [ویرایش دیداری](/fa/guides/frontend/visual-editing/). |
| نقش‌های مدیر سفارشی | پشتیبانی می‌شود | بدون محدودیت در تعداد. |
