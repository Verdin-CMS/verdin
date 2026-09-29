---
title: "Relaties"
description: "Soorten relaties, hoe Verdin documenten via documentId koppelt, volgorde, polymorfe relaties, en wat oneWay en manyWay betekenen binnen componenten."
sidebar:
  order: 3
---

Een relatie koppelt documenten van twee contenttypes, zoals een artikel en zijn categorie. Deze
pagina legt de soorten relaties uit, hoe koppelingen worden opgeslagen en opgelost, en de regels
voor het schrijven, ordenen en lezen ervan. Voor de syntaxis van requests, zie de
[REST-API](/nl/api/rest/#schrijven).

## Soorten

Een relatie is een attribuut met `type: "relation"`, een soort `relation` en een contenttype als
`target`:

| Soort | Een document koppelt aan | Een doel wordt gekoppeld vanuit | Inverse kant |
| --- | --- | --- | --- |
| `oneWay` | één doel | een willekeurig aantal documenten | geen |
| `manyWay` | meerdere doelen | een willekeurig aantal documenten | geen |
| `manyToOne` | één doel | een willekeurig aantal documenten | `oneToMany` |
| `oneToMany` | meerdere doelen | één document | `manyToOne` |
| `oneToOne` | één doel | één document | `oneToOne` |
| `manyToMany` | meerdere doelen | een willekeurig aantal documenten | `manyToMany` |

Het blogvoorbeeld koppelt artikelen aan een categorie (met een inverse kant) en aan tags (zonder):

```json title="schema/content-types/article.json (excerpt)"
"category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
"tags": { "type": "relation", "relation": "manyToMany", "target": "tag" }
```

```json title="schema/content-types/category.json (excerpt)"
"articles": { "type": "relation", "relation": "oneToMany", "target": "article", "mappedBy": "category" }
```

- De kant met `inversedBy` (of met geen van beide sleutels) is de **eigenaarskant**: die slaat de
  koppelingen op en is de kant die je schrijft.
- De kant met `mappedBy` is de **inverse** kant: die leest de koppelingen van de eigenaar in
  omgekeerde richting en is alleen-lezen. Hem schrijven is een validatiefout die het attribuut
  van de eigenaar noemt.
- De twee kanten moeten overeenkomen: `mappedBy` noemt een attribuut van het doel dat met
  `inversedBy` terugwijst, met de bijbehorende inverse soort uit de tabel.
- `oneWay` en `manyWay` hebben nooit een inverse kant.

De contenttype-bouwer maakt het inverse attribuut op het doel voor je aan.

## Gekoppeld per document, niet per rij

Een document heeft meerdere rijen: een concept en een gepubliceerde versie, en van elk één per
locale. Verdin slaat een relatie op als een koppeling van de bron**rij** naar het
doel**document** (zijn `documentId`), in een koppeltabel met de naam `{table}_{field}_lnk`. De
doelrij wordt gekozen wanneer de relatie wordt gelezen:

- Een gepubliceerd artikel ziet de gepubliceerde versie van zijn categorie; zijn concept ziet het
  concept van de categorie. Types zonder concept en publicatie hebben één versie, die elke lezer
  ziet.
- Als het doel ook gelokaliseerd is, lossen leesacties het op in dezelfde locale. Een doeltype
  dat niet gelokaliseerd is, wordt door elke locale gedeeld.
- De publicatie van een categorie ongedaan maken verbergt haar voor gepubliceerde artikelen
  zonder een koppeling aan te raken; haar opnieuw publiceren brengt haar terug.
- Een artikel publiceren kopieert alleen zijn eigen koppelingen naar de gepubliceerde versie.

Strapi koppelt in plaats daarvan rij-id's, dus moet het koppelingen herschrijven telkens als een
concept wordt gepubliceerd. Verdin doet dat nooit, waardoor publiceren één enkele kopie van de
conceptrij blijft.

De integriteit wordt door Verdin bewaakt in plaats van door foreign keys: een document koppelen
dat niet bestaat, is een validatiefout, en een document verwijderen haalt in dezelfde transactie
de koppelingen weg die ernaar wijzen.

### Eén document per doel

Bij `oneToOne` en `oneToMany` hoort een doel bij hoogstens één brondocument. Een doel koppelen
dat een ander document al heeft, **verplaatst** het: de koppeling van het andere document wordt in
dezelfde schrijfactie verwijderd. Dit is het gedrag van Strapi. Het wordt per versie
afgedwongen: een concept en zijn gepubliceerde versie mogen hetzelfde doel hebben.

## Schrijven

Aan de eigenaarskant neemt `data` een `documentId`, een lijst ervan, of een object dat een
wijziging beschrijft:

| Input | Effect |
| --- | --- |
| `"k2m…"` of `{ "documentId": "k2m…" }` | Koppel één doel (to-one-relaties). |
| `["k2m…", "p9x…"]` | Vervang elke koppeling, in deze volgorde. |
| `null` of `[]` | Verwijder elke koppeling. |
| `{ "set": ["k2m…"] }` | Vervang elke koppeling. |
| `{ "connect": [...], "disconnect": [...] }` | Voeg koppelingen toe en verwijder ze, met behoud van de andere. |

Een nieuw doel aan een to-one-relatie koppelen vervangt het vorige. `set` kan niet worden
gecombineerd met `connect` of `disconnect`.

In het beheerpaneel toont een relatieveld de gekoppelde items. **Een item koppelen** (of
**Items koppelen** bij to-many-relaties) opent een dialoog die de items van het doeltype
doorzoekt, over hun tekstvelden, en in de locale van het item als het doel gelokaliseerd is. Kies
één item, of vink er meerdere aan en voeg ze toe; items die al gekoppeld zijn, worden gemarkeerd.

## Volgorde

To-many-relaties behouden de volgorde van hun koppelingen. Een lijst of `set` slaat de volgorde
op die je stuurt. Items van `connect` kunnen zeggen waar ze komen:

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

`position` is `{ "before": documentId }`, `{ "after": documentId }`, `{ "start": true }` of
`{ "end": true }`. Posities worden bij elke schrijfactie opnieuw genummerd. Leesacties geven
gerelateerde documenten in koppelvolgorde terug, tenzij de populate om een `sort` vraagt.

## Lezen

Relaties worden alleen teruggegeven als je ze populeert:

```http
GET /api/articles?populate[category][fields][0]=name&populate[tags][sort]=label:asc
```

Een to-one-relatie is een object of `null`; een to-many-relatie is een array. Elke gepopuleerde
relatie kan eigen `fields`, `filters`, `sort`, `populate` en `count` krijgen, tot vijf niveaus
diep. Elk niveau is één gebundelde query per relatie (`WHERE … IN (…)`), geen join, dus diepe
populates vermenigvuldigen geen rijen. Er worden hoogstens 1.000 gerelateerde documenten per
document en relatie teruggegeven; `count` geeft het exacte aantal.

Je kunt via relaties filteren (`filters[category][name][$eq]=News`), aan beide kanten, en sorteren
op een veld van een to-one-relatie (`sort=category.name:asc`). Populeren, filteren of sorteren via
een relatie naar een type dat de aanroeper niet mag lezen, wordt geweigerd (`populate=*` slaat het
over), zodat relaties nooit content onthullen die de [rechten](/nl/concepts/permissions/) van de
aanroeper verbergen.

## Relaties binnen componenten

Een [component](/nl/concepts/components-and-dynamic-zones/) kan relaties bevatten, maar alleen
`oneWay` en `manyWay`:

```json title="schema/components/shared/related.json"
{
  "displayName": "Related",
  "attributes": {
    "label": { "type": "string" },
    "articles": { "type": "relation", "relation": "manyWay", "target": "article" }
  }
}
```

De JSON van de component slaat de `documentId`s zelf op: een string voor `oneWay`, een array voor
`manyWay`. Daarom zijn de andere soorten daar niet toegestaan:

- Een inverse kant zou de JSON van elk document moeten doorzoeken om te vinden wie ernaar
  koppelt.
- "Eén document per doel" (`oneToOne`, `oneToMany`) kan evenmin zonder zo'n zoekactie worden
  afgedwongen.

Binnen componenten is de volgorde van een `manyWay`-lijst de volgorde van de array. Verwijzingen
worden bij het schrijven gecontroleerd en opgelost wanneer de component wordt gepopuleerd, in de
status en locale van het document; doelen die niet meer bestaan, worden weggelaten. Er kan niet
op worden gefilterd.

## Polymorfe relaties

`morphToOne` en `morphToMany` koppelen documenten van elk contenttype. Hun koppelingen slaan het
type van het doel op naast zijn `documentId`, en schrijfacties noemen beide:

```json
{ "data": { "related": [{ "__type": "api::article", "documentId": "k2m…" }, { "__type": "api::page", "documentId": "p9x…" }] } }
```

Gepopuleerde items zijn de doeldocumenten met hun `__type`, gelezen in de status en locale van het
request. De inverse kanten `morphOne` en `morphMany` noemen het type van de eigenaar (`target`) en
zijn attribuut (`morphBy`), en zijn alleen-lezen. Op polymorfe relaties kan niet worden gefilterd
of gesorteerd, en ze kunnen niet in componenten staan.
