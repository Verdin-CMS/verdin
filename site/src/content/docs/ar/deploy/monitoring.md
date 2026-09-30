---
title: المراقبة
description: راقب نسخة Verdin قيد التشغيل — فحصا /_health و/_ready، ومقاييس Prometheus على /_metrics ولوحة Grafana، وتتبعات OpenTelemetry، وتقارير أخطاء Sentry، وصيغة السجلات ومستوياتها ومعرّفات الطلبات.
sidebar:
  order: 10
---

تبلّغ نسخة Verdin عن حالتها عبر نقطتي نهاية للسلامة، ومقاييس Prometheus
اختيارية، وتتبعات OpenTelemetry وتقارير أخطاء Sentry اختيارية، وسجلات مهيكلة.
تسرد هذه الصفحة ما يعيده كل منها وكيفية تفعيله.

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
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`، `kind`، `function` | الوقت الذي استغرقته دوال [الإضافات](/ar/extending/plugins/). الفئات نفسها. |
| `verdin_plugin_call_errors_total` | counter | `plugin`، `kind`، `function` | استدعاءات الإضافات التي فشلت: trap، أو انتهاء المهلة، أو مخرجات ليست JSON، أو `{ error }` من دالة البدء. |
| `verdin_webhook_deliveries_pending` | gauge | | عمليات تسليم الـ webhook التي تنتظر الإرسال. |
| `verdin_realtime_subscribers` | gauge | | تدفقات أحداث الوقت الفعلي المفتوحة. |
| `verdin_cluster_events_total` | counter | `direction` | الأحداث على [ناقل الأحداث المشترك](/ar/deploy/scaling/#ناقل-الأحداث-المشترك)، مع تعيين `[cluster].bus`: `sent` أُرسلت إلى النسخ الأخرى، و`received` استُلمت منها، و`dropped` أُسقطت (طابور ممتلئ أو كتابة فاشلة). |
| `verdin_uptime_seconds` | gauge | | الثواني منذ بدء العملية. |
| `verdin_build_info` | gauge | `version` | دائمًا 1؛ الإصدار العامل. |

`area` هو جزء الخادم: `api` (API المحتوى)، و`admin_api`، و`admin` (ملفات
اللوحة)، و`graphql`، و`mcp`، و`uploads`، و`internal` (المسارات التي تبدأ بـ `/_`) أو `other`.
و`status` فئة الحالة: `2xx` أو `3xx` أو `4xx` أو `5xx`.
في استدعاءات الإضافات، يكون `kind` هو `hook` أو `route` أو `job` أو `startup` أو `graphql`؛ وتظهر سلاسل
الإضافات بعد أول استدعاء (راجع
[مرجع الإضافات](/ar/extending/plugin-reference/#المقاييس)).

تنبيهات مفيدة: فشل `/_ready`، وارتفاع نسبة `5xx`، وتزايد
`verdin_webhook_deliveries_pending` (هدف webhook متوقف)، وارتفاع
`verdin_plugin_call_errors_total` أو بطء خطافات الإضافات (فهي تؤخر عمليات الكتابة التي تعمل عليها)،
وإعادة تصفير `verdin_uptime_seconds` (إعادات التشغيل).

### لوحة Grafana

[`docker/grafana/verdin.json`](https://github.com/Verdin-CMS/verdin/blob/main/docker/grafana/verdin.json)
لوحة لهذه المقاييس: معدل الطلبات، ونسبة `5xx`، وكميّات زمن الاستجابة حسب
المنطقة والطريقة وفئة الحالة، وعمليات تسليم webhook المعلّقة، ومشتركو الوقت الفعلي، وحركة ناقل
الأحداث، ومعدل استدعاءات الإضافات وp95 والأخطاء لكل دالة إضافة. استوردها في Grafana
(**Dashboards ← New ← Import**) واختر مصدر بيانات Prometheus؛ ويُرشّح المتغيّران `instance` و
`area` في الأعلى كل لوحة فرعية.

## التتبعات (OpenTelemetry)

يستطيع Verdin تصدير تتبع لكل طلب إلى مجمّع OpenTelemetry (OpenTelemetry
Collector أو Grafana Alloy أو Tempo أو Jaeger أو Honeycomb أو Datadog…) عبر
OTLP/HTTP. وهو معطّل افتراضيًا:

```toml title="verdin.toml"
[telemetry]
enabled = true
endpoint = "http://otel-collector:4318"
```

تعمل المتغيرات القياسية أيضًا وتتقدّم على الملف:

```sh
VERDIN_TELEMETRY__ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<key>
OTEL_SERVICE_NAME=cms-production
```

يحتوي كل تتبع على:

- **span للطلب** (من النوع `server`)، يُسمّى بالطريقة والمسار مع استبدال المعرّفات بـ
  `{id}` (`PUT /api/articles/{id}`)، مع `http.response.status_code` وحالة
  خطأ عند `5xx`. الطلب الذي يحمل ترويسة W3C `traceparent` ينضم إلى تتبع
  المستدعي.
- **span لكل عبارة قاعدة بيانات** (من النوع `client`) تحته: `db.system.name`
  (`postgresql` أو `mysql` أو `mariadb` أو `sqlite`) و`db.query.text`، أي SQL مع
  عناصره النائبة `?`. لا تُسجَّل القيم المرتبطة أبدًا، فيبقى المحتوى وكلمات المرور والرموز
  خارج التتبعات. ولـ `COMMIT` و`ROLLBACK` spans خاصة بهما، وفي SQLite يُظهر
  span باسم `write lock` المدة التي انتظرتها الكتابة لكتّاب سبقوها.
- أحداث السجل المكتوبة أثناء تقديم الطلب، كأحداث على الـ span.

العبارات التي تعمل خارج الطلب (البدء، والترحيلات، والمهام الخلفية) لا تُتتبَّع.
يحتفظ `[telemetry].sample_ratio` بجزء من التتبعات (`0.1` يحتفظ بواحد من كل عشرة)؛
وتُرسل الـ spans على دفعات وتُفرَّغ عند إيقاف الخادم. لا يُرشّح مستوى السجل
التتبعات: فـ `[log].level = "warn"` لا يزال يصدّر كل طلب.

## الإبلاغ عن الأخطاء (Sentry)

عيّن DSN لإرسال حالات الـ panic واستجابات `5xx` إلى [Sentry](https://sentry.io) (أو خدمة
متوافقة مع Sentry مثل GlitchTip):

```sh
SENTRY_DSN=https://<key>@o0.ingest.sentry.io/<project>
```

يعمل `[telemetry].sentry_dsn` أيضًا؛ والمتغيّر هو الأغلب. تصل استجابة `5xx` كحدث خطأ
`POST /api/articles answered 500`، موسومًا بـ `http.method` و`http.status_code` و
`request_id`، الذي يطابق ترويسة `X-Request-Id` وأسطر سجل ذلك الطلب.
تحمل الأحداث إصدار Verdin كـ release، و`production` (`verdin start`) أو
`development` (`verdin dev`) كبيئة، ما لم يسمِّ `SENTRY_ENVIRONMENT` أو
`[telemetry].sentry_environment` بيئة أخرى. تُبلَّغ عناوين URL مع إخفاء قيم الاستعلام
التي تبدو سرّية، كما في السجلات؛ ولا تُرسل أجسام الطلبات ولا ترويساتها أبدًا.

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
