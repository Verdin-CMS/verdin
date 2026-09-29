---
title: "Contentmodel"
description: "Hoe Verdin je content beschrijft: collectie- en enkele types, attributen, schemabestanden in het formaat van Strapi, en validatieregels."
sidebar:
  order: 1
---

Het contentmodel is de verzameling contenttypes en componenten die je project definieert. Verdin
leidt al het andere ervan af: de databasetabellen, de REST- en GraphQL-API's, het
OpenAPI-document, de validatie en de formulieren van het beheerpaneel. Deze pagina legt de
onderdelen uit en de regels die ervoor gelden.

## Contenttypes

Een contenttype beschrijft één soort document, zoals een artikel of een homepage. Het heeft een
`kind`:

| Soort | Bevat | REST-routes (blogvoorbeeld) |
| --- | --- | --- |
| `collectionType` | Een willekeurig aantal documenten | `/api/articles`, `/api/articles/{documentId}` |
| `singleType` | Hoogstens één document | `/api/homepage` |

Collectietypes worden geserveerd op hun `pluralName`, enkele types op hun `singularName`. De
eerste `PUT` naar een enkel type maakt het document aan. Zie de [REST-API](/nl/api/rest/) voor
elke route.

Elk contenttype heeft een UID, `api::<singularName>` (`api::article`). Strapi schrijft dezelfde
UID als `api::article.article`; Verdin accepteert die vorm in schemabestanden en in de importer,
en normaliseert hem naar `api::article`.

Elk document heeft systeemvelden die je niet declareert: `id`, `documentId` (een ULID van
26 kleine letters en cijfers, stabiel over concepten, gepubliceerde versies en locales heen),
`createdAt`, `updatedAt`, `publishedAt`, en `locale` bij
[gelokaliseerde types](/nl/concepts/internationalization/).

## Schemabestanden

Contenttypes en componenten zijn JSON-bestanden in de map `schema/` van je project
(`[schema].path` in `verdin.toml`). Je versioneert ze in git, net als code.

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

Het formaat is de `schema.json` van Strapi, dus de meeste Strapi-schema's laden ongewijzigd. Dit
is het artikeltype van het [blogvoorbeeld](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog):

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

