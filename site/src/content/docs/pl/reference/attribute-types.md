---
title: Dokumentacja typów atrybutów
description: Każdy typ atrybutu w pliku schematu Verdin, z opcjami, walidacją, przechowywaniem w bazie danych i reprezentacją w API.
sidebar:
  order: 4
  label: Typy atrybutów
---

<!-- Written from crates/verdin-schema (convert.rs, validate.rs, model.rs),
crates/verdin-migrate/src/derive.rs and sql.rs (storage), and crates/verdin-content
(input.rs, output.rs, blocks.rs) (API). -->

Atrybuty to pola typu zawartości lub komponentu, zadeklarowane pod `attributes` w jego pliku
schematu. Ta strona wymienia każdy `type`, przyjmowane opcje, sposób walidacji
i przechowywania w Verdin oraz wygląd w API. Format to format Strapi v5; różnice są
wymienione [na końcu](#różnice-względem-strapi).

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
    "readingTime": { "type": "integer", "min": 0 },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "seo": { "type": "component", "component": "shared.seo" }
  }
}
```

Pliki schematu są ścisłe: nieznany klucz albo opcja, której typ nie przyjmuje, to błąd,
który `verdin schema check` zgłasza wraz ze ścieżką (`attributes.title.maxLength`).

## Opcje wspólne dla wszystkich atrybutów

| Opcja | Domyślnie | Opis |
| --- | --- | --- |
| `type` | wymagany | Jeden z poniższych typów. |
| `required` | `false` | Wartość musi być obecna. Sprawdzane przy publikacji wpisu (szkice mogą być niekompletne) i przy każdym zapisie typu bez szkiców i publikacji. Dotyczy też wnętrza komponentów i stref dynamicznych. |
| `private` | `false` | Nigdy nie zwracany przez API treści i niedostępny w `filters` ani `sort`. Atrybuty `password` są zawsze prywatne. |
| `configurable` | `true` | Flaga Strapi dla kreatora w panelu; zachowywana tak, jak została zapisana. |
| `pluginOptions.i18n.localized` | `true` | W lokalizowanym typie zawartości `false` współdzieli wartość między językami zamiast jednej wartości na język. |
| `customField` | nieustawiony | `plugin::<plugin>.<field>` (lub `global::<field>`): panel edytuje atrybut polem niestandardowym wtyczki. `type` określa sposób przechowywania wartości. Zobacz [Wtyczki](/pl/extending/plugins/). |
| `conditions` | nieustawiony | Pola warunkowe Strapi (`{ "visible": <JSON Logic> }`). Edytor ukrywa pole, dopóki reguła jest fałszywa, a serwer nie wymaga ukrytego pola. |
| `default` | nieustawiony | Wartość nowych wpisów, gdy zapis pomija atrybut. Musi być poprawna dla typu. Nie każdy typ ją przyjmuje (zobacz poszczególne typy). |

Nazwy atrybutów zaczynają się od litery, potem litery, cyfry i `_`, najwyżej 50 znaków.
W typach zawartości zarezerwowane są `id`, `documentId`, `locale`, `publicationState`,
`publishedAt`, `createdAt`, `updatedAt`, `createdBy` i `updatedBy`; w komponentach `id`.
Dwie nazwy mapujące się na tę samą kolumnę (`metaTitle` i `meta_title`) to błąd.

### Gdzie przechowywane są wartości

Każdy atrybut typu zawartości to kolumna tabeli typu (`collectionName` lub nazwa mnoga),
nazwana w `snake_case`. Relacje i multimedia są zamiast tego w tabelach powiązań. Szkic i jego
opublikowana wersja to dwa wiersze, po jednym na język w typach lokalizowanych.

Typy kolumn w poszczególnych bazach danych:

| Kolumna | PostgreSQL | MySQL i MariaDB | SQLite |
| --- | --- | --- | --- |
| varchar | `varchar(255)` | `varchar(255)` | `text` |
| text | `text` | `longtext` | `text` |
| integer | `integer` | `int` | `integer` |
| bigint | `bigint` | `bigint` | `integer` |
| double | `double precision` | `double` | `real` |
| decimal | `numeric(p,s)` | `decimal(p,s)` | `text` (dokładnie) |
| boolean | `boolean` | `tinyint(1)` | `integer` |
| date | `date` | `date` | `text` |
| time | `time(3)` | `time(3)` | `text` |
| datetime | `timestamptz(3)` | `datetime(3)` | `text` |
| json | `jsonb` | `json` | `text` |

Typ zawartości może mieć najwyżej 60 atrybutów `string`, `email`, `uid` i `enumeration`
(limit rozmiaru wiersza MySQL); dla kolejnych używaj `text`.

### `unique`

Typy przyjmujące `unique: true` dostają unikalny indeks na
`(column, locale, publication_state)`: dwa opublikowane wpisy albo dwa szkice w tym samym
języku nie mogą mieć tej samej wartości, a szkic i jego własna opublikowana wersja mogą.
Zapis, który to łamie, kończy się błędem walidacji na atrybucie. Wewnątrz komponentów
`unique` jest akceptowane, ale nieegzekwowane (wartości komponentów są przechowywane jako
JSON).

## Tekst

### `string`

Jedna linia tekstu.

| Opcja | Opis |
| --- | --- |
| `minLength`, `maxLength` | Granice długości w znakach. `maxLength` najwyżej 255. |
| `regex` | Wzorzec, do którego wartość musi pasować. Składnia w stylu JavaScript, łącznie z look-around i odwołaniami wstecznymi. |
| `unique` | Zobacz [`unique`](#unique). |
| `default` | String w granicach, pasujący do `regex`. |

Przechowywany jako `varchar(255)`. API: string.

### `text`

Dłuższy zwykły tekst (textarea w panelu).

| Opcja | Opis |
| --- | --- |
| `minLength`, `maxLength` | Granice długości, bez górnego limitu. |
| `default` | String w granicach. |

Przechowywany jako `text` (`longtext` w MySQL). API: string.

### `richtext`

Tekst Markdown. Te same opcje, przechowywanie i API co `text`; panel edytuje go edytorem
Markdown.

### `blocks`

Rich text jako JSON bloków ze Strapi: lista bloków `paragraph`, `heading` (`level` od 1 do 6),
`list` (`format` `ordered` lub `unordered`, z dziećmi `list-item`, zagnieżdżonymi do
8 poziomów), `quote`, `code` (opcjonalne `language`) i `image`. Dzieci inline to węzły `text`
ze znacznikami `bold`, `italic`, `underline`, `strikethrough` i `code` oraz węzły `link`.
Najwyżej 10 000 bloków.

Bez opcji, bez `default`. Przechowywany jako JSON. API: lista bloków w zapisanej postaci.

```json
[
  { "type": "heading", "level": 2, "children": [{ "type": "text", "text": "Hello" }] },
  { "type": "paragraph", "children": [{ "type": "text", "text": "bold", "bold": true }] }
]
```

### `email`

Adres e-mail (`name@domain.tld`, bez spacji).

| Opcja | Opis |
| --- | --- |
| `minLength`, `maxLength` | Granice długości; `maxLength` najwyżej 255. |
| `unique` | Zobacz [`unique`](#unique). |
| `default` | Adres e-mail. |

Przechowywany jako `varchar(255)`. API: string.

### `password`

Sekret, hashowany przy zapisie przez Argon2id.

| Opcja | Opis |
| --- | --- |
| `minLength`, `maxLength` | Granice długości wysłanego hasła. |

Bez `default`. Zawsze prywatny: nigdy nie jest zwracany, filtrowany ani sortowany.
Niedozwolony wewnątrz komponentów. Przechowywany jako `varchar(255)` (hash). Importy
zachowują istniejące hashe bcrypt i Argon2 bez zmian, więc zaimportowane konta mogą się
nadal logować.

### `uid`

Identyfikator do URL-i, jak slug. Panel generuje go z `targetField`.

| Opcja | Opis |
| --- | --- |
| `targetField` | Atrybut `string` lub `text` tego samego typu, z którego generowana jest wartość. |
| `minLength`, `maxLength` | Granice długości; `maxLength` najwyżej 255. |
| `regex` | Wzorzec, do którego muszą pasować wartości; bez niego `^[A-Za-z0-9\-_.~]*$`. |
| `default` | Poprawna wartość. |

Zawsze unikalny (zobacz [`unique`](#unique)). Przechowywany jako `varchar(255)`. API: string.

### `enumeration`

Jedna wartość ze stałej listy.

| Opcja | Opis |
| --- | --- |
| `enum` | Wartości: co najmniej jedna, każda od 1 do 255 znaków, bez duplikatów. |
| `default` | Jedna z wartości. |

Przechowywany jako `varchar(255)`. API: string. Zapisy każdej innej wartości kończą się
błędem.

## Liczby

### `integer`

32-bitowa liczba całkowita (od −2 147 483 648 do 2 147 483 647).

| Opcja | Opis |
| --- | --- |
| `min`, `max` | Granice (liczby całkowite). |
| `unique` | Zobacz [`unique`](#unique). |
| `default` | Liczba całkowita w granicach. |

Przechowywany jako `integer`. API: liczba. Zapisy przyjmują liczby i stringi z liczbami
całkowitymi.

### `biginteger`

64-bitowa liczba całkowita. Te same opcje co `integer`.

Przechowywany jako `bigint`. API: string (`"9007199254740993"`), jak w Strapi, bo liczby
JavaScript tracą precyzję powyżej 2⁵³. Zapisy przyjmują stringi i liczby.

### `float`

Liczba zmiennoprzecinkowa podwójnej precyzji. Te same opcje co `integer`, z granicami
liczbowymi.

Przechowywany jako `double precision` (`double`, `real`). API: liczba.

### `decimal`

Dokładna liczba dziesiętna.

| Opcja | Domyślnie | Opis |
| --- | --- | --- |
| `precision` | `10` | Łączna liczba cyfr, od 1 do 38. |
| `scale` | `2` | Cyfry po przecinku, najwyżej `precision`. |
| `min`, `max` | | Granice. |
| `unique` | | Zobacz [`unique`](#unique). |
| `default` | | Liczba w granicach. |

Wartości są zaokrąglane do `scale` cyfr (połówki od zera, jak w bazach danych) i odrzucane,
gdy mają więcej niż `precision - scale` cyfr przed przecinkiem. Zapisy przyjmują liczby
i stringi liczbowe. Przechowywany jako `numeric(precision,scale)` (`text` w SQLite, więc nic
nie jest zaokrąglane). API: liczba albo dokładny string z
[`[api].decimal_as_string`](/pl/reference/configuration/).

## Daty i wartości logiczne

### `boolean`

`true` lub `false`. Przyjmuje `default`. Przechowywany jako `boolean` (`tinyint(1)`,
`integer`). API: wartość logiczna.

### `date`

Data kalendarzowa, `YYYY-MM-DD`. Przyjmuje `unique` i `default`. Przechowywany jako `date`.
API: `"2026-09-29"`.

### `time`

Godzina, `HH:MM`, `HH:MM:SS` lub `HH:MM:SS.mmm`. Przyjmuje `unique` i `default`.
Przechowywany z precyzją milisekund. API: `"14:30:00.000"`.

### `datetime`

Punkt w czasie: znacznik czasu ISO 8601 ze strefą (`Z` lub `+02:00`). Przyjmuje `unique`
i `default`. Przechowywany w UTC z precyzją milisekund. API: `"2026-09-29T12:30:00.000Z"`.

## `json`

Dowolna wartość JSON. Przyjmuje `default` (dowolny JSON). Przechowywany jako `jsonb` (`json`,
`text`). API: wartość w zapisanej postaci. W `filters` atrybuty JSON obsługują tylko `$null`
i `$notNull` i nie można po nich sortować.

## Multimedia

### `media`

Pliki z biblioteki multimediów.

| Opcja | Domyślnie | Opis |
| --- | --- | --- |
| `multiple` | `false` | Przechowuje listę plików zamiast jednego. |
| `allowedTypes` | dowolne | Rodzaje plików: `images`, `videos`, `audios`, `files` (wszystko inne). |

Bez `default`. Przechowywany w tabeli powiązań `{table}_{attribute}_mda`, w kolejności.
Zapisy przyjmują identyfikatory plików: `12`, `{ "id": 12 }`, ich listę albo `null`. API:
tylko z `populate`; obiekt pliku (`url`, `mime`, `width`, `formats`…, jak w Strapi), ich
lista albo `null`. Zobacz [Multimedia](/pl/concepts/media/).

## Relacje

### `relation`

Powiązania z dokumentami innego typu zawartości.

| Opcja | Opis |
| --- | --- |
| `relation` | `oneToOne`, `oneToMany`, `manyToOne`, `manyToMany`, `oneWay`, `manyWay` lub rodzaj polimorficzny (poniżej). |
| `target` | Docelowy typ zawartości: `article`, `api::article` lub `api::article.article`. |
| `inversedBy` | Po stronie właścicielskiej relacji dwukierunkowej: atrybut celu, który ją odzwierciedla. |
| `mappedBy` | Po drugiej stronie: atrybut właścicielski celu. |

Obie strony relacji dwukierunkowej muszą się zgadzać: `oneToMany` odzwierciedla
`manyToOne`, `oneToOne` i `manyToMany` odzwierciedlają same siebie, a strona `mappedBy`
wskazuje atrybut, którego `inversedBy` wskazuje z powrotem. `oneWay` i `manyWay` nie mają
drugiej strony.

Powiązania są przechowywane w `{table}_{attribute}_lnk` po stronie właścicielskiej (stronie
bez `mappedBy`), wskazując `documentId` celu, w kolejności. Zapisy przyjmują `documentId`:

| Zapis | Znaczenie |
| --- | --- |
| `"d8f3…"`, `{ "documentId": "d8f3…" }`, ich lista | Zastępuje powiązania. |
| `null` lub `[]` | Usuwa wszystkie powiązania. |
| `{ "set": [...] }` | Zastępuje powiązania. |
| `{ "connect": [...], "disconnect": [...] }` | Dodaje i usuwa powiązania. Element `connect` może mieć `position`: `{ "before": id }`, `{ "after": id }`, `{ "start": true }` lub `{ "end": true }`. |

API: tylko z `populate`, jako powiązane dokumenty (najwyżej 1000 na wpis i relację), albo
`{ "count": n }` z `populate[tags][count]=true`. Zobacz [Relacje](/pl/concepts/relations/).

Wewnątrz komponentów dozwolone są tylko `oneWay` i `manyWay`; komponent przechowuje
`documentId`.

### Relacje polimorficzne

`relation` przyjmuje też rodzaje polimorficzne, które wiążą dokumenty dowolnego typu
zawartości:

| `relation` | Opcje | Opis |
| --- | --- | --- |
| `morphToOne` | brak | Wiąże jeden dokument dowolnego typu. |
| `morphToMany` | brak | Wiąże dokumenty dowolnych typów. |
| `morphOne` | `target`, `morphBy` | Strona odwrotna: czyta powiązania atrybutu `morphToOne` lub `morphToMany` o nazwie `morphBy` w `target`. |
| `morphMany` | `target`, `morphBy` | To samo, dla wielu. |

Właściciele przechowują pary `(type, documentId)` w `{table}_{attribute}_mph`. Zapisy
przyjmują elementy `{ "__type": "api::article", "documentId": "…" }` (jeden, listę, `null`
lub `{ "set": [...] }`). Wypełnione elementy mają swój typ w `__type`. Niedozwolone wewnątrz
komponentów.

## Komponenty i strefy dynamiczne

### `component`

Grupa pól zdefiniowana w `schema/components/<category>/<name>.json`.

| Opcja | Domyślnie | Opis |
| --- | --- | --- |
| `component` | wymagany | UID komponentu, `category.name` (`shared.seo`). |
| `repeatable` | `false` | Przechowuje listę elementów zamiast jednego. |
| `min`, `max` | | Liczba elementów; tylko z `repeatable`. |

Bez `default`: nowe elementy dostają wartości domyślne własnych atrybutów. Przechowywany jako
JSON w wierszu wpisu, każdy element z `id`. Zapisy przyjmują obiekt elementu (lub listę),
z `id`, aby zachować istniejący element. API: tylko z `populate`, cały element lub lista.
W `filters` możesz filtrować po polach komponentu (`filters[seo][metaTitle][$eq]=…`). Zobacz
[Komponenty i strefy dynamiczne](/pl/concepts/components-and-dynamic-zones/).

### `dynamiczone`

Lista elementów, z których każdy jest jednym z kilku komponentów.

| Opcja | Opis |
| --- | --- |
| `components` | Dozwolone UID-y komponentów: co najmniej jeden, bez duplikatów. |
| `min`, `max` | Liczba elementów. |

Każdy element ma `__component` ze swoim UID. Przechowywany jako JSON w wierszu wpisu. API:
tylko z `populate`, cała lista. Filtruj po komponencie przez
`filters[blocks][__component][$eq]=blocks.hero`. Stref dynamicznych nie można zagnieżdżać
wewnątrz komponentów.

## Walidacje między polami

Oprócz opcji poszczególnych atrybutów typ zawartości może deklarować w `validations` reguły
obejmujące kilka pól, sprawdzane zawsze wtedy, gdy `required`:

```json
"validations": [
  {
    "rule": { "<=": [{ "var": "startDate" }, { "var": "endDate" }] },
    "message": "The end date must be after the start date",
    "field": "endDate"
  }
]
```

`rule` to wyrażenie JSON Logic na wpisie, które musi być spełnione. Może używać `var`, `==`,
`!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`, `and`, `or`, `in`, `if`, `?:`, `+`, `-`,
`*`, `/`, `%`, `min`, `max` i `cat`. `message` jest zgłaszany przy `field` (atrybucie typu)
albo przy wpisie. To dodatek Verdin; Strapi nie ma odpowiednika.

## Różnice względem Strapi

- **Komponenty są przechowywane jako JSON** w wierszu wpisu, a nie w tabelach komponentów
  z tabelami złączeń. Odczyty nie wymagają złączeń; w konsekwencji atrybuty `password`,
  relacje polimorficzne i relacje dwukierunkowe nie mogą być wewnątrz komponentów, a `unique`
  nie jest tam egzekwowane.
- **Wypełnione komponenty wracają w całości.** `populate` na komponencie lub strefie
  dynamicznej zwraca wszystkie jej pola; nie można wybierać zagnieżdżonych pól jak w Strapi.
- **Ścisłe pliki schematu.** Nieznane klucze i opcje, których typ nie przyjmuje, to błędy,
  podczas gdy Strapi je ignoruje. W `pluginOptions` odczytywane jest tylko `i18n.localized`;
  reszta jest ignorowana.
- **`string`, `email` i `uid` są ograniczone do 255 znaków**, rozmiaru kolumny, zamiast
  kończyć się błędem w bazie danych.
- **`conditions`** (pola warunkowe) działają jak w Strapi 5.17: ukryte pola nie są wymagane.
- **`validations`** są własnym rozwiązaniem Verdin.
- Reszta odpowiada Strapi v5: nazwy typów, ich opcje, wartości `biginteger` jako stringi,
  zapisy relacji z `connect`, `disconnect`, `set` i `position` oraz format bloków.
