---
title: Referència de connectors
description: El manifest plugin.toml, les capacitats, els hooks i les seves càrregues, les funcions de l'amfitrió, les rutes, les tasques, la funció d'inici, els camps GraphQL, els punts d'extensió de l'administració, els límits i les mètriques.
sidebar:
  order: 3
---

<!-- Written from crates/verdin-plugins (lib.rs, manifest.rs), crates/verdin-api/src/plugins.rs,
plugins_admin.rs, crates/verdin-graphql/src/lib.rs, crates/verdin/src/metrics.rs and
admin/src/app/core/plugin-extensions.ts. -->

Aquesta pàgina és el contracte complet entre Verdin i un connector (plugin): el manifest, què
envia Verdin a cada funció exportada i què n'espera rebre, i les funcions de l'amfitrió que pot
cridar un mòdul. Per a una introducció, consulta [Connectors](/ca/extending/plugins/); per a un
exemple complet, el [tutorial de connectors](/ca/extending/plugin-tutorial/).

## Directori del connector

Cada connector és un directori dins de `[plugins].path` (per defecte `plugins/`, al costat de
`verdin.toml`):

| Fitxer | Obligatori | Contingut |
| --- | --- | --- |
| `plugin.toml` | sí | El manifest. |
| `plugin.wasm` | sí | El mòdul (un altre camí amb `wasm`). |
| `admin/` | no | Fitxers que carrega el tauler d'administració: el mòdul `admin.script` i els seus recursos. |

En iniciar-se, Verdin carrega tots els directoris que tenen un `plugin.toml`, per ordre de nom.
Un directori s'omet, i es llista amb el motiu a **Configuració → Connectors**, quan el seu
manifest no és vàlid, li falta el mòdul o un altre connector ja té el seu `name`.

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

Les claus desconegudes són errors, a totes les taules.

### Claus de primer nivell

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `name` | obligatòria | L'id del connector a les URL, la configuració i els camps personalitzats: lletres minúscules, dígits i `-`, començant per una lletra, com a màxim 64 caràcters. |
| `version` | obligatòria | Es mostra a l'administració i al registre. |
| `description` | sense definir | Es mostra a **Configuració → Connectors**. |
| `wasm` | `"plugin.wasm"` | El mòdul, relatiu al directori del connector (sense `..`, no absolut). |
| `wasi` | `false` | Dona WASI al mòdul: un rellotge i nombres aleatoris. En cap cas no té fitxers ni sòcols. |

### `[capabilities]`

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `read` | `[]` | Tipus de contingut que `verdin_content` pot llegir (`findMany`, `findOne`): uids com `api::article`, o `"*"` per a tots. |
| `write` | `[]` | Tipus de contingut que pot `create`, `update`, `delete`, `publish` i `unpublish`. Implica `read`. |
| `http` | `[]` | Hosts als quals el mòdul pot enviar peticions HTTP: `api.example.com`, o `*.example.com`. |
| `kv` | `false` | L'emmagatzematge clau-valor propi del connector (`verdin_kv_get`, `verdin_kv_set`). |
| `public_permissions` | `false` | Llegir i substituir els permisos de l'API de contingut del rol públic (`verdin_public_permissions`). |

Les capacitats només limiten les crides a l'amfitrió. Els hooks s'executen sobre els tipus que
indiquen digui el que digui `read`, i qualsevol pot accedir a les rutes.

### `[limits]`

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `timeout_ms` | `5000` | Límit de temps d'una crida, en mil·lisegons. |
| `memory_mb` | `64` | Memòria màxima del mòdul, en megabytes. |

Totes dues han de ser positives.

### `[[hooks]]`

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `on` | obligatòria | L'esdeveniment, a sota. |
| `uid` | `"*"` | El tipus de contingut (`api::article`), o `"*"` per a tots. |
| `function` | obligatòria | La funció exportada que cal cridar. |

Esdeveniments:

| Abans de l'escriptura | Després de l'escriptura |
| --- | --- |
| `beforeCreate` | `afterCreate` |
| `beforeUpdate` | `afterUpdate` |
| `beforeDelete` | `afterDelete` |
| `beforePublish` | `afterPublish` |
| `beforeUnpublish` | `afterUnpublish` |
| `beforeDiscardDraft` | `afterDiscardDraft` |

