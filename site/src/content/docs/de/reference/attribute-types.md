---
title: Referenz der Attributtypen
description: Jeder Attributtyp einer Verdin-Schemadatei, mit seinen Optionen, Validierungen, der Speicherung in der Datenbank und der Darstellung in der API.
sidebar:
  order: 4
  label: Attributtypen
---

<!-- Written from crates/verdin-schema (convert.rs, validate.rs, model.rs),
crates/verdin-migrate/src/derive.rs and sql.rs (storage), and crates/verdin-content
(input.rs, output.rs, blocks.rs) (API). -->

Attribute sind die Felder eines Inhaltstyps oder einer Komponente, deklariert unter
`attributes` in ihrer Schemadatei. Diese Seite listet jeden `type`, die Optionen, die er
akzeptiert, wie Verdin ihn validiert und speichert und wie er in der API aussieht. Das Format
ist das von Strapi v5; die Unterschiede stehen [am Ende](#unterschiede-zu-strapi).

```json title="schema/content-types/article.json"
{
  "kind": "collectionType",
  "singularName": "article",
  "pluralName": "articles",
  "displayName": "Article",
  "options": { "draftAndPublish": true },
  "attributes": {
    "title": { "type": "string", "required": true, "maxLength": 200 },
    "slug": { "type": "uid", "targetField": "title", "required": true },
    "readingTime": { "type": "integer", "min": 0 },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "seo": { "type": "component", "component": "shared.seo" }
  }
}
```

Schemadateien sind streng: Ein unbekannter Schlüssel oder eine Option, die der Typ nicht
akzeptiert, ist ein Fehler, den `verdin schema check` mit seinem Pfad meldet
(`attributes.title.maxLength`).

## Optionen, die jedes Attribut akzeptiert

| Option | Standard | Beschreibung |
| --- | --- | --- |
| `type` | Pflicht | Einer der Typen unten. |
| `required` | `false` | Ein Wert muss vorhanden sein. Geprüft, wenn ein Eintrag veröffentlicht wird (Entwürfe dürfen unvollständig sein), und bei jedem Schreiben eines Typs ohne Entwurf und Veröffentlichung. Gilt auch in Komponenten und Dynamic Zones. |
| `private` | `false` | Wird von der Content-API nie zurückgegeben und ist in `filters` und `sort` nicht nutzbar. `password`-Attribute sind immer privat. |
| `configurable` | `true` | Das Flag von Strapi für den Builder des Admin-Panels; bleibt, wie es geschrieben ist. |
| `pluginOptions.i18n.localized` | `true` | In einem lokalisierten Inhaltstyp teilt `false` den Wert über alle Sprachen, statt einen Wert pro Sprache zu führen. |
| `customField` | nicht gesetzt | `plugin::<plugin>.<field>` (oder `global::<field>`): Das Admin-Panel bearbeitet das Attribut mit einem benutzerdefinierten Feld eines Plugins. Der `type` bestimmt, wie der Wert gespeichert wird. Siehe [Plugins](/de/extending/plugins/). |
| `conditions` | nicht gesetzt | Die bedingten Felder von Strapi (`{ "visible": <JSON Logic> }`). Der Editor blendet das Feld aus, solange die Regel falsch ist, und der Server verlangt ein ausgeblendetes Feld nicht. |
| `default` | nicht gesetzt | Wert neuer Einträge, wenn der Schreibvorgang das Attribut weglässt. Muss für den Typ gültig sein. Nicht jeder Typ akzeptiert einen (siehe jeden Typ). |

Attributnamen beginnen mit einem Buchstaben, gefolgt von Buchstaben, Ziffern und `_`, höchstens
50 Zeichen. In Inhaltstypen sind `id`, `documentId`, `locale`, `publicationState`,
`publishedAt`, `createdAt`, `updatedAt`, `createdBy` und `updatedBy` reserviert, in Komponenten
`id`. Zwei Namen, die auf dieselbe Spalte abgebildet werden (`metaTitle` und `meta_title`),
sind ein Fehler.

### Wo Werte gespeichert werden

Jedes Attribut eines Inhaltstyps ist eine Spalte in der Tabelle des Typs (`collectionName` oder
der Pluralname), benannt in `snake_case`. Relationen und Medien liegen stattdessen in
Verknüpfungstabellen. Ein Entwurf und seine veröffentlichte Version sind zwei Zeilen, bei
lokalisierten Typen je eine pro Sprache.

Spaltentypen pro Datenbank:

| Spalte | PostgreSQL | MySQL und MariaDB | SQLite |
| --- | --- | --- | --- |
| varchar | `varchar(255)` | `varchar(255)` | `text` |
| text | `text` | `longtext` | `text` |
| integer | `integer` | `int` | `integer` |
| bigint | `bigint` | `bigint` | `integer` |
| double | `double precision` | `double` | `real` |
| decimal | `numeric(p,s)` | `decimal(p,s)` | `text` (exakt) |
| boolean | `boolean` | `tinyint(1)` | `integer` |
| date | `date` | `date` | `text` |
| time | `time(3)` | `time(3)` | `text` |
| datetime | `timestamptz(3)` | `datetime(3)` | `text` |
| json | `jsonb` | `json` | `text` |

Ein Inhaltstyp darf höchstens 60 Attribute vom Typ `string`, `email`, `uid` und `enumeration`
haben (die Zeilengrößengrenze von MySQL); nimm für mehr `text`.

### `unique`

Typen, die `unique: true` akzeptieren, bekommen einen eindeutigen Index auf
`(column, locale, publication_state)`: Zwei veröffentlichte Einträge oder zwei Entwürfe in
derselben Sprache können keinen Wert teilen, ein Entwurf und seine eigene veröffentlichte
Version aber schon. Ein Schreibvorgang, der das verletzt, scheitert mit einem
Validierungsfehler am Attribut. In Komponenten wird `unique` akzeptiert, aber nicht
durchgesetzt (Komponentenwerte werden als JSON gespeichert).

## Text

### `string`

Eine einzelne Textzeile.

| Option | Beschreibung |
| --- | --- |
| `minLength`, `maxLength` | Längengrenzen in Zeichen. `maxLength` ist höchstens 255. |
| `regex` | Ein Muster, zu dem der Wert passen muss. JavaScript-ähnliche Syntax, einschließlich Lookaround und Rückverweisen. |
| `unique` | Siehe [`unique`](#unique). |
| `default` | Ein String innerhalb der Grenzen, der zu `regex` passt. |

Gespeichert als `varchar(255)`. API: ein String.

### `text`

Längerer einfacher Text (ein Textbereich im Admin-Panel).

| Option | Beschreibung |
| --- | --- |
| `minLength`, `maxLength` | Längengrenzen, ohne Obergrenze. |
| `default` | Ein String innerhalb der Grenzen. |

Gespeichert als `text` (`longtext` auf MySQL). API: ein String.

### `richtext`

Text in Markdown. Gleiche Optionen, Speicherung und API wie `text`; das Admin-Panel bearbeitet
ihn mit dem Markdown-Editor.

### `blocks`

Rich Text als Blocks-JSON von Strapi: eine Liste von Blöcken vom Typ `paragraph`, `heading`
(`level` 1 bis 6), `list` (`format` `ordered` oder `unordered`, mit `list-item`-Kindern, bis zu
8 Ebenen verschachtelt), `quote`, `code` (optional `language`) und `image`. Inline-Kinder sind
`text`-Knoten mit den Auszeichnungen `bold`, `italic`, `underline`, `strikethrough` und `code`
sowie `link`-Knoten. Höchstens 10.000 Blöcke.

Keine Optionen, kein `default`. Gespeichert als JSON. API: die Liste der Blöcke, wie
geschrieben.

```json
[
  { "type": "heading", "level": 2, "children": [{ "type": "text", "text": "Hello" }] },
  { "type": "paragraph", "children": [{ "type": "text", "text": "bold", "bold": true }] }
]
```

### `email`

Eine E-Mail-Adresse (`name@domain.tld`, ohne Leerzeichen).

| Option | Beschreibung |
| --- | --- |
| `minLength`, `maxLength` | Längengrenzen; `maxLength` höchstens 255. |
| `unique` | Siehe [`unique`](#unique). |
| `default` | Eine E-Mail-Adresse. |

Gespeichert als `varchar(255)`. API: ein String.

### `password`

Ein Geheimnis, beim Schreiben mit Argon2id gehasht.

| Option | Beschreibung |
| --- | --- |
| `minLength`, `maxLength` | Längengrenzen des Passworts, wie es gesendet wird. |

Kein `default`. Immer privat: nie zurückgegeben, gefiltert oder sortiert. Nicht erlaubt in
Komponenten. Gespeichert als `varchar(255)` (der Hash). Importe behalten bestehende bcrypt- und
Argon2-Hashes, wie sie sind, sodass sich importierte Konten weiterhin anmelden können.

### `uid`

Ein Bezeichner für URLs, etwa ein Slug. Das Admin-Panel erzeugt ihn aus `targetField`.

| Option | Beschreibung |
| --- | --- |
| `targetField` | Ein Attribut vom Typ `string` oder `text` desselben Typs, aus dem der Wert erzeugt wird. |
| `minLength`, `maxLength` | Längengrenzen; `maxLength` höchstens 255. |
| `regex` | Das Muster, zu dem Werte passen müssen; ohne Angabe `^[A-Za-z0-9\-_.~]*$`. |
| `default` | Ein gültiger Wert. |

Immer eindeutig (siehe [`unique`](#unique)). Gespeichert als `varchar(255)`. API: ein String.

### `enumeration`

Ein Wert aus einer festen Liste.

| Option | Beschreibung |
| --- | --- |
| `enum` | Die Werte: mindestens einer, jeder 1 bis 255 Zeichen, ohne Duplikate. |
| `default` | Einer der Werte. |

Gespeichert als `varchar(255)`. API: ein String. Schreibvorgänge mit jedem anderen Wert
scheitern.

## Zahlen

### `integer`

Eine 32-Bit-Ganzzahl (−2.147.483.648 bis 2.147.483.647).

| Option | Beschreibung |
| --- | --- |
| `min`, `max` | Grenzen (Ganzzahlen). |
| `unique` | Siehe [`unique`](#unique). |
| `default` | Eine Ganzzahl innerhalb der Grenzen. |

Gespeichert als `integer`. API: eine Zahl. Schreibvorgänge akzeptieren Zahlen und
Ganzzahl-Strings.

### `biginteger`

Eine 64-Bit-Ganzzahl. Gleiche Optionen wie `integer`.

Gespeichert als `bigint`. API: ein String (`"9007199254740993"`), wie bei Strapi, weil
JavaScript-Zahlen jenseits von 2⁵³ an Präzision verlieren. Schreibvorgänge akzeptieren Strings
und Zahlen.

### `float`

Eine Gleitkommazahl mit doppelter Genauigkeit. Gleiche Optionen wie `integer`, mit Zahlen als
Grenzen.

Gespeichert als `double precision` (`double`, `real`). API: eine Zahl.

### `decimal`

Eine exakte Dezimalzahl.

| Option | Standard | Beschreibung |
| --- | --- | --- |
| `precision` | `10` | Ziffern insgesamt, 1 bis 38. |
| `scale` | `2` | Ziffern nach dem Dezimalpunkt, höchstens `precision`. |
| `min`, `max` | | Grenzen. |
| `unique` | | Siehe [`unique`](#unique). |
| `default` | | Eine Zahl innerhalb der Grenzen. |

Werte werden auf `scale` Ziffern gerundet (kaufmännisch, weg von null, wie es die Datenbanken
tun) und abgelehnt, wenn sie vor dem Punkt mehr als `precision - scale` Ziffern haben.
Schreibvorgänge akzeptieren Zahlen und numerische Strings. Gespeichert als
`numeric(precision,scale)` (auf SQLite `text`, damit nichts gerundet wird). API: eine Zahl, wie Strapi sie zurückgibt.
Ganze Werte sind Ganzzahlen (`25`, nicht `25.0`), andere der kürzeste Float, der sich gleich
zurücklesen lässt (`12.5`). Mit [`[api].decimal_as_string`](/de/reference/configuration/) gibt
die API stattdessen einen exakten String zurück.

## Datumswerte und Booleans

### `boolean`

`true` oder `false`. Akzeptiert `default`. Gespeichert als `boolean` (`tinyint(1)`, `integer`).
API: ein Boolean.

### `date`

Ein Kalenderdatum, `YYYY-MM-DD`. Akzeptiert `unique` und `default`. Gespeichert als `date`.
API: `"2026-09-29"`.

### `time`

Eine Uhrzeit, `HH:MM`, `HH:MM:SS` oder `HH:MM:SS.mmm`. Akzeptiert `unique` und `default`.
Gespeichert mit Millisekundengenauigkeit. API: `"14:30:00.000"`.

### `datetime`

Ein Zeitpunkt: ein ISO-8601-Zeitstempel mit Zone (`Z` oder `+02:00`). Akzeptiert `unique` und
`default`. Gespeichert in UTC mit Millisekundengenauigkeit. API: `"2026-09-29T12:30:00.000Z"`.

## `json`

Ein beliebiger JSON-Wert. Akzeptiert `default` (beliebiges JSON). Gespeichert als `jsonb`
(`json`, `text`). API: der Wert, wie geschrieben. In `filters` unterstützen JSON-Attribute nur
`$null` und `$notNull`, und nach ihnen lässt sich nicht sortieren.

## Medien

### `media`

Dateien aus der Medienbibliothek.

| Option | Standard | Beschreibung |
| --- | --- | --- |
| `multiple` | `false` | Enthält eine Liste von Dateien statt einer einzelnen. |
| `allowedTypes` | alle | Arten von Dateien: `images`, `videos`, `audios`, `files` (alles andere). |

Kein `default`. Gespeichert in einer Verknüpfungstabelle `{table}_{attribute}_mda`, in
Reihenfolge. Schreibvorgänge nehmen Datei-IDs: `12`, `{ "id": 12 }`, eine Liste davon oder
`null`. API: nur mit `populate`; ein Dateiobjekt (`url`, `mime`, `width`, `formats`…, wie bei
Strapi), eine Liste davon oder `null`. Siehe [Medien](/de/concepts/media/).

## Relationen

### `relation`

Verknüpfungen zu Dokumenten eines anderen Inhaltstyps.

| Option | Beschreibung |
| --- | --- |
| `relation` | `oneToOne`, `oneToMany`, `manyToOne`, `manyToMany`, `oneWay`, `manyWay` oder eine polymorphe Art (siehe unten). |
| `target` | Der Ziel-Inhaltstyp: `article`, `api::article` oder `api::article.article`. |
| `inversedBy` | Auf der besitzenden Seite einer zweiseitigen Relation: das Attribut des Ziels, das sie spiegelt. |
| `mappedBy` | Auf der anderen Seite: das besitzende Attribut des Ziels. |

Die beiden Seiten einer zweiseitigen Relation müssen zusammenpassen: `oneToMany` spiegelt
`manyToOne`, `oneToOne` und `manyToMany` spiegeln sich selbst, und die Seite mit `mappedBy`
nennt ein Attribut, dessen `inversedBy` zurückzeigt. `oneWay` und `manyWay` haben keine andere
Seite.

Verknüpfungen werden auf der besitzenden Seite (der Seite ohne `mappedBy`) in
`{table}_{attribute}_lnk` gespeichert, mit Verweis auf die `documentId` des Ziels, in
Reihenfolge. Schreibvorgänge nehmen `documentId`s:

| Schreiben | Bedeutung |
| --- | --- |
| `"d8f3…"`, `{ "documentId": "d8f3…" }`, eine Liste davon | Die Verknüpfungen ersetzen. |
| `null` oder `[]` | Alle Verknüpfungen entfernen. |
| `{ "set": [...] }` | Die Verknüpfungen ersetzen. |
| `{ "connect": [...], "disconnect": [...] }` | Verknüpfungen hinzufügen und entfernen. Ein `connect`-Element kann `position` tragen: `{ "before": id }`, `{ "after": id }`, `{ "start": true }` oder `{ "end": true }`. |

API: nur mit `populate`, als die verknüpften Dokumente (höchstens 1.000 pro Eintrag und
Relation), oder `{ "count": n }` mit `populate[tags][count]=true`. Siehe
[Relationen](/de/concepts/relations/).

In Komponenten sind nur `oneWay` und `manyWay` erlaubt; die Komponente speichert die
`documentId`s.

### Polymorphe Relationen

`relation` akzeptiert auch die polymorphen Arten, die Dokumente beliebiger Inhaltstypen
verknüpfen:

| `relation` | Optionen | Beschreibung |
| --- | --- | --- |
| `morphToOne` | keine | Verknüpft ein Dokument beliebigen Typs. |
| `morphToMany` | keine | Verknüpft Dokumente beliebiger Typen. |
| `morphOne` | `target`, `morphBy` | Inverse Seite: liest die Verknüpfungen des `morphToOne`- oder `morphToMany`-Attributs `morphBy` von `target`. |
| `morphMany` | `target`, `morphBy` | Ebenso, für viele. |

Besitzer speichern Paare `(type, documentId)` in `{table}_{attribute}_mph`. Schreibvorgänge
nehmen Elemente `{ "__type": "api::article", "documentId": "…" }` (eines, eine Liste, `null`
oder `{ "set": [...] }`). Geladene Elemente tragen ihren Typ in `__type`. Nicht erlaubt in
Komponenten.

## Komponenten und Dynamic Zones

### `component`

Eine Gruppe von Feldern, definiert in `schema/components/<category>/<name>.json`.

| Option | Standard | Beschreibung |
| --- | --- | --- |
| `component` | Pflicht | Die UID der Komponente, `category.name` (`shared.seo`). |
| `repeatable` | `false` | Enthält eine Liste von Elementen statt eines einzelnen. |
| `min`, `max` | | Zahl der Elemente; nur mit `repeatable`. |

Kein `default`: Neue Elemente bekommen die Standardwerte ihrer eigenen Attribute. Gespeichert
als JSON in der Zeile des Eintrags, jedes Element mit einer `id`. Schreibvorgänge nehmen das
Elementobjekt (oder eine Liste), mit `id`, um ein bestehendes Element zu behalten. API: nur mit
`populate`, das ganze Element bzw. die ganze Liste. In `filters` kannst du nach den Feldern
einer Komponente filtern (`filters[seo][metaTitle][$eq]=…`). Siehe
[Komponenten und Dynamic Zones](/de/concepts/components-and-dynamic-zones/).

### `dynamiczone`

Eine Liste von Elementen, jedes eine von mehreren Komponenten.

| Option | Beschreibung |
| --- | --- |
| `components` | Die erlaubten UIDs von Komponenten: mindestens eine, ohne Duplikate. |
| `min`, `max` | Zahl der Elemente. |

Jedes Element trägt `__component` mit seiner UID. Gespeichert als JSON in der Zeile des
Eintrags. API: nur mit `populate`, die ganze Liste. Nach Komponente filtern mit
`filters[blocks][__component][$eq]=blocks.hero`. Dynamic Zones lassen sich nicht in
Komponenten verschachteln.

## Feldübergreifende Validierungen

Neben den Optionen pro Attribut kann ein Inhaltstyp in `validations` Regeln über mehrere Felder
deklarieren, die immer dann geprüft werden, wenn auch `required` geprüft wird:

```json
"validations": [
  {
    "rule": { "<=": [{ "var": "startDate" }, { "var": "endDate" }] },
    "message": "The end date must be after the start date",
    "field": "endDate"
  }
]
```

`rule` ist ein JSON-Logic-Ausdruck über den Eintrag, der erfüllt sein muss. Er darf `var`, `==`,
`!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`, `and`, `or`, `in`, `if`, `?:`, `+`, `-`,
`*`, `/`, `%`, `min`, `max` und `cat` verwenden. `message` wird bei `field` (einem Attribut des
Typs) oder am Eintrag gemeldet. Das ist eine Ergänzung von Verdin; Strapi hat kein Gegenstück.

## Unterschiede zu Strapi

- **Komponenten werden als JSON** in der Zeile des Eintrags gespeichert, nicht in
  Komponententabellen mit Join-Tabellen. Lesezugriffe brauchen keine Joins; in der Folge dürfen
  `password`-Attribute, polymorphe Relationen und zweiseitige Relationen nicht in Komponenten
  stehen, und `unique` wird dort nicht durchgesetzt.
- **Geladene Komponenten kommen vollständig.** `populate` auf einer Komponente oder Dynamic Zone
  liefert alle ihre Felder; verschachtelte Felder lassen sich nicht wie in Strapi auswählen.
- **Strenge Schemadateien.** Unbekannte Schlüssel und Optionen, die ein Typ nicht akzeptiert,
  sind Fehler, wo Strapi sie ignoriert. In `pluginOptions` wird nur `i18n.localized` gelesen;
  der Rest wird ignoriert.
- **`string`, `email` und `uid` sind auf 255 Zeichen begrenzt**, die Spaltengröße, statt erst
  an der Datenbank zu scheitern.
- **`conditions`** (bedingte Felder) funktionieren wie in Strapi 5.17: ausgeblendete Felder sind nicht erforderlich.
- **`validations`** sind eine eigene Erfindung von Verdin.
- Der Rest entspricht Strapi v5: die Typnamen, ihre Optionen, `biginteger`-Werte als Strings,
  das Schreiben von Relationen mit `connect`, `disconnect`, `set` und `position` sowie das
  Blocks-Format.
