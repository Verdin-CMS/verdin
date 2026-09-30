---
title: Monitoraggio
description: Tieni d'occhio un'istanza Verdin in esecuzione — i check /_health e /_ready, le metriche Prometheus su /_metrics e una dashboard Grafana, le tracce OpenTelemetry, le segnalazioni di errori Sentry, formato, livelli e request id dei log.
sidebar:
  order: 10
---

Un'istanza Verdin riferisce su sé stessa tramite due endpoint di salute, metriche Prometheus
opzionali, tracce OpenTelemetry e segnalazioni di errori Sentry opzionali, e log strutturati.
Questa pagina elenca cosa restituisce ciascuno e come attivarlo.

## Health check

Entrambi gli endpoint sono serviti alla radice del server, fuori dai prefissi delle API, e
non richiedono autenticazione.

| Endpoint | Risponde | Usalo per |
| --- | --- | --- |
| `GET /_health` | Sempre `200 {"status":"ok"}` finché il processo serve HTTP. | Liveness: riavvia il processo quando smette di rispondere. |
| `GET /_ready` | `200 {"status":"ready","database":"postgres"}` quando il database risponde a un ping, `503 {"status":"unavailable"}` quando non risponde. | Readiness e check del load balancer: invia traffico solo alle istanze che rispondono 200. |

`database` è `postgres`, `mysql`, `mariadb` o `sqlite`. `/_ready` non verifica le
migrazioni: `verdin start` si rifiuta di partire con migrazioni in sospeso (a meno che
`--migrate` non le applichi), quindi un server in esecuzione non ne ha.

```sh frame="terminal"
curl -s localhost:1337/_ready
{"status":"ready","database":"sqlite"}
```

## Metriche Prometheus

Attiva le metriche e imposta un token:

```toml title="verdin.toml"
[metrics]
enabled = true
```

```sh
VERDIN_METRICS_TOKEN=<a long random string>
```

`GET /_metrics` serve allora il formato di testo di Prometheus (versione 0.0.4). Con un
token (`VERDIN_METRICS_TOKEN`, che prevale su `[metrics].token`), uno scrape senza
`Authorization: Bearer <token>` riceve `401`. Senza token, chiunque raggiunga la porta può
leggere le metriche.

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

Con più istanze, fai lo scrape di ciascuna: ogni istanza conta le proprie richieste.

