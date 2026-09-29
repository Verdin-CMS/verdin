---
title: "API GraphQL"
description: "Activer l’endpoint GraphQL de Verdin, le schéma qu’il génère à partir de vos types de contenu, les requêtes, mutations, connexions, erreurs et limites."
sidebar:
  order: 2
  label: "GraphQL"
---

Verdin peut servir une API GraphQL générée à partir de vos types de contenu, sur le modèle du
plugin GraphQL de Strapi v5. Elle partage les autorisations, les filtres, la pagination et la
validation de l’API REST : les arguments GraphQL sont traduits dans la même requête qu’une
requête REST. Cette page sert de référence ; les exemples utilisent le
[blog d’exemple](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog).

## Activation

GraphQL est désactivé par défaut. Activez-le dans **Paramètres → Fonctionnalités → GraphQL**
(autorisation `features.manage`). La modification s’applique immédiatement, sans redémarrage,
et l’endpoint est :

```
POST /graphql
```

Il est servi à la racine du serveur, pas sous le préfixe REST. Envoyez
`{ "query", "variables", "operationName" }` en JSON. `GET /graphql?query=…` exécute aussi les
requêtes (les mutations exigent `POST`).

```sh title="Terminal"
curl -X POST 'https://cms.example.com/graphql' \
  -H "Authorization: Bearer $VERDIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ articles(sort: [\"publishedAt:desc\"]) { documentId title } }"}'
```

Les appelants s’authentifient comme sur l’API REST : aucun en-tête pour l’accès public, un
jeton d’API ou le JWT d’un utilisateur final. Un en-tête `Authorization` mal formé ou un jeton
inconnu répond `401`. Voir [Autorisations](/fr/concepts/permissions/). Les navigateurs d’autres
origines ont besoin de `[api].cors_origins`.

### Paramètres

| Paramètre | Valeur par défaut | Emplacement | Effet |
| --- | --- | --- | --- |
| **Bac à sable GraphiQL** | activé sous `verdin dev`, désactivé sous `verdin start` | Paramètres de la fonctionnalité | Sert GraphiQL quand un navigateur ouvre `GET /graphql`. Il est chargé depuis unpkg.com. |
| **Introspection** | activé | Paramètres de la fonctionnalité | Permet aux clients et aux outils de lire le schéma. Désactivez-la pour cacher le schéma au public. |
| **Opérations désactivées** | aucune | Paramètres de la fonctionnalité | Par type de contenu, retire `find`, `findOne`, `create`, `update` ou `delete` (ou toutes les requêtes, toutes les mutations, tout) du schéma, comme les options de shadow CRUD de Strapi. REST n’est pas concerné. |
| `maxDepth` | `10` | API d’administration | Profondeur de sélection maximale autorisée. |
| `maxComplexity` | `1000` | API d’administration | Complexité de requête maximale autorisée (en gros, le nombre de champs sélectionnés). |

`maxDepth` et `maxComplexity` n’ont pas encore de champ dans le panneau. Définissez-les via
l’[API d’administration](/fr/api/admin/) : `GET /admin/api/features` renvoie les paramètres
actuels et `PUT /admin/api/features/graphql` les remplace, donc envoyez aussi ceux que vous
voulez conserver :

```json
{ "enabled": true, "settings": { "playground": false, "introspection": true, "maxDepth": 8, "maxComplexity": 500 } }
```

## Schéma

Pour chaque type de contenu, le schéma contient un type objet nommé d’après son
`singularName` en PascalCase (`article` → `Article`, `blog-post` → `BlogPost`), avec :

- `documentId: ID!`
- chaque attribut qui n’est pas `private`
- `createdAt`, `updatedAt` et `publishedAt`, en `DateTime`
- `locale: String`, sur les types localisés

