---
title: "Inhaltsmodell"
description: "Wie Verdin deine Inhalte beschreibt: Collection und Single Types, Attribute, Schemadateien im Format von Strapi und Validierungsregeln."
sidebar:
  order: 1
---

Das Inhaltsmodell ist die Menge der Inhaltstypen und Komponenten, die dein Projekt definiert.
Verdin leitet alles andere daraus ab: die Datenbanktabellen, die REST- und GraphQL-APIs, das
OpenAPI-Dokument, die Validierung und die Formulare des Admin-Panels. Diese Seite erklärt die
Bausteine und die Regeln, die für sie gelten.

## Inhaltstypen

Ein Inhaltstyp beschreibt eine Art von Dokument, etwa einen Artikel oder eine Startseite. Er
hat eine `kind`:

| Art | Enthält | REST-Routen (Blog-Beispiel) |
| --- | --- | --- |
| `collectionType` | Beliebig viele Dokumente | `/api/articles`, `/api/articles/{documentId}` |
| `singleType` | Höchstens ein Dokument | `/api/homepage` |

Collection Types sind unter ihrem `pluralName` erreichbar, Single Types unter ihrem
`singularName`. Der erste `PUT` auf einen Single Type legt sein Dokument an. Alle Routen
findest du unter [REST-API](/de/api/rest/).

Jeder Inhaltstyp hat eine UID, `api::<singularName>` (`api::article`). Strapi schreibt dieselbe
UID als `api::article.article`; Verdin akzeptiert diese Form in Schemadateien und im Importer
und normalisiert sie zu `api::article`.

Jedes Dokument hat Systemfelder, die du nicht deklarierst: `id`, `documentId` (eine ULID aus
26 Kleinbuchstaben und Ziffern, stabil über Entwürfe, veröffentlichte Versionen und Sprachen
hinweg), `createdAt`, `updatedAt`, `publishedAt` und `locale` bei
[lokalisierten Typen](/de/concepts/internationalization/).

## Schemadateien

Inhaltstypen und Komponenten sind JSON-Dateien im Verzeichnis `schema/` deines Projekts
(`[schema].path` in `verdin.toml`). Du versionierst sie wie Code in Git.

```
schema/
├── content-types/
│   ├── article.json
│   ├── category.json
│   ├── tag.json
│   └── homepage.json
└── components/
    ├── blocks/
    │   ├── hero.json
    │   └── quote.json
    └── shared/
        └── seo.json
```

