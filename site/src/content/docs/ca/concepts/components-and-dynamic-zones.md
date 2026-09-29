---
title: "Components i zones dinàmiques"
description: "Grups de camps reutilitzables i llistes de blocs mixtes, per què Verdin els desa com a JSON al document i què implica per a relacions, multimèdia, filtratge i populate."
sidebar:
  order: 2
---

Els components et permeten reutilitzar un grup de camps en diversos tipus de contingut, i les
zones dinàmiques permeten als editors construir una pàgina a partir d'una llista de blocs.
Aquesta pàgina explica com es modelen i es desen tots dos, i com això afecta la manera de
llegir-los, escriure'ls i filtrar-los. El format de l'esquema és a
[Model de contingut](/ca/concepts/content-model/).

## Components

Un component és un grup de camps amb el seu propi fitxer a `schema/components/<category>/`. El
`shared.seo` de l'exemple del blog conté un meta títol i una descripció:

```json title="schema/components/shared/seo.json"
{
  "displayName": "SEO",
  "attributes": {
    "metaTitle": { "type": "string", "maxLength": 60 },
    "metaDescription": { "type": "text", "maxLength": 160 }
  }
}
```

Un tipus de contingut el fa servir mitjançant un atribut `component`. `repeatable: true` el
converteix en una llista, opcionalment limitada amb `min` i `max` elements:

```json
"seo": { "type": "component", "component": "shared.seo" },
"links": { "type": "component", "component": "shared.link", "repeatable": true, "max": 10 }
```

Els components poden contenir altres components. Un component no es pot contenir a si mateix,
ni directament ni a través d'altres; la comprovació de l'esquema rebutja aquests cicles.

## Zones dinàmiques

Una zona dinàmica és una llista els elements de la qual poden ser qualsevol dels components que
anomena. El cos dels articles del blog barreja capçaleres destacades i cites:

```json
"blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"], "max": 20 }
```

Cada element indica quin component és a `__component`. `min` i `max` limiten el nombre
d'elements. Les zones dinàmiques només pertanyen als tipus de contingut: un component no en pot
contenir cap.

## Desats com a JSON

Verdin desa el valor d'un component o d'una zona dinàmica en una sola columna JSON de la fila
del document (`jsonb` a PostgreSQL, `json` a MySQL i MariaDB, text a SQLite):

```json
// the "seo" column
{ "id": 1, "metaTitle": "Rust for CMS authors", "metaDescription": "…" }

// the "blocks" column
[
  { "__component": "blocks.hero", "id": 1, "title": "Hello", "subtitle": "…" },
  { "__component": "blocks.quote", "id": 2, "text": "…", "author": "Ferris" }
]
```

Strapi guarda cada component a la seva pròpia taula, unida mitjançant taules d'enllaç
polimòrfiques. Desar el valor amb el document implica que:

- Llegir un document amb els seus components no necessita cap join, per molt que s'imbriquin.
- Publicar, descartar un esborrany i l'[historial de contingut](/ca/guides/content/content-history/)
  copien el valor tal qual.
- Afegir un camp a un component no canvia cap taula: la migració és buida.
- Filtrar per camps de components fa servir les funcions JSON de cada base de dades, i alguns
  filtres no són disponibles (consulta [Filtratge](#filtratge)).

Cada element porta un `id`, un enter positiu únic dins del valor de l'atribut. Verdin n'assigna
un als elements nous; torna a enviar l'`id` quan actualitzis una llista per mantenir els
elements estables.

## Relacions i multimèdia dins de components

Un component pot contenir relacions i mitjans, desats al mateix JSON: `documentId` per a les
relacions i ids de fitxer per als mitjans.

- Les relacions dins de components han de ser `oneWay` o `manyWay`: apunten a les seves
  destinacions i no tenen costat invers. Consulta
  [Relacions](/ca/concepts/relations/#relacions-dins-de-components).
- Cada referència es comprova en escriure: el document o fitxer de destinació ha d'existir, i els
  fitxers han de complir els `allowedTypes` del camp.
- Quan es pobla el component, les referències es resolen amb consultes agrupades, en el mateix
  estat i idioma que el document. Una destinació eliminada, o que no té versió en la que s'està
  llegint, queda fora.
- Les relacions polimòrfiques (`morphToOne`, `morphToMany`) i els camps `password` no poden
  estar dins de components.

## Lectura

Els components i les zones dinàmiques només es retornen quan els pobles, com a Strapi:

```http
GET /api/articles?populate[0]=seo&populate[1]=blocks
GET /api/articles?populate=*
```

Un component poblat torna sencer, amb els components imbricats i les relacions i mitjans
resolts inclosos. Strapi necessita un nivell de `populate` per a cada component imbricat; Verdin
accepta aquestes opcions imbricades per compatibilitat i les ignora. Els elements de les zones
dinàmiques tornen en l'ordre en què es van desar, cadascun amb el seu `__component`.

A GraphQL, un component és un tipus objecte amb el nom del seu UID (`ComponentSharedSeo`) i una
zona dinàmica és una unió (`ArticleBlocksDynamicZone`) que consultes amb fragments. Consulta
l'[API GraphQL](/ca/api/graphql/).

## Escriptura

Envia el valor sencer de l'atribut. Substitueix el que hi havia desat:

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

El valor es valida contra l'esquema del component a cada escriptura: les claus desconegudes, els
tipus incorrectes i un `__component` que la zona dinàmica no permet són errors amb camins com
`["blocks", 1, "text"]`. Els camps `required` dins dels components es comproven quan es publica
el document, com els de nivell superior.

## Filtratge

| Què | Exemple | Notes |
| --- | --- | --- |
| Camps d'un component | `filters[seo][metaTitle][$containsi]=rust` | Camps escalars, inclosos els components imbricats. |
| Camps d'un component repetible | `filters[links][url][$contains]=github` | Coincideix quan algun element coincideix. |
| Zones dinàmiques | `filters[blocks][__component][$eq]=blocks.quote` | Només per `__component`: els elements de components diferents tenen camps diferents. |

No pots ordenar per camps de components, i els camps `json` dins de components no es poden
filtrar. Consulta l'[API REST](/ca/api/rest/#filtres) per als operadors.
