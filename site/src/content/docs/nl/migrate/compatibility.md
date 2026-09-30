---
title: Compatibiliteit met Strapi
description: Welke functies en API's van Strapi v5 Verdin ondersteunt, gedeeltelijk ondersteunt of niet ondersteunt — REST, GraphQL, gebruikers en rechten, uploads, i18n, concept en publicatie, code-extensies, het beheerpaneel en Enterprise-functies.
sidebar:
  order: 3
---

Verdin behoudt het contentmodel en de content-API's van Strapi v5, zodat frontends en content
kunnen overstappen (zie [Migreren vanaf Strapi](/nl/migrate/from-strapi/)). Het is geen drop-in
vervanging voor een Strapi-*codebase*: er is geen JavaScript-runtime, dus eigen code wordt opnieuw
gebouwd als WebAssembly-plugins. Deze pagina somt elk gebied op met zijn status, zoals in
Verdin 0.10.0.

**Ondersteund** werkt zoals in Strapi v5 (verschillen vermeld). **Gedeeltelijk** dekt de
gebruikelijke gevallen; de opmerking zegt wat er ontbreekt. **Niet ondersteund** heeft geen
equivalent.

## Contentmodel

| Functie | Status | Opmerkingen |
| --- | --- | --- |
| Collectietypes en enkele types | Ondersteund | JSON-schemabestanden die dicht bij die van Strapi liggen (`schema/content-types/*.json`). Zie [Contentmodel](/nl/concepts/content-model/). |
| Scalaire attribuuttypes | Ondersteund | `string`, `text`, `richtext` (Markdown), `blocks`, `email`, `uid`, `integer`, `biginteger`, `float`, `decimal`, `boolean`, `date`, `time`, `datetime`, `enumeration`, `json`, `password`. `timestamp` van Strapi wordt geïmporteerd als `datetime`. |
| Componenten en dynamische zones | Ondersteund | Inclusief media en relaties `oneWay`/`manyWay` in componenten. |
| Relaties | Ondersteund | One/many-to-one/many, one-way en many-way, en de polymorfe `morphToOne`, `morphToMany`, `morphOne`, `morphMany`. |
| Mediavelden | Ondersteund | Enkel of meervoudig, `allowedTypes`. |
| `unique` | Gedeeltelijk | Niet op attributen van het type `text`, `richtext`, `blocks` en `json`. |
| Voorwaardelijke velden (`conditions`) | Ondersteund | De JSON Logic-voorwaarden van Strapi 5.17; verborgen velden zijn niet verplicht. |
| Aangepaste velden | Gedeeltelijk | `customField`-attributen werken; het invoerveld in het beheerpaneel komt uit een Verdin-[plugin](/nl/extending/plugins/), niet uit de React-plugins van Strapi. |
| Contenttype-bouwer | Ondersteund | Alleen in de ontwikkelmodus (`verdin dev`), zoals in Strapi. |

## REST-API

