---
title: Beveiliging
description: Hoe Verdin het beheerpaneel, de content-API en de server beschermt, welke instellingen een productie-instantie verharden, en hoe je een kwetsbaarheid meldt.
sidebar:
  order: 2
---

Deze pagina beschrijft wat Verdin doet om een project te beschermen en welke instellingen jij in
de hand hebt. Gebruik haar samen met de [productiechecklist](/nl/deploy/production-checklist/)
wanneer je een instantie voorbereidt op echt verkeer.

## Wat standaard dicht is

- **De content-API.** Anonieme requests krijgen niets totdat je openbare rechten verleent in
  **Instellingen → Openbare toegang**. Een onbekend, verlopen of ongeldig token geeft `401`, en
  valt nooit terug op de openbare rol. Zie [Rechten](/nl/concepts/permissions/).
- **Het OpenAPI-document** op `/api/_openapi.json` vereist een geldig API-token totdat je het
  openbaar maakt in **Instellingen → Functies → API-documentatie**.
- **Optionele functies** zoals GraphQL, eindgebruikers, SSO en de MCP-server blijven uit totdat
  een beheerder met het recht `features.manage` ze aanzet in **Instellingen → Functies**.
- **Plugins** blijven uit totdat een beheerder ze een voor een aanzet in
  **Instellingen → Plugins**.
- **Cross-origin browseraanroepen.** Geen enkele origin mag vanuit een browser een API aanroepen
  totdat je hem vermeldt in `[api].cors_origins`.

## Inloggen van beheerders

| Bescherming | Details |
| --- | --- |
| Wachtwoordhashing | Argon2id met OWASP-parameters, opnieuw gehasht als die veranderen. |
| Sessies | Een access token van 15 minuten in het geheugen van de pagina (nooit in `localStorage`), en een refresh token van 30 dagen in een cookie `HttpOnly`, `SameSite=Strict`, beperkt tot `/admin/api/auth`. Het refresh token roteert bij elk gebruik; wie een oud token aanbiedt, beëindigt de hele sessie. |
| Secure cookies | De refresh-cookie is `Secure` in `verdin start`. `[admin].secure_cookies = false` zet dat uit en logt een waarschuwing. |
| CSRF | Refresh en uitloggen vereisen een header `X-Verdin-CSRF`, die een cross-site formulier niet kan meesturen. |
| Vergrendeling | Vijf mislukte pogingen vergrendelen een account 15 minuten. Mislukkingen tellen over de wachtwoord- en tweedefactorstap samen. Onbekende e-mailadressen en verkeerde wachtwoorden krijgen hetzelfde antwoord, in dezelfde tijd. |
| Rate limit | Inloggen, registreren en refresh: `[admin].auth_rate_limit` requests per minuut per clientadres (20). |
| Tweede factor | Authenticator-apps (TOTP) en toegangssleutels, met herstelcodes. Een rol kan hem vereisen (`requireTwoFactor`). Zie [Tweefactorauthenticatie](/nl/guides/auth/two-factor/). |
| Super Admins | Alleen een Super Admin kan een Super Admin aanmaken, bewerken, verwijderen of resetten, of die rol toekennen. De laatste actieve Super Admin kan niet worden verwijderd. |

De eerste beheerder wordt via het paneel geregistreerd zolang er geen beheerder bestaat. Doe dat
direct na de eerste start, of maak hem aan met `verdin admin create --email …` voordat je de
server blootstelt.

## Beheerpaneel en admin-API

- De admin-API (`/admin/api`) stuurt geen CORS-headers, wat `[api].cors_origins` ook zegt:
  browsers laten alleen de eigen origin van het paneel de antwoorden lezen.
- Het paneel wordt geserveerd met een strikte Content Security Policy (scripts alleen van de eigen
  origin), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` en
  `Referrer-Policy: strict-origin-when-cross-origin`.
- Verdin stuurt geen `Strict-Transport-Security`. Voeg die toe op de reverse proxy die TLS
  afhandelt.

## Content-API

- **API-tokens** worden één keer getoond. Verdin slaat van elk token een HMAC-SHA256 op, met
  `VERDIN_TOKEN_PEPPER` als sleutel, en bewaart een prefix van 10 tekens om te tonen. Tokens
  kunnen verlopen en opnieuw worden gegenereerd.
- **Rechten per veld en locale** beperken wat een rol leest en schrijft, en `populate`,
  relatiefilters en sorteringen op relaties bereiken alleen types die de aanroeper mag lezen.
- **Querylimieten**: `pageSize` tot `[api].max_page_size` (100), `populate`-diepte tot 5,
  hoogstens 100 filtervoorwaarden, querystrings tot 16 KB, en hoogstens 1.000 gepopuleerde items
  per relatie. Onbekende of privévelden in een query geven `400`.
- **GraphQL** heeft eigen limieten voor diepte en complexiteit (`maxDepth`, `maxComplexity`) en
  een schakelaar voor introspectie in de instellingen van de functie.
- **Rate limits**: `[api].public_rate_limit` per clientadres zonder token en
  `[api].token_rate_limit` per API-token of eindgebruiker, in requests per minuut. Beide staan
  standaard uit (`0`). Requests met een onbekend bearer-token worden per adres begrensd.

### CORS

`[api].cors_origins` somt de browserorigins op die de content-API en GraphQL mogen aanroepen:

```toml title="verdin.toml"
[api]
cors_origins = ["https://www.example.com", "https://preview.example.com"]
```

Elke regel is `scheme://host[:port]` zonder pad of afsluitende slash; `["*"]` staat elke origin
toe en kan niet met andere worden gecombineerd. Toegestane methoden zijn `GET`, `POST`, `PUT` en
`DELETE`, en toegestane request-headers `Authorization`, `Content-Type` en `If-None-Match`. Het
starten mislukt bij een regel die geen origin is.

