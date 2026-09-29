---
title: "Webhooki"
description: "Zdarzenia webhooków, format payloadów, nagłówki, weryfikacja podpisów, ponowienia i dziennik dostarczeń."
sidebar:
  order: 6
---

Webhook wysyła HTTP `POST` na twój URL, gdy zmienia się treść lub multimedia. Ta strona jest
dokumentacją referencyjną dla odbiorców: zdarzenia, payloady, nagłówki, podpisy
i dostarczanie. Tworzenie webhooków i zarządzanie nimi w panelu administracyjnym opisuje
strona [Webhooki](/pl/guides/integrations/webhooks/).

## Zdarzenia

| Zdarzenie | Wysyłane, gdy |
| --- | --- |
| `entry.create` | Dokument zostaje utworzony, z dowolnego API: REST, GraphQL, panelu administracyjnego lub wtyczki. |
| `entry.update` | Dokument zostaje zapisany. |
| `entry.publish` | Dokument zostaje opublikowany. Utworzenie lub aktualizacja dokumentu przez REST lub GraphQL bez `status=draft` go publikuje. |
| `entry.unpublish` | Publikacja dokumentu zostaje cofnięta. |
| `entry.discard-draft` | Szkic dokumentu zostaje odrzucony. |
| `entry.delete` | Dokument zostaje usunięty. |
| `media.create`, `media.update`, `media.delete` | Plik zostaje przesłany, edytowany lub usunięty. Usunięcie folderu wysyła `media.delete` dla każdego pliku w nim. |
| `releases.publish` | [Wydanie](/pl/guides/content/releases/) zostało wykonane, od razu lub w swoim terminie. |
| `review-workflows.updateEntryStage` | Wpis przeszedł do innego [etapu recenzji](/pl/guides/content/review-workflows/). |

Webhook subskrybuje wybrane zdarzenia i można go ograniczyć do wybranych typów zawartości.
Zdarzenia multimediów nie są powiązane z typem zawartości.

## Payloady

Każdy payload ma `event` i `createdAt` (kiedy zdarzenie trafiło do kolejki). Zdarzenia wpisów
dodają typ zawartości i dokument:

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

- `model` to `singularName` typu, `uid` jego UID, a `locale` wersja językowa, która się
  zmieniła (`null` w typach nielokalizowanych).
- `entry` to dokument w postaci zwracanej przez API REST, bez relacji, multimediów,
  komponentów i pól `private`.
- `entry.publish` niesie opublikowaną wersję. Pozostałe zdarzenia wpisów niosą szkic albo
  jedyną wersję w typach bez szkiców i publikacji.
- `entry.delete` niesie tylko `{ "documentId": … }`.

Zdarzenia multimediów wysyłają obiekt pliku w `media`, bez `model`, `uid` i `entry`:

```json
{
  "event": "media.create",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "media": { "id": 5, "documentId": "v3k9…", "name": "harbour.jpg", "mime": "image/jpeg", "url": "/uploads/harbour_4f1c.jpg" }
}
```

`releases.publish` wysyła `release` z wynikiem każdej z jego akcji.
`review-workflows.updateEntryStage` wysyła:

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

Tak jak w zdarzeniach wpisów, `model` to nazwa pojedyncza, a `uid` to UID typu zawartości
(przed 0.10 `model` zawierał tu UID).

Przycisk **Wyślij zdarzenie testowe** wysyła `{ "event": "trigger-test", "createdAt": … }`.

## Nagłówki

| Nagłówek | Wartość |
| --- | --- |
| `content-type` | `application/json` |
| `x-verdin-event` | Nazwa zdarzenia. |
| `x-verdin-delivery` | Identyfikator dostarczenia. Jest taki sam przy ponowieniach: użyj go, aby ignorować duplikaty. |
| `x-verdin-signature` | `t=<unix seconds>,v1=<hex>`, gdy webhook jest podpisany. |

Webhooki mogą dodawać własne nagłówki, np. token `authorization` dla twojego endpointu.
Powyższych nagłówków nie można nadpisać.

## Weryfikacja podpisów

