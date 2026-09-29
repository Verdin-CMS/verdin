---
title: "API realtime"
description: "Il protocollo Server-Sent Events dello stream in tempo reale di Verdin: endpoint, autenticazione, nomi degli eventi e forma dei messaggi, e il protocollo di presenza dell'admin."
sidebar:
  order: 5
  label: "Tempo reale"
---

Verdin trasmette le modifiche a contenuti e media nel momento in cui vengono confermate,
tramite [Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events)
(SSE). Ogni sottoscrittore riceve solo eventi su ciò che può leggere. Questa pagina descrive
il protocollo; per usarlo in un frontend, vedi
[Aggiornamenti in tempo reale](/it/guides/frontend/realtime/).

## Attivarlo

Il tempo reale è disattivato di default. Attivalo in **Impostazioni → Funzionalità → Tempo
reale** (permesso `features.manage`). Finché è disattivato, gli endpoint rispondono `404`.

## Stream dei contenuti

```
GET /api/_events
GET /api/_events?types=api::article,api::category
```

| Parametro | Descrizione |
| --- | --- |
| `types` | Opzionale, UID di tipi di contenuto separati da virgola; `plugin::upload` è la libreria media. Funziona anche la forma di Strapi `api::article.article`. Senza di esso, ricevi tutti i tipi che puoi leggere. |

Autenticati come sull'API REST: un token API o il JWT di un utente finale in
`Authorization: Bearer …`, o nessun header per l'accesso pubblico. Un token non valido
risponde `401` prima che lo stream si apra.

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

## Messaggi

Il primo evento è sempre `ready`. Poi ogni modifica è un evento SSE con il suo nome, il cui
`data` è un oggetto JSON:

| Campo | Presente | Descrizione |
| --- | --- | --- |
| `event` | sempre | Il nome dell'evento, come nella riga SSE `event:`. |
| `uid` | sempre | L'UID del tipo di contenuto, o `plugin::upload` per i media. |
| `documentId` | sempre | Il documento o file modificato. |
| `locale` | tipi localizzati | La lingua della versione modificata. |
| `fileId` | eventi media | L'id numerico del file, come usato nei campi media. |
| `actorId` | stream admin | L'admin che ha fatto la modifica, quando l'ha fatta un admin. |

| Eventi | Inviati quando | Chi li riceve |
| --- | --- | --- |
| `entry.create`, `entry.update`, `entry.discard-draft` | Un documento viene creato, salvato, o la sua bozza scartata | Sui tipi con bozza e pubblicazione, i chiamanti con `readDrafts` (questi eventi cambiano solo le bozze). Sugli altri tipi, i chiamanti con `find` o `findOne`. |
| `entry.publish`, `entry.unpublish`, `entry.delete` | Un documento viene pubblicato, rimosso dalla pubblicazione o eliminato | I chiamanti con `find` o `findOne` sul tipo |
| `media.create`, `media.update`, `media.delete` | Un file viene caricato, modificato o eliminato | I chiamanti con `find` o `findOne` sulla libreria media |

Gli eventi trasportano id, non contenuto. Recupera il documento o il file con l'API REST o
GraphQL per leggerlo, con i permessi abituali del chiamante. Gli eventi arrivano da tutte le
API: REST, GraphQL, il pannello di amministrazione, i rilasci e i plugin.

## Durata della connessione

- Il server invia un commento keep-alive ogni 15 secondi.
- Uno stream dei contenuti termina dopo un'ora. Riconnettiti (l'`EventSource` dei browser
  lo fa da solo), il che verifica anche di nuovo il token.
- Un evento chiamato `lagged`, con `data: {"missed": 12}`, significa che il client ha letto
  troppo lentamente e che quel numero di eventi è stato scartato. Ricarica ciò che il client
  mostra.
- Non c'è replay: gli eventi che avvengono mentre un client è disconnesso non vengono
  inviati dopo.

L'`EventSource` dei browser non può inviare un header `Authorization`. Per l'accesso
pubblico funziona così com'è; con un token, usa `fetch` con un lettore del corpo in
streaming, o un client SSE che supporti gli header.

## Stream admin

Il pannello di amministrazione apre il proprio stream con l'access token dell'admin:

```
GET /admin/api/events?types=api::article
```

Trasporta gli stessi eventi di contenuti e media per i tipi che l'admin può leggere (con
`content.read` e `media.read`), bozze incluse, più:

- `actorId` sulle modifiche fatte dagli admin;
- eventi `presence` (vedi sotto);
- `comment.create`, `comment.update`, `comment.delete`, `comment.resolve`,
  `comment.reopen`, `task.create`, `task.update` e `task.delete`, con `uid`,
  `documentId` e `locale` della voce.

Uno stream admin termina dopo 15 minuti, la durata di un access token: riconnettiti con uno
nuovo.

### Presenza

L'editor della voce dice al server chi è su una voce:

```
POST /admin/api/presence
{ "uid": "api::article", "documentId": "k2m7q4…", "locale": "en", "editing": true }
```

- Invialo circa ogni 20 secondi mentre l'editor è aperto. `editing: true` significa che
  l'admin ha modifiche non salvate. Invia `"leave": true` quando l'editor si chiude.
- Una presenza scade 45 secondi dopo l'ultimo heartbeat.
- La risposta elenca chi è sulla voce: `{ "data": [{ "userId": 3, "name": "Ada Lovelace", "editing": true, "holdsLock": true }] }`.
- `GET /admin/api/presence?uid=&documentId=&locale=` legge la stessa lista.
- Quando la lista cambia, gli stream admin ricevono un evento `presence` con `uid`,
  `documentId`, `locale` della voce e la lista in `presence`.

Il primo admin che sta ancora modificando detiene un lock morbido (`holdsLock`). L'editor lo
mostra agli altri, ma non blocca i loro salvataggi. Leggere la presenza richiede
`content.read` sul tipo.

## Più istanze

Eventi e presenza sono quelli dell'istanza a cui un client è connesso. Dietro un load
balancer, instrada `/api/_events` e `/admin/api/events` con sessioni sticky, o collega i
client realtime a una sola istanza. Vedi [Scalabilità](/it/deploy/scaling/).
