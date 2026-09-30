---
title: "Echtzeit-API"
description: "Das Server-Sent-Events-Protokoll des Echtzeit-Streams von Verdin: Endpunkt, Authentifizierung, Event-Namen und Nachrichtenformate sowie das Präsenzprotokoll des Admin-Panels."
sidebar:
  order: 5
  label: "Echtzeit"
---

Verdin streamt Änderungen an Inhalten und Medien, sobald sie committet sind, über
[Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events) (SSE).
Jeder Abonnent bekommt nur Events zu dem, was er lesen darf. Diese Seite beschreibt das
Protokoll; wie du es in einem Frontend nutzt, steht unter
[Echtzeit-Updates](/de/guides/frontend/realtime/).

## Aktivieren

Echtzeit ist standardmäßig aus. Schalte sie unter **Einstellungen → Funktionen → Echtzeit**
ein (Berechtigung `features.manage`). Solange sie aus ist, antworten die Endpunkte mit `404`.

## Content-Stream

```
GET /api/_events
GET /api/_events?types=api::article,api::category
```

| Parameter | Beschreibung |
| --- | --- |
| `types` | Optional, kommagetrennte UIDs von Inhaltstypen; `plugin::upload` ist die Medienbibliothek. Die Strapi-Form `api::article.article` funktioniert auch. Ohne den Parameter bekommst du jeden Typ, den du lesen darfst. |

Authentifiziere dich wie bei der REST-API: ein API-Token oder das JWT eines Endnutzers in
`Authorization: Bearer …`, oder kein Header für öffentlichen Zugriff. Ein ungültiges Token
ergibt `401`, bevor sich der Stream öffnet.

```sh title="Terminal"
curl -N -H "Authorization: Bearer $VERDIN_TOKEN" \
  'https://cms.example.com/api/_events?types=api::article'
```

```text
event: ready
data: {}

event: entry.publish
data: {"event":"entry.publish","uid":"api::article","documentId":"k2m7q4dx8n5t1v3b9c0e6a2wfr","locale":"en"}

event: media.create
data: {"event":"media.create","uid":"plugin::upload","documentId":"v3k9…","fileId":5}
```

## Nachrichten

Das erste Event ist immer `ready`. Danach ist jede Änderung ein SSE-Event, das nach ihr
benannt ist und dessen `data` ein JSON-Objekt ist:

| Feld | Vorhanden | Beschreibung |
| --- | --- | --- |
| `event` | immer | Der Event-Name, wie in der SSE-Zeile `event:`. |
| `uid` | immer | Die UID des Inhaltstyps, oder `plugin::upload` für Medien. |
| `documentId` | immer | Das geänderte Dokument oder die geänderte Datei. |
| `locale` | lokalisierte Typen | Die Sprache der geänderten Version. |
| `fileId` | Medien-Events | Die numerische ID der Datei, wie in Medienfeldern verwendet. |
| `actorId` | Admin-Stream | Der Admin, der die Änderung vorgenommen hat, falls es ein Admin war. |

| Events | Gesendet, wenn | Wer sie bekommt |
| --- | --- | --- |
| `entry.create`, `entry.update`, `entry.discard-draft` | Ein Dokument angelegt, gespeichert oder sein Entwurf verworfen wird | Bei Typen mit Entwurf und Veröffentlichung Aufrufer mit `readDrafts` (diese Events ändern nur Entwürfe). Bei anderen Typen Aufrufer mit `find` oder `findOne`. |
| `entry.publish`, `entry.unpublish`, `entry.delete` | Ein Dokument veröffentlicht, zurückgezogen oder gelöscht wird | Aufrufer mit `find` oder `findOne` auf dem Typ |
| `media.create`, `media.update`, `media.delete` | Eine Datei hochgeladen, bearbeitet oder gelöscht wird | Aufrufer mit `find` oder `findOne` auf der Medienbibliothek |

