---
title: "Admin-API"
description: "De API achter het beheerpaneel van Verdin, voor automatisering: inloggen, sessies, conventies en de belangrijkste routegroepen."
sidebar:
  order: 4
  label: "Admin"
---

Het beheerpaneel is een client van de admin-API, die wordt geserveerd onder `{admin.path}/api`
(standaard `/admin/api`). Alles wat het paneel doet, kan een script ook: beheerders en
API-tokens aanmaken, webhooks en functies configureren, locales beheren, of werken met
concepten en releases. Deze pagina legt uit hoe je authenticeert en somt de routegroepen op.

:::caution[Stabiliteit]
De admin-API heeft vóór Verdin 1.0 geen stabiliteitsgarantie: routes en bodies kunnen in
minor releases veranderen, en de changelog vermeldt niet elke wijziging. Gebruik voor het lezen
en schrijven van content liever de [REST](/nl/api/rest/)- of [GraphQL](/nl/api/graphql/)-API
met een [API-token](/nl/guides/auth/api-tokens/). Een stabiliteitscontract voor elke API staat
gepland voor 1.0.
:::

## Inloggen

De admin-API heeft nog geen API-tokens: een script logt in als beheerder, bij voorkeur een
beheerder met een rol die alleen toestaat wat het script nodig heeft.

```sh title="Terminal"
curl -s -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"bot@example.com","password":"…"}'
```

```json
{
  "data": {
    "user": { "id": 3, "email": "bot@example.com", "…": "…" },
    "accessToken": "eyJhbGciOiJIUzI1NiIs…",
    "accessTokenExpiresAt": "2026-09-29T10:15:00.000Z"
  }
}
```

Stuur het access token mee met elk ander request:

```sh title="Terminal"
curl -H "Authorization: Bearer $ACCESS_TOKEN" 'https://cms.example.com/admin/api/system/info'
```

| Gegeven | Geldigheid | Waar |
| --- | --- | --- |
| Access token (JWT) | 15 minuten | De response-body. Stuur het mee als `Authorization: Bearer …`. |
| Refresh token | 30 dagen | De cookie `verdin_refresh` (`HttpOnly`, `SameSite=Strict`, pad `/admin/api/auth`, `Secure` onder `verdin start`). |

Voor een nieuw access token roep je `POST /admin/api/auth/refresh` aan met de cookie en een
header `X-Verdin-CSRF` (willekeurige waarde). Het antwoord is gelijk aan dat van een login en
het refresh token wordt geroteerd: sla de nieuwe cookie op, want wie een gebruikt refresh token
opnieuw aanbiedt, beëindigt de hele sessie. `POST /admin/api/auth/logout`, met dezelfde header,
beëindigt de sessie.

```sh title="Terminal"
curl -s -b cookies.txt -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/refresh' \
  -H 'X-Verdin-CSRF: 1'
```

- **Tweefactorauthenticatie.** Voor een account met een tweede factor antwoordt de login met
  `{ "data": { "twoFactorRequired": true, "twoFactorToken": "…", "methods": ["totp"] } }`.
  Rond het af met `POST /admin/api/auth/login/two-factor` en
  `{ "twoFactorToken": "…", "code": "123456" }` (een TOTP- of herstelcode). Zie
  [Tweefactorauthenticatie](/nl/guides/auth/two-factor/).
- **Rate limits.** Inloggen en registreren worden per client-IP begrensd door
  `[admin].auth_rate_limit` (standaard 20 per minuut); refreshes hebben een ruimer budget.
- **Fouten.** Verkeerde inloggegevens, onbekende accounts en vergrendelde accounts antwoorden
  allemaal met `400 Invalid credentials`. Vijf verkeerde wachtwoorden vergrendelen het account
  15 minuten.
- **Eerste beheerder.** Op een verse instantie maakt `POST /admin/api/auth/register-first-admin`
  de Super Admin aan; dit werkt alleen zolang er nog geen beheerder bestaat. `verdin admin create`
  doet hetzelfde vanaf de opdrachtregel.

## Conventies

- Bodies en responses zijn JSON. Responses verpakken hun resultaat in `data`
  (`{ "data": … }`); contentroutes geven ook `meta` terug, net als de REST-API.
- Contentroutes nemen bodies van de vorm `{ "data": { … } }`, net als de REST-API.
  Instellingenroutes nemen gewone JSON-objecten.