| Functie | Status | Opmerkingen |
| --- | --- | --- |
| CRUD-routes | Ondersteund | `GET`/`POST /api/{pluralName}`, `GET`/`PUT`/`DELETE /api/{pluralName}/{documentId}`, enkele types op `/api/{singularName}`. Responses bevatten `data` en `meta`, fouten het object `error` van Strapi. |
| `filters` | Ondersteund | Elke operator van Strapi: `$eq`, `$eqi`, `$ne`, `$nei`, `$lt`, `$lte`, `$gt`, `$gte`, `$in`, `$notIn`, `$contains`, `$notContains`, `$containsi`, `$notContainsi`, `$null`, `$notNull`, `$between`, `$startsWith(i)`, `$endsWith(i)`, `$and`, `$or`, `$not`; via relaties, componenten, herhaalbare componenten en dynamische zones (`__component`). |
| `sort` | Ondersteund | Meerdere velden, `:asc`/`:desc`, en een veld van een to-one-relatie (`author.name:asc`). |
| `pagination` | Ondersteund | `page`/`pageSize` of `start`/`limit`, `withCount`. `pageSize` is begrensd op `[api].max_page_size` (100). |
| `fields` | Ondersteund | |
| `populate` | Ondersteund | `*`, lijsten, geneste objecten, `on` voor dynamische zones, `count`. Diepte tot 5; hoogstens 1.000 gepopuleerde items per relatie. |
| `status` | Ondersteund | `published` (standaard) of `draft`; concepten lezen vereist het recht `readDrafts`. |
| `locale` | Ondersteund | Zie i18n hieronder. |
| `hasPublishedVersion` | Ondersteund | |
| Full-text-zoeken met `_q` | Ondersteund | `$containsi` over tekstvelden, zoals Strapi; gerangschikt zoeken met `[search]`. |
| Schrijven van relaties | Ondersteund | ID's, `connect` / `disconnect` / `set`, met `position` (`before`, `after`, `start`, `end`). |
| Publiceren, depubliceren, concept verwerpen | Ondersteund | Schrijfacties publiceren tenzij `?status=draft`, zoals in Strapi v5. Verdin voegt `POST /api/{pluralName}/{documentId}/actions/{publish,unpublish,discard-draft}` toe. |
| Responseformaat van Strapi v4 en `publicationState` | Niet ondersteund | Verdin spreekt alleen v5: platte attributen, `documentId`, `status`. |
| OpenAPI-document | Gedeeltelijk | Op `/api/_openapi.json` (standaard alleen met token) en een interactieve referentie op `/api/docs`, in plaats van `/documentation` van de documentatieplugin. |

## GraphQL

| Functie | Status | Opmerkingen |
| --- | --- | --- |
| Queries | Ondersteund | `articles`, `articles_connection` met `pageInfo`, `article(documentId)`, enkele types; `filters`, `sort`, `pagination`, `status`, `locale`. Uit totdat je **Instellingen → Functies → GraphQL** aanzet. |
| Mutaties | Ondersteund | `create…`, `update…`, `delete…` met `status` en `locale`. |
| Componenten, dynamische zones, media | Ondersteund | Dynamische zones als unions, media als `UploadFile`. |
| Polymorfe relaties | Gedeeltelijk | Teruggegeven als JSON, niet als getypeerde unions. |
| Shadow CRUD (bewerkingen per type uitschakelen) | Ondersteund | De instelling `disabled` van de functie. |
| Eigen resolvers en schema-extensies | Gedeeltelijk | Rootvelden opgelost door plugins (`[[graphql]]` in `plugin.toml`); geen `extensionService`. |
| Mutaties van Users & Permissions (`login`, `register`, `me`…) | Niet ondersteund | Gebruik de REST-routes. |
| Queries/mutaties voor upload en i18n (`uploadFiles`, `i18NLocales`…) | Niet ondersteund | Gebruik de REST-routes (`GET /api/i18n/locales`) en het beheerpaneel. `localizations` op gelokaliseerde types wordt ondersteund. |
| Limieten, GraphiQL | Ondersteund | `maxDepth`, `maxComplexity`, schakelaars voor introspectie en playground. |

## Users & Permissions (eindgebruikers)

Zet **Instellingen → Functies → Gebruikers en rechten** aan. Zie [Eindgebruikers](/nl/guides/auth/end-users/).

