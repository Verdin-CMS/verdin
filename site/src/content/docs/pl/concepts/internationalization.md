---
title: "Internacjonalizacja"
description: "Jak Verdin przechowuje jedną wersję dokumentu na język, które pola są lokalizowane, a które współdzielone, i jak API wybierają język."
sidebar:
  order: 5
---

Internacjonalizacja (i18n) przechowuje treść dokumentu w kilku językach. Ta strona wyjaśnia
model: wersje językowe, pola lokalizowane i współdzielone oraz to, jak odczyty i zapisy
wybierają język. Pracę redaktora opisuje
[Lokalizowanie treści](/pl/guides/content/localizing-content/).

## Wersje językowe

Języki projektu są wymienione w **Ustawienia → Internacjonalizacja** (uprawnienie
`locales.manage`). Pierwsze uruchomienie dodaje angielski (`en`) jako język domyślny.

- Jeden język jest zawsze domyślny. Używają go żądania, które nie podają języka, i nie można
  go usunąć.
- Kody to język z dwóch lub trzech małych liter, opcjonalnie z subtagami: `en`, `fr`,
  `pt-BR`, `zh-Hans`.

:::caution
Usunięcie języka usuwa też wszystkie napisane w nim wersje.
:::

## Lokalizowane typy zawartości

Typ zawartości jest lokalizowany, gdy tak mówi jego schemat. Każdy dokument ma wtedy jedną
wersję na język, a wszystkie mają wspólny `documentId`:

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

Ze [szkicami i publikacją](/pl/concepts/draft-and-publish/) każdy język ma własny szkic
i opublikowaną wersję, więc francuskie tłumaczenie można opublikować przed angielskim
tekstem albo po nim. Typy bez `pluginOptions.i18n.localized` nie są lokalizowane i ignorują
parametry `locale`.

## Co jest lokalizowane

W typie lokalizowanym każdy atrybut jest lokalizowany, chyba że ma
`"pluginOptions": { "i18n": { "localized": false } }`. Takie pole **współdzielone** ma jedną
wartość dla całego dokumentu:

- Zapisanie pola współdzielonego w jednym języku zapisuje je w szkicach wszystkich języków.
- Publikacja języka kopiuje jego pola współdzielone do opublikowanych wersji pozostałych
  języków.
- Dotyczy to też relacji i multimediów: współdzielona relacja wiąże te same dokumenty
  w każdym języku.

Pola systemowe podążają za wersją: każdy język ma własne `createdAt`, `updatedAt`
i `publishedAt`. Wartości `unique` i `uid` są unikalne w obrębie języka, więc dwa
tłumaczenia mogą mieć ten sam slug.

## Relacje między typami lokalizowanymi

Relacje wiążą dokumenty, nie wersje (zobacz
[Relacje](/pl/concepts/relations/#powiązanie-przez-dokument-nie-przez-wiersz)), więc język
jest wybierany przy odczycie:

- Gdy oba typy są lokalizowane, francuski artykuł pokazuje francuską wersję swojej kategorii.
  Filtry przez relację dopasowują w tym samym języku.
- Gdy typ docelowy nie jest lokalizowany, każdy język widzi ten sam cel.

## Wybór języka w API

REST i API administracyjne przyjmują `locale` jako parametr zapytania, w formacie Strapi v5;
GraphQL przyjmuje argument `locale`:

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

- Bez `locale` żądania odczytują i zapisują język domyślny.
- `PUT` w języku, którego dokument jeszcze nie ma, tworzy tę wersję.
- `DELETE` usuwa tylko wersję w żądanym języku. Powiązania wskazujące dokument są usuwane,
  gdy nie zostanie żaden język.
- Odpowiedzi REST typów lokalizowanych zawierają `locale`. Nieznany język to błąd `400`.
- Payloady webhooków, zdarzenia czasu rzeczywistego i historia treści zapisują język wersji,
  która się zmieniła.

## Uprawnienia per język

Role administratorów mogą ograniczać uprawnienia do treści do wybranych języków, więc
redaktor francuski może czytać lub zmieniać tylko francuskie wersje. Zobacz
[Uprawnienia](/pl/concepts/permissions/#uprawnienia-do-pól-i-języków). Uprawnienia API treści
(dostęp publiczny, tokeny API, role użytkowników końcowych) obowiązują we wszystkich językach.

## Porównanie ze Strapi

Model i parametry odpowiadają i18n w Strapi v5: typy lokalizowane, pola `localized: false`,
`?locale=` i język domyślny. W Verdin i18n jest częścią rdzenia i jest zawsze dostępne:
włączasz je dla danego typu zawartości w schemacie.
