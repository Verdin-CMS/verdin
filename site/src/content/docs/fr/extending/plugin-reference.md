---
title: Référence des plugins
description: Le manifeste plugin.toml, les capacités, les hooks et leurs payloads, les fonctions hôtes, les routes, les tâches, la fonction de démarrage, les champs GraphQL, les points d’extension de l’administration, les limites et les métriques.
sidebar:
  order: 3
---

<!-- Written from crates/verdin-plugins (lib.rs, manifest.rs), crates/verdin-api/src/plugins.rs,
plugins_admin.rs, crates/verdin-graphql/src/lib.rs, crates/verdin/src/metrics.rs and
admin/src/app/core/plugin-extensions.ts. -->

Cette page est le contrat complet entre Verdin et un plugin : le manifeste, ce que Verdin envoie
à chaque fonction exportée et ce qu’il attend en retour, et les fonctions hôtes qu’un module
peut appeler. Pour une introduction, voir [Plugins](/fr/extending/plugins/) ; pour un exemple
complet, le [tutoriel de plugin](/fr/extending/plugin-tutorial/).

## Répertoire du plugin

Chaque plugin est un répertoire sous `[plugins].path` (par défaut `plugins/`, à côté de
`verdin.toml`) :

| Fichier | Obligatoire | Contenu |
| --- | --- | --- |
| `plugin.toml` | oui | Le manifeste. |
| `plugin.wasm` | oui | Le module (un autre chemin avec `wasm`). |
| `admin/` | non | Les fichiers que charge le panneau d’administration : le module `admin.script` et ses ressources. |

Au démarrage, Verdin charge chaque répertoire qui contient un `plugin.toml`, par ordre de nom.
Un répertoire est ignoré, et listé avec la raison dans **Paramètres → Plugins**, quand son
manifeste est invalide, que son module est absent ou qu’un autre plugin utilise déjà son `name`.

## Manifeste

```toml title="plugins/slugs/plugin.toml"
name = "slugs"
version = "1.0.0"
description = "Slugs from titles, and a color field"

[capabilities]
read = ["api::article"]
write = ["api::tag"]
http = ["api.example.com"]
kv = true
public_permissions = true

[limits]
timeout_ms = 5000
memory_mb = 64

[[hooks]]
on = "beforeCreate"
uid = "api::article"
function = "before_write"

[routes]
function = "handle"

[[jobs]]
schedule = "*/15 * * * *"
function = "refresh"

[startup]
function = "seed"
timeout_ms = 30000

[[graphql]]
name = "slugStats"
function = "stats"

[admin]
script = "index.js"

[[admin.widgets]]
id = "stats"
title = "Slug stats"
element = "slugs-stats"

[[admin.fields]]
id = "color"
title = "Color"
element = "slugs-color"
type = "string"

[[settings]]
key = "separator"
label = "Separator"
type = "select"
options = ["-", "_"]
default = "-"
```

Les clés inconnues sont des erreurs, dans toutes les tables.

### Clés de premier niveau

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `name` | obligatoire | L’identifiant du plugin dans les URL, les paramètres et les champs personnalisés : lettres minuscules, chiffres et `-`, commençant par une lettre, 64 caractères au maximum. |
| `version` | obligatoire | Affichée dans l’administration et dans le log. |
| `description` | non définie | Affichée dans **Paramètres → Plugins**. |
| `wasm` | `"plugin.wasm"` | Le module, relatif au répertoire du plugin (pas de `..`, pas de chemin absolu). |
| `wasi` | `false` | Donne WASI au module : une horloge et des nombres aléatoires. Dans tous les cas, ni fichiers ni sockets. |

### `[capabilities]`

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `read` | `[]` | Les types de contenu que `verdin_content` peut lire (`findMany`, `findOne`) : des UID comme `api::article`, ou `"*"` pour tous. |
| `write` | `[]` | Les types de contenu sur lesquels il peut faire `create`, `update`, `delete`, `publish` et `unpublish`. Implique `read`. |
| `http` | `[]` | Les hôtes auxquels le module peut envoyer des requêtes HTTP : `api.example.com`, ou `*.example.com`. |
| `kv` | `false` | Le stockage clé-valeur propre au plugin (`verdin_kv_get`, `verdin_kv_set`). |
| `public_permissions` | `false` | La lecture et le remplacement des autorisations de l’API de contenu du rôle public (`verdin_public_permissions`). |

