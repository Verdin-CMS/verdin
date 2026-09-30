---
title: Référence de configuration
description: Chaque section et chaque clé de verdin.toml, avec leurs valeurs par défaut, et les variables d’environnement que lit Verdin.
sidebar:
  order: 1
  label: Configuration
---

<!-- Written from crates/verdin/src/config.rs, crates/verdin-upload/src/config.rs and
crates/verdin-email/src/lib.rs, crates/verdin-upload/src/transform.rs,
crates/verdin-search/src/lib.rs, crates/verdin-api/src/cdn.rs, crates/verdin-api/src/ai.rs
and crates/verdin/src/telemetry.rs.
Keep it in step when keys change. -->

La configuration est organisée en couches : **valeurs par défaut intégrées ← `verdin.toml` ←
environnement**. Le fichier est facultatif ; chaque clé a une valeur par défaut. Les clés
inconnues sont rejetées : une faute de frappe fait donc échouer le démarrage au lieu d’être
ignorée.

- Remplacez n’importe quelle clé avec `VERDIN_<SECTION>__<KEY>` (deux tirets bas), par exemple
  `VERDIN_SERVER__PORT=8080` ou `VERDIN_ADMIN__SECURE_COOKIES=false`. Les tables imbriquées
  prennent un `__` de plus : `VERDIN_ADMIN__BRANDING__TITLE=ACME`. Les clés inconnues sont aussi
  rejetées ici : toute variable qui commence par `VERDIN_` et contient `__` doit donc désigner une
  clé réelle.
- `VERDIN_DATABASE_URL` est un raccourci pour `database.url`.
- Le fichier est `verdin.toml` dans le répertoire de travail, ou le chemin donné avec
  `-c, --config` ou `VERDIN_CONFIG`. Les chemins relatifs qu’il contient (schéma, plugins,
  téléversements, fichiers SQLite) sont résolus par rapport au répertoire du fichier.
- Un fichier `.env` situé à côté de la configuration est chargé en premier ; les variables déjà
  définies dans l’environnement l’emportent.

