---
title: "Komponenten und Dynamic Zones"
description: "Wiederverwendbare Feldgruppen und gemischte Blocklisten, warum Verdin sie als JSON im Dokument speichert und was das für Relationen, Medien, Filter und Populate bedeutet."
sidebar:
  order: 2
---

Mit Komponenten verwendest du eine Gruppe von Feldern in mehreren Inhaltstypen wieder, und mit
Dynamic Zones bauen Redakteure eine Seite aus einer Liste von Blöcken. Diese Seite erklärt, wie
beide modelliert und gespeichert werden und was das fürs Lesen, Schreiben und Filtern bedeutet.
Das Schemaformat selbst steht unter [Inhaltsmodell](/de/concepts/content-model/).

## Komponenten

Eine Komponente ist eine Gruppe von Feldern mit eigener Datei unter
`schema/components/<category>/`. Im Blog-Beispiel enthält `shared.seo` einen Meta-Titel und
eine Meta-Beschreibung:

```json title="schema/components/shared/seo.json"
{
  "displayName": "SEO",
  "attributes": {
    "metaTitle": { "type": "string", "maxLength": 60 },
    "metaDescription": { "type": "text", "maxLength": 160 }
  }
}
```

Ein Inhaltstyp nutzt sie über ein `component`-Attribut. `repeatable: true` macht daraus eine
Liste, optional begrenzt durch `min` und `max` Elemente:

```json
"seo": { "type": "component", "component": "shared.seo" },
"links": { "type": "component", "component": "shared.link", "repeatable": true, "max": 10 }
```

Komponenten können andere Komponenten enthalten. Eine Komponente kann sich nicht selbst
enthalten, weder direkt noch über andere; die Schemaprüfung lehnt solche Zyklen ab.

## Dynamic Zones

Eine Dynamic Zone ist eine Liste, deren Elemente jede der Komponenten sein können, die sie
nennt. Der Artikeltext des Blogs mischt Heros und Zitate:

```json
"blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"], "max": 20 }
```

Jedes Element gibt in `__component` an, welche Komponente es ist. `min` und `max` begrenzen die
Zahl der Elemente. Dynamic Zones gibt es nur in Inhaltstypen: Eine Komponente kann keine
enthalten.

## Als JSON gespeichert

Verdin speichert den Wert einer Komponente oder Dynamic Zone in einer JSON-Spalte der Zeile des
Dokuments (`jsonb` auf PostgreSQL, `json` auf MySQL und MariaDB, Text auf SQLite):

```json
// the "seo" column
{ "id": 1, "metaTitle": "Rust for CMS authors", "metaDescription": "…" }

// the "blocks" column
[
  { "__component": "blocks.hero", "id": 1, "title": "Hello", "subtitle": "…" },
  { "__component": "blocks.quote", "id": 2, "text": "…", "author": "Ferris" }
]
```

Strapi legt jede Komponente in eine eigene Tabelle, verbunden über polymorphe
Verknüpfungstabellen. Den Wert stattdessen beim Dokument zu speichern bedeutet:

- Ein Dokument samt Komponenten zu lesen braucht keine Joins, egal wie tief sie verschachtelt
  sind.
- Veröffentlichen, das Verwerfen eines Entwurfs und der
  [Inhaltsverlauf](/de/guides/content/content-history/) kopieren den Wert, wie er ist.
- Ein neues Feld in einer Komponente ändert keine Tabelle: Die Migration ist leer.
- Filter auf Komponentenfeldern nutzen die JSON-Funktionen der jeweiligen Datenbank, und
  manche Filter sind nicht verfügbar (siehe [Filtern](#filtern)).

Jedes Element trägt eine `id`, eine positive Ganzzahl, die innerhalb des Attributwerts
eindeutig ist. Verdin vergibt sie für neue Elemente; schick die `id` beim Aktualisieren einer
Liste mit, damit die Elemente stabil bleiben.

## Relationen und Medien in Komponenten

Eine Komponente kann Relationen und Medien enthalten, gespeichert im JSON selbst:
`documentId`s für Relationen und Datei-IDs für Medien.

- Relationen in Komponenten müssen `oneWay` oder `manyWay` sein: Sie zeigen auf ihre Ziele und
  haben keine inverse Seite. Siehe
  [Relationen](/de/concepts/relations/#relationen-in-komponenten).
- Jede Referenz wird beim Schreiben geprüft: Das Zieldokument bzw. die Datei muss existieren,
  und Dateien müssen zu den `allowedTypes` des Felds passen.
- Wird die Komponente per `populate` geladen, werden Referenzen mit gebündelten Abfragen
  aufgelöst, im selben Status und in derselben Sprache wie das Dokument. Ein Ziel, das
  gelöscht wurde oder keine Version in der gelesenen hat, wird weggelassen.
- Polymorphe Relationen (`morphToOne`, `morphToMany`) und `password`-Felder dürfen nicht in
  Komponenten stehen.

## Lesen

Komponenten und Dynamic Zones werden wie in Strapi nur zurückgegeben, wenn du sie per
`populate` lädst:

```http
GET /api/articles?populate[0]=seo&populate[1]=blocks
GET /api/articles?populate=*
```

Eine geladene Komponente kommt vollständig zurück, samt verschachtelter Komponenten und
aufgelöster Relationen und Medien. Strapi braucht für jede verschachtelte Komponente eine
eigene `populate`-Ebene; Verdin akzeptiert diese verschachtelten Optionen aus
Kompatibilitätsgründen und ignoriert sie. Die Elemente einer Dynamic Zone kommen in ihrer
gespeicherten Reihenfolge zurück, jedes mit seinem `__component`.

In GraphQL ist eine Komponente ein Objekttyp, benannt nach ihrer UID (`ComponentSharedSeo`),
und eine Dynamic Zone eine Union (`ArticleBlocksDynamicZone`), die du mit Fragmenten abfragst.
Siehe [GraphQL-API](/de/api/graphql/).

## Schreiben

Schick den ganzen Wert des Attributs. Er ersetzt, was gespeichert war:

```json
{
  "data": {
    "seo": { "metaTitle": "Rust for CMS authors" },
    "blocks": [
      { "__component": "blocks.hero", "title": "Hello" },
      { "__component": "blocks.quote", "text": "Fast and small.", "author": "Ferris" }
    ]
  }
}
```

Der Wert wird bei jedem Schreiben gegen das Schema der Komponente validiert: Unbekannte
Schlüssel, falsche Typen und ein `__component`, das die Dynamic Zone nicht erlaubt, sind
Fehler mit Pfaden wie `["blocks", 1, "text"]`. `required`-Felder in Komponenten werden beim
Veröffentlichen des Dokuments geprüft, genau wie Felder auf oberster Ebene.

## Filtern

| Was | Beispiel | Hinweise |
| --- | --- | --- |
| Felder einer Komponente | `filters[seo][metaTitle][$containsi]=rust` | Skalare Felder, verschachtelte Komponenten eingeschlossen. |
| Felder einer wiederholbaren Komponente | `filters[links][url][$contains]=github` | Trifft zu, wenn mindestens ein Element zutrifft. |
| Dynamic Zones | `filters[blocks][__component][$eq]=blocks.quote` | Nur nach `__component`: Elemente verschiedener Komponenten haben verschiedene Felder. |

Nach Komponentenfeldern kannst du nicht sortieren, und `json`-Felder in Komponenten lassen sich
nicht filtern. Die Operatoren stehen unter [REST-API](/de/api/rest/#filter).
