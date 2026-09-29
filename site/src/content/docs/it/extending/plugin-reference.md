---
title: Riferimento dei plugin
description: Il manifest plugin.toml, le capability, gli hook e i loro payload, le funzioni host, route, job, campi GraphQL, punti di estensione dell'admin e limiti.
sidebar:
  order: 3
---

<!-- Written from crates/verdin-plugins (lib.rs, manifest.rs), crates/verdin-api/src/plugins.rs,
plugins_admin.rs, crates/verdin-graphql/src/lib.rs and admin/src/app/core/plugin-extensions.ts. -->

Questa pagina è il contratto completo tra Verdin e un plugin: il manifest, cosa Verdin invia
a ogni funzione esportata e cosa si aspetta in cambio, e le funzioni host che un modulo può
chiamare. Per un'introduzione, vedi [Plugin](/it/extending/plugins/); per un esempio
completo, il [tutorial sui plugin](/it/extending/plugin-tutorial/).

## Directory del plugin

Ogni plugin è una directory sotto `[plugins].path` (default `plugins/`, accanto a
`verdin.toml`):

| File | Obbligatorio | Contenuto |
| --- | --- | --- |
| `plugin.toml` | sì | Il manifest. |
| `plugin.wasm` | sì | Il modulo (un altro path con `wasm`). |
| `admin/` | no | File che carica il pannello di amministrazione: il modulo `admin.script` e le sue risorse. |

All'avvio Verdin carica ogni directory che ha un `plugin.toml`, in ordine di nome. Una
directory viene saltata, ed elencata con il motivo in **Impostazioni → Plugin**, quando il suo
manifest non è valido, il suo modulo manca, o un altro plugin ha già il suo `name`.

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

Le chiavi sconosciute sono errori, in ogni tabella.

### Chiavi di primo livello

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `name` | obbligatoria | L'id del plugin negli URL, nelle impostazioni e nei campi personalizzati: lettere minuscole, cifre e `-`, inizia con una lettera, al massimo 64 caratteri. |
| `version` | obbligatoria | Mostrata nell'admin e nel log. |
| `description` | non impostata | Mostrata in **Impostazioni → Plugin**. |
| `wasm` | `"plugin.wasm"` | Il modulo, relativo alla directory del plugin (niente `..`, non assoluto). |
| `wasi` | `false` | Dà al modulo WASI: un orologio e numeri casuali. In ogni caso niente file né socket. |

### `[capabilities]`

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `read` | `[]` | Tipi di contenuto che `verdin_content` può leggere (`findMany`, `findOne`): uid come `api::article`, o `"*"` per tutti. |
| `write` | `[]` | Tipi di contenuto su cui può fare `create`, `update`, `delete`, `publish` e `unpublish`. Implica `read`. |
| `http` | `[]` | Host a cui il modulo può inviare richieste HTTP: `api.example.com`, o `*.example.com`. |
| `kv` | `false` | Lo storage key-value del plugin (`verdin_kv_get`, `verdin_kv_set`). |

Le capability limitano solo le chiamate host. Gli hook girano sui tipi che nominano
indipendentemente da `read`, e le route sono raggiungibili da chiunque.

### `[limits]`

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `timeout_ms` | `5000` | Limite di tempo di una chiamata, in millisecondi. |
| `memory_mb` | `64` | Memoria massima del modulo, in megabyte. |

Entrambi devono essere positivi.

### `[[hooks]]`

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `on` | obbligatoria | L'evento, vedi sotto. |
| `uid` | `"*"` | Il tipo di contenuto (`api::article`), o `"*"` per tutti. |
| `function` | obbligatoria | La funzione esportata da chiamare. |

Eventi:

| Prima della scrittura | Dopo la scrittura |
| --- | --- |
| `beforeCreate` | `afterCreate` |
| `beforeUpdate` | `afterUpdate` |
| `beforeDelete` | `afterDelete` |
| `beforePublish` | `afterPublish` |
| `beforeUnpublish` | `afterUnpublish` |
| `beforeDiscardDraft` | `afterDiscardDraft` |

