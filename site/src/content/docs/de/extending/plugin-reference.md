---
title: Plugin-Referenz
description: Das Manifest plugin.toml, Fähigkeiten, Hooks und ihre Payloads, Host-Funktionen, Routen, Jobs, die Startfunktion, GraphQL-Felder, Erweiterungspunkte im Admin-Panel, Limits und Metriken.
sidebar:
  order: 3
---

<!-- Written from crates/verdin-plugins (lib.rs, manifest.rs), crates/verdin-api/src/plugins.rs,
plugins_admin.rs, crates/verdin-graphql/src/lib.rs, crates/verdin/src/metrics.rs and
admin/src/app/core/plugin-extensions.ts. -->

Diese Seite ist der vollständige Vertrag zwischen Verdin und einem Plugin: das Manifest, was
Verdin an jede exportierte Funktion schickt und zurückerwartet, und die Host-Funktionen, die ein
Modul aufrufen kann. Eine Einführung findest du unter [Plugins](/de/extending/plugins/), ein
durchgearbeitetes Beispiel im [Plugin-Tutorial](/de/extending/plugin-tutorial/).

## Plugin-Verzeichnis

Jedes Plugin ist ein Verzeichnis unter `[plugins].path` (standardmäßig `plugins/`, neben
`verdin.toml`):

| Datei | Pflicht | Inhalt |
| --- | --- | --- |
| `plugin.toml` | ja | Das Manifest. |
| `plugin.wasm` | ja | Das Modul (ein anderer Pfad mit `wasm`). |
| `admin/` | nein | Dateien, die das Admin-Panel lädt: das Modul `admin.script` und seine Assets. |

Beim Start lädt Verdin jedes Verzeichnis mit einer `plugin.toml`, in der Reihenfolge der Namen.
Ein Verzeichnis wird übersprungen und mit dem Grund unter **Einstellungen → Plugins**
aufgeführt, wenn sein Manifest ungültig ist, sein Modul fehlt oder ein anderes Plugin seinen
`name` schon belegt.

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

Unbekannte Schlüssel sind in jeder Tabelle Fehler.

### Schlüssel auf oberster Ebene

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `name` | Pflicht | Die ID des Plugins in URLs, Einstellungen und benutzerdefinierten Feldern: Kleinbuchstaben, Ziffern und `-`, beginnend mit einem Buchstaben, höchstens 64 Zeichen. |
| `version` | Pflicht | Wird im Admin-Panel und im Log angezeigt. |
| `description` | nicht gesetzt | Wird unter **Einstellungen → Plugins** angezeigt. |
| `wasm` | `"plugin.wasm"` | Das Modul, relativ zum Plugin-Verzeichnis (kein `..`, nicht absolut). |
| `wasi` | `false` | Gibt dem Modul WASI: eine Uhr und Zufallszahlen. Dateien oder Sockets gibt es so oder so nicht. |

### `[capabilities]`

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `read` | `[]` | Inhaltstypen, die `verdin_content` lesen darf (`findMany`, `findOne`): UIDs wie `api::article`, oder `"*"` für alle. |
| `write` | `[]` | Inhaltstypen, auf denen es `create`, `update`, `delete`, `publish` und `unpublish` ausführen darf. Schließt `read` ein. |
| `http` | `[]` | Hosts, an die das Modul HTTP-Anfragen senden darf: `api.example.com` oder `*.example.com`. |
| `kv` | `false` | Der eigene Key-Value-Speicher des Plugins (`verdin_kv_get`, `verdin_kv_set`). |
| `public_permissions` | `false` | Die Berechtigungen der öffentlichen Rolle für die Content-API lesen und ersetzen (`verdin_public_permissions`). |

Fähigkeiten begrenzen nur Host-Aufrufe. Hooks laufen auf den Typen, die sie nennen, egal was in
`read` steht, und Routen sind für jeden erreichbar.

### `[limits]`

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `timeout_ms` | `5000` | Zeitlimit eines Aufrufs, in Millisekunden. |
| `memory_mb` | `64` | Maximaler Speicher des Moduls, in Megabyte. |

Beide müssen positiv sein.

### `[[hooks]]`

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `on` | Pflicht | Das Event, siehe unten. |
| `uid` | `"*"` | Der Inhaltstyp (`api::article`), oder `"*"` für alle. |
| `function` | Pflicht | Die exportierte Funktion, die aufgerufen wird. |

