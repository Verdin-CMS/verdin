---
title: Pluginreferentie
description: Het manifest plugin.toml, capabilities, hooks en hun payloads, hostfuncties, routes, jobs, de opstartfunctie, GraphQL-velden, uitbreidingspunten van het beheerpaneel, limieten en metrics.
sidebar:
  order: 3
---

<!-- Written from crates/verdin-plugins (lib.rs, manifest.rs), crates/verdin-api/src/plugins.rs,
plugins_admin.rs, crates/verdin-graphql/src/lib.rs, crates/verdin/src/metrics.rs and
admin/src/app/core/plugin-extensions.ts. -->

Deze pagina is het volledige contract tussen Verdin en een plugin: het manifest, wat Verdin naar
elke geëxporteerde functie stuurt en terugverwacht, en de hostfuncties die een module kan
aanroepen. Voor een introductie, zie [Plugins](/nl/extending/plugins/); voor een uitgewerkt
voorbeeld, de [plugintutorial](/nl/extending/plugin-tutorial/).

## Pluginmap

Elke plugin is een map onder `[plugins].path` (standaard `plugins/`, naast `verdin.toml`):

| Bestand | Verplicht | Inhoud |
| --- | --- | --- |
| `plugin.toml` | ja | Het manifest. |
| `plugin.wasm` | ja | De module (een ander pad met `wasm`). |
| `admin/` | nee | Bestanden die het beheerpaneel laadt: de module `admin.script` en zijn assets. |

Bij het opstarten laadt Verdin elke map die een `plugin.toml` heeft, op volgorde van naam. Een map
wordt overgeslagen, en met de reden getoond in **Instellingen → Plugins**, als zijn manifest
ongeldig is, zijn module ontbreekt, of een andere plugin al zijn `name` heeft.

## Manifest

```toml title="plugins/slugs/plugin.toml"
name = "slugs"
version = "1.0.0"
description = "Slugs from titles, and a color field"

[capabilities]
read = ["api::article"]
write = ["api::tag"]
http = ["api.example.com"]
kv = true
public_permissions = true

[limits]
timeout_ms = 5000
memory_mb = 64

[[hooks]]
on = "beforeCreate"
uid = "api::article"
function = "before_write"

[routes]
function = "handle"

[[jobs]]
schedule = "*/15 * * * *"
function = "refresh"

[startup]
function = "seed"
timeout_ms = 30000

[[graphql]]
name = "slugStats"
function = "stats"

[admin]
script = "index.js"

[[admin.widgets]]
id = "stats"
title = "Slug stats"
element = "slugs-stats"

[[admin.fields]]
id = "color"
title = "Color"
element = "slugs-color"
type = "string"

[[settings]]
key = "separator"
label = "Separator"
type = "select"
options = ["-", "_"]
default = "-"
```

Onbekende sleutels zijn fouten, in elke tabel.

### Sleutels op het hoogste niveau

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `name` | verplicht | Het id van de plugin in URL's, instellingen en aangepaste velden: kleine letters, cijfers en `-`, beginnend met een letter, hoogstens 64 tekens. |
| `version` | verplicht | Getoond in het beheerpaneel en het log. |
| `description` | niet ingesteld | Getoond in **Instellingen → Plugins**. |
| `wasm` | `"plugin.wasm"` | De module, relatief ten opzichte van de pluginmap (geen `..`, niet absoluut). |
| `wasi` | `false` | Geef de module WASI: een klok en willekeurige getallen. Hoe dan ook geen bestanden of sockets. |

### `[capabilities]`

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `read` | `[]` | Contenttypes die `verdin_content` mag lezen (`findMany`, `findOne`): uid's zoals `api::article`, of `"*"` voor allemaal. |
| `write` | `[]` | Contenttypes die hij mag `create`, `update`, `delete`, `publish` en `unpublish`. Impliceert `read`. |
| `http` | `[]` | Hosts waarnaar de module HTTP-requests mag sturen: `api.example.com`, of `*.example.com`. |
| `kv` | `false` | De eigen key-value-opslag van de plugin (`verdin_kv_get`, `verdin_kv_set`). |
| `public_permissions` | `false` | De contentrechten van de openbare rol voor de content-API lezen en vervangen (`verdin_public_permissions`). |

