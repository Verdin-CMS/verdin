---
title: "Webhooks"
description: "Webhook-Events, Payload-Formate, Header, Signaturprüfung, Wiederholungen und das Zustellungsprotokoll."
sidebar:
  order: 6
---

Ein Webhook schickt einen HTTP-`POST` an deine URL, wenn sich Inhalte oder Medien ändern. Diese
Seite ist die Referenz für Empfänger: Events, Payloads, Header, Signaturen und Zustellung. Wie
du Webhooks im Admin-Panel anlegst und verwaltest, steht unter
[Webhooks](/de/guides/integrations/webhooks/).

## Events

| Event | Gesendet, wenn |
| --- | --- |
| `entry.create` | Ein Dokument angelegt wird, aus jeder API: REST, GraphQL, dem Admin-Panel oder einem Plugin. |
| `entry.update` | Ein Dokument gespeichert wird. |
| `entry.publish` | Ein Dokument veröffentlicht wird. Wer eines über REST oder GraphQL ohne `status=draft` anlegt oder aktualisiert, veröffentlicht es. |
| `entry.unpublish` | Ein Dokument zurückgezogen wird. |
| `entry.discard-draft` | Der Entwurf eines Dokuments verworfen wird. |
| `entry.delete` | Ein Dokument gelöscht wird. |
| `media.create`, `media.update`, `media.delete` | Eine Datei hochgeladen, bearbeitet oder gelöscht wird. Das Löschen eines Ordners sendet `media.delete` für jede Datei darin. |
| `releases.publish` | Ein [Release](/de/guides/content/releases/) ausgeführt wurde, sofort oder zu seinem Termin. |
| `review-workflows.updateEntryStage` | Ein Eintrag in eine andere [Review-Phase](/de/guides/content/review-workflows/) gewechselt ist. |

Ein Webhook abonniert bestimmte Events und lässt sich auf bestimmte Inhaltstypen beschränken.
Medien-Events hängen an keinem Inhaltstyp.

## Payloads

Jede Payload hat `event` und `createdAt` (wann das Event eingereiht wurde). Eintrags-Events
ergänzen den Inhaltstyp und das Dokument:

```json
{
  "event": "entry.publish",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "model": "article",
  "uid": "api::article",
  "locale": null,
  "entry": {
    "id": 3,
    "documentId": "k2m7q4dx8n5t1v3b9c0e6a2wfr",
    "title": "Hello, Verdin",
    "slug": "hello-verdin",
    "createdAt": "2026-09-25T08:55:00.000Z",
    "updatedAt": "2026-09-25T09:00:00.000Z",
    "publishedAt": "2026-09-25T09:00:00.000Z"
  }
}
```

- `model` ist der `singularName` des Typs, `uid` seine UID und `locale` die Sprache der
  geänderten Version (`null` bei nicht lokalisierten Typen).
- `entry` ist das Dokument so, wie die REST-API es liefert, ohne Relationen, Medien,
  Komponenten oder `private` Felder.
- `entry.publish` enthält die veröffentlichte Version. Andere Eintrags-Events enthalten den
  Entwurf, bei Typen ohne Entwurf und Veröffentlichung die einzige Version.
- `entry.delete` enthält nur `{ "documentId": … }`.

Medien-Events schicken das Dateiobjekt in `media`, ohne `model`, `uid` oder `entry`:

```json
{
  "event": "media.create",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "media": { "id": 5, "documentId": "v3k9…", "name": "harbour.jpg", "mime": "image/jpeg", "url": "/uploads/harbour_4f1c.jpg" }
}
```

`releases.publish` schickt das `release` mit dem Ergebnis jeder seiner Aktionen.
`review-workflows.updateEntryStage` schickt:

```json
{
  "event": "review-workflows.updateEntryStage",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "model": "article",
  "uid": "api::article",
  "entry": { "documentId": "k2m7q4…", "locale": "en" },
  "workflow": { "id": 1, "name": "Editorial" },
  "stages": { "from": { "id": 1, "name": "To do" }, "to": { "id": 2, "name": "In review" } }
}
```

Wie bei Eintrags-Events ist `model` der Singularname und `uid` die UID des Inhaltstyps (vor
0.10 stand hier in `model` die UID).

Der Button **Testereignis senden** schickt `{ "event": "trigger-test", "createdAt": … }`.

## Header

| Header | Wert |
| --- | --- |
| `content-type` | `application/json` |
| `x-verdin-event` | Der Event-Name. |
| `x-verdin-delivery` | Die ID der Zustellung. Sie bleibt über Wiederholungen hinweg gleich: Nutze sie, um Duplikate zu ignorieren. |
| `x-verdin-signature` | `t=<unix seconds>,v1=<hex>`, wenn der Webhook signiert ist. |

Webhooks können eigene Header ergänzen, etwa ein `authorization`-Token für deinen Endpunkt.
Die Header oben lassen sich nicht überschreiben.

## Signaturen prüfen

Webhooks sind standardmäßig signiert. `v1` ist der hexkodierte HMAC-SHA256 von
`<t>.<raw body>`, mit dem Secret des Webhooks (`whsec_…`) als Schlüssel. Das Secret wird
einmal angezeigt, wenn der Webhook angelegt oder sein Secret rotiert wird.