I nomi sono quelli dei lifecycle di Strapi. Gli hook girano sulle scritture dal pannello di
amministrazione, dalle API REST e GraphQL e dai rilasci, ma non sulle scritture fatte dai
plugin (vedi [Scritture fatte dai plugin](#scritture-fatte-dai-plugin)) né dai comandi
`verdin import`.

### `[routes]`

| Chiave | Descrizione |
| --- | --- |
| `function` | La funzione esportata che serve ogni richiesta a `/api/plugins/<name>` e `/api/plugins/<name>/…`, con qualsiasi metodo. |

Il path segue `[api].prefix`.

### `[[jobs]]`

| Chiave | Descrizione |
| --- | --- |
| `schedule` | Espressione cron, in UTC, con secondi opzionali: `*/15 * * * *`, `0 0 3 * * *`. |
| `function` | La funzione esportata da chiamare. |

### `[[graphql]]`

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `name` | obbligatoria | Il nome del campo: inizia con una lettera minuscola, poi lettere, cifre e `_`. |
| `function` | obbligatoria | La funzione esportata che lo risolve. |
| `mutation` | `false` | Aggiunge il campo a `Mutation` invece che a `Query`. |
| `description` | non impostata | La descrizione del campo nello schema. |

Ogni voce aggiunge `name(args: JSON): JSON`. Un nome già usato da un tipo di contenuto, o
preso prima da un altro plugin, viene saltato con un avviso nel log.

### `[admin]`

| Chiave | Descrizione |
| --- | --- |
| `script` | Modulo ES sotto `admin/` che definisce i custom element (niente `..`, non assoluto). |
| `[[admin.widgets]]` | Tipi di widget per la dashboard: `id`, `title`, `element`, `description` opzionale. |
| `[[admin.fields]]` | Campi personalizzati: `id`, `title`, `element`, `type` (il tipo di attributo in cui viene memorizzato il valore, come `string` o `json`), `description` opzionale. |

`element` è il nome di un custom element: lettere minuscole, cifre e `-`, con almeno un `-`
(`slugs-color`).

### `[[settings]]`

Dichiara il form di **Impostazioni → Plugin → Impostazioni**. Senza nessuna voce, le
impostazioni sono un oggetto JSON libero.

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `key` | obbligatoria | La chiave nell'oggetto delle impostazioni: lettere, cifre e `_`, non inizia con una cifra, unica. |
| `label` | obbligatoria | L'etichetta nel form. |
| `type` | `"string"` | `string`, `text`, `url`, `number`, `integer`, `boolean` o `select`. |
| `description` | non impostata | Testo di aiuto sotto il campo. |
| `required` | `false` | Serve un valore (non vuoto per il testo), a meno che non ci sia un `default`. |
| `options` | `[]` | Le scelte di un `select` (obbligatorie in quel caso). |
| `default` | non impostato | Usato quando la chiave manca o è `null`. Deve essere compatibile con il campo. |
| `min`, `max` | non impostati | Limiti dei valori `number` e `integer`; limiti di lunghezza di `string` e `text`. |

I valori `url` sono vuoti o URL `http(s)://`. Con un form, il server rifiuta impostazioni con
chiavi sconosciute, tipi sbagliati, valori fuori dai limiti o valori obbligatori mancanti
(400).

## Funzioni esportate

Ogni funzione esportata riceve un documento JSON e ne restituisce uno (o niente). Un output
vuoto conta come `null`; un output che non è JSON conta come fallimento.

### Hook before

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

| Campo | Descrizione |
| --- | --- |
| `event` | L'evento dell'hook. |
| `uid` | Il tipo di contenuto. |
| `documentId` | Il documento, o `null` su `beforeCreate`. |
| `locale` | Sui tipi localizzati, la lingua scritta (la lingua di default quando la richiesta non ne indicava una); `null` sugli altri tipi. |
| `data` | I dati da scrivere, come li ha inviati la richiesta: su create e update. `null` per gli altri eventi. Su update, solo i campi inviati. |

Output:

| Output | Effetto |
| --- | --- |
| `{ "data": { … } }` | Sostituisce i dati scritti. Vengono validati come gli originali. |
| `{ "error": "message" }` | Rifiuta la scrittura: il chiamante riceve un 400 con il messaggio. |
| `{}` o qualsiasi altra cosa | La scrittura prosegue invariata. |

Quando più hook corrispondono, girano in ordine di plugin (nomi delle directory), poi in
ordine di manifest; ciascuno vede i dati restituiti dal precedente. Un hook che fallisce
(trap, timeout, output non valido) viene registrato nel log e saltato: la scrittura
prosegue.

### Hook after

Input: `{ "event", "uid", "documentId", "locale" }`, inviato dopo che la scrittura è stata
confermata. L'output viene ignorato; i fallimenti vengono registrati nel log. Leggi la voce
con `verdin_content` se ti servono i suoi campi (con la capability `read`).

### Route

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

| Campo | Descrizione |
| --- | --- |
| `method` | Il metodo HTTP. |
| `path` | Il path dopo `/api/plugins/<name>`, che inizia con `/` (`/` per la radice del plugin). |
| `query` | La query string grezza, senza `?` (vuota quando non c'è). |
| `headers` | Solo `content-type`, `accept`, `user-agent` e `accept-language`, quando presenti. |
| `body` | Il corpo della richiesta come stringa (l'UTF-8 non valido viene sostituito). |
| `actor` | Chi sta chiamando: `{ "kind": "public" }`, `{ "kind": "token", "id": 3 }` (un token API) o `{ "kind": "user", "id": 12 }` (un utente finale autenticato). |

Un header `Authorization` con un token non valido viene rifiutato con un 401 prima che il
plugin venga chiamato. I permessi dell'accesso pubblico e dei token API non vengono
applicati: verifica tu `actor`.

Output:

| Campo | Default | Descrizione |
| --- | --- | --- |
| `status` | `200` | Lo stato HTTP. |
| `headers` | nessuno | Header della risposta. Vengono mantenuti solo `content-type`, `cache-control`, `location`, `etag`, `last-modified` e `content-disposition`. |
| `body` | vuoto | Una stringa viene inviata così com'è (`text/plain` a meno che tu non imposti `content-type`); qualsiasi altro valore JSON viene inviato come `application/json`. |

Un plugin disattivato o sconosciuto, o uno senza `[routes]`, risponde 404. Una chiamata
fallita risponde 502 con `{ "data": null, "error": { "status": 502, "name": "PluginError", … } }`.
Le route condividono `[server].body_limit` e `[server].request_timeout_secs` della content
API.

### Job

Input: `{ "scheduledAt": "2026-09-29T03:00:00+00:00" }`, l'ora per cui l'esecuzione era
pianificata. L'output viene ignorato; i fallimenti vengono registrati nel log. I job girano
solo mentre il plugin è attivo, e solo sulle istanze con `[plugins].run_jobs = true`.
Un'esecuzione persa mentre il server era giù non viene recuperata.

### Campi GraphQL

Input: `{ "args": …, "actor": … }`, con `args` l'argomento `args` del campo (qualsiasi JSON,
o `null`) e `actor` come per le route. L'output è il valore del campo. Un fallimento, o un
plugin disattivato, risponde con un errore GraphQL con il codice `PLUGIN_ERROR`. Come per le
route, è il plugin a verificare l'accesso.

## Funzioni host

Importale dal namespace `extism:host/user` (`extern "ExtismHost"` in Rust). Ricevono e
restituiscono JSON come stringhe; `Json<Value>` in `extism-pdk` gestisce la conversione.

| Funzione | Input | Output |
| --- | --- | --- |
| `verdin_log` | `{ "level": "info" \| "warn" \| "error", "message": "…" }` | nessuno |
| `verdin_content` | Una richiesta di contenuto (sotto) | Il risultato, o `{ "error": "…" }` |
| `verdin_kv_get` | La chiave, come stringa semplice | Il valore JSON memorizzato, o `null` |
| `verdin_kv_set` | `{ "key": "…", "value": … }` | nessuno |
| `verdin_config` | nessuno | L'oggetto delle impostazioni, con i default dichiarati compilati |

### `verdin_log`

Scrive nel log del server (con il nome del plugin) e nel log del plugin in **Impostazioni →
Plugin → Log**. Gli altri livelli contano come `info`. Il log del plugin conserva in memoria
gli ultimi 200 messaggi, ciascuno troncato a 2.000 caratteri.

### `verdin_content`

```json
{ "op": "findMany", "uid": "api::article", "query": { "filters": { "title": { "$eq": "x" } }, "sort": ["title"] } }
```

| Campo | Usato da | Descrizione |
| --- | --- | --- |
| `op` | tutti | `findMany`, `findOne`, `create`, `update`, `delete`, `publish` o `unpublish`. |
| `uid` | tutti | Il tipo di contenuto. Deve essere nelle capability. |
| `documentId` | `findOne`, `update`, `delete`, `publish`, `unpublish` | Il documento. |
| `query` | `findMany`, `findOne` | I parametri dell'API REST come oggetto JSON: `filters`, `sort`, `fields`, `populate`, `pagination`, `status`. |
| `data` | `create`, `update` | I campi da scrivere, come nel `data` di una richiesta REST. |
| `status` | `create`, `update` | `"draft"` salva una bozza. Altrimenti la scrittura viene pubblicata, come una scrittura REST senza `?status=draft`. |
| `locale` | tutti | La lingua da leggere o scrivere. |

Risultati:

| `op` | Risultato |
| --- | --- |
| `findMany` | `{ "documents": [...], "meta": { "pagination": {…} } }` |
| `findOne` | `{ "document": {…} }` (`null` se non trovato) |
| `create`, `update` | `{ "documentId": "…" }` |
| `delete` | `{ "deleted": true }` |
| `publish` | `{ "published": true }` |
| `unpublish` | `{ "unpublished": true }` |

Una chiamata fuori dalle capability, un'operazione sconosciuta, un errore di validazione o
un documento mancante rispondono invece `{ "error": "…" }`. Le letture restituiscono le
versioni pubblicate a meno che la query non chieda `"status": "draft"`.

#### Scritture fatte dai plugin

Le scritture tramite `verdin_content` saltano gli hook **before** di tutti i plugin, così un
plugin non può entrare in loop sulle proprie modifiche. Tutto il resto si applica:
validazione, fasi di revisione, webhook, cronologia, log di audit, e gli hook **after** di
tutti i plugin, compreso quello che scrive. Proteggi un hook after che scrive sul tipo che
sta ascoltando.

### `verdin_kv_get` e `verdin_kv_set`

Un key-value store per plugin, nel database di Verdin, condiviso da tutte le istanze. Le
chiavi vanno da 1 a 255 byte; i valori sono qualsiasi JSON. Impostare `null` elimina la
chiave. Senza la capability `kv`, le letture restituiscono `null` e le scritture vengono
ignorate.

### `verdin_config`

Restituisce le impostazioni salvate in **Impostazioni → Plugin**, con il `default` di ogni
impostazione dichiarata compilato per le chiavi mancanti. `{}` quando non è salvato nulla.

### HTTP

Con gli host elencati in `http`, usa il supporto HTTP di Extism (`extism_pdk::http::request`
in Rust). Le richieste verso altri host falliscono.

## Punti di estensione dell'admin

Il pannello di amministrazione chiede al server le estensioni dei plugin attivi e importa
ogni `admin.script` una volta, come modulo ES, da `/admin/plugins/<name>/<script>` (sotto
`[admin].path`). I file sotto la directory `admin/` del plugin vengono serviti lì mentre il
plugin è attivo, con `X-Content-Type-Options: nosniff` e `Cache-Control: no-cache`. Il
modulo deve definire i custom element nominati dal manifest; un elemento non definito entro
3 secondi viene omesso.

### Widget

Ogni voce `[[admin.widgets]]` è un tipo di widget che gli admin possono aggiungere alla
dashboard. L'elemento riceve una proprietà `context`:

| Proprietà | Descrizione |
| --- | --- |
| `apiBase` | La base della content API, come `/api`. |
| `adminApiBase` | La base dell'API admin, come `/admin/api`. |
| `fetch(path, init)` | `fetch` con le credenziali dell'admin autenticato. I path relativi si risolvono rispetto ad `adminApiBase`; i path sotto una delle due basi e gli URL assoluti vengono mantenuti. |

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

`context.fetch` invia la sessione dell'admin solo con le richieste all'API admin. I path
sotto `context.apiBase` (la content API, comprese le route del tuo plugin) partono senza,
dato che la content API non accetta sessioni admin; ricevono risposta con i permessi del
ruolo pubblico. Prima della 0.10 inviava la sessione anche lì e quelle richieste fallivano; i
widget scritti per la 0.9 che chiamano `fetch` semplice continuano a funzionare.

### Campi personalizzati

Ogni voce `[[admin.fields]]` è un campo che gli attributi possono usare con
`"customField": "plugin::<name>.<id>"`; il `type` dell'attributo deve corrispondere al modo
in cui il campo memorizza il suo valore. Il **Costruttore di tipi di contenuto** lo propone.
L'elemento riceve:

| Proprietà | Descrizione |
| --- | --- |
| `value` | Il valore attuale. |
| `disabled` | Se la modifica è disattivata. |
| `attribute` | La definizione dell'attributo dallo schema. |
| `locale` | La lingua in modifica. |

Segnala un nuovo valore con un evento `change` il cui `detail` è il valore (o, senza
`detail`, tramite la propria proprietà `value`). Quando il plugin è disattivato o il suo
elemento manca, l'editor mostra l'input normale per il tipo di memorizzazione. Vedi
[Tipi di attributo](/it/reference/attribute-types/).

## Runtime e limiti

| Limite | Valore |
| --- | --- |
| Tempo per chiamata | `[limits].timeout_ms`, default 5.000 ms |
| Memoria | `[limits].memory_mb`, default 64 MB |
| Concorrenza | Una chiamata alla volta per plugin; le chiamate si aspettano a vicenda |
| Istanza del modulo | Una per plugin, costruita al primo uso; ricostruita dopo che una chiamata fallisce (la sua memoria va persa) |
| Log | 200 messaggi per plugin, 2.000 caratteri ciascuno, in memoria |
| Chiavi KV | Da 1 a 255 byte |
| Header di richiesta delle route | `content-type`, `accept`, `user-agent`, `accept-language` |
| Header di risposta delle route | `content-type`, `cache-control`, `location`, `etag`, `last-modified`, `content-disposition` |

Le modifiche a un manifest o a un modulo si applicano dopo un riavvio; interruttori e
impostazioni si applicano subito. Gestire i plugin richiede `plugins.manage` (vedi il
[riferimento dei permessi](/it/reference/permissions/)).
