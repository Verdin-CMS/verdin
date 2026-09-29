---
title: "Internationalisatie"
description: "Hoe Verdin één versie van een document per locale bijhoudt, welke velden gelokaliseerd of gedeeld zijn, en hoe de API's een locale kiezen."
sidebar:
  order: 5
---

Internationalisatie (i18n) bewaart de content van een document in meerdere talen. Deze pagina
legt het model uit: locales, gelokaliseerde en gedeelde velden, en hoe lees- en schrijfacties
een locale kiezen. Voor de werkwijze van redacteuren, zie
[Content lokaliseren](/nl/guides/content/localizing-content/).

## Locales

De locales van het project staan in **Instellingen → Internationalisatie** (recht
`locales.manage`). Bij de eerste start wordt Engels (`en`) als standaardlocale toegevoegd.

- Eén locale is altijd de standaard. Requests die geen locale noemen, gebruiken die, en hij kan
  niet worden verwijderd.
- Codes zijn een taal van twee of drie kleine letters, eventueel gevolgd door subtags:
  `en`, `fr`, `pt-BR`, `zh-Hans`.

:::caution
Een locale verwijderen verwijdert ook elke versie die erin is geschreven.
:::

## Gelokaliseerde contenttypes

Een contenttype is gelokaliseerd als zijn schema dat zegt. Elk document heeft dan één versie per
locale, en die delen allemaal het `documentId`:

```json title="schema/content-types/article.json (excerpt)"
{
  "kind": "collectionType",
  "singularName": "article",
  "pluralName": "articles",
  "displayName": "Article",
  "options": { "draftAndPublish": true },
  "pluginOptions": { "i18n": { "localized": true } },
  "attributes": {
    "title": { "type": "string", "required": true },
    "readingTime": { "type": "integer", "pluginOptions": { "i18n": { "localized": false } } }
  }
}
```

Met [concept en publicatie](/nl/concepts/draft-and-publish/) heeft elke locale een eigen concept
en gepubliceerde versie, dus een Franse vertaling kan vóór of na de Engelse tekst worden
gepubliceerd. Types zonder `pluginOptions.i18n.localized` zijn niet gelokaliseerd en negeren
`locale`-parameters.

## Wat is gelokaliseerd

In een gelokaliseerd type is elk attribuut gelokaliseerd, tenzij het
`"pluginOptions": { "i18n": { "localized": false } }` zegt. Zo'n **gedeeld** veld heeft één
waarde voor het hele document:

- Een gedeeld veld in één locale opslaan, schrijft het naar de concepten van elke locale.
- Een locale publiceren kopieert zijn gedeelde velden naar de gepubliceerde versies van de andere
  locales.
- Dit geldt ook voor relaties en media: een gedeelde relatie koppelt in elke locale dezelfde
  documenten.

Systeemvelden volgen de versie: elke locale heeft zijn eigen `createdAt`, `updatedAt` en
`publishedAt`. Waarden van `unique` en `uid` zijn uniek per locale, dus twee vertalingen mogen een
slug delen.

## Relaties tussen gelokaliseerde types

Relaties koppelen documenten, geen versies (zie
[Relaties](/nl/concepts/relations/#gekoppeld-per-document-niet-per-rij)), dus de locale wordt bij
het lezen gekozen:

- Als beide types gelokaliseerd zijn, toont het Franse artikel de Franse versie van zijn
  categorie. Filters via de relatie vergelijken in dezelfde locale.
- Als het doeltype niet gelokaliseerd is, ziet elke locale hetzelfde doel.

## Een locale kiezen in de API's

REST en de admin-API nemen `locale` als queryparameter, in het formaat van Strapi v5; GraphQL
neemt een argument `locale`:

```http
GET /api/articles?locale=fr
PUT /api/articles/{documentId}?locale=fr
DELETE /api/articles/{documentId}?locale=fr
```

```graphql
query {
  articles(locale: "fr") {
    documentId
    title
  }
}
```

- Zonder `locale` lezen en schrijven requests de standaardlocale.
- Een `PUT` in een locale die het document nog niet heeft, maakt die versie aan.
- Een `DELETE` verwijdert alleen de versie in de gevraagde locale. Koppelingen die naar het
  document wijzen, worden verwijderd zodra er geen locale meer over is.
- REST-responses van gelokaliseerde types bevatten `locale`. Een onbekende locale is een fout
  `400`.
- Webhook-payloads, realtime-events en de contentgeschiedenis leggen de locale vast van de versie
  die is gewijzigd.

## Rechten per locale

Beheerdersrollen kunnen contentrechten beperken tot bepaalde locales, zodat een Franse redacteur
alleen Franse versies kan lezen of wijzigen. Zie
[Rechten](/nl/concepts/permissions/#rechten-per-veld-en-locale). De grants van de content-API
(openbare toegang, API-tokens, eindgebruikersrollen) gelden voor elke locale.

## Vergeleken met Strapi

Het model en de parameters komen overeen met de i18n van Strapi v5: gelokaliseerde types, velden
met `localized: false`, `?locale=` en de standaardlocale. In Verdin hoort i18n bij de kern en
staat het altijd aan: je zet het per contenttype aan in het schema.