Capabilities beperken alleen hostaanroepen. Hooks draaien op de types die ze noemen, wat `read`
ook zegt, en routes zijn voor iedereen bereikbaar.

### `[limits]`

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `timeout_ms` | `5000` | Tijdslimiet van één aanroep, in milliseconden. |
| `memory_mb` | `64` | Grootste geheugen van de module, in megabytes. |

Beide moeten positief zijn.

### `[[hooks]]`

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `on` | verplicht | Het event, hieronder. |
| `uid` | `"*"` | Het contenttype (`api::article`), of `"*"` voor allemaal. |
| `function` | verplicht | De geëxporteerde functie die wordt aangeroepen. |

Events:

| Vóór de schrijfactie | Na de schrijfactie |
| --- | --- |
| `beforeCreate` | `afterCreate` |
| `beforeUpdate` | `afterUpdate` |
| `beforeDelete` | `afterDelete` |
| `beforePublish` | `afterPublish` |
| `beforeUnpublish` | `afterUnpublish` |
| `beforeDiscardDraft` | `afterDiscardDraft` |

De namen zijn de lifecyclenamen van Strapi. Hooks draaien bij schrijfacties vanuit het
beheerpaneel, de REST- en GraphQL-API's en releases, maar niet bij schrijfacties door de commando's
`verdin import`. Schrijfacties door plugins draaien de after-hooks maar niet de before-hooks (zie
[Schrijfacties door plugins](#schrijfacties-door-plugins)).

### `[routes]`

| Sleutel | Beschrijving |
| --- | --- |
| `function` | De geëxporteerde functie die elk request naar `/api/plugins/<name>` en `/api/plugins/<name>/…` bedient, met elke methode. |

Het pad volgt `[api].prefix`.

### `[[jobs]]`

| Sleutel | Beschrijving |
| --- | --- |
| `schedule` | Cron-expressie, in UTC, met optionele seconden: `*/15 * * * *`, `0 0 3 * * *`. |
| `function` | De geëxporteerde functie die wordt aangeroepen. |

### `[startup]`

Een functie die draait wanneer de plugin start: wat een Strapi-project in `bootstrap` doet
(content seeden, de openbare rol instellen).

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `function` | verplicht | De geëxporteerde functie die wordt aangeroepen. |
| `timeout_ms` | `30000` | Haar eigen tijdslimiet, in milliseconden (seeden kan langer duren dan een hook). Moet positief zijn. |

Zie [Opstartfunctie](#opstartfunctie) voor wanneer ze draait.

### `[[graphql]]`

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `name` | verplicht | De veldnaam: begint met een kleine letter, gevolgd door letters, cijfers en `_`. |
| `function` | verplicht | De geëxporteerde functie die het veld oplost. |
| `mutation` | `false` | Voeg het veld toe aan `Mutation` in plaats van `Query`. |
| `description` | niet ingesteld | De beschrijving van het veld in het schema. |

Elke regel voegt `name(args: JSON): JSON` toe. Een naam die een contenttype al gebruikt, of die een
andere plugin eerder nam, wordt overgeslagen met een waarschuwing in het log.

### `[admin]`

| Sleutel | Beschrijving |
| --- | --- |
| `script` | ES-module onder `admin/` die de custom elements definieert (geen `..`, niet absoluut). |
| `[[admin.widgets]]` | Types dashboardwidgets: `id`, `title`, `element`, optioneel `description`. |
| `[[admin.fields]]` | Aangepaste velden: `id`, `title`, `element`, `type` (het attribuuttype waarin de waarde wordt opgeslagen, zoals `string` of `json`), optioneel `description`. |

`element` is de naam van een custom element: kleine letters, cijfers en `-`, met minstens één `-`
(`slugs-color`).

### `[[settings]]`

Declareert het formulier van **Instellingen → Plugins → Instellingen**. Zonder regels zijn de
instellingen een vrij JSON-object.

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `key` | verplicht | De sleutel in het instellingenobject: letters, cijfers en `_`, niet beginnend met een cijfer, uniek. |
| `label` | verplicht | Het label in het formulier. |
| `type` | `"string"` | `string`, `text`, `url`, `number`, `integer`, `boolean` of `select`. |
| `description` | niet ingesteld | Helptekst onder het veld. |
| `required` | `false` | Er is een waarde nodig (niet leeg bij tekst), tenzij er een `default` is. |
| `options` | `[]` | De keuzes van een `select` (daarvoor verplicht). |
| `default` | niet ingesteld | Gebruikt als de sleutel ontbreekt of `null` is. Moet bij het veld passen. |
| `min`, `max` | niet ingesteld | Grenzen van waarden van `number` en `integer`; lengtegrenzen van `string` en `text`. |

Waarden van `url` zijn leeg of `http(s)://`-URL's. Met een formulier weigert de server instellingen
met onbekende sleutels, verkeerde types, waarden buiten de grenzen of ontbrekende verplichte
waarden (400).

## Geëxporteerde functies

Elke geëxporteerde functie neemt één JSON-document en geeft er één terug (of niets). Een lege
uitvoer telt als `null`; uitvoer die geen JSON is, telt als mislukking.

### Before-hooks

Input:

```json
{
  "event": "beforeUpdate",
  "uid": "api::article",
  "documentId": "01m3p88ry359w82nsx496mep5t",
  "locale": "en",
  "data": { "title": "Hello" }
}
```

| Veld | Beschrijving |
| --- | --- |
| `event` | Het event van de hook. |
| `uid` | Het contenttype. |
| `documentId` | Het document, of `null` bij `beforeCreate`. |
| `locale` | Bij gelokaliseerde types de geschreven locale (de standaardlocale als het request er geen noemde); `null` bij andere types. |
| `data` | De gegevens die worden geschreven, zoals het request ze stuurde: bij create en update. `null` bij de andere events. Bij update alleen de meegestuurde velden. |

Uitvoer:

| Uitvoer | Effect |
| --- | --- |
| `{ "data": { … } }` | Vervangt de geschreven gegevens. Die worden gevalideerd zoals het origineel. |
| `{ "error": "message" }` | Weigert de schrijfactie: de aanroeper krijgt een 400 met de melding. |
| `{}` of iets anders | De schrijfactie gaat ongewijzigd door. |

Als meerdere hooks overeenkomen, draaien ze in pluginvolgorde (mapnamen), daarna in de volgorde
van het manifest; elke hook ziet de gegevens die de vorige teruggaf. Een hook die faalt (trap,
time-out, ongeldige uitvoer) wordt gelogd en overgeslagen: de schrijfactie gaat door.

### After-hooks

Input: `{ "event", "uid", "documentId", "locale" }`, verzonden nadat de schrijfactie is
vastgelegd. De uitvoer wordt genegeerd; mislukkingen worden gelogd. Lees het item met
`verdin_content` als je de velden nodig hebt (met de capability `read`).

### Routes

Input:

```json
{
  "method": "GET",
  "path": "/stats",
  "query": "page=2&sort=title",
  "headers": { "accept": "application/json", "user-agent": "curl/8.7.1" },
  "body": "",
  "actor": { "kind": "public" }
}
```

| Veld | Beschrijving |
| --- | --- |
| `method` | De HTTP-methode. |
| `path` | Het pad na `/api/plugins/<name>`, beginnend met `/` (`/` voor de root van de plugin). |
| `query` | De ruwe querystring, zonder `?` (leeg als er geen is). |
| `headers` | Alleen `content-type`, `accept`, `user-agent` en `accept-language`, als ze aanwezig zijn. |
| `body` | De request-body als string (ongeldige UTF-8 wordt vervangen). |
| `actor` | Wie aanroept: `{ "kind": "public" }`, `{ "kind": "token", "id": 3 }` (een API-token) of `{ "kind": "user", "id": 12 }` (een ingelogde eindgebruiker). |

Een header `Authorization` met een ongeldig token wordt met een 401 geweigerd voordat de plugin
wordt aangeroepen. Rechten van openbare toegang en API-tokens worden niet toegepast: controleer
`actor` zelf.

Uitvoer:

| Veld | Standaard | Beschrijving |
| --- | --- | --- |
| `status` | `200` | De HTTP-status. |
| `headers` | geen | Response-headers. Alleen `content-type`, `cache-control`, `location`, `etag`, `last-modified` en `content-disposition` blijven behouden. |
| `body` | leeg | Een string wordt verzonden zoals hij is (`text/plain`, tenzij je `content-type` instelt); elke andere JSON-waarde wordt verzonden als `application/json`. |

Een uitgeschakelde of onbekende plugin, of een plugin zonder `[routes]`, antwoordt met 404. Een
mislukte aanroep antwoordt met 502 en
`{ "data": null, "error": { "status": 502, "name": "PluginError", … } }`. Routes delen
`[server].body_limit` en `[server].request_timeout_secs` met de content-API.

### Jobs

Input: `{ "scheduledAt": "2026-09-29T03:00:00+00:00" }`, het tijdstip waarvoor de run gepland was.
De uitvoer wordt genegeerd; mislukkingen worden gelogd. Jobs draaien alleen zolang de plugin aan
staat, en alleen op instanties met `[plugins].run_jobs = true`. Een run die gemist is terwijl de
server uit lag, wordt niet ingehaald.

### Opstartfunctie

Input: `{ "reason": "start" | "enabled" | "settings" }`:

| `reason` | Wanneer |
| --- | --- |
| `start` | De server is gestart met de plugin aan. |
| `enabled` | De plugin is aangezet (hier, of op een andere instantie en hier opgepikt). |
| `settings` | Haar instellingen zijn gewijzigd terwijl ze aan stond (hier opgeslagen, of van een andere instantie opgepikt). |

Uitvoer: `{ "error": "message" }` telt als mislukking; al het andere (`{}`, leeg) als succes. Een
mislukking (trap, time-out, `{ error }`) gaat naar het log van de plugin en het serverlog; de plugin
blijft aan, en de functie draait opnieuw bij de volgende start, het volgende aanzetten of de
volgende wijziging van de instellingen.

De functie draait op de achtergrond, nadat de server draait, dus requests worden intussen bediend.
Ze draait op een eigen module-instantie met `[startup].timeout_ms`, zodat een trage seed de hooks en
routes van de plugin niet ophoudt. After-hooks die door haar schrijfacties worden afgevuurd, draaien
zodra ze terugkeert (zie [Schrijfacties door plugins](#schrijfacties-door-plugins)). Het geheugen
van de module wordt niet gedeeld met de gewone instantie van de plugin: bewaar toestand in
`verdin_kv_set` of in content.

Bij meerdere instanties draaien alleen die met `[plugins].run_jobs = true` opstartfuncties (één
instantie, als je het [schaaladvies](/nl/deploy/scaling/) volgt): ze werken op de gedeelde
database, dus één keer is genoeg. Schrijf de functie zo dat opnieuw draaien onschadelijk is: zoek
op wat je seedt voordat je het aanmaakt.

### GraphQL-velden

Input: `{ "args": …, "actor": … }`, met `args` het argument `args` van het veld (willekeurige JSON,
of `null`) en `actor` zoals bij routes. De uitvoer is de waarde van het veld. Een mislukking, of een
uitgeschakelde plugin, geeft een GraphQL-fout met de code `PLUGIN_ERROR`. Net als bij routes
controleert de plugin de toegang.

## Hostfuncties

Importeer ze uit de namespace `extism:host/user` (`extern "ExtismHost"` in Rust). Ze nemen en
geven JSON als strings; `Json<Value>` in `extism-pdk` regelt de conversie.

| Functie | Input | Uitvoer |
| --- | --- | --- |
| `verdin_log` | `{ "level": "info" \| "warn" \| "error", "message": "…" }` | geen |
| `verdin_content` | Een contentrequest (hieronder) | Het resultaat, of `{ "error": "…" }` |
| `verdin_kv_get` | De sleutel, als gewone string | De opgeslagen JSON-waarde, of `null` |
| `verdin_kv_set` | `{ "key": "…", "value": … }` | geen |
| `verdin_config` | geen | Het instellingenobject, met de gedeclareerde standaardwaarden ingevuld |
| `verdin_public_permissions` | `{ "op": "get" }` of `{ "op": "set", "permissions": [...] }` | `{ "permissions": [...] }`, of `{ "error": "…" }` |

Een module die een hostfunctie importeert die de server niet heeft (een oudere Verdin), kan niet
worden geladen: elke aanroep ervan mislukt met `unknown import` in het serverlog.

### `verdin_log`

Schrijft naar het serverlog (met de naam van de plugin) en naar het log van de plugin in
**Instellingen → Plugins → Logs**. Andere niveaus tellen als `info`. Het log van de plugin bewaart
de laatste 200 berichten, elk afgekapt op 2.000 tekens, in het geheugen.

### `verdin_content`

```json
{ "op": "findMany", "uid": "api::article", "query": { "filters": { "title": { "$eq": "x" } }, "sort": ["title"] } }
```

| Veld | Gebruikt door | Beschrijving |
| --- | --- | --- |
| `op` | alle | `findMany`, `findOne`, `create`, `update`, `delete`, `publish` of `unpublish`. |
| `uid` | alle | Het contenttype. Moet in de capabilities staan. |
| `documentId` | `findOne`, `update`, `delete`, `publish`, `unpublish` | Het document. |
| `query` | `findMany`, `findOne` | De parameters van de REST-API als JSON-object: `filters`, `sort`, `fields`, `populate`, `pagination`, `status`. |
| `data` | `create`, `update` | De te schrijven velden, zoals in de `data` van een REST-request. |
| `status` | `create`, `update` | `"draft"` slaat een concept op. Anders wordt de schrijfactie gepubliceerd, zoals een REST-schrijfactie zonder `?status=draft`. |
| `locale` | alle | De locale om te lezen of te schrijven. |

Resultaten:

| `op` | Resultaat |
| --- | --- |
| `findMany` | `{ "documents": [...], "meta": { "pagination": {…} } }` |
| `findOne` | `{ "document": {…} }` (`null` als niet gevonden) |
| `create`, `update` | `{ "documentId": "…" }` |
| `delete` | `{ "deleted": true }` |
| `publish` | `{ "published": true }` |
| `unpublish` | `{ "unpublished": true }` |

Een aanroep buiten de capabilities, een onbekende bewerking, een validatiefout of een ontbrekend
document antwoordt in plaats daarvan met `{ "error": "…" }`. Leesacties geven gepubliceerde
versies terug, tenzij de query om `"status": "draft"` vraagt.

#### Schrijfacties door plugins

Schrijfacties via `verdin_content` slaan de **before**-hooks van elke plugin over, zodat een plugin
daar niet in een lus kan raken door zijn eigen wijzigingen, en regels die je in before-hooks zet
(standaardwaarden, controles) gelden er niet voor. Al het andere geldt wel: validatie, reviewfasen,
webhooks, geschiedenis, de auditlog, en de **after**-hooks van alle plugins, de schrijvende
inbegrepen.

After-hooks die door de schrijfacties van een plugin worden afgevuurd, draaien niet binnen de
schrijfactie: ze worden in de wachtrij gezet en draaien zodra de aanroep van de plugin (route, job,
GraphQL-resolver, hook of opstartfunctie) is teruggekeerd en de instantie van de plugin heeft
vrijgegeven, voordat het antwoord van de route wordt verzonden. Een plugin kan dus een type
schrijven waarop hij after-hooks heeft, en ketens door meerdere plugins werken.

- Hooks die schrijven, vuren weer hooks af, **hoogstens `4` niveaus diep** (een schrijfactie vanuit
  REST of GraphQL is niveau 1). Diepere hooks worden overgeslagen met een waarschuwing in het log
  van de plugin, wat voorkomt dat een hook die het type schrijft waarnaar hij luistert eindeloos
  in een lus blijft.
- Hostfuncties (`verdin_content`, `verdin_public_permissions`, de key-value-store) stoppen bij de
  tijdslimiet van de aanroep en geven een fout terug aan de module, en een aanroeper wacht hoogstens
  de tijdslimiet plus 10 seconden op een plugin die bezig is. Een vastgelopen aanroep kan de plugin,
  of een nette stop, niet eindeloos vasthouden.

### `verdin_kv_get` en `verdin_kv_set`

Een key-value-store per plugin, in de database van Verdin, gedeeld door alle instanties. Sleutels
zijn 1 tot 255 bytes; waarden zijn willekeurige JSON. `null` instellen verwijdert de sleutel.
Zonder de capability `kv` geven leesacties `null` terug en worden schrijfacties genegeerd.

### `verdin_config`

Geeft de instellingen terug die zijn opgeslagen in **Instellingen → Plugins**, met de `default`
van elke gedeclareerde instelling ingevuld voor ontbrekende sleutels. `{}` als er niets is
opgeslagen.

### `verdin_public_permissions`

Leest of vervangt de contentrechten van de openbare rol voor de content-API, wat **Instellingen →
Openbare toegang** bewerkt. Vereist de capability `public_permissions`; zonder die antwoordt elke
aanroep met `{ "error": "…" }`.

```json
{ "op": "set", "permissions": [
  { "subject": "api::article", "action": "find" },
  { "subject": "api::article", "action": "findOne" },
  { "subject": "api::comment", "action": "create" }
] }
```

| `op` | Effect |
| --- | --- |
| `get` | Niets; geeft de huidige rechten terug. |
| `set` | Vervangt **alle** openbare rechten door `permissions` (een lege lijst verwijdert ze allemaal). |

Beide antwoorden `{ "permissions": [{ "subject", "action" }, …] }`, gesorteerd. `subject` is de uid
van een contenttype, `plugin::upload` (de mediabibliotheek), `plugin::users-permissions.user`
(eindgebruikers via de content-API) of `plugin::i18n.locale` (alleen `find`). `action` is `find`,
`findOne`, `create`, `update`, `delete`, `publish` of `readDrafts` (de laatste twee gelden niet
voor uploads en eindgebruikers). Ze worden gecontroleerd zoals het rechtenraster van de beheerder:
een onbekend subject of een onbekende actie, of een die niet van toepassing is, antwoordt met
`{ "error": "…" }` en wijzigt niets. Elke `set` wordt in het serverlog geschreven.

### HTTP

Met hosts vermeld in `http` gebruik je de HTTP-ondersteuning van Extism
(`extism_pdk::http::request` in Rust). Requests naar andere hosts mislukken.

## Uitbreidingspunten van het beheerpaneel

Het beheerpaneel vraagt de server om de extensies van de ingeschakelde plugins en importeert elk
`admin.script` één keer, als ES-module, vanaf `/admin/plugins/<name>/<script>` (onder
`[admin].path`). Bestanden onder de map `admin/` van de plugin worden daar geserveerd zolang de
plugin aan staat, met `X-Content-Type-Options: nosniff` en `Cache-Control: no-cache`. De module
moet de custom elements definiëren die het manifest noemt; een element dat niet binnen 3 seconden
is gedefinieerd, wordt weggelaten.

### Widgets

Elke regel `[[admin.widgets]]` is een type widget dat beheerders aan het dashboard kunnen
toevoegen. Het element krijgt een property `context`:

| Property | Beschrijving |
| --- | --- |
| `apiBase` | De basis van de content-API, zoals `/api`. |
| `adminApiBase` | De basis van de admin-API, zoals `/admin/api`. |
| `fetch(path, init)` | `fetch` met de inloggegevens van de ingelogde beheerder. Relatieve paden worden opgelost ten opzichte van `adminApiBase`; paden onder een van beide bases en absolute URL's blijven behouden. |

```js title="plugins/slugs/admin/index.js"
class SlugStats extends HTMLElement {
  set context(context) {
    // Admin API, with the admin's session.
    context.fetch('auth/me').then((response) => response.json())
      .then(({ data }) => { this.textContent = `Hello ${data.firstname ?? data.email}`; });
    // The plugin's own route, on the content API: sent without the admin's session.
    context.fetch(`${context.apiBase}/plugins/slugs/stats`).then((response) => response.json())
      .then((stats) => { this.title = JSON.stringify(stats); });
  }
}
customElements.define('slugs-stats', SlugStats);
```

`context.fetch` stuurt de sessie van de beheerder alleen mee met requests naar de admin-API. Paden
onder `context.apiBase` (de content-API, de routes van je plugin inbegrepen) gaan zonder, omdat de
content-API geen beheerderssessies accepteert; ze worden beantwoord met de rechten van de openbare
rol. Vóór 0.10 stuurde hij de sessie daar ook mee en mislukten die requests; widgets die voor 0.9
zijn geschreven en gewone `fetch` aanroepen, blijven werken.

### Aangepaste velden

Elke regel `[[admin.fields]]` is een veld dat attributen kunnen gebruiken met
`"customField": "plugin::<name>.<id>"`; het `type` van het attribuut moet overeenkomen met hoe het
veld zijn waarde opslaat. De **Contenttype-bouwer** biedt het aan. Het element krijgt:

| Property | Beschrijving |
| --- | --- |
| `value` | De huidige waarde. |
| `disabled` | Of bewerken uit staat. |
| `attribute` | De definitie van het attribuut uit het schema. |
| `locale` | De locale die wordt bewerkt. |

Het meldt een nieuwe waarde met een event `change` waarvan `detail` de waarde is (of, zonder
`detail`, via zijn eigen property `value`). Als de plugin uit staat of zijn element ontbreekt, toont
de editor het gewone invoerveld voor het opslagtype. Zie
[Attribuuttypes](/nl/reference/attribute-types/).

## Runtime en limieten

| Limiet | Waarde |
| --- | --- |
| Tijd per aanroep | `[limits].timeout_ms`, standaard 5.000 ms (`[startup].timeout_ms`, standaard 30.000 ms, voor de opstartfunctie) |
| Geheugen | `[limits].memory_mb`, standaard 64 MB |
| Gelijktijdigheid | Eén aanroep tegelijk per plugin; aanroepen wachten op elkaar (de opstartfunctie draait ernaast) |
| Module-instantie | Eén per plugin, gebouwd bij het eerste gebruik; opnieuw gebouwd nadat een aanroep faalt (het geheugen gaat verloren). De opstartfunctie krijgt bij elke run een verse |
| Log | 200 berichten per plugin, elk 2.000 tekens, in het geheugen |
| KV-sleutels | 1 tot 255 bytes |
| Request-headers van routes | `content-type`, `accept`, `user-agent`, `accept-language` |
| Response-headers van routes | `content-type`, `cache-control`, `location`, `etag`, `last-modified`, `content-disposition` |

Wijzigingen aan een manifest of module gelden na een herstart; schakelaars en instellingen gelden
meteen. Plugins beheren vereist `plugins.manage` (zie de
[rechtenreferentie](/nl/reference/permissions/)).

## Metrics

Met [`[metrics]`](/nl/deploy/monitoring/) aan rapporteert `/_metrics` elke aanroep die een
geëxporteerde functie bereikte:

| Metric | Type | Labels | Betekenis |
| --- | --- | --- | --- |
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`, `kind`, `function` | Tijd die pluginfuncties namen. Buckets van 5 ms tot 10 s. |
| `verdin_plugin_call_errors_total` | counter | `plugin`, `kind`, `function` | Aanroepen die faalden: een trap, een time-out, uitvoer die geen JSON is, of het `{ error }` van een opstartfunctie. |

`kind` is `hook`, `route`, `job`, `startup` of `graphql`. Een before-hook die een schrijfactie
weigert met `{ error }` gaf een antwoord, dus telt niet als mislukking. Aanroepen van een functie
die de module niet exporteert, worden niet vastgelegd, zodat de labels begrensd blijven door de
geïnstalleerde plugins. De reeksen verschijnen na de eerste aanroep van een plugin; elke instantie
telt haar eigen aanroepen.
