---
title: Monitoratge
description: Supervisa una instància de Verdin en execució — les comprovacions /_health i /_ready, les mètriques de Prometheus a /_metrics i un tauler de Grafana, les traces d'OpenTelemetry, els informes d'errors de Sentry, el format dels registres, els nivells i els ids de petició.
sidebar:
  order: 10
---

Una instància de Verdin informa sobre si mateixa mitjançant dos endpoints de salut, mètriques de
Prometheus opcionals, traces d'OpenTelemetry opcionals, informes d'errors de Sentry i registres
estructurats. Aquesta pàgina llista què retorna cadascun i com activar-lo.

## Comprovacions de salut

Tots dos endpoints se serveixen a l'arrel del servidor, fora dels prefixos de les API, i no
necessiten autenticació.

| Endpoint | Respon | Fes-lo servir per a |
| --- | --- | --- |
| `GET /_health` | Sempre `200 {"status":"ok"}` mentre el procés serveix HTTP. | Disponibilitat (liveness): reinicia el procés quan deixa de respondre. |
| `GET /_ready` | `200 {"status":"ready","database":"postgres"}` quan la base de dades respon a un ping, `503 {"status":"unavailable"}` quan no ho fa. | Preparació (readiness) i comprovacions del balancejador de càrrega: envia trànsit només a les instàncies que responen 200. |

`database` és `postgres`, `mysql`, `mariadb` o `sqlite`. `/_ready` no comprova les migracions:
`verdin start` es nega a iniciar-se mentre hi ha migracions pendents (tret que `--migrate` les
apliqui), així que un servidor en execució no en té cap.

```sh frame="terminal"
curl -s localhost:1337/_ready
{"status":"ready","database":"sqlite"}
```

## Mètriques de Prometheus

Activa les mètriques i defineix un token:

```toml title="verdin.toml"
[metrics]
enabled = true
```

```sh
VERDIN_METRICS_TOKEN=<a long random string>
```

Aleshores `GET /_metrics` serveix el format de text de Prometheus (versió 0.0.4). Amb un token
(`VERDIN_METRICS_TOKEN`, que té prioritat sobre `[metrics].token`), una lectura sense
`Authorization: Bearer <token>` rep `401`. Sense token, qualsevol que arribi al port pot llegir
les mètriques.

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

Amb diverses instàncies, llegeix-les totes: cada instància compta les seves pròpies peticions.

