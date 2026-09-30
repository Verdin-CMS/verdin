---
title: Monitorización
description: Vigila una instancia de Verdin en marcha — las comprobaciones /_health y /_ready, las métricas de Prometheus en /_metrics y un panel de Grafana, las trazas de OpenTelemetry, los informes de errores de Sentry, el formato de los logs, los niveles y los ids de petición.
sidebar:
  order: 10
---

Una instancia de Verdin informa sobre sí misma mediante dos endpoints de salud, métricas de
Prometheus opcionales, trazas de OpenTelemetry y informes de errores de Sentry opcionales, y
logs estructurados. Esta página enumera lo que devuelve cada uno y cómo activarlo.

## Comprobaciones de salud

Los dos endpoints se sirven en la raíz del servidor, fuera de los prefijos de las APIs, y no
necesitan autenticación.

| Endpoint | Responde | Para qué sirve |
| --- | --- | --- |
| `GET /_health` | Siempre `200 {"status":"ok"}` mientras el proceso sirve HTTP. | Liveness: reinicia el proceso cuando deja de responder. |
| `GET /_ready` | `200 {"status":"ready","database":"postgres"}` cuando la base de datos responde a un ping, `503 {"status":"unavailable"}` cuando no. | Readiness y comprobaciones del balanceador de carga: envía tráfico solo a las instancias que responden 200. |

`database` es `postgres`, `mysql`, `mariadb` o `sqlite`. `/_ready` no comprueba las
migraciones: `verdin start` se niega a arrancar mientras haya migraciones pendientes (salvo que
`--migrate` las aplique), así que un servidor en marcha no tiene ninguna.

```sh frame="terminal"
curl -s localhost:1337/_ready
{"status":"ready","database":"sqlite"}
```

## Métricas de Prometheus

Activa las métricas y define un token:

```toml title="verdin.toml"
[metrics]
enabled = true
```

```sh
VERDIN_METRICS_TOKEN=<a long random string>
```

A partir de ahí, `GET /_metrics` sirve el formato de texto de Prometheus (versión 0.0.4). Con un
token (`VERDIN_METRICS_TOKEN`, que tiene prioridad sobre `[metrics].token`), un scrape sin
`Authorization: Bearer <token>` recibe `401`. Sin token, cualquiera que llegue al puerto puede
leer las métricas.

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

Con varias instancias, haz scrape de cada una: cada instancia cuenta sus propias peticiones.