| Sleutel | Verplicht | Beschrijving |
| --- | --- | --- |
| `kind` | ja | `collectionType` of `singleType`. |
| `singularName` | ja | Kebab-case. Moet overeenkomen met de bestandsnaam (`article.json`). |
| `pluralName` | ja | Kebab-case, anders dan `singularName`. |
| `displayName` | ja | De naam die het beheerpaneel toont. |
| `description` | nee | Getoond in het beheerpaneel. |
| `collectionName` | nee | Tabelnaam. Standaard de `pluralName` in snake_case. |
| `options.draftAndPublish` | nee | Houd van elk document een concept en een gepubliceerde versie bij. Standaard `false`. Zie [Concept en publicatie](/nl/concepts/draft-and-publish/). |
| `pluginOptions.i18n.localized` | nee | Eén versie per locale. Standaard `false`. Zie [Internationalisatie](/nl/concepts/internationalization/). |
| `attributes` | nee | De velden, in de volgorde waarin de API ze teruggeeft. |
| `validations` | nee | Regels over meerdere velden; zie [hieronder](#validaties-over-meerdere-velden). |

Schema's zijn strikt: een onbekende sleutel, een optie die een type niet ondersteunt, of een
verwijzing naar een ontbrekend type of component is een fout die het bestand en het pad noemt, en
de server start niet. Draai `verdin schema check` om de bestanden te valideren zonder hem te
starten.

Sommige namen zijn bezet:

- Attribuutnamen beginnen met een letter, gevolgd door letters, cijfers en underscores,
  hoogstens 50 tekens. Ze worden kolommen in snake_case (`metaTitle` → `meta_title`).
- `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`,
  `updatedAt`, `createdBy` en `updatedBy` zijn gereserveerd op contenttypes, en `id` binnen
  componenten.
- `upload`, `uploads`, `auth`, `users` en `connect` kunnen geen `singularName` of `pluralName`
  zijn: die routes horen bij de API.
- Een contenttype heeft hoogstens 60 attributen van het type `string`, `email`, `uid` en
  `enumeration`, zodat rijen binnen de maximale rijgrootte van MySQL blijven. Gebruik voor
  sommige ervan `text`.

Je bewerkt de bestanden in de **Contenttype-bouwer** van het beheerpaneel, beschikbaar zolang de
server met `verdin dev` draait, of met de hand. Hoe dan ook wordt een wijziging een
[schemamigratie](/nl/concepts/schema-migrations/). De lay-out van de editor (veldvolgorde,
breedtes, labels) hoort niet bij het schema: beheerders stellen die in het paneel in, en hij
wordt in de database opgeslagen.

## Componenten

Een component is een herbruikbare groep velden, zoals `shared.seo` (een metatitel en een
metabeschrijving). Zijn UID is `<category>.<name>`, afgeleid van zijn pad:
`schema/components/shared/seo.json` is `shared.seo`. Een componentbestand heeft `displayName`,
optioneel `description` en `icon`, en `attributes`.

Een dynamische zone is een lijst die meerdere componenten mengt, zoals de body van een artikel
die uit hero- en citaatblokken bestaat. Beide worden als JSON in het document opgeslagen; zie
[Componenten en dynamische zones](/nl/concepts/components-and-dynamic-zones/).

## Attributen

Elk attribuut heeft een `type` en opties die daarvan afhangen. De volledige lijst van types, hun
opties en hun kolomtypes per database staat in de
[referentie van attribuuttypes](/nl/reference/attribute-types/).

| Categorie | Types |
| --- | --- |
| Tekst | `string`, `text`, `richtext` (Markdown), `blocks` (de gestructureerde rich text van Strapi), `email`, `uid`, `password`, `enumeration` |
| Getallen | `integer`, `biginteger`, `float`, `decimal` |
| Datums | `date`, `time`, `datetime` |
| Andere scalairen | `boolean`, `json` |
| Koppelingen | `relation` (zie [Relaties](/nl/concepts/relations/)), `media` (zie [Media](/nl/concepts/media/)) |
| Structuur | `component`, `dynamiczone` |

Veelgebruikte opties:

| Optie | Effect |
| --- | --- |
| `required` | De waarde moet zijn ingesteld wanneer een versie wordt gepubliceerd (of bij elke schrijfactie, voor types zonder concept en publicatie). Concepten mogen onvolledig zijn. |
| `private` | Wordt nooit teruggegeven, gefilterd, gesorteerd of gepopuleerd door de content-API. `password`-attributen zijn altijd privé. |
| `default` | Waarde die wordt gebruikt als een nieuw document het veld weglaat. Wordt gecontroleerd tegen de eigen regels van het attribuut. |
| `unique` | Geen twee documenten mogen de waarde delen, per locale en versie. Beschikbaar op `string`, `email`, getal-, datum- en tijdtypes; `uid` is altijd uniek. |
| `configurable` | `false` vergrendelt het attribuut in de contenttype-bouwer: het kan daar niet worden bewerkt, hernoemd of verwijderd. |
| `pluginOptions.i18n.localized` | `false` deelt de waarde over alle locales. |

Elke attribuutkolom is in de database nullable. Net als in Strapi v5 dwingt Verdin `required` af
bij het publiceren, niet met een `NOT NULL`-constraint, dus een verplicht attribuut toevoegen aan
een type dat al rijen heeft, is een veilige wijziging.

## Validatie

Elke schrijfactie wordt tegen het schema gecontroleerd voordat er iets de database bereikt:

- **Types en beperkingen**, bij elke schrijfactie: waardetypes, `minLength`/`maxLength`,
  `min`/`max`, `regex`, `enum`-waarden, het aantal items in herhaalbare componenten en dynamische
  zones, de componenttypes die een dynamische zone toestaat, en de bestandstypes die een
  mediaveld accepteert. Onbekende sleutels en systeemvelden in de input zijn fouten.
- **Verplichte velden en regels over meerdere velden**, wanneer een versie wordt gepubliceerd, en
  bij elke schrijfactie naar types zonder concept en publicatie. Ze gelden ook binnen componenten
  en dynamische zones.
- **Uniciteit**, via unieke indexen in de database, zodat twee gelijktijdige schrijfacties niet
  allebei kunnen slagen.

Een mislukte controle antwoordt met `400` en een `ValidationError` waarvan `details.errors` elk
probleem met zijn pad opsomt, zoals `["seo", "metaTitle"]` of `["blocks", 2, "text"]`. Zie
[Fouten](/nl/api/rest/#fouten).

### Validaties over meerdere velden

Een contenttype kan regels declareren die zijn eigen velden vergelijken, geschreven in
[JSON Logic](https://jsonlogic.com). Dit eventtype eist dat de einddatum na de begindatum komt,
en begrenst het aantal verkochte tickets op het aantal plaatsen:

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

- Een regel die niet klopt, is een validatiefout met `message`, op `field` als dat is opgegeven,
  of op het document (`path: []`).
- Regels draaien wanneer `required` dat doet: bij publiceren, en bij elke schrijfactie naar types
  zonder concept en publicatie. Concepten mogen ze breken.
- `var` leest de eigen velden van het document, met paden met punten naar componenten.
  Relaties en media zijn niet beschikbaar voor regels.
- Vergelijkingen zijn numeriek als beide kanten getallen zijn en tekstueel als beide strings
  zijn, dus ISO-datums, -tijden en -datetimes worden correct vergeleken. Een leeg veld is
  `null`: bescherm optionele velden, zoals de eerste regel doet.
- Toegestane operatoren: `var`, `==`, `!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`, `and`,
  `or`, `in`, `if`, `?:`, `+`, `-`, `*`, `/`, `%`, `min`, `max`, `cat`. Een onbekende operator,
  een onbekend `field` of een lege `message` is een schemafout.

De server controleert de regels; het beheerpaneel toont hun berichten bij de velden die ze
noemen wanneer publiceren mislukt. Strapi heeft geen equivalent. De voorwaardelijke velden van
Strapi (`conditions`) worden in schemabestanden geaccepteerd en bewaard, maar nog niet toegepast.
