---
title: پایش
description: یک نمونهٔ در حال اجرای Verdin را زیر نظر بگیرید — بررسی‌های /_health و /_ready، متریک‌های Prometheus در /_metrics و یک داشبورد Grafana، ردیابی‌های OpenTelemetry، گزارش خطای Sentry، قالب لاگ، سطح‌ها و شناسهٔ درخواست‌ها.
sidebar:
  order: 10
---

یک نمونهٔ Verdin از طریق دو نقطهٔ پایانی سلامت، متریک‌های اختیاری Prometheus،
ردیابی‌های اختیاری OpenTelemetry و گزارش‌های خطای Sentry، و لاگ‌های ساخت‌یافته دربارهٔ خودش گزارش می‌دهد.
این صفحه فهرست می‌کند که هر کدام چه برمی‌گرداند و چگونه روشن می‌شود.

## بررسی‌های سلامت

هر دو نقطهٔ پایانی در ریشهٔ سرور، بیرون از پیشوندهای API، ارائه می‌شوند و به
احراز هویت نیاز ندارند.

| نقطهٔ پایانی | پاسخ | کاربرد |
| --- | --- | --- |
| `GET /_health` | همیشه `200 {"status":"ok"}` تا وقتی فرایند به HTTP سرویس می‌دهد. | Liveness: وقتی فرایند دیگر پاسخ نمی‌دهد، آن را دوباره راه‌اندازی کنید. |
| `GET /_ready` | `200 {"status":"ready","database":"postgres"}` وقتی پایگاه داده به ping پاسخ می‌دهد، و `503 {"status":"unavailable"}` وقتی پاسخ نمی‌دهد. | Readiness و بررسی‌های load balancer: ترافیک را فقط به نمونه‌هایی بفرستید که 200 پاسخ می‌دهند. |

`database` یکی از `postgres`، `mysql`، `mariadb` یا `sqlite` است. `/_ready` مهاجرت‌ها را
بررسی نمی‌کند: `verdin start` تا وقتی مهاجرتی در انتظار باشد از شروع خودداری می‌کند (مگر اینکه
`--migrate` آن‌ها را اعمال کند)، پس سروری که در حال اجراست هیچ مهاجرت در انتظاری ندارد.

```sh frame="terminal"
curl -s localhost:1337/_ready
{"status":"ready","database":"sqlite"}
```

## متریک‌های Prometheus

متریک‌ها را روشن کنید و یک توکن تنظیم کنید:

```toml title="verdin.toml"
[metrics]
enabled = true
```

```sh
VERDIN_METRICS_TOKEN=<a long random string>
```

پس از آن `GET /_metrics` قالب متنی Prometheus (نسخهٔ 0.0.4) را ارائه می‌کند. با یک توکن
(`VERDIN_METRICS_TOKEN` که بر `[metrics].token` اولویت دارد)، یک scrape بدون
`Authorization: Bearer <token>` پاسخ `401` می‌گیرد. بدون توکن، هر کسی که به پورت دسترسی داشته باشد
می‌تواند متریک‌ها را بخواند.

```yaml title="prometheus.yml"
scrape_configs:
  - job_name: verdin
    metrics_path: /_metrics
    authorization:
      type: Bearer
      credentials: <the token>
    static_configs:
      - targets: ["verdin:1337"]
```

با چند نمونه، از هر کدام جداگانه scrape کنید: هر نمونه درخواست‌های خودش را می‌شمارد.

