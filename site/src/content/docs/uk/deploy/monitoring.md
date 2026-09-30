---
title: Моніторинг
description: Спостереження за запущеним екземпляром Verdin — перевірки /_health і /_ready, метрики Prometheus на /_metrics і дашборд Grafana, трейси OpenTelemetry, звіти про помилки Sentry, формат журналів, рівні та id запитів.
sidebar:
  order: 10
---

Екземпляр Verdin звітує про себе через два ендпоінти стану, необов'язкові метрики Prometheus,
необов'язкові трейси OpenTelemetry і звіти про помилки Sentry, а також структуровані журнали.
На цій сторінці наведено, що повертає кожен із них і як їх увімкнути.

## Перевірки стану

Обидва ендпоінти доступні в корені сервера, поза префіксами API, і не потребують
автентифікації.

| Ендпоінт | Відповідає | Для чого |
| --- | --- | --- |
| `GET /_health` | Завжди `200 {"status":"ok"}`, поки процес обслуговує HTTP. | Liveness: перезапускайте процес, коли він перестає відповідати. |
| `GET /_ready` | `200 {"status":"ready","database":"postgres"}`, коли база даних відповідає на ping, `503 {"status":"unavailable"}`, коли ні. | Readiness і перевірки балансувальника: спрямовуйте трафік лише на екземпляри, що відповідають 200. |

`database` — це `postgres`, `mysql`, `mariadb` або `sqlite`. `/_ready` не перевіряє міграції:
`verdin start` відмовляється запускатися, поки є міграції, що очікують (якщо їх не застосовує
`--migrate`), тож у запущеного сервера їх немає.

```sh frame="terminal"
curl -s localhost:1337/_ready
{"status":"ready","database":"sqlite"}
```

## Метрики Prometheus

Увімкніть метрики й задайте токен:

```toml title="verdin.toml"
[metrics]
enabled = true
```

```sh
VERDIN_METRICS_TOKEN=<a long random string>
```

Тоді `GET /_metrics` віддає текстовий формат Prometheus (версії 0.0.4). З токеном
(`VERDIN_METRICS_TOKEN`, що має пріоритет над `[metrics].token`) збирання без
`Authorization: Bearer <token>` отримує `401`. Без токена метрики може читати будь-хто, хто
дістається до порту.

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

З кількома екземплярами збирайте метрики з кожного: кожен екземпляр рахує власні запити.