Events enthalten IDs, keine Inhalte. Um das Dokument oder die Datei zu lesen, hol sie über die
REST- oder GraphQL-API, mit den üblichen Berechtigungen des Aufrufers. Events kommen aus jeder
API: REST, GraphQL, dem Admin-Panel, Releases und Plugins.

## Lebensdauer der Verbindung

- Der Server schickt alle 15 Sekunden einen Keep-alive-Kommentar.
- Ein Content-Stream endet nach einer Stunde. Verbinde dich neu (das `EventSource` der Browser
  macht das von selbst); dabei wird auch das Token erneut geprüft.
- Ein Event namens `lagged` mit `data: {"missed": 12}` bedeutet, dass der Client zu langsam
  gelesen hat und so viele Events verworfen wurden. Lade neu, was der Client anzeigt.
- Es gibt kein Replay: Events, die passieren, während ein Client getrennt ist, werden nicht
  nachgeliefert.

Das `EventSource` der Browser kann keinen `Authorization`-Header senden. Für öffentlichen
Zugriff funktioniert es so, wie es ist; mit einem Token nimm `fetch` mit einem Streaming-Reader
für den Body oder einen SSE-Client, der Header unterstützt.

## Admin-Stream

Das Admin-Panel öffnet mit dem Access-Token des Admins einen eigenen Stream:

```
GET /admin/api/events?types=api::article
```

Er liefert dieselben Content- und Medien-Events für die Typen, die der Admin lesen darf (mit
`content.read` und `media.read`), Entwürfe eingeschlossen, und zusätzlich:

- `actorId` bei Änderungen durch Admins;
- `presence`-Events (siehe unten);
- `comment.create`, `comment.update`, `comment.delete`, `comment.resolve`,
  `comment.reopen`, `task.create`, `task.update` und `task.delete`, mit `uid`,
  `documentId` und `locale` des Eintrags.

Ein Admin-Stream endet nach 15 Minuten, der Lebensdauer eines Access-Tokens: Verbinde dich mit
einem frischen Token neu.

### Präsenz

Der Eintragseditor teilt dem Server mit, wer sich in einem Eintrag befindet:

```
POST /admin/api/presence
{ "uid": "api::article", "documentId": "k2m7q4…", "locale": "en", "editing": true }
```

- Schicke das etwa alle 20 Sekunden, solange der Editor offen ist. `editing: true` bedeutet,
  dass der Admin ungespeicherte Änderungen hat. Schicke `"leave": true`, wenn der Editor
  geschlossen wird.
- Eine Präsenz läuft 45 Sekunden nach dem letzten Heartbeat ab.
- Die Antwort listet, wer sich im Eintrag befindet: `{ "data": [{ "userId": 3, "name": "Ada Lovelace", "editing": true, "holdsLock": true }] }`.
- `GET /admin/api/presence?uid=&documentId=&locale=` liest dieselbe Liste.
- Ändert sich die Liste, bekommen Admin-Streams ein `presence`-Event mit `uid`,
  `documentId` und `locale` des Eintrags und der Liste in `presence`.

Der erste Admin, der noch bearbeitet, hält eine weiche Sperre (`holdsLock`). Der Editor zeigt
sie den anderen an, blockiert aber nicht deren Speichern. Präsenz lesen erfordert
`content.read` auf dem Typ.

## Mehrere Instanzen

Mit dem gemeinsamen Event-Bus (`[cluster].bus = "database"`) tragen die Streams jeder Instanz
die Events aller Instanzen, und Präsenz und weiche Sperren sind auf jeder Instanz dieselben.
Events einer anderen Instanz kommen innerhalb von `[cluster].poll_interval_ms` an (MySQL,
MariaDB, SQLite) oder sofort (PostgreSQL, `LISTEN/NOTIFY`). Ohne den Bus sind Events und
Präsenz die der Instanz, mit der ein Client verbunden ist: Leite `/api/_events` und
`/admin/api/events` mit Sticky Sessions weiter, oder lass Echtzeit-Clients gegen eine einzige
Instanz laufen. Siehe [Skalierung](/de/deploy/scaling/#gemeinsamer-event-bus).