Das Format ist das `schema.json` von Strapi, sodass die meisten Strapi-Schemas unverändert
laden. Das ist der Artikeltyp des
[Blog-Beispiels](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog):

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
    "excerpt": { "type": "text", "maxLength": 500 },
    "body": { "type": "richtext" },
    "readingTime": { "type": "integer", "min": 0 },
    "featured": { "type": "boolean", "default": false },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "tags": { "type": "relation", "relation": "manyToMany", "target": "tag" },
    "seo": { "type": "component", "component": "shared.seo" },
    "blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"] }
  }
}
```

| Schlüssel | Pflicht | Beschreibung |
| --- | --- | --- |
| `kind` | ja | `collectionType` oder `singleType`. |
| `singularName` | ja | Kebab-case. Muss zum Dateinamen passen (`article.json`). |
| `pluralName` | ja | Kebab-case, verschieden von `singularName`. |
| `displayName` | ja | Der Name, den das Admin-Panel anzeigt. |
| `description` | nein | Wird im Admin-Panel angezeigt. |
| `collectionName` | nein | Tabellenname. Standard ist der `pluralName` in snake_case. |
| `options.draftAndPublish` | nein | Führt pro Dokument einen Entwurf und eine veröffentlichte Version. Standard ist `false`. Siehe [Entwurf und Veröffentlichung](/de/concepts/draft-and-publish/). |
| `pluginOptions.i18n.localized` | nein | Eine Version pro Sprache. Standard ist `false`. Siehe [Internationalisierung](/de/concepts/internationalization/). |
| `attributes` | nein | Die Felder, in der Reihenfolge, in der die API sie zurückgibt. |
| `validations` | nein | Feldübergreifende Regeln; siehe [unten](#feldübergreifende-validierungen). |

Schemas sind streng: Ein unbekannter Schlüssel, eine Option, die ein Typ nicht unterstützt,
oder ein Verweis auf einen fehlenden Typ oder eine fehlende Komponente ist ein Fehler, der
Datei und Pfad nennt, und der Server startet nicht. Mit `verdin schema check` prüfst du die
Dateien, ohne den Server zu starten.

Manche Namen sind vergeben:

- Attributnamen beginnen mit einem Buchstaben, gefolgt von Buchstaben, Ziffern und
  Unterstrichen, höchstens 50 Zeichen. Sie werden zu Spalten in snake_case
  (`metaTitle` → `meta_title`).
- `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`,
  `updatedAt`, `createdBy` und `updatedBy` sind in Inhaltstypen reserviert, `id` in
  Komponenten.
- `upload`, `uploads`, `auth`, `users` und `connect` können kein `singularName` oder
  `pluralName` sein: Diese Routen gehören der API.
- Ein Inhaltstyp hat höchstens 60 Attribute vom Typ `string`, `email`, `uid` und
  `enumeration`, damit Zeilen innerhalb der Zeilengrößengrenze von MySQL bleiben. Nimm für
  einige davon `text`.

Du bearbeitest die Dateien im **Content-Type Builder** des Admin-Panels, der verfügbar ist,
solange der Server mit `verdin dev` läuft, oder von Hand. So oder so wird eine Änderung zu
einer [Schemamigration](/de/concepts/schema-migrations/). Das Layout des Editors
(Feldreihenfolge, Breiten, Beschriftungen) gehört nicht zum Schema: Admins konfigurieren es im
Panel, und es wird in der Datenbank gespeichert.

## Komponenten

Eine Komponente ist eine wiederverwendbare Gruppe von Feldern, etwa `shared.seo` (ein
Meta-Titel und eine Meta-Beschreibung). Ihre UID ist `<category>.<name>`, abgeleitet aus ihrem
Pfad: `schema/components/shared/seo.json` ist `shared.seo`. Eine Komponentendatei hat
`displayName`, optional `description` und `icon` sowie `attributes`.

Eine Dynamic Zone ist eine Liste, die mehrere Komponenten mischt, etwa ein Artikeltext aus
Hero- und Zitatblöcken. Beide werden als JSON im Dokument gespeichert; siehe
[Komponenten und Dynamic Zones](/de/concepts/components-and-dynamic-zones/).

## Attribute

Jedes Attribut hat einen `type` und Optionen, die davon abhängen. Die vollständige Liste der
Typen, ihrer Optionen und ihrer Spaltentypen pro Datenbank steht in der
[Referenz der Attributtypen](/de/reference/attribute-types/).

| Kategorie | Typen |
| --- | --- |
| Text | `string`, `text`, `richtext` (Markdown), `blocks` (der strukturierte Rich Text von Strapi), `email`, `uid`, `password`, `enumeration` |
| Zahlen | `integer`, `biginteger`, `float`, `decimal` |
| Datum und Zeit | `date`, `time`, `datetime` |
| Weitere Skalare | `boolean`, `json` |
| Verknüpfungen | `relation` (siehe [Relationen](/de/concepts/relations/)), `media` (siehe [Medien](/de/concepts/media/)) |
| Struktur | `component`, `dynamiczone` |

Gängige Optionen:

| Option | Wirkung |
| --- | --- |
| `required` | Der Wert muss gesetzt sein, wenn eine Version veröffentlicht wird (bei Typen ohne Entwurf und Veröffentlichung bei jedem Schreiben). Entwürfe dürfen unvollständig sein. |
| `private` | Wird von der Content-API nie zurückgegeben, gefiltert, sortiert oder per Populate geladen. `password`-Attribute sind immer privat. |
| `default` | Wert, der verwendet wird, wenn ein neues Dokument das Feld weglässt. Wird gegen die eigenen Regeln des Attributs geprüft. |
| `unique` | Keine zwei Dokumente dürfen denselben Wert haben, pro Sprache und Version. Verfügbar für `string`, `email`, Zahlen-, Datums- und Zeittypen; `uid` ist immer eindeutig. |
| `configurable` | `false` sperrt das Attribut im Content-Type Builder: Dort lässt es sich weder bearbeiten noch umbenennen noch löschen. |
| `pluginOptions.i18n.localized` | `false` teilt den Wert über alle Sprachen. |

Jede Attributspalte ist in der Datenbank nullable. Wie in Strapi v5 setzt Verdin `required`
beim Veröffentlichen durch, nicht über eine `NOT NULL`-Constraint; ein Pflichtattribut zu
einem Typ hinzuzufügen, der schon Zeilen hat, ist also eine sichere Änderung.

## Validierung

Jeder Schreibvorgang wird gegen das Schema geprüft, bevor etwas die Datenbank erreicht:

- **Typen und Einschränkungen**, bei jedem Schreiben: Werttypen, `minLength`/`maxLength`,
  `min`/`max`, `regex`, `enum`-Werte, die Zahl der Elemente in wiederholbaren Komponenten und
  Dynamic Zones, die Komponententypen, die eine Dynamic Zone erlaubt, und die Dateitypen, die
  ein Medienfeld akzeptiert. Unbekannte Schlüssel und Systemfelder in der Eingabe sind Fehler.
- **Pflichtfelder und feldübergreifende Regeln**, wenn eine Version veröffentlicht wird, und
  bei jedem Schreiben in Typen ohne Entwurf und Veröffentlichung. Sie gelten auch innerhalb von
  Komponenten und Dynamic Zones.
- **Eindeutigkeit**, über eindeutige Indizes in der Datenbank, sodass nicht zwei gleichzeitige
  Schreibvorgänge beide gelingen können.

Eine fehlgeschlagene Prüfung antwortet mit `400` und einem `ValidationError`, dessen
`details.errors` jedes Problem mit seinem Pfad auflistet, etwa `["seo", "metaTitle"]` oder
`["blocks", 2, "text"]`. Siehe [Fehler](/de/api/rest/#fehler).

### Feldübergreifende Validierungen

Ein Inhaltstyp kann Regeln deklarieren, die seine eigenen Felder vergleichen, geschrieben in
[JSON Logic](https://jsonlogic.com). Dieser Event-Typ verlangt, dass das Enddatum nach dem
Startdatum liegt, und begrenzt die verkauften Tickets auf die Zahl der Plätze:

```json title="schema/content-types/event.json"
{
  "kind": "collectionType",
  "singularName": "event",
  "pluralName": "events",
  "displayName": "Event",
  "attributes": {
    "startDate": { "type": "date", "required": true },
    "endDate": { "type": "date" },
    "seats": { "type": "integer", "min": 0 },
    "sold": { "type": "integer", "min": 0 }
  },
  "validations": [
    {
      "rule": { "or": [{ "!": { "var": "endDate" } }, { "<=": [{ "var": "startDate" }, { "var": "endDate" }] }] },
      "message": "must be after the start date",
      "field": "endDate"
    },
    { "rule": { "<=": [{ "var": "sold" }, { "var": "seats" }] }, "message": "more tickets sold than seats" }
  ]
}
```

- Eine Regel, die nicht erfüllt ist, ergibt einen Validierungsfehler mit `message`, bei
  `field`, falls angegeben, sonst am Dokument (`path: []`).
- Regeln laufen, wenn auch `required` greift: beim Veröffentlichen und bei jedem Schreiben in
  Typen ohne Entwurf und Veröffentlichung. Entwürfe dürfen sie verletzen.
- `var` liest die eigenen Felder des Dokuments, mit Punktpfaden in Komponenten hinein.
  Relationen und Medien stehen Regeln nicht zur Verfügung.
- Vergleiche sind numerisch, wenn beide Seiten Zahlen sind, und textuell, wenn beide Strings
  sind; ISO-Datumswerte, Uhrzeiten und Zeitstempel vergleichen sich also korrekt. Ein leeres
  Feld ist `null`: Sichere optionale Felder ab, wie es die erste Regel tut.
- Erlaubte Operatoren: `var`, `==`, `!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`,
  `and`, `or`, `in`, `if`, `?:`, `+`, `-`, `*`, `/`, `%`, `min`, `max`, `cat`. Ein unbekannter
  Operator, ein unbekanntes `field` oder eine leere `message` ist ein Schemafehler.

Der Server prüft die Regeln; das Admin-Panel zeigt ihre Meldungen an den genannten Feldern an,
wenn eine Veröffentlichung scheitert. Strapi hat dafür kein Gegenstück. Die bedingten Felder
von Strapi (`conditions`) werden in Schemadateien akzeptiert und beibehalten, aber noch nicht
angewendet.
