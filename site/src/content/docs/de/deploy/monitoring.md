---
title: Monitoring
description: Eine laufende Verdin-Instanz beobachten – die Checks /_health und /_ready, Prometheus-Metriken unter /_metrics und ein Grafana-Dashboard, OpenTelemetry-Traces, Sentry-Fehlerberichte, Log-Format, Log-Level und Request-IDs.
sidebar:
  order: 10
---

Eine Verdin-Instanz gibt über zwei Health-Endpunkte, optionale Prometheus-Metriken, optionale
OpenTelemetry-Traces und Sentry-Fehlerberichte sowie strukturierte Logs Auskunft über sich.
Diese Seite listet, was jeder davon liefert und wie du ihn einschaltest.

## Health Checks

Beide Endpunkte liegen im Wurzelverzeichnis des Servers, außerhalb der API-Präfixe, und
brauchen keine Authentifizierung.

| Endpunkt | Antwortet | Wofür |
| --- | --- | --- |
| `GET /_health` | Immer `200 {"status":"ok"}`, solange der Prozess HTTP ausliefert. | Liveness: Starte den Prozess neu, wenn er nicht mehr antwortet. |
| `GET /_ready` | `200 {"status":"ready","database":"postgres"}`, wenn die Datenbank auf einen Ping antwortet, sonst `503 {"status":"unavailable"}`. | Readiness und Checks des Load Balancers: Schick Traffic nur an Instanzen, die mit 200 antworten. |

`database` ist `postgres`, `mysql`, `mariadb` oder `sqlite`. `/_ready` prüft keine
Migrationen: `verdin start` verweigert den Start, solange Migrationen ausstehen (außer
`--migrate` wendet sie an), ein laufender Server hat also keine.

```sh frame="terminal"
curl -s localhost:1337/_ready
{"status":"ready","database":"sqlite"}
```

## Prometheus-Metriken

Schalte die Metriken ein und setze ein Token:

```toml title="verdin.toml"
[metrics]
enabled = true
```

```sh
VERDIN_METRICS_TOKEN=<a long random string>
```

`GET /_metrics` liefert dann das Prometheus-Textformat (Version 0.0.4). Mit einem Token
(`VERDIN_METRICS_TOKEN`, das Vorrang vor `[metrics].token` hat) bekommt ein Scrape ohne
`Authorization: Bearer <token>` ein `401`. Ohne Token kann jeder, der den Port erreicht, die
Metriken lesen.

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

Bei mehreren Instanzen scrapest du jede einzeln: Jede Instanz zählt ihre eigenen Anfragen.

