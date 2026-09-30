---
title: Referència de tipus d'atribut
description: Tots els tipus d'atribut d'un fitxer d'esquema de Verdin, amb les seves opcions, validacions, emmagatzematge a la base de dades i representació a l'API.
sidebar:
  order: 4
  label: Tipus d'atribut
---

<!-- Written from crates/verdin-schema (convert.rs, validate.rs, model.rs),
crates/verdin-migrate/src/derive.rs and sql.rs (storage), and crates/verdin-content
(input.rs, output.rs, blocks.rs) (API). -->

Els atributs són els camps d'un tipus de contingut o d'un component, declarats a `attributes` al
seu fitxer d'esquema. Aquesta pàgina llista tots els `type`, les opcions que accepten, com els
valida i els desa Verdin, i quin aspecte tenen a l'API. El format és el de Strapi v5; les
diferències es llisten [al final](#diferències-respecte-a-strapi).

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

Els fitxers d'esquema són estrictes: una clau desconeguda, o una opció que el tipus no accepta, és
un error que `verdin schema check` informa amb el seu camí (`attributes.title.maxLength`).

## Opcions que accepten tots els atributs

| Opció | Per defecte | Descripció |
| --- | --- | --- |
| `type` | obligatòria | Un dels tipus de més avall. |
| `required` | `false` | Hi ha d'haver un valor. Es comprova quan es publica una entrada (els esborranys poden estar incomplets), i a cada escriptura d'un tipus sense esborrany i publicació. També s'aplica dins de components i zones dinàmiques. |
| `private` | `false` | L'API de contingut mai no el retorna, i no es pot fer servir a `filters` ni a `sort`. Els atributs `password` sempre són privats. |
| `configurable` | `true` | L'indicador de Strapi per al constructor de l'administració; es conserva tal com està escrit. |
| `pluginOptions.i18n.localized` | `true` | En un tipus de contingut localitzat, `false` comparteix el valor entre idiomes en lloc de tenir-ne un per idioma. |
| `customField` | sense definir | `plugin::<plugin>.<field>` (o `global::<field>`): l'administració edita l'atribut amb el camp personalitzat d'un connector. El `type` és com es desa el valor. Consulta [Connectors](/ca/extending/plugins/). |
| `conditions` | sense definir | Els camps condicionals de Strapi (`{ "visible": <JSON Logic> }`). L'editor amaga el camp mentre la regla és falsa, i el servidor no exigeix un camp amagat. |
| `default` | sense definir | Valor de les entrades noves quan l'escriptura no inclou l'atribut. Ha de ser vàlid per al tipus. No tots els tipus n'accepten (consulta cada tipus). |

Els noms d'atribut comencen per una lletra, seguida de lletres, dígits i `_`, com a màxim 50
caràcters. Als tipus de contingut, `id`, `documentId`, `locale`, `publicationState`, `publishedAt`,
`createdAt`, `updatedAt`, `createdBy` i `updatedBy` estan reservats; als components, `id`. Dos noms
que corresponen a la mateixa columna (`metaTitle` i `meta_title`) són un error.

### On es desen els valors

Cada atribut d'un tipus de contingut és una columna de la taula del tipus (`collectionName`, o el
nom en plural), anomenada en `snake_case`. Les relacions i la multimèdia viuen en taules d'enllaç.
Un esborrany i la seva versió publicada són dues files, una per idioma als tipus localitzats.

Tipus de columna per base de dades:

| Columna | PostgreSQL | MySQL i MariaDB | SQLite |
| --- | --- | --- | --- |
| varchar | `varchar(255)` | `varchar(255)` | `text` |
| text | `text` | `longtext` | `text` |
| integer | `integer` | `int` | `integer` |
| bigint | `bigint` | `bigint` | `integer` |
| double | `double precision` | `double` | `real` |
| decimal | `numeric(p,s)` | `decimal(p,s)` | `text` (exacte) |
| boolean | `boolean` | `tinyint(1)` | `integer` |
| date | `date` | `date` | `text` |
| time | `time(3)` | `time(3)` | `text` |
| datetime | `timestamptz(3)` | `datetime(3)` | `text` |
| json | `jsonb` | `json` | `text` |

Un tipus de contingut pot tenir com a màxim 60 atributs `string`, `email`, `uid` i `enumeration`
(el límit de mida de fila de MySQL); fes servir `text` per a més.

### `unique`

Els tipus que accepten `unique: true` reben un índex únic sobre
`(column, locale, publication_state)`: dues entrades publicades, o dos esborranys, en el mateix
idioma no poden compartir un valor, mentre que un esborrany i la seva pròpia versió publicada sí.
Una escriptura que ho incompleix falla amb un error de validació sobre l'atribut. Dins de
components, `unique` s'accepta però no es fa complir (els valors dels components es desen com a
JSON).

