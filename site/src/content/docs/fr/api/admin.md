---
title: "API d’administration"
description: "L’API qui sert le panneau d’administration de Verdin, pour l’automatisation : connexion, sessions, conventions et principaux groupes de routes."
sidebar:
  order: 4
  label: "Administration"
---

Le panneau d’administration est un client de l’API d’administration, servie sous
`{admin.path}/api` (`/admin/api` par défaut). Tout ce que fait le panneau, un script peut le
faire aussi : créer des administrateurs et des jetons d’API, configurer les webhooks et les
fonctionnalités, gérer les langues, ou travailler avec les brouillons et les releases. Cette
page explique comment s’authentifier et liste les groupes de routes.

:::caution[Stabilité]
L’API d’administration n’offre aucune garantie de stabilité avant Verdin 1.0 : les routes et
les corps peuvent changer dans les versions mineures, et le changelog ne liste pas chaque
modification. Pour lire et écrire du contenu, préférez l’API [REST](/fr/api/rest/) ou
[GraphQL](/fr/api/graphql/) avec un [jeton d’API](/fr/guides/auth/api-tokens/). Un contrat de
stabilité pour toutes les API est prévu pour la 1.0.
:::

## Connexion

L’API d’administration n’a pas encore de jetons d’API : un script se connecte en tant
qu’administrateur, idéalement avec un rôle qui n’autorise que ce dont le script a besoin.

```sh title="Terminal"
curl -s -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"bot@example.com","password":"…"}'
```

```json
{
  "data": {
    "user": { "id": 3, "email": "bot@example.com", "…": "…" },
    "accessToken": "eyJhbGciOiJIUzI1NiIs…",
    "accessTokenExpiresAt": "2026-09-29T10:15:00.000Z"
  }
}
```

Envoyez le jeton d’accès avec chaque requête suivante :

```sh title="Terminal"
curl -H "Authorization: Bearer $ACCESS_TOKEN" 'https://cms.example.com/admin/api/system/info'
```

| Identifiant | Durée de vie | Emplacement |
| --- | --- | --- |
| Jeton d’accès (JWT) | 15 minutes | Le corps de la réponse. Envoyez-le sous la forme `Authorization: Bearer …`. |
| Jeton de rafraîchissement | 30 jours | Le cookie `verdin_refresh` (`HttpOnly`, `SameSite=Strict`, chemin `/admin/api/auth`, `Secure` sous `verdin start`). |

Pour obtenir un nouveau jeton d’accès, appelez `POST /admin/api/auth/refresh` avec le cookie
et un en-tête `X-Verdin-CSRF` (n’importe quelle valeur). La réponse est celle d’une connexion
et le jeton de rafraîchissement est renouvelé : stockez le nouveau cookie, car présenter à
nouveau un jeton de rafraîchissement déjà utilisé met fin à toute la session.
`POST /admin/api/auth/logout`, avec le même en-tête, met fin à la session.

```sh title="Terminal"
curl -s -b cookies.txt -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/refresh' \
  -H 'X-Verdin-CSRF: 1'
```

- **Authentification à deux facteurs.** Pour un compte doté d’un second facteur, la connexion
  répond `{ "data": { "twoFactorRequired": true, "twoFactorToken": "…", "methods": ["totp"] } }`.
  Terminez-la avec `POST /admin/api/auth/login/two-factor` et
  `{ "twoFactorToken": "…", "code": "123456" }` (un code TOTP ou de récupération). Voir
  [Authentification à deux facteurs](/fr/guides/auth/two-factor/).
- **Limites de débit.** La connexion et l’inscription sont limitées par IP client via
  `[admin].auth_rate_limit` (20 par minute par défaut) ; les rafraîchissements disposent
  d’un quota plus large.
- **Échecs.** Identifiants incorrects, comptes inconnus et comptes verrouillés répondent tous
  `400 Invalid credentials`. Cinq mots de passe erronés verrouillent le compte pendant
  15 minutes.