So prüfst du eine Zustellung:

1. Zerlege den Header in `t` und `v1`.
2. Lehne sie ab, wenn `t` mehr als ein paar Minuten von deiner Uhr abweicht.
3. Berechne den HMAC über `t`, einen Punkt und den **rohen** Request-Body. Parse und
   serialisiere das JSON vorher nicht neu: Die Bytes wären andere.
4. Vergleiche ihn in konstanter Zeit mit `v1`.

```js title="verify.mjs"
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, header, rawBody, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=')));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const received = parts.v1 ?? '';
  return (
    received.length === expected.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  );
}
```

Mit Express liest du den rohen Body und prüfst ihn vor dem Parsen:

```js title="server.mjs"
import express from 'express';
import { verify } from './verify.mjs';

const app = express();

app.post('/hooks/verdin', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body.toString('utf8');
  if (!verify(process.env.VERDIN_WEBHOOK_SECRET, req.get('x-verdin-signature') ?? '', rawBody)) {
    return res.sendStatus(401);
  }
  const payload = JSON.parse(rawBody);
  console.log(req.get('x-verdin-delivery'), payload.event, payload.entry?.documentId);
  res.sendStatus(204);
});

app.listen(3000);
```

In Python:

```python title="verify.py"
import hashlib
import hmac
import time


def verify(secret: str, header: str, raw_body: bytes, tolerance: int = 300) -> bool:
    parts = dict(part.split("=", 1) for part in header.split(","))
    if abs(time.time() - int(parts["t"])) > tolerance:
        return False
    signed = parts["t"].encode() + b"." + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))
```

## Zustellung und Wiederholungen

Zustellungen werden beim Commit der Änderung in der Datenbank eingereiht, und ein
Hintergrund-Worker verschickt sie. Ein langsamer oder fehlerhafter Endpunkt bremst nie
Redakteure oder API-Schreibzugriffe aus, und Zustellungen überstehen einen Neustart.

- **Erfolg**: jede `2xx`-Antwort.
- **Fehlschlag**: jeder andere Status, auch Weiterleitungen (denen nicht gefolgt wird), ein
  Verbindungsfehler oder ein Timeout (`[webhooks].timeout_secs`, standardmäßig 10 Sekunden).
- **Wiederholungen**: Eine fehlgeschlagene Zustellung wird nach 30 Sekunden, 2 Minuten,
  10 Minuten, 1 Stunde und 6 Stunden erneut versucht, insgesamt sechs Versuche. Danach gilt sie
  als fehlgeschlagen.
- Deaktivieren oder Löschen eines Webhooks stoppt seine ausstehenden Wiederholungen.
- Mehrere Instanzen teilen sich die Warteschlange; jede Zustellung übernimmt genau eine von
  ihnen.

Antworte schnell mit einem `2xx` und erledige langsame Arbeit danach. Zustellungen können mehr
als einmal ankommen (etwa bei einer Wiederholung nach einem Timeout) und in falscher
Reihenfolge: Nutze `x-verdin-delivery`, um Duplikate zu überspringen, und hol das Dokument neu,
wenn die Reihenfolge wichtig ist.

## Zustellungsprotokoll

Die Seite jedes Webhooks unter **Einstellungen → Webhooks** hat ein **Zustellungsprotokoll**,
das Neueste zuerst. Zu jeder Zustellung zeigt es den Status (**Ausstehend**,
**Wird gesendet**, **Erfolgreich**, **Fehlgeschlagen**), den HTTP-Status, die ersten 2 KB des
Response-Bodys, den Fehler, die Zahl der Versuche, den Zeitpunkt des nächsten Versuchs, die
Dauer und die gesendete Payload. Eine fehlgeschlagene Zustellung lässt sich aus dem Protokoll
heraus erneut senden.

Abgeschlossene Zustellungen werden nach `[webhooks].retention_days` (standardmäßig 30)
entfernt.

Dieselben Daten liefert die [Admin-API](/de/api/admin/):
`GET /admin/api/webhooks/{id}/deliveries` und `POST /admin/api/webhooks/deliveries/{id}/retry`.

## URL-Beschränkungen

Unter `verdin start` dürfen Webhook-URLs nicht auf Loopback-, private, Link-Local- oder andere
reservierte Adressen zeigen, egal ob als IP-Adresse geschrieben oder als Hostname, der dorthin
auflöst. Ein Admin kann Webhooks also nicht nutzen, um interne Dienste zu erreichen.
`verdin dev` erlaubt sie, damit du gegen `localhost` testen kannst;
`[webhooks].allow_private_networks` überschreibt den Standard. URLs mit Zugangsdaten
(`https://user:pass@…`) werden abgelehnt: Leg die Zugangsdaten in einen Header.

## Im Vergleich zu Strapi

Die Payloads folgen denen von Strapi (`event`, `createdAt`, `model`, `uid`, `entry`). Verdin
ergänzt Signaturen, Wiederholungen, ein Zustellungsprotokoll und Filter pro Inhaltstyp. Das
Strapi-Event `entry.draft-discard` heißt `entry.discard-draft`.