| متریک | نوع | Labelها | معنا |
| --- | --- | --- | --- |
| `verdin_http_requests_total` | counter | `area`، `method`، `status` | درخواست‌های HTTP پاسخ‌داده‌شده. |
| `verdin_http_request_duration_seconds` | histogram | `area`، `method`، `status` | زمان پاسخ به درخواست‌ها. bucketها از 5 ms تا 10 s. |
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`، `kind`، `function` | زمانی که تابع‌های [افزونه](/fa/extending/plugins/) گرفتند. همان bucketها. |
| `verdin_plugin_call_errors_total` | counter | `plugin`، `kind`، `function` | فراخوانی‌های افزونه که شکست خوردند: trap، time-out، خروجی‌ای که JSON نیست، یا `{ error }` یک تابع راه‌اندازی. |
| `verdin_webhook_deliveries_pending` | gauge | | ارسال‌های وب‌هوک در انتظار فرستاده شدن. |
| `verdin_realtime_subscribers` | gauge | | جریان‌های رویداد بلادرنگ باز. |
| `verdin_cluster_events_total` | counter | `direction` | رویدادهای [گذرگاه رویداد مشترک](/fa/deploy/scaling/#گذرگاه-رویداد-مشترک) وقتی `[cluster].bus` تنظیم شده است: `sent` به نمونه‌های دیگر، `received` از آن‌ها، `dropped` (صف پر یا نوشتن ناموفق). |
| `verdin_uptime_seconds` | gauge | | ثانیه‌ها از زمان شروع فرایند. |
| `verdin_build_info` | gauge | `version` | همیشه 1؛ نسخهٔ در حال اجرا. |

`area` بخشی از سرور است: `api` (API محتوا)، `admin_api`، `admin` (فایل‌های
پنل)، `graphql`، `mcp`، `uploads`، `internal` (مسیرهایی که با `/_` شروع می‌شوند) یا `other`.
`status` کلاس وضعیت است: `2xx`، `3xx`، `4xx` یا `5xx`.
برای فراخوانی‌های افزونه، `kind` برابر `hook`، `route`، `job`، `startup` یا `graphql` است؛ سری‌های افزونه
بعد از نخستین فراخوانی ظاهر می‌شوند (بخش
[مرجع افزونه](/fa/extending/plugin-reference/#متریکها) را ببینید).

هشدارهای مفید: شکست `/_ready`، افزایش سهم `5xx`، رشد
`verdin_webhook_deliveries_pending` (یک مقصد وب‌هوک از دسترس خارج است)، افزایش
`verdin_plugin_call_errors_total` یا hookهای کند افزونه (نوشتن‌هایی را که روی آن‌ها اجرا می‌شوند به تأخیر می‌اندازند)،
و صفر شدن دوبارهٔ `verdin_uptime_seconds` (راه‌اندازی‌های مجدد).

### داشبورد Grafana

[`docker/grafana/verdin.json`](https://github.com/Verdin-CMS/verdin/blob/main/docker/grafana/verdin.json)
یک داشبورد برای این متریک‌هاست: نرخ درخواست، سهم `5xx` و چندک‌های تأخیر بر حسب بخش، متد و کلاس وضعیت،
ارسال‌های وب‌هوک در انتظار، مشترکان بلادرنگ، ترافیک گذرگاه رویداد، و نرخ فراخوانی افزونه‌ها، p95 و خطاها برای هر
تابع افزونه. آن را در Grafana وارد کنید (**Dashboards → New → Import**) و منبع دادهٔ Prometheus خود را انتخاب کنید؛
متغیرهای `instance` و `area` در بالا همهٔ پنل‌ها را فیلتر می‌کنند.

## ردیابی‌ها (OpenTelemetry)

Verdin می‌تواند ردیابی هر درخواست را از طریق OTLP/HTTP به یک collector مربوط به OpenTelemetry (OpenTelemetry
Collector، Grafana Alloy یا Tempo، Jaeger، Honeycomb، Datadog…) صادر کند. به‌طور پیش‌فرض خاموش است:

```toml title="verdin.toml"
[telemetry]
enabled = true
endpoint = "http://otel-collector:4318"
```

متغیرهای استاندارد هم کار می‌کنند و بر فایل برتری دارند:

```sh
VERDIN_TELEMETRY__ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<key>
OTEL_SERVICE_NAME=cms-production
```

هر ردیابی شامل این‌هاست:

- **یک span درخواست** (از نوع `server`)، با نامی از متد و مسیر که شناسه‌ها در آن با `{id}` جایگزین شده‌اند
  (`PUT /api/articles/{id}`)، همراه با `http.response.status_code` و وضعیت خطا برای `5xx`. درخواستی با هدر W3C
  `traceparent` به ردیابی فراخواننده می‌پیوندد.
- **یک span برای هر دستور پایگاه داده** (از نوع `client`) زیر آن: `db.system.name`
  (`postgresql`، `mysql`، `mariadb` یا `sqlite`) و `db.query.text`، همان SQL با placeholderهای `?`
  خودش. مقدارهای bind‌شده هرگز ثبت نمی‌شوند، بنابراین محتوا، گذرواژه‌ها و توکن‌ها از ردیابی‌ها بیرون می‌مانند.
  `COMMIT` و `ROLLBACK` spanهای خودشان را دارند، و در SQLite یک span با نام `write lock` نشان می‌دهد یک نوشتن
  چقدر منتظر نویسنده‌های جلوتر از خود مانده است.
- رویدادهای لاگی که هنگام پاسخ به درخواست نوشته شده‌اند، به‌صورت رویدادهای span.

دستورهایی که بیرون از یک درخواست اجرا می‌شوند (راه‌اندازی، مهاجرت‌ها، کارهای پس‌زمینه) ردیابی نمی‌شوند.
`[telemetry].sample_ratio` سهمی از ردیابی‌ها را نگه می‌دارد (`0.1` از هر ده ردیابی یکی را نگه می‌دارد)؛
spanها به‌صورت دسته‌ای فرستاده می‌شوند و هنگام توقف سرور flush می‌شوند. سطح لاگ ردیابی‌ها را فیلتر نمی‌کند:
`[log].level = "warn"` همچنان هر درخواست را صادر می‌کند.

## گزارش خطا (Sentry)

یک DSN تنظیم کنید تا panicها و پاسخ‌های `5xx` به [Sentry](https://sentry.io) (یا سرویسی سازگار با Sentry
مانند GlitchTip) فرستاده شوند:

```sh
SENTRY_DSN=https://<key>@o0.ingest.sentry.io/<project>
```

`[telemetry].sentry_dsn` هم کار می‌کند؛ متغیر برتری دارد. یک `5xx` به‌صورت رویداد خطای
`POST /api/articles answered 500` می‌رسد، با برچسب‌های `http.method`، `http.status_code` و
`request_id` که با هدر `X-Request-Id` و خط‌های لاگ همان درخواست مطابقت دارد.
رویدادها نسخهٔ Verdin را به‌عنوان release و `production` (`verdin start`) یا `development` (`verdin dev`) را
به‌عنوان environment دارند، مگر اینکه `SENTRY_ENVIRONMENT` یا `[telemetry].sentry_environment` نام دیگری بدهد.
URLها با پنهان‌کردن مقدارهای query که شبیه رمز هستند گزارش می‌شوند، مانند لاگ‌ها؛ بدنه و هدر درخواست‌ها هرگز
فرستاده نمی‌شوند.

## لاگ‌ها

Verdin لاگ‌ها را در standard error می‌نویسد.

| تنظیم | مقادیر | پیش‌فرض |
| --- | --- | --- |
| `[log].format` | `pretty` (برای ترمینال‌ها) یا `json` (یک شیء در هر خط) | `pretty`؛ `json` در ایمیج Docker |
| `[log].level` | یک سطح یا فیلتر: `error`، `warn`، `info`، `debug`، `trace`، یا به تفکیک ماژول (`info,verdin_api=debug`) | `info` |
| `RUST_LOG` | همان نحو؛ وقتی تنظیم شده باشد بر `[log].level` اولویت دارد | تنظیم‌نشده |

در محیط تولید از `json` استفاده کنید و standard error را به سیستم لاگ خود بفرستید. یک خط JSON
این شکلی است:

```json
{"timestamp":"2026-09-29T09:27:16.444598Z","level":"INFO","fields":{"message":"verdin listening","address":"0.0.0.0:1337","mode":"production","version":"0.10.0"},"target":"verdin::app"}
```

هنگام شروع، خط‌های `WARN` به تنظیماتی اشاره می‌کنند که باید در محیط تولید اصلاح شوند، مانند
`[email].provider is 'log'` یا خاموش بودن cookieهای امن.

### درخواست‌ها

هر درخواست یک شناسهٔ درخواست می‌گیرد: سرآیند `X-Request-Id` ورودی اگر وجود داشته باشد، یا
یک UUID جدید. این شناسه در سرآیند پاسخ `X-Request-Id` برگردانده می‌شود و به هر
خط لاگی که هنگام پاسخ به آن درخواست نوشته می‌شود پیوست می‌شود (`request_id`، همراه با `method` و `uri`).
سرآیند را از proxy خود عبور دهید تا یک درخواست را در سیستم‌های مختلف دنبال کنید.

درخواست‌ها در سطح `info` تک‌تک لاگ نمی‌شوند. برای لاگ کردن هر درخواست همراه با
وضعیت و تأخیر آن، سطح لایهٔ HTTP را بالا ببرید:

```sh
RUST_LOG=info,tower_http=debug
```

URLهای لاگ‌شده مقدار پارامترهای کوئری‌ای را که نامشان شبیه کلید محرمانه است پنهان می‌کنند (`token`،
`code`، `state`، `password`، `key`، `signature`، `jwt`…)، برای مثال
`/api/connect/github/callback?code=[hidden]`.

## در پنل مدیریت

ویجت **سیستم** را به داشبورد صفحهٔ اصلی اضافه کنید تا نسخه، پایگاه داده و
طرح‌واره را در یک نگاه ببینید.
