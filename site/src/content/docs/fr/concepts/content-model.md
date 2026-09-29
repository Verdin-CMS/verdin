---
title: "Modèle de contenu"
description: "Comment Verdin décrit votre contenu : types de collection et types uniques, attributs, fichiers de schéma au format de Strapi et règles de validation."
sidebar:
  order: 1
---

Le modèle de contenu est l’ensemble des types de contenu et des composants que définit votre
projet. Verdin en dérive tout le reste : les tables de la base de données, les API REST et
GraphQL, le document OpenAPI, la validation et les formulaires du panneau d’administration.
Cette page présente ces éléments et les règles qui s’y appliquent.

## Types de contenu

Un type de contenu décrit un genre de document, comme un article ou une page d’accueil. Il a
un `kind` :

| Kind | Contient | Routes REST (blog d’exemple) |
| --- | --- | --- |
| `collectionType` | Un nombre quelconque de documents | `/api/articles`, `/api/articles/{documentId}` |
| `singleType` | Au plus un document | `/api/homepage` |

Les types de collection sont servis sous leur `pluralName`, les types uniques sous leur
`singularName`. Le premier `PUT` sur un type unique crée son document. Voir l’[API REST](/fr/api/rest/)
pour toutes les routes.

Chaque type de contenu a un UID, `api::<singularName>` (`api::article`). Strapi écrit le même
UID sous la forme `api::article.article` ; Verdin accepte cette forme dans les fichiers de
schéma et dans l’importateur, et la normalise en `api::article`.

Chaque document possède des champs système que vous ne déclarez pas : `id`, `documentId` (un
ULID de 26 caractères en minuscules, stable entre brouillons, versions publiées et langues),
`createdAt`, `updatedAt`, `publishedAt`, et `locale` sur les
[types localisés](/fr/concepts/internationalization/).

## Fichiers de schéma

Les types de contenu et les composants sont des fichiers JSON dans le répertoire `schema/` de
votre projet (`[schema].path` dans `verdin.toml`). Vous les versionnez dans git comme du code.

```
schema/
├── content-types/
│   ├── article.json
│   ├── category.json
│   ├── tag.json
│   └── homepage.json
└── components/
    ├── blocks/
    │   ├── hero.json
    │   └── quote.json
    └── shared/
        └── seo.json
```

Le format est le `schema.json` de Strapi, si bien que la plupart des schémas Strapi se chargent
sans modification. Voici le type article du
[blog d’exemple](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog) :

```json title="schema/content-types/article.json"
{
  "kind": "collectionType",
  "singularName": "article",
  "pluralName": "articles",
  "displayName": "Article",
  "options": { "draftAndPublish": true },
  "attributes": {
    "title": { "type": "string", "required": true, "maxLength": 200 },
    "slug": { "type": "uid", "targetField": "title", "required": true },
    "excerpt": { "type": "text", "maxLength": 500 },
    "body": { "type": "richtext" },
    "readingTime": { "type": "integer", "min": 0 },
    "featured": { "type": "boolean", "default": false },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "tags": { "type": "relation", "relation": "manyToMany", "target": "tag" },
    "seo": { "type": "component", "component": "shared.seo" },
    "blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"] }
  }
}
```

