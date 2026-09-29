---
title: "Relationen"
description: "Arten von Relationen, wie Verdin Dokumente über die documentId verknüpft, Reihenfolge, polymorphe Relationen und was oneWay und manyWay in Komponenten bedeuten."
sidebar:
  order: 3
---

Eine Relation verknüpft Dokumente zweier Inhaltstypen, etwa einen Artikel und seine Kategorie.
Diese Seite erklärt die Arten von Relationen, wie Verknüpfungen gespeichert und aufgelöst
werden und welche Regeln fürs Schreiben, Ordnen und Lesen gelten. Die Syntax der Anfragen
steht unter [REST-API](/de/api/rest/#schreiben).

## Arten

Eine Relation ist ein Attribut mit `type: "relation"`, einer Art in `relation` und einem
Ziel-Inhaltstyp in `target`:

| Art | Ein Dokument verknüpft | Ein Ziel wird verknüpft von | Inverse Seite |
| --- | --- | --- | --- |
| `oneWay` | ein Ziel | beliebig vielen Dokumenten | keine |
| `manyWay` | viele Ziele | beliebig vielen Dokumenten | keine |
| `manyToOne` | ein Ziel | beliebig vielen Dokumenten | `oneToMany` |
| `oneToMany` | viele Ziele | einem Dokument | `manyToOne` |
| `oneToOne` | ein Ziel | einem Dokument | `oneToOne` |
| `manyToMany` | viele Ziele | beliebig vielen Dokumenten | `manyToMany` |

Das Blog-Beispiel verknüpft Artikel mit einer Kategorie (mit inverser Seite) und mit Tags
(ohne):

```json title="schema/content-types/article.json (excerpt)"
"category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
"tags": { "type": "relation", "relation": "manyToMany", "target": "tag" }
```

```json title="schema/content-types/category.json (excerpt)"
"articles": { "type": "relation", "relation": "oneToMany", "target": "article", "mappedBy": "category" }
```

- Die Seite mit `inversedBy` (oder mit keinem der beiden Schlüssel) ist die **besitzende**
  Seite: Sie speichert die Verknüpfungen, und sie ist die, die du schreibst.
- Die Seite mit `mappedBy` ist die **inverse** Seite: Sie liest die Verknüpfungen des
  Besitzers in Gegenrichtung und ist schreibgeschützt. Sie zu schreiben ist ein
  Validierungsfehler, der das besitzende Attribut nennt.
- Beide Seiten müssen zusammenpassen: `mappedBy` nennt ein Attribut des Ziels, das mit
  `inversedBy` zurückzeigt, mit der passenden inversen Art aus der Tabelle.
- `oneWay` und `manyWay` haben nie eine inverse Seite.

Der Content-Type Builder legt das inverse Attribut am Ziel für dich an.

## Verknüpft über das Dokument, nicht über die Zeile

Ein Dokument hat mehrere Zeilen: einen Entwurf und eine veröffentlichte Version, und von beiden
je eine pro Sprache. Verdin speichert eine Relation als Verknüpfung von der Quell-**Zeile** zum
Ziel-**Dokument** (seiner `documentId`), in einer Verknüpfungstabelle namens
`{table}_{field}_lnk`. Die Zielzeile wird beim Lesen der Relation gewählt:

- Ein veröffentlichter Artikel sieht die veröffentlichte Version seiner Kategorie; sein
  Entwurf sieht den Entwurf der Kategorie. Typen ohne Entwurf und Veröffentlichung haben eine
  einzige Version, die jeder Leser sieht.
- Ist das Ziel ebenfalls lokalisiert, wird es beim Lesen in derselben Sprache aufgelöst. Ein
  nicht lokalisierter Zieltyp wird von allen Sprachen geteilt.
- Eine Kategorie zurückzuziehen blendet sie in veröffentlichten Artikeln aus, ohne eine
  Verknüpfung anzufassen; wird sie erneut veröffentlicht, ist sie wieder da.
- Beim Veröffentlichen eines Artikels werden nur seine eigenen Verknüpfungen in die
  veröffentlichte Version kopiert.

Strapi verknüpft stattdessen Zeilen-IDs und muss deshalb bei jeder Veröffentlichung eines
Entwurfs Verknüpfungen umschreiben. Verdin tut das nie, wodurch Veröffentlichen eine einfache
Kopie der Entwurfszeile bleibt.

Die Integrität sichert Verdin selbst statt über Fremdschlüssel: Ein nicht existierendes
Dokument zu verknüpfen ist ein Validierungsfehler, und das Löschen eines Dokuments entfernt in
derselben Transaktion die Verknüpfungen, die darauf zeigen.

### Ein Dokument pro Ziel

Bei `oneToOne` und `oneToMany` gehört ein Ziel höchstens einem Quelldokument. Wer ein Ziel
verknüpft, das ein anderes Dokument hält, **verschiebt** es: Die Verknüpfung des anderen
Dokuments wird im selben Schreibvorgang entfernt. Das ist das Verhalten von Strapi. Es gilt pro
Version: Ein Entwurf und seine veröffentlichte Version dürfen dasselbe Ziel halten.

## Schreiben

Auf der besitzenden Seite nimmt `data` eine `documentId`, eine Liste davon oder ein Objekt, das
eine Änderung beschreibt:

| Eingabe | Wirkung |
| --- | --- |
| `"k2m…"` oder `{ "documentId": "k2m…" }` | Ein Ziel verknüpfen (To-one-Relationen). |
| `["k2m…", "p9x…"]` | Alle Verknüpfungen ersetzen, in dieser Reihenfolge. |
| `null` oder `[]` | Alle Verknüpfungen entfernen. |
| `{ "set": ["k2m…"] }` | Alle Verknüpfungen ersetzen. |
| `{ "connect": [...], "disconnect": [...] }` | Verknüpfungen hinzufügen und entfernen, die übrigen bleiben. |

Wird ein neues Ziel mit einer To-one-Relation verbunden, ersetzt es das bisherige. `set` lässt
sich nicht mit `connect` oder `disconnect` kombinieren.

Im Admin-Panel listet ein Relationsfeld die verknüpften Einträge. **Eintrag verknüpfen** (bzw.
**Einträge verknüpfen** bei To-many-Relationen) öffnet einen Dialog, der die Einträge des
Zieltyps über ihre Textfelder durchsucht, bei lokalisiertem Ziel in der Sprache des Eintrags.
Wähle einen Eintrag, oder hake mehrere an und füge sie hinzu; bereits verknüpfte Einträge sind
markiert.

## Reihenfolge

To-many-Relationen behalten die Reihenfolge ihrer Verknüpfungen. Eine Liste oder `set`
speichert die Reihenfolge, die du schickst. `connect`-Elemente können angeben, wohin sie
gehören:

```json
{
  "data": {
    "tags": {
      "connect": [
        { "documentId": "k2m…", "position": { "before": "p9x…" } },
        { "documentId": "a7c…", "position": { "end": true } }
      ]
    }
  }
}
```

`position` ist `{ "before": documentId }`, `{ "after": documentId }`, `{ "start": true }` oder
`{ "end": true }`. Die Positionen werden bei jedem Schreiben neu nummeriert. Lesezugriffe
liefern verknüpfte Dokumente in der Reihenfolge der Verknüpfungen, sofern das Populate kein
`sort` verlangt.

## Lesen

Relationen werden nur zurückgegeben, wenn du sie per Populate lädst:

```http
GET /api/articles?populate[category][fields][0]=name&populate[tags][sort]=label:asc
```

Eine To-one-Relation ist ein Objekt oder `null`; eine To-many-Relation ist ein Array. Jede
geladene Relation kann eigene `fields`, `filters`, `sort`, `populate` und `count` haben, bis zu
fünf Ebenen tief. Jede Ebene ist eine gebündelte Abfrage pro Relation (`WHERE … IN (…)`), kein
Join, sodass tiefe Populates die Zeilen nicht vervielfachen. Pro Dokument und Relation werden
höchstens 1.000 verknüpfte Dokumente zurückgegeben; `count` liefert die genaue Zahl.

Du kannst über Relationen filtern (`filters[category][name][$eq]=News`), auf beiden Seiten, und
nach einem Feld einer To-one-Relation sortieren (`sort=category.name:asc`). Populate, Filtern
oder Sortieren über eine Relation zu einem Typ, den der Aufrufer nicht lesen darf, wird
abgelehnt (`populate=*` überspringt ihn), sodass Relationen nie Inhalte preisgeben, die die
[Berechtigungen](/de/concepts/permissions/) des Aufrufers verbergen.

## Relationen in Komponenten

Eine [Komponente](/de/concepts/components-and-dynamic-zones/) kann Relationen enthalten, aber
nur `oneWay` und `manyWay`:

```json title="schema/components/shared/related.json"
{
  "displayName": "Related",
  "attributes": {
    "label": { "type": "string" },
    "articles": { "type": "relation", "relation": "manyWay", "target": "article" }
  }
}
```

Das JSON der Komponente speichert die `documentId`s selbst: einen String bei `oneWay`, ein
Array bei `manyWay`. Deshalb sind die anderen Arten dort nicht erlaubt:

- Eine inverse Seite müsste das JSON jedes Dokuments durchsuchen, um herauszufinden, wer auf
  sie verweist.
- „Ein Dokument pro Ziel“ (`oneToOne`, `oneToMany`) lässt sich ohne eine solche Suche ebenfalls
  nicht durchsetzen.

In Komponenten ist die Reihenfolge einer `manyWay`-Liste die Reihenfolge des Arrays. Referenzen
werden beim Schreiben geprüft und beim Laden der Komponente aufgelöst, im Status und in der
Sprache des Dokuments; Ziele, die nicht mehr existieren, werden weggelassen. Nach ihnen lässt
sich nicht filtern.

## Polymorphe Relationen

`morphToOne` und `morphToMany` verknüpfen Dokumente beliebiger Inhaltstypen. Ihre
Verknüpfungen speichern den Typ des Ziels neben seiner `documentId`, und Schreibvorgänge nennen
beides:

```json
{ "data": { "related": [{ "__type": "api::article", "documentId": "k2m…" }, { "__type": "api::page", "documentId": "p9x…" }] } }
```

Geladene Elemente sind die Zieldokumente mit ihrem `__type`, gelesen im Status und in der
Sprache der Anfrage. Die inversen Seiten `morphOne` und `morphMany` nennen den Besitzertyp
(`target`) und sein Attribut (`morphBy`) und sind schreibgeschützt. Nach polymorphen Relationen
lässt sich weder filtern noch sortieren, und sie dürfen nicht in Komponenten stehen.