| Métrica | Tipo | Etiquetas | Significado |
| --- | --- | --- | --- |
| `verdin_http_requests_total` | counter | `area`, `method`, `status` | Peticiones HTTP servidas. |
| `verdin_http_request_duration_seconds` | histogram | `area`, `method`, `status` | Tiempo en servir las peticiones. Buckets de 5 ms a 10 s. |
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`, `kind`, `function` | Tiempo que tardaron las funciones de los [plugins](/es/extending/plugins/). Mismos buckets. |
| `verdin_plugin_call_errors_total` | counter | `plugin`, `kind`, `function` | Llamadas a plugins que fallaron: un trap, un time-out, una salida que no es JSON o un `{ error }` de una función de arranque. |
| `verdin_webhook_deliveries_pending` | gauge | | Envíos de webhooks pendientes. |
| `verdin_realtime_subscribers` | gauge | | Flujos de eventos en tiempo real abiertos. |
| `verdin_cluster_events_total` | counter | `direction` | Eventos del [bus de eventos compartido](/es/deploy/scaling/#bus-de-eventos-compartido), con `[cluster].bus` definido: `sent` a otras instancias, `received` de ellas, `dropped` (una cola llena o una escritura fallida). |
| `verdin_uptime_seconds` | gauge | | Segundos desde que arrancó el proceso. |
| `verdin_build_info` | gauge | `version` | Siempre 1; la versión en ejecución. |

`area` es la parte del servidor: `api` (API de contenido), `admin_api`, `admin` (los archivos del
panel), `graphql`, `mcp`, `uploads`, `internal` (rutas que empiezan por `/_`) u `other`.
`status` es la clase de estado: `2xx`, `3xx`, `4xx` o `5xx`.
En las llamadas a plugins, `kind` es `hook`, `route`, `job`, `startup` o `graphql`; las series
de los plugins aparecen tras la primera llamada (consulta la
[referencia de plugins](/es/extending/plugin-reference/#métricas)).

Alertas útiles: `/_ready` fallando, una proporción creciente de `5xx`, un
`verdin_webhook_deliveries_pending` que no para de crecer (un destino de webhook está caído), un
`verdin_plugin_call_errors_total` creciente o hooks de plugins lentos (retrasan las escrituras en
las que se ejecutan) y `verdin_uptime_seconds` volviendo a cero (reinicios).

### Panel de Grafana

[`docker/grafana/verdin.json`](https://github.com/Verdin-CMS/verdin/blob/main/docker/grafana/verdin.json)
es un panel para estas métricas: tasa de peticiones, proporción de `5xx` y cuantiles de latencia
por área, método y clase de estado, envíos de webhooks pendientes, suscriptores de tiempo real,
tráfico del bus de eventos, y tasa de llamadas, p95 y errores por función de plugin. Impórtalo en
Grafana (**Dashboards → New → Import**) y elige tu fuente de datos de Prometheus; las variables
`instance` y `area` de la parte superior filtran todos los paneles.

## Trazas (OpenTelemetry)

Verdin puede exportar una traza de cada petición a un colector de OpenTelemetry (el
OpenTelemetry Collector, Grafana Alloy o Tempo, Jaeger, Honeycomb, Datadog…) mediante
OTLP/HTTP. Está desactivado por defecto:

```toml title="verdin.toml"
[telemetry]
enabled = true
endpoint = "http://otel-collector:4318"
```

Las variables estándar también funcionan y tienen prioridad sobre el archivo:

```sh
VERDIN_TELEMETRY__ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<key>
OTEL_SERVICE_NAME=cms-production
```

Cada traza contiene:

- **Un span de petición** (tipo `server`), con el nombre del método y la ruta con los ids
  sustituidos por `{id}` (`PUT /api/articles/{id}`), con `http.response.status_code` y un
  estado de error en los `5xx`. Una petición con una cabecera W3C `traceparent` se une a la
  traza del llamante.
- **Un span por sentencia de base de datos** (tipo `client`) por debajo: `db.system.name`
  (`postgresql`, `mysql`, `mariadb` o `sqlite`) y `db.query.text`, el SQL con sus marcadores
  `?`. Los valores enlazados nunca se registran, así que el contenido, las contraseñas y los
  tokens no salen en las trazas. `COMMIT` y `ROLLBACK` tienen sus propios spans, y en SQLite un
  span `write lock` muestra cuánto esperó una escritura a los escritores que tenía por delante.
- Los eventos de log escritos mientras se servía la petición, como eventos del span.

Las sentencias que se ejecutan fuera de una petición (arranque, migraciones, tareas en segundo
plano) no se trazan. `[telemetry].sample_ratio` conserva una proporción de las trazas (`0.1`
conserva una de cada diez); los spans se envían por lotes y se vacían al detener el servidor. El
nivel de log no filtra las trazas: `[log].level = "warn"` sigue exportando todas las peticiones.

## Informes de errores (Sentry)

Define un DSN para enviar los pánicos y las respuestas `5xx` a [Sentry](https://sentry.io) (o a
un servicio compatible con Sentry, como GlitchTip):

```sh
SENTRY_DSN=https://<key>@o0.ingest.sentry.io/<project>
```

`[telemetry].sentry_dsn` también funciona; la variable tiene prioridad. Un `5xx` llega como un
evento de error `POST /api/articles answered 500`, etiquetado con `http.method`,
`http.status_code` y el `request_id`, que coincide con la cabecera `X-Request-Id` y con las
líneas de log de esa petición. Los eventos llevan la versión de Verdin como release y
`production` (`verdin start`) o `development` (`verdin dev`) como entorno, salvo que
`SENTRY_ENVIRONMENT` o `[telemetry].sentry_environment` indiquen otro. Las URL se informan con
los valores de consulta que parecen secretos ocultos, como en los logs; los cuerpos y las
cabeceras de las peticiones nunca se envían.

## Logs

Verdin escribe los logs en la salida de error estándar.

| Ajuste | Valores | Por defecto |
| --- | --- | --- |
| `[log].format` | `pretty` (para terminales) o `json` (un objeto por línea) | `pretty`; `json` en la imagen de Docker |
| `[log].level` | Un nivel o un filtro: `error`, `warn`, `info`, `debug`, `trace`, o por módulo (`info,verdin_api=debug`) | `info` |
| `RUST_LOG` | La misma sintaxis; tiene prioridad sobre `[log].level` si está definida | sin definir |

Usa `json` en producción y envía la salida de error estándar a tu sistema de logs. Una línea
JSON tiene este aspecto:

```json
{"timestamp":"2026-09-29T09:27:16.444598Z","level":"INFO","fields":{"message":"verdin listening","address":"0.0.0.0:1337","mode":"production","version":"0.10.0"},"target":"verdin::app"}
```

Al arrancar, las líneas `WARN` señalan ajustes que conviene corregir en producción, como
`[email].provider is 'log'` o las cookies seguras desactivadas.

### Peticiones

Cada petición recibe un id de petición: la cabecera `X-Request-Id` entrante si la hay, o un UUID
nuevo. Se devuelve en la cabecera de respuesta `X-Request-Id` y se adjunta a todas las líneas de
log escritas mientras se sirve la petición (`request_id`, con `method` y `uri`). Pasa la
cabecera desde tu proxy para seguir una petición entre sistemas.

Las peticiones no se registran una a una en el nivel `info`. Para registrar cada petición con su
estado y su latencia, sube el nivel de la capa HTTP:

```sh
RUST_LOG=info,tower_http=debug
```

Las URLs registradas ocultan los valores de los parámetros de consulta cuyos nombres parecen
secretos (`token`, `code`, `state`, `password`, `key`, `signature`, `jwt`…), por ejemplo
`/api/connect/github/callback?code=[hidden]`.

## En el panel de administración

Añade el widget **Sistema** al panel de inicio para ver de un vistazo la versión, la base de
datos y el esquema.
