---
title: Мониторинг
description: Наблюдение за работающим экземпляром Verdin — проверки /_health и /_ready, метрики Prometheus на /_metrics и их токен, формат и уровни логов и id запросов.
sidebar:
  order: 10
---

Экземпляр Verdin сообщает о своём состоянии через два эндпоинта проверки работоспособности,
необязательные метрики Prometheus и структурированные логи. На этой странице перечислено, что
возвращает каждый из них и как его включить.

## Проверки работоспособности

Оба эндпоинта доступны в корне сервера, вне префиксов API, и не требуют аутентификации.

| Эндпоинт | Отвечает | Для чего |
| --- | --- | --- |
| `GET /_health` | Всегда `200 {"status":"ok"}`, пока процесс обслуживает HTTP. | Проверка живости: перезапускайте процесс, когда он перестаёт отвечать. |
| `GET /_ready` | `200 {"status":"ready","database":"postgres"}`, когда база данных отвечает на ping, и `503 {"status":"unavailable"}`, когда нет. | Проверки готовности и балансировщика нагрузки: направляйте трафик только на экземпляры, которые отвечают 200. |

`database` — это `postgres`, `mysql`, `mariadb` или `sqlite`. `/_ready` не проверяет
миграции: `verdin start` не запускается, пока есть ожидающие миграции (если их не применяет
`--migrate`), поэтому у работающего сервера их нет.

```sh frame="terminal"
curl -s localhost:1337/_ready
{"status":"ready","database":"sqlite"}
```

## Метрики Prometheus

Включите метрики и задайте токен:

```toml title="verdin.toml"
[metrics]
enabled = true
```

```sh
VERDIN_METRICS_TOKEN=<a long random string>
```

После этого `GET /_metrics` отдаёт текстовый формат Prometheus (версия 0.0.4). С токеном
(`VERDIN_METRICS_TOKEN`, который имеет приоритет над `[metrics].token`) запрос без
`Authorization: Bearer <token>` получает `401`. Без токена метрики может читать любой, кто
может достучаться до порта.

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

При нескольких экземплярах собирайте метрики с каждого: каждый экземпляр считает свои
запросы.

| Метрика | Тип | Метки | Значение |
| --- | --- | --- | --- |
| `verdin_http_requests_total` | counter | `area`, `method`, `status` | Обслуженные HTTP-запросы. |
| `verdin_http_request_duration_seconds` | histogram | `area`, `method`, `status` | Время обслуживания запросов. Корзины от 5 мс до 10 с. |
| `verdin_webhook_deliveries_pending` | gauge | | Доставки вебхуков, ожидающие отправки. |
| `verdin_realtime_subscribers` | gauge | | Открытые потоки событий реального времени. |
| `verdin_uptime_seconds` | gauge | | Секунды с момента запуска процесса. |
| `verdin_build_info` | gauge | `version` | Всегда 1; работающая версия. |

`area` — часть сервера: `api` (content API), `admin_api`, `admin` (файлы панели),
`graphql`, `mcp`, `uploads`, `internal` (пути, начинающиеся с `/_`) или `other`. `status` —
класс статуса: `2xx`, `3xx`, `4xx` или `5xx`.

Полезные оповещения: падающий `/_ready`, растущая доля `5xx`, растущий
`verdin_webhook_deliveries_pending` (получатель вебхука недоступен) и сброс
`verdin_uptime_seconds` (перезапуски).

## Логи

Verdin пишет логи в стандартный поток ошибок.

| Настройка | Значения | По умолчанию |
| --- | --- | --- |
| `[log].format` | `pretty` (для терминала) или `json` (один объект на строку) | `pretty`; `json` в образе Docker |
| `[log].level` | Уровень или фильтр: `error`, `warn`, `info`, `debug`, `trace` или по модулям (`info,verdin_api=debug`) | `info` |
| `RUST_LOG` | Тот же синтаксис; если задан, имеет приоритет над `[log].level` | не задан |

В продакшене используйте `json` и отправляйте стандартный поток ошибок в свою систему
логирования. Строка JSON выглядит так:

```json
{"timestamp":"2026-09-29T09:27:16.444598Z","level":"INFO","fields":{"message":"verdin listening","address":"0.0.0.0:1337","mode":"production","version":"0.10.0"},"target":"verdin::app"}
```

При запуске строки `WARN` указывают на настройки, которые нужно исправить для продакшена,
например `[email].provider is 'log'` или выключенные secure-cookie.

### Запросы

Каждый запрос получает id: входящий заголовок `X-Request-Id`, если он есть, или новый UUID.
Он возвращается в заголовке ответа `X-Request-Id` и добавляется к каждой строке лога,
записанной во время обслуживания запроса (`request_id`, вместе с `method` и `uri`).
Передавайте заголовок от своего прокси, чтобы отслеживать запрос между системами.

На уровне `info` запросы не записываются по одному. Чтобы записывать каждый запрос со
статусом и задержкой, повысьте уровень HTTP-слоя:

```sh
RUST_LOG=info,tower_http=debug
```

В записанных URL скрываются значения параметров запроса, имена которых похожи на секретные
(`token`, `code`, `state`, `password`, `key`, `signature`, `jwt`…), например
`/api/connect/github/callback?code=[hidden]`.

## В админ-панели

Добавьте виджет **Система** на главную панель, чтобы видеть версию, базу данных и схему с
первого взгляда.
