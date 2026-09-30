---
title: Référence des types d’attributs
description: Chaque type d’attribut d’un fichier de schéma Verdin, avec ses options, ses validations, son stockage en base de données et sa représentation dans l’API.
sidebar:
  order: 4
  label: Types d’attributs
---

<!-- Written from crates/verdin-schema (convert.rs, validate.rs, model.rs),
crates/verdin-migrate/src/derive.rs and sql.rs (storage), and crates/verdin-content
(input.rs, output.rs, blocks.rs) (API). -->

Les attributs sont les champs d’un type de contenu ou d’un composant, déclarés sous
`attributes` dans son fichier de schéma. Cette page liste chaque `type`, les options qu’il
accepte, la façon dont Verdin le valide et le stocke, et son apparence dans l’API. Le format est
celui de Strapi v5 ; les différences sont listées [à la fin](#différences-avec-strapi).

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
    "readingTime": { "type": "integer", "min": 0 },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "seo": { "type": "component", "component": "shared.seo" }
  }
}
```

Les fichiers de schéma sont stricts : une clé inconnue, ou une option que le type n’accepte pas,
est une erreur que `verdin schema check` signale avec son chemin (`attributes.title.maxLength`).

## Options acceptées par tous les attributs

| Option | Valeur par défaut | Description |
| --- | --- | --- |
| `type` | obligatoire | L’un des types ci-dessous. |
| `required` | `false` | Une valeur doit être présente. Vérifié à la publication d’une entrée (les brouillons peuvent être incomplets), et à chaque écriture d’un type sans brouillon et publication. S’applique aussi dans les composants et les zones dynamiques. |
| `private` | `false` | Jamais renvoyé par l’API de contenu, et inutilisable dans `filters` ou `sort`. Les attributs `password` sont toujours privés. |
| `configurable` | `true` | L’indicateur de Strapi pour le constructeur de l’administration ; conservé tel quel. |
| `pluginOptions.i18n.localized` | `true` | Dans un type de contenu localisé, `false` partage la valeur entre les langues au lieu d’une valeur par langue. |
| `customField` | non défini | `plugin::<plugin>.<field>` (ou `global::<field>`) : l’administration édite l’attribut avec le champ personnalisé d’un plugin. Le `type` indique comment la valeur est stockée. Voir [Plugins](/fr/extending/plugins/). |
| `conditions` | non défini | Les champs conditionnels de Strapi (`{ "visible": <JSON Logic> }`). L’éditeur masque le champ tant que la règle est fausse, et le serveur n’exige pas un champ masqué. |
| `default` | non défini | Valeur des nouvelles entrées quand l’écriture omet l’attribut. Doit être valide pour le type. Tous les types n’en acceptent pas (voir chaque type). |

Les noms d’attributs commencent par une lettre, suivie de lettres, chiffres et `_`, 50 caractères
au maximum. Sur les types de contenu, `id`, `documentId`, `locale`, `publicationState`,
`publishedAt`, `createdAt`, `updatedAt`, `createdBy` et `updatedBy` sont réservés ; sur les
composants, `id`. Deux noms qui correspondent à la même colonne (`metaTitle` et `meta_title`)
sont une erreur.

### Où les valeurs sont stockées

Chaque attribut d’un type de contenu est une colonne de la table du type (`collectionName`, ou le
nom au pluriel), nommée en `snake_case`. Les relations et les médias résident plutôt dans des
tables de liaison. Un brouillon et sa version publiée sont deux lignes, une par langue dans les
types localisés.

Types de colonnes par base de données :

| Colonne | PostgreSQL | MySQL et MariaDB | SQLite |
| --- | --- | --- | --- |
| varchar | `varchar(255)` | `varchar(255)` | `text` |
| text | `text` | `longtext` | `text` |
| integer | `integer` | `int` | `integer` |
| bigint | `bigint` | `bigint` | `integer` |
| double | `double precision` | `double` | `real` |
| decimal | `numeric(p,s)` | `decimal(p,s)` | `text` (exact) |
| boolean | `boolean` | `tinyint(1)` | `integer` |
| date | `date` | `date` | `text` |
| time | `time(3)` | `time(3)` | `text` |
| datetime | `timestamptz(3)` | `datetime(3)` | `text` |
| json | `jsonb` | `json` | `text` |

Un type de contenu peut avoir au plus 60 attributs `string`, `email`, `uid` et `enumeration` (la
limite de taille de ligne de MySQL) ; utilisez `text` au-delà.

### `unique`

Les types qui acceptent `unique: true` reçoivent un index unique sur
`(column, locale, publication_state)` : deux entrées publiées, ou deux brouillons, dans la même
langue ne peuvent pas partager une valeur, alors qu’un brouillon et sa propre version publiée le
peuvent. Une écriture qui enfreint cette règle échoue avec une erreur de validation sur
l’attribut. Dans les composants, `unique` est accepté mais pas appliqué (les valeurs des
composants sont stockées en JSON).

## Texte

### `string`

Une seule ligne de texte.

| Option | Description |
| --- | --- |
| `minLength`, `maxLength` | Bornes de longueur en caractères. `maxLength` vaut au plus 255. |
| `regex` | Un motif auquel la valeur doit correspondre. Syntaxe de type JavaScript, lookaround et références arrière compris. |
| `unique` | Voir [`unique`](#unique). |
| `default` | Une chaîne dans les bornes qui correspond à `regex`. |

Stocké en `varchar(255)`. API : une chaîne.

### `text`

Du texte brut plus long (une zone de texte dans l’administration).

| Option | Description |
| --- | --- |
| `minLength`, `maxLength` | Bornes de longueur, sans limite supérieure. |
| `default` | Une chaîne dans les bornes. |

Stocké en `text` (`longtext` sur MySQL). API : une chaîne.

### `richtext`

Du texte Markdown. Mêmes options, stockage et API que `text` ; l’administration l’édite avec
l’éditeur Markdown.

### `blocks`

Du texte enrichi au format JSON blocks de Strapi : une liste de blocs `paragraph`, `heading`
(`level` de 1 à 6), `list` (`format` `ordered` ou `unordered`, avec des enfants `list-item`,
imbriqués sur 8 niveaux au maximum), `quote`, `code` (`language` facultatif) et `image`. Les
enfants en ligne sont des nœuds `text`, avec les marques `bold`, `italic`, `underline`,
`strikethrough` et `code`, et des nœuds `link`. Au plus 10 000 blocs.

Aucune option, pas de `default`. Stocké en JSON. API : la liste des blocs, telle qu’écrite.

```json
[
  { "type": "heading", "level": 2, "children": [{ "type": "text", "text": "Hello" }] },
  { "type": "paragraph", "children": [{ "type": "text", "text": "bold", "bold": true }] }
]
```

### `email`

Une adresse e-mail (`name@domain.tld`, sans espaces).

| Option | Description |
| --- | --- |
| `minLength`, `maxLength` | Bornes de longueur ; `maxLength` vaut au plus 255. |
| `unique` | Voir [`unique`](#unique). |
| `default` | Une adresse e-mail. |

Stocké en `varchar(255)`. API : une chaîne.

### `password`

Un secret, haché à l’écriture avec Argon2id.

| Option | Description |
| --- | --- |
| `minLength`, `maxLength` | Bornes de longueur du mot de passe tel qu’envoyé. |

Pas de `default`. Toujours privé : jamais renvoyé, filtré ni trié. Non autorisé dans les
composants. Stocké en `varchar(255)` (le hachage). Les imports conservent tels quels les hachages
bcrypt et Argon2 existants, pour que les comptes importés puissent toujours se connecter.

### `uid`

Un identifiant pour les URL, comme un slug. L’administration le génère à partir de
`targetField`.

| Option | Description |
| --- | --- |
| `targetField` | Un attribut `string` ou `text` du même type à partir duquel générer la valeur. |
| `minLength`, `maxLength` | Bornes de longueur ; `maxLength` vaut au plus 255. |
| `regex` | Le motif auquel les valeurs doivent correspondre ; sans lui, `^[A-Za-z0-9\-_.~]*$`. |
| `default` | Une valeur valide. |

Toujours unique (voir [`unique`](#unique)). Stocké en `varchar(255)`. API : une chaîne.

### `enumeration`

Une valeur parmi une liste fixe.

| Option | Description |
| --- | --- |
| `enum` | Les valeurs : au moins une, chacune de 1 à 255 caractères, sans doublons. |
| `default` | L’une des valeurs. |

Stocké en `varchar(255)`. API : une chaîne. Les écritures de toute autre valeur échouent.

## Nombres

### `integer`

Un entier 32 bits (de −2 147 483 648 à 2 147 483 647).

| Option | Description |
| --- | --- |
| `min`, `max` | Bornes (entières). |
| `unique` | Voir [`unique`](#unique). |
| `default` | Un entier dans les bornes. |

Stocké en `integer`. API : un nombre. Les écritures acceptent des nombres et des chaînes
d’entiers.

### `biginteger`

Un entier 64 bits. Mêmes options qu’`integer`.

Stocké en `bigint`. API : une chaîne (`"9007199254740993"`), comme dans Strapi, car les nombres
JavaScript perdent en précision au-delà de 2⁵³. Les écritures acceptent des chaînes et des
nombres.

### `float`

Un nombre à virgule flottante en double précision. Mêmes options qu’`integer`, avec des bornes
numériques.

Stocké en `double precision` (`double`, `real`). API : un nombre.

### `decimal`

Un nombre décimal exact.

| Option | Valeur par défaut | Description |
| --- | --- | --- |
| `precision` | `10` | Nombre total de chiffres, de 1 à 38. |
| `scale` | `2` | Chiffres après la virgule, au plus `precision`. |
| `min`, `max` | | Bornes. |
| `unique` | | Voir [`unique`](#unique). |
| `default` | | Un nombre dans les bornes. |

Les valeurs sont arrondies à `scale` chiffres (au plus loin de zéro pour les demis, comme le font
les bases de données), et rejetées quand elles ont plus de `precision - scale` chiffres avant la
virgule. Les écritures acceptent des nombres et des chaînes numériques. Stocké en
`numeric(precision,scale)` (`text` sur SQLite, pour que rien ne soit arrondi). API : un nombre,
comme le renvoie Strapi. Les valeurs entières sont des entiers (`25`, pas `25.0`) et les autres
sont le plus court flottant qui se relit à l’identique (`12.5`). Avec
[`[api].decimal_as_string`](/fr/reference/configuration/), l’API renvoie à la place une chaîne
exacte.

## Dates et booléens

### `boolean`

`true` ou `false`. Accepte `default`. Stocké en `boolean` (`tinyint(1)`, `integer`). API : un
booléen.

### `date`

Une date du calendrier, `YYYY-MM-DD`. Accepte `unique` et `default`. Stocké en `date`. API :
`"2026-09-29"`.

### `time`

Une heure de la journée, `HH:MM`, `HH:MM:SS` ou `HH:MM:SS.mmm`. Accepte `unique` et `default`.
Stocké avec une précision à la milliseconde. API : `"14:30:00.000"`.

### `datetime`

Un instant : un horodatage ISO 8601 avec un fuseau (`Z` ou `+02:00`). Accepte `unique` et
`default`. Stocké en UTC avec une précision à la milliseconde. API :
`"2026-09-29T12:30:00.000Z"`.

## `json`

N’importe quelle valeur JSON. Accepte `default` (n’importe quel JSON). Stocké en `jsonb`
(`json`, `text`). API : la valeur telle qu’écrite. Dans `filters`, les attributs JSON
n’acceptent que `$null` et `$notNull`, et ils ne peuvent pas servir au tri.

## Médias

### `media`

Des fichiers de la médiathèque.

| Option | Valeur par défaut | Description |
| --- | --- | --- |
| `multiple` | `false` | Contient une liste de fichiers au lieu d’un seul. |
| `allowedTypes` | tout | Genres de fichiers : `images`, `videos`, `audios`, `files` (tout le reste). |

Pas de `default`. Stocké dans une table de liaison `{table}_{attribute}_mda`, dans l’ordre. Les
écritures prennent des identifiants de fichiers : `12`, `{ "id": 12 }`, une liste de ceux-ci, ou
`null`. API : uniquement avec `populate` ; un objet fichier (`url`, `mime`, `width`, `formats`…,
comme dans Strapi), une liste de ceux-ci, ou `null`. Voir [Médias](/fr/concepts/media/).

## Relations

### `relation`

Des liens vers des documents d’un autre type de contenu.

| Option | Description |
| --- | --- |
| `relation` | `oneToOne`, `oneToMany`, `manyToOne`, `manyToMany`, `oneWay`, `manyWay`, ou un type polymorphe (ci-dessous). |
| `target` | Le type de contenu cible : `article`, `api::article` ou `api::article.article`. |
| `inversedBy` | Sur le côté propriétaire d’une relation bidirectionnelle : l’attribut de la cible qui lui fait pendant. |
| `mappedBy` | Sur l’autre côté : l’attribut propriétaire de la cible. |

Les deux côtés d’une relation bidirectionnelle doivent concorder : `oneToMany` fait pendant à
`manyToOne`, `oneToOne` et `manyToMany` se font pendant à eux-mêmes, et le côté `mappedBy` nomme
un attribut dont le `inversedBy` pointe en retour. `oneWay` et `manyWay` n’ont pas d’autre côté.

Les liens sont stockés dans `{table}_{attribute}_lnk` du côté propriétaire (le côté sans
`mappedBy`), pointant vers le `documentId` de la cible, dans l’ordre. Les écritures prennent des
`documentId` :

| Écriture | Signification |
| --- | --- |
| `"d8f3…"`, `{ "documentId": "d8f3…" }`, une liste de ceux-ci | Remplace les liens. |
| `null` ou `[]` | Supprime tous les liens. |
| `{ "set": [...] }` | Remplace les liens. |
| `{ "connect": [...], "disconnect": [...] }` | Ajoute et supprime des liens. Un élément de `connect` peut porter `position` : `{ "before": id }`, `{ "after": id }`, `{ "start": true }` ou `{ "end": true }`. |

API : uniquement avec `populate`, sous forme de documents liés (au plus 1 000 par entrée et par
relation), ou `{ "count": n }` avec `populate[tags][count]=true`. Voir
[Relations](/fr/concepts/relations/).

Dans les composants, seuls `oneWay` et `manyWay` sont autorisés ; le composant stocke les
`documentId`.

### Relations polymorphes

`relation` accepte aussi les types polymorphes, qui lient des documents de n’importe quel type de
contenu :

| `relation` | Options | Description |
| --- | --- | --- |
| `morphToOne` | aucune | Lie un document de n’importe quel type. |
| `morphToMany` | aucune | Lie des documents de n’importe quels types. |
| `morphOne` | `target`, `morphBy` | Côté inverse : lit les liens de l’attribut `morphToOne` ou `morphToMany` `morphBy` de `target`. |
| `morphMany` | `target`, `morphBy` | Idem, pour plusieurs. |

Les propriétaires stockent des paires `(type, documentId)` dans `{table}_{attribute}_mph`. Les
écritures prennent des éléments `{ "__type": "api::article", "documentId": "…" }` (un seul, une
liste, `null` ou `{ "set": [...] }`). Les éléments peuplés portent leur type dans `__type`. Non
autorisé dans les composants.

## Composants et zones dynamiques

### `component`

Un groupe de champs défini dans `schema/components/<category>/<name>.json`.

| Option | Valeur par défaut | Description |
| --- | --- | --- |
| `component` | obligatoire | L’UID du composant, `category.name` (`shared.seo`). |
| `repeatable` | `false` | Contient une liste d’éléments au lieu d’un seul. |
| `min`, `max` | | Nombre d’éléments ; uniquement avec `repeatable`. |

Pas de `default` : les nouveaux éléments reçoivent les valeurs par défaut de leurs propres
attributs. Stocké en JSON dans la ligne de l’entrée, chaque élément avec un `id`. Les écritures
prennent l’objet de l’élément (ou une liste), avec `id` pour conserver un élément existant. API :
uniquement avec `populate`, l’élément ou la liste en entier. Dans `filters`, vous pouvez filtrer
sur les champs d’un composant (`filters[seo][metaTitle][$eq]=…`). Voir
[Composants et zones dynamiques](/fr/concepts/components-and-dynamic-zones/).

### `dynamiczone`

Une liste d’éléments, chacun étant l’un de plusieurs composants.

| Option | Description |
| --- | --- |
| `components` | Les UID de composants autorisés : au moins un, sans doublons. |
| `min`, `max` | Nombre d’éléments. |

Chaque élément porte `__component` avec son UID. Stocké en JSON dans la ligne de l’entrée. API :
uniquement avec `populate`, la liste en entier. Filtrez par composant avec
`filters[blocks][__component][$eq]=blocks.hero`. Les zones dynamiques ne peuvent pas être
imbriquées dans des composants.

## Validations inter-champs

Outre les options par attribut, un type de contenu peut déclarer dans `validations` des règles
portant sur plusieurs champs, vérifiées en même temps que `required` :

```json
"validations": [
  {
    "rule": { "<=": [{ "var": "startDate" }, { "var": "endDate" }] },
    "message": "The end date must be after the start date",
    "field": "endDate"
  }
]
```

`rule` est une expression JSON Logic sur l’entrée qui doit être vraie. Elle peut utiliser `var`,
`==`, `!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`, `and`, `or`, `in`, `if`, `?:`, `+`,
`-`, `*`, `/`, `%`, `min`, `max` et `cat`. `message` est signalé sur `field` (un attribut du type)
ou sur l’entrée. C’est un ajout de Verdin ; Strapi n’a pas d’équivalent.

## Différences avec Strapi

- **Les composants sont stockés en JSON** dans la ligne de l’entrée, et non dans des tables de
  composants avec des tables de jointure. Les lectures ne nécessitent aucune jointure ; en
  conséquence, les attributs `password`, les relations polymorphes et les relations
  bidirectionnelles ne peuvent pas se trouver dans des composants, et `unique` n’y est pas
  appliqué.
- **Les composants peuplés sont renvoyés en entier.** `populate` sur un composant ou une zone
  dynamique renvoie tous ses champs ; vous ne pouvez pas choisir des champs imbriqués comme dans
  Strapi.
- **Des fichiers de schéma stricts.** Les clés inconnues et les options qu’un type n’accepte pas
  sont des erreurs, là où Strapi les ignore. Dans `pluginOptions`, seul `i18n.localized` est lu ;
  le reste est ignoré.
- **`string`, `email` et `uid` sont plafonnés à 255 caractères**, la taille de la colonne, au
  lieu d’échouer au niveau de la base de données.
- **Les `conditions`** (champs conditionnels) fonctionnent comme dans Strapi 5.17 : les champs masqués ne sont pas obligatoires.
- **Les `validations`** sont propres à Verdin.
- Le reste correspond à Strapi v5 : les noms des types, leurs options, les valeurs `biginteger`
  sous forme de chaînes, les écritures de relations avec `connect`, `disconnect`, `set` et
  `position`, et le format blocks.
