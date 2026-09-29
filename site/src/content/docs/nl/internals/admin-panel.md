---
title: Beheerpaneel
description: Hoe het Angular-beheerpaneel van Verdin is opgebouwd, hoe het formulieren en lijsten uit het schema bouwt, en hoe het wordt gebouwd, in de binary wordt ingebed en vertaald.
sidebar:
  order: 6
  label: Beheerpaneel
---

Deze pagina is voor bijdragers aan het beheerpaneel in `admin/`: hoe de Angular-app is georganiseerd, hoe die het contentschema omzet in formulieren en lijsten, en hoe die in de binary `verdin` terechtkomt. Hoe je het paneel gebruikt, staat in de gidsen; hoe de serverkant van de admin-API werkt, staat in de [referentie van de admin-API](/nl/api/admin/).

Het paneel is een single-page app in Angular 22: standalone componenten, zoneless change detection, signals, lazy geladen routes, en spartan/ui-componenten op Tailwind CSS v4.

## Structuur

```text
admin/
├── src/app/
│   ├── app.config.ts     # providers: router, HttpClient interceptors, Transloco, icons
│   ├── app.routes.ts     # lazy routes, guards (auth, permissions, unsaved changes)
│   ├── core/             # services and pure models: api, auth, schema, i18n, permissions…
│   ├── layout/           # the shell (sidebar, header), home, deploy button
│   ├── features/
│   │   ├── auth/         # login, first admin, invitations, password reset
│   │   ├── dashboard/    # home widgets
│   │   ├── content/      # lists, the entry editor, history, releases, review, import
│   │   │   ├── fields/   # schema-driven form controls and the form model
│   │   │   └── collab/   # comments and tasks
│   │   ├── builder/      # content-type builder (verdin dev only)
│   │   ├── media/        # media library
│   │   ├── releases/
│   │   ├── profile/      # own account, two-factor, passkeys, sessions
│   │   └── settings/     # users, roles, tokens, webhooks, locales, plugins, site features…
│   └── shared/
│       ├── ui/           # spartan helm components, owned by the project
│       └── components/   # app-level shared components (confirm dialog, page header…)
├── public/i18n/          # translation catalogs, one JSON file per language
├── scripts/check-i18n.mjs
└── e2e/                  # Playwright tests and the server they run against
```

**State** staat in signals binnen injecteerbare services in `core/` (`Auth`, `Schema`, `I18n`, `Theme`…). Er is geen store-bibliotheek.

**API-toegang** loopt via `core/api.ts`, een kleine wrapper op basis van promises rond de `HttpClient` van Angular, met handgeschreven types in `core/types.ts`. De runtimeconfiguratie (adminpad, API-prefix, modus, branding) komt uit een tag `<meta name="verdin-config">` die de server injecteert.

**Sessie.** Het access token staat alleen in het geheugen; het refresh token is een `HttpOnly`-cookie die beperkt is tot de authroutes. Een HTTP-interceptor voegt het bearer-token toe en ververst bij een `401` één keer en probeert het opnieuw; als het verversen mislukt, stuurt hij de gebruiker naar de inlogpagina. Requests voor refresh en uitloggen bevatten de header `X-Verdin-CSRF` die de server vereist. Guards herstellen de sessie uit de cookie bij het laden van de pagina. Een `403` die zegt dat de rol tweefactorauthenticatie vereist, stuurt de gebruiker door om die in te stellen.

## Formulieren op basis van het schema

De item-editor (`features/content/edit.ts`) heeft geen code per type. Hij leest de contenttypes en componenten uit `GET /admin/api/content-types` en `GET /admin/api/components`, en de lay-out van de editor uit de instellingen van de bewerkweergave, en bouwt het formulier tijdens runtime op met **Signal Forms** (`@angular/forms/signals`):