| Метрика | Тип | Мітки | Значення |
| --- | --- | --- | --- |
| `verdin_http_requests_total` | counter | `area`, `method`, `status` | Оброблені HTTP-запити. |
| `verdin_http_request_duration_seconds` | histogram | `area`, `method`, `status` | Час обробки запитів. Бакети від 5 мс до 10 с. |
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`, `kind`, `function` | Час виконання функцій [плагінів](/uk/extending/plugins/). Ті самі бакети. |
| `verdin_plugin_call_errors_total` | counter | `plugin`, `kind`, `function` | Виклики плагінів, що не вдалися: trap, тайм-аут, вивід, що не є JSON, або `{ error }` функції запуску. |
| `verdin_webhook_deliveries_pending` | gauge | | Доставки вебхуків, що очікують надсилання. |
| `verdin_realtime_subscribers` | gauge | | Відкриті потоки подій реального часу. |
| `verdin_cluster_events_total` | counter | `direction` | Події на [спільній шині подій](/uk/deploy/scaling/#спільна-шина-подій), коли задано `[cluster].bus`: `sent` — до інших екземплярів, `received` — від них, `dropped` (повна черга або невдалий запис). |
| `verdin_uptime_seconds` | gauge | | Секунди від запуску процесу. |
| `verdin_build_info` | gauge | `version` | Завжди 1; запущена версія. |

`area` — це частина сервера: `api` (API вмісту), `admin_api`, `admin` (файли панелі),
`graphql`, `mcp`, `uploads`, `internal` (шляхи, що починаються з `/_`) або `other`. `status` —
клас статусу: `2xx`, `3xx`, `4xx` або `5xx`.
Для викликів плагінів `kind` — це `hook`, `route`, `job`, `startup` або `graphql`; ряди
плагінів з'являються після першого виклику (див.
[довідник плагінів](/uk/extending/plugin-reference/#метрики)).

Корисні сповіщення: збій `/_ready`, зростання частки `5xx`, зростання
`verdin_webhook_deliveries_pending` (ціль вебхука недоступна), зростання
`verdin_plugin_call_errors_total` або повільні хуки плагінів (вони затримують записи, на яких
виконуються) і скидання `verdin_uptime_seconds` (перезапуски).

### Дашборд Grafana

[`docker/grafana/verdin.json`](https://github.com/Verdin-CMS/verdin/blob/main/docker/grafana/verdin.json)
— це дашборд для цих метрик: частота запитів, частка `5xx` і квантилі затримки за областю,
методом і класом статусу, доставки вебхуків, що очікують, підписники реального часу, трафік
шини подій, а також частота викликів плагінів, p95 і помилки за функцією плагіна. Імпортуйте
його в Grafana (**Dashboards → New → Import**) і виберіть своє джерело даних Prometheus;
змінні `instance` і `area` угорі фільтрують кожну панель.

## Трейси (OpenTelemetry)

Verdin може експортувати трейс кожного запиту до колектора OpenTelemetry (OpenTelemetry
Collector, Grafana Alloy чи Tempo, Jaeger, Honeycomb, Datadog…) через OTLP/HTTP. Типово
вимкнено:

```toml title="verdin.toml"
[telemetry]
enabled = true
endpoint = "http://otel-collector:4318"
```

Стандартні змінні теж працюють і мають пріоритет над файлом:

```sh
VERDIN_TELEMETRY__ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<key>
OTEL_SERVICE_NAME=cms-production
```

Кожен трейс містить:

- **Span запиту** (kind `server`), названий за методом і шляхом з id, заміненими на `{id}`
  (`PUT /api/articles/{id}`), з `http.response.status_code` і статусом помилки для `5xx`.
  Запит із заголовком W3C `traceparent` приєднується до трейсу викликача.
- **Span на кожен вираз бази даних** (kind `client`) під ним: `db.system.name` (`postgresql`,
  `mysql`, `mariadb` або `sqlite`) і `db.query.text` — SQL із плейсхолдерами `?`. Прив'язані
  значення ніколи не записуються, тож вміст, паролі й токени не потрапляють у трейси. `COMMIT` і
  `ROLLBACK` мають власні span, а в SQLite span `write lock` показує, скільки запис чекав на
  попередні записи.
- Події журналу, записані під час обробки запиту, як події span.

Вирази, що виконуються поза запитом (запуск, міграції, фонові завдання), не трасуються.
`[telemetry].sample_ratio` залишає частку трейсів (`0.1` залишає один із десяти); span
надсилаються пакетами й скидаються, коли сервер зупиняється. Рівень журналу не фільтрує
трейси: `[log].level = "warn"` усе одно експортує кожен запит.

## Звіти про помилки (Sentry)

Задайте DSN, щоб надсилати паніки й відповіді `5xx` до [Sentry](https://sentry.io) (або
сумісного сервісу, як-от GlitchTip):

```sh
SENTRY_DSN=https://<key>@o0.ingest.sentry.io/<project>
```

`[telemetry].sentry_dsn` теж працює; змінна має пріоритет. `5xx` надходить як подія помилки
`POST /api/articles answered 500` з тегами `http.method`, `http.status_code` і `request_id`, що
збігається із заголовком `X-Request-Id` і рядками журналу цього запиту. Події несуть версію
Verdin як release і `production` (`verdin start`) або `development` (`verdin dev`) як
environment, якщо `SENTRY_ENVIRONMENT` чи `[telemetry].sentry_environment` не називає інше. URL
звітуються з прихованими значеннями параметрів запиту, схожими на секретні, як у журналах; тіла
запитів і заголовки ніколи не надсилаються.

## Журнали

Verdin пише журнали у standard error.

| Налаштування | Значення | Типово |
| --- | --- | --- |
| `[log].format` | `pretty` (для терміналів) або `json` (один об'єкт на рядок) | `pretty`; `json` в образі Docker |
| `[log].level` | Рівень або фільтр: `error`, `warn`, `info`, `debug`, `trace` чи для окремого модуля (`info,verdin_api=debug`) | `info` |
| `RUST_LOG` | Той самий синтаксис; якщо задано, має пріоритет над `[log].level` | не задано |

У production використовуйте `json` і пересилайте standard error у свою систему журналів.
JSON-рядок виглядає так:

```json
{"timestamp":"2026-09-29T09:27:16.444598Z","level":"INFO","fields":{"message":"verdin listening","address":"0.0.0.0:1337","mode":"production","version":"0.10.0"},"target":"verdin::app"}
```

Під час запуску рядки `WARN` вказують на налаштування, які слід виправити в production,
наприклад `[email].provider is 'log'` або вимкнені secure cookies.

### Запити

Кожен запит отримує id запиту: вхідний заголовок `X-Request-Id`, якщо він є, або новий UUID.
Він повертається в заголовку відповіді `X-Request-Id` і додається до кожного рядка журналу,
записаного під час обробки запиту (`request_id` разом із `method` і `uri`). Передавайте
заголовок від свого проксі, щоб відстежувати запит між системами.

На рівні `info` запити не журналюються поодинці. Щоб журналювати кожен запит зі статусом і
затримкою, підвищте рівень HTTP-шару:

```sh
RUST_LOG=info,tower_http=debug
```

Записані URL приховують значення параметрів запиту, чиї назви схожі на секретні (`token`,
`code`, `state`, `password`, `key`, `signature`, `jwt`…), наприклад
`/api/connect/github/callback?code=[hidden]`.

## В адмін-панелі

Додайте віджет **Система** на домашню панель, щоб одразу бачити версію, базу даних і схему.
