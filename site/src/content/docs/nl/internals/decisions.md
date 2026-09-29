---
title: Beslissingslog
description: De ontwerpbeslissingen achter Verdin, genummerd in de volgorde waarin ze zijn genomen, met de uitkomst en de reden van elk.
sidebar:
  order: 8
---

Dit log legt de ontwerpkeuzes vast die Verdin hebben gevormd, in de volgorde waarin ze zijn gemaakt, zodat je kunt zien waarom de code is zoals hij is voordat je voorstelt hem te veranderen. Regels blijven zoals ze zijn geschreven, namen van mijlpalen inbegrepen (M2–M4 zijn de mijlpalen vóór de eerste releases); een latere regel kan een eerdere verfijnen, zoals 28 dat doet voor 1. Voeg een nieuwe rij toe wanneer je een beslissing neemt die iemand anders anders uit de code zou moeten reconstrueren.

| # | Beslissing | Uitkomst | Motivering |
|---|---|---|---|
| 1 | Componenten: JSON of tabellen | **JSON-kolom** ([opslag](/nl/internals/storage/#componenten-en-dynamische-zones-een-json-kolom)) | Minder joins, triviaal publiceren en versioneren, eenvoudigere migraties. Filteren op herhaalbare componenten is zeldzaam; kan later met JSON-functies worden toegevoegd |
| 2 | JSON-codering van `decimal` | Standaard **getal**, `api.decimal_as_string` als opt-in | Compatibiliteit met Strapi maximaliseert adoptie; exacte waarden zijn beschikbaar als dat nodig is |
| 3 | Formulieren in het beheerpaneel | **Signal Forms** | Past bij een zoneless beheerpaneel dat op signals is gebouwd; dynamische formulierbomen afgeleid uit het schema |
| 4 | Taal | **Engels** voor code, docs en commits | Bereik als open-sourceproject |
| 5 | REST-compatibiliteit met Strapi | **Dezelfde parameters en responsevorm**; extensies die alleen Verdin heeft onder `actions/` | Frontends migreren met minimale wijzigingen |
| 6 | JWT-algoritme voor beheerders | HS256 | Eén geheim, eenvoudig; EdDSA als er ooit externe verifiers komen |
| 7 | Document-id's | ULID (26 tekens) | Sorteerbaar en draagbaar; de eigen id's van Strapi zijn ondoorzichtige strings van 24 tekens, clients parsen ze nooit |
| 8 | Inhoud van de snapshot | Fysiek model, niet het schema | Latere versies kunnen nieuwe tabellen afleiden uit een ongewijzigd schema |
| 9 | Nullability van attributen | Altijd nullable; `required` gecontroleerd bij publiceren | Concepten mogen onvolledig zijn (gedrag van Strapi v5); verplichte velden toevoegen is veilig |
| 10 | Afdwingen van `unique` | Unieke index op `(column, locale, publication_state)` | Vrij van race conditions; concepten en hun gepubliceerde versie delen waarden |
| 11 | Naam van de statuskolom | `publication_state` | `state` is een veelgebruikte attribuutnaam |
| 12 | Gereserveerde SQL-woorden | Identifiers altijd quoten | Geen willekeurige blokkeerlijst van attribuutnamen |
| 13 | DML bouwen | Eigen builder in plaats van `sea-query` | Details per dialect overheersen (getypeerde NULLs, collaties, SQLite-formaten); één abstractie minder |
| 14 | Schrijfacties zonder `?status=draft` | Publiceren (REST-gedrag van Strapi v5) | Drop-in-compatibiliteit voor bestaande clients |
| 15 | Tekstvergelijking | Standaard exact op elke engine; operatoren `…i` voor hoofdletterongevoelig | Dezelfde resultaten op MySQL als op PostgreSQL |
| 16 | Tijdelijk toegangsbeheer (M2–M3) | Schakelaar `[api].open_access`, verwijderd in M4 | Standaard veilig totdat er rechten bestonden |
| 17 | "Doel hoort bij één document" | Afgedwongen door het doel te verplaatsen, per status | Een unieke index zou verbieden dat een concept en zijn gepubliceerde versie een doel delen |
| 18 | Inverse kanten (`mappedBy`) | Alleen-lezen | Erdoorheen schrijven is dubbelzinnig met concept en publicatie (welke versie van de eigenaar?) |
| 19 | Posities van koppelingen | Bij elke schrijfactie opnieuw genummerd 1..n | Geen uitputting van floats; lijsten zijn klein |
| 20 | Rijen in koppeltabellen | Een primaire sleutel `id` behouden | Uniforme tabellen voor de migratie-engine en de herbouw van SQLite-tabellen |
| 21 | JWT-bibliotheek | Eigen HS256 (HMAC-SHA256, verificatie in constante tijd, `alg` vastgezet) | `jsonwebtoken` 11 heeft een cryptobackend nodig die RSA meetrekt |
| 22 | Platformtabellen | Afgeleid samen met het contentmodel | Eén migratiemechanisme voor alles |
| 23 | Hergebruik van refresh tokens | De hele familie intrekken, geen coulanceperiode | Eenvoudig en strikt; de beheerder logt opnieuw in |
| 24 | Concepten via de content-API | Aparte grant `readDrafts` | Tokens die gepubliceerde content lezen, lekken geen concepten |
| 25 | Volgorde van toepassen in de bouwer | Migreren, dan bestanden schrijven, dan de app hot-swappen | Een mislukte migratie laat bestanden en de draaiende app ongemoeid |
| 26 | Schrijfacties in het beheerpaneel | Alleen concepten opslaan; publiceren is een expliciete actie | Sluit aan bij wat redacteuren verwachten; de content-API behoudt het standaard publiceren van Strapi |
| 27 | Runtimeconfiguratie van het beheerpaneel | Tag `<meta>`, geen inline script | Houdt de CSP vrij van `unsafe-inline`-scripts |
| 28 | Filters op componentvelden | Operatoren voor JSON-paden per dialect (`#>>`, `JSON_VALUE`, `json_extract`); `EXISTS` over array-items voor herhaalbare componenten en dynamische zones (0.8) | Dynamische zones alleen op `__component`: hun items hebben verschillende velden |
| 29 | i18n van het beheerpaneel | Transloco met platte JSON-catalogi (`admin/public/i18n`) en ICU MessageFormat via FormatJS (een eigen transpiler), achter een kleine facade `I18n`; niet de compile-time i18n van Angular | Van taal wisselen tijdens runtime; standaardbestanden voor Weblate/Crowdin; FormatJS interpreteert berichten, dus de strikte CSP heeft geen `unsafe-eval` nodig (`@messageformat/core` compileert met `new Function`); sleutels getypeerd uit `en.json`, volledigheid gecontroleerd door `npm run i18n:check` |
| 30 | Begin van de week | `Intl.Locale#getWeekInfo` van de regionale tag van de browser (en-GB ≠ en-US), terugval op een regiotabel, overschrijving per gebruiker | Volgt de regio van elke gebruiker, ook als de UI-taal wordt gedeeld |
| 31 | Opslag van de dashboardlay-out | JSON-kolom `preferences` per gebruiker op `vd_admin_users` (≤ 64 KiB) | Volgt de gebruiker over browsers heen; thema en taal blijven in `localStorage`, omdat ze vóór het inloggen gelden |
| 32 | Standaard `Secure` voor de refresh-cookie | Aan in `start`, uit in `dev`, overschrijfbaar | `verdin dev` via gewoon HTTP werkt in elke browser; productie blijft strikt |
| 33 | Releaseprofiel | Thin LTO, 1 codegen-unit, gestript; unwinding behouden | Een handler die in paniek raakt, mag de server niet platleggen |
| 34 | "Ongeziene" documenten | Rijen `vd_document_views` per gebruiker, verwijderd voor iedereen behalve de bewerker als een document verandert; gefilterd met `NOT EXISTS` in SQL | Paginering en tellingen blijven exact; geen tijdstempels om per rij te vergelijken |
| 35 | Stemmen en polls | Samenwerkingstabellen alleen voor beheerders (`vd_document_votes`, `vd_polls`, `vd_poll_votes`), elk contenttype | Ideeënbussen en teambeslissingen zonder stemvelden in elk schema te modelleren |
| 36 | Mediaopslag | `object_store` voor lokaal en S3 | Eén codepad; streamende multipart-uploads; RustFS in de dev-stack en CI |
| 37 | Mediakoppelingen | Koppeltabellen per veld, zoals bij relaties | Dezelfde semantiek voor concept en publicatie als relaties; cascades houden koppelingen consistent |
| 38 | Upgrades van ingebouwde rechten | Versiemarkering in `vd_settings`, toevoegingen één keer toegepast | Bestaande installaties krijgen nieuwe rechten zonder latere wijzigingen van een beheerder ongedaan te maken |
| 39 | Runtimefuncties | Catalogus in `verdin-api`, schakelaars in `vd_settings` (`features`), de app ter plekke herbouwd (ArcSwap) in elke modus | Pluginschakelaars zoals in Strapi zonder herstarts; niet-beschikbare functies worden getoond met hun geplande versie |
| 40 | UI voor de API-referentie | Scalar (`scalar_api_reference`, bundel ingebed) op `{api}/docs`, alleen als het document openbaar is; de CSP staat de inline bootstrap ervan toe via een hash | Self-hosted (geen CDN, fonts, AI-agent of telemetrie); het document blijft standaard alleen met token toegankelijk |
| 41 | GraphQL | Dynamisch schema van `async-graphql`, gebouwd met de app; argumenten en selecties worden vertaald naar de REST-parameterboom en door dezelfde queryparser geparsed | Eén set regels voor filters, paginering, populate, validatie en rechten over REST en GraphQL; populate afgeleid uit de selectie behoudt gebundeld laden |
| 42 | Documentevents | Listeners op de Document Service, aangeroepen na de commit | Neveneffecten (gezien-markeringen, toekomstige webhooks) gelden voor elke API zonder hooks per handler |
