---
title: مرجع پیکربندی
description: همهٔ بخش‌ها و کلیدهای verdin.toml با مقدارهای پیش‌فرض، و متغیرهای محیطی که Verdin می‌خواند.
sidebar:
  order: 1
  label: پیکربندی
---

<!-- Written from crates/verdin/src/config.rs, crates/verdin-upload/src/config.rs and
crates/verdin-email/src/lib.rs, crates/verdin-upload/src/transform.rs,
crates/verdin-search/src/lib.rs, crates/verdin-api/src/cdn.rs, crates/verdin-api/src/ai.rs
and crates/verdin/src/telemetry.rs.
Keep it in step when keys change. -->

پیکربندی لایه‌لایه است: **پیش‌فرض‌های داخلی → `verdin.toml` → محیط**. این
فایل اختیاری است؛ هر کلید یک مقدار پیش‌فرض دارد. کلیدهای ناشناخته رد می‌شوند، بنابراین یک غلط تایپی
به جای نادیده گرفته شدن، هنگام شروع باعث شکست می‌شود.

- هر کلید را با `VERDIN_<SECTION>__<KEY>` (دو زیرخط) بازنویسی کنید، برای مثال
  `VERDIN_SERVER__PORT=8080` یا `VERDIN_ADMIN__SECURE_COOKIES=false`. جدول‌های تودرتو یک
  `__` دیگر می‌گیرند: `VERDIN_ADMIN__BRANDING__TITLE=ACME`. کلیدهای ناشناخته اینجا هم رد می‌شوند،
  بنابراین هر متغیری که با `VERDIN_` شروع شود و `__` داشته باشد باید نام یک کلید واقعی باشد.
- `VERDIN_DATABASE_URL` شکل کوتاه `database.url` است.
- فایل، `verdin.toml` در پوشهٔ کاری است، یا مسیری که با
  `-c, --config` یا `VERDIN_CONFIG` داده شود. مسیرهای نسبی درون آن (طرح‌واره، افزونه‌ها، بارگذاری‌ها،
  فایل‌های SQLite) نسبت به پوشهٔ همین فایل تعیین می‌شوند.
- یک فایل `.env` کنار پیکربندی ابتدا بارگذاری می‌شود؛ متغیرهایی که از قبل در
  محیط تنظیم شده‌اند اولویت دارند.