Server-side frontends (Astro, Next.js op de server) roepen de API aan zonder browser en hebben
geen CORS-regel nodig.

## Requests en uploads

| Instelling | Standaard | Beschermt tegen |
| --- | --- | --- |
| `[server].body_limit` | `"1mb"` | Grote request-bodies op de gewone API's. |
| `[server].request_timeout_secs` | `30` | Trage requests die verbindingen bezet houden. |
| `[upload].max_file_size` | 200 MB | Grote uploads (uploads hebben een eigen limiet in plaats van `body_limit`). |
| `[upload].max_image_megapixels` | `100` | Decompressiebommen. |

Het type van een geüpload bestand komt uit zijn bytes, niet uit het type dat de client meestuurt;
de bestandsnaam is alleen een terugvaloptie, en nooit voor types die browsers actief uitvoeren
(zulke bestanden worden opgeslagen als `application/octet-stream`). Links in rich text `blocks`
moeten `http(s)`, `mailto:` of relatief zijn.

## Clientadressen achter een proxy

Rate limits en auditlogs gebruiken het adres van de client. Achter een reverse proxy komt elk
request van de proxy, dus vermeld de proxy in `[server].trusted_proxies`:

```toml title="verdin.toml"
[server]
trusted_proxies = ["10.0.0.0/8"]   # the proxies' IPs or CIDR ranges
```

Verdin leest `X-Forwarded-For` dan van rechts naar links en neemt het eerste adres dat geen
vertrouwde proxy is. Requests van elk ander adres behouden hun verbindingsadres, zodat een client
zijn adres niet kan vervalsen door de header zelf mee te sturen. Vermeld geen bereiken waarvandaan
onbetrouwbare clients kunnen verbinden.

## Uitgaande requests

Webhooks, deploy-hooks, CDN-purge-webhooks en uploads vanaf een URL doen requests die een
beheerder kiest. In `verdin start` weigeren ze loopback-, privé- en link-local-adressen
(inclusief IPv6-vormen die privé-IPv4-adressen bevatten), zodat een beheerder ze niet kan gebruiken
om services op je interne netwerk te bereiken. `[webhooks].allow_private_networks = true` heft dat
op; doe dat alleen als elke beheerder te vertrouwen is met het interne netwerk.

## Geheimen

`VERDIN_ADMIN_JWT_SECRET` en `VERDIN_TOKEN_PEPPER` worden alleen uit de omgeving gelezen en moeten
elk minstens 32 bytes zijn (`verdin secrets` drukt nieuwe af). De pepper verzegelt ook de
TOTP-geheimen van beheerders en leidt de sleutel af die de adressen van formulierinzenders hasht.
Bewaar beide in de secret manager van je platform en commit `.env` nooit.

Requestlogs verbergen de waarden van queryparameters waarvan de naam geheim lijkt (`token`,
`code`, `password`, `key`, `signature`…) en het geheime deel van deploy-callback-URL's.

## Metrics

`/_metrics` staat uit, tenzij `[metrics].enabled = true`. Als het aan staat en er geen token is
ingesteld, kan iedereen die de poort bereikt het lezen. Stel `VERDIN_METRICS_TOKEN` (of
`[metrics].token`) in en scrape met `Authorization: Bearer <token>`, of blokkeer het pad op de
proxy. Zie [Monitoring](/nl/deploy/monitoring/).

## Plugins

Plugins zijn WebAssembly-modules die door Extism in een sandbox worden gedraaid. Een module heeft
geen eigen bestandssysteem, netwerk of database: alles gaat via hostfuncties die worden begrensd
door de capabilities in zijn `plugin.toml` (contenttypes die hij leest of schrijft, HTTP-hosts,
zijn eigen key-value-store), met een tijd- en geheugenlimiet per aanroep (`[limits]`, 5 s en 64 MB
in het voorbeeldmanifest). Beheerders zien waar een plugin om vraagt voordat ze hem aanzetten.
Adminscripts van plugins draaien in de pagina van het paneel, dus installeer alleen plugins die je
vertrouwt. Zie [Plugins](/nl/extending/plugins/).

## Exports en back-ups

Archieven van `verdin export` bevatten privévelden en wachtwoordhashes. Bewaar ze zoals
databasedumps. Zie [Back-ups](/nl/deploy/backups/).

## Een kwetsbaarheid melden

Open geen openbare issue voor een beveiligingsprobleem. Volg het
[beveiligingsbeleid](https://github.com/Verdin-CMS/verdin/blob/main/SECURITY.md) van de repository:
meld het privé via het tabblad **Security** van
[de repository](https://github.com/Verdin-CMS/verdin/security) (**Report a vulnerability**), met de
versie, de stappen om het te reproduceren en de impact die je ziet. Beveiligingsfixes staan onder
**Security** in de [changelog](/nl/project/changelog/).
