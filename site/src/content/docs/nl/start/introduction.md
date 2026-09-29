---
title: Wat is Verdin
description: Verdin is een open-source headless CMS geschreven in Rust, met content-API's die compatibel zijn met Strapi v5 en een beheerpaneel in één binary.
sidebar:
  order: 1
  label: Introductie
---

Verdin is een open-source headless CMS geschreven in Rust. Je modelleert contenttypes, je
redacteuren schrijven en publiceren in een beheerpaneel, en je sites en apps lezen de content via
een REST- of GraphQL-API. Verdin rendert geen pagina's: dat doet je frontend.

Het is een herschrijving van [Strapi v5](https://strapi.io): het schemaformaat en de content-API
hebben dezelfde vorm, dus een Strapi-project en zijn frontend kunnen met weinig wijzigingen
overstappen.

## Voor wie het is

- **Ontwikkelaars die een site of app bouwen** en een CMS willen dat als één proces draait, het
  contentmodel in git bewaart, en vanuit elke frontend kan worden gelezen: Astro, Next.js, een
  mobiele app.
- **Teams op Strapi** die dezelfde API willen met een kleinere voetafdruk, of functies nodig
  hebben die Strapi voor betaalde abonnementen reserveert. Verdin heeft geen enterprise-editie:
  SSO, auditlogs, reviewworkflows en releases horen bij het open-sourceproject.
- **Redacteuren**, die concepten, publiceren, geschiedenis en voorbeelden krijgen in een
  beheerpaneel dat in 18 talen beschikbaar is.

## Wat er in de doos zit

Eén uitvoerbaar bestand, `verdin`, is de server, de opdrachtregeltool en het beheerpaneel. Er is
in productie geen Node.js-runtime en geen `node_modules`.

| Gebied | Wat je krijgt |
| --- | --- |
| Databases | PostgreSQL 14+, MySQL 8.4+, MariaDB 10.11+ en SQLite, gedekt door dezelfde testsuite. |
| Contentmodel | Collectietypes, enkele types, componenten, dynamische zones, relaties, media, rich text in Markdown of in het blocks-formaat van Strapi. Het schema bestaat uit JSON-bestanden in je project. |
| Schemawijzigingen | Elke wijziging wordt een migratieplan met een risiconiveau en de exacte SQL. Destructieve stappen draaien alleen als je ze toestaat. |
| API's | REST onder `/api` met de parameters van Strapi v5 (`filters`, `populate`, `sort`, `pagination`), een optioneel GraphQL-endpoint, een OpenAPI-document, en een getypeerde TypeScript-client. |
| Bewerken | Concept en publicatie, gelokaliseerde content, contentgeschiedenis, releases, reviewworkflows, opmerkingen en taken, live presence, voorbeeld en visueel bewerken op je eigen site. |
| Toegang | Beheerdersrollen tot op veld- en localeniveau, API-tokens, openbare toegangsrechten, SSO met OpenID Connect, tweefactorlogin met toegangssleutels, auditlogs. |
| Sitefuncties | Full-text-zoeken, sitemap, redirects, menu's en formulieren, webhooks, realtime updates. |
| Uitbreiden | WebAssembly-plugins die inhaken op schrijfacties, routes en jobs toevoegen, en adminwidgets en aangepaste velden meebrengen, beperkt tot de capabilities die ze declareren. |

## Hoe het zich verhoudt tot Strapi v5

**Hetzelfde:**

- Schemabestanden gebruiken het formaat van Strapi: `schema/content-types/<singularName>.json` en
  `schema/components/<category>/<name>.json`.
- De REST-content-API: routes, het platte responseformaat met `documentId`, queryparameters en
  operatoren, de semantiek van schrijfacties (een `POST` of `PUT` publiceert, tenzij je
  `?status=draft` meegeeft), foutbodies.
- Het GraphQL-schema heeft de vorm van de GraphQL-plugin van Strapi v5.
- Eindgebruikers (registreren, inloggen, OAuth, rollen) volgen de API van `users-permissions`.

**Anders:**

- **Schemawijzigingen zijn geplande migraties.** Verdin vergelijkt de schemabestanden met de
  database en toont je de stappen voordat het ze uitvoert. `verdin start` weigert te draaien
  zolang de database achterloopt op het schema.
- **De contenttype-bouwer draait alleen in ontwikkelmodus.** In productie komt het schema uit je
  repository.
- **Plugins zijn WebAssembly, geen JavaScript.** Strapi-plugins, en eigen controllers, services of
  lifecyclebestanden in `src/`, draaien niet in Verdin.
- **De database wordt niet met Strapi gedeeld.** Je haalt een Strapi-project binnen met
  `verdin import strapi`, dat elk document een nieuw id geeft.
- **Een paar extra's via REST**: acties voor publiceren en depubliceren
  (`POST /api/<route>/<documentId>/actions/publish`), en een gepopuleerde component komt volledig
  terug, geneste componenten inbegrepen.

[Compatibiliteit met Strapi](/nl/migrate/compatibility/) somt de verschillen in detail op.

## Wanneer je het niet gebruikt

- **Je bent afhankelijk van Strapi-plugins of eigen servercode in JavaScript.** Verdin kan die niet
  draaien; je zou ze herschrijven als WebAssembly-plugins of de logica ergens anders onderbrengen.
- **Je hebt een stabiele 1.0 nodig.** Verdin staat op 0.10: minor releases kunnen configuratie en
  gedrag nog veranderen. Lees [Upgraden](/nl/migrate/upgrading/) vóór elke release.
- **Je wilt dat het CMS je pagina's rendert.** Verdin is headless; combineer het met een
  frontendframework of een statische sitegenerator.
- **Je wilt een beheerde dienst.** Verdin is self-hosted: je draait de binary of het Docker-image
  op je eigen infrastructuur.

## Waar je verder gaat

- [Quickstart](/nl/start/quickstart/): draai Verdin en lees je eerste item uit de API.
- [Tutorial: een blog met Astro](/nl/start/tutorial-astro/) of
  [met Next.js](/nl/start/tutorial-nextjs/): bouw een frontend tegen de voorbeeldblog.
- [Contentmodel](/nl/concepts/content-model/): contenttypes, velden en hoe ze worden opgeslagen.
- [Een Strapi-project importeren](/nl/migrate/from-strapi/): haal een bestaand project binnen.