- Fouten hebben de [REST-foutvorm](/nl/api/rest/#fouten). Een route van een functie die uit
  staat, antwoordt met `404`. Een beheerder van wie de rol tweefactorauthenticatie vereist, krijgt
  `403 TwoFactorRequiredError` totdat die is ingesteld.
- Elke route controleert de [rechten](/nl/concepts/permissions/) van de beheerder:
  contentroutes de contentacties op het type, instellingenroutes hun instellingenactie.
- De admin-API beantwoordt nooit cross-origin requests: roep hem aan vanaf een server of een
  script, niet vanaf de pagina's van een andere site.
- Geslaagde wijzigingen worden vastgelegd in de [auditlog](/nl/guides/content/audit-logs/).

## Lijsten

Instellingenlijsten worden gepagineerd met `page` (vanaf 1) en `pageSize`. Ze antwoorden met de
rijen van de pagina en de aantallen:

```json
{ "data": [ … ], "meta": { "pagination": { "page": 2, "pageSize": 25, "total": 60, "pageCount": 3 } } }
```

| Lijst | Standaard paginagrootte (maximum) | Volgorde | Andere parameters |
| --- | --- | --- | --- |
| `GET /users`, `GET /roles`, `GET /api-tokens` | 25 (100) | Oudste eerst | |
| `GET /webhooks` | 25 (100) | Oudste eerst | `meta.events` somt de events op waarop een webhook zich kan abonneren |
| `GET /webhooks/{id}/deliveries` | 25 (100) | Nieuwste eerst | |
| `GET /releases` | 25 (100) | Nieuwste eerst | `status` (`pending`, `running`, `done`, `failed`) |
| `GET /site/redirects` | 25 (100) | Op bron | `search` matcht de bron of de bestemming |
| `GET /site/menus`, `GET /site/forms` | 25 (100) | Op naam | |
| `GET /site/forms/{id}/submissions` | 25 (100) | Nieuwste eerst | |
| `GET /deploy/targets` | 25 (100) | Oudste eerst | |
| `GET /deploy/deployments` | 25 (100) | Nieuwste eerst | `targetId`; `limit` is een verouderde alias van `pageSize` |
| `GET /end-users` | 25 (100) | Nieuwste eerst | `search` matcht de gebruikersnaam of het e-mailadres |
| `GET /audit-logs` | 50 (200) | Nieuwste eerst | Zie [Auditlogs](/nl/guides/content/audit-logs/) |

Een grotere `pageSize` wordt verlaagd tot het maximum. Om een hele lijst te lezen, vraag je pagina's
op totdat `page` `pageCount` bereikt:

```sh title="Terminal"
curl 'https://cms.example.com/admin/api/site/redirects?page=1&pageSize=100' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Contentroutes pagineren zoals de REST-API, met `pagination[page]` en
`pagination[pageSize]`.

## Routegroepen

Paden zijn relatief ten opzichte van `/admin/api`. De routers staan in
[`crates/verdin-api/src/admin.rs`](https://github.com/Verdin-CMS/verdin/blob/main/crates/verdin-api/src/admin.rs)
en de modules `*_admin.rs` daarnaast.

| Groep | Routes | Recht |
| --- | --- | --- |
| Inloggen en account | `GET /auth/status`, `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `GET\|PUT /users/me`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, uitnodigingen en wachtwoordherstel onder `/auth/*` | Ingelogd (de inlogroutes zijn openbaar) |
| Tweefactorauthenticatie | `/auth/two-factor/*`, `POST /auth/login/two-factor`, `POST /auth/login/passkey/options`, `DELETE /users/{id}/two-factor` | Ingelogd; `users.manage` om die van een andere beheerder te resetten |
| SSO | `GET /auth/sso`, `GET /auth/sso/{id}`, `GET /auth/sso/{id}/callback` | Openbaar |
| Beheerders | `GET\|POST /users`, `GET\|PUT\|DELETE /users/{id}`, `POST /users/{id}/invite` | `users.manage` |
| Rollen en openbare toegang | `GET\|POST /roles`, `GET\|PUT\|DELETE /roles/{id}`, `GET\|PUT /public-permissions` | `roles.manage` |
| API-tokens | `GET\|POST /api-tokens`, `GET\|PUT\|DELETE /api-tokens/{id}`, `POST /api-tokens/{id}/regenerate` | `tokens.manage` |
| Schema | `GET /content-types`, `GET /components`, `GET\|PUT\|DELETE /content-types/{uid}/edit-view`; `GET /schema`, `POST /schema/plan`, `POST /schema/apply` alleen in `verdin dev` | Ingelogd; `views.manage` voor bewerkweergaven; `schema.manage` voor de bouwer |
| Content | `GET\|POST /content/{uid}`, `GET\|PUT\|DELETE /content/{uid}/{documentId}`, `POST /content/{uid}/{documentId}/actions/{publish\|unpublish\|discard-draft}`, `POST …/clone`, `GET …/locales`, `GET …/usage`, `GET /content/{uid}/uid-available`, `GET /content/{uid}/stats` | Contentacties op `{uid}` |
| Import en export | `GET /content/{uid}/export`, `POST /content/{uid}/import` | Contentacties op `{uid}` |
| Geschiedenis | `GET /history/{uid}/{documentId}`, `GET /history/versions/{id}`, `POST /history/versions/{id}/restore` | Contentacties op het type |
| Releases | `GET\|POST /releases`, `GET\|PUT\|DELETE /releases/{id}`, `POST /releases/{id}/actions`, `DELETE /releases/{id}/actions/{actionId}`, `POST /releases/{id}/publish` | `releases.manage` |
| Reviewworkflows | `GET\|POST /review-workflows`, `GET\|PUT\|DELETE /review-workflows/{id}`, `GET\|PUT /content/{uid}/{documentId}/review`, `GET /review/*` | `workflows.manage` om te configureren |
| Media | `POST /upload`, `POST /upload/from-url`, `GET /upload/files`, `GET\|PUT\|DELETE /upload/files/{id}`, `POST /upload/files/{id}/replace`, `GET /upload/files/{id}/usage`, `/upload/folders…` | `media.*` |
| Locales | `GET\|POST /i18n/locales`, `PUT\|DELETE /i18n/locales/{code}` | `locales.manage` om te wijzigen |
| Webhooks | `GET\|POST /webhooks`, `GET\|PUT\|DELETE /webhooks/{id}`, `POST\|DELETE /webhooks/{id}/secret`, `POST /webhooks/{id}/trigger`, `GET /webhooks/{id}/deliveries`, `POST /webhooks/deliveries/{id}/retry` | `webhooks.manage` |
| Eindgebruikers | `GET\|POST /end-users`, `GET\|PUT\|DELETE /end-users/{id}`, `GET\|POST /end-user-roles`, `PUT\|DELETE /end-user-roles/{id}` | `endusers.manage` |
| Functies | `GET /features`, `PUT /features/{id}`, `POST /email/test` | `features.manage` om te wijzigen |
| Plugins | `GET /plugins`, `GET /plugins/extensions`, `PUT /plugins/{name}`, `GET /plugins/{name}/logs` | `plugins.manage` |
| Deploys en CDN | `/deploy/targets…`, `GET /deploy/deployments`, `GET /deploy/cdn`, `POST /deploy/cdn/purge` | `deploy.manage`; `deploy.trigger` om te starten |
| Site | `/site/redirects…`, `/site/menus…`, `/site/forms…` en formulierinzendingen | `site.manage` |
| Samenwerking | `/comments…`, `/tasks…`, `/engagement/*`, `/polls…` | Leestoegang tot het type van het item |
| Realtime | `GET /events`, `GET\|POST /presence` | Zie [Realtime-API](/nl/api/realtime/#adminstream) |
| AI | `GET /ai`, `POST /ai/translate`, `/ai/alt-text`, `/ai/summarize`, `/ai/seo` | Zie [AI-acties](/nl/guides/integrations/ai-actions/) |
| Auditlogs | `GET /audit-logs` | `audit.read` |
| Systeem | `GET /system/info` (versie, database en modus) | Ingelogd |

## Contentroutes

De contentroutes draaien dezelfde Document Service als de REST-API, met beheerregels:

- `{uid}` is de UID van het contenttype, zoals `api::article`.
- Leesacties geven **concepten** terug, tenzij je `status=published` meegeeft. Ze accepteren de
  REST-[queryparameters](/nl/api/rest/#queryparameters), plus `unseen=true` voor documenten die de
  beheerder niet heeft geopend sinds hun laatste wijziging.
- Schrijfacties slaan alleen het concept op. Publiceren is altijd een expliciete actie.
- Schrijfacties registreren de beheerder als maker of laatste bewerker. Veld-, locale- en
  `is-creator`-beperkingen uit de rollen van de beheerder gelden voor lezen en schrijven.

```sh title="Terminal"
curl -X PUT 'https://cms.example.com/admin/api/content/api::article/k2m7q4…?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"data":{"title":"Bonjour, Verdin"}}'
curl -X POST 'https://cms.example.com/admin/api/content/api::article/k2m7q4…/actions/publish?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```
