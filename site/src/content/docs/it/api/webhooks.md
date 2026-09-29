---
title: "Webhook"
description: "Eventi dei webhook, forma dei payload, header, verifica della firma, tentativi e registro degli invii."
sidebar:
  order: 6
---

Un webhook invia un `POST` HTTP al tuo URL quando cambiano contenuti o media. Questa pagina è
il riferimento per chi li riceve: eventi, payload, header, firme e consegna. Per creare e
gestire i webhook nel pannello di amministrazione, vedi
[Webhook](/it/guides/integrations/webhooks/).

## Eventi

| Evento | Inviato quando |
| --- | --- |
| `entry.create` | Viene creato un documento, da qualsiasi API: REST, GraphQL, il pannello di amministrazione o un plugin. |
| `entry.update` | Viene salvato un documento. |
| `entry.publish` | Viene pubblicato un documento. Crearne o aggiornarne uno via REST o GraphQL senza `status=draft` lo pubblica. |
| `entry.unpublish` | Un documento viene rimosso dalla pubblicazione. |
| `entry.discard-draft` | Viene scartata la bozza di un documento. |
| `entry.delete` | Viene eliminato un documento. |
| `media.create`, `media.update`, `media.delete` | Un file viene caricato, modificato o eliminato. Eliminare una cartella invia `media.delete` per ogni file che contiene. |
| `releases.publish` | Un [rilascio](/it/guides/content/releases/) è stato eseguito, subito o alla sua data. |
| `review-workflows.updateEntryStage` | Una voce è passata a un'altra [fase di revisione](/it/guides/content/review-workflows/). |

Un webhook si iscrive ad alcuni eventi e può essere limitato ad alcuni tipi di contenuto. Gli
eventi media non sono legati a un tipo di contenuto.

## Payload

Ogni payload ha `event` e `createdAt` (quando l'evento è stato messo in coda). Gli eventi
delle voci aggiungono il tipo di contenuto e il documento:

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

- `model` è il `singularName` del tipo, `uid` il suo UID, e `locale` la lingua della versione
  modificata (`null` sui tipi non localizzati).
- `entry` è il documento come lo restituisce l'API REST, senza relazioni, media, componenti o
  campi `private`.
- `entry.publish` porta la versione pubblicata. Gli altri eventi delle voci portano la bozza,
  o l'unica versione sui tipi senza bozza e pubblicazione.
- `entry.delete` porta solo `{ "documentId": … }`.

Gli eventi media inviano l'oggetto file in `media`, senza `model`, `uid` o `entry`:

```json
{
  "event": "media.create",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "media": { "id": 5, "documentId": "v3k9…", "name": "harbour.jpg", "mime": "image/jpeg", "url": "/uploads/harbour_4f1c.jpg" }
}
```

`releases.publish` invia il `release` con il risultato di ciascuna delle sue azioni.
`review-workflows.updateEntryStage` invia:

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

Come negli eventi delle voci, `model` è il nome singolare e `uid` l'UID del tipo di contenuto
(prima della 0.10, qui `model` conteneva l'UID).

Il pulsante **Invia evento di prova** invia `{ "event": "trigger-test", "createdAt": … }`.

## Header

| Header | Valore |
| --- | --- |
| `content-type` | `application/json` |
| `x-verdin-event` | Il nome dell'evento. |
| `x-verdin-delivery` | L'id dell'invio. Resta lo stesso tra un tentativo e l'altro: usalo per ignorare i duplicati. |
| `x-verdin-signature` | `t=<unix seconds>,v1=<hex>`, quando il webhook è firmato. |

I webhook possono aggiungere header propri, come un token `authorization` per il tuo
endpoint. Gli header qui sopra non si possono sovrascrivere.

## Verificare le firme

I webhook sono firmati di default. `v1` è l'HMAC-SHA256 esadecimale di `<t>.<raw body>`, con
chiave il segreto del webhook (`whsec_…`). Il segreto viene mostrato una sola volta, quando il
webhook viene creato o il suo segreto viene ruotato.

Per verificare un invio:

1. Separa l'header in `t` e `v1`.
2. Rifiutalo se `t` si discosta di più di qualche minuto dal tuo orologio.
3. Calcola l'HMAC su `t`, un punto e il corpo della richiesta **grezzo**. Non fare prima il
   parsing e la riserializzazione del JSON: i byte sarebbero diversi.
4. Confrontalo con `v1` in tempo costante.

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

Con Express, leggi il corpo grezzo e verificalo prima del parsing:

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

## Consegna e tentativi

Gli invii vengono messi in coda nel database quando la modifica viene confermata, e un
worker in background li invia. Un endpoint lento o in errore non rallenta mai i redattori né
le scritture dell'API, e gli invii sopravvivono a un riavvio.

- **Successo**: qualsiasi risposta `2xx`.
- **Fallimento**: qualsiasi altro stato, inclusi i redirect (che non vengono seguiti), un
  errore di connessione o un timeout (`[webhooks].timeout_secs`, 10 secondi di default).
- **Tentativi**: un invio fallito viene ritentato dopo 30 secondi, 2 minuti, 10 minuti, 1
  ora e 6 ore, sei tentativi in tutto. Poi viene segnato come non riuscito.
- Disattivare o eliminare un webhook ferma i suoi tentativi in sospeso.
- Più istanze condividono la coda; ogni invio viene preso in carico da una di esse.

Rispondi subito con un `2xx` e fai il lavoro lento dopo. Gli invii possono arrivare più di
una volta (un nuovo tentativo dopo un timeout, per esempio) e fuori ordine: usa
`x-verdin-delivery` per saltare i duplicati, e ricarica il documento quando l'ordine conta.

## Registro degli invii

La pagina di ogni webhook in **Impostazioni → Webhook** ha un **Registro degli invii**, dal
più recente. Per ogni invio mostra lo stato (**In attesa**, **Invio in corso**,
**Riuscito**, **Non riuscito**), lo stato HTTP, i primi 2 KB del corpo della risposta,
l'errore, il numero di tentativi, l'ora del prossimo tentativo, la durata e il payload
inviato. Un invio fallito può essere ritentato dal registro.

Gli invii conclusi vengono rimossi dopo `[webhooks].retention_days` (30 di default).

Gli stessi dati sono disponibili dall'[API admin](/it/api/admin/):
`GET /admin/api/webhooks/{id}/deliveries` e `POST /admin/api/webhooks/deliveries/{id}/retry`.

## Restrizioni sugli URL

Sotto `verdin start`, gli URL dei webhook non possono puntare a indirizzi di loopback,
privati, link-local o altri indirizzi riservati, che siano scritti come indirizzi IP o come
nomi host che si risolvono in essi. Un admin non può usare i webhook per raggiungere servizi
interni. `verdin dev` li consente, così puoi fare test su `localhost`;
`[webhooks].allow_private_networks` sovrascrive il default. Gli URL con credenziali
(`https://user:pass@…`) vengono rifiutati: mettile in un header.

## Confronto con Strapi

I payload seguono quelli di Strapi (`event`, `createdAt`, `model`, `uid`, `entry`). Verdin
aggiunge firme, tentativi, un registro degli invii e filtri per tipo di contenuto. L'evento
`entry.draft-discard` di Strapi si chiama `entry.discard-draft`.
