---
title: المراقبة
description: راقب نسخة Verdin قيد التشغيل — فحصا /_health و/_ready، ومقاييس Prometheus على /_metrics ورمزها، وصيغة السجلات ومستوياتها ومعرّفات الطلبات.
sidebar:
  order: 10
---

تبلّغ نسخة Verdin عن حالتها عبر نقطتي نهاية للسلامة، ومقاييس Prometheus
اختيارية، وسجلات مهيكلة. تسرد هذه الصفحة ما يعيده كل منها وكيفية
تفعيله.

## فحوص السلامة

تُقدَّم نقطتا النهاية من جذر الخادم، خارج بادئات الـ API، ولا تحتاجان
إلى مصادقة.

| نقطة النهاية | تجيب | استخدمها لـ |
| --- | --- | --- |
| `GET /_health` | دائمًا `200 {"status":"ok"}` ما دامت العملية تقدّم HTTP. | فحص الحياة (liveness): أعِد تشغيل العملية عندما تتوقف عن الإجابة. |
| `GET /_ready` | `200 {"status":"ready","database":"postgres"}` عندما تجيب قاعدة البيانات على ping، و`503 {"status":"unavailable"}` عندما لا تجيب. | فحوص الجاهزية وموازن الأحمال: أرسل الحركة فقط إلى النسخ التي تجيب بـ 200. |

`database` هي `postgres` أو `mysql` أو `mariadb` أو `sqlite`. لا يتحقق `/_ready` من
الترحيلات: يرفض `verdin start` البدء ما دامت هناك ترحيلات معلّقة (ما لم
يطبّقها `--migrate`)، لذا فالخادم العامل ليس لديه أي منها.

```sh frame="terminal"
curl -s localhost:1337/_ready
{"status":"ready","database":"sqlite"}
```

## مقاييس Prometheus

فعّل المقاييس وعيّن رمزًا:

```toml title="verdin.toml"
[metrics]
enabled = true
```

```sh
VERDIN_METRICS_TOKEN=<a long random string>
```

عندئذ يقدّم `GET /_metrics` صيغة Prometheus النصية (الإصدار 0.0.4). مع رمز
(`VERDIN_METRICS_TOKEN`، الذي يتغلب على `[metrics].token`)، يحصل الجمع (scrape) الذي لا يحمل
`Authorization: Bearer <token>` على `401`. وبدون رمز، يستطيع أي شخص يصل إلى المنفذ
قراءة المقاييس.

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

مع عدة نسخ، اجمع من كل واحدة: فكل نسخة تعدّ طلباتها الخاصة.

| المقياس | النوع | التسميات | المعنى |
| --- | --- | --- | --- |
| `verdin_http_requests_total` | counter | `area`، `method`، `status` | طلبات HTTP المقدَّمة. |
| `verdin_http_request_duration_seconds` | histogram | `area`، `method`، `status` | وقت تقديم الطلبات. فئات (buckets) من 5 ms إلى 10 s. |
| `verdin_webhook_deliveries_pending` | gauge | | عمليات تسليم الـ webhook التي تنتظر الإرسال. |
| `verdin_realtime_subscribers` | gauge | | تدفقات أحداث الوقت الفعلي المفتوحة. |
| `verdin_uptime_seconds` | gauge | | الثواني منذ بدء العملية. |
| `verdin_build_info` | gauge | `version` | دائمًا 1؛ الإصدار العامل. |

`area` هو جزء الخادم: `api` (API المحتوى)، و`admin_api`، و`admin` (ملفات
اللوحة)، و`graphql`، و`mcp`، و`uploads`، و`internal` (المسارات التي تبدأ بـ `/_`) أو `other`.
و`status` فئة الحالة: `2xx` أو `3xx` أو `4xx` أو `5xx`.

تنبيهات مفيدة: فشل `/_ready`، وارتفاع نسبة `5xx`، وتزايد
`verdin_webhook_deliveries_pending` (هدف webhook متوقف)، وإعادة تصفير `verdin_uptime_seconds`
(إعادات التشغيل).

## السجلات

يكتب Verdin السجلات إلى الخطأ القياسي (standard error).

| الإعداد | القيم | الافتراضي |
| --- | --- | --- |
| `[log].format` | `pretty` (للطرفيات) أو `json` (كائن واحد لكل سطر) | `pretty`؛ و`json` في صورة Docker |
| `[log].level` | مستوى أو مرشّح: `error`، `warn`، `info`، `debug`، `trace`، أو لكل وحدة (`info,verdin_api=debug`) | `info` |
| `RUST_LOG` | الصيغة نفسها؛ يتغلب على `[log].level` عند تعيينه | غير معيَّن |

استخدم `json` في الإنتاج وأرسل الخطأ القياسي إلى نظام السجلات لديك. يبدو سطر JSON
هكذا:

```json
{"timestamp":"2026-09-29T09:27:16.444598Z","level":"INFO","fields":{"message":"verdin listening","address":"0.0.0.0:1337","mode":"production","version":"0.10.0"},"target":"verdin::app"}
```

عند بدء التشغيل، تشير أسطر `WARN` إلى إعدادات يجب إصلاحها في الإنتاج، مثل
`[email].provider is 'log'` أو تعطيل ملفات تعريف الارتباط الآمنة.

### الطلبات

يحصل كل طلب على معرّف طلب: ترويسة `X-Request-Id` الواردة إن وُجدت، أو
UUID جديد. يُعاد في ترويسة الاستجابة `X-Request-Id` ويُرفق بكل
سطر سجل يُكتب أثناء تقديم الطلب (`request_id`، مع `method` و`uri`).
مرّر الترويسة من وكيلك لتتبع طلب عبر الأنظمة.

لا تُسجَّل الطلبات واحدًا تلو الآخر في المستوى `info`. لتسجيل كل طلب مع
حالته وزمن استجابته، ارفع مستوى طبقة HTTP:

```sh
RUST_LOG=info,tower_http=debug
```

تُخفي عناوين URL المسجّلة قيم معاملات الاستعلام التي تبدو أسماؤها سرية (`token`،
`code`، `state`، `password`، `key`، `signature`، `jwt`…)، مثلًا
`/api/connect/github/callback?code=[hidden]`.

## في لوحة الإدارة

أضف أداة **النظام** إلى لوحة المعلومات الرئيسية لترى الإصدار وقاعدة البيانات
والمخطط بلمحة.
