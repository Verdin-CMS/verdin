---
title: Monitoratge
description: Supervisa una instància de Verdin en execució — les comprovacions /_health i /_ready, les mètriques de Prometheus a /_metrics i el seu token, el format dels registres, els nivells i els ids de petició.
sidebar:
  order: 10
---

Una instància de Verdin informa sobre si mateixa mitjançant dos endpoints de salut, mètriques de
Prometheus opcionals i registres estructurats. Aquesta pàgina llista què retorna cadascun i com
activar-lo.

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
| `verdin_webhook_deliveries_pending` | gauge | | Enviaments de webhooks esperant a ser enviats. |
| `verdin_realtime_subscribers` | gauge | | Fluxos d'esdeveniments en temps real oberts. |
| `verdin_uptime_seconds` | gauge | | Segons des que es va iniciar el procés. |
| `verdin_build_info` | gauge | `version` | Sempre 1; la versió en execució. |

`area` és la part del servidor: `api` (API de contingut), `admin_api`, `admin` (els fitxers del
tauler), `graphql`, `mcp`, `uploads`, `internal` (camins que comencen per `/_`) o `other`.
`status` és la classe d'estat: `2xx`, `3xx`, `4xx` o `5xx`.

Alertes útils: `/_ready` que falla, una proporció creixent de `5xx`, un
`verdin_webhook_deliveries_pending` que creix (una destinació de webhook ha caigut) i un
`verdin_uptime_seconds` que es reinicia (reinicis).

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