## Text

### `string`

Una sola línia de text.

| Opció | Descripció |
| --- | --- |
| `minLength`, `maxLength` | Límits de longitud en caràcters. `maxLength` és com a màxim 255. |
| `regex` | Un patró que el valor ha de complir. Sintaxi semblant a JavaScript, amb look-around i referències enrere incloses. |
| `unique` | Consulta [`unique`](#unique). |
| `default` | Una cadena dins dels límits que compleixi `regex`. |

Es desa com a `varchar(255)`. API: una cadena.

### `text`

Text pla més llarg (un textarea a l'administració).

| Opció | Descripció |
| --- | --- |
| `minLength`, `maxLength` | Límits de longitud, sense límit superior. |
| `default` | Una cadena dins dels límits. |

Es desa com a `text` (`longtext` a MySQL). API: una cadena.

### `richtext`

Text Markdown. Mateixes opcions, emmagatzematge i API que `text`; l'administració l'edita amb
l'editor Markdown.

### `blocks`

Text enriquit en el JSON de blocs de Strapi: una llista de blocs `paragraph`, `heading` (`level`
d'1 a 6), `list` (`format` `ordered` o `unordered`, amb fills `list-item`, imbricats fins a 8
nivells), `quote`, `code` (`language` opcional) i `image`. Els fills en línia són nodes `text`, amb
les marques `bold`, `italic`, `underline`, `strikethrough` i `code`, i nodes `link`. Com a màxim
10.000 blocs.

Sense opcions, sense `default`. Es desa com a JSON. API: la llista de blocs, tal com s'ha escrit.

```json
[
  { "type": "heading", "level": 2, "children": [{ "type": "text", "text": "Hello" }] },
  { "type": "paragraph", "children": [{ "type": "text", "text": "bold", "bold": true }] }
]
```

### `email`

Una adreça de correu electrònic (`name@domain.tld`, sense espais).

| Opció | Descripció |
| --- | --- |
| `minLength`, `maxLength` | Límits de longitud; `maxLength` com a màxim 255. |
| `unique` | Consulta [`unique`](#unique). |
| `default` | Una adreça de correu electrònic. |

Es desa com a `varchar(255)`. API: una cadena.

### `password`

Un secret, del qual es desa un hash Argon2id en escriure.

| Opció | Descripció |
| --- | --- |
| `minLength`, `maxLength` | Límits de longitud de la contrasenya tal com s'envia. |

Sense `default`. Sempre privat: mai no es retorna, es filtra ni s'ordena. No es permet dins de
components. Es desa com a `varchar(255)` (el hash). Les importacions conserven tal qual els hashes
bcrypt i Argon2 existents, de manera que els comptes importats poden continuar iniciant la sessió.

### `uid`

Un identificador per a URL, com un slug. L'administració el genera a partir de `targetField`.

| Opció | Descripció |
| --- | --- |
| `targetField` | Un atribut `string` o `text` del mateix tipus a partir del qual generar el valor. |
| `minLength`, `maxLength` | Límits de longitud; `maxLength` com a màxim 255. |
| `regex` | El patró que han de complir els valors; sense aquesta opció, `^[A-Za-z0-9\-_.~]*$`. |
| `default` | Un valor vàlid. |

Sempre únic (consulta [`unique`](#unique)). Es desa com a `varchar(255)`. API: una cadena.

### `enumeration`

Un valor d'una llista fixa.

| Opció | Descripció |
| --- | --- |
| `enum` | Els valors: almenys un, cadascun d'1 a 255 caràcters, sense duplicats. |
| `default` | Un dels valors. |

Es desa com a `varchar(255)`. API: una cadena. Les escriptures de qualsevol altre valor fallen.

## Nombres

### `integer`

Un enter de 32 bits (−2.147.483.648 a 2.147.483.647).

| Opció | Descripció |
| --- | --- |
| `min`, `max` | Límits (enters). |
| `unique` | Consulta [`unique`](#unique). |
| `default` | Un enter dins dels límits. |

Es desa com a `integer`. API: un nombre. Les escriptures accepten nombres i cadenes d'enters.

### `biginteger`

Un enter de 64 bits. Mateixes opcions que `integer`.

Es desa com a `bigint`. API: una cadena (`"9007199254740993"`), com a Strapi, perquè els nombres de
JavaScript perden precisió més enllà de 2⁵³. Les escriptures accepten cadenes i nombres.

### `float`

Un nombre de coma flotant de doble precisió. Mateixes opcions que `integer`, amb límits numèrics.

Es desa com a `double precision` (`double`, `real`). API: un nombre.

### `decimal`

Un nombre decimal exacte.

| Opció | Per defecte | Descripció |
| --- | --- | --- |
| `precision` | `10` | Dígits totals, d'1 a 38. |
| `scale` | `2` | Dígits després de la coma decimal, com a màxim `precision`. |
| `min`, `max` | | Límits. |
| `unique` | | Consulta [`unique`](#unique). |
| `default` | | Un nombre dins dels límits. |

Els valors s'arrodoneixen a `scale` dígits (la meitat s'allunya de zero, com fan les bases de
dades), i es rebutgen quan tenen més de `precision - scale` dígits abans de la coma. Les
escriptures accepten nombres i cadenes numèriques. Es desa com a `numeric(precision,scale)`
(`text` a SQLite, de manera que no s'arrodoneix res). API: un nombre, com el retorna Strapi. Els
valors enters són enters (`25`, no `25.0`) i els altres són el flotant més curt que es torna a llegir
igual (`12.5`). Amb [`[api].decimal_as_string`](/ca/reference/configuration/) l'API retorna una
cadena exacta.

## Dates i booleans

### `boolean`

`true` o `false`. Accepta `default`. Es desa com a `boolean` (`tinyint(1)`, `integer`). API: un
booleà.

### `date`

Una data de calendari, `YYYY-MM-DD`. Accepta `unique` i `default`. Es desa com a `date`. API:
`"2026-09-29"`.

### `time`

Una hora del dia, `HH:MM`, `HH:MM:SS` o `HH:MM:SS.mmm`. Accepta `unique` i `default`. Es desa amb
precisió de mil·lisegons. API: `"14:30:00.000"`.

### `datetime`

Un moment en el temps: una marca de temps ISO 8601 amb fus horari (`Z` o `+02:00`). Accepta
`unique` i `default`. Es desa en UTC amb precisió de mil·lisegons. API:
`"2026-09-29T12:30:00.000Z"`.

## `json`

Qualsevol valor JSON. Accepta `default` (qualsevol JSON). Es desa com a `jsonb` (`json`, `text`).
API: el valor tal com s'ha escrit. A `filters`, els atributs JSON només admeten `$null` i
`$notNull`, i no s'hi pot ordenar.

## Multimèdia

### `media`

Fitxers de la mediateca.

| Opció | Per defecte | Descripció |
| --- | --- | --- |
| `multiple` | `false` | Conté una llista de fitxers en lloc d'un. |
| `allowedTypes` | qualsevol | Tipus de fitxers: `images`, `videos`, `audios`, `files` (qualsevol altra cosa). |

Sense `default`. Es desa en una taula d'enllaç `{table}_{attribute}_mda`, en ordre. Les
escriptures accepten ids de fitxer: `12`, `{ "id": 12 }`, una llista d'aquests, o `null`. API:
només amb `populate`; un objecte de fitxer (`url`, `mime`, `width`, `formats`…, com a Strapi), una
llista d'aquests, o `null`. Consulta [Multimèdia](/ca/concepts/media/).

## Relacions

### `relation`

Enllaços a documents d'un altre tipus de contingut.

| Opció | Descripció |
| --- | --- |
| `relation` | `oneToOne`, `oneToMany`, `manyToOne`, `manyToMany`, `oneWay`, `manyWay`, o un tipus polimòrfic (a sota). |
| `target` | El tipus de contingut de destinació: `article`, `api::article` o `api::article.article`. |
| `inversedBy` | Al costat propietari d'una relació bidireccional: l'atribut de la destinació que la reflecteix. |
| `mappedBy` | A l'altre costat: l'atribut propietari de la destinació. |

Els dos costats d'una relació bidireccional han de coincidir: `oneToMany` reflecteix `manyToOne`,
`oneToOne` i `manyToMany` es reflecteixen a si mateixos, i el costat `mappedBy` anomena un atribut
el `inversedBy` del qual hi torna a apuntar. `oneWay` i `manyWay` no tenen altre costat.

Els enllaços es desen a `{table}_{attribute}_lnk` al costat propietari (el costat sense
`mappedBy`), apuntant al `documentId` de la destinació, en ordre. Les escriptures accepten
`documentId`:

| Escriptura | Significat |
| --- | --- |
| `"d8f3…"`, `{ "documentId": "d8f3…" }`, una llista d'aquests | Substitueix els enllaços. |
| `null` o `[]` | Elimina tots els enllaços. |
| `{ "set": [...] }` | Substitueix els enllaços. |
| `{ "connect": [...], "disconnect": [...] }` | Afegeix i elimina enllaços. Un element de `connect` pot portar `position`: `{ "before": id }`, `{ "after": id }`, `{ "start": true }` o `{ "end": true }`. |

API: només amb `populate`, com els documents relacionats (com a màxim 1.000 per entrada i
relació), o `{ "count": n }` amb `populate[tags][count]=true`. Consulta
[Relacions](/ca/concepts/relations/).

Dins de components, només es permeten `oneWay` i `manyWay`; el component desa els `documentId`.

### Relacions polimòrfiques

`relation` també accepta els tipus polimòrfics, que enllacen documents de qualsevol tipus de
contingut:

| `relation` | Opcions | Descripció |
| --- | --- | --- |
| `morphToOne` | cap | Enllaça un document de qualsevol tipus. |
| `morphToMany` | cap | Enllaça documents de qualsevol tipus. |
| `morphOne` | `target`, `morphBy` | Costat invers: llegeix els enllaços de l'atribut `morphBy` `morphToOne` o `morphToMany` de `target`. |
| `morphMany` | `target`, `morphBy` | El mateix, per a molts. |

Els propietaris desen parells `(type, documentId)` a `{table}_{attribute}_mph`. Les escriptures
accepten elements `{ "__type": "api::article", "documentId": "…" }` (un, una llista, `null` o
`{ "set": [...] }`). Els elements poblats porten el seu tipus a `__type`. No es permeten dins de
components.

## Components i zones dinàmiques

### `component`

Un grup de camps definit a `schema/components/<category>/<name>.json`.

| Opció | Per defecte | Descripció |
| --- | --- | --- |
| `component` | obligatòria | L'uid del component, `category.name` (`shared.seo`). |
| `repeatable` | `false` | Conté una llista d'elements en lloc d'un. |
| `min`, `max` | | Nombre d'elements; només amb `repeatable`. |

Sense `default`: els elements nous reben els valors per defecte dels seus propis atributs. Es desa
com a JSON a la fila de l'entrada, cada element amb un `id`. Les escriptures accepten l'objecte de
l'element (o una llista), amb `id` per conservar un element existent. API: només amb `populate`,
l'element o la llista sencers. A `filters`, pots filtrar pels camps d'un component
(`filters[seo][metaTitle][$eq]=…`). Consulta
[Components i zones dinàmiques](/ca/concepts/components-and-dynamic-zones/).

### `dynamiczone`

Una llista d'elements, cadascun d'un entre diversos components.

| Opció | Descripció |
| --- | --- |
| `components` | Els uids de components permesos: almenys un, sense duplicats. |
| `min`, `max` | Nombre d'elements. |

Cada element porta `__component` amb el seu uid. Es desa com a JSON a la fila de l'entrada. API:
només amb `populate`, la llista sencera. Filtra per component amb
`filters[blocks][__component][$eq]=blocks.hero`. Les zones dinàmiques no es poden imbricar dins de
components.

## Validacions entre camps

A més de les opcions per atribut, un tipus de contingut pot declarar regles sobre diversos camps a
`validations`, que es comproven sempre que es comprova `required`:

```json
"validations": [
  {
    "rule": { "<=": [{ "var": "startDate" }, { "var": "endDate" }] },
    "message": "The end date must be after the start date",
    "field": "endDate"
  }
]
```

`rule` és una expressió JSON Logic sobre l'entrada que s'ha de complir. Pot fer servir `var`, `==`,
`!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`, `and`, `or`, `in`, `if`, `?:`, `+`, `-`, `*`,
`/`, `%`, `min`, `max` i `cat`. `message` s'informa a `field` (un atribut del tipus) o a l'entrada.
És una addició de Verdin; Strapi no té cap equivalent.

## Diferències respecte a Strapi

- **Els components es desen com a JSON** a la fila de l'entrada, no en taules de components amb
  taules d'unió. Les lectures no necessiten joins; com a conseqüència, els atributs `password`, les
  relacions polimòrfiques i les relacions bidireccionals no poden estar dins de components, i
  `unique` no s'hi fa complir.
- **Els components poblats vénen sencers.** `populate` sobre un component o una zona dinàmica
  retorna tots els seus camps; no pots triar camps imbricats com a Strapi.
- **Fitxers d'esquema estrictes.** Les claus desconegudes i les opcions que un tipus no accepta són
  errors, mentre que Strapi les ignora. A `pluginOptions`, només es llegeix `i18n.localized`; la
  resta s'ignora.
- **`string`, `email` i `uid` estan limitats a 255 caràcters**, la mida de la columna, en lloc de
  fallar a la base de dades.
- **`conditions`** (camps condicionals) funcionen com a Strapi 5.17: els camps amagats no són obligatoris.
- **`validations`** són pròpies de Verdin.
- La resta coincideix amb Strapi v5: els noms dels tipus, les seves opcions, els valors
  `biginteger` com a cadenes, les escriptures de relacions amb `connect`, `disconnect`, `set` i
  `position`, i el format de blocs.