- **Premier administrateur.** Sur une instance neuve, `POST /admin/api/auth/register-first-admin`
  crée le Super Admin ; cela ne fonctionne que tant qu’aucun administrateur n’existe.
  `verdin admin create` fait la même chose en ligne de commande.

## Conventions

- Les corps et les réponses sont en JSON. Les réponses enveloppent leur résultat dans `data`
  (`{ "data": … }`) ; les routes de contenu renvoient aussi `meta`, comme l’API REST.
- Les routes de contenu prennent des corps `{ "data": { … } }`, comme l’API REST. Les routes
  de paramètres prennent de simples objets JSON.
- Les erreurs ont la [forme des erreurs REST](/fr/api/rest/#erreurs). Une route d’une
  fonctionnalité désactivée répond `404`. Un administrateur dont le rôle exige
  l’authentification à deux facteurs reçoit `403 TwoFactorRequiredError` tant qu’il ne l’a
  pas configurée.
- Chaque route vérifie les [autorisations](/fr/concepts/permissions/) de l’administrateur :
  les routes de contenu vérifient les actions de contenu sur le type, les routes de
  paramètres leur action de paramètres.
- L’API d’administration ne répond jamais aux requêtes cross-origin : appelez-la depuis un
  serveur ou un script, pas depuis les pages d’un autre site.
- Les modifications réussies sont enregistrées dans le [journal d’audit](/fr/guides/content/audit-logs/).

## Groupes de routes

Les chemins sont relatifs à `/admin/api`. Les routeurs se trouvent dans
[`crates/verdin-api/src/admin.rs`](https://github.com/Verdin-CMS/verdin/blob/main/crates/verdin-api/src/admin.rs)
et dans les modules `*_admin.rs` voisins.

| Groupe | Routes | Autorisation |
| --- | --- | --- |
| Connexion et compte | `GET /auth/status`, `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `GET\|PUT /users/me`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, invitations et réinitialisation du mot de passe sous `/auth/*` | Connecté (les routes de connexion sont publiques) |
| Deux facteurs | `/auth/two-factor/*`, `POST /auth/login/two-factor`, `POST /auth/login/passkey/options`, `DELETE /users/{id}/two-factor` | Connecté ; `users.manage` pour réinitialiser un autre administrateur |
| SSO | `GET /auth/sso`, `GET /auth/sso/{id}`, `GET /auth/sso/{id}/callback` | Public |
| Administrateurs | `GET\|POST /users`, `GET\|PUT\|DELETE /users/{id}`, `POST /users/{id}/invite` | `users.manage` |
| Rôles et accès public | `GET\|POST /roles`, `GET\|PUT\|DELETE /roles/{id}`, `GET\|PUT /public-permissions` | `roles.manage` |
| Jetons d’API | `GET\|POST /api-tokens`, `GET\|PUT\|DELETE /api-tokens/{id}`, `POST /api-tokens/{id}/regenerate` | `tokens.manage` |
| Schéma | `GET /content-types`, `GET /components`, `GET\|PUT\|DELETE /content-types/{uid}/edit-view` ; `GET /schema`, `POST /schema/plan`, `POST /schema/apply` uniquement sous `verdin dev` | Connecté ; `views.manage` pour les vues d’édition ; `schema.manage` pour le constructeur |
| Contenu | `GET\|POST /content/{uid}`, `GET\|PUT\|DELETE /content/{uid}/{documentId}`, `POST /content/{uid}/{documentId}/actions/{publish\|unpublish\|discard-draft}`, `POST …/clone`, `GET …/locales`, `GET …/usage`, `GET /content/{uid}/uid-available`, `GET /content/{uid}/stats` | Actions de contenu sur `{uid}` |
| Import et export | `GET /content/{uid}/export`, `POST /content/{uid}/import` | Actions de contenu sur `{uid}` |
| Historique | `GET /history/{uid}/{documentId}`, `GET /history/versions/{id}`, `POST /history/versions/{id}/restore` | Actions de contenu sur le type |
| Releases | `GET\|POST /releases`, `GET\|PUT\|DELETE /releases/{id}`, `POST /releases/{id}/actions`, `DELETE /releases/{id}/actions/{actionId}`, `POST /releases/{id}/publish` | `releases.manage` |
| Workflows de relecture | `GET\|POST /review-workflows`, `GET\|PUT\|DELETE /review-workflows/{id}`, `GET\|PUT /content/{uid}/{documentId}/review`, `GET /review/*` | `workflows.manage` pour configurer |
| Médias | `POST /upload`, `POST /upload/from-url`, `GET /upload/files`, `GET\|PUT\|DELETE /upload/files/{id}`, `POST /upload/files/{id}/replace`, `GET /upload/files/{id}/usage`, `/upload/folders…` | `media.*` |
| Langues | `GET\|POST /i18n/locales`, `PUT\|DELETE /i18n/locales/{code}` | `locales.manage` pour modifier |
| Webhooks | `GET\|POST /webhooks`, `GET\|PUT\|DELETE /webhooks/{id}`, `POST\|DELETE /webhooks/{id}/secret`, `POST /webhooks/{id}/trigger`, `GET /webhooks/{id}/deliveries`, `POST /webhooks/deliveries/{id}/retry` | `webhooks.manage` |
| Utilisateurs finaux | `GET\|POST /end-users`, `GET\|PUT\|DELETE /end-users/{id}`, `GET\|POST /end-user-roles`, `PUT\|DELETE /end-user-roles/{id}` | `endusers.manage` |
| Fonctionnalités | `GET /features`, `PUT /features/{id}`, `POST /email/test` | `features.manage` pour modifier |
| Plugins | `GET /plugins`, `GET /plugins/extensions`, `PUT /plugins/{name}`, `GET /plugins/{name}/logs` | `plugins.manage` |
| Déploiements et CDN | `/deploy/targets…`, `GET /deploy/deployments`, `GET /deploy/cdn`, `POST /deploy/cdn/purge` | `deploy.manage` ; `deploy.trigger` pour déclencher |
| Site | `/site/redirects…`, `/site/menus…`, `/site/forms…` et les soumissions de formulaires | `site.manage` |
| Collaboration | `/comments…`, `/tasks…`, `/engagement/*`, `/polls…` | Accès en lecture au type de l’entrée |
| Temps réel | `GET /events`, `GET\|POST /presence` | Voir [API temps réel](/fr/api/realtime/#flux-dadministration) |
| IA | `GET /ai`, `POST /ai/translate`, `/ai/alt-text`, `/ai/summarize`, `/ai/seo` | Voir [Actions IA](/fr/guides/integrations/ai-actions/) |
| Journaux d’audit | `GET /audit-logs` | `audit.read` |
| Système | `GET /system/info` (version, base de données et mode) | Connecté |

## Routes de contenu

Les routes de contenu exécutent le même Document Service que l’API REST, avec les règles de
l’administration :

- `{uid}` est l’UID du type de contenu, par exemple `api::article`.
- Les lectures renvoient les **brouillons**, sauf si vous passez `status=published`. Elles
  acceptent les [paramètres de requête](/fr/api/rest/#paramètres-de-requête) REST, plus
  `unseen=true` pour les documents que l’administrateur n’a pas ouverts depuis leur dernière
  modification.
- Les écritures n’enregistrent que le brouillon. La publication est toujours une action
  explicite.
- Les écritures enregistrent l’administrateur comme créateur ou dernier éditeur. Les
  restrictions de champ, de langue et `is-creator` des rôles de l’administrateur
  s’appliquent aux lectures et aux écritures.

```sh title="Terminal"
curl -X PUT 'https://cms.example.com/admin/api/content/api::article/k2m7q4…?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"data":{"title":"Bonjour, Verdin"}}'
curl -X POST 'https://cms.example.com/admin/api/content/api::article/k2m7q4…/actions/publish?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```
