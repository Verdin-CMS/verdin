---
title: "Componenten en dynamische zones"
description: "Herbruikbare veldgroepen en gemengde bloklijsten, waarom Verdin ze als JSON in het document opslaat, en wat dat betekent voor relaties, media, filteren en populate."
sidebar:
  order: 2
---

Met componenten hergebruik je een groep velden in meerdere contenttypes, en met dynamische zones
bouwen redacteuren een pagina op uit een lijst blokken. Deze pagina legt uit hoe beide worden
gemodelleerd en opgeslagen, en hoe dat bepaalt hoe je ze leest, schrijft en filtert. Het
schemaformaat zelf staat in [Contentmodel](/nl/concepts/content-model/).

## Componenten

Een component is een groep velden met een eigen bestand onder `schema/components/<category>/`.
`shared.seo` uit het blogvoorbeeld bevat een metatitel en -beschrijving:

```json title="schema/components/shared/seo.json"
{
  "displayName": "SEO",
  "attributes": {
    "metaTitle": { "type": "string", "maxLength": 60 },
    "metaDescription": { "type": "text", "maxLength": 160 }
  }
}
```

Een contenttype gebruikt hem via een attribuut `component`. `repeatable: true` maakt er een lijst
van, eventueel begrensd met `min` en `max` items:

```json
"seo": { "type": "component", "component": "shared.seo" },
"links": { "type": "component", "component": "shared.link", "repeatable": true, "max": 10 }
```

Componenten kunnen andere componenten bevatten. Een component kan zichzelf niet bevatten, direct
of via andere; de schemacontrole weigert zulke cycli.

## Dynamische zones

Een dynamische zone is een lijst waarvan de items elk van de genoemde componenten kunnen zijn.
De body van een artikel in de blog mengt hero's en citaten:

```json
"blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"], "max": 20 }
```

Elk item zegt in `__component` welke component het is. `min` en `max` begrenzen het aantal items.
Dynamische zones horen alleen bij contenttypes: een component kan er geen bevatten.

## Opgeslagen als JSON

Verdin slaat de waarde van een component of dynamische zone op in één JSON-kolom van de rij van
het document (`jsonb` op PostgreSQL, `json` op MySQL en MariaDB, tekst op SQLite):

```json
// the "seo" column
{ "id": 1, "metaTitle": "Rust for CMS authors", "metaDescription": "…" }

// the "blocks" column
[
  { "__component": "blocks.hero", "id": 1, "title": "Hello", "subtitle": "…" },
  { "__component": "blocks.quote", "id": 2, "text": "…", "author": "Ferris" }
]
```

Strapi bewaart elke component in een eigen tabel, gekoppeld via polymorfe koppeltabellen. De
waarde in plaats daarvan bij het document opslaan betekent:

- Een document met zijn componenten lezen vereist geen joins, hoe diep ze ook genest zijn.
- Publiceren, een concept verwerpen en [contentgeschiedenis](/nl/guides/content/content-history/)
  kopiëren de waarde zoals ze is.
- Een veld aan een component toevoegen wijzigt geen tabel: de migratie is leeg.
- Filteren op componentvelden gebruikt de JSON-functies van elke database, en sommige filters
  zijn niet beschikbaar (zie [Filteren](#filteren)).

Elk item heeft een `id`, een positief geheel getal dat uniek is binnen de waarde van het
attribuut. Verdin kent er een toe aan nieuwe items; stuur het `id` terug als je een lijst
bijwerkt, zodat items stabiel blijven.

## Relaties en media in componenten

Een component kan relaties en media bevatten, opgeslagen in de JSON zelf: `documentId`s voor
relaties en bestands-id's voor media.

- Relaties in componenten moeten `oneWay` of `manyWay` zijn: ze wijzen naar hun doelen en hebben
  geen inverse kant. Zie [Relaties](/nl/concepts/relations/#relaties-binnen-componenten).
- Elke verwijzing wordt bij het schrijven gecontroleerd: het doeldocument of -bestand moet
  bestaan, en bestanden moeten overeenkomen met de `allowedTypes` van het veld.
- Wanneer de component wordt gepopuleerd, worden verwijzingen met gebundelde queries opgelost, in
  dezelfde status en locale als het document. Een doel dat is verwijderd, of dat geen versie
  heeft in de versie die gelezen wordt, wordt weggelaten.
- Polymorfe relaties (`morphToOne`, `morphToMany`) en `password`-velden kunnen niet in
  componenten staan.

## Lezen

Componenten en dynamische zones worden alleen teruggegeven als je ze populeert, zoals in Strapi:

```http
GET /api/articles?populate[0]=seo&populate[1]=blocks
GET /api/articles?populate=*
```

Een gepopuleerde component komt volledig terug, geneste componenten en opgeloste relaties en
media inbegrepen. Strapi heeft een `populate`-niveau nodig voor elke geneste component; Verdin
accepteert die geneste opties voor compatibiliteit en negeert ze. Items van een dynamische zone
komen terug in hun opgeslagen volgorde, elk met zijn `__component`.

In GraphQL is een component een objecttype dat naar zijn UID is genoemd (`ComponentSharedSeo`) en
is een dynamische zone een union (`ArticleBlocksDynamicZone`) die je met fragments bevraagt. Zie
[GraphQL-API](/nl/api/graphql/).

## Schrijven

Stuur de hele waarde van het attribuut. Die vervangt wat was opgeslagen:

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

De waarde wordt bij elke schrijfactie tegen het schema van de component gevalideerd: onbekende
sleutels, verkeerde types en een `__component` die de dynamische zone niet toestaat, zijn fouten
met paden zoals `["blocks", 1, "text"]`. `required`-velden in componenten worden gecontroleerd
wanneer het document wordt gepubliceerd, net als velden op het hoogste niveau.

## Filteren

| Wat | Voorbeeld | Opmerkingen |
| --- | --- | --- |
| Velden van een component | `filters[seo][metaTitle][$containsi]=rust` | Scalaire velden, geneste componenten inbegrepen. |
| Velden van een herhaalbare component | `filters[links][url][$contains]=github` | Klopt als een van de items overeenkomt. |
| Dynamische zones | `filters[blocks][__component][$eq]=blocks.quote` | Alleen op `__component`: items van verschillende componenten hebben verschillende velden. |

Je kunt niet sorteren op componentvelden, en `json`-velden in componenten kunnen niet worden
gefilterd. Zie [REST-API](/nl/api/rest/#filters) voor de operatoren.