| Clé | Obligatoire | Description |
| --- | --- | --- |
| `kind` | oui | `collectionType` ou `singleType`. |
| `singularName` | oui | En kebab-case. Doit correspondre au nom du fichier (`article.json`). |
| `pluralName` | oui | En kebab-case, différent de `singularName`. |
| `displayName` | oui | Le nom affiché par le panneau d’administration. |
| `description` | non | Affichée dans le panneau d’administration. |
| `collectionName` | non | Nom de la table. Par défaut, le `pluralName` en snake_case. |
| `options.draftAndPublish` | non | Conserve un brouillon et une version publiée de chaque document. `false` par défaut. Voir [Brouillon et publication](/fr/concepts/draft-and-publish/). |
| `pluginOptions.i18n.localized` | non | Une version par langue. `false` par défaut. Voir [Internationalisation](/fr/concepts/internationalization/). |
| `attributes` | non | Les champs, dans l’ordre où l’API les renvoie. |
| `validations` | non | Règles portant sur plusieurs champs ; voir [plus bas](#validations-inter-champs). |

Les schémas sont stricts : une clé inconnue, une option qu’un type ne prend pas en charge ou une
référence à un type ou un composant manquant est une erreur qui nomme le fichier et le chemin,
et le serveur ne démarre pas. Lancez `verdin schema check` pour valider les fichiers sans le
démarrer.

Certains noms sont réservés :

- Les noms d’attributs commencent par une lettre, suivie de lettres, chiffres et tirets bas,
  50 caractères au maximum. Ils deviennent des colonnes en snake_case (`metaTitle` →
  `meta_title`).
- `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`,
  `updatedAt`, `createdBy` et `updatedBy` sont réservés sur les types de contenu, et `id` dans
  les composants.
- `upload`, `uploads`, `auth`, `users` et `connect` ne peuvent pas servir de `singularName` ni
  de `pluralName` : ces routes appartiennent à l’API.
- Un type de contenu a au plus 60 attributs `string`, `email`, `uid` et `enumeration`, ce qui
  maintient les lignes sous la limite de taille de ligne de MySQL. Utilisez `text` pour
  certains d’entre eux.

Vous modifiez les fichiers dans le **Constructeur de types de contenu** de l’administration,
disponible quand le serveur tourne avec `verdin dev`, ou à la main. Dans les deux cas, une
modification devient une [migration de schéma](/fr/concepts/schema-migrations/). La mise en
page de l’éditeur (ordre des champs, largeurs, libellés) ne fait pas partie du schéma : les
administrateurs la configurent dans le panneau, et elle est stockée dans la base de données.

## Composants

Un composant est un groupe de champs réutilisable, comme `shared.seo` (un titre meta et une
description meta). Son UID est `<category>.<name>`, tiré de son chemin :
`schema/components/shared/seo.json` correspond à `shared.seo`. Un fichier de composant contient
`displayName`, éventuellement `description` et `icon`, et `attributes`.

Une zone dynamique est une liste qui mélange plusieurs composants, comme le corps d’un article
composé de blocs hero et de citations. Les deux sont stockés dans le document en JSON ; voir
[Composants et zones dynamiques](/fr/concepts/components-and-dynamic-zones/).

## Attributs

Chaque attribut a un `type` et des options qui en dépendent. La liste complète des types, de
leurs options et de leurs types de colonnes par base de données se trouve dans la
[référence des types d’attributs](/fr/reference/attribute-types/).

| Catégorie | Types |
| --- | --- |
| Texte | `string`, `text`, `richtext` (Markdown), `blocks` (le texte enrichi structuré de Strapi), `email`, `uid`, `password`, `enumeration` |
| Nombres | `integer`, `biginteger`, `float`, `decimal` |
| Dates | `date`, `time`, `datetime` |
| Autres scalaires | `boolean`, `json` |
| Liens | `relation` (voir [Relations](/fr/concepts/relations/)), `media` (voir [Médias](/fr/concepts/media/)) |
| Structure | `component`, `dynamiczone` |

Options courantes :

| Option | Effet |
| --- | --- |
| `required` | La valeur doit être renseignée quand une version est publiée (ou à chaque écriture, pour les types sans brouillon et publication). Les brouillons peuvent être incomplets. |
| `private` | Jamais renvoyé, filtré, trié ni peuplé par l’API de contenu. Les attributs `password` sont toujours privés. |
| `default` | Valeur utilisée quand un nouveau document omet le champ. Vérifiée selon les propres règles de l’attribut. |
| `unique` | Deux documents ne peuvent pas partager la valeur, par langue et par version. Disponible sur les types `string`, `email`, nombres, dates et heures ; `uid` est toujours unique. |
| `configurable` | `false` verrouille l’attribut dans le constructeur de types de contenu : il ne peut pas y être modifié, renommé ni supprimé. |
| `pluginOptions.i18n.localized` | `false` partage la valeur entre les langues. |

Chaque colonne d’attribut accepte `NULL` dans la base de données. Comme dans Strapi v5,
`required` est appliqué par Verdin à la publication, et non par une contrainte `NOT NULL`, si
bien qu’ajouter un attribut obligatoire à un type qui a déjà des lignes est une modification
sans risque.

## Validation

Chaque écriture est vérifiée par rapport au schéma avant que quoi que ce soit n’atteigne la
base de données :

- **Types et contraintes**, à chaque écriture : types des valeurs, `minLength`/`maxLength`,
  `min`/`max`, `regex`, valeurs d’`enum`, nombre d’éléments dans les composants répétables et
  les zones dynamiques, types de composants qu’une zone dynamique autorise et types de
  fichiers qu’un champ de média accepte. Les clés inconnues et les champs système dans l’entrée
  sont des erreurs.
- **Champs obligatoires et règles inter-champs**, quand une version est publiée, et à chaque
  écriture sur les types sans brouillon et publication. Elles s’appliquent aussi dans les
  composants et les zones dynamiques.
- **Unicité**, par des index uniques dans la base de données, si bien que deux écritures
  concurrentes ne peuvent pas réussir toutes les deux.

Une vérification en échec répond `400` avec une `ValidationError` dont le `details.errors`
liste chaque problème avec son chemin, comme `["seo", "metaTitle"]` ou `["blocks", 2, "text"]`.
Voir [Erreurs](/fr/api/rest/#erreurs).

### Validations inter-champs

Un type de contenu peut déclarer des règles qui comparent ses propres champs, écrites en
[JSON Logic](https://jsonlogic.com). Ce type événement exige que la date de fin suive la date
de début, et plafonne les billets vendus au nombre de places :

```json title="schema/content-types/event.json"
{
  "kind": "collectionType",
  "singularName": "event",
  "pluralName": "events",
  "displayName": "Event",
  "attributes": {
    "startDate": { "type": "date", "required": true },
    "endDate": { "type": "date" },
    "seats": { "type": "integer", "min": 0 },
    "sold": { "type": "integer", "min": 0 }
  },
  "validations": [
    {
      "rule": { "or": [{ "!": { "var": "endDate" } }, { "<=": [{ "var": "startDate" }, { "var": "endDate" }] }] },
      "message": "must be after the start date",
      "field": "endDate"
    },
    { "rule": { "<=": [{ "var": "sold" }, { "var": "seats" }] }, "message": "more tickets sold than seats" }
  ]
}
```

- Une règle non respectée est une erreur de validation avec `message`, sur `field` s’il est
  indiqué, ou sur le document (`path: []`).
- Les règles s’exécutent en même temps que `required` : à la publication, et à chaque écriture
  sur les types sans brouillon et publication. Les brouillons peuvent les enfreindre.
- `var` lit les propres champs du document, avec des chemins pointés vers les composants. Les
  relations et les médias ne sont pas accessibles aux règles.
- Les comparaisons sont numériques quand les deux côtés sont des nombres et textuelles quand
  ce sont des chaînes, si bien que les dates, heures et date-heures ISO se comparent
  correctement. Un champ vide vaut `null` : protégez les champs facultatifs, comme le fait la
  première règle.
- Opérateurs autorisés : `var`, `==`, `!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`,
  `and`, `or`, `in`, `if`, `?:`, `+`, `-`, `*`, `/`, `%`, `min`, `max`, `cat`. Un opérateur
  inconnu, un `field` inconnu ou un `message` vide est une erreur de schéma.

Le serveur vérifie les règles ; le panneau d’administration affiche leurs messages sur les
champs qu’elles nomment quand une publication échoue. Strapi n’a pas d’équivalent. Les champs
conditionnels de Strapi (`conditions`) sont acceptés dans les fichiers de schéma et conservés,
mais pas encore appliqués.
