---
title: پنل مدیریت
description: پنل مدیریت Angular در Verdin چگونه سازمان‌دهی شده است، چگونه فرم‌ها و فهرست‌ها را از طرح‌واره می‌سازد، و چگونه ساخته، درون فایل باینری جاسازی و ترجمه می‌شود.
sidebar:
  order: 6
  label: پنل مدیریت
---

این صفحه برای مشارکت‌کنندگان در پنل مدیریت در `admin/` است: برنامهٔ Angular چگونه سازمان‌دهی شده، چگونه طرح‌وارهٔ محتوا را به فرم‌ها و فهرست‌ها تبدیل می‌کند و چگونه سر از درون فایل باینری `verdin` درمی‌آورد. نحوهٔ استفاده از پنل در راهنماها آمده است؛ نحوهٔ کار سمت سرور API مدیریت در [مرجع API مدیریت](/fa/api/admin/) آمده است.

پنل یک برنامهٔ تک‌صفحه‌ای Angular 22 است: کامپوننت‌های standalone، تشخیص تغییر zoneless، signalها، مسیرهای lazy-loaded و کامپوننت‌های spartan/ui روی Tailwind CSS v4.

## ساختار

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

**State** در signalهایی درون سرویس‌های injectable در `core/` (`Auth`، `Schema`، `I18n`، `Theme`…) نگه داشته می‌شود. هیچ کتابخانهٔ storeای وجود ندارد.

**دسترسی به API** از طریق `core/api.ts` انجام می‌شود، یک wrapper کوچک مبتنی بر promise روی `HttpClient` در Angular، با نوع‌های دست‌نوشته در `core/types.ts`. پیکربندی زمان اجرا (مسیر پنل مدیریت، پیشوند API، حالت، برندینگ) از یک تگ `<meta name="verdin-config">` می‌آید که سرور تزریق می‌کند.

**نشست.** توکن دسترسی فقط در حافظه نگه داشته می‌شود؛ توکن refresh یک کوکی `HttpOnly` است که به مسیرهای احراز هویت محدود شده است. یک HTTP interceptor توکن bearer را اضافه می‌کند و در صورت `401` یک بار refresh و دوباره تلاش می‌کند؛ اگر refresh شکست بخورد، کاربر را به صفحهٔ ورود می‌فرستد. درخواست‌های refresh و خروج هدر `X-Verdin-CSRF` را که سرور لازم دارد حمل می‌کنند. guardها هنگام بارگذاری صفحه، نشست را از کوکی بازیابی می‌کنند. یک `403` که بگوید نقش کاربر به تأیید دومرحله‌ای نیاز دارد، کاربر را برای راه‌اندازی آن می‌فرستد.

## فرم‌های مبتنی بر طرح‌واره

ویرایشگر مدخل (`features/content/edit.ts`) هیچ کد مخصوص نوعی ندارد. نوع‌های محتوا و کامپوننت‌ها را از `GET /admin/api/content-types` و `GET /admin/api/components` می‌خواند، چیدمان ویرایشگر را از تنظیمات edit-view، و فرم را در زمان اجرا با **Signal Forms** (`@angular/forms/signals`) می‌سازد:

- مدل سند یک signal از یک شیء ساده است (`FormModel` در `fields/model.ts`)؛ درخت فیلدها و اعتبارسنج‌های آن از طرح‌واره مشتق می‌شوند.
- یک کامپوننت بازگشتی `vd-fields` (`fields/fields.ts`) هر نگاشت ویژگی‌ای را روی یک درخت فیلد render می‌کند. متن، تاریخ و زمان از inputهای بومی متصل با `[formField]` استفاده می‌کنند. `FormValueControl`های سفارشی عددها (nullable؛ اعداد صحیح بزرگ رشته می‌مانند)، سوئیچ‌ها، enumerationها، تاریخ‌وزمان‌ها (وقت محلی در input، UTC در مدل)، JSON، Markdown، `blocks` (TipTap)، رسانه، روابط (انتخابگر جستجو هنگام تایپ با امکان ترتیب‌دهی) و روابط چندریختی را مدیریت می‌کنند.
- کامپوننت‌ها fieldsetهای تودرتو هستند؛ کامپوننت‌های تکرارشونده و ناحیه‌های پویا فهرست‌هایی با قابلیت جابه‌جایی ترتیب‌اند. افزونه‌ها می‌توانند نوع‌های فیلد سفارشی ثبت کنند که به شکل custom element render می‌شوند.
- `toModel` یک سند populateشده را به مدل فرم تبدیل می‌کند (روابط به `documentId` و فایل‌ها به شناسه تبدیل می‌شوند)، و `toPayload` آن را به payload از نوع `data` برمی‌گرداند: رشته‌های خالی `null` می‌شوند، کلیدهای render (`__key`) و سمت‌های فقط‌خواندنی (`mappedBy`، `morphOne`، `morphMany`) حذف می‌شوند. هر دو در `fields/model.spec.ts` تست واحد دارند.
- اعتبارسنجی مشتق از طرح‌واره بازخورد فوری می‌دهد. فیلدهای شرطی (`conditions.visible`) در مرورگر با نسخه‌ای منتقل‌شده از ارزیاب JSON Logic سرور (`core/logic.ts`) ارزیابی می‌شوند. قاعده‌های اعتبارسنجی میان‌فیلدی فقط در سرور بررسی می‌شوند. سرور مرجع نهایی می‌ماند: مدخل‌های `details.errors[].path` آن به فیلد متناظر نگاشت می‌شوند.
- ذخیره کردن صریح است، با ردگیری تغییرات و هشدار هنگام ترک صفحه (یک route guard به‌همراه `beforeunload`). دکمه‌های **انتشار**، **لغو انتشار** و **دور انداختن تغییرات** بسته به وضعیت سند نمایش داده می‌شوند. پنل مدیریت فقط پیش‌نویس ذخیره می‌کند؛ انتشار همیشه یک کنش جداگانه است.

چیدمان ویرایشگر (ترتیب فیلدها، پهنا، برچسب‌ها، توضیحات، فیلدهای فقط‌خواندنی، فیلدی که مدخل‌های مرتبط را نام‌گذاری می‌کند) بین همهٔ مدیران مشترک است و روی سرور در `vd_settings` ذخیره می‌شود، و از صفحهٔ **پیکربندی نما** با مجوز `views.manage` تغییر می‌کند.

## فهرست‌ها

فهرست‌های محتوا (`features/content/list.ts`) از جدول spartan helm با صفحه‌بندی، مرتب‌سازی و فیلتر سمت سرور استفاده می‌کنند. فیلترها، جستجو (`_q`) و شمارهٔ صفحه در URL بازتاب داده می‌شوند، بنابراین یک فهرست فیلترشده یک پیوند قابل اشتراک است. هر مدیر ستون‌های قابل مشاهده، مرتب‌سازی پیش‌فرض و اندازهٔ صفحه را برای هر نوع انتخاب می‌کند (`list-view.ts`)؛ این انتخاب‌ها در ترجیحات خود او روی سرور ذخیره می‌شوند، بنابراین در مرورگرهای مختلف همراه او هستند. فهرست‌ها همچنین به‌صورت زنده از جریان رویدادهای مدیریت به‌روز می‌شوند.

## سازندهٔ نوع محتوا

**سازندهٔ نوع محتوا** فقط وقتی دیده می‌شود که سرور در حالت توسعه (`verdin dev`) اجرا شود و مدیر `schema.manage` داشته باشد. نوع‌های محتوا و کامپوننت‌ها را در قالب فایلی خودشان ویرایش می‌کند: فیلدها، گونه‌ها و مقصدهای رابطه (همراه با ساختن ویژگی معکوس روی مقصد)، کامپوننت‌ها، ناحیه‌های پویا، طول‌ها، بازه‌ها و پرچم‌های `required`، `unique` و `private`.

هر تغییر ابتدا به `POST /admin/api/schema/plan` فرستاده می‌شود که طرح‌وارهٔ احتمالی را اعتبارسنجی می‌کند و گام‌های مهاجرت را با ریسک، SQL و پیشنهادهای تغییرنامی که کاربر می‌تواند بپذیرد برمی‌گرداند. تأیید کردن، `POST /admin/api/schema/apply` را با سطح ریسک پذیرفته‌شده و تغییرنام‌ها فراخوانی می‌کند. سرور مهاجرت را انجام می‌دهد، `schema/*.json` را می‌نویسد و برنامهٔ در حال اجرا را بدون راه‌اندازی دوباره با طرح‌وارهٔ جدید جایگزین می‌کند. برای آنچه در سرور رخ می‌دهد، [موتور مهاجرت](/fa/internals/migrations/) را ببینید.