| Mètrica | Tipus | Etiquetes | Significat |
| --- | --- | --- | --- |
| `verdin_http_requests_total` | counter | `area`, `method`, `status` | Peticions HTTP servides. |
| `verdin_http_request_duration_seconds` | histogram | `area`, `method`, `status` | Temps per servir les peticions. Intervals de 5 ms a 10 s. |
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`, `kind`, `function` | Temps que han trigat les funcions dels [connectors](/ca/extending/plugins/). Mateixos intervals. |
| `verdin_plugin_call_errors_total` | counter | `plugin`, `kind`, `function` | Crides a connectors que han fallat: una trampa (trap), un temps d'espera esgotat, una sortida que no és JSON o un `{ error }` d'una funció d'inici. |
| `verdin_webhook_deliveries_pending` | gauge | | Enviaments de webhooks esperant a ser enviats. |
| `verdin_realtime_subscribers` | gauge | | Fluxos d'esdeveniments en temps real oberts. |
| `verdin_cluster_events_total` | counter | `direction` | Esdeveniments al [bus d'esdeveniments compartit](/ca/deploy/scaling/#bus-desdeveniments-compartit), amb `[cluster].bus` definit: `sent` cap a altres instàncies, `received` d'elles, `dropped` (una cua plena o una escriptura fallida). |
| `verdin_uptime_seconds` | gauge | | Segons des que es va iniciar el procés. |
| `verdin_build_info` | gauge | `version` | Sempre 1; la versió en execució. |

`area` és la part del servidor: `api` (API de contingut), `admin_api`, `admin` (els fitxers del
tauler), `graphql`, `mcp`, `uploads`, `internal` (camins que comencen per `/_`) o `other`.
`status` és la classe d'estat: `2xx`, `3xx`, `4xx` o `5xx`.
Per a les crides a connectors, `kind` és `hook`, `route`, `job`, `startup` o `graphql`; les sèries
dels connectors apareixen després de la primera crida (consulta la
[referència de connectors](/ca/extending/plugin-reference/#mètriques)).

Alertes útils: `/_ready` que falla, una proporció creixent de `5xx`, un
`verdin_webhook_deliveries_pending` que creix (una destinació de webhook ha caigut), un
`verdin_plugin_call_errors_total` que creix o hooks de connectors lents (retarden les escriptures
en què s'executen) i un `verdin_uptime_seconds` que es reinicia (reinicis).

### Tauler de Grafana

[`docker/grafana/verdin.json`](https://github.com/Verdin-CMS/verdin/blob/main/docker/grafana/verdin.json)
és un tauler per a aquestes mètriques: taxa de peticions, proporció de `5xx` i quantils de latència
per àrea, mètode i classe d'estat, enviaments de webhooks pendents, subscriptors de temps real,
trànsit del bus d'esdeveniments, i taxa de crides, p95 i errors per funció de connector. Importa'l a
Grafana (**Dashboards → New → Import**) i tria la teva font de dades de Prometheus; les variables
`instance` i `area` de la part superior filtren tots els panells.

## Traces (OpenTelemetry)

Verdin pot exportar una traça de cada petició a un col·lector d'OpenTelemetry (l'OpenTelemetry
Collector, Grafana Alloy o Tempo, Jaeger, Honeycomb, Datadog…) per OTLP/HTTP. Està desactivat per
defecte:

```toml title="verdin.toml"
[telemetry]
enabled = true
endpoint = "http://otel-collector:4318"
```

Les variables estàndard també funcionen i tenen prioritat sobre el fitxer:

```sh
VERDIN_TELEMETRY__ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<key>
OTEL_SERVICE_NAME=cms-production
```

Cada traça conté:

- **Un span de petició** (tipus `server`), amb el nom del mètode i el camí amb els ids
  substituïts per `{id}` (`PUT /api/articles/{id}`), amb `http.response.status_code` i un estat
  d'error en `5xx`. Una petició amb una capçalera W3C `traceparent` s'uneix a la traça del qui
  crida.
- **Un span per sentència de base de dades** (tipus `client`) sota seu: `db.system.name`
  (`postgresql`, `mysql`, `mariadb` o `sqlite`) i `db.query.text`, l'SQL amb els seus
  marcadors `?`. Els valors enllaçats no es registren mai, de manera que el contingut, les
  contrasenyes i els tokens queden fora de les traces. `COMMIT` i `ROLLBACK` tenen els seus propis
  spans, i a SQLite un span `write lock` mostra quant ha esperat una escriptura els escriptors
  que tenia al davant.
- Els esdeveniments de registre escrits mentre se servia la petició, com a esdeveniments del span.

Les sentències executades fora d'una petició (inici, migracions, tasques en segon pla) no es
tracen. `[telemetry].sample_ratio` conserva una part de les traces (`0.1` en conserva una de cada
deu); els spans s'envien per lots i es buiden quan el servidor s'atura. El nivell de registre no
filtra les traces: `[log].level = "warn"` continua exportant totes les peticions.

## Informes d'errors (Sentry)

Defineix un DSN per enviar els panics i les respostes `5xx` a [Sentry](https://sentry.io) (o a un
servei compatible amb Sentry com GlitchTip):

```sh
SENTRY_DSN=https://<key>@o0.ingest.sentry.io/<project>
```

`[telemetry].sentry_dsn` també funciona; la variable té prioritat. Un `5xx` arriba com un
esdeveniment d'error `POST /api/articles answered 500`, etiquetat amb `http.method`,
`http.status_code` i el `request_id`, que coincideix amb la capçalera `X-Request-Id` i les línies de
registre d'aquesta petició. Els esdeveniments porten la versió de Verdin com a release i
`production` (`verdin start`) o `development` (`verdin dev`) com a entorn, tret que
`SENTRY_ENVIRONMENT` o `[telemetry].sentry_environment` en nomeni un altre. Les URL s'informen amb
els valors de consulta d'aspecte secret ocults, com als registres; els cossos i les capçaleres de les
peticions no s'envien mai.

## Registres

Verdin escriu els registres a la sortida d'error estàndard.

| Opció | Valors | Per defecte |
| --- | --- | --- |
| `[log].format` | `pretty` (per a terminals) o `json` (un objecte per línia) | `pretty`; `json` a la imatge Docker |
| `[log].level` | Un nivell o filtre: `error`, `warn`, `info`, `debug`, `trace`, o per mòdul (`info,verdin_api=debug`) | `info` |
| `RUST_LOG` | La mateixa sintaxi; té prioritat sobre `[log].level` quan està definida | sense definir |

Fes servir `json` en producció i envia la sortida d'error estàndard al teu sistema de registres.
Una línia JSON té aquest aspecte:

```json
{"timestamp":"2026-09-29T09:27:16.444598Z","level":"INFO","fields":{"message":"verdin listening","address":"0.0.0.0:1337","mode":"production","version":"0.10.0"},"target":"verdin::app"}
```

En iniciar-se, les línies `WARN` assenyalen opcions que cal corregir en producció, com ara
`[email].provider is 'log'` o les galetes segures desactivades.

### Peticions

Cada petició rep un id de petició: la capçalera `X-Request-Id` entrant si n'hi ha, o un UUID nou.
Es retorna a la capçalera de resposta `X-Request-Id` i s'adjunta a cada línia de registre escrita
mentre se serveix la petició (`request_id`, amb `method` i `uri`). Passa la capçalera des del teu
proxy per seguir una petició a través dels sistemes.

Les peticions no es registren una per una al nivell `info`. Per registrar cada petició amb el seu
estat i latència, apuja el nivell de la capa HTTP:

```sh
RUST_LOG=info,tower_http=debug
```

Les URL registrades amaguen els valors dels paràmetres de consulta amb noms que semblen secrets
(`token`, `code`, `state`, `password`, `key`, `signature`, `jwt`…), per exemple
`/api/connect/github/callback?code=[hidden]`.

## Al tauler d'administració

Afegeix el widget **Sistema** al tauler d'inici per veure d'un cop d'ull la versió, la base de dades
i l'esquema.