Events:

| Vor dem Schreiben | Nach dem Schreiben |
| --- | --- |
| `beforeCreate` | `afterCreate` |
| `beforeUpdate` | `afterUpdate` |
| `beforeDelete` | `afterDelete` |
| `beforePublish` | `afterPublish` |
| `beforeUnpublish` | `afterUnpublish` |
| `beforeDiscardDraft` | `afterDiscardDraft` |

Die Namen sind die Lifecycle-Namen von Strapi. Hooks laufen bei Schreibvorgängen aus dem
Admin-Panel, den REST- und GraphQL-APIs und Releases, aber nicht bei Schreibvorgängen durch die
Befehle `verdin import`. Schreibvorgänge durch Plugins führen die After-Hooks aus, aber nicht die
Before-Hooks (siehe [Schreibvorgänge durch Plugins](#schreibvorgänge-durch-plugins)).

### `[routes]`

| Schlüssel | Beschreibung |
| --- | --- |
| `function` | Die exportierte Funktion, die jede Anfrage an `/api/plugins/<name>` und `/api/plugins/<name>/…` bedient, mit jeder Methode. |

Der Pfad folgt `[api].prefix`.

### `[startup]`

Eine Funktion, die beim Start des Plugins läuft: das, was ein Strapi-Projekt in `bootstrap` tut
(Inhalte anlegen, die öffentliche Rolle einrichten).

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `function` | erforderlich | Die exportierte Funktion, die aufgerufen wird. |
| `timeout_ms` | `30000` | Ihr eigenes Zeitlimit in Millisekunden (Seeding kann länger dauern als ein Hook). Muss positiv sein. |

Siehe [Startfunktion](#startfunktion), wann sie läuft.

### `[[jobs]]`

| Schlüssel | Beschreibung |
| --- | --- |
| `schedule` | Cron-Ausdruck in UTC, optional mit Sekunden: `*/15 * * * *`, `0 0 3 * * *`. |
| `function` | Die exportierte Funktion, die aufgerufen wird. |

### `[[graphql]]`

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `name` | Pflicht | Der Feldname: beginnt mit einem Kleinbuchstaben, gefolgt von Buchstaben, Ziffern und `_`. |
| `function` | Pflicht | Die exportierte Funktion, die das Feld auflöst. |
| `mutation` | `false` | Fügt das Feld zu `Mutation` statt zu `Query` hinzu. |
| `description` | nicht gesetzt | Die Beschreibung des Felds im Schema. |

Jeder Eintrag ergänzt `name(args: JSON): JSON`. Ein Name, den schon ein Inhaltstyp nutzt oder
den ein anderes Plugin zuerst belegt hat, wird mit einer Warnung im Log übersprungen.

### `[admin]`

| Schlüssel | Beschreibung |
| --- | --- |
| `script` | ES-Modul unter `admin/`, das die Custom Elements definiert (kein `..`, nicht absolut). |
| `[[admin.widgets]]` | Widget-Typen fürs Dashboard: `id`, `title`, `element`, optional `description`. |
| `[[admin.fields]]` | Benutzerdefinierte Felder: `id`, `title`, `element`, `type` (der Attributtyp, als der der Wert gespeichert wird, etwa `string` oder `json`), optional `description`. |

`element` ist der Name eines Custom Elements: Kleinbuchstaben, Ziffern und `-`, mit mindestens
einem `-` (`slugs-color`).

### `[[settings]]`

Deklariert das Formular unter **Einstellungen → Plugins → Einstellungen**. Ohne Einträge sind
die Einstellungen ein freies JSON-Objekt.

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `key` | Pflicht | Der Schlüssel im Einstellungsobjekt: Buchstaben, Ziffern und `_`, nicht mit einer Ziffer beginnend, eindeutig. |
| `label` | Pflicht | Die Beschriftung im Formular. |
| `type` | `"string"` | `string`, `text`, `url`, `number`, `integer`, `boolean` oder `select`. |
| `description` | nicht gesetzt | Hilfetext unter dem Feld. |
| `required` | `false` | Ein Wert (bei Text nicht leer) ist nötig, sofern es kein `default` gibt. |
| `options` | `[]` | Die Auswahlmöglichkeiten eines `select` (dort Pflicht). |
| `default` | nicht gesetzt | Wird verwendet, wenn der Schlüssel fehlt oder `null` ist. Muss zum Feld passen. |
| `min`, `max` | nicht gesetzt | Grenzen für `number`- und `integer`-Werte; Längengrenzen für `string` und `text`. |

`url`-Werte sind leer oder `http(s)://`-URLs. Mit einem Formular lehnt der Server Einstellungen
mit unbekannten Schlüsseln, falschen Typen, Werten außerhalb der Grenzen oder fehlenden
Pflichtwerten ab (400).

## Exportierte Funktionen

Jede exportierte Funktion nimmt ein JSON-Dokument entgegen und gibt eines zurück (oder nichts).
Eine leere Ausgabe zählt als `null`; eine Ausgabe, die kein JSON ist, zählt als Fehlschlag.

### Before-Hooks

Eingabe:

```json
{
  "event": "beforeUpdate",
  "uid": "api::article",
  "documentId": "01m3p88ry359w82nsx496mep5t",
  "locale": "en",
  "data": { "title": "Hello" }
}
```

| Feld | Beschreibung |
| --- | --- |
| `event` | Das Event des Hooks. |
| `uid` | Der Inhaltstyp. |
| `documentId` | Das Dokument, oder `null` bei `beforeCreate`. |
| `locale` | Bei lokalisierten Typen die geschriebene Sprache (die Standardsprache, wenn die Anfrage keine nannte); bei anderen Typen `null`. |
| `data` | Die Daten, die geschrieben werden, so wie die Anfrage sie geschickt hat: bei create und update. Bei den anderen Events `null`. Bei update nur die gesendeten Felder. |

Ausgabe:

| Ausgabe | Wirkung |
| --- | --- |
| `{ "data": { … } }` | Ersetzt die geschriebenen Daten. Sie werden wie das Original validiert. |
| `{ "error": "message" }` | Lehnt den Schreibvorgang ab: Der Aufrufer bekommt ein 400 mit der Meldung. |
| `{}` oder alles andere | Der Schreibvorgang läuft unverändert weiter. |

Passen mehrere Hooks, laufen sie in der Reihenfolge der Plugins (Verzeichnisnamen), dann in der
Reihenfolge des Manifests; jeder sieht die Daten, die der vorige zurückgegeben hat. Ein Hook, der
fehlschlägt (Trap, Timeout, ungültige Ausgabe), wird protokolliert und übersprungen: Der
Schreibvorgang läuft weiter.

### After-Hooks

Eingabe: `{ "event", "uid", "documentId", "locale" }`, gesendet nach dem Commit des
Schreibvorgangs. Die Ausgabe wird ignoriert; Fehlschläge werden protokolliert. Lies den Eintrag
mit `verdin_content`, wenn du seine Felder brauchst (mit der Fähigkeit `read`).

### Routen

Eingabe:

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

| Feld | Beschreibung |
| --- | --- |
| `method` | Die HTTP-Methode. |
| `path` | Der Pfad nach `/api/plugins/<name>`, beginnend mit `/` (`/` für die Wurzel des Plugins). |
| `query` | Der rohe Query-String, ohne `?` (leer, wenn keiner da ist). |
| `headers` | Nur `content-type`, `accept`, `user-agent` und `accept-language`, sofern vorhanden. |
| `body` | Der Request-Body als String (ungültiges UTF-8 wird ersetzt). |
| `actor` | Wer aufruft: `{ "kind": "public" }`, `{ "kind": "token", "id": 3 }` (ein API-Token) oder `{ "kind": "user", "id": 12 }` (ein angemeldeter Endnutzer). |

Ein `Authorization`-Header mit ungültigem Token wird mit 401 abgelehnt, bevor das Plugin
aufgerufen wird. Berechtigungen für öffentlichen Zugriff und API-Tokens werden nicht angewendet:
Prüfe `actor` selbst.

Ausgabe:

| Feld | Standard | Beschreibung |
| --- | --- | --- |
| `status` | `200` | Der HTTP-Status. |
| `headers` | keine | Response-Header. Nur `content-type`, `cache-control`, `location`, `etag`, `last-modified` und `content-disposition` bleiben erhalten. |
| `body` | leer | Ein String wird unverändert gesendet (`text/plain`, sofern du kein `content-type` setzt); jeder andere JSON-Wert wird als `application/json` gesendet. |

Ein deaktiviertes oder unbekanntes Plugin oder eines ohne `[routes]` antwortet mit 404. Ein
fehlgeschlagener Aufruf antwortet mit 502 und
`{ "data": null, "error": { "status": 502, "name": "PluginError", … } }`. Routen teilen sich
`[server].body_limit` und `[server].request_timeout_secs` mit der Content-API.

### Jobs

Eingabe: `{ "scheduledAt": "2026-09-29T03:00:00+00:00" }`, der Zeitpunkt, für den der Lauf
geplant war. Die Ausgabe wird ignoriert; Fehlschläge werden protokolliert. Jobs laufen nur,
solange das Plugin eingeschaltet ist, und nur auf Instanzen mit `[plugins].run_jobs = true`. Ein
Lauf, der verpasst wurde, während der Server aus war, wird nicht nachgeholt.

### Startfunktion

Eingabe: `{ "reason": "start" | "enabled" | "settings" }`:

| `reason` | Wann |
| --- | --- |
| `start` | Der Server ist mit eingeschaltetem Plugin gestartet. |
| `enabled` | Das Plugin wurde eingeschaltet (hier, oder auf einer anderen Instanz und hier übernommen). |
| `settings` | Seine Einstellungen haben sich geändert, während es eingeschaltet war (hier gespeichert oder von einer anderen Instanz übernommen). |

Ausgabe: `{ "error": "message" }` gilt als Fehlschlag; alles andere (`{}`, leer) als Erfolg. Ein
Fehlschlag (Trap, Timeout, `{ error }`) geht ins Log des Plugins und ins Server-Log; das Plugin
bleibt eingeschaltet, und die Funktion läuft beim nächsten Start, Einschalten oder bei der
nächsten Änderung der Einstellungen erneut.

Die Funktion läuft im Hintergrund, nachdem der Server oben ist, Anfragen werden also
währenddessen bedient. Sie läuft auf einer eigenen Modulinstanz mit `[startup].timeout_ms`, ein
langsames Seeding hält also die Hooks und Routen des Plugins nicht auf. After-Hooks, die durch
ihre Schreibvorgänge ausgelöst werden, laufen, sobald sie zurückkehrt (siehe
[Schreibvorgänge durch Plugins](#schreibvorgänge-durch-plugins)). Der Speicher des Moduls wird
nicht mit der regulären Instanz des Plugins geteilt: Halte Zustand in `verdin_kv_set` oder in
Inhalten.

Bei mehreren Instanzen führen nur die mit `[plugins].run_jobs = true` Startfunktionen aus (eine
Instanz, wenn du dem [Skalierungs-Rat](/de/deploy/scaling/) folgst): Sie wirken auf die
gemeinsame Datenbank, einmal genügt also. Schreibe die Funktion so, dass ein erneuter Lauf
harmlos ist: Suche nach dem, was du anlegst, bevor du es erstellst.

### GraphQL-Felder

Eingabe: `{ "args": …, "actor": … }`, wobei `args` das Argument `args` des Felds ist (beliebiges
JSON oder `null`) und `actor` wie bei Routen. Die Ausgabe ist der Wert des Felds. Ein
Fehlschlag oder ein deaktiviertes Plugin ergibt einen GraphQL-Fehler mit dem Code
`PLUGIN_ERROR`. Wie bei Routen prüft das Plugin den Zugriff selbst.

## Host-Funktionen

Importiere sie aus dem Namespace `extism:host/user` (`extern "ExtismHost"` in Rust). Sie nehmen
und liefern JSON als Strings; `Json<Value>` in `extism-pdk` übernimmt die Umwandlung.

| Funktion | Eingabe | Ausgabe |
| --- | --- | --- |
| `verdin_log` | `{ "level": "info" \| "warn" \| "error", "message": "…" }` | keine |
| `verdin_content` | Eine Content-Anfrage (siehe unten) | Das Ergebnis, oder `{ "error": "…" }` |
| `verdin_kv_get` | Der Schlüssel, als einfacher String | Der gespeicherte JSON-Wert, oder `null` |
| `verdin_kv_set` | `{ "key": "…", "value": … }` | keine |
| `verdin_config` | keine | Das Einstellungsobjekt, mit ergänzten deklarierten Standardwerten |
| `verdin_public_permissions` | `{ "op": "get" }` oder `{ "op": "set", "permissions": [...] }` | `{ "permissions": [...] }` oder `{ "error": "…" }` |

Ein Modul, das eine Host-Funktion importiert, die der Server nicht hat (ein älteres Verdin), kann
nicht geladen werden: Jeder Aufruf schlägt mit `unknown import` im Server-Log fehl.

### `verdin_log`

Schreibt ins Server-Log (mit dem Namen des Plugins) und ins Log des Plugins unter
**Einstellungen → Plugins → Protokolle**. Andere Level zählen als `info`. Das Log des Plugins
behält die letzten 200 Meldungen im Speicher, jede auf 2.000 Zeichen gekürzt.

### `verdin_content`

```json
{ "op": "findMany", "uid": "api::article", "query": { "filters": { "title": { "$eq": "x" } }, "sort": ["title"] } }
```

| Feld | Genutzt von | Beschreibung |
| --- | --- | --- |
| `op` | allen | `findMany`, `findOne`, `create`, `update`, `delete`, `publish` oder `unpublish`. |
| `uid` | allen | Der Inhaltstyp. Muss in den Fähigkeiten stehen. |
| `documentId` | `findOne`, `update`, `delete`, `publish`, `unpublish` | Das Dokument. |
| `query` | `findMany`, `findOne` | Die Parameter der REST-API als JSON-Objekt: `filters`, `sort`, `fields`, `populate`, `pagination`, `status`. |
| `data` | `create`, `update` | Die zu schreibenden Felder, wie im `data` einer REST-Anfrage. |
| `status` | `create`, `update` | `"draft"` speichert einen Entwurf. Andernfalls wird der Schreibvorgang veröffentlicht, wie ein REST-Schreibvorgang ohne `?status=draft`. |
| `locale` | allen | Die Sprache, die gelesen oder geschrieben wird. |

Ergebnisse:

| `op` | Ergebnis |
| --- | --- |
| `findMany` | `{ "documents": [...], "meta": { "pagination": {…} } }` |
| `findOne` | `{ "document": {…} }` (`null`, wenn nicht gefunden) |
| `create`, `update` | `{ "documentId": "…" }` |
| `delete` | `{ "deleted": true }` |
| `publish` | `{ "published": true }` |
| `unpublish` | `{ "unpublished": true }` |

Ein Aufruf außerhalb der Fähigkeiten, eine unbekannte Operation, ein Validierungsfehler oder ein
fehlendes Dokument ergibt stattdessen `{ "error": "…" }`. Lesezugriffe liefern veröffentlichte
Versionen, sofern die Abfrage nicht `"status": "draft"` verlangt.

#### Schreibvorgänge durch Plugins

Schreibvorgänge über `verdin_content` überspringen die **Before**-Hooks aller Plugins, sodass
ein Plugin dort nicht in eine Schleife über seine eigenen Änderungen geraten kann, und Regeln in
Before-Hooks (Standardwerte, Prüfungen) gelten für sie nicht. Alles andere gilt: Validierung,
Review-Phasen, Webhooks, Verlauf, Audit-Log und die **After**-Hooks aller Plugins, das
schreibende eingeschlossen.

After-Hooks, die durch die Schreibvorgänge eines Plugins ausgelöst werden, laufen nicht im
Schreibvorgang: Sie werden eingereiht und laufen, sobald der Aufruf des Plugins (Route, Job,
GraphQL-Resolver, Hook oder Startfunktion) zurückgekehrt ist und die Instanz des Plugins
freigegeben hat, vor dem Senden der Antwort der Route. So kann ein Plugin einen Typ schreiben,
auf dem es After-Hooks hat, und Ketten über mehrere Plugins funktionieren.

- Hooks, die schreiben, lösen weitere Hooks aus, **höchstens `4` Ebenen tief** (ein
  Schreibvorgang über REST oder GraphQL ist Ebene 1). Tiefere Hooks werden mit einer Warnung im
  Log des Plugins übersprungen, was verhindert, dass ein Hook, der den Typ schreibt, auf den er
  hört, endlos schleift.
- Host-Funktionen (`verdin_content`, `verdin_public_permissions`, der Key-Value-Speicher) halten
  am Zeitlimit des Aufrufs an und geben dem Modul einen Fehler zurück, und ein Aufrufer wartet
  bei einem ausgelasteten Plugin höchstens das Zeitlimit plus 10 Sekunden. Ein hängender Aufruf
  kann das Plugin oder einen geordneten Stopp nicht ewig blockieren.

### `verdin_kv_get` und `verdin_kv_set`

Ein Key-Value-Speicher pro Plugin in der Datenbank von Verdin, von allen Instanzen geteilt.
Schlüssel sind 1 bis 255 Bytes lang; Werte sind beliebiges JSON. `null` zu setzen löscht den
Schlüssel. Ohne die Fähigkeit `kv` liefern Lesezugriffe `null`, und Schreibzugriffe werden
ignoriert.

### `verdin_config`

Liefert die unter **Einstellungen → Plugins** gespeicherten Einstellungen, wobei für fehlende
Schlüssel der `default` jeder deklarierten Einstellung ergänzt wird. `{}`, wenn nichts
gespeichert ist.

### `verdin_public_permissions`

Liest oder ersetzt die Berechtigungen der öffentlichen Rolle für die Content-API, das, was
**Einstellungen → Öffentlicher Zugriff** bearbeitet. Braucht die Fähigkeit
`public_permissions`; ohne sie antwortet jeder Aufruf mit `{ "error": "…" }`.

```json
{ "op": "set", "permissions": [
  { "subject": "api::article", "action": "find" },
  { "subject": "api::article", "action": "findOne" },
  { "subject": "api::comment", "action": "create" }
] }
```

| `op` | Wirkung |
| --- | --- |
| `get` | Nichts; liefert die aktuellen Berechtigungen. |
| `set` | Ersetzt **alle** öffentlichen Berechtigungen durch `permissions` (eine leere Liste entfernt alle). |

Beide antworten mit `{ "permissions": [{ "subject", "action" }, …] }`, sortiert. `subject` ist
eine UID eines Inhaltstyps, `plugin::upload` (die Medienbibliothek),
`plugin::users-permissions.user` (Endbenutzer über die Content-API) oder
`plugin::i18n.locale` (nur `find`). `action` ist `find`, `findOne`, `create`, `update`,
`delete`, `publish` oder `readDrafts` (die letzten beiden gelten nicht für Uploads und
Endbenutzer). Sie werden wie das Berechtigungsraster des Admins geprüft: Ein unbekanntes
Subject oder eine unbekannte Aktion, oder eine, die nicht zutrifft, antwortet mit
`{ "error": "…" }` und ändert nichts. Jedes `set` wird ins Server-Log geschrieben.

### HTTP

Mit Hosts in `http` nutzt du die HTTP-Unterstützung von Extism (`extism_pdk::http::request` in
Rust). Anfragen an andere Hosts schlagen fehl.

## Erweiterungspunkte im Admin-Panel

Das Admin-Panel fragt den Server nach den Erweiterungen der eingeschalteten Plugins und
importiert jedes `admin.script` einmal als ES-Modul von `/admin/plugins/<name>/<script>` (unter
`[admin].path`). Dateien im Verzeichnis `admin/` des Plugins werden dort ausgeliefert, solange
das Plugin eingeschaltet ist, mit `X-Content-Type-Options: nosniff` und
`Cache-Control: no-cache`. Das Modul muss die Custom Elements definieren, die das Manifest
nennt; ein Element, das nicht innerhalb von 3 Sekunden definiert ist, wird weggelassen.

### Widgets

Jeder Eintrag in `[[admin.widgets]]` ist ein Widget-Typ, den Admins zum Dashboard hinzufügen
können. Das Element bekommt eine Eigenschaft `context`:

| Eigenschaft | Beschreibung |
| --- | --- |
| `apiBase` | Die Basis der Content-API, etwa `/api`. |
| `adminApiBase` | Die Basis der Admin-API, etwa `/admin/api`. |
| `fetch(path, init)` | `fetch` mit den Zugangsdaten des angemeldeten Admins. Relative Pfade werden gegen `adminApiBase` aufgelöst; Pfade unter einer der beiden Basen und absolute URLs bleiben unverändert. |

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

`context.fetch` schickt die Sitzung des Admins nur bei Anfragen an die Admin-API mit. Pfade unter
`context.apiBase` (die Content-API, die Routen deines Plugins eingeschlossen) gehen ohne sie
raus, da die Content-API keine Admin-Sitzungen akzeptiert; sie werden mit den Berechtigungen der
öffentlichen Rolle beantwortet. Vor 0.10 schickte es die Sitzung auch dorthin, und diese
Anfragen schlugen fehl; für 0.9 geschriebene Widgets, die einfaches `fetch` aufrufen,
funktionieren weiterhin.

### Benutzerdefinierte Felder

Jeder Eintrag in `[[admin.fields]]` ist ein Feld, das Attribute mit
`"customField": "plugin::<name>.<id>"` nutzen können; der `type` des Attributs muss dazu passen,
wie das Feld seinen Wert speichert. Der **Content-Type Builder** bietet es an. Das Element
bekommt:

| Eigenschaft | Beschreibung |
| --- | --- |
| `value` | Der aktuelle Wert. |
| `disabled` | Ob die Bearbeitung ausgeschaltet ist. |
| `attribute` | Die Definition des Attributs aus dem Schema. |
| `locale` | Die Sprache, die bearbeitet wird. |

Es meldet einen neuen Wert mit einem `change`-Event, dessen `detail` der Wert ist (oder, ohne
`detail`, über seine eigene Eigenschaft `value`). Ist das Plugin aus oder fehlt sein Element,
zeigt der Editor das normale Eingabefeld für den Speichertyp. Siehe
[Attributtypen](/de/reference/attribute-types/).

## Laufzeit und Limits

| Limit | Wert |
| --- | --- |
| Zeit pro Aufruf | `[limits].timeout_ms`, standardmäßig 5.000 ms (`[startup].timeout_ms`, standardmäßig 30.000 ms, für die Startfunktion) |
| Speicher | `[limits].memory_mb`, standardmäßig 64 MB |
| Nebenläufigkeit | Ein Aufruf pro Plugin gleichzeitig; Aufrufe warten aufeinander (die Startfunktion läuft neben ihnen) |
| Modulinstanz | Eine pro Plugin, bei der ersten Nutzung gebaut; nach einem fehlgeschlagenen Aufruf neu gebaut (sein Speicher geht verloren). Die Startfunktion bekommt bei jedem Lauf eine frische |
| Log | 200 Meldungen pro Plugin, je 2.000 Zeichen, im Speicher |
| KV-Schlüssel | 1 bis 255 Bytes |
| Request-Header von Routen | `content-type`, `accept`, `user-agent`, `accept-language` |
| Response-Header von Routen | `content-type`, `cache-control`, `location`, `etag`, `last-modified`, `content-disposition` |

Änderungen an einem Manifest oder Modul gelten nach einem Neustart; Schalter und Einstellungen
gelten sofort. Plugins zu verwalten braucht `plugins.manage` (siehe die
[Referenz der Berechtigungen](/de/reference/permissions/)).

## Metriken

Mit eingeschaltetem [`[metrics]`](/de/deploy/monitoring/) meldet `/_metrics` jeden Aufruf, der
eine exportierte Funktion erreicht hat:

| Metrik | Typ | Labels | Bedeutung |
| --- | --- | --- | --- |
| `verdin_plugin_call_duration_seconds` | Histogramm | `plugin`, `kind`, `function` | Dauer der Plugin-Funktionen. Buckets von 5 ms bis 10 s. |
| `verdin_plugin_call_errors_total` | Counter | `plugin`, `kind`, `function` | Fehlgeschlagene Aufrufe: ein Trap, ein Timeout, eine Ausgabe, die kein JSON ist, oder ein `{ error }` einer Startfunktion. |

`kind` ist `hook`, `route`, `job`, `startup` oder `graphql`. Ein Before-Hook, der einen
Schreibvorgang mit `{ error }` ablehnt, hat eine Antwort gegeben und zählt daher nicht als
Fehlschlag. Aufrufe einer Funktion, die das Modul nicht exportiert, werden nicht erfasst, die
Labels bleiben also durch die installierten Plugins begrenzt. Die Serien erscheinen nach dem
ersten Aufruf eines Plugins; jede Instanz zählt ihre eigenen Aufrufe.
