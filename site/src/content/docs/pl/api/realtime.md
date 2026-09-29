---
title: "API czasu rzeczywistego"
description: "Protokół Server-Sent Events strumienia czasu rzeczywistego w Verdin: endpoint, uwierzytelnianie, nazwy zdarzeń i format wiadomości oraz protokół obecności w panelu."
sidebar:
  order: 5
  label: "Czas rzeczywisty"
---

Verdin przesyła strumieniowo zmiany treści i multimediów w chwili ich zatwierdzenia, przez
[Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events) (SSE).
Każdy subskrybent otrzymuje tylko zdarzenia dotyczące tego, co może czytać. Ta strona opisuje
protokół; o użyciu go we frontendzie przeczytasz w
[Aktualizacjach w czasie rzeczywistym](/pl/guides/frontend/realtime/).

## Włączanie

Czas rzeczywisty jest domyślnie wyłączony. Włącz go w **Ustawienia → Funkcje → Czas
rzeczywisty** (uprawnienie `features.manage`). Gdy jest wyłączony, endpointy odpowiadają
`404`.

## Strumień treści

```
GET /api/_events
GET /api/_events?types=api::article,api::category
```

| Parametr | Opis |
| --- | --- |
| `types` | Opcjonalne UID typów zawartości oddzielone przecinkami; `plugin::upload` to biblioteka multimediów. Działa też forma ze Strapi `api::article.article`. Bez niego otrzymujesz każdy typ, który możesz czytać. |

Uwierzytelniaj się tak jak w API REST: token API lub JWT użytkownika końcowego
w `Authorization: Bearer …` albo brak nagłówka dla dostępu publicznego. Niepoprawny token
daje `401`, zanim strumień się otworzy.

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

## Wiadomości

Pierwszym zdarzeniem jest zawsze `ready`. Potem każda zmiana to zdarzenie SSE nazwane od
niej, którego `data` to obiekt JSON:

| Pole | Obecne | Opis |
| --- | --- | --- |
| `event` | zawsze | Nazwa zdarzenia, jak w linii SSE `event:`. |
| `uid` | zawsze | UID typu zawartości lub `plugin::upload` dla multimediów. |
| `documentId` | zawsze | Zmieniony dokument lub plik. |
| `locale` | typy lokalizowane | Wersja językowa, która się zmieniła. |
| `fileId` | zdarzenia multimediów | Numeryczny identyfikator pliku, używany w polach multimediów. |
| `actorId` | strumień administracyjny | Administrator, który wprowadził zmianę, jeśli zrobił to administrator. |

| Zdarzenia | Wysyłane, gdy | Kto je otrzymuje |
| --- | --- | --- |
| `entry.create`, `entry.update`, `entry.discard-draft` | Dokument zostaje utworzony, zapisany lub jego szkic odrzucony | W typach ze szkicami i publikacją wywołujący z `readDrafts` (te zdarzenia zmieniają tylko szkice). W innych typach wywołujący z `find` lub `findOne`. |
| `entry.publish`, `entry.unpublish`, `entry.delete` | Dokument zostaje opublikowany, wycofany z publikacji lub usunięty | Wywołujący z `find` lub `findOne` na danym typie |
| `media.create`, `media.update`, `media.delete` | Plik zostaje przesłany, edytowany lub usunięty | Wywołujący z `find` lub `findOne` na bibliotece multimediów |

Zdarzenia niosą identyfikatory, nie treść. Aby odczytać dokument lub plik, pobierz go przez API
REST lub GraphQL, ze zwykłymi uprawnieniami wywołującego. Zdarzenia pochodzą z każdego API:
REST, GraphQL, panelu administracyjnego, wydań i wtyczek.

## Czas życia połączenia

- Serwer wysyła komentarz keep-alive co 15 sekund.
- Strumień treści kończy się po godzinie. Połącz się ponownie (przeglądarkowy `EventSource`
  robi to sam), co przy okazji ponownie sprawdza token.
- Zdarzenie `lagged` z `data: {"missed": 12}` oznacza, że klient czytał za wolno i tyle zdarzeń
  zostało pominiętych. Pobierz ponownie to, co pokazuje klient.
- Nie ma odtwarzania: zdarzenia, które zajdą, gdy klient jest rozłączony, nie zostaną wysłane
  później.

Przeglądarkowy `EventSource` nie może wysłać nagłówka `Authorization`. Dla dostępu publicznego
działa bez zmian; z tokenem użyj `fetch` z czytnikiem strumieniowego body albo klienta SSE,
który obsługuje nagłówki.

## Strumień administracyjny

Panel administracyjny otwiera własny strumień z tokenem dostępu administratora:

```
GET /admin/api/events?types=api::article
```

Niesie te same zdarzenia treści i multimediów dla typów, które administrator może czytać
(z `content.read` i `media.read`), łącznie ze szkicami, a do tego:

- `actorId` przy zmianach wprowadzonych przez administratorów;
- zdarzenia `presence` (poniżej);
- `comment.create`, `comment.update`, `comment.delete`, `comment.resolve`,
  `comment.reopen`, `task.create`, `task.update` i `task.delete`, z `uid`, `documentId`
  i `locale` wpisu.

Strumień administracyjny kończy się po 15 minutach, czyli po czasie życia tokenu dostępu:
połącz się ponownie z nowym.

### Obecność

Edytor wpisu informuje serwer, kto jest przy danym wpisie:

```
POST /admin/api/presence
{ "uid": "api::article", "documentId": "k2m7q4…", "locale": "en", "editing": true }
```

- Wysyłaj to mniej więcej co 20 sekund, póki edytor jest otwarty. `editing: true` oznacza, że
  administrator ma niezapisane zmiany. Wyślij `"leave": true`, gdy edytor się zamyka.
- Obecność wygasa 45 sekund po ostatnim sygnale.
- Odpowiedź wymienia, kto jest przy wpisie: `{ "data": [{ "userId": 3, "name": "Ada Lovelace", "editing": true, "holdsLock": true }] }`.
- `GET /admin/api/presence?uid=&documentId=&locale=` odczytuje tę samą listę.
- Gdy lista się zmienia, strumienie administracyjne otrzymują zdarzenie `presence` z `uid`,
  `documentId`, `locale` wpisu i listą w `presence`.

Pierwszy administrator, który wciąż edytuje, trzyma miękką blokadę (`holdsLock`). Edytor
pokazuje ją pozostałym, ale nie blokuje ich zapisów. Odczyt obecności wymaga `content.read` na
danym typie.

## Kilka instancji

Zdarzenia i obecność dotyczą instancji, z którą klient jest połączony. Za load balancerem
kieruj `/api/_events` i `/admin/api/events` z sesjami sticky albo łącz klientów czasu
rzeczywistego z jedną instancją. Zobacz [Skalowanie](/pl/deploy/scaling/).
