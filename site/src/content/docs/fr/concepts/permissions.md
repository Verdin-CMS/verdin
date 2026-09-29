---
title: "Autorisations"
description: "Vue d’ensemble du contrôle d’accès dans Verdin : rôles d’administration et RBAC avec autorisations par champ et par langue, rôle public, jetons d’API et rôles d’utilisateurs finaux."
sidebar:
  order: 6
---

Verdin contrôle séparément deux publics : les **administrateurs**, qui se connectent au
panneau d’administration, et les **appelants de l’API de contenu**, qui lisent et écrivent du
contenu depuis vos sites et applications. Cette page explique comment chacun est autorisé et
comment les éléments s’articulent. La liste complète des actions figure dans la
[référence des autorisations](/fr/reference/permissions/).

| Qui | S’authentifie avec | Les autorisations viennent de | S’applique à |
| --- | --- | --- | --- |
| Administrateur | E-mail et mot de passe (plus un second facteur ou le SSO) | Ses [rôles](#rôles-dadministration) | Panneau d’administration et [API d’administration](/fr/api/admin/) |
| Appelant anonyme | Aucun en-tête `Authorization` | L’[accès public](#accès-public) | REST, GraphQL, temps réel |
| Serveur ou build | `Authorization: Bearer vd_…` | Le type du [jeton d’API](#jetons-dapi) | REST, GraphQL, temps réel |
| Utilisateur final connecté | `Authorization: Bearer <JWT>` | Son [rôle d’utilisateur final](#utilisateurs-finaux) | REST, GraphQL, temps réel |

Tout est fermé par défaut : l’API de contenu répond `403` tant que vous n’accordez pas
d’accès, et un administrateur ne peut faire que ce que ses rôles autorisent.

## Rôles d’administration

Un administrateur a un ou plusieurs rôles ; leurs autorisations s’additionnent. Trois rôles
sont intégrés :

| Rôle | Peut |
| --- | --- |
| **Super Admin** | Tout, y compris les utilisateurs, les rôles et les jetons d’API. Ne peut pas être modifié. |
| **Editor** | Lire, créer, modifier, supprimer et publier tout le contenu ; utiliser la médiathèque ; déclencher des déploiements ; gérer le SEO, les redirections, les menus et les formulaires. |
| **Author** | Créer du contenu, et lire, modifier et supprimer uniquement les entrées qu’il a créées. Ne peut pas publier. Téléverse des fichiers et ne modifie ou ne supprime que les siens. |

Vous créez d’autres rôles dans **Paramètres → Rôles** (autorisation `roles.manage`). Le dernier
Super Admin actif ne peut être ni désactivé, ni supprimé, ni rétrogradé : l’instance ne peut
donc jamais se retrouver verrouillée. Un rôle peut aussi exiger de ses membres qu’ils
configurent l’[authentification à deux facteurs](/fr/guides/auth/two-factor/) : tant qu’ils ne
l’ont pas fait, ils n’ont accès qu’à leur profil.

### Ce qu’est une autorisation

Une autorisation est une **action**, un **sujet** pour les actions de contenu, et des
**conditions** facultatives :

- **Actions de contenu** : `content.read`, `content.create`, `content.update`,
  `content.delete` et `content.publish`, sur un type de contenu (`api::article`) ou sur tous
  (`*`).
- **Actions de médias** : `media.read`, `media.create`, `media.update` et `media.delete`, pour
  la médiathèque.
- **Actions de paramètres**, comme `users.manage`, `tokens.manage`, `webhooks.manage` ou
  `features.manage`, qui ouvrent les pages correspondantes des **Paramètres**.
- **Conditions** : `is-creator` limite une autorisation de contenu ou de médias à ce que
  l’administrateur a créé. C’est ainsi que fonctionne le rôle Author.

Les conditions font partie de la requête en base de données : une liste filtrée par
`is-creator` compte et pagine correctement, au lieu de masquer des lignes après coup.

### Autorisations par champ et par langue

Les autorisations de contenu peuvent être encore restreintes :

- **Champs.** `content.read`, `content.create` et `content.update` peuvent lister les attributs
  qu’elles couvrent. Les champs hors de la liste sont masqués à la lecture (y compris dans la
  recherche, les filtres, le tri et les entrées liées) et rejetés à l’écriture.
- **Langues.** Sur les [types localisés](/fr/concepts/internationalization/), les autorisations
  de contenu peuvent lister les langues qu’elles couvrent. Les versions dans d’autres langues
  ne peuvent être ni lues ni modifiées.

Les deux se définissent par type de contenu dans l’éditeur du rôle, sous **Champs** et
**Langues**.

## API de contenu

Les appelants de l’API de contenu sont contrôlés par des accès : une **action** sur un
**sujet**.

| Action | Autorise |
| --- | --- |
| `find` | Lister des documents (`GET /api/articles`), ou lire un type unique. |
| `findOne` | Lire un document (`GET /api/articles/{documentId}`). |
| `create` | `POST` |
| `update` | `PUT` |
| `delete` | `DELETE` |
| `publish` | Les routes `actions/publish`, `actions/unpublish` et `actions/discard-draft`. |
| `readDrafts` | Lire avec `status=draft`. |

Les sujets sont les types de contenu, la médiathèque (`plugin::upload`) et les comptes
d’utilisateurs finaux (`plugin::users-permissions.user`) quand les
[utilisateurs finaux](/fr/guides/auth/end-users/) sont activés.

Quelques règles valent pour tous les appelants :

- Lire les brouillons nécessite `readDrafts` en plus de `find` ou `findOne`. Un accès qui lit le
  contenu de votre site ne peut pas lire par accident le travail non publié.
- Peupler, filtrer ou trier à travers une relation nécessite un accès en lecture à son type
  cible.
- Les champs `private` ne sont jamais renvoyés, quels que soient les accès.
- Une écriture renvoie le document écrit même sans `find`, comme dans Strapi.
- Les mêmes accès s’appliquent à [GraphQL](/fr/api/graphql/) et au
  [flux temps réel](/fr/api/realtime/).

### Accès public

Les requêtes sans en-tête `Authorization` reçoivent les accès définis dans
**Paramètres → Accès public**. Rien n’est accordé par défaut. Les choix typiques sont `find` et
`findOne` sur les types que montre votre site.

### Jetons d’API

Les jetons d’API sont destinés aux serveurs, aux étapes de build et aux scripts. Créez-les dans
**Paramètres → Jetons d’API** (autorisation `tokens.manage`) :

| Type | Accès |
| --- | --- |
| **Lecture seule** | `find` et `findOne` sur tous les types. Jamais les brouillons. |
| **Accès complet** | Toutes les actions sur tous les types, brouillons compris. |
| **Personnalisé** | Les accès que vous choisissez, comme pour l’accès public. |

- Un jeton commence par `vd_`. Son secret n’est affiché qu’une fois, à sa création ou à sa
  régénération ; Verdin n’en stocke qu’un hachage à clé.
- Les jetons peuvent expirer. Un jeton inconnu, expiré ou mal formé donne un `401` : il ne se
  rabat jamais sur l’accès public.
- Tout jeton valide peut lire le document OpenAPI sur `/api/_openapi.json`, sauf si vous rendez
  la documentation publique.

Voir [Jetons d’API](/fr/guides/auth/api-tokens/) pour les créer et les renouveler.

### Utilisateurs finaux

Les utilisateurs finaux sont les personnes qui se connectent à votre site ou à votre
application, comme avec le plugin users-permissions de Strapi. La fonctionnalité est
désactivée par défaut. Chaque compte a un rôle :

- **Public** est le rôle des requêtes sans jeton : ses accès sont ceux de
  **Paramètres → Accès public**.
- **Authenticated** est attribué par défaut aux nouveaux comptes.
- Les rôles personnalisés contiennent n’importe quel ensemble d’accès, avec les mêmes actions
  que ci-dessus.

Un utilisateur final envoie le JWT obtenu à la connexion sous la forme
`Authorization: Bearer <jwt>`. Verdin le distingue des jetons d’API grâce au préfixe `vd_`.
Voir [Utilisateurs finaux](/fr/guides/auth/end-users/).

## Comparaison avec Strapi

Le modèle suit Strapi v5 : RBAC d’administration avec conditions `is-creator`, et une API de
contenu avec accès public, jetons d’API et rôles users-permissions. Les différences :

- Chaque fonctionnalité est disponible pour tous les projets : rôles personnalisés,
  autorisations par champ et par langue, [SSO](/fr/guides/auth/sso/) et
  [journaux d’audit](/fr/guides/content/audit-logs/).
- La lecture des brouillons via l’API de contenu est un accès à part entière, `readDrafts`.
- La publication en REST a son propre accès, `publish`, et ses propres routes.
