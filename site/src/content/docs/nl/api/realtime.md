---
title: "Realtime-API"
description: "Het Server-Sent Events-protocol van de realtime-stream van Verdin: endpoint, authenticatie, eventnamen en berichtvormen, en het presence-protocol van het beheerpaneel."
sidebar:
  order: 5
  label: "Realtime"
---

Verdin streamt wijzigingen in content en media zodra ze worden vastgelegd, via
[Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events) (SSE).
Elke abonnee ontvangt alleen events over wat hij mag lezen. Deze pagina beschrijft het
protocol; voor gebruik in een frontend, zie [Realtime updates](/nl/guides/frontend/realtime/).

## Inschakelen

Realtime staat standaard uit. Zet het aan in **Instellingen → Functies → Realtime** (recht
`features.manage`). Zolang het uit staat, antwoorden de endpoints met `404`.

## Contentstream

```
GET /api/_events
GET /api/_events?types=api::article,api::category
```

| Parameter | Beschrijving |
| --- | --- |
| `types` | Optioneel, door komma's gescheiden UID's van contenttypes; `plugin::upload` is de mediabibliotheek. De Strapi-vorm `api::article.article` werkt ook. Zonder deze parameter ontvang je elk type dat je mag lezen. |

Authenticeer zoals bij de REST-API: een API-token of de JWT van een eindgebruiker in
`Authorization: Bearer …`, of geen header voor openbare toegang. Een ongeldig token geeft `401`
voordat de stream opent.

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

## Berichten

Het eerste event is altijd `ready`. Daarna is elke wijziging een SSE-event met de naam van die
wijziging, waarvan `data` een JSON-object is:

| Veld | Aanwezig | Beschrijving |
| --- | --- | --- |
| `event` | altijd | De eventnaam, zoals in de SSE-regel `event:`. |
| `uid` | altijd | De UID van het contenttype, of `plugin::upload` voor media. |
| `documentId` | altijd | Het gewijzigde document of bestand. |
| `locale` | gelokaliseerde types | De locale van de versie die is gewijzigd. |
| `fileId` | media-events | Het numerieke id van het bestand, zoals gebruikt in mediavelden. |
| `actorId` | adminstream | De beheerder die de wijziging heeft gedaan, als een beheerder die deed. |

| Events | Verzonden wanneer | Wie ze ontvangt |
| --- | --- | --- |
| `entry.create`, `entry.update`, `entry.discard-draft` | Een document wordt aangemaakt of opgeslagen, of het concept ervan wordt verworpen | Bij types met concept en publicatie: aanroepers met `readDrafts` (deze events wijzigen alleen concepten). Bij andere types: aanroepers met `find` of `findOne`. |
| `entry.publish`, `entry.unpublish`, `entry.delete` | Een document wordt gepubliceerd, gedepubliceerd of verwijderd | Aanroepers met `find` of `findOne` op het type |
| `media.create`, `media.update`, `media.delete` | Een bestand wordt geüpload, bewerkt of verwijderd | Aanroepers met `find` of `findOne` op de mediabibliotheek |

Events bevatten id's, geen content. Haal het document of bestand op met de REST- of GraphQL-API
om het te lezen, met de gebruikelijke rechten van de aanroeper. Events komen van elke API: REST,
GraphQL, het beheerpaneel, releases en plugins.

## Levensduur van de verbinding

- De server stuurt elke 15 seconden een keep-alive-commentaar.
- Een contentstream eindigt na een uur. Maak opnieuw verbinding (de `EventSource` van browsers
  doet dat zelf), waarbij het token ook opnieuw wordt gecontroleerd.
- Een event met de naam `lagged`, met `data: {"missed": 12}`, betekent dat de client te traag
  las en dat zoveel events zijn weggevallen. Haal opnieuw op wat de client toont.
- Er is geen replay: events die plaatsvinden terwijl een client niet verbonden is, worden later
  niet verzonden.

De `EventSource` van browsers kan geen header `Authorization` meesturen. Voor openbare toegang
werkt hij zoals hij is; met een token gebruik je `fetch` met een streamende body-reader, of een
SSE-client die headers ondersteunt.

## Adminstream

Het beheerpaneel opent zijn eigen stream met het access token van de beheerder:

```
GET /admin/api/events?types=api::article
```

Die bevat dezelfde content- en media-events voor de types die de beheerder mag lezen (met
`content.read` en `media.read`), concepten inbegrepen, plus:

- `actorId` bij wijzigingen door beheerders;
- `presence`-events (hieronder);
- `comment.create`, `comment.update`, `comment.delete`, `comment.resolve`,
  `comment.reopen`, `task.create`, `task.update` en `task.delete`, met `uid`,
  `documentId` en `locale` van het item.

Een adminstream eindigt na 15 minuten, de levensduur van een access token: maak opnieuw
verbinding met een nieuw token.

### Presence

De item-editor vertelt de server wie er op een item zit:

```
POST /admin/api/presence
{ "uid": "api::article", "documentId": "k2m7q4…", "locale": "en", "editing": true }
```

- Stuur dit ongeveer elke 20 seconden zolang de editor open is. `editing: true` betekent dat de
  beheerder niet-opgeslagen wijzigingen heeft. Stuur `"leave": true` wanneer de editor sluit.
- Een presence verloopt 45 seconden na de laatste heartbeat.
- Het antwoord somt op wie er op het item zit: `{ "data": [{ "userId": 3, "name": "Ada Lovelace", "editing": true, "holdsLock": true }] }`.
- `GET /admin/api/presence?uid=&documentId=&locale=` leest dezelfde lijst.
- Wanneer de lijst verandert, ontvangen adminstreams een `presence`-event met `uid`,
  `documentId` en `locale` van het item en de lijst in `presence`.

De eerste beheerder die nog aan het bewerken is, houdt een zachte vergrendeling (`holdsLock`).
De editor toont die aan de anderen, maar blokkeert hun opslaan niet. Presence lezen vereist
`content.read` op het type.

## Meerdere instanties

Events en presence zijn die van de instantie waarmee een client verbonden is. Achter een
load balancer routeer je `/api/_events` en `/admin/api/events` met sticky sessions, of laat je
realtime-clients met één instantie verbinden. Zie [Schalen](/nl/deploy/scaling/).