Els noms són els noms de cicle de vida de Strapi. Els hooks s'executen en les escriptures del
tauler d'administració, de les API REST i GraphQL i dels llançaments, però no en les escriptures
fetes per les ordres `verdin import`. Les escriptures fetes per connectors executen els hooks
posteriors però no els previs (consulta
[Escriptures fetes per connectors](#escriptures-fetes-per-connectors)).

### `[routes]`

| Clau | Descripció |
| --- | --- |
| `function` | La funció exportada que serveix totes les peticions a `/api/plugins/<name>` i `/api/plugins/<name>/…`, amb qualsevol mètode. |

El camí segueix `[api].prefix`.

### `[[jobs]]`

| Clau | Descripció |
| --- | --- |
| `schedule` | Expressió cron, en UTC, amb segons opcionals: `*/15 * * * *`, `0 0 3 * * *`. |
| `function` | La funció exportada que cal cridar. |

### `[startup]`

Una funció que s'executa quan el connector s'inicia: el que un projecte Strapi fa a `bootstrap`
(sembrar contingut, configurar el rol públic).

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `function` | obligatòria | La funció exportada que cal cridar. |
| `timeout_ms` | `30000` | El seu propi límit de temps, en mil·lisegons (sembrar pot trigar més que un hook). Ha de ser positiu. |

Consulta [Funció d'inici](#funció-dinici) per saber quan s'executa.

### `[[graphql]]`

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `name` | obligatòria | El nom del camp: comença per una lletra minúscula, seguida de lletres, dígits i `_`. |
| `function` | obligatòria | La funció exportada que el resol. |
| `mutation` | `false` | Afegeix el camp a `Mutation` en lloc de `Query`. |
| `description` | sense definir | La descripció del camp a l'esquema. |

Cada entrada afegeix `name(args: JSON): JSON`. Un nom que ja fa servir un tipus de contingut, o
que un altre connector ha agafat abans, s'omet amb un avís al registre.

### `[admin]`

| Clau | Descripció |
| --- | --- |
| `script` | Mòdul ES dins d'`admin/` que defineix els elements personalitzats (sense `..`, no absolut). |
| `[[admin.widgets]]` | Tipus de widgets del tauler d'inici: `id`, `title`, `element`, `description` opcional. |
| `[[admin.fields]]` | Camps personalitzats: `id`, `title`, `element`, `type` (el tipus d'atribut amb què es desa el valor, com `string` o `json`), `description` opcional. |

`element` és un nom d'element personalitzat: lletres minúscules, dígits i `-`, amb almenys un
`-` (`slugs-color`).

### `[[settings]]`

Declara el formulari de **Configuració → Connectors → Configuració**. Si no n'hi ha cap, la
configuració és un objecte JSON lliure.

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `key` | obligatòria | La clau a l'objecte de configuració: lletres, dígits i `_`, sense començar per un dígit, única. |
| `label` | obligatòria | L'etiqueta del formulari. |
| `type` | `"string"` | `string`, `text`, `url`, `number`, `integer`, `boolean` o `select`. |
| `description` | sense definir | Text d'ajuda sota el camp. |
| `required` | `false` | Cal un valor (no buit per al text), tret que hi hagi un `default`. |
| `options` | `[]` | Les opcions d'un `select` (obligatòries per a aquest tipus). |
| `default` | sense definir | Es fa servir quan falta la clau o és `null`. Ha d'encaixar amb el camp. |
| `min`, `max` | sense definir | Límits dels valors `number` i `integer`; límits de longitud de `string` i `text`. |

Els valors `url` són buits o URL `http(s)://`. Amb un formulari, el servidor rebutja la
configuració amb claus desconegudes, tipus incorrectes, valors fora de límits o valors
obligatoris que falten (400).

## Funcions exportades

Cada funció exportada rep un document JSON i en retorna un (o res). Una sortida buida compta com
a `null`; una sortida que no és JSON compta com un error.

### Hooks previs

Entrada:

```json
{
  "event": "beforeUpdate",
  "uid": "api::article",
  "documentId": "01m3p88ry359w82nsx496mep5t",
  "locale": "en",
  "data": { "title": "Hello" }
}
```

| Camp | Descripció |
| --- | --- |
| `event` | L'esdeveniment del hook. |
| `uid` | El tipus de contingut. |
| `documentId` | El document, o `null` a `beforeCreate`. |
| `locale` | Als tipus localitzats, l'idioma escrit (l'idioma per defecte quan la petició no n'indicava cap); `null` als altres tipus. |
| `data` | Les dades que s'escriuen, tal com les ha enviat la petició: en crear i actualitzar. `null` per als altres esdeveniments. En actualitzar, només els camps enviats. |

Sortida:

| Sortida | Efecte |
| --- | --- |
| `{ "data": { … } }` | Substitueix les dades escrites. Es validen com les originals. |
| `{ "error": "message" }` | Rebutja l'escriptura: el client rep un 400 amb el missatge. |
| `{}` o qualsevol altra cosa | L'escriptura continua sense canvis. |

Quan hi coincideixen diversos hooks, s'executen per ordre de connector (noms de directori) i
després per ordre del manifest; cadascun veu les dades que ha retornat l'anterior. Un hook que
falla (trap, temps esgotat, sortida no vàlida) es registra i s'omet: l'escriptura continua.

### Hooks posteriors

Entrada: `{ "event", "uid", "documentId", "locale" }`, enviada després de confirmar
l'escriptura. La sortida s'ignora; els errors es registren. Llegeix l'entrada amb
`verdin_content` si en necessites els camps (amb la capacitat `read`).

### Rutes

Entrada:

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

| Camp | Descripció |
| --- | --- |
| `method` | El mètode HTTP. |
| `path` | El camí després de `/api/plugins/<name>`, que comença per `/` (`/` per a l'arrel del connector). |
| `query` | La cadena de consulta en brut, sense `?` (buida quan no n'hi ha). |
| `headers` | Només `content-type`, `accept`, `user-agent` i `accept-language`, quan hi són. |
| `body` | El cos de la petició com a cadena (l'UTF-8 no vàlid se substitueix). |
| `actor` | Qui fa la crida: `{ "kind": "public" }`, `{ "kind": "token", "id": 3 }` (un token d'API) o `{ "kind": "user", "id": 12 }` (un usuari final amb sessió iniciada). |

Una capçalera `Authorization` amb un token no vàlid es rebutja amb un 401 abans de cridar el
connector. No s'apliquen els permisos d'accés públic ni dels tokens d'API: comprova `actor` tu
mateix.

Sortida:

| Camp | Per defecte | Descripció |
| --- | --- | --- |
| `status` | `200` | L'estat HTTP. |
| `headers` | cap | Capçaleres de resposta. Només es conserven `content-type`, `cache-control`, `location`, `etag`, `last-modified` i `content-disposition`. |
| `body` | buit | Una cadena s'envia tal qual (`text/plain` tret que defineixis `content-type`); qualsevol altre valor JSON s'envia com a `application/json`. |

Un connector desactivat o desconegut, o un sense `[routes]`, respon 404. Una crida fallida respon
502 amb `{ "data": null, "error": { "status": 502, "name": "PluginError", … } }`. Les rutes
comparteixen `[server].body_limit` i `[server].request_timeout_secs` amb l'API de contingut.

### Tasques

Entrada: `{ "scheduledAt": "2026-09-29T03:00:00+00:00" }`, l'hora per a la qual estava
programada l'execució. La sortida s'ignora; els errors es registren. Les tasques només
s'executen mentre el connector està activat, i només a les instàncies amb
`[plugins].run_jobs = true`. Una execució perduda mentre el servidor estava aturat no es
recupera.

### Funció d'inici

Entrada: `{ "reason": "start" | "enabled" | "settings" }`:

| `reason` | Quan |
| --- | --- |
| `start` | El servidor s'ha iniciat amb el connector activat. |
| `enabled` | El connector s'ha activat (aquí, o en una altra instància i recollit aquí). |
| `settings` | La seva configuració ha canviat mentre estava activat (desada aquí, o recollida d'una altra instància). |

Sortida: `{ "error": "message" }` compta com un error; qualsevol altra cosa (`{}`, buida) com a
èxit. Un error (trap, temps d'espera esgotat, `{ error }`) va al registre del connector i al
registre del servidor; el connector continua activat, i la funció torna a executar-se a l'inici,
l'activació o el canvi de configuració següent.

La funció s'executa en segon pla, un cop el servidor està en marxa, de manera que mentrestant
se serveixen peticions. S'executa en una instància del mòdul pròpia amb `[startup].timeout_ms`, de
manera que una sembra lenta no bloqueja els hooks ni les rutes del connector. Els hooks
posteriors que disparen les seves escriptures s'executen quan retorna (consulta
[Escriptures fetes per connectors](#escriptures-fetes-per-connectors)). La memòria del mòdul no es
comparteix amb la instància habitual del connector: guarda l'estat a `verdin_kv_set` o al
contingut.

Amb diverses instàncies, només n'executen les funcions d'inici les que tenen
`[plugins].run_jobs = true` (una instància, si segueixes el [consell d'escalat](/ca/deploy/scaling/)):
actuen sobre la base de dades compartida, de manera que n'hi ha prou amb una vegada. Escriu la
funció de manera que tornar-la a executar sigui inofensiu: comprova què sembres abans de crear-ho.

### Camps GraphQL

Entrada: `{ "args": …, "actor": … }`, amb `args` l'argument `args` del camp (qualsevol JSON, o
`null`) i `actor` com a les rutes. La sortida és el valor del camp. Un error, o un connector
desactivat, respon un error GraphQL amb el codi `PLUGIN_ERROR`. Com a les rutes, és el connector
qui comprova l'accés.

## Funcions de l'amfitrió

Importa-les de l'espai de noms `extism:host/user` (`extern "ExtismHost"` a Rust). Reben i
retornen JSON com a cadenes; `Json<Value>` d'`extism-pdk` s'encarrega de la conversió.

| Funció | Entrada | Sortida |
| --- | --- | --- |
| `verdin_log` | `{ "level": "info" \| "warn" \| "error", "message": "…" }` | cap |
| `verdin_content` | Una petició de contingut (a sota) | El resultat, o `{ "error": "…" }` |
| `verdin_kv_get` | La clau, com a cadena simple | El valor JSON desat, o `null` |
| `verdin_kv_set` | `{ "key": "…", "value": … }` | cap |
| `verdin_config` | cap | L'objecte de configuració, amb els valors per defecte declarats omplerts |
| `verdin_public_permissions` | `{ "op": "get" }` o `{ "op": "set", "permissions": [...] }` | `{ "permissions": [...] }`, o `{ "error": "…" }` |

Un mòdul que importa una funció de l'amfitrió que el servidor no té (un Verdin més antic) no es
pot carregar: cada crida falla amb `unknown import` al registre del servidor.

### `verdin_log`

Escriu al registre del servidor (amb el nom del connector) i al registre del connector a
**Configuració → Connectors → Registres**. Els altres nivells compten com a `info`. El registre
del connector conserva els últims 200 missatges, cadascun tallat a 2.000 caràcters, a la memòria.

### `verdin_content`

```json
{ "op": "findMany", "uid": "api::article", "query": { "filters": { "title": { "$eq": "x" } }, "sort": ["title"] } }
```

| Camp | Fet servir per | Descripció |
| --- | --- | --- |
| `op` | tots | `findMany`, `findOne`, `create`, `update`, `delete`, `publish` o `unpublish`. |
| `uid` | tots | El tipus de contingut. Ha de ser a les capacitats. |
| `documentId` | `findOne`, `update`, `delete`, `publish`, `unpublish` | El document. |
| `query` | `findMany`, `findOne` | Els paràmetres de l'API REST com a objecte JSON: `filters`, `sort`, `fields`, `populate`, `pagination`, `status`. |
| `data` | `create`, `update` | Els camps que cal escriure, com al `data` d'una petició REST. |
| `status` | `create`, `update` | `"draft"` desa un esborrany. Si no, l'escriptura es publica, com una escriptura REST sense `?status=draft`. |
| `locale` | tots | L'idioma que cal llegir o escriure. |

Resultats:

| `op` | Resultat |
| --- | --- |
| `findMany` | `{ "documents": [...], "meta": { "pagination": {…} } }` |
| `findOne` | `{ "document": {…} }` (`null` quan no es troba) |
| `create`, `update` | `{ "documentId": "…" }` |
| `delete` | `{ "deleted": true }` |
| `publish` | `{ "published": true }` |
| `unpublish` | `{ "unpublished": true }` |

Una crida fora de les capacitats, una operació desconeguda, un error de validació o un document
que no existeix responen `{ "error": "…" }`. Les lectures retornen les versions publicades tret
que la consulta demani `"status": "draft"`.

#### Escriptures fetes per connectors

Les escriptures a través de `verdin_content` s'ometen els hooks **previs** de tots els
connectors, de manera que un connector no pot entrar en bucle amb els seus propis canvis, i les
regles que posis als hooks previs (valors per defecte, comprovacions) no s'hi apliquen. Tota la
resta s'aplica: validació, etapes de revisió, webhooks, historial, registre d'auditoria i els
hooks **posteriors** de tots els connectors, inclòs el que escriu.

Els hooks posteriors que disparen les escriptures d'un connector no s'executen dins de
l'escriptura: es posen en cua i s'executen quan la crida del connector (ruta, tasca, resolutor
GraphQL, hook o funció d'inici) ha retornat i ha alliberat la instància del connector, abans
d'enviar la resposta de la ruta. Així un connector pot escriure un tipus sobre el qual té hooks
posteriors, i les cadenes a través de diversos connectors funcionen.

- Els hooks que escriuen disparen més hooks, **com a màxim `4` nivells de profunditat** (una
  escriptura des de REST o GraphQL és el nivell 1). Els hooks més profunds s'ometen amb un avís al
  registre del connector, cosa que evita que un hook que escriu el tipus que escolta entri en bucle
  per sempre.
- Les funcions de l'amfitrió (`verdin_content`, `verdin_public_permissions`, el magatzem
  clau-valor) s'aturen al límit de temps de la crida i retornen un error al mòdul, i qui crida
  espera com a màxim el límit de temps més 10 segons un connector ocupat. Una crida encallada no
  pot bloquejar el connector, ni una aturada ordenada, per sempre.

### `verdin_kv_get` i `verdin_kv_set`

Un magatzem clau-valor per connector, a la base de dades de Verdin, compartit per totes les
instàncies. Les claus tenen d'1 a 255 bytes; els valors són qualsevol JSON. Definir `null`
elimina la clau. Sense la capacitat `kv`, les lectures retornen `null` i les escriptures
s'ignoren.

### `verdin_config`

Retorna la configuració desada a **Configuració → Connectors**, amb el `default` de cada opció
declarada omplert per a les claus que falten. `{}` quan no hi ha res desat.

### `verdin_public_permissions`

Llegeix o substitueix els permisos de l'API de contingut del rol públic, el que edita
**Configuració → Accés públic**. Necessita la capacitat `public_permissions`; sense ella, cada
crida respon `{ "error": "…" }`.

```json
{ "op": "set", "permissions": [
  { "subject": "api::article", "action": "find" },
  { "subject": "api::article", "action": "findOne" },
  { "subject": "api::comment", "action": "create" }
] }
```

| `op` | Efecte |
| --- | --- |
| `get` | Res; retorna els permisos actuals. |
| `set` | Substitueix **tots** els permisos públics per `permissions` (una llista buida els elimina tots). |

Tots dos responen `{ "permissions": [{ "subject", "action" }, …] }`, ordenats. `subject` és l'uid
d'un tipus de contingut, `plugin::upload` (la biblioteca de multimèdia),
`plugin::users-permissions.user` (els usuaris finals a través de l'API de contingut) o
`plugin::i18n.locale` (només `find`). `action` és `find`, `findOne`, `create`, `update`, `delete`,
`publish` o `readDrafts` (les dues últimes no s'apliquen a les pujades ni als usuaris finals). Es
comproven com la quadrícula de permisos de l'administració: un subjecte o una acció desconeguts, o
que no s'apliquen, responen `{ "error": "…" }` i no canvien res. Cada `set` s'escriu al registre
del servidor.

### HTTP

Amb hosts llistats a `http`, fes servir el suport HTTP d'Extism (`extism_pdk::http::request` a
Rust). Les peticions a altres hosts fallen.

## Punts d'extensió de l'administració

El tauler d'administració demana al servidor les extensions dels connectors activats i importa
cada `admin.script` un sol cop, com a mòdul ES, des de `/admin/plugins/<name>/<script>` (sota
`[admin].path`). Els fitxers del directori `admin/` del connector se serveixen allà mentre el
connector està activat, amb `X-Content-Type-Options: nosniff` i `Cache-Control: no-cache`. El
mòdul ha de definir els elements personalitzats que indica el manifest; un element que no s'ha
definit en 3 segons queda fora.

### Widgets

Cada entrada `[[admin.widgets]]` és un tipus de widget que els administradors poden afegir al
tauler d'inici. L'element rep una propietat `context`:

| Propietat | Descripció |
| --- | --- |
| `apiBase` | La base de l'API de contingut, com ara `/api`. |
| `adminApiBase` | La base de l'API d'administració, com ara `/admin/api`. |
| `fetch(path, init)` | `fetch` amb les credencials de l'administrador que ha iniciat la sessió. Els camins relatius es resolen contra `adminApiBase`; els camins sota qualsevol de les dues bases i les URL absolutes es mantenen. |

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

`context.fetch` només envia la sessió de l'administrador amb les peticions a l'API
d'administració. Els camins sota `context.apiBase` (l'API de contingut, incloses les rutes del teu
connector) hi van sense, ja que l'API de contingut no accepta sessions d'administració; es
responen amb els permisos del rol públic. Abans de la 0.10 també hi enviava la sessió i aquestes
peticions fallaven; els widgets escrits per a la 0.9 que criden `fetch` directament continuen
funcionant.

### Camps personalitzats

Cada entrada `[[admin.fields]]` és un camp que els atributs poden fer servir amb
`"customField": "plugin::<name>.<id>"`; el `type` de l'atribut ha de coincidir amb com desa el
camp el seu valor. El **Constructor de tipus de contingut** l'ofereix. L'element rep:

| Propietat | Descripció |
| --- | --- |
| `value` | El valor actual. |
| `disabled` | Si l'edició està desactivada. |
| `attribute` | La definició de l'atribut a l'esquema. |
| `locale` | L'idioma que s'està editant. |

Comunica un valor nou amb un esdeveniment `change` el `detail` del qual és el valor (o, sense
`detail`, a través de la seva pròpia propietat `value`). Quan el connector està desactivat o li
falta l'element, l'editor mostra el camp d'entrada normal per al tipus d'emmagatzematge. Consulta
[Tipus d'atribut](/ca/reference/attribute-types/).

## Execució i límits

| Límit | Valor |
| --- | --- |
| Temps per crida | `[limits].timeout_ms`, per defecte 5.000 ms (`[startup].timeout_ms`, per defecte 30.000 ms, per a la funció d'inici) |
| Memòria | `[limits].memory_mb`, per defecte 64 MB |
| Concurrència | Una crida alhora per connector; les crides s'esperen entre elles (la funció d'inici s'executa al seu costat) |
| Instància del mòdul | Una per connector, construïda en el primer ús; es reconstrueix després que una crida falli (se'n perd la memòria). La funció d'inici en rep una de nova a cada execució |
| Registre | 200 missatges per connector, 2.000 caràcters cadascun, a la memòria |
| Claus KV | D'1 a 255 bytes |
| Capçaleres de petició de les rutes | `content-type`, `accept`, `user-agent`, `accept-language` |
| Capçaleres de resposta de les rutes | `content-type`, `cache-control`, `location`, `etag`, `last-modified`, `content-disposition` |

Els canvis en un manifest o un mòdul s'apliquen després d'un reinici; els interruptors i la
configuració s'apliquen a l'instant. Gestionar connectors necessita `plugins.manage` (consulta la
[referència de permisos](/ca/reference/permissions/)).

## Mètriques

Amb [`[metrics]`](/ca/deploy/monitoring/) activat, `/_metrics` informa de cada crida que ha arribat
a una funció exportada:

| Mètrica | Tipus | Etiquetes | Significat |
| --- | --- | --- | --- |
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`, `kind`, `function` | Temps que han trigat les funcions dels connectors. Intervals de 5 ms a 10 s. |
| `verdin_plugin_call_errors_total` | counter | `plugin`, `kind`, `function` | Crides que han fallat: una trampa (trap), un temps d'espera esgotat, una sortida que no és JSON o un `{ error }` d'una funció d'inici. |

`kind` és `hook`, `route`, `job`, `startup` o `graphql`. Un hook previ que rebutja una escriptura
amb `{ error }` ha donat una resposta, de manera que no compta com un error. Les crides a una
funció que el mòdul no exporta no es registren, de manera que les etiquetes queden limitades pels
connectors instal·lats. Les sèries apareixen després de la primera crida d'un connector; cada
instància compta les seves pròpies crides.