Les capacités ne limitent que les appels à l’hôte. Les hooks s’exécutent sur les types qu’ils
nomment, quoi que dise `read`, et les routes sont accessibles à tous.

### `[limits]`

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `timeout_ms` | `5000` | Limite de temps d’un appel, en millisecondes. |
| `memory_mb` | `64` | Mémoire maximale du module, en mégaoctets. |

Les deux doivent être positives.

### `[[hooks]]`

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `on` | obligatoire | L’événement, ci-dessous. |
| `uid` | `"*"` | Le type de contenu (`api::article`), ou `"*"` pour tous. |
| `function` | obligatoire | La fonction exportée à appeler. |

Événements :

| Avant l’écriture | Après l’écriture |
| --- | --- |
| `beforeCreate` | `afterCreate` |
| `beforeUpdate` | `afterUpdate` |
| `beforeDelete` | `afterDelete` |
| `beforePublish` | `afterPublish` |
| `beforeUnpublish` | `afterUnpublish` |
| `beforeDiscardDraft` | `afterDiscardDraft` |

Les noms sont ceux du cycle de vie de Strapi. Les hooks s’exécutent sur les écritures provenant
du panneau d’administration, des API REST et GraphQL et des releases, mais pas sur les
écritures faites par les commandes `verdin import`. Les écritures faites par des plugins
exécutent les hooks after mais pas les hooks before (voir
[Écritures faites par les plugins](#écritures-faites-par-les-plugins)).

### `[routes]`

| Clé | Description |
| --- | --- |
| `function` | La fonction exportée qui sert toutes les requêtes vers `/api/plugins/<name>` et `/api/plugins/<name>/…`, quelle que soit la méthode. |

Le chemin suit `[api].prefix`.

### `[[jobs]]`

| Clé | Description |
| --- | --- |
| `schedule` | Expression cron, en UTC, avec des secondes facultatives : `*/15 * * * *`, `0 0 3 * * *`. |
| `function` | La fonction exportée à appeler. |

### `[startup]`

Une fonction exécutée au démarrage du plugin : ce qu’un projet Strapi fait dans `bootstrap`
(amorcer du contenu, configurer le rôle public).

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `function` | obligatoire | La fonction exportée à appeler. |
| `timeout_ms` | `30000` | Sa propre limite de temps, en millisecondes (l’amorçage peut prendre plus de temps qu’un hook). Doit être positive. |

Voir [Fonction de démarrage](#fonction-de-démarrage) pour savoir quand elle s’exécute.

### `[[graphql]]`

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `name` | obligatoire | Le nom du champ : commence par une lettre minuscule, suivie de lettres, chiffres et `_`. |
| `function` | obligatoire | La fonction exportée qui le résout. |
| `mutation` | `false` | Ajoute le champ à `Mutation` au lieu de `Query`. |
| `description` | non définie | La description du champ dans le schéma. |

Chaque entrée ajoute `name(args: JSON): JSON`. Un nom déjà utilisé par un type de contenu, ou
pris d’abord par un autre plugin, est ignoré avec un avertissement dans le log.

### `[admin]`

| Clé | Description |
| --- | --- |
| `script` | Module ES sous `admin/` qui définit les custom elements (pas de `..`, pas de chemin absolu). |
| `[[admin.widgets]]` | Types de widgets du tableau de bord : `id`, `title`, `element`, `description` facultative. |
| `[[admin.fields]]` | Champs personnalisés : `id`, `title`, `element`, `type` (le type d’attribut sous lequel la valeur est stockée, comme `string` ou `json`), `description` facultative. |

`element` est un nom de custom element : lettres minuscules, chiffres et `-`, avec au moins un
`-` (`slugs-color`).

### `[[settings]]`

Déclare le formulaire de **Paramètres → Plugins → Paramètres**. Sans aucune entrée, les
paramètres sont un objet JSON libre.

| Clé | Valeur par défaut | Description |
| --- | --- | --- |
| `key` | obligatoire | La clé dans l’objet de paramètres : lettres, chiffres et `_`, sans chiffre au début, unique. |
| `label` | obligatoire | Le libellé du formulaire. |
| `type` | `"string"` | `string`, `text`, `url`, `number`, `integer`, `boolean` ou `select`. |
| `description` | non définie | Texte d’aide sous le champ. |
| `required` | `false` | Une valeur (non vide pour du texte) est nécessaire, sauf s’il y a un `default`. |
| `options` | `[]` | Les choix d’un `select` (obligatoire pour celui-ci). |
| `default` | non définie | Utilisée quand la clé est absente ou vaut `null`. Doit être compatible avec le champ. |
| `min`, `max` | non définies | Bornes des valeurs `number` et `integer` ; bornes de longueur de `string` et `text`. |

Les valeurs `url` sont vides ou des URL `http(s)://`. Avec un formulaire, le serveur refuse les
paramètres ayant des clés inconnues, des types incorrects, des valeurs hors bornes ou des valeurs
obligatoires manquantes (400).

## Fonctions exportées

Chaque fonction exportée prend un document JSON et en renvoie un (ou rien). Une sortie vide
compte comme `null` ; une sortie qui n’est pas du JSON compte comme un échec.

### Hooks « before »

Entrée :

```json
{
  "event": "beforeUpdate",
  "uid": "api::article",
  "documentId": "01m3p88ry359w82nsx496mep5t",
  "locale": "en",
  "data": { "title": "Hello" }
}
```

| Champ | Description |
| --- | --- |
| `event` | L’événement du hook. |
| `uid` | Le type de contenu. |
| `documentId` | Le document, ou `null` sur `beforeCreate`. |
| `locale` | Sur les types localisés, la langue écrite (la langue par défaut quand la requête n’en nommait aucune) ; `null` sur les autres types. |
| `data` | Les données en cours d’écriture, telles que la requête les a envoyées : à la création et à la mise à jour. `null` pour les autres événements. À la mise à jour, uniquement les champs envoyés. |

Sortie :

| Sortie | Effet |
| --- | --- |
| `{ "data": { … } }` | Remplace les données écrites. Elles sont validées comme l’original. |
| `{ "error": "message" }` | Refuse l’écriture : l’appelant reçoit un 400 avec le message. |
| `{}` ou toute autre chose | L’écriture se poursuit sans changement. |

Quand plusieurs hooks correspondent, ils s’exécutent dans l’ordre des plugins (noms des
répertoires), puis dans l’ordre du manifeste ; chacun voit les données renvoyées par le
précédent. Un hook qui échoue (trap, délai dépassé, sortie invalide) est journalisé et ignoré :
l’écriture se poursuit.

### Hooks « after »

Entrée : `{ "event", "uid", "documentId", "locale" }`, envoyée après la validation de
l’écriture. La sortie est ignorée ; les échecs sont journalisés. Lisez l’entrée avec
`verdin_content` si vous avez besoin de ses champs (avec la capacité `read`).

### Routes

Entrée :

```json
{
  "method": "GET",
  "path": "/stats",
  "query": "page=2&sort=title",
  "headers": { "accept": "application/json", "user-agent": "curl/8.7.1" },
  "body": "",
  "actor": { "kind": "public" }
}
```

| Champ | Description |
| --- | --- |
| `method` | La méthode HTTP. |
| `path` | Le chemin après `/api/plugins/<name>`, commençant par `/` (`/` pour la racine du plugin). |
| `query` | La chaîne de requête brute, sans `?` (vide s’il n’y en a pas). |
| `headers` | Uniquement `content-type`, `accept`, `user-agent` et `accept-language`, quand ils sont présents. |
| `body` | Le corps de la requête sous forme de chaîne (l’UTF-8 invalide est remplacé). |
| `actor` | Qui appelle : `{ "kind": "public" }`, `{ "kind": "token", "id": 3 }` (un jeton d’API) ou `{ "kind": "user", "id": 12 }` (un utilisateur final connecté). |

Un en-tête `Authorization` avec un jeton invalide est refusé avec un 401 avant l’appel du
plugin. Les autorisations de l’accès public et des jetons d’API ne sont pas appliquées :
vérifiez `actor` vous-même.

Sortie :

| Champ | Valeur par défaut | Description |
| --- | --- | --- |
| `status` | `200` | Le statut HTTP. |
| `headers` | aucun | Les en-têtes de réponse. Seuls `content-type`, `cache-control`, `location`, `etag`, `last-modified` et `content-disposition` sont conservés. |
| `body` | vide | Une chaîne est envoyée telle quelle (`text/plain` sauf si vous définissez `content-type`) ; toute autre valeur JSON est envoyée en `application/json`. |

Un plugin désactivé ou inconnu, ou sans `[routes]`, répond 404. Un appel en échec répond 502
avec `{ "data": null, "error": { "status": 502, "name": "PluginError", … } }`. Les routes
partagent les `[server].body_limit` et `[server].request_timeout_secs` de l’API de contenu.

### Tâches

Entrée : `{ "scheduledAt": "2026-09-29T03:00:00+00:00" }`, l’heure pour laquelle l’exécution
était planifiée. La sortie est ignorée ; les échecs sont journalisés. Les tâches ne s’exécutent
que tant que le plugin est activé, et uniquement sur les instances avec
`[plugins].run_jobs = true`. Une exécution manquée pendant que le serveur était arrêté n’est pas
rattrapée.

### Fonction de démarrage

Entrée : `{ "reason": "start" | "enabled" | "settings" }` :

| `reason` | Quand |
| --- | --- |
| `start` | Le serveur a démarré avec le plugin activé. |
| `enabled` | Le plugin a été activé (ici, ou sur une autre instance et pris en compte ici). |
| `settings` | Ses paramètres ont changé alors qu’il était activé (enregistrés ici, ou pris en compte depuis une autre instance). |

Sortie : `{ "error": "message" }` compte comme un échec ; tout le reste (`{}`, vide) comme un
succès. Un échec (trap, dépassement de délai, `{ error }`) va dans le journal du plugin et dans
le journal du serveur ; le plugin reste activé, et la fonction s’exécute de nouveau au prochain
démarrage, à la prochaine activation ou au prochain changement de paramètres.

La fonction s’exécute en arrière-plan, une fois le serveur démarré : les requêtes sont donc
servies pendant ce temps. Elle s’exécute sur sa propre instance de module avec
`[startup].timeout_ms`, si bien qu’un amorçage lent ne retient pas les hooks et les routes du
plugin. Les hooks after déclenchés par ses écritures s’exécutent une fois qu’elle a rendu la
main (voir [Écritures faites par les plugins](#écritures-faites-par-les-plugins)). La mémoire
du module n’est pas partagée avec l’instance habituelle du plugin : gardez l’état dans
`verdin_kv_set` ou dans le contenu.

Avec plusieurs instances, seules celles avec `[plugins].run_jobs = true` exécutent les
fonctions de démarrage (une seule instance, si vous suivez les
[conseils de mise à l’échelle](/fr/deploy/scaling/)) : elles agissent sur la base de données
partagée, une fois suffit donc. Écrivez la fonction de sorte que la relancer soit sans danger :
cherchez ce que vous amorcez avant de le créer.

### Champs GraphQL

Entrée : `{ "args": …, "actor": … }`, où `args` est l’argument `args` du champ (n’importe quel
JSON, ou `null`) et `actor` est défini comme pour les routes. La sortie est la valeur du champ.
Un échec, ou un plugin désactivé, répond une erreur GraphQL avec le code `PLUGIN_ERROR`. Comme
pour les routes, c’est le plugin qui vérifie l’accès.

## Fonctions hôtes

Importez-les depuis l’espace de noms `extism:host/user` (`extern "ExtismHost"` en Rust). Elles
prennent et renvoient du JSON sous forme de chaînes ; `Json<Value>` dans `extism-pdk` gère la
conversion.

| Fonction | Entrée | Sortie |
| --- | --- | --- |
| `verdin_log` | `{ "level": "info" \| "warn" \| "error", "message": "…" }` | aucune |
| `verdin_content` | Une requête de contenu (ci-dessous) | Le résultat, ou `{ "error": "…" }` |
| `verdin_kv_get` | La clé, sous forme de chaîne brute | La valeur JSON stockée, ou `null` |
| `verdin_kv_set` | `{ "key": "…", "value": … }` | aucune |
| `verdin_config` | aucune | L’objet de paramètres, avec les valeurs par défaut déclarées |
| `verdin_public_permissions` | `{ "op": "get" }` ou `{ "op": "set", "permissions": [...] }` | `{ "permissions": [...] }`, ou `{ "error": "…" }` |

Un module qui importe une fonction hôte que le serveur n’a pas (un Verdin plus ancien) ne peut
pas être chargé : chaque appel échoue avec `unknown import` dans le journal du serveur.

### `verdin_log`

Écrit dans le log du serveur (avec le nom du plugin) et dans le journal du plugin sous
**Paramètres → Plugins → Journaux**. Les autres niveaux comptent comme `info`. Le journal du
plugin garde en mémoire les 200 derniers messages, chacun tronqué à 2 000 caractères.

### `verdin_content`

```json
{ "op": "findMany", "uid": "api::article", "query": { "filters": { "title": { "$eq": "x" } }, "sort": ["title"] } }
```

| Champ | Utilisé par | Description |
| --- | --- | --- |
| `op` | toutes | `findMany`, `findOne`, `create`, `update`, `delete`, `publish` ou `unpublish`. |
| `uid` | toutes | Le type de contenu. Doit figurer dans les capacités. |
| `documentId` | `findOne`, `update`, `delete`, `publish`, `unpublish` | Le document. |
| `query` | `findMany`, `findOne` | Les paramètres de l’API REST sous forme d’objet JSON : `filters`, `sort`, `fields`, `populate`, `pagination`, `status`. |
| `data` | `create`, `update` | Les champs à écrire, comme dans le `data` d’une requête REST. |
| `status` | `create`, `update` | `"draft"` enregistre un brouillon. Sinon, l’écriture est publiée, comme une écriture REST sans `?status=draft`. |
| `locale` | toutes | La langue à lire ou à écrire. |

Résultats :

| `op` | Résultat |
| --- | --- |
| `findMany` | `{ "documents": [...], "meta": { "pagination": {…} } }` |
| `findOne` | `{ "document": {…} }` (`null` s’il n’est pas trouvé) |
| `create`, `update` | `{ "documentId": "…" }` |
| `delete` | `{ "deleted": true }` |
| `publish` | `{ "published": true }` |
| `unpublish` | `{ "unpublished": true }` |

Un appel hors des capacités, une opération inconnue, une erreur de validation ou un document
manquant répond `{ "error": "…" }` à la place. Les lectures renvoient les versions publiées, sauf
si la requête demande `"status": "draft"`.

#### Écritures faites par les plugins

Les écritures via `verdin_content` sautent les hooks **before** de tous les plugins, si bien
qu’un plugin ne peut pas y boucler sur ses propres modifications, et les règles que vous mettez
dans les hooks before (valeurs par défaut, vérifications) ne s’y appliquent pas. Tout le reste
s’applique : la validation, les étapes de relecture, les webhooks, l’historique, le journal
d’audit, et les hooks **after** de tous les plugins, y compris celui qui écrit.

Les hooks after déclenchés par les écritures d’un plugin ne s’exécutent pas dans l’écriture :
ils sont mis en file d’attente et s’exécutent une fois que l’appel du plugin (route, tâche,
résolveur GraphQL, hook ou fonction de démarrage) a rendu la main et libéré l’instance du
plugin, avant l’envoi de la réponse de la route. Un plugin peut donc écrire un type sur lequel
il a des hooks after, et les chaînes à travers plusieurs plugins fonctionnent.

- Les hooks qui écrivent déclenchent d’autres hooks, **sur `4` niveaux au maximum** (une
  écriture depuis REST ou GraphQL est le niveau 1). Les hooks plus profonds sont ignorés avec
  un avertissement dans le journal du plugin, ce qui empêche un hook qui écrit dans le type
  qu’il écoute de boucler indéfiniment.
- Les fonctions hôtes (`verdin_content`, `verdin_public_permissions`, le stockage clé-valeur)
  s’arrêtent à la limite de temps de l’appel et renvoient une erreur au module, et un appelant
  attend au plus la limite de temps plus 10 secondes un plugin occupé. Un appel bloqué ne peut
  pas retenir le plugin, ni un arrêt en douceur, indéfiniment.

### `verdin_kv_get` et `verdin_kv_set`

Un stockage clé-valeur par plugin, dans la base de données de Verdin, partagé par toutes les
instances. Les clés font de 1 à 255 octets ; les valeurs sont n’importe quel JSON. Définir
`null` supprime la clé. Sans la capacité `kv`, les lectures renvoient `null` et les écritures
sont ignorées.

### `verdin_config`

Renvoie les paramètres enregistrés dans **Paramètres → Plugins**, en complétant les clés
manquantes avec le `default` de chaque paramètre déclaré. `{}` quand rien n’est enregistré.

### `verdin_public_permissions`

Lit ou remplace les autorisations de l’API de contenu du rôle public, ce que modifie
**Paramètres → Accès public**. Nécessite la capacité `public_permissions` ; sans elle, chaque
appel répond `{ "error": "…" }`.

```json
{ "op": "set", "permissions": [
  { "subject": "api::article", "action": "find" },
  { "subject": "api::article", "action": "findOne" },
  { "subject": "api::comment", "action": "create" }
] }
```

| `op` | Effet |
| --- | --- |
| `get` | Rien ; renvoie les autorisations actuelles. |
| `set` | Remplace **toutes** les autorisations publiques par `permissions` (une liste vide les supprime toutes). |

Les deux répondent `{ "permissions": [{ "subject", "action" }, …] }`, triées. `subject` est un
uid de type de contenu, `plugin::upload` (la médiathèque), `plugin::users-permissions.user`
(les utilisateurs finaux via l’API de contenu) ou `plugin::i18n.locale` (`find` uniquement).
`action` vaut `find`, `findOne`, `create`, `update`, `delete`, `publish` ou `readDrafts` (les
deux dernières ne s’appliquent pas aux fichiers ni aux utilisateurs finaux). Elles sont
vérifiées comme la grille de droits de l’administration : un sujet ou une action inconnus, ou
qui ne s’applique pas, répond `{ "error": "…" }` et ne change rien. Chaque `set` est écrit dans
le journal du serveur.

### HTTP

Avec des hôtes listés dans `http`, utilisez la prise en charge HTTP d’Extism
(`extism_pdk::http::request` en Rust). Les requêtes vers d’autres hôtes échouent.

## Points d’extension de l’administration

Le panneau d’administration demande au serveur les extensions des plugins activés et importe
chaque `admin.script` une fois, comme module ES, depuis `/admin/plugins/<name>/<script>` (sous
`[admin].path`). Les fichiers du répertoire `admin/` du plugin y sont servis tant que le plugin
est activé, avec `X-Content-Type-Options: nosniff` et `Cache-Control: no-cache`. Le module doit
définir les custom elements que nomme le manifeste ; un élément non défini dans les 3 secondes
est omis.

### Widgets

Chaque entrée `[[admin.widgets]]` est un type de widget que les administrateurs peuvent ajouter
au tableau de bord. L’élément reçoit une propriété `context` :

| Propriété | Description |
| --- | --- |
| `apiBase` | La base de l’API de contenu, comme `/api`. |
| `adminApiBase` | La base de l’API d’administration, comme `/admin/api`. |
| `fetch(path, init)` | `fetch` avec les identifiants de l’administrateur connecté. Les chemins relatifs sont résolus par rapport à `adminApiBase` ; les chemins sous l’une ou l’autre base et les URL absolues sont conservés. |

```js title="plugins/slugs/admin/index.js"
class SlugStats extends HTMLElement {
  set context(context) {
    // Admin API, with the admin's session.
    context.fetch('auth/me').then((response) => response.json())
      .then(({ data }) => { this.textContent = `Hello ${data.firstname ?? data.email}`; });
    // The plugin's own route, on the content API: sent without the admin's session.
    context.fetch(`${context.apiBase}/plugins/slugs/stats`).then((response) => response.json())
      .then((stats) => { this.title = JSON.stringify(stats); });
  }
}
customElements.define('slugs-stats', SlugStats);
```

`context.fetch` n’envoie la session de l’administrateur qu’avec les requêtes à l’API
d’administration. Les chemins sous `context.apiBase` (l’API de contenu, routes de votre plugin
comprises) partent sans elle, puisque l’API de contenu n’accepte pas les sessions
d’administration ; ils reçoivent une réponse avec les autorisations du rôle public. Avant la
0.10, la session y était aussi envoyée et ces requêtes échouaient ; les widgets écrits pour la
0.9 qui appellent un simple `fetch` continuent de fonctionner.

### Champs personnalisés

Chaque entrée `[[admin.fields]]` est un champ que les attributs peuvent utiliser avec
`"customField": "plugin::<name>.<id>"` ; le `type` de l’attribut doit correspondre à la façon dont
le champ stocke sa valeur. Le **Constructeur de types de contenu** le propose. L’élément reçoit :

| Propriété | Description |
| --- | --- |
| `value` | La valeur actuelle. |
| `disabled` | Indique si l’édition est désactivée. |
| `attribute` | La définition de l’attribut dans le schéma. |
| `locale` | La langue en cours d’édition. |

Il signale une nouvelle valeur avec un événement `change` dont le `detail` est la valeur (ou,
sans `detail`, via sa propre propriété `value`). Quand le plugin est désactivé ou que son élément
manque, l’éditeur affiche la saisie habituelle du type de stockage. Voir
[Types d’attributs](/fr/reference/attribute-types/).

## Exécution et limites

| Limite | Valeur |
| --- | --- |
| Temps par appel | `[limits].timeout_ms`, 5 000 ms par défaut (`[startup].timeout_ms`, 30 000 ms par défaut, pour la fonction de démarrage) |
| Mémoire | `[limits].memory_mb`, 64 Mo par défaut |
| Concurrence | Un appel à la fois par plugin ; les appels s’attendent les uns les autres (la fonction de démarrage s’exécute à côté) |
| Instance du module | Une par plugin, construite à la première utilisation ; reconstruite après l’échec d’un appel (sa mémoire est perdue). La fonction de démarrage en reçoit une neuve à chaque exécution |
| Journal | 200 messages par plugin, 2 000 caractères chacun, en mémoire |
| Clés KV | De 1 à 255 octets |
| En-têtes de requête des routes | `content-type`, `accept`, `user-agent`, `accept-language` |
| En-têtes de réponse des routes | `content-type`, `cache-control`, `location`, `etag`, `last-modified`, `content-disposition` |

Les modifications d’un manifeste ou d’un module s’appliquent après un redémarrage ; les
interrupteurs et les paramètres s’appliquent immédiatement. Gérer les plugins nécessite
`plugins.manage` (voir la [référence des autorisations](/fr/reference/permissions/)).

## Métriques

Avec [`[metrics]`](/fr/deploy/monitoring/) activé, `/_metrics` rapporte chaque appel qui a atteint une
fonction exportée :

| Métrique | Type | Labels | Signification |
| --- | --- | --- | --- |
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`, `kind`, `function` | Temps pris par les fonctions des plugins. Buckets de 5 ms à 10 s. |
| `verdin_plugin_call_errors_total` | counter | `plugin`, `kind`, `function` | Appels ayant échoué : un trap, un dépassement de délai, une sortie qui n’est pas du JSON, ou le `{ error }` d’une fonction de démarrage. |

`kind` vaut `hook`, `route`, `job`, `startup` ou `graphql`. Un hook before qui refuse une écriture
avec `{ error }` a donné une réponse : il n’est donc pas compté comme un échec. Les appels à une
fonction que le module n’exporte pas ne sont pas enregistrés, si bien que les labels restent
bornés par les plugins installés. Les séries apparaissent après le premier appel d’un plugin ;
chaque instance compte ses propres appels.
