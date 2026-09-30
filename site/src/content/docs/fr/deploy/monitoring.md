---
title: Supervision
description: Surveillez une instance Verdin en fonctionnement — les vérifications /_health et /_ready, les métriques Prometheus sur /_metrics et un tableau de bord Grafana, les traces OpenTelemetry, les rapports d’erreurs Sentry, le format et les niveaux des logs et les identifiants de requête.
sidebar:
  order: 10
---

Une instance Verdin rend compte de son état via deux endpoints de santé, des métriques
Prometheus facultatives, des traces OpenTelemetry et des rapports d’erreurs Sentry
facultatifs, et des logs structurés. Cette page liste ce que renvoie chacun et comment
l’activer.

## Health checks

Les deux endpoints sont servis à la racine du serveur, hors des préfixes d’API, et ne
nécessitent aucune authentification.

| Endpoint | Réponse | À utiliser pour |
| --- | --- | --- |
| `GET /_health` | Toujours `200 {"status":"ok"}` tant que le processus sert du HTTP. | La liveness : redémarrer le processus quand il ne répond plus. |
| `GET /_ready` | `200 {"status":"ready","database":"postgres"}` quand la base de données répond à un ping, `503 {"status":"unavailable"}` sinon. | La readiness et les vérifications du répartiteur de charge : n’envoyer du trafic qu’aux instances qui répondent 200. |

`database` vaut `postgres`, `mysql`, `mariadb` ou `sqlite`. `/_ready` ne vérifie pas les
migrations : `verdin start` refuse de démarrer tant que des migrations sont en attente (sauf si
`--migrate` les applique), donc un serveur en fonctionnement n’en a aucune.

```sh frame="terminal"
curl -s localhost:1337/_ready
{"status":"ready","database":"sqlite"}
```

## Métriques Prometheus

Activez les métriques et définissez un jeton :

```toml title="verdin.toml"
[metrics]
enabled = true
```

```sh
VERDIN_METRICS_TOKEN=<a long random string>
```

`GET /_metrics` sert alors le format texte de Prometheus (version 0.0.4). Avec un jeton
(`VERDIN_METRICS_TOKEN`, qui l’emporte sur `[metrics].token`), une collecte sans
`Authorization: Bearer <token>` reçoit `401`. Sans jeton, quiconque atteint le port peut lire
les métriques.

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

Avec plusieurs instances, collectez chacune d’elles : chaque instance compte ses propres
requêtes.

