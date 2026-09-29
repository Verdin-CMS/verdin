---
title: "Rechten"
description: "Het grote plaatje van toegangsbeheer in Verdin: beheerdersrollen en RBAC met rechten per veld en locale, de openbare rol, API-tokens en eindgebruikersrollen."
sidebar:
  order: 6
---

Verdin regelt twee doelgroepen apart: **beheerders**, die inloggen op het beheerpaneel, en
**aanroepers van de content-API**, die content lezen en schrijven vanuit je sites en apps. Deze
pagina legt uit hoe elk van beide wordt geautoriseerd en hoe de onderdelen samenhangen. De
volledige lijst van acties staat in de [rechtenreferentie](/nl/reference/permissions/).

| Wie | Authenticeert met | Rechten komen van | Geldt voor |
| --- | --- | --- | --- |
| Beheerder | E-mail en wachtwoord (plus een tweede factor of SSO) | Zijn [rollen](#beheerdersrollen) | Beheerpaneel en [admin-API](/nl/api/admin/) |
| Anonieme aanroeper | Geen header `Authorization` | [Openbare toegang](#openbare-toegang) | REST, GraphQL, realtime |
| Server of build | `Authorization: Bearer vd_…` | Het type van het [API-token](#api-tokens) | REST, GraphQL, realtime |
| Ingelogde eindgebruiker | `Authorization: Bearer <JWT>` | Zijn [eindgebruikersrol](#eindgebruikers) | REST, GraphQL, realtime |

Alles is standaard dicht: de content-API antwoordt met `403` totdat je toegang verleent, en een
beheerder kan alleen doen wat zijn rollen toestaan.

## Beheerdersrollen

Een beheerder heeft een of meer rollen; hun rechten tellen op. Er zijn drie ingebouwde rollen:

| Rol | Kan |
| --- | --- |
| **Super Admin** | Alles, inclusief gebruikers, rollen en API-tokens. Kan niet worden bewerkt. |
| **Editor** | Alle content lezen, aanmaken, bijwerken, verwijderen en publiceren; de mediabibliotheek gebruiken; deploys starten; SEO, redirects, menu's en formulieren beheren. |
| **Author** | Content aanmaken, en alleen de items die hij zelf heeft aangemaakt lezen, bijwerken en verwijderen. Kan niet publiceren. Uploadt bestanden en bewerkt of verwijdert alleen die van zichzelf. |

Andere rollen maak je aan in **Instellingen → Rollen** (recht `roles.manage`). De laatste actieve
Super Admin kan niet worden gedeactiveerd, verwijderd of gedegradeerd, zodat de instantie zichzelf
nooit buitensluit. Een rol kan ook eisen dat zijn leden
[tweefactorauthenticatie](/nl/guides/auth/two-factor/) instellen: totdat ze dat doen, kunnen ze
alleen hun profiel bereiken.

### Wat een recht is

Een recht is een **actie**, een **onderwerp** voor contentacties, en optionele **voorwaarden**:

- **Contentacties**: `content.read`, `content.create`, `content.update`, `content.delete` en
  `content.publish`, op één contenttype (`api::article`) of op allemaal (`*`).
- **Media-acties**: `media.read`, `media.create`, `media.update` en `media.delete`, voor de
  mediabibliotheek.
- **Instellingenacties**, zoals `users.manage`, `tokens.manage`, `webhooks.manage` of
  `features.manage`, die de bijbehorende pagina's van **Instellingen** openen.
- **Voorwaarden**: `is-creator` beperkt een content- of mediarecht tot wat de beheerder zelf heeft
  aangemaakt. Zo werkt de rol Author.

Voorwaarden worden onderdeel van de databasequery: een lijst die op `is-creator` is gefilterd,
telt en pagineert correct, in plaats van achteraf rijen te verbergen.

### Rechten per veld en locale

Contentrechten kunnen verder worden ingeperkt:

- **Velden.** `content.read`, `content.create` en `content.update` kunnen de attributen opsommen
  die ze dekken. Velden buiten de lijst worden verborgen bij leesacties (inclusief zoeken,
  filters, sorteren en gerelateerde items) en geweigerd bij schrijfacties.
- **Locales.** Op [gelokaliseerde types](/nl/concepts/internationalization/) kunnen contentrechten
  de locales opsommen die ze dekken. Versies in andere locales kunnen niet worden gelezen of
  gewijzigd.

Beide stel je per contenttype in, in de editor van de rol, onder **Velden** en **Talen**.

## Content-API

Aanroepers van de content-API worden gecontroleerd tegen grants: een **actie** op een
**onderwerp**.

| Actie | Staat toe |
| --- | --- |
| `find` | Documenten opsommen (`GET /api/articles`), of een enkel type lezen. |
| `findOne` | Eén document lezen (`GET /api/articles/{documentId}`). |
| `create` | `POST` |
| `update` | `PUT` |
| `delete` | `DELETE` |
| `publish` | De routes `actions/publish`, `actions/unpublish` en `actions/discard-draft`. |
| `readDrafts` | Lezen met `status=draft`. |

Onderwerpen zijn contenttypes, de mediabibliotheek (`plugin::upload`), en eindgebruikersaccounts
(`plugin::users-permissions.user`) als [eindgebruikers](/nl/guides/auth/end-users/) aan staan.

Een paar regels gelden voor elke aanroeper:

- Concepten lezen vereist `readDrafts` naast `find` of `findOne`. Een grant die de content van je
  site leest, kan niet per ongeluk ongepubliceerd werk lezen.
- Populeren, filteren of sorteren via een relatie vereist leestoegang tot het doeltype.
- `private` velden worden nooit teruggegeven, welke grants er ook zijn.
- Een schrijfactie geeft het geschreven document terug, ook zonder `find`, zoals in Strapi.
- Dezelfde grants gelden voor [GraphQL](/nl/api/graphql/) en voor de
  [realtime-stream](/nl/api/realtime/).

### Openbare toegang

Requests zonder header `Authorization` krijgen de grants uit **Instellingen → Openbare toegang**.
Standaard wordt niets verleend. Gebruikelijke keuzes zijn `find` en `findOne` op de types die je
site toont.

### API-tokens

API-tokens zijn voor servers, buildstappen en scripts. Maak ze aan in
**Instellingen → API-tokens** (recht `tokens.manage`):

| Type | Grants |
| --- | --- |
| **Alleen lezen** | `find` en `findOne` op elk type. Nooit concepten. |
| **Volledige toegang** | Elke actie op elk type, concepten inbegrepen. |
| **Aangepast** | De grants die je kiest, zoals bij openbare toegang. |

- Een token begint met `vd_`. Het geheim wordt één keer getoond, wanneer het wordt aangemaakt of
  opnieuw gegenereerd; Verdin slaat er alleen een hash met sleutel van op.
- Tokens kunnen verlopen. Een onbekend, verlopen of ongeldig token geeft `401`: het valt nooit
  terug op openbare toegang.
- Elk geldig token kan het OpenAPI-document op `/api/_openapi.json` lezen, tenzij je de
  documentatie openbaar maakt.

Zie [API-tokens](/nl/guides/auth/api-tokens/) voor het aanmaken en roteren ervan.

### Eindgebruikers

Eindgebruikers zijn de mensen die inloggen op je site of app, zoals met de
users-permissions-plugin van Strapi. De functie staat standaard uit. Elk account heeft één rol:

- **Public** is de rol van requests zonder token: de grants ervan zijn die van
  **Instellingen → Openbare toegang**.
- **Authenticated** wordt standaard aan nieuwe accounts gegeven.
- Aangepaste rollen bevatten elke gewenste set grants, met dezelfde acties als hierboven.

Een eindgebruiker stuurt de JWT die hij bij het inloggen kreeg als `Authorization: Bearer <jwt>`.
Verdin onderscheidt die van API-tokens aan het prefix `vd_`. Zie
[Eindgebruikers](/nl/guides/auth/end-users/).

## Vergeleken met Strapi

Het model volgt Strapi v5: RBAC voor beheerders met `is-creator`-voorwaarden, en een content-API
met openbare toegang, API-tokens en users-permissions-rollen. De verschillen:

- Elke functie is beschikbaar voor elk project: aangepaste rollen, rechten per veld en locale,
  [SSO](/nl/guides/auth/sso/) en [auditlogs](/nl/guides/content/audit-logs/).
- Concepten lezen via de content-API is een aparte grant, `readDrafts`.
- Publiceren via REST heeft een eigen grant, `publish`, en eigen routes.