Webhooki są domyślnie podpisywane. `v1` to szesnastkowy HMAC-SHA256 z `<t>.<raw body>`,
z kluczem w postaci sekretu webhooka (`whsec_…`). Sekret jest pokazywany raz, gdy webhook
zostaje utworzony lub jego sekret jest rotowany.

Aby sprawdzić dostarczenie:

1. Rozdziel nagłówek na `t` i `v1`.
2. Odrzuć je, jeśli `t` różni się od twojego zegara o więcej niż kilka minut.
3. Oblicz HMAC z `t`, kropki i **surowej** treści żądania. Nie parsuj i nie serializuj
   najpierw ponownie JSON-a: bajty byłyby inne.
4. Porównaj go z `v1` w czasie stałym.

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

W Expressie odczytaj surową treść i zweryfikuj ją przed parsowaniem:

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

W Pythonie:

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

## Dostarczanie i ponowienia

Dostarczenia trafiają do kolejki w bazie danych w chwili zatwierdzenia zmiany, a wysyła je
worker w tle. Wolny lub zawodny endpoint nigdy nie spowalnia redaktorów ani zapisów przez
API, a dostarczenia przetrwają restart.

- **Sukces**: dowolna odpowiedź `2xx`.
- **Niepowodzenie**: każdy inny status, łącznie z przekierowaniami (które nie są
  wykonywane), błąd połączenia lub przekroczenie czasu (`[webhooks].timeout_secs`, domyślnie
  10 sekund).
- **Ponowienia**: nieudane dostarczenie jest ponawiane po 30 sekundach, 2 minutach,
  10 minutach, 1 godzinie i 6 godzinach, łącznie sześć prób. Potem jest oznaczane jako
  nieudane.
- Wyłączenie lub usunięcie webhooka zatrzymuje jego oczekujące ponowienia.
- Kilka instancji dzieli kolejkę; każde dostarczenie przejmuje jedna z nich.

Odpowiadaj szybko kodem `2xx`, a wolną pracę wykonuj potem. Dostarczenia mogą przyjść więcej
niż raz (np. ponowienie po przekroczeniu czasu) i w innej kolejności: używaj
`x-verdin-delivery`, aby pomijać duplikaty, i pobieraj dokument ponownie, gdy kolejność ma
znaczenie.

## Dziennik dostarczeń

Strona każdego webhooka w **Ustawienia → Webhooki** ma **Dziennik dostarczeń**, od
najnowszych. Dla każdego dostarczenia pokazuje status (**Oczekujące**, **Wysyłanie**,
**Powodzenie**, **Niepowodzenie**), status HTTP, pierwsze 2 KB treści odpowiedzi, błąd,
liczbę prób, czas następnej próby, czas trwania i wysłany payload. Nieudane dostarczenie
można ponowić z dziennika.

Zakończone dostarczenia są usuwane po `[webhooks].retention_days` (domyślnie 30).

Te same dane są dostępne przez [API administracyjne](/pl/api/admin/):
`GET /admin/api/webhooks/{id}/deliveries` i `POST /admin/api/webhooks/deliveries/{id}/retry`.

## Ograniczenia URL

Pod `verdin start` URL-e webhooków nie mogą wskazywać adresów loopback, prywatnych,
link-local ani innych zarezerwowanych, niezależnie od tego, czy zapisano je jako adresy IP,
czy jako nazwy hostów, które się na nie rozwiązują. Administrator nie może użyć webhooków,
aby dostać się do usług wewnętrznych. `verdin dev` na nie pozwala, więc możesz testować na
`localhost`; `[webhooks].allow_private_networks` nadpisuje wartość domyślną. URL-e
z poświadczeniami (`https://user:pass@…`) są odrzucane: umieść je w nagłówku.

## Porównanie ze Strapi

Payloady są zgodne ze Strapi (`event`, `createdAt`, `model`, `uid`, `entry`). Verdin dodaje
podpisy, ponowienia, dziennik dostarczeń i filtry według typu zawartości. Zdarzenie Strapi
`entry.draft-discard` nazywa się `entry.discard-draft`.