| Functie | Status | Opmerkingen |
| --- | --- | --- |
| `POST /api/auth/local`, `/auth/local/register` | Ondersteund | Dezelfde vormen van request en response. |
| E-mailbevestiging, wachtwoord vergeten/herstellen/wijzigen | Ondersteund | `/auth/email-confirmation`, `/auth/send-email-confirmation`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/change-password`. |
| Refresh tokens | Ondersteund | `jwtManagement: "refresh"`, `/auth/refresh`, `/auth/logout`. |
| `/api/users`, `/users/me`, `/users/count` | Ondersteund | Gewone JSON, rechten op `plugin::users-permissions.user`. |
| OAuth-providers | Gedeeltelijk | GitHub, Google, Microsoft, Discord, Facebook, GitLab, LinkedIn en elke OAuth 2-provider; niet elke preset van Strapi. |
| Routes voor rollen en rechten (`/api/users-permissions/roles`, `/permissions`) | Niet ondersteund | Beheer rollen in **Instellingen → Eindgebruikers**. |
| Geïmporteerde gebruikers | Ondersteund | Bcrypt-hashes blijven werken; ze worden bij het inloggen opnieuw gehasht met Argon2id. |

## Mediabibliotheek en upload-API

| Functie | Status | Opmerkingen |
| --- | --- | --- |
| `POST /api/upload` | Ondersteund | Multipart `files` en `fileInfo`; `?id=` werkt de gegevens van een bestand bij, of vervangt het bestand als er een wordt meegestuurd. |
| Koppelen bij het uploaden (`ref`, `refId`, `field`) | Niet ondersteund | Upload, en stel daarna het mediaveld in met het bestands-id. |
| `GET /api/upload/files`, `/files/{id}`, `DELETE /files/{id}` | Gedeeltelijk | Opsommen neemt alleen `pagination[page]`, `pagination[pageSize]`, `sort` en `filters[name][$containsi]`. |
| Responsieve formaten, breakpoints | Ondersteund | `thumbnail` plus `[upload].breakpoints`. |
| Mappen, focuspunten, alt-tekst, bijschriften | Ondersteund | |
| Uploadproviders | Gedeeltelijk | Lokale schijf en S3-compatibele opslag (AWS, R2, B2, MinIO, Tigris…). Geen Cloudinary of andere providerpakketten. |
| Afbeeldingstransformaties | Alleen Verdin | `/uploads/<file>?preset=…` en ondertekende URL's (lokale provider). |

## Internationalisatie

| Functie | Status | Opmerkingen |
| --- | --- | --- |
| Gelokaliseerde types en niet-gelokaliseerde velden | Ondersteund | `pluginOptions.i18n.localized`, ook per attribuut. |
| `?locale=` bij REST, `locale` in GraphQL | Ondersteund | Een onbekende locale geeft `400`. |
| `localizations` in responses | Ondersteund | Alleen als gepopuleerd (`populate=localizations`, `populate=*`), met dezelfde opties als een relatie. Ook een GraphQL-veld. De admin-API laat het weg. |
| `GET /api/i18n/locales` | Ondersteund | Een gewone array in de vorm van Strapi. Vereist `find` op `plugin::i18n.locale` (rij **Locales** van het rechtenraster), zoals Strapi's `listLocales`. `documentId` wordt afgeleid van de localecode. Locales worden beheerd in het beheerpaneel (**Instellingen → Internationalisatie**). |

## Concept en publicatie

| Functie | Status | Opmerkingen |
| --- | --- | --- |
| Concept- en gepubliceerde versies per document | Ondersteund | Per locale. Zie [Concept en publicatie](/nl/concepts/draft-and-publish/). |
| Concept verwerpen | Ondersteund | |
| Gepland publiceren | Ondersteund | Via [Releases](/nl/guides/content/releases/). |

## Aanpassingen aan de server

Zie [Eigen code porten](/nl/migrate/porting-custom-code/) voor hoe je elk daarvan verplaatst.

| Strapi | Status | Verdin |
| --- | --- | --- |
| Lifecycle hooks, middlewares van de Document Service | Gedeeltelijk | Before- en after-hooks in WebAssembly-plugins, die een schrijfactie kunnen wijzigen of weigeren. Geen JavaScript. |
| Eigen controllers, services, routes | Gedeeltelijk | Pluginroutes onder `/api/plugins/<name>/`. |
| Policies en middlewares | Niet ondersteund | Rechten en rate limits zijn ingebouwd. |
| `register` / `bootstrap` | Gedeeltelijk | De opstartfunctie van een plugin, die draait wanneer de plugin start, wordt aangezet of zijn instellingen wijzigen; ze kan content seeden en de rechten van de openbare rol vervangen. |
| Cron-taken | Gedeeltelijk | Pluginjobs. |
| Document Service / Entity Service in JavaScript | Niet ondersteund | Geen JavaScript-runtime. |
| npm-plugins uit de marketplace van Strapi | Niet ondersteund | |
| Webhooks | Ondersteund | Ondertekend, opnieuw geprobeerd en gelogd; `entry.draft-discard` is `entry.discard-draft`. Zie [Webhooks](/nl/guides/integrations/webhooks/). |
| API-tokens (alleen lezen, volledige toegang, aangepast) | Ondersteund | Dezelfde soorten, optionele vervaldatum, opnieuw genereren. |
| Transfer tokens, `strapi transfer` | Niet ondersteund | Gebruik `verdin export` en `verdin import verdin`. |
| Bestanden van `strapi export` | Ondersteund (import) | `verdin import strapi`; versleutelde exports worden niet gelezen. |
| `config/*.js`, `.env` | Gedeeltelijk | `verdin.toml` en omgevingsvariabelen. |
| TypeScript-types | Ondersteund | `verdin types`. |
| E-mailproviders | Gedeeltelijk | SMTP, Resend en Postmark. |

## Beheerpaneel

| Functie | Status | Opmerkingen |
| --- | --- | --- |
| Contentbeheer, mediabibliotheek, contenttype-bouwer | Ondersteund | Een eigen Angular-paneel, niet het React-beheerpaneel van Strapi. |
| Beheerders, rollen, aangepaste rollen | Ondersteund | Super Admin, Editor en Author ingebouwd, plus aangepaste rollen. |
| Rechten per veld en per locale | Ondersteund | |
| RBAC-voorwaarden | Gedeeltelijk | Alleen de ingebouwde voorwaarde `is-creator`; geen eigen voorwaarden. |
| Aanpassing van het beheerpaneel (`src/admin/app`) | Gedeeltelijk | Logo, favicon, titel, accentkleur en teksten in `[admin.branding]`; widgets en aangepaste velden uit plugins. Geen eigen pagina's, injection zones of React-extensies. |
| Admin-API (`/admin/…`) | Niet ondersteund | De admin-API van Verdin is een eigen API; bouw niet voort op die van Strapi. |
| Configuratie van bewerk- en lijstweergave | Ondersteund | |

## Enterprise-functies

Alles in Verdin is open source; dit zijn Enterprise- of betaalde functies in Strapi.

| Functie in Strapi | Status | Opmerkingen |
| --- | --- | --- |
| SSO | Gedeeltelijk | OpenID Connect-providers, met toewijzing van groepen aan rollen. Geen SAML of andere passport-strategieën. Zie [Single sign-on](/nl/guides/auth/sso/). |
| Auditlogs | Ondersteund | Zie [Auditlogs](/nl/guides/content/audit-logs/). |
| Reviewworkflows | Ondersteund | Rollen per fase beperken wie items *naar* een fase verplaatst, en een vereiste publicatiefase geldt voor elke API. Zie [Reviewworkflows](/nl/guides/content/review-workflows/). |
| Releases | Ondersteund | Gepland of direct. |
| Contentgeschiedenis | Ondersteund | `[history].max_versions` versies per document. |
| Voorbeeld en live voorbeeld | Ondersteund | Voorbeeld-URL's met kortlevende tokens, voorbeeld naast elkaar en [visueel bewerken](/nl/guides/frontend/visual-editing/). |
| Aangepaste beheerdersrollen | Ondersteund | Geen limiet op hun aantal. |