| Attribut | Type GraphQL |
| --- | --- |
| `string`, `text`, `richtext`, `email`, `uid`, `enumeration` | `String` |
| `integer` | `Int` |
| `biginteger` | `Long` (une chaîne, comme en REST) |
| `float`, `decimal` | `Float` |
| `boolean` | `Boolean` |
| `date`, `time`, `datetime` | `Date`, `Time`, `DateTime` |
| `json`, `blocks` | `JSON` |
| relation vers un seul document | le type de la cible, par exemple `Category` |
| relation vers plusieurs documents | `[Tag!]!`, avec les arguments `filters`, `pagination` et `sort` |
| `media` | `UploadFile`, ou `[UploadFile!]!` quand `multiple` |
| `component` | `ComponentSharedSeo` (à partir de l’UID `shared.seo`), ou une liste s’il est répétable |
| `dynamiczone` | `[ArticleBlocksDynamicZone!]!`, une union de ses composants |
| relation polymorphe | `JSON` (des documents avec leur `__type`) |

Le `Query` racine contient aussi `verdin: String!`, la version du serveur.

## Requêtes

| Type de collection `article` | Renvoie |
| --- | --- |
| `articles(filters, pagination, sort, status, locale)` | `[Article!]!` |
| `articles_connection(filters, pagination, sort, status, locale)` | `ArticleEntityResponseCollection` avec `nodes` et `pageInfo` |
| `article(documentId: ID!, status, locale)` | `Article` ou `null` |

| Type unique `homepage` | Renvoie |
| --- | --- |
| `homepage(status, locale)` | `Homepage` ou `null` |

Les noms de requêtes et de champs proviennent de `pluralName` et `singularName` en camelCase
(`blog-posts` → `blogPosts`).

```graphql
query LatestArticles($page: Int) {
  articles_connection(
    filters: { category: { name: { eq: "News" } }, title: { containsi: "rust" } }
    sort: ["publishedAt:desc"]
    pagination: { page: $page, pageSize: 10 }
  ) {
    nodes {
      documentId
      title
      slug
      category { name }
      tags(sort: ["label:asc"]) { label }
      seo { metaTitle metaDescription }
      blocks {
        __typename
        ... on ComponentBlocksHero { title subtitle }
        ... on ComponentBlocksQuote { text author }
      }
    }
    pageInfo { page pageSize pageCount total }
  }
}
```

La même requête en REST :

```http
GET /api/articles?filters[category][name][$eq]=News&filters[title][$containsi]=rust
  &sort=publishedAt:desc&pagination[page]=1&pagination[pageSize]=10
  &populate[category][fields][0]=name&populate[tags][sort]=label:asc&populate[0]=seo&populate[1]=blocks
```

### Arguments

