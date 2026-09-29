---
title: پایش
description: یک نمونهٔ در حال اجرای Verdin را زیر نظر بگیرید — بررسی‌های /_health و /_ready، متریک‌های Prometheus در /_metrics و توکن آن‌ها، قالب لاگ، سطح‌ها و شناسهٔ درخواست‌ها.
sidebar:
  order: 10
---

یک نمونهٔ Verdin از طریق دو نقطهٔ پایانی سلامت، متریک‌های اختیاری Prometheus
و لاگ‌های ساخت‌یافته دربارهٔ خودش گزارش می‌دهد. این صفحه فهرست می‌کند که هر کدام چه برمی‌گرداند و چگونه
روشن می‌شود.

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
| `verdin_webhook_deliveries_pending` | gauge | | ارسال‌های وب‌هوک در انتظار فرستاده شدن. |
| `verdin_realtime_subscribers` | gauge | | جریان‌های رویداد بلادرنگ باز. |
| `verdin_uptime_seconds` | gauge | | ثانیه‌ها از زمان شروع فرایند. |
| `verdin_build_info` | gauge | `version` | همیشه 1؛ نسخهٔ در حال اجرا. |

`area` بخشی از سرور است: `api` (API محتوا)، `admin_api`، `admin` (فایل‌های
پنل)، `graphql`، `mcp`، `uploads`، `internal` (مسیرهایی که با `/_` شروع می‌شوند) یا `other`.
`status` کلاس وضعیت است: `2xx`، `3xx`، `4xx` یا `5xx`.

هشدارهای مفید: شکست `/_ready`، افزایش سهم `5xx`، رشد
`verdin_webhook_deliveries_pending` (یک مقصد وب‌هوک از دسترس خارج است)، و صفر شدن دوبارهٔ `verdin_uptime_seconds`
(راه‌اندازی‌های مجدد).

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
