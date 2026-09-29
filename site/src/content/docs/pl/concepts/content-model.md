---
title: "Model treści"
description: "Jak Verdin opisuje twoją treść: typy kolekcji i pojedyncze typy, atrybuty, pliki schematu w formacie Strapi i reguły walidacji."
sidebar:
  order: 1
---

Model treści to zbiór typów zawartości i komponentów zdefiniowanych w twoim projekcie. Verdin
wyprowadza z niego całą resztę: tabele bazy danych, API REST i GraphQL, dokument OpenAPI,
walidację i formularze panelu administracyjnego. Ta strona wyjaśnia jego elementy i reguły,
które ich dotyczą.

## Typy zawartości

Typ zawartości opisuje jeden rodzaj dokumentu, np. artykuł albo stronę główną. Ma `kind`:

| Rodzaj | Zawiera | Trasy REST (przykład bloga) |
| --- | --- | --- |
| `collectionType` | Dowolną liczbę dokumentów | `/api/articles`, `/api/articles/{documentId}` |
| `singleType` | Najwyżej jeden dokument | `/api/homepage` |

Typy kolekcji są udostępniane pod swoim `pluralName`, pojedyncze typy pod `singularName`.
Pierwszy `PUT` do pojedynczego typu tworzy jego dokument. Wszystkie trasy opisuje
[API REST](/pl/api/rest/).

Każdy typ zawartości ma UID, `api::<singularName>` (`api::article`). Strapi zapisuje ten sam
UID jako `api::article.article`; Verdin akceptuje tę formę w plikach schematu i w imporcie
i normalizuje ją do `api::article`.

Każdy dokument ma pola systemowe, których nie deklarujesz: `id`, `documentId` (26-znakowy
ULID małymi literami, stały dla szkiców, opublikowanych wersji i wersji językowych),
`createdAt`, `updatedAt`, `publishedAt` oraz `locale` w
[typach lokalizowanych](/pl/concepts/internationalization/).

## Pliki schematu

Typy zawartości i komponenty to pliki JSON w katalogu `schema/` twojego projektu
(`[schema].path` w `verdin.toml`). Wersjonujesz je w git jak kod.

```
schema/
├── content-types/
│   ├── article.json
│   ├── category.json
│   ├── tag.json
│   └── homepage.json
└── components/
    ├── blocks/
    │   ├── hero.json
    │   └── quote.json
    └── shared/
        └── seo.json
```

Format to `schema.json` ze Strapi, więc większość schematów Strapi wczytuje się bez zmian.
Oto typ artykułu z [przykładu bloga](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog):

```json title="schema/content-types/article.json"
{
  "kind": "collectionType",
  "singularName": "article",
  "pluralName": "articles",
  "displayName": "Article",
  "options": { "draftAndPublish": true },
  "attributes": {
    "title": { "type": "string", "required": true, "maxLength": 200 },
    "slug": { "type": "uid", "targetField": "title", "required": true },
    "excerpt": { "type": "text", "maxLength": 500 },
    "body": { "type": "richtext" },
    "readingTime": { "type": "integer", "min": 0 },
    "featured": { "type": "boolean", "default": false },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "tags": { "type": "relation", "relation": "manyToMany", "target": "tag" },
    "seo": { "type": "component", "component": "shared.seo" },
    "blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"] }
  }
}
```

