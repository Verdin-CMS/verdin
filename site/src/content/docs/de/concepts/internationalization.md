---
title: "Internationalisierung"
description: "Wie Verdin eine Version eines Dokuments pro Sprache führt, welche Felder lokalisiert oder geteilt sind und wie die APIs eine Sprache wählen."
sidebar:
  order: 5
---

Internationalisierung (i18n) hält die Inhalte eines Dokuments in mehreren Sprachen vor. Diese
Seite erklärt das Modell: Sprachen, lokalisierte und geteilte Felder und wie Lese- und
Schreibzugriffe eine Sprache wählen. Den Arbeitsablauf in der Redaktion beschreibt
[Inhalte lokalisieren](/de/guides/content/localizing-content/).

## Sprachen

Die Sprachen des Projekts stehen unter **Einstellungen → Internationalisierung**
(Berechtigung `locales.manage`). Beim ersten Start wird Englisch (`en`) als Standardsprache
angelegt.

- Eine Sprache ist immer die Standardsprache. Anfragen ohne Sprachangabe verwenden sie, und
  sie lässt sich nicht löschen.
- Codes bestehen aus einer Sprache mit zwei oder drei Kleinbuchstaben, optional gefolgt von
  Subtags: `en`, `fr`, `pt-BR`, `zh-Hans`.

:::caution
Wer eine Sprache löscht, löscht auch jede Version, die in ihr geschrieben wurde.
:::

## Lokalisierte Inhaltstypen

Ein Inhaltstyp ist lokalisiert, wenn sein Schema das angibt. Jedes Dokument hat dann eine
Version pro Sprache, und alle teilen sich die `documentId`:

```json title="schema/content-types/article.json (excerpt)"
{
  "kind": "collectionType",
  "singularName": "article",
  "pluralName": "articles",
  "displayName": "Article",
  "options": { "draftAndPublish": true },
  "pluginOptions": { "i18n": { "localized": true } },
  "attributes": {
    "title": { "type": "string", "required": true },
    "readingTime": { "type": "integer", "pluginOptions": { "i18n": { "localized": false } } }
  }
}
```

Mit [Entwurf und Veröffentlichung](/de/concepts/draft-and-publish/) hat jede Sprache ihren
eigenen Entwurf und ihre eigene veröffentlichte Version, sodass eine französische Übersetzung
vor oder nach dem englischen Text veröffentlicht werden kann. Typen ohne
`pluginOptions.i18n.localized` sind nicht lokalisiert und ignorieren `locale`-Parameter.

## Was lokalisiert ist

In einem lokalisierten Typ ist jedes Attribut lokalisiert, sofern es nicht
`"pluginOptions": { "i18n": { "localized": false } }` angibt. Ein solches **geteiltes** Feld
hat einen einzigen Wert für das ganze Dokument:

- Wird ein geteiltes Feld in einer Sprache gespeichert, landet es in den Entwürfen aller
  Sprachen.
- Beim Veröffentlichen einer Sprache werden ihre geteilten Felder in die veröffentlichten
  Versionen der anderen Sprachen kopiert.
- Das gilt auch für Relationen und Medien: Eine geteilte Relation verknüpft in jeder Sprache
  dieselben Dokumente.

Systemfelder folgen der Version: Jede Sprache hat ihr eigenes `createdAt`, `updatedAt` und
`publishedAt`. `unique`- und `uid`-Werte sind pro Sprache eindeutig, zwei Übersetzungen dürfen
also denselben Slug haben.

## Relationen zwischen lokalisierten Typen

Relationen verknüpfen Dokumente, nicht Versionen (siehe
[Relationen](/de/concepts/relations/#verknüpft-über-das-dokument-nicht-über-die-zeile)), die
Sprache wird also beim Lesen gewählt:

- Sind beide Typen lokalisiert, zeigt der französische Artikel die französische Version seiner
  Kategorie. Filter über die Relation vergleichen in derselben Sprache.
- Ist der Zieltyp nicht lokalisiert, sieht jede Sprache dasselbe Ziel.

## Eine Sprache in den APIs wählen

REST und die Admin-API nehmen `locale` als Query-Parameter im Format von Strapi v5; GraphQL
nimmt ein `locale`-Argument:

```http
GET /api/articles?locale=fr
PUT /api/articles/{documentId}?locale=fr
DELETE /api/articles/{documentId}?locale=fr
```

```graphql
query {
  articles(locale: "fr") {
    documentId
    title
  }
}
```

- Ohne `locale` lesen und schreiben Anfragen die Standardsprache.
- Ein `PUT` in einer Sprache, die das Dokument noch nicht hat, legt diese Version an.
- Ein `DELETE` entfernt nur die Version in der angefragten Sprache. Verknüpfungen, die auf das
  Dokument zeigen, werden entfernt, sobald keine Sprache mehr übrig ist.
- REST-Antworten lokalisierter Typen enthalten `locale`. Eine unbekannte Sprache ist ein
  `400`-Fehler.
- Webhook-Payloads, Echtzeit-Events und der Versionsverlauf halten die Sprache der geänderten
  Version fest.

## Berechtigungen pro Sprache

Admin-Rollen können Content-Berechtigungen auf bestimmte Sprachen beschränken, sodass eine
französische Redakteurin nur französische Versionen lesen oder ändern kann. Siehe
[Berechtigungen](/de/concepts/permissions/#feld--und-sprachberechtigungen). Die Berechtigungen
der Content-API (öffentlicher Zugriff, API-Tokens, Endnutzer-Rollen) gelten für jede Sprache.

## Im Vergleich zu Strapi

Modell und Parameter entsprechen dem i18n von Strapi v5: lokalisierte Typen, Felder mit
`localized: false`, `?locale=` und die Standardsprache. In Verdin gehört i18n zum Kern und ist
immer an: Du schaltest es pro Inhaltstyp im Schema ein.