کلیدهای محرمانه هرگز از `verdin.toml` خوانده نمی‌شوند؛ [متغیرهای محیطی](#متغیرهای-محیطی) را ببینید.

## `[server]`

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `host` | `"0.0.0.0"` | نشانی‌ای که روی آن گوش می‌دهد. |
| `port` | `1337` | درگاهی که روی آن گوش می‌دهد. |
| `public_url` | تنظیم‌نشده | جایی که مرورگرها به سرور می‌رسند، مثلاً `"https://cms.example.com"`. برای پیوندهای ایمیل‌ها و callbackهای SSO به کار می‌رود؛ پیش‌فرض آن `http://localhost:{port}` است. |
| `body_limit` | `"1mb"` | بزرگ‌ترین بدنهٔ درخواست در درخواست‌های معمولی API (بارگذاری‌ها محدودیت خودشان را دارند). عددی بر حسب بایت یا رشته‌ای با `b`، `kb`، `mb` یا `gb`. |
| `request_timeout_secs` | `30` | محدودیت زمانی درخواست‌های معمولی API. |
| `sync_interval_secs` | `10` | هر چند وقت یک بار تنظیماتی که نمونه‌های دیگر تغییر داده‌اند دریافت شود (قابلیت‌ها، روشن/خاموش بودن افزونه‌ها، زبان‌ها، گردش‌کارهای بازبینی)؛ `0` آن را خاموش می‌کند (یک نمونهٔ واحد). |
| `trusted_proxies` | `[]` | reverse proxyهایی (IP یا بازه‌های CIDR، مثلاً `["10.0.0.0/8"]`) که `X-Forwarded-For` آن‌ها نشانی کلاینت را مشخص می‌کند. محدودیت‌های نرخ و گزارش‌های حسابرسی از آن نشانی استفاده می‌کنند؛ بدون آن، همهٔ کلاینت‌های پشت proxy یک نشانی مشترک دارند. |

## `[database]`

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `url` | تنظیم‌نشده | URL اتصال: `postgres://…`، `mysql://…` (MySQL و MariaDB) یا `sqlite://…`. الزامی؛ معمولاً از طریق `VERDIN_DATABASE_URL` تنظیم می‌شود. |
| `pool_max` | `10` | بیشترین تعداد اتصال در pool. |

## `[schema]`

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `path` | `"schema"` | پوشهٔ طرح‌واره، نسبت به فایل پیکربندی. |

## `[api]`

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `prefix` | `"/api"` | مسیری که API محتوا زیر آن ارائه می‌شود. باید با `/` شروع شود و با آن تمام نشود. |
| `default_page_size` | `25` | اندازهٔ صفحه وقتی درخواست آن را تعیین نکند. بین 1 و `max_page_size`. |
| `max_page_size` | `100` | بزرگ‌ترین اندازهٔ صفحه‌ای که یک درخواست می‌تواند بخواهد. |
| `decimal_as_string` | `false` | اعداد اعشاری را به‌صورت رشته (دقیق) serialize می‌کند، به جای عدد (سازگار با Strapi). |
| `public_rate_limit` | `0` | درخواست در دقیقه برای هر IP کلاینت بدون توکن (`0`: نامحدود). |
| `token_rate_limit` | `0` | درخواست در دقیقه برای هر توکن API یا کاربر نهایی (`0`: نامحدود). |
| `cache_ttl_secs` | `0` | خواندن‌های ناشناس را به این مدت در حافظه نگه می‌دارد (`0`: بدون کش)؛ تغییرات کش را خالی می‌کنند. |
| `cache_entries` | `1000` | بیشترین تعداد پاسخ‌های کش‌شده. |
| `cors_origins` | `[]` | originهای مرورگر که اجازه دارند API محتوا و GraphQL را از سایتی دیگر فراخوانی کنند (`["https://www.example.com"]`: scheme، host و port، بدون مسیر)، یا `["*"]` برای همه (به‌تنهایی: `*` را نمی‌توان با originها ترکیب کرد). خالی: فقط صفحه‌های هم‌origin می‌توانند آن‌ها را از مرورگر فراخوانی کنند. API مدیریت هرگز فراخوانی cross-origin نمی‌پذیرد. |

## `[admin]`

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `path` | `"/admin"` | مسیری که پنل مدیریت زیر آن ارائه می‌شود؛ API آن در `{path}/api` قرار دارد. |
| `secure_cookies` | تنظیم‌نشده | کوکی refresh را با `Secure` علامت‌گذاری می‌کند. تنظیم‌نشده یعنی بله در `verdin start` و نه در `verdin dev` (توسعهٔ محلی با HTTP ساده). |
| `auth_rate_limit` | `20` | تلاش‌های ورود، ثبت‌نام و refresh برای هر IP کلاینت در دقیقه. |
| `assets_dir` | تنظیم‌نشده | پنل مدیریت را از این پوشه (نسبت به فایل پیکربندی) ارائه می‌کند، به جای نسخهٔ جاسازی‌شده در فایل باینری. |

### `[admin.branding]`

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `title` | `"Verdin"` | در نوار کناری، در صفحهٔ ورود و در زبانهٔ مرورگر نمایش داده می‌شود. |
| `logo` | تنظیم‌نشده | فایل تصویر (SVG، PNG، WebP)، نسبت به فایل پیکربندی. |
| `favicon` | تنظیم‌نشده | فایل آیکون (ICO، PNG، SVG)، نسبت به فایل پیکربندی. |
| `accent` | تنظیم‌نشده | رنگ `#rrggbb` دکمه‌ها، پیوندها و حلقه‌های focus. |
| `translations` | `{}` | متن‌های پنل مدیریت که برای هر زبان جایگزین می‌شوند، برای مثال `[admin.branding.translations.en]` با `"auth.login.title" = "Welcome to ACME"`. کلیدها همان کلیدهای `admin/public/i18n/en.json` هستند. |

## `[upload]`

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `provider` | `{ name = "local", dir = "public/uploads" }` | محل ذخیرهٔ فایل‌ها؛ پایین‌تر را ببینید. |
| `max_file_size` | `209715200` | بزرگ‌ترین فایل پذیرفته‌شده، بر حسب بایت (200 MB). |
| `responsive_formats` | `true` | برای تصاویر raster قالب‌های responsive تولید می‌کند. |
| `breakpoints` | large 1000، medium 750، small 500 | قالب‌های responsive به شکل جدول‌های `{ name, width }` (همان `breakpoints` در Strapi). قالب‌هایی که از تصویر پهن‌ترند کنار گذاشته می‌شوند. |
| `max_image_megapixels` | `100` | محدودیت decode در برابر بمب‌های فشرده‌سازی، بر حسب مگاپیکسل. |
| `max_original_size` | تنظیم‌نشده | تصاویر raster اصلی که بزرگ‌تر از این تعداد پیکسل باشند (در هر یک از دو ضلع) هنگام بارگذاری کوچک می‌شوند، که فرادادهٔ آن‌ها (EXIF، GPS) را هم حذف می‌کند. تنظیم‌نشده، اصل‌ها را همان‌طور که فرستاده شده‌اند نگه می‌دارد. |

```toml
[upload]
breakpoints = [{ name = "large", width = 1000 }, { name = "small", width = 500 }]
```

### ارائه‌دهندهٔ محلی

فایل‌ها زیر `dir` (نسبت به پروژه) قرار می‌گیرند و Verdin آن‌ها را در `/uploads` ارائه می‌کند.

```toml
[upload]
provider = { name = "local", dir = "public/uploads" }
```

### `[upload.transforms]`

تبدیل تصویر برای فایل‌های محلی: `/uploads/<file>?preset=thumb`، یا
`?w=&h=&fit=&format=&q=` همراه با امضا. نتیجه‌ها روی دیسک کش می‌شوند و وقتی فایل تغییر کند
(از جمله نقطهٔ کانونی آن) دور ریخته می‌شوند. برش‌های cover نقطهٔ کانونی فایل را در دید
نگه می‌دارند؛ تصاویر هرگز بزرگ‌تر نمی‌شوند. JPEG، PNG، WebP، TIFF و BMP قابل
تبدیل‌اند (نه GIFها، که ممکن است متحرک باشند).

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `enabled` | `true` | تبدیل‌ها را ارائه می‌کند. |
| `presets` | `{}` | تبدیل‌های نام‌دار، همیشه مجاز: `{ w, h, fit, format, q }`. |
| `allow_arbitrary` | `false` | هر پارامتری را بدون امضا می‌پذیرد. هر URL متمایز render و کش می‌شود، پس فقط برای شبکه‌های مورد اعتماد. |
| `max_size` | `4096` | بزرگ‌ترین `w` یا `h`، بر حسب پیکسل. |
| `cache_dir` | `".cache/transforms"` | جایی که نتیجه‌ها نگه داشته می‌شوند (نسبت به پروژه؛ حذف آن بی‌خطر است). |

پارامترها: `w`، `h` (پیکسل)، `fit` (`cover`، پیش‌فرض، تصویر را به اندازهٔ کادر برش می‌دهد؛ `inside`
آن را درون کادر جا می‌دهد؛ `fill` آن را می‌کشد)، `format` (`jpeg`، `png`، `webp`؛ خروجی WebP
بدون افت است) و `q` (کیفیت JPEG، 1–100، پیش‌فرض 80).

```toml
[upload.transforms.presets]
thumb = { w = 300, h = 300 }
hero = { w = 1600, h = 600, format = "webp" }
```

**URLهای امضاشده.** وقتی `VERDIN_IMAGE_SECRET` تنظیم شده باشد، `s` مقدار hex از HMAC-SHA256 روی
`<file>?<canonical query>` است، که در آن canonical query پارامترهای غیرپیش‌فرض را
مرتب‌شده بر اساس نام فهرست می‌کند (`fit`، `format`، `h`، `q`، `w`؛ `fit=cover` حذف می‌شود):

```js
import { createHmac } from 'node:crypto';
const s = createHmac('sha256', process.env.VERDIN_IMAGE_SECRET)
  .update('photo_1a2b.jpg?format=webp&w=800')
  .digest('hex');
const url = `/uploads/photo_1a2b.jpg?format=webp&w=800&s=${s}`;
```

### ارائه‌دهندهٔ S3

هر سرویس سازگار با S3 (AWS، Cloudflare R2، MinIO، Backblaze B2…). اطلاعات ورود
از متغیرهای محیطی استاندارد `AWS_*` (`AWS_ACCESS_KEY_ID`،
`AWS_SECRET_ACCESS_KEY`) می‌آیند.

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `bucket` | الزامی | نام bucket. |
| `region` | تنظیم‌نشده | region مربوط به bucket. |
| `endpoint` | تنظیم‌نشده | نقطهٔ پایانی سفارشی برای سرویس‌های غیر AWS، مثلاً `https://<account>.r2.cloudflarestorage.com`. |
| `public_url` | الزامی | URL پایهٔ عمومی bucket یا CDN آن؛ فایل‌ها به شکل `{public_url}/{key}` پیوند داده می‌شوند. |
| `prefix` | `""` | پیشوند کلید درون bucket. |
| `path_style` | `false` | درخواست‌های path-style (MinIO و بیشتر سرویس‌های خودمیزبان). |

```toml
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

## `[webhooks]`

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `allow_private_networks` | تنظیم‌نشده | URLهای وب‌هوک روی نشانی‌های loopback، خصوصی و link-local را مجاز می‌کند؛ برای مقصدهای استقرار و وب‌هوک `[cdn]` هم اعمال می‌شود. تنظیم‌نشده یعنی نه در `verdin start` (وگرنه یک مدیر می‌توانست به سرویس‌های داخلی برسد) و بله در `verdin dev`. |
| `timeout_secs` | `10` | محدودیت زمانی هر ارسال. |
| `retention_days` | `30` | تعداد روزهایی که گزارش ارسال‌ها نگه داشته می‌شود. |

[وب‌هوک‌ها](/fa/guides/integrations/webhooks/) را ببینید.

## `[history]`

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `max_versions` | `50` | نسخه‌هایی که برای هر سند نگه داشته می‌شوند (نسخه‌های قدیمی‌تر حذف می‌شوند). |

## `[email]`

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `provider` | `"log"` | `log` (ایمیل‌ها را در لاگ می‌نویسد)، `smtp`، `resend` یا `postmark`. |
| `from` | `"Verdin <no-reply@localhost>"` | فرستنده. |
| `reply_to` | تنظیم‌نشده | نشانی reply-to. |

### `[email.smtp]`

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `host` | `"localhost"` | سرور SMTP. |
| `port` | `587` | درگاه SMTP. |
| `username` | تنظیم‌نشده | کاربر SMTP؛ گذرواژه از `VERDIN_EMAIL_SMTP_PASSWORD` می‌آید. |
| `security` | `"starttls"` | `starttls`، `tls` (ضمنی، معمولاً درگاه 465) یا `none` (relayهای محلی). |

## `[plugins]`

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `path` | `"plugins"` | پوشهٔ افزونه‌ها (هر کدام یک زیرپوشه)، نسبت به فایل پیکربندی. |
| `run_jobs` | `true` | کارهای زمان‌بندی‌شدهٔ افزونه‌ها را روی این نمونه اجرا می‌کند (وقتی چند نمونه وجود دارد، روی یکی). |

[افزونه‌ها](/fa/extending/plugins/) را ببینید.

## `[audit]`

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `retention_days` | `90` | تعداد روزهایی که مدخل‌های گزارش حسابرسی نگه داشته می‌شوند. |

## `[digest]`

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `enabled` | `true` | خلاصهٔ روزانه را از این نمونه می‌فرستد (وقتی چند نمونه وجود دارد، از یکی). |
| `hour_utc` | `8` | ساعتی (UTC، 0–23) که خلاصهٔ روزانهٔ تغییرات دیده‌نشده فرستاده می‌شود. |

## `[log]`

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `format` | `"pretty"` | `pretty` یا `json`. |
| `level` | تنظیم‌نشده (`info`) | فیلتر پیش‌فرض؛ وقتی `RUST_LOG` تنظیم شده باشد، اولویت با آن است. |

## `[metrics]`

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `enabled` | `false` | متریک‌های Prometheus را در `/_metrics` ارائه می‌کند: درخواست‌های HTTP بر اساس بخش (`api`، `admin_api`، `graphql`، `mcp`، `uploads`…)، روش و ردهٔ وضعیت همراه با histogramهای تأخیر، ارسال‌های در انتظار وب‌هوک، جریان‌های بلادرنگ باز، ترافیک گذرگاه رویداد و uptime. |
| `token` | تنظیم‌نشده | scrapeها به `Authorization: Bearer <token>` نیاز دارند. `VERDIN_METRICS_TOKEN` بر آن اولویت دارد. بدون توکن، هر کسی که به درگاه برسد می‌تواند متریک‌ها را بخواند. |

## `[telemetry]`

ردیابی‌ها و گزارش‌های خطا، هر دو به‌طور پیش‌فرض خاموش‌اند و فقط توسط `verdin start` و
`verdin dev` استفاده می‌شوند (بخش [پایش](/fa/deploy/monitoring/#ردیابیها-opentelemetry) را ببینید).

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `enabled` | `false` | ردیابی‌های OpenTelemetry درخواست‌های HTTP و کوئری‌های پایگاه دادهٔ آن‌ها را از طریق OTLP/HTTP (protobuf) صادر می‌کند. `OTEL_SDK_DISABLED=true` آن را خاموش می‌کند. |
| `endpoint` | تنظیم‌نشده (`http://localhost:4318`) | URL پایهٔ collector؛ `/v1/traces` به آن اضافه می‌شود. `OTEL_EXPORTER_OTLP_ENDPOINT` (URL پایه) و `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (URL کامل) اولویت دارند. |
| `service_name` | `"verdin"` | `service.name` ردیابی‌ها. `OTEL_SERVICE_NAME` اولویت دارد. |
| `sample_ratio` | `1.0` | سهم ردیابی‌هایی که نگه داشته می‌شوند، از `0.0` تا `1.0`. درخواستی که هدر `traceparent` دارد از تصمیم فراخواننده پیروی می‌کند. |
| `sentry_dsn` | تنظیم‌نشده | panicها و پاسخ‌های 5xx را به Sentry گزارش می‌دهد. `SENTRY_DSN` اولویت دارد. |
| `sentry_environment` | تنظیم‌نشده | environment در Sentry. `SENTRY_ENVIRONMENT` اولویت دارد؛ اگر تنظیم نشود، در `verdin start` برابر `production` و در `verdin dev` برابر `development` است. |

## `[ai]`

کنش‌های هوش مصنوعی در پنل مدیریت (وقتی قابلیت **اقدامات هوش مصنوعی** در تنظیمات ← قابلیت‌ها روشن باشد): ترجمهٔ یک
مدخل به زبانی دیگر، نوشتن متن جایگزین برای تصاویر، خلاصه کردن متن، پیشنهاد فرادادهٔ
SEO. این کنش‌ها پیشنهاد برمی‌گردانند؛ هیچ چیزی بدون ویرایشگر ذخیره نمی‌شود. کلید
از `VERDIN_AI_KEY` خوانده می‌شود (سرورهای محلی به آن نیازی ندارند).

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `provider` | `"none"` | `anthropic`، `openai` یا `openai-compatible` (Ollama، LM Studio، vLLM…). |
| `model` | `claude-sonnet-5` برای `anthropic` | مدل؛ برای ارائه‌دهنده‌های دیگر الزامی است. |
| `base_url` | مقدار ارائه‌دهنده | یک نقطهٔ پایانی دیگر، مثلاً `http://localhost:11434/v1`. |
| `max_tokens` | `2048` | طولانی‌ترین پاسخ. |

```toml
[ai]
provider = "anthropic"
```

هر مدیر می‌تواند در دقیقه 30 درخواست هوش مصنوعی داشته باشد. محتوا و تصاویر به
ارائه‌دهنده فرستاده می‌شوند: ارائه‌دهنده‌ای را انتخاب کنید که سازمان شما مجاز می‌داند.

## `[cdn]`

وقتی محتوا به‌صورت عمومی تغییر می‌کند، کش‌های CDN را پاک‌سازی می‌کند. پاسخ‌های API محتوا با
`vd` و `vd-<singularName>` برچسب‌گذاری می‌شوند (هدرهای `Cache-Tag` و `Surrogate-Key`).

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `provider` | `"none"` | `cloudflare`، `fastly` یا `webhook`. |
| `zone_id` | تنظیم‌نشده | zone در Cloudflare (پاک‌سازی بر اساس tag). |
| `service_id` | تنظیم‌نشده | سرویس Fastly (پاک‌سازی بر اساس surrogate key). |
| `url` | تنظیم‌نشده | `webhook`: درخواست `POST { "tags": [...] }` را دریافت می‌کند. |
| `debounce_ms` | `1000` | مدتی که تغییرات پیش از پاک‌سازی جمع می‌شوند. |

توکن API از `VERDIN_CDN_TOKEN` خوانده می‌شود (برای وب‌هوک‌ها به‌صورت bearer token فرستاده می‌شود).

## `[search]`

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `enabled` | `false` | `_q` را با یک نمایهٔ تمام‌متن (Tantivy) رتبه‌بندی می‌کند، به جای `$containsi`. |
| `dir` | `"data/search"` | پوشهٔ نمایه، نسبت به پروژه. حذف آن باعث می‌شود نمایه در شروع بعدی دوباره ساخته شود. |
| `memory_mb` | `50` | بودجهٔ حافظه برای نمایه‌سازی. |

نمایه روی دیسک نمونه قرار دارد. با چند نمونه، [گذرگاه رویداد](#cluster) را روشن کنید تا
هر نمایه نوشتن‌های همهٔ نمونه‌ها را دنبال کند.

## `[cluster]`

گذرگاه رویداد مشترک، برای چند نمونه از یک پروژه (بخش
[اجرای چند نمونه](/fa/deploy/scaling/#گذرگاه-رویداد-مشترک) را ببینید).

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `bus` | `"none"` | `none`: رویدادهای بلادرنگ، حضور، ابطال کش و به‌روزرسانی‌های جستجو در هر نمونه می‌مانند. `database`: از طریق پایگاه دادهٔ پروژه به هر نمونه می‌رسند (`LISTEN/NOTIFY` در PostgreSQL، polling در MySQL، MariaDB و SQLite). |
| `poll_interval_ms` | `1000` | هر چند وقت MySQL، MariaDB و SQLite رویدادهای نمونه‌های دیگر را می‌خوانند. PostgreSQL با `NOTIFY` بیدار می‌شود و تنها وقتی نتواند listen کند از این سرعت استفاده می‌کند. |
| `instance_id` | تنظیم‌نشده (در هر شروع تصادفی) | نام این نمونه در گذرگاه و در لاگ‌ها. |

```toml
[cluster]
bus = "database"
```

آن را روی هر نمونه تنظیم کنید، یا با `VERDIN_CLUSTER__BUS=database`.

## متغیرهای محیطی

علاوه بر بازنویسی‌های `VERDIN_<SECTION>__<KEY>`، Verdin این متغیرها را می‌خواند:

| متغیر | توضیح |
| --- | --- |
| `VERDIN_CONFIG` | مسیر فایل پیکربندی (همانند `--config`). |
| `VERDIN_DATABASE_URL` | شکل کوتاه `database.url`. |
| `VERDIN_ADMIN_JWT_SECRET` | توکن‌های نشست مدیر را امضا می‌کند. الزامی، دست‌کم 32 بایت؛ آن را با `verdin secrets` تولید کنید. |
| `VERDIN_TOKEN_PEPPER` | هش کلیددار برای توکن‌های ذخیره‌شده. الزامی، دست‌کم 32 بایت؛ آن را با `verdin secrets` تولید کنید. |
| `VERDIN_ADMIN_PASSWORD` | گذرواژه برای `verdin admin create` و `verdin admin reset-password` (در غیر این صورت از stdin خوانده می‌شود)؛ [مرجع خط فرمان](/fa/reference/cli/) را ببینید. |
| `VERDIN_EMAIL_SMTP_PASSWORD` | گذرواژهٔ SMTP. |
| `VERDIN_EMAIL_API_KEY` | کلید API ارائه‌دهنده‌های Resend و Postmark. |
| `VERDIN_SSO_<ID>_SECRET` | client secret یک ارائه‌دهندهٔ SSO؛ `<ID>` شناسهٔ ارائه‌دهنده با حروف بزرگ است که `-` در آن به `_` تبدیل شده است ([ورود یکپارچه](/fa/guides/auth/sso/) را ببینید). |
| `VERDIN_OAUTH_<PROVIDER>_SECRET` | client secret یک ارائه‌دهندهٔ OAuth برای کاربران نهایی، با نام‌گذاری مشابه SSO ([کاربران نهایی](/fa/guides/auth/end-users/) را ببینید). |
| `VERDIN_AI_KEY` | کلید API ارائه‌دهندهٔ `[ai]`. |
| `VERDIN_CDN_TOKEN` | توکن API ارائه‌دهندهٔ `[cdn]`. |
| `VERDIN_IMAGE_SECRET` | URLهای تبدیل تصویر را امضا می‌کند ([`[upload.transforms]`](#uploadtransforms) را ببینید). |
| `VERDIN_METRICS_TOKEN` | bearer token برای scrapeهای `/_metrics` وقتی `[metrics].enabled` روشن است؛ بر `[metrics].token` اولویت دارد. |
| `OTEL_EXPORTER_OTLP_ENDPOINT`، `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | collector برای ردیابی‌های [`[telemetry]`](#telemetry)؛ بر `[telemetry].endpoint` اولویت دارند. سایر متغیرهای استاندارد `OTEL_EXPORTER_OTLP_*` (هدرها، timeout، فشرده‌سازی) هم اعمال می‌شوند. |
| `OTEL_SERVICE_NAME`، `OTEL_RESOURCE_ATTRIBUTES` | resource ردیابی‌های صادرشده؛ `OTEL_SERVICE_NAME` بر `[telemetry].service_name` اولویت دارد. |
| `OTEL_SDK_DISABLED` | `true` صادر کردن ردیابی را حتی وقتی `[telemetry].enabled` روشن است خاموش می‌کند. |
| `SENTRY_DSN`، `SENTRY_ENVIRONMENT` | گزارش خطای Sentry؛ بر `[telemetry].sentry_dsn` و `sentry_environment` اولویت دارند. |
| `AWS_ACCESS_KEY_ID`، `AWS_SECRET_ACCESS_KEY` | اطلاعات ورود ارائه‌دهندهٔ بارگذاری S3. |
| `RUST_LOG` | فیلتر لاگ؛ بر `[log].level` اولویت دارد. |