| Metrica | Tipo | Label | Significato |
| --- | --- | --- | --- |
| `verdin_http_requests_total` | counter | `area`, `method`, `status` | Richieste HTTP servite. |
| `verdin_http_request_duration_seconds` | histogram | `area`, `method`, `status` | Tempo per servire le richieste. Bucket da 5 ms a 10 s. |
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`, `kind`, `function` | Tempo impiegato dalle funzioni dei [plugin](/it/extending/plugins/). Stessi bucket. |
| `verdin_plugin_call_errors_total` | counter | `plugin`, `kind`, `function` | Chiamate ai plugin fallite: un trap, un time-out, un output che non è JSON, o l'`{ error }` di una funzione di avvio. |
| `verdin_webhook_deliveries_pending` | gauge | | Invii di webhook in attesa di essere inviati. |
| `verdin_realtime_subscribers` | gauge | | Stream di eventi realtime aperti. |
| `verdin_cluster_events_total` | counter | `direction` | Eventi sul [bus di eventi condiviso](/it/deploy/scaling/#bus-di-eventi-condiviso), con `[cluster].bus` impostato: `sent` verso le altre istanze, `received` da esse, `dropped` (una coda piena o una scrittura fallita). |
| `verdin_uptime_seconds` | gauge | | Secondi dall'avvio del processo. |
| `verdin_build_info` | gauge | `version` | Sempre 1; la versione in esecuzione. |

`area` è la parte del server: `api` (content API), `admin_api`, `admin` (i file del
pannello), `graphql`, `mcp`, `uploads`, `internal` (path che iniziano con `/_`) o `other`.
`status` è la classe dello stato: `2xx`, `3xx`, `4xx` o `5xx`.
Per le chiamate ai plugin, `kind` è `hook`, `route`, `job`, `startup` o `graphql`; le serie
dei plugin compaiono dopo la prima chiamata (vedi il
[riferimento dei plugin](/it/extending/plugin-reference/#metriche)).

Alert utili: `/_ready` che fallisce, una quota crescente di `5xx`, un
`verdin_webhook_deliveries_pending` in aumento (un target dei webhook è giù), un
`verdin_plugin_call_errors_total` in aumento o hook dei plugin lenti (ritardano le scritture
su cui girano), e `verdin_uptime_seconds` che si azzera (riavvii).

### Dashboard Grafana

[`docker/grafana/verdin.json`](https://github.com/Verdin-CMS/verdin/blob/main/docker/grafana/verdin.json)
è una dashboard per queste metriche: frequenza delle richieste, quota di `5xx` e quantili di
latenza per area, metodo e classe di stato, invii di webhook in attesa, sottoscrittori
realtime, traffico del bus di eventi, e frequenza delle chiamate ai plugin, p95 ed errori per
funzione di plugin. Importala in Grafana (**Dashboards → New → Import**) e scegli la tua
origine dati Prometheus; le variabili `instance` e `area` in alto filtrano ogni pannello.

## Tracce (OpenTelemetry)

Verdin può esportare la traccia di ogni richiesta verso un collector OpenTelemetry (l'
OpenTelemetry Collector, Grafana Alloy o Tempo, Jaeger, Honeycomb, Datadog…) tramite
OTLP/HTTP. È disattivato di default:

```toml title="verdin.toml"
[telemetry]
enabled = true
endpoint = "http://otel-collector:4318"
```

Funzionano anche le variabili standard, che prevalgono sul file:

```sh
VERDIN_TELEMETRY__ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<key>
OTEL_SERVICE_NAME=cms-production
```

Ogni traccia contiene:

- **Uno span di richiesta** (kind `server`), chiamato con il metodo e il path con gli id
  sostituiti da `{id}` (`PUT /api/articles/{id}`), con `http.response.status_code` e uno
  stato di errore sui `5xx`. Una richiesta con un header W3C `traceparent` si unisce alla
  traccia del chiamante.
- **Uno span per ogni istruzione del database** (kind `client`) sotto di esso:
  `db.system.name` (`postgresql`, `mysql`, `mariadb` o `sqlite`) e `db.query.text`, l'SQL con
  i suoi placeholder `?`. I valori associati non vengono mai registrati, così contenuti,
  password e token restano fuori dalle tracce. `COMMIT` e `ROLLBACK` hanno i propri span, e su
  SQLite uno span `write lock` mostra quanto una scrittura ha atteso quelle che la
  precedevano.
- Gli eventi di log scritti mentre serviva la richiesta, come eventi dello span.

Le istruzioni eseguite fuori da una richiesta (avvio, migrazioni, job in background) non
vengono tracciate. `[telemetry].sample_ratio` conserva una quota delle tracce (`0.1` ne
conserva una su dieci); gli span vengono inviati a lotti e svuotati quando il server si
ferma. Il livello di log non filtra le tracce: `[log].level = "warn"` esporta comunque ogni
richiesta.

## Segnalazione degli errori (Sentry)

Imposta un DSN per inviare panic e risposte `5xx` a [Sentry](https://sentry.io) (o a un
servizio compatibile con Sentry come GlitchTip):

```sh
SENTRY_DSN=https://<key>@o0.ingest.sentry.io/<project>
```

Funziona anche `[telemetry].sentry_dsn`; la variabile prevale. Un `5xx` arriva come evento di
errore `POST /api/articles answered 500`, con i tag `http.method`, `http.status_code` e
`request_id`, che corrisponde all'header `X-Request-Id` e alle righe di log di quella
richiesta. Gli eventi portano la versione di Verdin come release e `production`
(`verdin start`) o `development` (`verdin dev`) come ambiente, a meno che `SENTRY_ENVIRONMENT`
o `[telemetry].sentry_environment` ne indichino un altro. Gli URL vengono riportati con i
valori della query che sembrano segreti nascosti, come nei log; corpi e header delle richieste
non vengono mai inviati.

## Log

Verdin scrive i log sullo standard error.

| Impostazione | Valori | Default |
| --- | --- | --- |
| `[log].format` | `pretty` (per i terminali) o `json` (un oggetto per riga) | `pretty`; `json` nell'immagine Docker |
| `[log].level` | Un livello o un filtro: `error`, `warn`, `info`, `debug`, `trace`, o per modulo (`info,verdin_api=debug`) | `info` |
| `RUST_LOG` | Stessa sintassi; prevale su `[log].level` quando è impostato | non impostato |

Usa `json` in produzione e invia lo standard error al tuo sistema di log. Una riga JSON è
così:

```json
{"timestamp":"2026-09-29T09:27:16.444598Z","level":"INFO","fields":{"message":"verdin listening","address":"0.0.0.0:1337","mode":"production","version":"0.10.0"},"target":"verdin::app"}
```

All'avvio, righe `WARN` segnalano le impostazioni da correggere in produzione, come
`[email].provider is 'log'` o i cookie sicuri disattivati.

### Richieste

Ogni richiesta riceve un request id: l'header `X-Request-Id` in ingresso se c'è, oppure un
nuovo UUID. Viene rimandato nell'header di risposta `X-Request-Id` e allegato a ogni riga di
log scritta mentre si serve la richiesta (`request_id`, con `method` e `uri`). Passa l'header
dal tuo proxy per seguire una richiesta tra sistemi diversi.

Al livello `info` le richieste non vengono registrate una per una. Per registrare ogni
richiesta con il suo stato e la sua latenza, alza il livello del layer HTTP:

```sh
RUST_LOG=info,tower_http=debug
```

Gli URL registrati nascondono i valori dei parametri di query i cui nomi sembrano segreti
(`token`, `code`, `state`, `password`, `key`, `signature`, `jwt`…), per esempio
`/api/connect/github/callback?code=[hidden]`.

## Nel pannello di amministrazione

Aggiungi il widget **Sistema** alla dashboard della home per vedere a colpo d'occhio
versione, database e schema.
