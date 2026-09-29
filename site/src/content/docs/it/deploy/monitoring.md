---
title: Monitoraggio
description: Tieni d'occhio un'istanza Verdin in esecuzione — i check /_health e /_ready, le metriche Prometheus su /_metrics e il loro token, formato, livelli e request id dei log.
sidebar:
  order: 10
---

Un'istanza Verdin riferisce su sé stessa tramite due endpoint di salute, metriche Prometheus
opzionali e log strutturati. Questa pagina elenca cosa restituisce ciascuno e come
attivarlo.

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
| `verdin_webhook_deliveries_pending` | gauge | | Invii di webhook in attesa di essere inviati. |
| `verdin_realtime_subscribers` | gauge | | Stream di eventi realtime aperti. |
| `verdin_uptime_seconds` | gauge | | Secondi dall'avvio del processo. |
| `verdin_build_info` | gauge | `version` | Sempre 1; la versione in esecuzione. |

`area` è la parte del server: `api` (content API), `admin_api`, `admin` (i file del
pannello), `graphql`, `mcp`, `uploads`, `internal` (path che iniziano con `/_`) o `other`.
`status` è la classe dello stato: `2xx`, `3xx`, `4xx` o `5xx`.

Alert utili: `/_ready` che fallisce, una quota crescente di `5xx`, un
`verdin_webhook_deliveries_pending` in aumento (un target dei webhook è giù), e
`verdin_uptime_seconds` che si azzera (riavvii).

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
