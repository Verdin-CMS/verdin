---
title: Compatibilité avec Strapi
description: Les fonctionnalités et API de Strapi v5 que Verdin prend en charge, prend en charge en partie ou ne prend pas en charge — REST, GraphQL, utilisateurs et autorisations, téléversements, i18n, brouillon et publication, extensions de code, panneau d’administration et fonctionnalités Enterprise.
sidebar:
  order: 3
---

Verdin conserve le modèle de contenu et les API de contenu de Strapi v5 pour que les frontends et
le contenu puissent migrer (voir [Migrer depuis Strapi](/fr/migrate/from-strapi/)). Ce n’est pas
un remplaçant direct d’une *base de code* Strapi : il n’y a pas de runtime JavaScript, le code
personnalisé est donc réécrit sous forme de plugins WebAssembly. Cette page liste chaque domaine
avec son statut, à la date de Verdin 0.10.0.

**Pris en charge** fonctionne comme dans Strapi v5 (différences signalées). **Partiel** couvre
les cas courants ; la remarque indique ce qui manque. **Non pris en charge** n’a pas d’équivalent.

## Modèle de contenu

| Fonctionnalité | Statut | Remarques |
| --- | --- | --- |
| Types de collection et types uniques | Pris en charge | Fichiers de schéma JSON proches de ceux de Strapi (`schema/content-types/*.json`). Voir [Modèle de contenu](/fr/concepts/content-model/). |
| Types d’attributs scalaires | Pris en charge | `string`, `text`, `richtext` (Markdown), `blocks`, `email`, `uid`, `integer`, `biginteger`, `float`, `decimal`, `boolean`, `date`, `time`, `datetime`, `enumeration`, `json`, `password`. Le `timestamp` de Strapi est importé en `datetime`. |
| Composants et zones dynamiques | Pris en charge | Y compris les médias et les relations `oneWay`/`manyWay` dans les composants. |
| Relations | Pris en charge | One/many-to-one/many, one-way et many-way, et les relations polymorphes `morphToOne`, `morphToMany`, `morphOne`, `morphMany`. |
| Champs de média | Pris en charge | Simples ou multiples, `allowedTypes`. |
| `unique` | Partiel | Pas sur les attributs `text`, `richtext`, `blocks` et `json`. |
| Champs conditionnels (`conditions`) | Pris en charge | Les conditions JSON Logic de Strapi 5.17 ; les champs masqués ne sont pas obligatoires. |
| Champs personnalisés | Partiel | Les attributs `customField` fonctionnent ; la saisie dans l’administration provient d’un [plugin](/fr/extending/plugins/) Verdin, pas des plugins React de Strapi. |
| Constructeur de types de contenu | Pris en charge | En mode développement (`verdin dev`) uniquement, comme Strapi. |

## API REST

| Fonctionnalité | Statut | Remarques |
| --- | --- | --- |
| Routes CRUD | Pris en charge | `GET`/`POST /api/{pluralName}`, `GET`/`PUT`/`DELETE /api/{pluralName}/{documentId}`, types uniques sur `/api/{singularName}`. Les réponses portent `data` et `meta`, les erreurs l’objet `error` de Strapi. |
| `filters` | Pris en charge | Tous les opérateurs de Strapi : `$eq`, `$eqi`, `$ne`, `$nei`, `$lt`, `$lte`, `$gt`, `$gte`, `$in`, `$notIn`, `$contains`, `$notContains`, `$containsi`, `$notContainsi`, `$null`, `$notNull`, `$between`, `$startsWith(i)`, `$endsWith(i)`, `$and`, `$or`, `$not` ; à travers les relations, les composants, les composants répétables et les zones dynamiques (`__component`). |
| `sort` | Pris en charge | Plusieurs champs, `:asc`/`:desc`, et le champ d’une relation vers un seul document (`author.name:asc`). |
| `pagination` | Pris en charge | `page`/`pageSize` ou `start`/`limit`, `withCount`. `pageSize` est plafonné à `[api].max_page_size` (100). |
| `fields` | Pris en charge | |
| `populate` | Pris en charge | `*`, listes, objets imbriqués, `on` pour les zones dynamiques, `count`. Profondeur jusqu’à 5 ; au plus 1 000 entrées peuplées par relation. |
| `status` | Pris en charge | `published` (par défaut) ou `draft` ; lire les brouillons nécessite l’autorisation `readDrafts`. |
| `locale` | Pris en charge | Voir i18n ci-dessous. |
| `hasPublishedVersion` | Pris en charge | |
| Recherche plein texte `_q` | Pris en charge | `$containsi` sur les champs texte, comme Strapi ; recherche classée avec `[search]`. |
| Écritures de relations | Pris en charge | Identifiants, `connect` / `disconnect` / `set`, avec `position` (`before`, `after`, `start`, `end`). |
| Publier, dépublier, abandonner le brouillon | Pris en charge | Les écritures publient sauf avec `?status=draft`, comme dans Strapi v5. Verdin ajoute `POST /api/{pluralName}/{documentId}/actions/{publish,unpublish,discard-draft}`. |
| Format de réponse de Strapi v4 et `publicationState` | Non pris en charge | Verdin ne parle que la v5 : attributs à plat, `documentId`, `status`. |
| Document OpenAPI | Partiel | Sur `/api/_openapi.json` (réservé aux jetons par défaut) et une référence interactive sur `/api/docs`, au lieu du `/documentation` du plugin de documentation. |

