---
title: Supervision
description: Surveillez une instance Verdin en fonctionnement — les vérifications /_health et /_ready, les métriques Prometheus sur /_metrics et leur jeton, le format et les niveaux des logs et les identifiants de requête.
sidebar:
  order: 10
---

Une instance Verdin rend compte de son état via deux endpoints de santé, des métriques
Prometheus facultatives et des logs structurés. Cette page liste ce que renvoie chacun et
comment l’activer.

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
| `verdin_webhook_deliveries_pending` | gauge | | Envois de webhooks en attente. |
| `verdin_realtime_subscribers` | gauge | | Flux d’événements temps réel ouverts. |
| `verdin_uptime_seconds` | gauge | | Secondes écoulées depuis le démarrage du processus. |
| `verdin_build_info` | gauge | `version` | Toujours 1 ; la version en cours d’exécution. |

`area` est la partie du serveur : `api` (API de contenu), `admin_api`, `admin` (les fichiers
du panneau), `graphql`, `mcp`, `uploads`, `internal` (chemins commençant par `/_`) ou `other`.
`status` est la classe de statut : `2xx`, `3xx`, `4xx` ou `5xx`.

Alertes utiles : `/_ready` en échec, une part croissante de `5xx`, un
`verdin_webhook_deliveries_pending` qui augmente (une cible de webhook est en panne), et un
`verdin_uptime_seconds` qui repart à zéro (redémarrages).

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