- Het documentmodel is een signal van een gewoon object (`FormModel` in `fields/model.ts`); de veldboom en zijn validators worden uit het schema afgeleid.
- Een recursieve component `vd-fields` (`fields/fields.ts`) toont elke attributenmap tegen een veldboom. Tekst, datums en tijden gebruiken native inputs die met `[formField]` zijn gebonden. Eigen `FormValueControl`s regelen getallen (nullable; grote gehele getallen blijven strings), schakelaars, enumeraties, datetimes (lokale tijd in de input, UTC in het model), JSON, Markdown, `blocks` (TipTap), media, relaties (een kiezer die zoekt tijdens het typen, met volgorde) en polymorfe relaties.
- Componenten zijn geneste fieldsets; herhaalbare componenten en dynamische zones zijn herschikbare lijsten. Plugins kunnen eigen veldtypes registreren, getoond als custom elements.
- `toModel` zet een gepopuleerd document om in het formuliermodel (relaties worden `documentId`s, bestanden worden id's), en `toPayload` zet het terug om in de `data`-payload: lege strings worden `null`, rendersleutels (`__key`) en alleen-lezen kanten (`mappedBy`, `morphOne`, `morphMany`) vallen weg. Beide hebben unittests in `fields/model.spec.ts`.
- Validatie die uit het schema is afgeleid, geeft directe feedback. Voorwaardelijke velden (`conditions.visible`) worden in de browser geëvalueerd door een port van de JSON Logic-evaluator van de server (`core/logic.ts`). Validatieregels over meerdere velden worden alleen door de server gecontroleerd. De server blijft de autoriteit: zijn regels `details.errors[].path` worden teruggekoppeld aan het bijbehorende veld.
- Opslaan is expliciet, met bijhouden van wijzigingen en een waarschuwing bij het verlaten van de pagina (een route guard plus `beforeunload`). De knoppen **Publiceren**, **Publicatie ongedaan maken** en **Wijzigingen verwerpen** verschijnen afhankelijk van de status van het document. Het beheerpaneel slaat alleen concepten op; publiceren is altijd een aparte actie.

De lay-out van de editor (veldvolgorde, breedtes, labels, beschrijvingen, alleen-lezen velden, het veld dat gerelateerde items benoemt) wordt door elke beheerder gedeeld en op de server in `vd_settings` opgeslagen, en gewijzigd vanaf de pagina **De weergave configureren** met het recht `views.manage`.

## Lijsten

Contentlijsten (`features/content/list.ts`) gebruiken de helm-tabel van spartan met paginering, sortering en filters aan de serverkant. Filters, zoeken (`_q`) en de pagina worden in de URL gespiegeld, dus een gefilterde lijst is een deelbare link. Elke beheerder kiest per type de zichtbare kolommen, de standaardsortering en de paginagrootte (`list-view.ts`); die keuzes worden in zijn eigen voorkeuren op de server opgeslagen, zodat ze hem volgen in andere browsers. Lijsten worden ook live bijgewerkt vanuit de eventstream van het beheer.

## Contenttype-bouwer

De **Contenttype-bouwer** is alleen zichtbaar als de server in ontwikkelmodus draait (`verdin dev`) en de beheerder `schema.manage` heeft. Hij bewerkt contenttypes en componenten in hun bestandsformaat: velden, soorten en doelen van relaties (met het aanmaken van het inverse attribuut op het doel), componenten, dynamische zones, lengtes, bereiken, en de vlaggen `required`, `unique` en `private`.

Elke wijziging wordt eerst naar `POST /admin/api/schema/plan` gestuurd, dat het beoogde schema valideert en de migratiestappen teruggeeft met hun risico, hun SQL en hernoemingssuggesties die de gebruiker kan accepteren. Bevestigen roept `POST /admin/api/schema/apply` aan met het geaccepteerde risiconiveau en de hernoemingen. De server migreert, schrijft `schema/*.json`, en wisselt de draaiende app zonder herstart om voor het nieuwe schema. Zie de [migratie-engine](/nl/internals/migrations/) voor wat er op de server gebeurt.

## Bouwen en distributie

- `ng build` schrijft de productiebuild naar `admin/dist/admin/browser`, met `<base href="/admin/">`.
- De server bedt die map in met `rust-embed` als hij wordt gecompileerd met de feature `embed-admin`, die releasebuilds en het Docker-image gebruiken. Zonder de feature, of als `[admin].assets_dir` is ingesteld, serveert hij de bestanden vanaf schijf. `assets_dir` wint van de ingebedde build.
- De server herschrijft `<base href>` naar `[admin].path` en injecteert de runtimeconfiguratie als tag `<meta>`, niet als inline script. `admin.path` wijzigen vereist nooit dat het paneel opnieuw wordt gebouwd.
- Onbekende paden zonder bestandsextensie vallen terug op `index.html` voor routing aan de clientkant. Bundles met fingerprint (`main-ABC123.js`) worden een jaar als `immutable` gecachet; al het andere is `no-cache`.
- Elke response van het beheerpaneel bevat een strikte Content Security Policy (`script-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`…), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` en `Referrer-Policy: strict-origin-when-cross-origin`. Het inlinen van kritieke CSS door Angular staat uit in `angular.json`, omdat het afhankelijk is van inline event handlers die de policy verbiedt.

Draai voor frontendwerk de server, en daarna `npm start` in `admin/`: `ng serve` proxiet `/admin/api` en `/api` naar `http://localhost:1337` (`admin/proxy.conf.json`).

## Vertalingen

Het paneel wordt tijdens runtime vertaald met Transloco, niet met de compile-time i18n van Angular, dus één build bedient elke taal en gebruikers kunnen wisselen zonder te herladen.

- Catalogi zijn platte JSON-bestanden in `admin/public/i18n/` (`en.json` is de bron), die op aanvraag worden geladen.
- Berichten gebruiken ICU MessageFormat (`{name}`, `{count, plural, one {# entry} other {# entries}}`), geïnterpreteerd door FormatJS (`intl-messageformat`) via een eigen Transloco-transpiler. FormatJS interpreteert berichten in plaats van ze naar functies te compileren, dus de CSP heeft geen `unsafe-eval` nodig.
- Berichtsleutels worden getypeerd op basis van `en.json` (`core/i18n/keys.ts`): een sleutel gebruiken die niet bestaat, is een compileerfout.
- `npm run i18n:check` controleert elke catalogus tegen `en.json`: dezelfde sleutels, geldige ICU-syntaxis, dezelfde argumenten, en elke meervoudscategorie van de taal. CI draait het.
- De service `I18n` levert ook opmaak op basis van de locale en de eerste dag van de week, overgenomen uit de regionale instellingen van de browser, met een overschrijving per gebruiker.

Hoe je een taal toevoegt of bijwerkt, staat in [vertalen](/nl/project/translating/).
