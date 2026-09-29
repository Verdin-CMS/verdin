---
title: مرجع خط فرمان
description: همهٔ فرمان‌ها، زیرفرمان‌ها و پرچم‌های فایل باینری verdin، همراه با آنچه می‌خوانند، می‌نویسند و چاپ می‌کنند.
sidebar:
  order: 2
  label: خط فرمان
---

<!-- Written from crates/verdin/src/cli.rs and crates/verdin/src/new.rs. `npm run check-cli`
(site/scripts/check-cli.mjs) fails when a subcommand or flag in cli.rs is missing here. -->

`verdin` تنها فایل باینری است: پروژه می‌سازد، سرور را اجرا می‌کند، مهاجرت‌ها را اعمال می‌کند،
کاربران مدیر را مدیریت می‌کند و محتوا را وارد و خارج می‌کند. این صفحه همهٔ فرمان‌ها و پرچم‌ها را فهرست می‌کند.

```text title="Terminal"
verdin [OPTIONS] <COMMAND>
```

| فرمان | کاری که انجام می‌دهد |
| --- | --- |
| [`verdin new`](#verdin-new) | یک پوشهٔ پروژه می‌سازد. |
| [`verdin dev`](#verdin-dev) | سرور را در حالت توسعه اجرا می‌کند. |
| [`verdin start`](#verdin-start) | سرور را در حالت production اجرا می‌کند. |
| [`verdin schema check`](#verdin-schema-check) | فایل‌های طرح‌واره را اعتبارسنجی می‌کند. |
| [`verdin migrate plan`](#verdin-migrate-plan) | گام‌های مهاجرت و SQL آن‌ها را نشان می‌دهد. |
| [`verdin migrate apply`](#verdin-migrate-apply) | گام‌های مهاجرت را اعمال می‌کند. |
| [`verdin admin create`](#verdin-admin-create) | یک مدیر ارشد (مدیر ارشد) می‌سازد. |
| [`verdin admin reset-password`](#verdin-admin-reset-password) | گذرواژهٔ یک مدیر را تنظیم می‌کند. |
| [`verdin types`](#verdin-types) | تعریف‌های TypeScript برای API محتوا تولید می‌کند. |
| [`verdin import strapi`](#verdin-import-strapi) | یک خروجی Strapi را درون‌ریزی می‌کند. |
| [`verdin import verdin`](#verdin-import-verdin) | یک خروجی Verdin را درون‌ریزی می‌کند. |
| [`verdin export`](#verdin-export) | پروژه را در یک بایگانی `.tar.gz` می‌نویسد. |
| [`verdin healthcheck`](#verdin-healthcheck) | بررسی می‌کند که سرور محلی پاسخ می‌دهد. |
| [`verdin secrets`](#verdin-secrets) | کلیدهای محرمانهٔ تازه چاپ می‌کند. |
| [`verdin version`](#verdin-version) | نسخه را چاپ می‌کند. |

## گزینه‌های سراسری

| گزینه | پیش‌فرض | توضیح |
| --- | --- | --- |
| `-c, --config <CONFIG>` | `verdin.toml` | فایل پیکربندی پروژه. از `VERDIN_CONFIG` هم خوانده می‌شود. ریشهٔ پروژه پوشهٔ همین فایل است: طرح‌واره، افزونه‌ها، بارگذاری‌ها و مسیرهای نسبی SQLite نسبت به آن تعیین می‌شوند. |
| `-h, --help` | | راهنمای فرمان را چاپ می‌کند. |
| `-V, --version` | | نسخه را چاپ می‌کند. |

`verdin help <COMMAND>` همان راهنمای `--help` را چاپ می‌کند.

همهٔ فرمان‌ها به جز `new`، `secrets` و `version` ابتدا پروژه را بارگذاری می‌کنند:

1. فایل `.env` کنار فایل پیکربندی را، اگر وجود داشته باشد، می‌خوانند. متغیرهایی
   که از قبل در محیط تنظیم شده‌اند اولویت دارند.
2. `verdin.toml` (اختیاری) و بازنویسی‌های `VERDIN_*` را بارگذاری می‌کنند.
   [مرجع پیکربندی](/fa/reference/configuration/) را ببینید.
3. لاگ‌گیری را روی standard error، با `[log]` و `RUST_LOG`، آغاز می‌کنند.

فرمان‌هایی که پایگاه داده را باز می‌کنند به `VERDIN_DATABASE_URL` یا `[database].url` نیاز دارند. فرمان‌هایی
که با حساب‌های مدیر کار دارند یا سرور را اجرا می‌کنند، به `VERDIN_ADMIN_JWT_SECRET` و
`VERDIN_TOKEN_PEPPER` هم نیاز دارند.

## `verdin new`

```text title="Terminal"
verdin new <DIR> [--database <DATABASE>]
```

یک پروژه در `DIR` می‌سازد که نباید وجود داشته باشد یا باید خالی باشد:

| فایل | محتوا |
| --- | --- |
| `verdin.toml` | `[server]`، `[api]` و `[admin]` با مقدارهای پیش‌فرضشان. |
| `.env` | `VERDIN_DATABASE_URL`، و `VERDIN_ADMIN_JWT_SECRET` و `VERDIN_TOKEN_PEPPER` تازه. فقط برای شما خواندنی است (حالت `0600` در Unix). |
| `.gitignore` | `.env`، `data/`، فایل‌های SQLite و `.cache/`. |
| `schema/content-types/`، `schema/components/` | پوشه‌های خالی طرح‌واره. |
| `data/` | برای پایگاه دادهٔ SQLite (فقط SQLite). |

| آرگومان یا گزینه | پیش‌فرض | توضیح |
| --- | --- | --- |
| `<DIR>` | | پوشه‌ای که ساخته می‌شود. |
| `--database <DATABASE>` | `sqlite` | پایگاه داده‌ای که `.env` به آن اشاره می‌کند: `sqlite`، `postgres`، `mysql` یا `mariadb`. |

با `sqlite`، URL برابر `sqlite://data/verdin.db` است. با بقیه، URL یک سرور محلی است
با کاربر `verdin`، گذرواژهٔ `change-me` و پایگاه داده‌ای هم‌نام با
پوشه (حروف کوچک، ارقام و `_`): پیش از شروع آن را ویرایش کنید.

```text title="Terminal"
$ verdin new blog --database postgres
created blog

  cd blog
  verdin dev

then open http://localhost:1337/admin/ to register the first admin
```

## `verdin dev`

```text title="Terminal"
verdin dev
```

سرور را در حالت توسعه اجرا می‌کند. در مقایسه با `verdin start`:

- مهاجرت‌های در انتظار با سطح ریسک `safe` هنگام راه‌اندازی اعمال می‌شوند. گام‌های پرریسک‌تر
  سرور را متوقف می‌کنند؛ آن‌ها را با [`verdin migrate plan`](#verdin-migrate-plan) بازبینی کنید.
- **سازندهٔ نوع محتوا** در پنل مدیریت فایل‌های طرح‌واره را ویرایش می‌کند و سرور
  طرح‌واره را دوباره بارگذاری می‌کند.
- کوکی refresh با `Secure` علامت‌گذاری نمی‌شود (مگر اینکه `[admin].secure_cookies` چنین بگوید)، بنابراین
  می‌توانید از طریق HTTP ساده وارد شوید.
- وب‌هوک‌ها و مقصدهای استقرار می‌توانند نشانی‌های loopback و خصوصی را فراخوانی کنند (مگر اینکه
  `[webhooks].allow_private_networks` چیز دیگری بگوید).

با Ctrl+C یا `SIGTERM` متوقف می‌شود.

## `verdin start`

```text title="Terminal"
verdin start [--migrate]
```

سرور را در حالت production اجرا می‌کند. وقتی پایگاه داده از طرح‌واره عقب‌تر باشد از شروع
خودداری می‌کند، بنابراین یک استقرار هرگز جدول‌هایی را که بازبینی نکرده‌اید تغییر نمی‌دهد.

| گزینه | توضیح |
| --- | --- |
| `--migrate` | گام‌های مهاجرت `safe` در انتظار را پیش از شروع اعمال می‌کند. گام‌های پرریسک و مخرب همچنان به `verdin migrate apply` نیاز دارند. |

پیش از گوش دادن به درخواست‌ها، پیکربندی را بررسی می‌کند (`[api].prefix` و `[admin].path` شبیه
`/api` باشند، اندازه‌های صفحه با هم سازگار باشند، `[server].trusted_proxies` و `[api].cors_origins`
قابل parse باشند) و نقش‌های داخلی را می‌سازد. وقتی `[admin].secure_cookies` برابر
`false` یا `[email].provider` برابر `log` باشد، یک هشدار در لاگ ثبت می‌کند. وقتی هنوز هیچ مدیری وجود ندارد، نشانی
پنل مدیریت را در لاگ ثبت می‌کند، جایی که نخستین بازدیدکننده نخستین مدیر ارشد را ثبت‌نام می‌کند.

با Ctrl+C یا `SIGTERM` متوقف می‌شود.

## `verdin schema check`

```text title="Terminal"
verdin schema check
```

فایل‌های طرح‌واره (`[schema].path`) را بدون دست زدن به پایگاه داده اعتبارسنجی می‌کند. یک
خلاصه چاپ می‌کند، یا با خطاها شکست می‌خورد، هر کدام با فایل و مسیر ویژگی‌اش:

```text title="Terminal"
$ verdin schema check
schema ok: 4 content types, 3 components
```

از آن در CI پیش از استقرار استفاده کنید. برای آنچه هر ویژگی می‌پذیرد، [نوع‌های ویژگی](/fa/reference/attribute-types/)
را ببینید.

## `verdin migrate plan`

```text title="Terminal"
verdin migrate plan [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

پایگاه داده را با طرح‌واره مقایسه می‌کند و آنچه `verdin migrate apply` انجام خواهد داد را چاپ می‌کند،
بدون تغییر دادن چیزی: گام‌های شماره‌دار، هر کدام با سطح ریسک و SQL خود. وقتی کاری برای
انجام نباشد، `database is up to date` را چاپ می‌کند.

| گزینه | توضیح |
| --- | --- |
| `--rename-table <OLD=NEW>` | جدول `OLD` را تغییرنام‌یافته به `NEW` در نظر می‌گیرد (ردیف‌هایش را نگه می‌دارد)، به جای حذف یکی و ساختن دیگری. قابل تکرار. |
| `--rename-column <TABLE.OLD=NEW>` | ستون `OLD` از `TABLE` را تغییرنام‌یافته به `NEW` در نظر می‌گیرد (مقدارهایش را نگه می‌دارد). `TABLE` نام جدید جدول است. قابل تکرار. |

سطح‌های ریسک:

| سطح | معنا |
| --- | --- |
| `safe` | نمی‌تواند داده از دست بدهد یا روی ردیف‌های موجود شکست بخورد: جدول‌های جدید، ستون‌های جدیدی که nullable هستند یا مقدار پیش‌فرض دارند، تغییرنام‌ها، نمایه‌های غیریکتا. |
| `risky` | ممکن است روی ردیف‌های موجود شکست بخورد یا مقدارها را تبدیل کند: تغییر نوع ستون، ستون‌های جدیدی که nullable نیستند و مقدار پیش‌فرض ندارند، نمایه‌های یکتا روی جدول‌های موجود. |
| `destructive` | ستون‌ها یا جدول‌ها را حذف می‌کند. |

وقتی یک گام بالاتر از `safe` باشد، برنامه با پرچمی که لازم دارد پایان می‌یابد
(`requires: verdin migrate apply --allow risky`). وقتی یک ستون یا جدول حذف‌شده شبیه
یک مورد تغییرنام‌یافته باشد، پرچم‌های تغییرنامی را که باید بدهید فهرست می‌کند. وقتی یک مهاجرت قبلی
قطع شده باشد، نشان می‌دهد چند گام اعمال شده و آخرین خطا چه بوده است.

```text title="Terminal"
verdin migrate plan --rename-column articles.summary=excerpt
```

[مهاجرت‌های طرح‌واره](/fa/concepts/schema-migrations/) را ببینید.

## `verdin migrate apply`

```text title="Terminal"
verdin migrate apply [--allow <ALLOW>] [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

برنامه را اعمال می‌کند. همان گزینه‌های تغییرنام `verdin migrate plan` را می‌پذیرد؛ همان‌هایی را
بدهید که بازبینی کرده‌اید.

| گزینه | پیش‌فرض | توضیح |
| --- | --- | --- |
| `--allow <ALLOW>` | `safe` | بالاترین سطح ریسکی که اعمال می‌شود: `safe`، `risky` یا `destructive`. برنامه‌ای که گامی بالاتر از آن داشته باشد، پیش از اجرای هر چیزی رد می‌شود. |
| `--rename-table <OLD=NEW>` | | مانند `verdin migrate plan`. |
| `--rename-column <TABLE.OLD=NEW>` | | مانند `verdin migrate plan`. |

`applied N steps` یا `database is up to date` را چاپ می‌کند. پس از یک وقفه (قطع
اتصال، گامی که شکست خورد)، علت را برطرف کنید و دوباره اجرا کنید: از گامی که
کامل نشده بود ادامه می‌دهد.

## `verdin admin create`

```text title="Terminal"
verdin admin create --email <EMAIL>
```

یک مدیر ارشد می‌سازد. گذرواژه از `VERDIN_ADMIN_PASSWORD` خوانده می‌شود، یا اگر تنظیم نشده باشد
از standard input. پایگاه داده باید با طرح‌واره به‌روز باشد.

| گزینه | توضیح |
| --- | --- |
| `--email <EMAIL>` | نشانی ایمیل مدیر جدید. |

```text title="Terminal"
$ VERDIN_ADMIN_PASSWORD='a long passphrase' verdin admin create --email ada@example.com
created Super Admin ada@example.com (id 1)
```

از آن برای ساختن نخستین مدیر سروری استفاده کنید که هنوز از مرورگر در دسترس نیست؛
در غیر این صورت نخستین بازدیدکنندهٔ پنل مدیریت آن را ثبت‌نام می‌کند.

## `verdin admin reset-password`

```text title="Terminal"
verdin admin reset-password --email <EMAIL>
```

گذرواژهٔ یک مدیر را تنظیم می‌کند، حساب را پس از ورودهای ناموفق از قفل خارج می‌کند و همهٔ
نشست‌های آن را پایان می‌دهد. گذرواژه مانند `verdin admin create` خوانده می‌شود.

| گزینه | توضیح |
| --- | --- |
| `--email <EMAIL>` | نشانی ایمیل مدیر. |

عامل‌های دوم را حذف نمی‌کند؛ مدیری که مجوز **مدیریت کاربران** دارد می‌تواند آن‌ها را در
**تنظیمات ← کاربران** بازنشانی کند.

## `verdin types`

```text title="Terminal"
verdin types [-o <OUT>]
```

تعریف‌های TypeScript برای API محتوا (یک interface برای هر نوع محتوا و
کامپوننت) را از طرح‌واره تولید می‌کند و روی standard output چاپ می‌کند. به
پایگاه داده نیاز ندارد.

| گزینه | توضیح |
| --- | --- |
| `-o, --out <OUT>` | به جای آن در این فایل می‌نویسد. |

```text title="Terminal"
verdin types --out ../web/src/verdin.d.ts
```

[کلاینت تایپ‌شده](/fa/guides/frontend/typed-client/) را ببینید.

## `verdin import strapi`

```text title="Terminal"
verdin import strapi <PATH> [--schema-only] [--force]
```

یک پروژهٔ Strapi v4 یا v5 را از خروجی‌ای که با `strapi export --no-encrypt` ساخته شده درون‌ریزی می‌کند: یک
`.tar.gz`، یک `.tar` یا یک پوشهٔ بازشده. نوع‌های محتوا و کامپوننت‌ها را
به‌صورت فایل‌های طرح‌واره می‌نویسد، سپس مدخل‌ها، زبان‌ها، رسانه، روابط و پوشه‌ها را درون‌ریزی می‌کند.

| آرگومان یا گزینه | توضیح |
| --- | --- |
| `<PATH>` | فایل یا پوشهٔ خروجی. |
| `--schema-only` | فقط فایل‌های طرح‌واره را می‌نویسد. |
| `--force` | فایل‌های طرح‌وارهٔ موجود را بازنویسی می‌کند و درون نوع‌های محتوایی که از قبل مدخل دارند درون‌ریزی می‌کند. |

آنچه نوشته و درون‌ریزی کرده را چاپ می‌کند، با هشدار برای آنچه نتوانسته منتقل کند، و
`strapi-id-map.json` را در ریشهٔ پروژه می‌نویسد: شناسه‌های Strapi و `documentId`ها و
شناسه‌های فایل جدیدشان در Verdin، برای اصلاح پیوندها در فرانت‌اند شما.

[مهاجرت از Strapi](/fa/migrate/from-strapi/) را ببینید.

## `verdin import verdin`

```text title="Terminal"
verdin import verdin <PATH> [--force]
```

بایگانی‌ای را که `verdin export` نوشته درون‌ریزی می‌کند: فایل‌های طرح‌واره، زبان‌ها، رسانه و مدخل‌ها.

| آرگومان یا گزینه | توضیح |
| --- | --- |
| `<PATH>` | فایل `.tar.gz`. |
| `--force` | فایل‌های طرح‌واره‌ای را که متفاوت‌اند بازنویسی می‌کند و درون نوع‌های محتوایی که از قبل مدخل دارند درون‌ریزی می‌کند. |

## `verdin export`

```text title="Terminal"
verdin export <OUTPUT> [--no-media]
```

طرح‌واره، محتوا و رسانهٔ پروژه را در یک بایگانی `.tar.gz` می‌نویسد: یک نسخهٔ پشتیبان، یا راهی
برای انتقال پروژه به نمونه‌ای دیگر با `verdin import verdin`. بایگانی
همهٔ نسخه‌های همهٔ مدخل‌ها (پیش‌نویس‌ها، نسخه‌های منتشرشده، زبان‌ها) را با روابطشان نگه می‌دارد.
حساب‌های مدیر، توکن‌های API و تنظیمات شامل نمی‌شوند.

| آرگومان یا گزینه | توضیح |
| --- | --- |
| `<OUTPUT>` | بایگانی‌ای که نوشته می‌شود. |
| `--no-media` | کتابخانهٔ رسانه را کنار می‌گذارد: فایل‌ها، پوشه‌ها و پیوندهای مدخل‌ها به آن‌ها. |

```text title="Terminal"
$ verdin export backup.tar.gz
exported to backup.tar.gz: 42 documents (57 versions), 18 files, 3 folders, 2 locales
```

[پشتیبان‌گیری](/fa/deploy/backups/) را ببینید.

## `verdin healthcheck`

```text title="Terminal"
verdin healthcheck [--port <PORT>]
```

`GET /_health` را از سرور روی همین ماشین (`127.0.0.1`، با `[server].port` در
پیکربندی) درخواست می‌کند و وقتی پاسخ `200` باشد با وضعیت 0 خارج می‌شود، وگرنه با 1، و دلیل را چاپ می‌کند.
به shell، `curl` یا کلاینت HTTP نیاز ندارد، بنابراین ایمیج Docker از آن به‌عنوان
`HEALTHCHECK` خود استفاده می‌کند؛ به همین شکل در Compose یا هر ناظری که فرمان اجرا می‌کند از آن استفاده کنید.

| گزینه | توضیح |
| --- | --- |
| `--port <PORT>` | به جای `[server].port` این درگاه را بررسی می‌کند. |

```text title="Terminal"
$ verdin healthcheck
ok
```

[پایش](/fa/deploy/monitoring/) را ببینید.

## `verdin secrets`

```text title="Terminal"
verdin secrets
```

یک `VERDIN_ADMIN_JWT_SECRET` و `VERDIN_TOKEN_PEPPER` تازه چاپ می‌کند، آماده برای یک فایل `.env`
یا محل نگهداری کلیدهای محرمانهٔ پلتفرم شما. هیچ پروژه‌ای را نمی‌خواند.

تغییر `VERDIN_ADMIN_JWT_SECRET` توکن‌های دسترسی کوتاه‌مدت مدیران و کاربران نهایی، پیوندهای
پیش‌نمایش باز و ورودهای OAuth در حال انجام را باطل می‌کند؛ پنل مدیریت و کلاینت‌هایی که از توکن
تازه‌سازی (refresh token) استفاده می‌کنند، خودشان توکن‌های جدید می‌گیرند. تغییر `VERDIN_TOKEN_PEPPER`
توکن‌های ذخیره‌شده (از جمله توکن‌های API) را باطل می‌کند، پس پس از شروع استفاده آن را ثابت نگه دارید.

## `verdin version`

```text title="Terminal"
verdin version
```

`verdin` و نسخه را چاپ می‌کند، مانند `verdin --version`.
