---
title: Monitoring
description: Houd een draaiende Verdin-instantie in de gaten — de checks /_health en /_ready, Prometheus-metrics op /_metrics en hun token, logformaat, niveaus en request-id's.
sidebar:
  order: 10
---

Een Verdin-instantie rapporteert over zichzelf via twee health-endpoints, optionele
Prometheus-metrics en gestructureerde logs. Deze pagina somt op wat elk ervan teruggeeft en hoe
je het aanzet.

## Healthchecks

Beide endpoints worden geserveerd vanaf de root van de server, buiten de API-prefixen, en vereisen
geen authenticatie.

| Endpoint | Antwoordt | Gebruik het voor |
| --- | --- | --- |
| `GET /_health` | Altijd `200 {"status":"ok"}` zolang het proces HTTP serveert. | Liveness: herstart het proces als het niet meer antwoordt. |
| `GET /_ready` | `200 {"status":"ready","database":"postgres"}` als de database op een ping antwoordt, `503 {"status":"unavailable"}` als dat niet zo is. | Readiness- en load-balancerchecks: stuur alleen verkeer naar instanties die 200 antwoorden. |

`database` is `postgres`, `mysql`, `mariadb` of `sqlite`. `/_ready` controleert geen migraties:
`verdin start` weigert te starten zolang er migraties openstaan (tenzij `--migrate` ze toepast),
dus een draaiende server heeft er geen.

```sh frame="terminal"
curl -s localhost:1337/_ready
{"status":"ready","database":"sqlite"}
```

## Prometheus-metrics

Zet metrics aan en stel een token in:

```toml title="verdin.toml"
[metrics]
enabled = true
```

```sh
VERDIN_METRICS_TOKEN=<a long random string>
```

`GET /_metrics` serveert dan het Prometheus-tekstformaat (versie 0.0.4). Met een token
(`VERDIN_METRICS_TOKEN`, dat wint van `[metrics].token`) krijgt een scrape zonder
`Authorization: Bearer <token>` een `401`. Zonder token kan iedereen die de poort bereikt de
metrics lezen.

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

Scrape bij meerdere instanties elk ervan: elke instantie telt haar eigen requests.

| Metric | Type | Labels | Betekenis |
| --- | --- | --- | --- |
| `verdin_http_requests_total` | counter | `area`, `method`, `status` | Geserveerde HTTP-requests. |
| `verdin_http_request_duration_seconds` | histogram | `area`, `method`, `status` | Tijd om requests te serveren. Buckets van 5 ms tot 10 s. |
| `verdin_webhook_deliveries_pending` | gauge | | Webhook-afleveringen die wachten om te worden verzonden. |
| `verdin_realtime_subscribers` | gauge | | Open realtime-eventstreams. |
| `verdin_uptime_seconds` | gauge | | Seconden sinds het proces is gestart. |
| `verdin_build_info` | gauge | `version` | Altijd 1; de draaiende versie. |

`area` is het deel van de server: `api` (content-API), `admin_api`, `admin` (de bestanden van het
paneel), `graphql`, `mcp`, `uploads`, `internal` (paden die met `/_` beginnen) of `other`.
`status` is de statusklasse: `2xx`, `3xx`, `4xx` of `5xx`.

Nuttige alerts: `/_ready` die faalt, een stijgend aandeel `5xx`, een groeiende
`verdin_webhook_deliveries_pending` (een webhookdoel ligt eruit), en `verdin_uptime_seconds` dat
terugspringt (herstarts).

## Logs

Verdin schrijft logs naar standard error.

| Instelling | Waarden | Standaard |
| --- | --- | --- |
| `[log].format` | `pretty` (voor terminals) of `json` (één object per regel) | `pretty`; `json` in het Docker-image |
| `[log].level` | Een niveau of filter: `error`, `warn`, `info`, `debug`, `trace`, of per module (`info,verdin_api=debug`) | `info` |
| `RUST_LOG` | Dezelfde syntaxis; wint van `[log].level` als hij is ingesteld | niet ingesteld |

Gebruik in productie `json` en stuur standard error door naar je logsysteem. Een JSON-regel ziet
er zo uit:

```json
{"timestamp":"2026-09-29T09:27:16.444598Z","level":"INFO","fields":{"message":"verdin listening","address":"0.0.0.0:1337","mode":"production","version":"0.10.0"},"target":"verdin::app"}
```

Bij het opstarten wijzen `WARN`-regels op instellingen die je in productie moet aanpassen, zoals
`[email].provider is 'log'` of uitgeschakelde secure cookies.

### Requests

Elk request krijgt een request-id: de binnenkomende header `X-Request-Id` als die er is, of een
nieuwe UUID. Het wordt teruggestuurd in de response-header `X-Request-Id` en toegevoegd aan elke
logregel die tijdens het serveren van het request wordt geschreven (`request_id`, met `method` en
`uri`). Geef de header door vanaf je proxy om een request door systemen heen te volgen.

Requests worden op het niveau `info` niet één voor één gelogd. Om elk request met zijn status en
latentie te loggen, verhoog je het niveau van de HTTP-laag:

```sh
RUST_LOG=info,tower_http=debug
```

Gelogde URL's verbergen de waarden van queryparameters waarvan de naam geheim lijkt (`token`,
`code`, `state`, `password`, `key`, `signature`, `jwt`…), bijvoorbeeld
`/api/connect/github/callback?code=[hidden]`.

## In het beheerpaneel

Voeg de widget **Systeem** toe aan het startdashboard om de versie, de database en het schema in
één oogopslag te zien.
