---
title: Referentie van attribuuttypes
description: Elk attribuuttype van een Verdin-schemabestand, met zijn opties, validaties, opslag in de database en weergave in de API.
sidebar:
  order: 4
  label: Attribuuttypes
---

<!-- Written from crates/verdin-schema (convert.rs, validate.rs, model.rs),
crates/verdin-migrate/src/derive.rs and sql.rs (storage), and crates/verdin-content
(input.rs, output.rs, blocks.rs) (API). -->

Attributen zijn de velden van een contenttype of component, gedeclareerd onder `attributes` in
het schemabestand ervan. Deze pagina somt elk `type` op, de opties die het accepteert, hoe Verdin
het valideert en opslaat, en hoe het er in de API uitziet. Het formaat is dat van Strapi v5; de
verschillen staan [aan het einde](#verschillen-met-strapi).

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

Schemabestanden zijn strikt: een onbekende sleutel, of een optie die het type niet accepteert, is
een fout die `verdin schema check` met zijn pad meldt (`attributes.title.maxLength`).

## Opties die elk attribuut accepteert

| Optie | Standaard | Beschrijving |
| --- | --- | --- |
| `type` | verplicht | Een van de types hieronder. |
| `required` | `false` | Er moet een waarde aanwezig zijn. Gecontroleerd wanneer een item wordt gepubliceerd (concepten mogen onvolledig zijn), en bij elke schrijfactie van een type zonder concept en publicatie. Geldt ook binnen componenten en dynamische zones. |
| `private` | `false` | Wordt nooit door de content-API teruggegeven, en is niet bruikbaar in `filters` of `sort`. `password`-attributen zijn altijd privé. |
| `configurable` | `true` | De vlag van Strapi voor de bouwer in het beheerpaneel; bewaard zoals geschreven. |
| `pluginOptions.i18n.localized` | `true` | In een gelokaliseerd contenttype deelt `false` de waarde over de locales in plaats van één waarde per locale. |
| `customField` | niet ingesteld | `plugin::<plugin>.<field>` (of `global::<field>`): het beheerpaneel bewerkt het attribuut met een aangepast veld van een plugin. Het `type` bepaalt hoe de waarde wordt opgeslagen. Zie [Plugins](/nl/extending/plugins/). |
| `conditions` | niet ingesteld | De voorwaardelijke velden van Strapi (`{ "visible": <JSON Logic> }`). De editor verbergt het veld zolang de regel onwaar is, en de server vereist een verborgen veld niet. |
| `default` | niet ingesteld | Waarde van nieuwe items als de schrijfactie het attribuut weglaat. Moet geldig zijn voor het type. Niet elk type accepteert er een (zie elk type). |

Attribuutnamen beginnen met een letter, gevolgd door letters, cijfers en `_`, hoogstens 50
tekens. Op contenttypes zijn `id`, `documentId`, `locale`, `publicationState`, `publishedAt`,
`createdAt`, `updatedAt`, `createdBy` en `updatedBy` gereserveerd; op componenten `id`. Twee namen
die op dezelfde kolom uitkomen (`metaTitle` en `meta_title`), zijn een fout.

### Waar waarden worden opgeslagen

Elk attribuut van een contenttype is een kolom van de tabel van het type (`collectionName`, of de
meervoudsnaam), genoemd in `snake_case`. Relaties en media staan in plaats daarvan in
koppeltabellen. Een concept en zijn gepubliceerde versie zijn twee rijen, één per locale bij
gelokaliseerde types.

Kolomtypes per database:

| Kolom | PostgreSQL | MySQL en MariaDB | SQLite |
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

Een contenttype mag hoogstens 60 attributen van het type `string`, `email`, `uid` en
`enumeration` hebben (de rijgroottelimiet van MySQL); gebruik `text` voor meer.

### `unique`

Types die `unique: true` accepteren, krijgen een unieke index op
`(column, locale, publication_state)`: twee gepubliceerde items, of twee concepten, in dezelfde
locale kunnen geen waarde delen, terwijl een concept en zijn eigen gepubliceerde versie dat wel
kunnen. Een schrijfactie die dat breekt, mislukt met een validatiefout op het attribuut. Binnen
componenten wordt `unique` geaccepteerd maar niet afgedwongen (componentwaarden worden als JSON
opgeslagen).

## Tekst

### `string`

Eén regel tekst.

| Optie | Beschrijving |
| --- | --- |
| `minLength`, `maxLength` | Lengtegrenzen in tekens. `maxLength` is hoogstens 255. |
| `regex` | Een patroon waaraan de waarde moet voldoen. Syntaxis zoals in JavaScript, inclusief look-around en backreferences. |
| `unique` | Zie [`unique`](#unique). |
| `default` | Een string binnen de grenzen die aan `regex` voldoet. |

Opgeslagen als `varchar(255)`. API: een string.

### `text`

Langere platte tekst (een textarea in het beheerpaneel).

| Optie | Beschrijving |
| --- | --- |
| `minLength`, `maxLength` | Lengtegrenzen, zonder bovengrens. |
| `default` | Een string binnen de grenzen. |

Opgeslagen als `text` (`longtext` op MySQL). API: een string.

### `richtext`

Markdown-tekst. Dezelfde opties, opslag en API als `text`; het beheerpaneel bewerkt het met de
Markdown-editor.

### `blocks`

Rich text als de blocks-JSON van Strapi: een lijst van blokken `paragraph`, `heading` (`level` 1 tot
6), `list` (`format` `ordered` of `unordered`, met kinderen `list-item`, tot 8 niveaus genest),
`quote`, `code` (optioneel `language`) en `image`. Inline-kinderen zijn nodes `text`, met de
markeringen `bold`, `italic`, `underline`, `strikethrough` en `code`, en nodes `link`. Hoogstens
10.000 blokken.

Geen opties, geen `default`. Opgeslagen als JSON. API: de lijst blokken, zoals geschreven.

```json
[
  { "type": "heading", "level": 2, "children": [{ "type": "text", "text": "Hello" }] },
  { "type": "paragraph", "children": [{ "type": "text", "text": "bold", "bold": true }] }
]
```

### `email`

Een e-mailadres (`name@domain.tld`, zonder spaties).

| Optie | Beschrijving |
| --- | --- |
| `minLength`, `maxLength` | Lengtegrenzen; `maxLength` hoogstens 255. |
| `unique` | Zie [`unique`](#unique). |
| `default` | Een e-mailadres. |

Opgeslagen als `varchar(255)`. API: een string.

### `password`

Een geheim, bij het schrijven gehasht met Argon2id.

| Optie | Beschrijving |
| --- | --- |
| `minLength`, `maxLength` | Lengtegrenzen van het wachtwoord zoals verzonden. |

Geen `default`. Altijd privé: nooit teruggegeven, gefilterd of gesorteerd. Niet toegestaan binnen
componenten. Opgeslagen als `varchar(255)` (de hash). Imports behouden bestaande bcrypt- en
Argon2-hashes zoals ze zijn, zodat geïmporteerde accounts nog steeds kunnen inloggen.

### `uid`

Een identifier voor URL's, zoals een slug. Het beheerpaneel genereert hem uit `targetField`.

| Optie | Beschrijving |
| --- | --- |
| `targetField` | Een attribuut `string` of `text` van hetzelfde type om de waarde uit te genereren. |
| `minLength`, `maxLength` | Lengtegrenzen; `maxLength` hoogstens 255. |
| `regex` | Het patroon waaraan waarden moeten voldoen; zonder deze optie `^[A-Za-z0-9\-_.~]*$`. |
| `default` | Een geldige waarde. |

Altijd uniek (zie [`unique`](#unique)). Opgeslagen als `varchar(255)`. API: een string.

### `enumeration`

Eén waarde uit een vaste lijst.

| Optie | Beschrijving |
| --- | --- |
| `enum` | De waarden: minstens één, elk 1 tot 255 tekens, geen duplicaten. |
| `default` | Een van de waarden. |

Opgeslagen als `varchar(255)`. API: een string. Schrijfacties met een andere waarde mislukken.

## Getallen

### `integer`

Een 32-bits geheel getal (−2.147.483.648 tot 2.147.483.647).

| Optie | Beschrijving |
| --- | --- |
| `min`, `max` | Grenzen (gehele getallen). |
| `unique` | Zie [`unique`](#unique). |
| `default` | Een geheel getal binnen de grenzen. |

Opgeslagen als `integer`. API: een getal. Schrijfacties accepteren getallen en strings met een
geheel getal.

### `biginteger`

Een 64-bits geheel getal. Dezelfde opties als `integer`.

Opgeslagen als `bigint`. API: een string (`"9007199254740993"`), zoals in Strapi, omdat
JavaScript-getallen boven 2⁵³ precisie verliezen. Schrijfacties accepteren strings en getallen.

### `float`

Een drijvendekommagetal met dubbele precisie. Dezelfde opties als `integer`, met getallen als
grenzen.

Opgeslagen als `double precision` (`double`, `real`). API: een getal.

### `decimal`

Een exact decimaal getal.

| Optie | Standaard | Beschrijving |
| --- | --- | --- |
| `precision` | `10` | Totaal aantal cijfers, 1 tot 38. |
| `scale` | `2` | Cijfers na de komma, hoogstens `precision`. |
| `min`, `max` | | Grenzen. |
| `unique` | | Zie [`unique`](#unique). |
| `default` | | Een getal binnen de grenzen. |

Waarden worden afgerond op `scale` cijfers (half van nul af, zoals de databases doen), en geweigerd
als ze meer dan `precision - scale` cijfers vóór de komma hebben. Schrijfacties accepteren getallen
en numerieke strings. Opgeslagen als `numeric(precision,scale)` (`text` op SQLite, zodat er niets
wordt afgerond). API: een getal, zoals Strapi het teruggeeft. Hele waarden zijn gehele getallen
(`25`, niet `25.0`) en andere zijn de kortste float die hetzelfde terugleest (`12.5`). Met
[`[api].decimal_as_string`](/nl/reference/configuration/) geeft de API in plaats daarvan een
exacte string terug.

## Datums en booleans

### `boolean`

`true` of `false`. Accepteert `default`. Opgeslagen als `boolean` (`tinyint(1)`, `integer`). API:
een boolean.

### `date`

Een kalenderdatum, `YYYY-MM-DD`. Accepteert `unique` en `default`. Opgeslagen als `date`. API:
`"2026-09-29"`.

### `time`

Een tijdstip op de dag, `HH:MM`, `HH:MM:SS` of `HH:MM:SS.mmm`. Accepteert `unique` en `default`.
Opgeslagen met millisecondeprecisie. API: `"14:30:00.000"`.

### `datetime`

Een moment in de tijd: een ISO 8601-tijdstempel met een zone (`Z` of `+02:00`). Accepteert
`unique` en `default`. Opgeslagen in UTC met millisecondeprecisie. API:
`"2026-09-29T12:30:00.000Z"`.

## `json`

Elke JSON-waarde. Accepteert `default` (willekeurige JSON). Opgeslagen als `jsonb` (`json`,
`text`). API: de waarde zoals geschreven. In `filters` ondersteunen JSON-attributen alleen `$null`
en `$notNull`, en er kan niet op worden gesorteerd.

## Media

### `media`

Bestanden uit de mediabibliotheek.

| Optie | Standaard | Beschrijving |
| --- | --- | --- |
| `multiple` | `false` | Bevat een lijst bestanden in plaats van één. |
| `allowedTypes` | alle | Soorten bestanden: `images`, `videos`, `audios`, `files` (al het andere). |

Geen `default`. Opgeslagen in een koppeltabel `{table}_{attribute}_mda`, op volgorde.
Schrijfacties nemen bestands-id's: `12`, `{ "id": 12 }`, een lijst ervan, of `null`. API: alleen
met `populate`; een bestandsobject (`url`, `mime`, `width`, `formats`…, zoals in Strapi), een lijst
ervan, of `null`. Zie [Media](/nl/concepts/media/).

## Relaties

### `relation`

Koppelingen naar documenten van een ander contenttype.

| Optie | Beschrijving |
| --- | --- |
| `relation` | `oneToOne`, `oneToMany`, `manyToOne`, `manyToMany`, `oneWay`, `manyWay`, of een polymorfe soort (hieronder). |
| `target` | Het doelcontenttype: `article`, `api::article` of `api::article.article`. |
| `inversedBy` | Aan de eigenaarskant van een relatie in twee richtingen: het attribuut van het doel dat haar spiegelt. |
| `mappedBy` | Aan de andere kant: het eigenaarsattribuut van het doel. |

De twee kanten van een relatie in twee richtingen moeten overeenkomen: `oneToMany` spiegelt
`manyToOne`, `oneToOne` en `manyToMany` spiegelen zichzelf, en de kant met `mappedBy` noemt een
attribuut waarvan de `inversedBy` terugwijst. `oneWay` en `manyWay` hebben geen andere kant.

Koppelingen worden opgeslagen in `{table}_{attribute}_lnk` aan de eigenaarskant (de kant zonder
`mappedBy`), wijzend naar de `documentId` van het doel, op volgorde. Schrijfacties nemen
`documentId`s:

| Schrijfactie | Betekenis |
| --- | --- |
| `"d8f3…"`, `{ "documentId": "d8f3…" }`, een lijst ervan | Vervang de koppelingen. |
| `null` of `[]` | Verwijder elke koppeling. |
| `{ "set": [...] }` | Vervang de koppelingen. |
| `{ "connect": [...], "disconnect": [...] }` | Voeg koppelingen toe en verwijder ze. Een item van `connect` kan `position` bevatten: `{ "before": id }`, `{ "after": id }`, `{ "start": true }` of `{ "end": true }`. |

API: alleen met `populate`, als de gerelateerde documenten (hoogstens 1.000 per item en relatie),
of `{ "count": n }` met `populate[tags][count]=true`. Zie [Relaties](/nl/concepts/relations/).

Binnen componenten zijn alleen `oneWay` en `manyWay` toegestaan; de component slaat de
`documentId`s op.

### Polymorfe relaties

`relation` accepteert ook de polymorfe soorten, die documenten van elk contenttype koppelen:

| `relation` | Opties | Beschrijving |
| --- | --- | --- |
| `morphToOne` | geen | Koppelt één document van elk type. |
| `morphToMany` | geen | Koppelt documenten van alle types. |
| `morphOne` | `target`, `morphBy` | Inverse kant: leest de koppelingen van het attribuut `morphBy` (`morphToOne` of `morphToMany`) van `target`. |
| `morphMany` | `target`, `morphBy` | Idem, voor meerdere. |

Eigenaars slaan paren `(type, documentId)` op in `{table}_{attribute}_mph`. Schrijfacties nemen
items `{ "__type": "api::article", "documentId": "…" }` (één, een lijst, `null` of
`{ "set": [...] }`). Gepopuleerde items dragen hun type in `__type`. Niet toegestaan binnen
componenten.

## Componenten en dynamische zones

### `component`

Een groep velden, gedefinieerd in `schema/components/<category>/<name>.json`.

| Optie | Standaard | Beschrijving |
| --- | --- | --- |
| `component` | verplicht | De uid van de component, `category.name` (`shared.seo`). |
| `repeatable` | `false` | Bevat een lijst items in plaats van één. |
| `min`, `max` | | Aantal items; alleen met `repeatable`. |

Geen `default`: nieuwe items krijgen de standaardwaarden van hun eigen attributen. Opgeslagen als
JSON in de rij van het item, elk item met een `id`. Schrijfacties nemen het itemobject (of een
lijst), met `id` om een bestaand item te behouden. API: alleen met `populate`, het hele item of de
hele lijst. In `filters` kun je filteren op de velden van een component
(`filters[seo][metaTitle][$eq]=…`). Zie
[Componenten en dynamische zones](/nl/concepts/components-and-dynamic-zones/).

### `dynamiczone`

Een lijst items, elk een van meerdere componenten.

| Optie | Beschrijving |
| --- | --- |
| `components` | De toegestane uid's van componenten: minstens één, geen duplicaten. |
| `min`, `max` | Aantal items. |

Elk item draagt `__component` met zijn uid. Opgeslagen als JSON in de rij van het item. API:
alleen met `populate`, de hele lijst. Filter op component met
`filters[blocks][__component][$eq]=blocks.hero`. Dynamische zones kunnen niet binnen componenten
worden genest.

## Validaties over meerdere velden

Naast de opties per attribuut kan een contenttype in `validations` regels over meerdere velden
declareren, die worden gecontroleerd wanneer `required` dat wordt:

```json
"validations": [
  {
    "rule": { "<=": [{ "var": "startDate" }, { "var": "endDate" }] },
    "message": "The end date must be after the start date",
    "field": "endDate"
  }
]
```

`rule` is een JSON Logic-expressie over het item die moet kloppen. Ze mag `var`, `==`, `!=`,
`===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`, `and`, `or`, `in`, `if`, `?:`, `+`, `-`, `*`, `/`,
`%`, `min`, `max` en `cat` gebruiken. `message` wordt gemeld op `field` (een attribuut van het
type) of op het item. Dit is een toevoeging van Verdin; Strapi heeft geen equivalent.

## Verschillen met Strapi

- **Componenten worden als JSON opgeslagen** in de rij van het item, niet in componenttabellen met
  jointabellen. Leesacties hebben geen joins nodig; als gevolg daarvan kunnen `password`-attributen,
  polymorfe relaties en relaties in twee richtingen niet in componenten staan, en wordt `unique`
  daar niet afgedwongen.
- **Gepopuleerde componenten komen volledig terug.** `populate` op een component of dynamische zone
  geeft alle velden ervan terug; je kunt niet zoals in Strapi geneste velden kiezen.
- **Strikte schemabestanden.** Onbekende sleutels en opties die een type niet accepteert, zijn
  fouten, waar Strapi ze negeert. In `pluginOptions` wordt alleen `i18n.localized` gelezen; de rest
  wordt genegeerd.
- **`string`, `email` en `uid` zijn begrensd op 255 tekens**, de kolomgrootte, in plaats van in de
  database te falen.
- **`conditions`** (voorwaardelijke velden) werken zoals in Strapi 5.17: verborgen velden zijn niet verplicht.
- **`validations`** zijn een eigen functie van Verdin.
- De rest komt overeen met Strapi v5: de typenamen, hun opties, waarden van `biginteger` als
  strings, schrijfacties op relaties met `connect`, `disconnect`, `set` en `position`, en het
  blocks-formaat.