## ساخت و توزیع

- `ng build` ساخت production را در `admin/dist/admin/browser` می‌نویسد، با `<base href="/admin/">`.
- سرور وقتی با feature `embed-admin` کامپایل شود، که ساخت‌های release و ایمیج Docker از آن استفاده می‌کنند، آن پوشه را با `rust-embed` جاسازی می‌کند. بدون این feature، یا وقتی `[admin].assets_dir` تنظیم شده باشد، فایل‌ها را از دیسک ارائه می‌کند. `assets_dir` بر ساخت جاسازی‌شده اولویت دارد.
- سرور `<base href>` را به `[admin].path` بازنویسی می‌کند و پیکربندی زمان اجرا را به شکل یک تگ `<meta>` تزریق می‌کند، نه یک اسکریپت درون‌خطی. تغییر `admin.path` هرگز به ساخت دوبارهٔ پنل نیاز ندارد.
- مسیرهای ناشناخته بدون پسوند فایل برای مسیریابی سمت کلاینت به `index.html` برمی‌گردند. bundleهای دارای اثر انگشت (`main-ABC123.js`) به مدت یک سال به‌صورت `immutable` کش می‌شوند؛ بقیه `no-cache` هستند.
- هر پاسخ پنل مدیریت یک Content Security Policy سخت‌گیرانه (`script-src 'self'`، `frame-ancestors 'none'`، `base-uri 'self'`…)، `X-Frame-Options: DENY`، `X-Content-Type-Options: nosniff` و `Referrer-Policy: strict-origin-when-cross-origin` دارد. درون‌خطی‌سازی critical CSS در Angular در `angular.json` خاموش شده است، چون به event handlerهای درون‌خطی متکی است که این policy ممنوع می‌کند.

برای کار روی فرانت‌اند، سرور را اجرا کنید، سپس `npm start` را در `admin/` اجرا کنید: `ng serve` مسیرهای `/admin/api` و `/api` را به `http://localhost:1337` proxy می‌کند (`admin/proxy.conf.json`).

## ترجمه‌ها

پنل در زمان اجرا با Transloco ترجمه می‌شود، نه با i18n زمان کامپایل Angular، بنابراین یک ساخت همهٔ زبان‌ها را پوشش می‌دهد و کاربران می‌توانند بدون بارگذاری دوباره زبان را عوض کنند.

- کاتالوگ‌ها فایل‌های JSON تخت در `admin/public/i18n/` هستند (`en.json` منبع است) که در صورت نیاز بارگذاری می‌شوند.
- پیام‌ها از ICU MessageFormat استفاده می‌کنند (`{name}`، `{count, plural, one {# entry} other {# entries}}`) که FormatJS (`intl-messageformat`) آن‌ها را از طریق یک transpiler سفارشی Transloco تفسیر می‌کند. FormatJS پیام‌ها را تفسیر می‌کند، به جای اینکه آن‌ها را به تابع کامپایل کند، بنابراین CSP به `unsafe-eval` نیاز ندارد.
- کلیدهای پیام از `en.json` تایپ می‌شوند (`core/i18n/keys.ts`): استفاده از کلیدی که وجود ندارد خطای کامپایل است.
- `npm run i18n:check` هر کاتالوگ را با `en.json` مقایسه می‌کند: همان کلیدها، نحو معتبر ICU، همان آرگومان‌ها و همهٔ دسته‌های جمع آن زبان. CI آن را اجرا می‌کند.
- سرویس `I18n` همچنین قالب‌بندی وابسته به زبان و نخستین روز هفته را فراهم می‌کند که از تنظیمات منطقه‌ای مرورگر گرفته می‌شوند، با امکان بازنویسی برای هر کاربر.

نحوهٔ افزودن یا به‌روزرسانی یک زبان در [ترجمه](/fa/project/translating/) آمده است.