## GraphQL

| Fonctionnalité | Statut | Remarques |
| --- | --- | --- |
| Requêtes | Pris en charge | `articles`, `articles_connection` avec `pageInfo`, `article(documentId)`, types uniques ; `filters`, `sort`, `pagination`, `status`, `locale`. Désactivé tant que vous n’activez pas **Paramètres → Fonctionnalités → GraphQL**. |
| Mutations | Pris en charge | `create…`, `update…`, `delete…` avec `status` et `locale`. |
| Composants, zones dynamiques, médias | Pris en charge | Les zones dynamiques sous forme d’unions, les médias sous forme d’`UploadFile`. |
| Relations polymorphes | Partiel | Renvoyées en JSON, pas sous forme d’unions typées. |
| Shadow CRUD (désactiver des opérations par type) | Pris en charge | Le paramètre `disabled` de la fonctionnalité. |
| Resolvers personnalisés et extensions du schéma | Partiel | Champs racines résolus par des plugins (`[[graphql]]` dans `plugin.toml`) ; pas d’`extensionService`. |
| Mutations Users & Permissions (`login`, `register`, `me`…) | Non pris en charge | Utilisez les routes REST. |
| Requêtes et mutations d’upload et d’i18n (`uploadFiles`, `i18NLocales`…) | Non pris en charge | Utilisez les routes REST (`GET /api/i18n/locales`) et le panneau d’administration. `localizations` sur les types localisés est pris en charge. |
| Limites, GraphiQL | Pris en charge | `maxDepth`, `maxComplexity`, interrupteurs d’introspection et de bac à sable. |

## Users & Permissions (utilisateurs finaux)

Activez **Paramètres → Fonctionnalités → Utilisateurs et permissions**. Voir
[Utilisateurs finaux](/fr/guides/auth/end-users/).