| Metrik | Typ | Labels | Bedeutung |
| --- | --- | --- | --- |
| `verdin_http_requests_total` | Counter | `area`, `method`, `status` | Ausgelieferte HTTP-Anfragen. |
| `verdin_http_request_duration_seconds` | Histogramm | `area`, `method`, `status` | Dauer der Auslieferung. Buckets von 5 ms bis 10 s. |
| `verdin_plugin_call_duration_seconds` | Histogramm | `plugin`, `kind`, `function` | Dauer der Funktionen von [Plugins](/de/extending/plugins/). Dieselben Buckets. |
| `verdin_plugin_call_errors_total` | Counter | `plugin`, `kind`, `function` | Fehlgeschlagene Plugin-Aufrufe: ein Trap, ein Timeout, eine Ausgabe, die kein JSON ist, oder ein `{ error }` einer Startfunktion. |
| `verdin_webhook_deliveries_pending` | Gauge | | Webhook-Zustellungen, die auf den Versand warten. |
| `verdin_realtime_subscribers` | Gauge | | Offene Echtzeit-Event-Streams. |
| `verdin_cluster_events_total` | Counter | `direction` | Events auf dem [gemeinsamen Event-Bus](/de/deploy/scaling/#gemeinsamer-event-bus), wenn `[cluster].bus` gesetzt ist: `sent` an andere Instanzen, `received` von ihnen, `dropped` (eine volle Warteschlange oder ein fehlgeschlagener Schreibvorgang). |
| `verdin_uptime_seconds` | Gauge | | Sekunden seit dem Start des Prozesses. |
| `verdin_build_info` | Gauge | `version` | Immer 1; die laufende Version. |

`area` ist der Teil des Servers: `api` (Content-API), `admin_api`, `admin` (die Dateien des
Panels), `graphql`, `mcp`, `uploads`, `internal` (Pfade, die mit `/_` beginnen) oder `other`.
`status` ist die Statusklasse: `2xx`, `3xx`, `4xx` oder `5xx`.
Bei Plugin-Aufrufen ist `kind` `hook`, `route`, `job`, `startup` oder `graphql`; die
Plugin-Serien erscheinen nach dem ersten Aufruf (siehe die
[Plugin-Referenz](/de/extending/plugin-reference/#metriken)).

Sinnvolle Alarme: `/_ready` schlägt fehl, ein steigender Anteil an `5xx`, ein wachsendes
`verdin_webhook_deliveries_pending` (ein Webhook-Ziel ist nicht erreichbar), ein steigendes
`verdin_plugin_call_errors_total` oder langsame Plugin-Hooks (sie verzögern die Schreibvorgänge,
auf denen sie laufen) und ein zurückgesetztes `verdin_uptime_seconds` (Neustarts).

### Grafana-Dashboard

[`docker/grafana/verdin.json`](https://github.com/Verdin-CMS/verdin/blob/main/docker/grafana/verdin.json)
ist ein Dashboard für diese Metriken: Anfragerate, Anteil an `5xx` und Latenz-Quantile nach
Bereich, Methode und Statusklasse, ausstehende Webhook-Zustellungen, Echtzeit-Abonnenten,
Event-Bus-Verkehr sowie Plugin-Aufrufrate, p95 und Fehler pro Plugin-Funktion. Importiere es in
Grafana (**Dashboards → New → Import**) und wähle deine Prometheus-Datenquelle; die Variablen
`instance` und `area` oben filtern jedes Panel.

## Traces (OpenTelemetry)

Verdin kann einen Trace jeder Anfrage per OTLP/HTTP an einen OpenTelemetry-Collector exportieren
(den OpenTelemetry Collector, Grafana Alloy oder Tempo, Jaeger, Honeycomb, Datadog…). Er ist
standardmäßig aus:

```toml title="verdin.toml"
[telemetry]
enabled = true
endpoint = "http://otel-collector:4318"
```

Die Standardvariablen funktionieren ebenfalls und haben Vorrang vor der Datei:

```sh
VERDIN_TELEMETRY__ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<key>
OTEL_SERVICE_NAME=cms-production
```

Jeder Trace enthält:

- **Einen Request-Span** (Art `server`), benannt nach Methode und Pfad, wobei IDs durch `{id}`
  ersetzt sind (`PUT /api/articles/{id}`), mit `http.response.status_code` und einem
  Fehlerstatus bei `5xx`. Eine Anfrage mit einem W3C-Header `traceparent` schließt sich dem Trace
  des Aufrufers an.
- **Einen Span pro Datenbankanweisung** (Art `client`) darunter: `db.system.name`
  (`postgresql`, `mysql`, `mariadb` oder `sqlite`) und `db.query.text`, das SQL mit seinen
  `?`-Platzhaltern. Gebundene Werte werden nie aufgezeichnet, sodass Inhalte, Passwörter und
  Tokens aus den Traces herausbleiben. `COMMIT` und `ROLLBACK` haben eigene Spans, und auf SQLite
  zeigt ein Span `write lock`, wie lange ein Schreibvorgang auf die Schreiber vor ihm gewartet
  hat.
- Die Log-Events, die beim Bearbeiten der Anfrage geschrieben wurden, als Span-Events.

Anweisungen außerhalb einer Anfrage (Start, Migrationen, Hintergrundjobs) werden nicht
getraced. `[telemetry].sample_ratio` behält einen Teil der Traces (`0.1` behält jeden zehnten);
die Spans werden in Batches gesendet und beim Stoppen des Servers geleert. Das Log-Level filtert
keine Traces: `[log].level = "warn"` exportiert weiterhin jede Anfrage.

## Fehlerberichte (Sentry)

Setze eine DSN, um Panics und `5xx`-Antworten an [Sentry](https://sentry.io) (oder einen
Sentry-kompatiblen Dienst wie GlitchTip) zu senden:

```sh
SENTRY_DSN=https://<key>@o0.ingest.sentry.io/<project>
```

`[telemetry].sentry_dsn` funktioniert auch; die Variable hat Vorrang. Ein `5xx` kommt als
Fehler-Event `POST /api/articles answered 500` an, getaggt mit `http.method`,
`http.status_code` und der `request_id`, die zum Header `X-Request-Id` und zu den Logzeilen
dieser Anfrage passt. Events tragen die Verdin-Version als Release und `production`
(`verdin start`) oder `development` (`verdin dev`) als Umgebung, sofern nicht `SENTRY_ENVIRONMENT`
oder `[telemetry].sentry_environment` eine andere nennt. URLs werden mit verborgenen
geheimnisartigen Query-Werten gemeldet, wie in den Logs; Request-Bodies und Header werden nie
gesendet.

## Logs

Verdin schreibt Logs auf Standard Error.

| Einstellung | Werte | Standard |
| --- | --- | --- |
| `[log].format` | `pretty` (für Terminals) oder `json` (ein Objekt pro Zeile) | `pretty`; `json` im Docker-Image |
| `[log].level` | Ein Level oder Filter: `error`, `warn`, `info`, `debug`, `trace` oder pro Modul (`info,verdin_api=debug`) | `info` |
| `RUST_LOG` | Dieselbe Syntax; hat Vorrang vor `[log].level`, wenn gesetzt | nicht gesetzt |

Nimm in Produktion `json` und leite Standard Error an dein Log-System weiter. Eine JSON-Zeile
sieht so aus:

```json
{"timestamp":"2026-09-29T09:27:16.444598Z","level":"INFO","fields":{"message":"verdin listening","address":"0.0.0.0:1337","mode":"production","version":"0.10.0"},"target":"verdin::app"}
```

Beim Start weisen `WARN`-Zeilen auf Einstellungen hin, die du in Produktion korrigieren
solltest, etwa `[email].provider is 'log'` oder abgeschaltete sichere Cookies.

### Anfragen

Jede Anfrage bekommt eine Request-ID: den eingehenden Header `X-Request-Id`, falls vorhanden,
sonst eine neue UUID. Sie wird im Response-Header `X-Request-Id` zurückgeschickt und an jede
Log-Zeile gehängt, die während der Bearbeitung der Anfrage geschrieben wird (`request_id`, mit
`method` und `uri`). Reich den Header von deinem Proxy durch, um eine Anfrage über Systeme
hinweg zu verfolgen.

Auf dem Level `info` werden Anfragen nicht einzeln protokolliert. Um jede Anfrage mit Status und
Latenz zu protokollieren, erhöhe das Level der HTTP-Schicht:

```sh
RUST_LOG=info,tower_http=debug
```

Protokollierte URLs verbergen die Werte von Query-Parametern, deren Namen nach Geheimnissen
aussehen (`token`, `code`, `state`, `password`, `key`, `signature`, `jwt`…), zum Beispiel
`/api/connect/github/callback?code=[hidden]`.

## Im Admin-Panel

Füge dem Dashboard der Startseite das Widget **System** hinzu, um Version, Datenbank und Schema
auf einen Blick zu sehen.