Les secrets ne sont jamais lus depuis `verdin.toml` ; voir
[Variables d’environnement](#variables-denvironnement).

## `[server]`

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `host` | `"0.0.0.0"` | Adresse d’écoute. |
| `port` | `1337` | Port d’écoute. |
| `public_url` | non définie | Adresse par laquelle les navigateurs atteignent le serveur, par exemple `"https://cms.example.com"`. Utilisée pour les liens des e-mails et les callbacks SSO ; vaut par défaut `http://localhost:{port}`. |
| `body_limit` | `"1mb"` | Taille maximale du corps des requêtes ordinaires de l’API (les téléversements ont leur propre limite). Un nombre d’octets ou une chaîne avec `b`, `kb`, `mb` ou `gb`. |
| `request_timeout_secs` | `30` | Limite de temps des requêtes ordinaires de l’API. |
| `sync_interval_secs` | `10` | Fréquence de prise en compte des paramètres modifiés par d’autres instances (fonctionnalités, interrupteurs des plugins, langues, workflows de relecture) ; `0` désactive ce mécanisme (instance unique). |
| `trusted_proxies` | `[]` | Reverse proxies (IP ou plages CIDR, par exemple `["10.0.0.0/8"]`) dont le `X-Forwarded-For` désigne le client. Les limites de débit et les journaux d’audit utilisent cette adresse ; sans cela, tous les clients derrière le proxy en partagent une seule. |

## `[database]`

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `url` | non définie | URL de connexion : `postgres://…`, `mysql://…` (MySQL et MariaDB) ou `sqlite://…`. Obligatoire ; généralement définie via `VERDIN_DATABASE_URL`. |
| `pool_max` | `10` | Nombre maximal de connexions dans le pool. |

## `[schema]`

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `path` | `"schema"` | Répertoire du schéma, relatif au fichier de configuration. |

## `[api]`

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `prefix` | `"/api"` | Chemin sous lequel l’API de contenu est servie. Doit commencer par `/` et ne pas se terminer par `/`. |
| `default_page_size` | `25` | Taille de page quand une requête n’en définit pas. Entre 1 et `max_page_size`. |
| `max_page_size` | `100` | Taille de page maximale qu’une requête peut demander. |
| `decimal_as_string` | `false` | Sérialise les décimaux en chaînes (exactes) au lieu de nombres (compatibles avec Strapi). |
| `public_rate_limit` | `0` | Requêtes par minute et par IP client sans jeton (`0` : illimité). |
| `token_rate_limit` | `0` | Requêtes par minute et par jeton d’API ou utilisateur final (`0` : illimité). |
| `cache_ttl_secs` | `0` | Durée de conservation en mémoire des lectures anonymes (`0` : pas de cache) ; les modifications vident le cache. |
| `cache_entries` | `1000` | Nombre maximal de réponses en cache. |
| `cors_origins` | `[]` | Origines de navigateur autorisées à appeler l’API de contenu et GraphQL depuis un autre site (`["https://www.example.com"]` : schéma, hôte et port, sans chemin), ou `["*"]` pour toutes (seul : `*` ne peut pas être combiné avec des origines). Vide : seules les pages de même origine peuvent les appeler depuis un navigateur. L’API d’administration n’accepte jamais d’appels cross-origin. |

## `[admin]`

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `path` | `"/admin"` | Chemin sous lequel le panneau d’administration est servi ; son API se trouve sur `{path}/api`. |
| `secure_cookies` | non défini | Marque le cookie de rafraîchissement comme `Secure`. Non défini signifie oui sous `verdin start` et non sous `verdin dev` (développement local en HTTP simple). |
| `auth_rate_limit` | `20` | Tentatives de connexion, d’inscription et de rafraîchissement par IP client et par minute. |
| `assets_dir` | non défini | Sert le panneau d’administration depuis ce répertoire (relatif au fichier de configuration) au lieu de la copie intégrée au binaire. |

### `[admin.branding]`

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `title` | `"Verdin"` | Affiché dans la barre latérale, sur la page de connexion et dans l’onglet du navigateur. |
| `logo` | non défini | Fichier image (SVG, PNG, WebP), relatif au fichier de configuration. |
| `favicon` | non défini | Fichier d’icône (ICO, PNG, SVG), relatif au fichier de configuration. |
| `accent` | non défini | Couleur `#rrggbb` des boutons, des liens et des anneaux de focus. |
| `translations` | `{}` | Textes de l’administration remplacés par langue, par exemple `[admin.branding.translations.en]` avec `"auth.login.title" = "Welcome to ACME"`. Les clés sont celles de `admin/public/i18n/en.json`. |

## `[upload]`

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `provider` | `{ name = "local", dir = "public/uploads" }` | Où les fichiers sont stockés ; voir ci-dessous. |
| `max_file_size` | `209715200` | Taille maximale d’un fichier accepté, en octets (200 Mo). |
| `responsive_formats` | `true` | Génère des formats responsives pour les images matricielles. |
| `breakpoints` | large 1000, medium 750, small 500 | Formats responsives sous forme de tables `{ name, width }` (les `breakpoints` de Strapi). Les formats plus larges que l’image sont omis. |
| `max_image_megapixels` | `100` | Limite de décodage contre les bombes de décompression, en mégapixels. |
| `max_original_size` | non défini | Les originaux matriciels plus grands que ce nombre de pixels (sur l’un ou l’autre côté) sont réduits au téléversement, ce qui supprime aussi leurs métadonnées (EXIF, GPS). Non défini conserve les originaux tels qu’envoyés. |

```toml
[upload]
breakpoints = [{ name = "large", width = 1000 }, { name = "small", width = 500 }]
```

### Fournisseur local

Fichiers sous `dir` (relatif au projet), servis par Verdin sur `/uploads`.

```toml
[upload]
provider = { name = "local", dir = "public/uploads" }
```

### `[upload.transforms]`

Transformations d’images des fichiers locaux : `/uploads/<file>?preset=thumb`, ou
`?w=&h=&fit=&format=&q=` avec une signature. Les rendus sont mis en cache sur disque et supprimés
quand le fichier change (y compris son point focal). Les recadrages cover gardent visible le point
focal du fichier ; les images ne sont jamais agrandies. Les formats JPEG, PNG, WebP, TIFF et BMP
peuvent être transformés (pas les GIF, qui peuvent être animés).

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `enabled` | `true` | Sert les transformations. |
| `presets` | `{}` | Transformations nommées, toujours autorisées : `{ w, h, fit, format, q }`. |
| `allow_arbitrary` | `false` | Accepte n’importe quels paramètres sans signature. Chaque URL distincte est rendue et mise en cache : à réserver aux réseaux de confiance. |
| `max_size` | `4096` | `w` ou `h` maximal, en pixels. |
| `cache_dir` | `".cache/transforms"` | Où les rendus sont conservés (relatif au projet ; peut être supprimé sans risque). |

Paramètres : `w`, `h` (pixels), `fit` (`cover`, par défaut, recadre au cadre ; `inside` fait tenir
dans le cadre ; `fill` étire), `format` (`jpeg`, `png`, `webp` ; la sortie WebP est sans perte) et
`q` (qualité JPEG, 1–100, 80 par défaut).

```toml
[upload.transforms.presets]
thumb = { w = 300, h = 300 }
hero = { w = 1600, h = 600, format = "webp" }
```

**URL signées.** Avec `VERDIN_IMAGE_SECRET` défini, `s` est le HMAC-SHA256 en hexadécimal de
`<file>?<canonical query>`, où la requête canonique liste les paramètres qui ne sont pas à leur
valeur par défaut, triés par nom (`fit`, `format`, `h`, `q`, `w` ; `fit=cover` omis) :

```js
import { createHmac } from 'node:crypto';
const s = createHmac('sha256', process.env.VERDIN_IMAGE_SECRET)
  .update('photo_1a2b.jpg?format=webp&w=800')
  .digest('hex');
const url = `/uploads/photo_1a2b.jpg?format=webp&w=800&s=${s}`;
```

### Fournisseur S3

N’importe quel service compatible S3 (AWS, Cloudflare R2, MinIO, Backblaze B2…). Les
identifiants proviennent des variables d’environnement standard `AWS_*` (`AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`).

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `bucket` | obligatoire | Nom du bucket. |
| `region` | non définie | Région du bucket. |
| `endpoint` | non défini | Endpoint personnalisé pour les services hors AWS, par exemple `https://<account>.r2.cloudflarestorage.com`. |
| `public_url` | obligatoire | URL de base publique du bucket ou de son CDN ; les fichiers sont liés sous la forme `{public_url}/{key}`. |
| `prefix` | `""` | Préfixe des clés dans le bucket. |
| `path_style` | `false` | Requêtes en path-style (MinIO et la plupart des services auto-hébergés). |

```toml
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

## `[webhooks]`

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `allow_private_networks` | non défini | Autorise les URL de webhooks sur des adresses de bouclage, privées et link-local ; s’applique aussi aux cibles de déploiement et au webhook de `[cdn]`. Non défini signifie non sous `verdin start` (un administrateur pourrait sinon atteindre des services internes) et oui sous `verdin dev`. |
| `timeout_secs` | `10` | Limite de temps de chaque envoi. |
| `retention_days` | `30` | Nombre de jours de conservation du journal des envois. |

Voir [Webhooks](/fr/guides/integrations/webhooks/).

## `[history]`

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `max_versions` | `50` | Versions conservées par document (les plus anciennes sont supprimées). |

## `[email]`

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `provider` | `"log"` | `log` (écrit les e-mails dans le log), `smtp`, `resend` ou `postmark`. |
| `from` | `"Verdin <no-reply@localhost>"` | Expéditeur. |
| `reply_to` | non défini | Adresse de réponse. |

### `[email.smtp]`

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `host` | `"localhost"` | Serveur SMTP. |
| `port` | `587` | Port SMTP. |
| `username` | non défini | Utilisateur SMTP ; le mot de passe provient de `VERDIN_EMAIL_SMTP_PASSWORD`. |
| `security` | `"starttls"` | `starttls`, `tls` (implicite, généralement le port 465) ou `none` (relais locaux). |

## `[plugins]`

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `path` | `"plugins"` | Répertoire des plugins (un sous-répertoire chacun), relatif au fichier de configuration. |
| `run_jobs` | `true` | Exécute les tâches planifiées des plugins sur cette instance (une seule instance quand il y en a plusieurs). |

Voir [Plugins](/fr/extending/plugins/).

## `[audit]`

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `retention_days` | `90` | Nombre de jours de conservation des entrées du journal d’audit. |

## `[digest]`

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `enabled` | `true` | Envoie le résumé quotidien depuis cette instance (une seule instance quand il y en a plusieurs). |
| `hour_utc` | `8` | Heure (UTC, 0–23) d’envoi du résumé quotidien des modifications non vues. |

## `[log]`

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `format` | `"pretty"` | `pretty` ou `json`. |
| `level` | non défini (`info`) | Filtre par défaut ; `RUST_LOG` est prioritaire quand elle est définie. |

## `[metrics]`

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `enabled` | `false` | Sert les métriques Prometheus sur `/_metrics` : requêtes HTTP par zone (`api`, `admin_api`, `graphql`, `mcp`, `uploads`…), méthode et classe de statut avec histogrammes de latence, envois de webhooks en attente, flux temps réel ouverts, trafic du bus d’événements et uptime. |
| `token` | non défini | Les collectes nécessitent `Authorization: Bearer <token>`. `VERDIN_METRICS_TOKEN` l’emporte sur cette clé. Sans jeton, quiconque atteint le port peut lire les métriques. |

## `[telemetry]`

Traces et rapports d’erreurs, tous deux désactivés par défaut et utilisés seulement par
`verdin start` et `verdin dev` (voir [Supervision](/fr/deploy/monitoring/#traces-opentelemetry)).

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `enabled` | `false` | Exporte des traces OpenTelemetry des requêtes HTTP et de leurs requêtes de base de données en OTLP/HTTP (protobuf). `OTEL_SDK_DISABLED=true` le désactive. |
| `endpoint` | non défini (`http://localhost:4318`) | URL de base du collecteur ; `/v1/traces` y est ajouté. `OTEL_EXPORTER_OTLP_ENDPOINT` (URL de base) et `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (URL complète) l’emportent. |
| `service_name` | `"verdin"` | `service.name` des traces. `OTEL_SERVICE_NAME` l’emporte. |
| `sample_ratio` | `1.0` | Part des traces conservées, de `0.0` à `1.0`. Une requête qui porte un en-tête `traceparent` suit la décision de l’appelant. |
| `sentry_dsn` | non défini | Rapporte les panics et les réponses 5xx à Sentry. `SENTRY_DSN` l’emporte. |
| `sentry_environment` | non défini | Environnement Sentry. `SENTRY_ENVIRONMENT` l’emporte ; non défini, `production` dans `verdin start` et `development` dans `verdin dev`. |

## `[ai]`

Actions IA dans l’administration (avec la fonctionnalité **Actions IA** activée dans
Paramètres → Fonctionnalités) : traduire une entrée dans une autre langue, rédiger le texte
alternatif des images, résumer du texte, suggérer des métadonnées SEO. Elles renvoient des
suggestions ; rien n’est enregistré sans le rédacteur. La clé est lue dans `VERDIN_AI_KEY` (les
serveurs locaux n’en ont pas besoin).

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `provider` | `"none"` | `anthropic`, `openai` ou `openai-compatible` (Ollama, LM Studio, vLLM…). |
| `model` | `claude-sonnet-5` pour `anthropic` | Le modèle ; obligatoire pour les autres fournisseurs. |
| `base_url` | celle du fournisseur | Un autre endpoint, par exemple `http://localhost:11434/v1`. |
| `max_tokens` | `2048` | Longueur maximale de la réponse. |

```toml
[ai]
provider = "anthropic"
```

Chaque administrateur peut faire 30 requêtes IA par minute. Le contenu et les images sont envoyés
au fournisseur : choisissez-en un que votre organisation autorise.

## `[cdn]`

Purge les caches du CDN quand le contenu change publiquement. Les réponses de l’API de contenu
sont étiquetées `vd` et `vd-<singularName>` (en-têtes `Cache-Tag` et `Surrogate-Key`).

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `provider` | `"none"` | `cloudflare`, `fastly` ou `webhook`. |
| `zone_id` | non défini | Zone Cloudflare (purge par étiquette). |
| `service_id` | non défini | Service Fastly (purge par surrogate key). |
| `url` | non définie | `webhook` : reçoit `POST { "tags": [...] }`. |
| `debounce_ms` | `1000` | Délai de regroupement des modifications avant la purge. |

Le jeton d’API est lu dans `VERDIN_CDN_TOKEN` (envoyé comme jeton bearer aux webhooks).

## `[search]`

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `enabled` | `false` | Classe `_q` avec un index plein texte (Tantivy) au lieu de `$containsi`. |
| `dir` | `"data/search"` | Répertoire de l’index, relatif au projet. Le supprimer reconstruit l’index au prochain démarrage. |
| `memory_mb` | `50` | Budget mémoire de l’indexation. |

L’index réside sur le disque de l’instance. Avec plusieurs instances, activez le
[bus d’événements](#cluster) pour que chaque index suive les écritures de toutes.

## `[cluster]`

Le bus d’événements partagé, pour plusieurs instances d’un même projet (voir
[Exécuter plusieurs instances](/fr/deploy/scaling/#bus-dévénements-partagé)).

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `bus` | `"none"` | `none` : les événements temps réel, la présence, l’invalidation des caches et les mises à jour de la recherche restent dans chaque instance. `database` : ils atteignent chaque instance via la base de données du projet (`LISTEN/NOTIFY` sur PostgreSQL, interrogation périodique sur MySQL, MariaDB et SQLite). |
| `poll_interval_ms` | `1000` | Fréquence à laquelle MySQL, MariaDB et SQLite lisent les événements des autres instances. PostgreSQL est réveillé par `NOTIFY` et n’utilise ce rythme que lorsqu’il ne peut pas écouter. |
| `instance_id` | non défini (aléatoire à chaque démarrage) | Le nom de cette instance sur le bus et dans les logs. |

```toml
[cluster]
bus = "database"
```

Définissez-le sur chaque instance, ou avec `VERDIN_CLUSTER__BUS=database`.

## Variables d’environnement

Outre les surcharges `VERDIN_<SECTION>__<KEY>`, Verdin lit ces variables :

| Variable | Description |
| --- | --- |
| `VERDIN_CONFIG` | Chemin du fichier de configuration (comme `--config`). |
| `VERDIN_DATABASE_URL` | Raccourci pour `database.url`. |
| `VERDIN_ADMIN_JWT_SECRET` | Signe les jetons de session d’administration. Obligatoire, au moins 32 octets ; générez-le avec `verdin secrets`. |
| `VERDIN_TOKEN_PEPPER` | Clé de hachage des jetons stockés. Obligatoire, au moins 32 octets ; générez-le avec `verdin secrets`. |
| `VERDIN_ADMIN_PASSWORD` | Mot de passe pour `verdin admin create` et `verdin admin reset-password` (sinon lu sur l’entrée standard) ; voir la [référence de la ligne de commande](/fr/reference/cli/). |
| `VERDIN_EMAIL_SMTP_PASSWORD` | Mot de passe SMTP. |
| `VERDIN_EMAIL_API_KEY` | Clé d’API des fournisseurs Resend et Postmark. |
| `VERDIN_SSO_<ID>_SECRET` | Secret client d’un fournisseur SSO ; `<ID>` est l’identifiant du fournisseur en majuscules, avec `-` remplacé par `_` (voir [Authentification unique](/fr/guides/auth/sso/)). |
| `VERDIN_OAUTH_<PROVIDER>_SECRET` | Secret client d’un fournisseur OAuth pour les utilisateurs finaux, nommé comme ceux du SSO (voir [Utilisateurs finaux](/fr/guides/auth/end-users/)). |
| `VERDIN_AI_KEY` | Clé d’API du fournisseur de `[ai]`. |
| `VERDIN_CDN_TOKEN` | Jeton d’API du fournisseur de `[cdn]`. |
| `VERDIN_IMAGE_SECRET` | Signe les URL de transformation d’images (voir [`[upload.transforms]`](#uploadtransforms)). |
| `VERDIN_METRICS_TOKEN` | Jeton bearer pour les collectes de `/_metrics` quand `[metrics].enabled` ; l’emporte sur `[metrics].token`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Collecteur des traces de [`[telemetry]`](#telemetry) ; l’emportent sur `[telemetry].endpoint`. Les autres variables standard `OTEL_EXPORTER_OTLP_*` (en-têtes, délai, compression) s’appliquent aussi. |
| `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` | Ressource des traces exportées ; `OTEL_SERVICE_NAME` l’emporte sur `[telemetry].service_name`. |
| `OTEL_SDK_DISABLED` | `true` désactive l’export des traces même si `[telemetry].enabled`. |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | Rapport d’erreurs Sentry ; l’emportent sur `[telemetry].sentry_dsn` et `sentry_environment`. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Identifiants du fournisseur de téléversement S3. |
| `RUST_LOG` | Filtre des logs ; prioritaire sur `[log].level`. |
