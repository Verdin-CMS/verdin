---
title: Моніторинг
description: Спостереження за запущеним екземпляром Verdin — перевірки /_health і /_ready, метрики Prometheus на /_metrics і їхній токен, формат журналів, рівні та id запитів.
sidebar:
  order: 10
---

Екземпляр Verdin звітує про себе через два ендпоінти стану, необов'язкові метрики Prometheus і
структуровані журнали. На цій сторінці наведено, що повертає кожен із них і як їх увімкнути.

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
| `verdin_webhook_deliveries_pending` | gauge | | Доставки вебхуків, що очікують надсилання. |
| `verdin_realtime_subscribers` | gauge | | Відкриті потоки подій реального часу. |
| `verdin_uptime_seconds` | gauge | | Секунди від запуску процесу. |
| `verdin_build_info` | gauge | `version` | Завжди 1; запущена версія. |

`area` — це частина сервера: `api` (API вмісту), `admin_api`, `admin` (файли панелі),
`graphql`, `mcp`, `uploads`, `internal` (шляхи, що починаються з `/_`) або `other`. `status` —
клас статусу: `2xx`, `3xx`, `4xx` або `5xx`.

Корисні сповіщення: збій `/_ready`, зростання частки `5xx`, зростання
`verdin_webhook_deliveries_pending` (ціль вебхука недоступна) і скидання
`verdin_uptime_seconds` (перезапуски).

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