| Klucz | Wymagany | Opis |
| --- | --- | --- |
| `kind` | tak | `collectionType` lub `singleType`. |
| `singularName` | tak | Kebab-case. Musi odpowiadać nazwie pliku (`article.json`). |
| `pluralName` | tak | Kebab-case, inna niż `singularName`. |
| `displayName` | tak | Nazwa wyświetlana w panelu administracyjnym. |
| `description` | nie | Wyświetlany w panelu administracyjnym. |
| `collectionName` | nie | Nazwa tabeli. Domyślnie `pluralName` w snake_case. |
| `options.draftAndPublish` | nie | Przechowuj szkic i opublikowaną wersję każdego dokumentu. Domyślnie `false`. Zobacz [Szkice i publikacja](/pl/concepts/draft-and-publish/). |
| `pluginOptions.i18n.localized` | nie | Jedna wersja na język. Domyślnie `false`. Zobacz [Internacjonalizacja](/pl/concepts/internationalization/). |
| `attributes` | nie | Pola, w kolejności, w jakiej zwraca je API. |
| `validations` | nie | Reguły między polami; zobacz [niżej](#walidacje-między-polami). |

Schematy są ścisłe: nieznany klucz, opcja, której typ nie obsługuje, albo odwołanie do
nieistniejącego typu lub komponentu to błąd z nazwą pliku i ścieżką, a serwer się nie
uruchamia. Uruchom `verdin schema check`, aby zwalidować pliki bez startowania serwera.

Niektóre nazwy są zajęte:

- Nazwy atrybutów zaczynają się od litery, potem litery, cyfry i podkreślenia, najwyżej
  50 znaków. Stają się kolumnami w snake_case (`metaTitle` → `meta_title`).
- `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`,
  `updatedAt`, `createdBy` i `updatedBy` są zarezerwowane w typach zawartości, a `id` wewnątrz
  komponentów.
- `upload`, `uploads`, `auth`, `users` i `connect` nie mogą być `singularName` ani
  `pluralName`: te trasy należą do API.
- Typ zawartości ma najwyżej 60 atrybutów `string`, `email`, `uid` i `enumeration`, co
  utrzymuje wiersze w limicie rozmiaru wiersza MySQL. Dla części z nich użyj `text`.

Pliki edytujesz w **Kreatorze typów zawartości** panelu, dostępnym, gdy serwer działa
z `verdin dev`, albo ręcznie. Tak czy inaczej zmiana staje się
[migracją schematu](/pl/concepts/schema-migrations/). Układ edytora (kolejność pól,
szerokości, etykiety) nie jest częścią schematu: administratorzy konfigurują go w panelu,
a przechowywany jest w bazie danych.

## Komponenty

Komponent to grupa pól wielokrotnego użytku, np. `shared.seo` (meta tytuł i meta opis). Jego
UID to `<category>.<name>`, wzięte ze ścieżki: `schema/components/shared/seo.json` to
`shared.seo`. Plik komponentu ma `displayName`, opcjonalnie `description` i `icon` oraz
`attributes`.

Strefa dynamiczna to lista łącząca kilka komponentów, np. treść artykułu złożona z bloków
hero i cytatów. Oba są przechowywane wewnątrz dokumentu jako JSON; zobacz
[Komponenty i strefy dynamiczne](/pl/concepts/components-and-dynamic-zones/).

## Atrybuty

Każdy atrybut ma `type` i zależne od niego opcje. Pełna lista typów, ich opcji i typów kolumn
w każdej bazie danych jest w
[dokumentacji typów atrybutów](/pl/reference/attribute-types/).

| Kategoria | Typy |
| --- | --- |
| Tekst | `string`, `text`, `richtext` (Markdown), `blocks` (strukturalny rich text ze Strapi), `email`, `uid`, `password`, `enumeration` |
| Liczby | `integer`, `biginteger`, `float`, `decimal` |
| Daty | `date`, `time`, `datetime` |
| Inne skalarne | `boolean`, `json` |
| Powiązania | `relation` (zobacz [Relacje](/pl/concepts/relations/)), `media` (zobacz [Multimedia](/pl/concepts/media/)) |
| Struktura | `component`, `dynamiczone` |

Typowe opcje:

| Opcja | Efekt |
| --- | --- |
| `required` | Wartość musi być ustawiona przy publikacji wersji (albo przy każdym zapisie w typach bez szkiców i publikacji). Szkice mogą być niekompletne. |
| `private` | Nigdy nie jest zwracane, filtrowane, sortowane ani wypełniane przez API treści. Atrybuty `password` są zawsze prywatne. |
| `default` | Wartość używana, gdy nowy dokument pomija pole. Sprawdzana według reguł samego atrybutu. |
| `unique` | Żadne dwa dokumenty nie mogą mieć tej samej wartości, w obrębie języka i wersji. Dostępne dla `string`, `email`, typów liczbowych, dat i godzin; `uid` jest zawsze unikalny. |
| `configurable` | `false` blokuje atrybut w kreatorze typów zawartości: nie można go tam edytować, zmienić mu nazwy ani usunąć. |
| `pluginOptions.i18n.localized` | `false` współdzieli wartość między językami. |

Każda kolumna atrybutu dopuszcza w bazie danych `NULL`. Jak w Strapi v5, `required`
egzekwuje Verdin przy publikacji, a nie ograniczenie `NOT NULL`, więc dodanie wymaganego
atrybutu do typu, który ma już wiersze, jest bezpieczną zmianą.

## Walidacja

Każdy zapis jest sprawdzany względem schematu, zanim cokolwiek trafi do bazy danych:

- **Typy i ograniczenia**, przy każdym zapisie: typy wartości, `minLength`/`maxLength`,
  `min`/`max`, `regex`, wartości `enum`, liczba elementów w komponentach powtarzalnych
  i strefach dynamicznych, typy komponentów dozwolone w strefie dynamicznej i typy plików
  akceptowane przez pole multimediów. Nieznane klucze i pola systemowe w danych wejściowych
  to błędy.
- **Pola wymagane i reguły między polami**, przy publikacji wersji i przy każdym zapisie
  w typach bez szkiców i publikacji. Obowiązują też wewnątrz komponentów i stref
  dynamicznych.
- **Unikalność**, przez unikalne indeksy w bazie danych, więc dwa równoległe zapisy nie mogą
  się oba powieść.

Nieudane sprawdzenie odpowiada `400` z `ValidationError`, którego `details.errors` wymienia
każdy problem z jego ścieżką, np. `["seo", "metaTitle"]` lub `["blocks", 2, "text"]`.
Zobacz [Błędy](/pl/api/rest/#błędy).

### Walidacje między polami

Typ zawartości może deklarować reguły porównujące jego własne pola, zapisane w
[JSON Logic](https://jsonlogic.com). Ten typ wydarzenia wymaga, by data końca była po dacie
początku, i ogranicza sprzedane bilety do liczby miejsc:

```json title="schema/content-types/event.json"
{
  "kind": "collectionType",
  "singularName": "event",
  "pluralName": "events",
  "displayName": "Event",
  "attributes": {
    "startDate": { "type": "date", "required": true },
    "endDate": { "type": "date" },
    "seats": { "type": "integer", "min": 0 },
    "sold": { "type": "integer", "min": 0 }
  },
  "validations": [
    {
      "rule": { "or": [{ "!": { "var": "endDate" } }, { "<=": [{ "var": "startDate" }, { "var": "endDate" }] }] },
      "message": "must be after the start date",
      "field": "endDate"
    },
    { "rule": { "<=": [{ "var": "sold" }, { "var": "seats" }] }, "message": "more tickets sold than seats" }
  ]
}
```

- Niespełniona reguła to błąd walidacji z `message`, przy `field`, jeśli go podano, albo przy
  dokumencie (`path: []`).
- Reguły działają wtedy, gdy `required`: przy publikacji i przy każdym zapisie w typach bez
  szkiców i publikacji. Szkice mogą je łamać.
- `var` odczytuje własne pola dokumentu, ze ścieżkami z kropkami do komponentów. Relacje
  i multimedia nie są dostępne dla reguł.
- Porównania są liczbowe, gdy obie strony są liczbami, i tekstowe, gdy obie są stringami, więc
  daty, godziny i daty z godziną w ISO porównują się poprawnie. Puste pole to `null`:
  zabezpieczaj pola opcjonalne, jak robi to pierwsza reguła.
- Dozwolone operatory: `var`, `==`, `!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`, `and`,
  `or`, `in`, `if`, `?:`, `+`, `-`, `*`, `/`, `%`, `min`, `max`, `cat`. Nieznany operator,
  nieznane `field` lub puste `message` to błąd schematu.

Reguły sprawdza serwer; panel administracyjny pokazuje ich komunikaty przy wskazanych polach,
gdy publikacja się nie powiedzie. Strapi nie ma odpowiednika. Pola warunkowe Strapi
(`conditions`) są akceptowane w plikach schematu i zachowywane, ale jeszcze niestosowane.
