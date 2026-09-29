---
title: "Relations"
description: "Types de relations, comment Verdin lie les documents par documentId, l’ordre, les relations polymorphes, et ce que signifient oneWay et manyWay dans les composants."
sidebar:
  order: 3
---

Une relation lie des documents de deux types de contenu, comme un article et sa catégorie.
Cette page explique les types de relations, la façon dont les liens sont stockés et résolus,
et les règles d’écriture, d’ordre et de lecture. Pour la syntaxe des requêtes, voir
l’[API REST](/fr/api/rest/#écriture).

## Types de relations

Une relation est un attribut de `type: "relation"` avec un type `relation` et un type de
contenu `target` :

| Type | Un document est lié à | Une cible est liée depuis | Côté inverse |
| --- | --- | --- | --- |
| `oneWay` | une cible | un nombre quelconque de documents | aucun |
| `manyWay` | plusieurs cibles | un nombre quelconque de documents | aucun |
| `manyToOne` | une cible | un nombre quelconque de documents | `oneToMany` |
| `oneToMany` | plusieurs cibles | un seul document | `manyToOne` |
| `oneToOne` | une cible | un seul document | `oneToOne` |
| `manyToMany` | plusieurs cibles | un nombre quelconque de documents | `manyToMany` |

Le blog d’exemple lie les articles à une catégorie (avec un côté inverse) et à des tags (sans
côté inverse) :

```json title="schema/content-types/article.json (excerpt)"
"category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
"tags": { "type": "relation", "relation": "manyToMany", "target": "tag" }
```

```json title="schema/content-types/category.json (excerpt)"
"articles": { "type": "relation", "relation": "oneToMany", "target": "article", "mappedBy": "category" }
```

- Le côté avec `inversedBy` (ou sans aucune des deux clés) est le côté **propriétaire** : il
  stocke les liens, et c’est lui que vous écrivez.
- Le côté avec `mappedBy` est le côté **inverse** : il lit les liens du propriétaire en sens
  inverse et est en lecture seule. L’écrire est une erreur de validation qui nomme l’attribut
  propriétaire.
- Les deux côtés doivent concorder : `mappedBy` nomme un attribut de la cible qui pointe en
  retour avec `inversedBy`, avec le type inverse correspondant du tableau.
- `oneWay` et `manyWay` n’ont jamais de côté inverse.

Le constructeur de types de contenu crée pour vous l’attribut inverse sur la cible.

## Liées par document, pas par ligne

Un document a plusieurs lignes : un brouillon et une version publiée, et une de chaque par
langue. Verdin stocke une relation comme un lien de la **ligne** source vers le **document**
cible (son `documentId`), dans une table de liaison nommée `{table}_{field}_lnk`. La ligne
cible est choisie à la lecture de la relation :

- Un article publié voit la version publiée de sa catégorie ; son brouillon voit le brouillon
  de la catégorie. Les types sans brouillon et publication ont une seule version, que voient
  tous les lecteurs.
- Quand la cible est elle aussi localisée, les lectures la résolvent dans la même langue. Un
  type cible non localisé est partagé par toutes les langues.
- Dépublier une catégorie la masque des articles publiés sans toucher à aucun lien ; la publier
  à nouveau la fait réapparaître.
- Publier un article ne copie que ses propres liens vers la version publiée.

Strapi lie plutôt des identifiants de lignes : il doit donc réécrire les liens chaque fois
qu’un brouillon est publié. Verdin ne le fait jamais, ce qui réduit la publication à une simple
copie de la ligne du brouillon.

L’intégrité est assurée par Verdin plutôt que par des clés étrangères : lier un document qui
n’existe pas est une erreur de validation, et supprimer un document retire les liens qui
pointent vers lui dans la même transaction.

### Un seul document par cible

Pour `oneToOne` et `oneToMany`, une cible appartient à au plus un document source. Lier une
cible déjà détenue par un autre document la **déplace** : le lien de l’autre document est
supprimé dans la même écriture. C’est le comportement de Strapi. Il s’applique par version :
un brouillon et sa version publiée peuvent détenir la même cible.

## Écriture

Du côté propriétaire, `data` prend un `documentId`, une liste de `documentId`, ou un objet qui
décrit une modification :

| Entrée | Effet |
| --- | --- |
| `"k2m…"` ou `{ "documentId": "k2m…" }` | Lie une cible (relations vers un seul document). |
| `["k2m…", "p9x…"]` | Remplace tous les liens, dans cet ordre. |
| `null` ou `[]` | Supprime tous les liens. |
| `{ "set": ["k2m…"] }` | Remplace tous les liens. |
| `{ "connect": [...], "disconnect": [...] }` | Ajoute et supprime des liens, en conservant les autres. |

Connecter une nouvelle cible à une relation vers un seul document remplace la précédente. `set`
ne peut pas être combiné avec `connect` ou `disconnect`.

Dans le panneau d’administration, un champ de relation liste les entrées liées. **Lier une
entrée** (ou **Lier des entrées** pour les relations vers plusieurs documents) ouvre une boîte
de dialogue qui recherche parmi les entrées du type cible, dans leurs champs texte, et dans la
langue de l’entrée quand la cible est localisée. Choisissez une entrée, ou cochez-en plusieurs
et ajoutez-les ; les entrées déjà liées sont signalées.

## Ordre

Les relations vers plusieurs documents conservent l’ordre de leurs liens. Une liste ou un
`set` stocke l’ordre que vous envoyez. Les éléments de `connect` peuvent indiquer leur
position :

```json
{
  "data": {
    "tags": {
      "connect": [
        { "documentId": "k2m…", "position": { "before": "p9x…" } },
        { "documentId": "a7c…", "position": { "end": true } }
      ]
    }
  }
}
```

`position` vaut `{ "before": documentId }`, `{ "after": documentId }`, `{ "start": true }` ou
`{ "end": true }`. Les positions sont renumérotées à chaque écriture. Les lectures renvoient les
documents liés dans l’ordre des liens, sauf si le populate demande un `sort`.

## Lecture

Les relations ne sont renvoyées que si vous les peuplez :

```http
GET /api/articles?populate[category][fields][0]=name&populate[tags][sort]=label:asc
```

Une relation vers un seul document est un objet ou `null` ; une relation vers plusieurs
documents est un tableau. Chaque relation peuplée peut prendre ses propres `fields`, `filters`,
`sort`, `populate` et `count`, jusqu’à cinq niveaux de profondeur. Chaque niveau correspond à
une requête groupée par relation (`WHERE … IN (…)`), et non à une jointure : les populates
profonds ne multiplient donc pas les lignes. Au plus 1 000 documents liés sont renvoyés par
document et par relation ; `count` donne le nombre exact.

Vous pouvez filtrer à travers les relations (`filters[category][name][$eq]=News`), d’un côté
comme de l’autre, et trier selon un champ d’une relation vers un seul document
(`sort=category.name:asc`). Peupler, filtrer ou trier à travers une relation vers un type que
l’appelant ne peut pas lire est refusé (`populate=*` l’ignore) : les relations ne révèlent donc
jamais un contenu que les [autorisations](/fr/concepts/permissions/) de l’appelant masquent.

## Relations dans les composants

Un [composant](/fr/concepts/components-and-dynamic-zones/) peut contenir des relations, mais
uniquement `oneWay` et `manyWay` :

```json title="schema/components/shared/related.json"
{
  "displayName": "Related",
  "attributes": {
    "label": { "type": "string" },
    "articles": { "type": "relation", "relation": "manyWay", "target": "article" }
  }
}
```

Le JSON du composant stocke les `documentId` eux-mêmes : une chaîne pour `oneWay`, un tableau
pour `manyWay`. C’est pourquoi les autres types n’y sont pas autorisés :

- Un côté inverse devrait parcourir le JSON de chaque document pour savoir qui pointe vers lui.
- La règle « un seul document par cible » (`oneToOne`, `oneToMany`) ne peut pas non plus être
  appliquée sans une telle recherche.

Dans les composants, l’ordre d’une liste `manyWay` est celui du tableau. Les références sont
vérifiées à l’écriture et résolues quand le composant est peuplé, dans le statut et la langue
du document ; les cibles qui n’existent plus sont omises. Elles ne peuvent pas servir de filtre.

## Relations polymorphes

`morphToOne` et `morphToMany` lient des documents de n’importe quel type de contenu. Leurs
liens stockent le type de la cible à côté de son `documentId`, et les écritures nomment les
deux :

```json
{ "data": { "related": [{ "__type": "api::article", "documentId": "k2m…" }, { "__type": "api::page", "documentId": "p9x…" }] } }
```

Les éléments peuplés sont les documents cibles avec leur `__type`, lus dans le statut et la
langue de la requête. Les côtés inverses `morphOne` et `morphMany` nomment le type propriétaire
(`target`) et son attribut (`morphBy`), et sont en lecture seule. Les relations polymorphes ne
peuvent servir ni de filtre ni de tri, et ne peuvent pas se trouver dans des composants.