| Fonctionnalité | Statut | Remarques |
| --- | --- | --- |
| `POST /api/auth/local`, `/auth/local/register` | Pris en charge | Mêmes formes de requêtes et de réponses. |
| Confirmation de l’e-mail, mot de passe oublié/réinitialisation/changement | Pris en charge | `/auth/email-confirmation`, `/auth/send-email-confirmation`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/change-password`. |
| Jetons de rafraîchissement | Pris en charge | `jwtManagement: "refresh"`, `/auth/refresh`, `/auth/logout`. |
| `/api/users`, `/users/me`, `/users/count` | Pris en charge | JSON brut, autorisations sur `plugin::users-permissions.user`. |
| Fournisseurs OAuth | Partiel | GitHub, Google, Microsoft, Discord, Facebook, GitLab, LinkedIn et tout fournisseur OAuth 2 ; pas tous les préréglages de Strapi. |
| Routes des rôles et des autorisations (`/api/users-permissions/roles`, `/permissions`) | Non pris en charge | Gérez les rôles dans **Paramètres → Utilisateurs finaux**. |
| Utilisateurs importés | Pris en charge | Les hachages bcrypt continuent de fonctionner ; ils sont recalculés avec Argon2id à la connexion. |

## Médiathèque et API d’upload

| Fonctionnalité | Statut | Remarques |
| --- | --- | --- |
| `POST /api/upload` | Pris en charge | `files` et `fileInfo` en multipart ; `?id=` met à jour les informations d’un fichier, ou remplace le fichier quand un fichier est envoyé. |
| Liaison au téléversement (`ref`, `refId`, `field`) | Non pris en charge | Téléversez, puis renseignez le champ de média avec l’identifiant du fichier. |
| `GET /api/upload/files`, `/files/{id}`, `DELETE /files/{id}` | Partiel | La liste n’accepte que `pagination[page]`, `pagination[pageSize]`, `sort` et `filters[name][$containsi]`. |
| Formats responsives, breakpoints | Pris en charge | `thumbnail` plus `[upload].breakpoints`. |
| Dossiers, points focaux, texte alternatif, légendes | Pris en charge | |
| Fournisseurs de téléversement | Partiel | Disque local et stockage compatible S3 (AWS, R2, B2, MinIO, Tigris…). Pas de Cloudinary ni d’autres paquets de fournisseurs. |
| Transformations d’images | Propre à Verdin | `/uploads/<file>?preset=…` et URL signées (fournisseur local). |

## Internationalisation

| Fonctionnalité | Statut | Remarques |
| --- | --- | --- |
| Types localisés et champs non localisés | Pris en charge | `pluginOptions.i18n.localized`, aussi par attribut. |
| `?locale=` en REST, `locale` en GraphQL | Pris en charge | Une langue inconnue donne un `400`. |
| `localizations` dans les réponses | Pris en charge | Seulement quand il est peuplé (`populate=localizations`, `populate=*`), avec les mêmes options qu’une relation. Aussi un champ GraphQL. L’API d’administration l’omet. |
| `GET /api/i18n/locales` | Pris en charge | Un simple tableau au format de Strapi. Nécessite `find` sur `plugin::i18n.locale` (ligne **Langues** de la grille d’autorisations), comme le `listLocales` de Strapi. `documentId` est dérivé du code de la langue. Les langues se gèrent dans l’administration (**Paramètres → Internationalisation**). |

## Brouillon et publication

| Fonctionnalité | Statut | Remarques |
| --- | --- | --- |
| Versions brouillon et publiée par document | Pris en charge | Par langue. Voir [Brouillon et publication](/fr/concepts/draft-and-publish/). |
| Abandon du brouillon | Pris en charge | |
| Publication planifiée | Pris en charge | Via les [releases](/fr/guides/content/releases/). |

## Personnalisation du serveur

Voir [Porter le code personnalisé](/fr/migrate/porting-custom-code/) pour savoir comment migrer chacun de ces éléments.

| Strapi | Statut | Verdin |
| --- | --- | --- |
| Hooks de cycle de vie, middlewares du Document Service | Partiel | Hooks before/after dans des plugins WebAssembly, qui peuvent modifier ou refuser une écriture. Pas de JavaScript. |
| Contrôleurs, services et routes personnalisés | Partiel | Routes de plugins sous `/api/plugins/<name>/`. |
| Policies et middlewares | Non pris en charge | Les autorisations et les limites de débit sont intégrées. |
| `register` / `bootstrap` | Partiel | La fonction de démarrage d’un plugin, exécutée quand le plugin démarre, est activé ou que ses paramètres changent ; elle peut amorcer du contenu et remplacer les autorisations du rôle public. |
| Tâches cron | Partiel | Tâches de plugins. |
| Document Service / Entity Service en JavaScript | Non pris en charge | Pas de runtime JavaScript. |
| Plugins npm de la marketplace Strapi | Non pris en charge | |
| Webhooks | Pris en charge | Signés, retentés et journalisés ; `entry.draft-discard` devient `entry.discard-draft`. Voir [Webhooks](/fr/guides/integrations/webhooks/). |
| Jetons d’API (lecture seule, accès complet, personnalisés) | Pris en charge | Mêmes genres, expiration facultative, régénération. |
| Jetons de transfert, `strapi transfer` | Non pris en charge | Utilisez `verdin export` et `verdin import verdin`. |
| Fichiers de `strapi export` | Pris en charge (import) | `verdin import strapi` ; les exports chiffrés ne sont pas lus. |
| `config/*.js`, `.env` | Partiel | `verdin.toml` et variables d’environnement. |
| Types TypeScript | Pris en charge | `verdin types`. |
| Fournisseurs d’e-mail | Partiel | SMTP, Resend et Postmark. |

## Panneau d’administration

| Fonctionnalité | Statut | Remarques |
| --- | --- | --- |
| Content manager, médiathèque, constructeur de types de contenu | Pris en charge | Un panneau Angular propre, pas l’administration React de Strapi. |
| Administrateurs, rôles, rôles personnalisés | Pris en charge | Super Admin, Editor et Author intégrés, plus des rôles personnalisés. |
| Autorisations au niveau des champs et des langues | Pris en charge | |
| Conditions RBAC | Partiel | Uniquement la condition intégrée `is-creator` ; pas de conditions personnalisées. |
| Personnalisation de l’administration (`src/admin/app`) | Partiel | Logo, favicon, titre, couleur d’accent et textes dans `[admin.branding]` ; widgets et champs personnalisés via des plugins. Pas de pages personnalisées, de zones d’injection ni d’extensions React. |
| API d’administration (`/admin/…`) | Non pris en charge | L’API d’administration de Verdin lui est propre ; ne construisez rien sur celle de Strapi. |
| Configuration des vues d’édition et de liste | Pris en charge | |

## Fonctionnalités Enterprise

Tout dans Verdin est open source ; ce sont des fonctionnalités Enterprise ou payantes dans Strapi.

| Fonctionnalité de Strapi | Statut | Remarques |
| --- | --- | --- |
| SSO | Partiel | Fournisseurs OpenID Connect, avec correspondance entre groupes et rôles. Pas de SAML ni d’autres stratégies passport. Voir [Authentification unique](/fr/guides/auth/sso/). |
| Journaux d’audit | Pris en charge | Voir [Journaux d’audit](/fr/guides/content/audit-logs/). |
| Workflows de relecture | Pris en charge | Les rôles par étape limitent qui déplace des entrées *vers* une étape, et une étape de publication requise s’applique à toutes les API. Voir [Workflows de relecture](/fr/guides/content/review-workflows/). |
| Releases | Pris en charge | Planifiées ou immédiates. |
| Historique du contenu | Pris en charge | `[history].max_versions` versions par document. |
| Aperçu et aperçu en direct | Pris en charge | URL d’aperçu avec des jetons de courte durée, aperçu côte à côte et [édition visuelle](/fr/guides/frontend/visual-editing/). |
| Rôles d’administration personnalisés | Pris en charge | Sans limite de nombre. |
