---
title: "Webhooks"
description: "Webhook-events, payloadvormen, headers, verificatie van handtekeningen, nieuwe pogingen en het afleveringslogboek."
sidebar:
  order: 6
---

Een webhook stuurt een HTTP-`POST` naar je URL wanneer content of media verandert. Deze pagina is
de referentie voor ontvangers: events, payloads, headers, handtekeningen en aflevering. Om
webhooks in het beheerpaneel aan te maken en te beheren, zie [Webhooks](/nl/guides/integrations/webhooks/).

## Events

| Event | Verzonden wanneer |
| --- | --- |
| `entry.create` | Een document wordt aangemaakt, via welke API dan ook: REST, GraphQL, het beheerpaneel of een plugin. |
| `entry.update` | Een document wordt opgeslagen. |
| `entry.publish` | Een document wordt gepubliceerd. Een document via REST of GraphQL aanmaken of bijwerken zonder `status=draft` publiceert het. |
| `entry.unpublish` | Een document wordt gedepubliceerd. |
| `entry.discard-draft` | Het concept van een document wordt verworpen. |
| `entry.delete` | Een document wordt verwijderd. |
| `media.create`, `media.update`, `media.delete` | Een bestand wordt geüpload, bewerkt of verwijderd. Een map verwijderen stuurt `media.delete` voor elk bestand erin. |
| `releases.publish` | Een [release](/nl/guides/content/releases/) is uitgevoerd, nu of op de ingestelde datum. |
| `review-workflows.updateEntryStage` | Een item is naar een andere [reviewfase](/nl/guides/content/review-workflows/) verplaatst. |

Een webhook abonneert zich op bepaalde events en kan worden beperkt tot bepaalde contenttypes.
Media-events zijn niet aan een contenttype gebonden.

## Payloads

Elke payload heeft `event` en `createdAt` (wanneer het event in de wachtrij kwam). Item-events
voegen het contenttype en het document toe:

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

- `model` is de `singularName` van het type, `uid` zijn UID, en `locale` de locale van de
  versie die is gewijzigd (`null` bij types die niet gelokaliseerd zijn).
- `entry` is het document zoals de REST-API het teruggeeft, zonder relaties, media, componenten
  of `private` velden.
- `entry.publish` bevat de gepubliceerde versie. Andere item-events bevatten het concept, of de
  enige versie bij types zonder concept en publicatie.
- `entry.delete` bevat alleen `{ "documentId": … }`.

Media-events sturen het bestandsobject in `media`, zonder `model`, `uid` of `entry`:

```json
{
  "event": "media.create",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "media": { "id": 5, "documentId": "v3k9…", "name": "harbour.jpg", "mime": "image/jpeg", "url": "/uploads/harbour_4f1c.jpg" }
}
```

`releases.publish` stuurt de `release` met het resultaat van elk van zijn acties.
`review-workflows.updateEntryStage` stuurt:

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

Net als bij item-events is `model` de enkelvoudige naam en `uid` de UID van het contenttype
(vóór 0.10 bevatte `model` hier de UID).

De knop **Testgebeurtenis verzenden** stuurt `{ "event": "trigger-test", "createdAt": … }`.

## Headers

| Header | Waarde |
| --- | --- |
| `content-type` | `application/json` |
| `x-verdin-event` | De eventnaam. |
| `x-verdin-delivery` | Het id van de aflevering. Het blijft gelijk bij nieuwe pogingen: gebruik het om duplicaten te negeren. |
| `x-verdin-signature` | `t=<unix seconds>,v1=<hex>`, als de webhook ondertekend is. |

Webhooks kunnen eigen headers toevoegen, zoals een `authorization`-token voor je endpoint. De
headers hierboven kunnen niet worden overschreven.

## Handtekeningen verifiëren

Webhooks zijn standaard ondertekend. `v1` is de hex-HMAC-SHA256 van `<t>.<raw body>`, met het
geheim van de webhook (`whsec_…`) als sleutel. Het geheim wordt één keer getoond, wanneer de
webhook wordt aangemaakt of het geheim wordt geroteerd.

Zo controleer je een aflevering:

1. Splits de header in `t` en `v1`.
2. Weiger hem als `t` meer dan een paar minuten van je klok afwijkt.
3. Bereken de HMAC over `t`, een punt en de **ruwe** request-body. Parse en serialiseer de JSON
   niet eerst opnieuw: dan wijken de bytes af.
4. Vergelijk hem in constante tijd met `v1`.

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

Met Express lees je de ruwe body en verifieer je die vóór het parsen:

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

## Aflevering en nieuwe pogingen

Afleveringen worden in de database in de wachtrij gezet wanneer de wijziging wordt vastgelegd,
en een worker op de achtergrond verstuurt ze. Een traag of falend endpoint vertraagt nooit
redacteuren of API-schrijfacties, en afleveringen overleven een herstart.

- **Succes**: elk `2xx`-antwoord.
- **Mislukking**: elke andere status, inclusief redirects (die niet worden gevolgd), een
  verbindingsfout of een time-out (`[webhooks].timeout_secs`, standaard 10 seconden).
- **Nieuwe pogingen**: een mislukte aflevering wordt opnieuw geprobeerd na 30 seconden,
  2 minuten, 10 minuten, 1 uur en 6 uur, zes pogingen in totaal. Daarna wordt hij als mislukt
  gemarkeerd.
- Een webhook uitschakelen of verwijderen stopt zijn openstaande nieuwe pogingen.
- Meerdere instanties delen de wachtrij; elke aflevering wordt door één ervan opgepakt.

Antwoord snel met een `2xx` en doe traag werk daarna. Afleveringen kunnen meer dan eens aankomen
(bijvoorbeeld een nieuwe poging na een time-out) en in een andere volgorde: gebruik
`x-verdin-delivery` om duplicaten over te slaan, en haal het document opnieuw op als de volgorde
ertoe doet.

## Afleveringslogboek

De pagina van elke webhook in **Instellingen → Webhooks** heeft een **Afleveringslogboek**,
nieuwste eerst. Per aflevering toont het de status (**In behandeling**, **Wordt verzonden**,
**Geslaagd**, **Mislukt**), de HTTP-status, de eerste 2 KB van de response-body, de fout, het
aantal pogingen, het tijdstip van de volgende poging, de duur en de verzonden payload. Een
mislukte aflevering kan vanuit het logboek opnieuw worden geprobeerd.

Afgeronde afleveringen worden verwijderd na `[webhooks].retention_days` (standaard 30).

Dezelfde gegevens zijn beschikbaar via de [admin-API](/nl/api/admin/):
`GET /admin/api/webhooks/{id}/deliveries` en `POST /admin/api/webhooks/deliveries/{id}/retry`.

## URL-beperkingen

Onder `verdin start` mogen webhook-URL's niet wijzen naar loopback-, privé-, link-local- of andere
gereserveerde adressen, of ze nu als IP-adres zijn geschreven of als hostnaam die ernaar
resolvet. Een beheerder kan webhooks niet gebruiken om interne services te bereiken. `verdin dev`
staat ze toe, zodat je tegen `localhost` kunt testen; `[webhooks].allow_private_networks`
overschrijft de standaard. URL's met inloggegevens (`https://user:pass@…`) worden geweigerd: zet
die in een header.

## Vergeleken met Strapi

Payloads volgen die van Strapi (`event`, `createdAt`, `model`, `uid`, `entry`). Verdin voegt
handtekeningen, nieuwe pogingen, een afleveringslogboek en filters per contenttype toe. Het event
`entry.draft-discard` van Strapi heet `entry.discard-draft`.
