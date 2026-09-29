---
title: "Composants et zones dynamiques"
description: "Des groupes de champs réutilisables et des listes de blocs mixtes, pourquoi Verdin les stocke en JSON sur le document, et ce que cela implique pour les relations, les médias, le filtrage et le populate."
sidebar:
  order: 2
---

Les composants permettent de réutiliser un groupe de champs dans plusieurs types de contenu,
et les zones dynamiques permettent aux rédacteurs de construire une page à partir d’une liste
de blocs. Cette page explique comment les deux sont modélisés et stockés, et ce que cela
change pour leur lecture, leur écriture et leur filtrage. Le format de schéma lui-même est
décrit dans [Modèle de contenu](/fr/concepts/content-model/).

## Composants

Un composant est un groupe de champs qui a son propre fichier sous
`schema/components/<category>/`. Le `shared.seo` du blog d’exemple contient un titre et une
description meta :

```json title="schema/components/shared/seo.json"
{
  "displayName": "SEO",
  "attributes": {
    "metaTitle": { "type": "string", "maxLength": 60 },
    "metaDescription": { "type": "text", "maxLength": 160 }
  }
}
```

Un type de contenu l’utilise via un attribut `component`. `repeatable: true` en fait une
liste, éventuellement bornée par un nombre d’éléments `min` et `max` :

```json
"seo": { "type": "component", "component": "shared.seo" },
"links": { "type": "component", "component": "shared.link", "repeatable": true, "max": 10 }
```

Les composants peuvent contenir d’autres composants. Un composant ne peut pas se contenir
lui-même, directement ou par l’intermédiaire d’autres ; la vérification du schéma rejette ces
cycles.

## Zones dynamiques

Une zone dynamique est une liste dont les éléments peuvent être n’importe lequel des composants
qu’elle nomme. Le corps des articles du blog mélange des heroes et des citations :

```json
"blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"], "max": 20 }
```

Chaque élément indique dans `__component` de quel composant il s’agit. `min` et `max` bornent
le nombre d’éléments. Les zones dynamiques n’appartiennent qu’aux types de contenu : un
composant ne peut pas en contenir.

## Stockage en JSON

Verdin stocke la valeur d’un composant ou d’une zone dynamique dans une colonne JSON de la
ligne du document (`jsonb` sur PostgreSQL, `json` sur MySQL et MariaDB, texte sur SQLite) :

```json
// the "seo" column
{ "id": 1, "metaTitle": "Rust for CMS authors", "metaDescription": "…" }

// the "blocks" column
[
  { "__component": "blocks.hero", "id": 1, "title": "Hello", "subtitle": "…" },
  { "__component": "blocks.quote", "id": 2, "text": "…", "author": "Ferris" }
]
```

Strapi garde chaque composant dans sa propre table, jointe via des tables de liaison
polymorphes. Stocker plutôt la valeur avec le document signifie que :

- Lire un document avec ses composants ne nécessite aucune jointure, quelle que soit la
  profondeur d’imbrication.
- La publication, l’abandon d’un brouillon et l’[historique du contenu](/fr/guides/content/content-history/)
  copient la valeur telle quelle.
- Ajouter un champ à un composant ne modifie aucune table : la migration est vide.
- Le filtrage sur les champs de composants utilise les fonctions JSON de chaque base de
  données, et certains filtres ne sont pas disponibles (voir [Filtrage](#filtrage)).

Chaque élément porte un `id`, un entier positif unique au sein de la valeur de l’attribut.
Verdin en attribue un aux nouveaux éléments ; renvoyez l’`id` quand vous mettez à jour une
liste pour que les éléments restent stables.

## Relations et médias dans les composants

Un composant peut contenir des relations et des médias, stockés dans le JSON lui-même : des
`documentId` pour les relations et des identifiants de fichiers pour les médias.

- Les relations dans les composants doivent être `oneWay` ou `manyWay` : elles pointent vers
  leurs cibles et n’ont pas de côté inverse. Voir
  [Relations](/fr/concepts/relations/#relations-dans-les-composants).
- Chaque référence est vérifiée à l’écriture : le document ou le fichier cible doit exister, et
  les fichiers doivent correspondre aux `allowedTypes` du champ.
- Quand le composant est peuplé, les références sont résolues par des requêtes groupées, dans
  le même statut et la même langue que le document. Une cible supprimée, ou qui n’a pas de
  version dans celle en cours de lecture, est omise.
- Les relations polymorphes (`morphToOne`, `morphToMany`) et les champs `password` ne peuvent
  pas se trouver dans des composants.

## Lecture

Les composants et les zones dynamiques ne sont renvoyés que si vous les peuplez, comme dans
Strapi :

```http
GET /api/articles?populate[0]=seo&populate[1]=blocks
GET /api/articles?populate=*
```

Un composant peuplé est renvoyé en entier, y compris les composants imbriqués et les relations
et médias résolus. Strapi exige un niveau de `populate` pour chaque composant imbriqué ; Verdin
accepte ces options imbriquées par compatibilité et les ignore. Les éléments d’une zone
dynamique sont renvoyés dans leur ordre de stockage, chacun avec son `__component`.

En GraphQL, un composant est un type objet nommé d’après son UID (`ComponentSharedSeo`) et une
zone dynamique est une union (`ArticleBlocksDynamicZone`) que vous interrogez avec des
fragments. Voir [API GraphQL](/fr/api/graphql/).

## Écriture

Envoyez la valeur complète de l’attribut. Elle remplace ce qui était stocké :

```json
{
  "data": {
    "seo": { "metaTitle": "Rust for CMS authors" },
    "blocks": [
      { "__component": "blocks.hero", "title": "Hello" },
      { "__component": "blocks.quote", "text": "Fast and small.", "author": "Ferris" }
    ]
  }
}
```

La valeur est validée par rapport au schéma du composant à chaque écriture : les clés
inconnues, les types incorrects et un `__component` que la zone dynamique n’autorise pas sont
des erreurs, avec des chemins comme `["blocks", 1, "text"]`. Les champs `required` dans les
composants sont vérifiés à la publication du document, comme ceux de premier niveau.

## Filtrage

| Quoi | Exemple | Remarques |
| --- | --- | --- |
| Champs d’un composant | `filters[seo][metaTitle][$containsi]=rust` | Champs scalaires, composants imbriqués compris. |
| Champs d’un composant répétable | `filters[links][url][$contains]=github` | Correspond dès qu’un élément correspond. |
| Zones dynamiques | `filters[blocks][__component][$eq]=blocks.quote` | Uniquement par `__component` : les éléments de composants différents ont des champs différents. |

Vous ne pouvez pas trier par des champs de composants, et les champs `json` dans les composants
ne peuvent pas être filtrés. Voir [API REST](/fr/api/rest/#filtres) pour les opérateurs.