| Métrique | Type | Labels | Signification |
| --- | --- | --- | --- |
| `verdin_http_requests_total` | counter | `area`, `method`, `status` | Requêtes HTTP servies. |
| `verdin_http_request_duration_seconds` | histogram | `area`, `method`, `status` | Temps de traitement des requêtes. Buckets de 5 ms à 10 s. |
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`, `kind`, `function` | Temps pris par les fonctions des [plugins](/fr/extending/plugins/). Mêmes buckets. |
| `verdin_plugin_call_errors_total` | counter | `plugin`, `kind`, `function` | Appels de plugin ayant échoué : un trap, un dépassement de délai, une sortie qui n’est pas du JSON, ou le `{ error }` d’une fonction de démarrage. |
| `verdin_webhook_deliveries_pending` | gauge | | Envois de webhooks en attente. |
| `verdin_realtime_subscribers` | gauge | | Flux d’événements temps réel ouverts. |
| `verdin_cluster_events_total` | counter | `direction` | Événements sur le [bus d’événements partagé](/fr/deploy/scaling/#bus-dévénements-partagé), quand `[cluster].bus` est défini : `sent` vers les autres instances, `received` de leur part, `dropped` (file pleine ou écriture échouée). |
| `verdin_uptime_seconds` | gauge | | Secondes écoulées depuis le démarrage du processus. |
| `verdin_build_info` | gauge | `version` | Toujours 1 ; la version en cours d’exécution. |

`area` est la partie du serveur : `api` (API de contenu), `admin_api`, `admin` (les fichiers
du panneau), `graphql`, `mcp`, `uploads`, `internal` (chemins commençant par `/_`) ou `other`.
`status` est la classe de statut : `2xx`, `3xx`, `4xx` ou `5xx`.
Pour les appels de plugin, `kind` vaut `hook`, `route`, `job`, `startup` ou `graphql` ; les
séries de plugins apparaissent après le premier appel (voir la
[référence des plugins](/fr/extending/plugin-reference/#métriques)).

Alertes utiles : `/_ready` en échec, une part croissante de `5xx`, un
`verdin_webhook_deliveries_pending` qui augmente (une cible de webhook est en panne), un
`verdin_plugin_call_errors_total` qui augmente ou des hooks de plugin lents (ils retardent
les écritures sur lesquelles ils s’exécutent), et un `verdin_uptime_seconds` qui repart à
zéro (redémarrages).

### Tableau de bord Grafana

[`docker/grafana/verdin.json`](https://github.com/Verdin-CMS/verdin/blob/main/docker/grafana/verdin.json)
est un tableau de bord pour ces métriques : débit de requêtes, part de `5xx` et quantiles de
latence par zone, méthode et classe de statut, envois de webhooks en attente, abonnés temps
réel, trafic du bus d’événements, et débit d’appels, p95 et erreurs par fonction de plugin.
Importez-le dans Grafana (**Dashboards → New → Import**) et choisissez votre source de
données Prometheus ; les variables `instance` et `area` en haut filtrent chaque panneau.

## Traces (OpenTelemetry)

Verdin peut exporter une trace de chaque requête vers un collecteur OpenTelemetry (l’OpenTelemetry
Collector, Grafana Alloy ou Tempo, Jaeger, Honeycomb, Datadog…) en OTLP/HTTP. C’est
désactivé par défaut :

```toml title="verdin.toml"
[telemetry]
enabled = true
endpoint = "http://otel-collector:4318"
```

Les variables standard fonctionnent aussi et l’emportent sur le fichier :

```sh
VERDIN_TELEMETRY__ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<key>
OTEL_SERVICE_NAME=cms-production
```

Chaque trace contient :

- **Un span de requête** (kind `server`), nommé d’après la méthode et le chemin avec les
  identifiants remplacés par `{id}` (`PUT /api/articles/{id}`), avec
  `http.response.status_code` et un statut d’erreur sur les `5xx`. Une requête avec un en-tête
  W3C `traceparent` rejoint la trace de l’appelant.
- **Un span par instruction de base de données** (kind `client`) en dessous :
  `db.system.name` (`postgresql`, `mysql`, `mariadb` ou `sqlite`) et `db.query.text`, le SQL
  avec ses espaces réservés `?`. Les valeurs liées ne sont jamais enregistrées : le contenu,
  les mots de passe et les jetons restent donc hors des traces. `COMMIT` et `ROLLBACK` ont
  leurs propres spans, et sur SQLite un span `write lock` montre combien de temps une
  écriture a attendu les écritures qui la précédaient.
- Les événements de log écrits pendant le traitement de la requête, comme événements de span.

Les instructions exécutées hors d’une requête (démarrage, migrations, tâches d’arrière-plan)
ne sont pas tracées. `[telemetry].sample_ratio` conserve une part des traces (`0.1` en garde
une sur dix) ; les spans sont envoyés par lots et vidés à l’arrêt du serveur. Le niveau de log
ne filtre pas les traces : `[log].level = "warn"` exporte quand même chaque requête.

## Rapport d’erreurs (Sentry)

Définissez un DSN pour envoyer les panics et les réponses `5xx` à [Sentry](https://sentry.io)
(ou à un service compatible Sentry comme GlitchTip) :

```sh
SENTRY_DSN=https://<key>@o0.ingest.sentry.io/<project>
```

`[telemetry].sentry_dsn` fonctionne aussi ; la variable l’emporte. Un `5xx` arrive comme un
événement d’erreur `POST /api/articles answered 500`, étiqueté avec `http.method`,
`http.status_code` et le `request_id`, qui correspond à l’en-tête `X-Request-Id` et aux lignes
de log de cette requête. Les événements portent la version de Verdin comme release et
`production` (`verdin start`) ou `development` (`verdin dev`) comme environnement, sauf si
`SENTRY_ENVIRONMENT` ou `[telemetry].sentry_environment` en nomme un autre. Les URL sont
rapportées avec les valeurs de requête d’apparence secrète masquées, comme dans les logs ; les
corps et les en-têtes de requête ne sont jamais envoyés.

## Logs

Verdin écrit ses logs sur la sortie d’erreur standard.

| Paramètre | Valeurs | Valeur par défaut |
| --- | --- | --- |
| `[log].format` | `pretty` (pour les terminaux) ou `json` (un objet par ligne) | `pretty` ; `json` dans l’image Docker |
| `[log].level` | Un niveau ou un filtre : `error`, `warn`, `info`, `debug`, `trace`, ou par module (`info,verdin_api=debug`) | `info` |
| `RUST_LOG` | Même syntaxe ; l’emporte sur `[log].level` quand elle est définie | non définie |

Utilisez `json` en production et envoyez la sortie d’erreur standard à votre système de logs.
Une ligne JSON ressemble à ceci :

```json
{"timestamp":"2026-09-29T09:27:16.444598Z","level":"INFO","fields":{"message":"verdin listening","address":"0.0.0.0:1337","mode":"production","version":"0.10.0"},"target":"verdin::app"}
```

Au démarrage, des lignes `WARN` signalent les paramètres à corriger en production, comme
`[email].provider is 'log'` ou des cookies sécurisés désactivés.

### Requêtes

Chaque requête reçoit un identifiant : l’en-tête `X-Request-Id` entrant s’il existe, sinon un
nouvel UUID. Il est renvoyé dans l’en-tête de réponse `X-Request-Id` et attaché à chaque ligne
de log écrite pendant le traitement de la requête (`request_id`, avec `method` et `uri`).
Transmettez l’en-tête depuis votre proxy pour suivre une requête d’un système à l’autre.

Les requêtes ne sont pas journalisées une par une au niveau `info`. Pour journaliser chaque
requête avec son statut et sa latence, augmentez le niveau de la couche HTTP :

```sh
RUST_LOG=info,tower_http=debug
```

Les URL journalisées masquent les valeurs des paramètres de requête dont le nom semble secret
(`token`, `code`, `state`, `password`, `key`, `signature`, `jwt`…), par exemple
`/api/connect/github/callback?code=[hidden]`.

## Dans le panneau d’administration

Ajoutez le widget **Système** au tableau de bord d’accueil pour voir d’un coup d’œil la
version, la base de données et le schéma.