- **`filters`** : un `ArticleFiltersInput` avec un champ par attribut, plus `documentId`, les
  horodatages, et `and`, `or` et `not`. Les champs scalaires prennent des entrées
  d’opérateurs comme `StringFilterInput`, dont les opérateurs sont les
  [opérateurs REST](/fr/api/rest/#filtres) sans le `$` : `eq`, `ne`, `containsi`, `in`,
  `between`, `null`… Les relations prennent l’entrée de filtres de la cible, et les composants
  non répétables celle de leur composant.
- **`pagination`** : `{ page, pageSize }` ou `{ start, limit }`, avec les valeurs par défaut et
  le maximum de REST.
- **`sort`** : une liste de chaînes `"field"` ou `"field:asc|desc"`, comme en REST.
- **`status`** : `PUBLISHED` (par défaut) ou `DRAFT`, qui nécessite l’accès `readDrafts`. Les
  documents liés suivent toujours le statut de leur parent.
- **`locale`** : un code de langue pour les types localisés ; sinon, la langue par défaut.

Seul ce que vous sélectionnez est chargé : la sélection devient le `populate` REST, et chaque
niveau de relations correspond à une requête groupée. Le `pageInfo` de `articles_connection`
compte toutes les correspondances (`total`) et les pages (`pageCount`).

## Mutations

| Type de collection `article` | Renvoie |
| --- | --- |
| `createArticle(data: ArticleInput!, status, locale)` | `Article` |
| `updateArticle(documentId: ID!, data: ArticleInput!, status, locale)` | `Article` |
| `deleteArticle(documentId: ID!, locale)` | `DeleteMutationResponse` (`{ documentId }`) |

| Type unique `homepage` | Renvoie |
| --- | --- |
| `updateHomepage(data: HomepageInput!, status, locale)` | `Homepage` ; la première mise à jour crée le document |
| `deleteHomepage(locale)` | `DeleteMutationResponse` |

```graphql
mutation {
  createArticle(
    data: { title: "Hello, Verdin", slug: "hello-verdin", category: "k2m7q4…", tags: ["a7c1…"] }
    status: DRAFT
  ) {
    documentId
    publishedAt
  }
}
```

- Comme en REST, `create` et `update` publient, sauf avec `status: DRAFT`. Il n’y a pas de
  mutations de publication distinctes : utilisez les [actions](/fr/api/rest/#actions) REST pour
  dépublier ou abandonner un brouillon.
- Les entrées reflètent les attributs : les relations prennent `ID` ou `[ID!]` (des
  `documentId`), les médias des identifiants de fichiers, les composants leur type `…Input`, et
  les éléments de zone dynamique sont des objets `JSON` avec un `__component`. Les relations
  inverses (`mappedBy`) ne figurent pas dans les entrées.
- Les mutations `delete` suppriment la version dans `locale` (la langue par défaut si elle est
  absente), comme `DELETE /api/articles/{documentId}?locale=fr`.
- La même validation s’exécute qu’en REST.

## Erreurs

Les erreurs GraphQL arrivent dans la liste `errors` d’une réponse `200`, avec un code dans
`extensions.code` :

```json
{
  "data": { "createArticle": null },
  "errors": [
    {
      "message": "title is a required field",
      "path": ["createArticle"],
      "extensions": {
        "code": "BAD_USER_INPUT",
        "details": [{ "path": ["title"], "message": "title is a required field", "name": "ValidationError" }]
      }
    }
  ]
}
```

| Code | Quand |
| --- | --- |
| `FORBIDDEN` | L’appelant n’a pas l’accès pour l’opération, ou `readDrafts` pour `status: DRAFT`. |
| `BAD_USER_INPUT` | Arguments ou contenu invalides ; `details` liste les problèmes de validation avec leurs chemins. |
| `NOT_FOUND` | Le document n’existe pas (lors des mises à jour et des suppressions). |
| `INTERNAL_SERVER_ERROR` | Une erreur inattendue, journalisée sur le serveur. |

Les requêtes plus profondes que `maxDepth` ou plus complexes que `maxComplexity` sont
rejetées avant leur exécution.

## Limites

GraphQL a ses propres limites (`maxDepth`, `maxComplexity`) en plus de celles de l’API REST :
au plus `[api].max_page_size` documents par liste, des relations imbriquées sur 5 niveaux au
maximum, au plus 1 000 documents liés par document et par relation, et au plus 100 conditions
de filtre. Voir [Limites REST](/fr/api/rest/#limites).

## Plugins

Les [plugins](/fr/extending/plugins/) peuvent ajouter des requêtes et des mutations racines
de la forme `name(args: JSON): JSON`. Les noms déjà utilisés par des types de contenu sont
ignorés.

## Comparaison avec Strapi

Les noms de types, de requêtes et de mutations, les requêtes `_connection` avec `nodes` et
`pageInfo`, les arguments `documentId`, `status` et `locale` suivent le plugin GraphQL de
Strapi v5, et les types localisés ont un champ `locale`. Les types n’exposent pas `id`, et il
n’y a pas de subscriptions GraphQL ; pour les mises à jour en direct, utilisez
l’[API temps réel](/fr/api/realtime/).
