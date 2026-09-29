---
title: Monitorización
description: Vigila una instancia de Verdin en marcha — las comprobaciones /_health y /_ready, las métricas de Prometheus en /_metrics y su token, el formato de los logs, los niveles y los ids de petición.
sidebar:
  order: 10
---

Una instancia de Verdin informa sobre sí misma mediante dos endpoints de salud, métricas de
Prometheus opcionales y logs estructurados. Esta página enumera lo que devuelve cada uno y cómo
activarlo.

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
| `verdin_webhook_deliveries_pending` | gauge | | Envíos de webhooks pendientes. |
| `verdin_realtime_subscribers` | gauge | | Flujos de eventos en tiempo real abiertos. |
| `verdin_uptime_seconds` | gauge | | Segundos desde que arrancó el proceso. |
| `verdin_build_info` | gauge | `version` | Siempre 1; la versión en ejecución. |

`area` es la parte del servidor: `api` (API de contenido), `admin_api`, `admin` (los archivos del
panel), `graphql`, `mcp`, `uploads`, `internal` (rutas que empiezan por `/_`) u `other`.
`status` es la clase de estado: `2xx`, `3xx`, `4xx` o `5xx`.

Alertas útiles: `/_ready` fallando, una proporción creciente de `5xx`, un
`verdin_webhook_deliveries_pending` que no para de crecer (un destino de webhook está caído) y
`verdin_uptime_seconds` volviendo a cero (reinicios).

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
