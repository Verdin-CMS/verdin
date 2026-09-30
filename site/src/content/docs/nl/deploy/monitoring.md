---
title: Monitoring
description: Houd een draaiende Verdin-instantie in de gaten — de checks /_health en /_ready, Prometheus-metrics op /_metrics en een Grafana-dashboard, OpenTelemetry-traces, Sentry-foutrapporten, logformaat, niveaus en request-id's.
sidebar:
  order: 10
---

Een Verdin-instantie rapporteert over zichzelf via twee health-endpoints, optionele
Prometheus-metrics, optionele OpenTelemetry-traces en Sentry-foutrapporten, en gestructureerde
logs. Deze pagina somt op wat elk ervan teruggeeft en hoe je het aanzet.

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
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`, `kind`, `function` | Tijd die functies van [plugins](/nl/extending/plugins/) namen. Dezelfde buckets. |
| `verdin_plugin_call_errors_total` | counter | `plugin`, `kind`, `function` | Pluginaanroepen die faalden: een trap, een time-out, uitvoer die geen JSON is, of het `{ error }` van een opstartfunctie. |
| `verdin_webhook_deliveries_pending` | gauge | | Webhook-afleveringen die wachten om te worden verzonden. |
| `verdin_realtime_subscribers` | gauge | | Open realtime-eventstreams. |
| `verdin_cluster_events_total` | counter | `direction` | Events op de [gedeelde eventbus](/nl/deploy/scaling/#gedeelde-eventbus), met `[cluster].bus` ingesteld: `sent` naar andere instanties, `received` van hen, `dropped` (een volle wachtrij of een mislukte schrijfactie). |
| `verdin_cluster_events_total` | counter | `direction` | Events op de [gedeelde eventbus](/nl/deploy/scaling/#gedeelde-eventbus), met `[cluster].bus` ingesteld: `sent` naar andere instanties, `received` van hen, `dropped` (een volle wachtrij of een mislukte schrijfactie). |
| `verdin_uptime_seconds` | gauge | | Seconden sinds het proces is gestart. |
| `verdin_build_info` | gauge | `version` | Altijd 1; de draaiende versie. |

`area` is het deel van de server: `api` (content-API), `admin_api`, `admin` (de bestanden van het
paneel), `graphql`, `mcp`, `uploads`, `internal` (paden die met `/_` beginnen) of `other`.
`status` is de statusklasse: `2xx`, `3xx`, `4xx` of `5xx`.
Bij pluginaanroepen is `kind` `hook`, `route`, `job`, `startup` of `graphql`; de pluginreeksen
verschijnen na de eerste aanroep (zie de
[pluginreferentie](/nl/extending/plugin-reference/#metrics)).
Bij pluginaanroepen is `kind` `hook`, `route`, `job`, `startup` of `graphql`; de pluginreeksen
verschijnen na de eerste aanroep (zie de
[pluginreferentie](/nl/extending/plugin-reference/#metrics)).

Nuttige alerts: `/_ready` die faalt, een stijgend aandeel `5xx`, een groeiende
`verdin_webhook_deliveries_pending` (een webhookdoel ligt eruit), een stijgende
`verdin_plugin_call_errors_total` of trage plugin-hooks (ze vertragen de schrijfacties waarop ze
draaien), en `verdin_uptime_seconds` dat terugspringt (herstarts).

### Grafana-dashboard

[`docker/grafana/verdin.json`](https://github.com/Verdin-CMS/verdin/blob/main/docker/grafana/verdin.json)
is een dashboard voor deze metrics: requestsnelheid, aandeel `5xx` en latentiekwantielen per
gebied, methode en statusklasse, openstaande webhook-afleveringen, realtime-abonnees, verkeer van
de eventbus, en aanroepsnelheid, p95 en fouten van plugins per pluginfunctie. Importeer het in
Grafana (**Dashboards → New → Import**) en kies je Prometheus-databron; de variabelen `instance` en
`area` bovenaan filteren elk paneel.

## Traces (OpenTelemetry)

Verdin kan van elk request een trace exporteren naar een OpenTelemetry-collector (de
OpenTelemetry Collector, Grafana Alloy of Tempo, Jaeger, Honeycomb, Datadog…) via OTLP/HTTP. Het
staat standaard uit:

```toml title="verdin.toml"
[telemetry]
enabled = true
endpoint = "http://otel-collector:4318"
```

De standaardvariabelen werken ook en winnen van het bestand:

```sh
VERDIN_TELEMETRY__ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<key>
OTEL_SERVICE_NAME=cms-production
```

Elke trace bevat:

- **Een requestspan** (soort `server`), genoemd naar de methode en het pad met id's vervangen door
  `{id}` (`PUT /api/articles/{id}`), met `http.response.status_code` en een foutstatus bij `5xx`.
  Een request met een W3C-header `traceparent` sluit aan bij de trace van de aanroeper.
- **Een span per databasestatement** (soort `client`) eronder: `db.system.name` (`postgresql`,
  `mysql`, `mariadb` of `sqlite`) en `db.query.text`, de SQL met zijn `?`-placeholders. Gebonden
  waarden worden nooit vastgelegd, dus content, wachtwoorden en tokens blijven buiten traces.
  `COMMIT` en `ROLLBACK` hebben hun eigen spans, en op SQLite toont een span `write lock` hoe lang
  een schrijfactie wachtte op de schrijvers vóór haar.
- De logevents die tijdens het bedienen van het request zijn geschreven, als spanevents.

Statements buiten een request (opstarten, migraties, achtergrondjobs) worden niet getraceerd.
`[telemetry].sample_ratio` bewaart een deel van de traces (`0.1` bewaart er één op de tien); de
spans worden in batches verzonden en geleegd wanneer de server stopt. Het logniveau filtert geen
traces: `[log].level = "warn"` exporteert nog steeds elk request.

## Foutrapportage (Sentry)

Stel een DSN in om panics en `5xx`-responses naar [Sentry](https://sentry.io) te sturen (of naar
een Sentry-compatibele service zoals GlitchTip):

```sh
SENTRY_DSN=https://<key>@o0.ingest.sentry.io/<project>
```

`[telemetry].sentry_dsn` werkt ook; de variabele wint. Een `5xx` komt aan als een foutevent
`POST /api/articles answered 500`, getagd met `http.method`, `http.status_code` en de
`request_id`, die overeenkomt met de header `X-Request-Id` en de logregels van dat request. Events
dragen de Verdin-versie als release en `production` (`verdin start`) of `development` (`verdin dev`)
als omgeving, tenzij `SENTRY_ENVIRONMENT` of `[telemetry].sentry_environment` een andere noemt.
URL's worden gerapporteerd met geheim ogende querywaarden verborgen, zoals in de logs;
request-bodies en headers worden nooit verzonden.

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
