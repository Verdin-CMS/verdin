---
title: "Komponenty i strefy dynamiczne"
description: "Wielokrotnego użytku grupy pól i mieszane listy bloków, dlaczego Verdin przechowuje je jako JSON w dokumencie i co to oznacza dla relacji, multimediów, filtrowania i populate."
sidebar:
  order: 2
---

Komponenty pozwalają wielokrotnie używać grupy pól w różnych typach zawartości, a strefy
dynamiczne pozwalają redaktorom budować stronę z listy bloków. Ta strona wyjaśnia, jak oba
są modelowane i przechowywane i jak to wpływa na ich odczyt, zapis i filtrowanie. Sam format
schematu opisuje [Model treści](/pl/concepts/content-model/).

## Komponenty

Komponent to grupa pól z własnym plikiem w `schema/components/<category>/`. Komponent
`shared.seo` z przykładu bloga zawiera meta tytuł i opis:

```json title="schema/components/shared/seo.json"
{
  "displayName": "SEO",
  "attributes": {
    "metaTitle": { "type": "string", "maxLength": 60 },
    "metaDescription": { "type": "text", "maxLength": 160 }
  }
}
```

Typ zawartości używa go przez atrybut `component`. `repeatable: true` zamienia go w listę,
opcjonalnie ograniczoną liczbą elementów `min` i `max`:

```json
"seo": { "type": "component", "component": "shared.seo" },
"links": { "type": "component", "component": "shared.link", "repeatable": true, "max": 10 }
```

Komponenty mogą zawierać inne komponenty. Komponent nie może zawierać samego siebie, ani
bezpośrednio, ani przez inne; sprawdzanie schematu odrzuca takie cykle.

## Strefy dynamiczne

Strefa dynamiczna to lista, której elementy mogą być dowolnym z wymienionych w niej
komponentów. Treść artykułu w blogu łączy bloki hero i cytaty:

```json
"blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"], "max": 20 }
```

Każdy element podaje w `__component`, którym komponentem jest. `min` i `max` ograniczają
liczbę elementów. Strefy dynamiczne należą tylko do typów zawartości: komponent nie może
zawierać strefy.

## Przechowywane jako JSON

Verdin przechowuje wartość komponentu lub strefy dynamicznej w jednej kolumnie JSON wiersza
dokumentu (`jsonb` w PostgreSQL, `json` w MySQL i MariaDB, tekst w SQLite):

```json
// the "seo" column
{ "id": 1, "metaTitle": "Rust for CMS authors", "metaDescription": "…" }

// the "blocks" column
[
  { "__component": "blocks.hero", "id": 1, "title": "Hello", "subtitle": "…" },
  { "__component": "blocks.quote", "id": 2, "text": "…", "author": "Ferris" }
]
```

Strapi trzyma każdy komponent we własnej tabeli, łączonej przez polimorficzne tabele
powiązań. Przechowywanie wartości razem z dokumentem oznacza, że:

- Odczyt dokumentu z komponentami nie wymaga złączeń, niezależnie od głębokości
  zagnieżdżenia.
- Publikacja, odrzucenie szkicu i [historia treści](/pl/guides/content/content-history/)
  kopiują wartość bez zmian.
- Dodanie pola do komponentu nie zmienia żadnej tabeli: migracja jest pusta.
- Filtrowanie po polach komponentów używa funkcji JSON każdej bazy danych, a niektóre filtry
  nie są dostępne (zobacz [Filtrowanie](#filtrowanie)).

Każdy element ma `id`, dodatnią liczbę całkowitą unikalną w obrębie wartości atrybutu. Verdin
nadaje je nowym elementom; odsyłaj `id` przy aktualizacji listy, aby elementy pozostały
stabilne.

## Relacje i multimedia wewnątrz komponentów

Komponent może zawierać relacje i multimedia, przechowywane w samym JSON: `documentId` dla
relacji i identyfikatory plików dla multimediów.

- Relacje wewnątrz komponentów muszą być `oneWay` lub `manyWay`: wskazują swoje cele i nie
  mają strony odwrotnej. Zobacz [Relacje](/pl/concepts/relations/#relacje-wewnątrz-komponentów).
- Każde odwołanie jest sprawdzane przy zapisie: docelowy dokument lub plik musi istnieć,
  a pliki muszą pasować do `allowedTypes` pola.
- Gdy komponent jest wypełniany przez populate, odwołania są rozwiązywane zbiorczymi
  zapytaniami, w tym samym statusie i języku co dokument. Cel, który został usunięty albo nie
  ma wersji w odczytywanej wersji, jest pomijany.
- Relacje polimorficzne (`morphToOne`, `morphToMany`) i pola `password` nie mogą być
  wewnątrz komponentów.

## Odczyt

Komponenty i strefy dynamiczne są zwracane tylko wtedy, gdy je wypełnisz przez populate, jak
w Strapi:

```http
GET /api/articles?populate[0]=seo&populate[1]=blocks
GET /api/articles?populate=*
```

Wypełniony komponent wraca w całości, łącznie z zagnieżdżonymi komponentami oraz
rozwiązanymi relacjami i multimediami. Strapi wymaga poziomu `populate` dla każdego
zagnieżdżonego komponentu; Verdin akceptuje te zagnieżdżone opcje dla zgodności i je
ignoruje. Elementy strefy dynamicznej wracają w zapisanej kolejności, każdy ze swoim
`__component`.

W GraphQL komponent to typ obiektowy nazwany od jego UID (`ComponentSharedSeo`), a strefa
dynamiczna to unia (`ArticleBlocksDynamicZone`), o którą pytasz fragmentami. Zobacz
[API GraphQL](/pl/api/graphql/).

## Zapis

Wysyłaj całą wartość atrybutu. Zastępuje ona to, co było zapisane:

```json
{
  "data": {
    "seo": { "metaTitle": "Rust for CMS authors" },
    "blocks": [
      { "__component": "blocks.hero", "title": "Hello" },
      { "__component": "blocks.quote", "text": "Fast and small.", "author": "Ferris" }
    ]
  }
}
```

Wartość jest walidowana względem schematu komponentu przy każdym zapisie: nieznane klucze,
złe typy i `__component`, na który strefa dynamiczna nie pozwala, to błędy ze ścieżkami
w rodzaju `["blocks", 1, "text"]`. Pola `required` wewnątrz komponentów są sprawdzane przy
publikacji dokumentu, tak jak pola najwyższego poziomu.

## Filtrowanie

| Co | Przykład | Uwagi |
| --- | --- | --- |
| Pola komponentu | `filters[seo][metaTitle][$containsi]=rust` | Pola skalarne, także zagnieżdżonych komponentów. |
| Pola komponentu powtarzalnego | `filters[links][url][$contains]=github` | Pasuje, gdy pasuje któryś element. |
| Strefy dynamiczne | `filters[blocks][__component][$eq]=blocks.quote` | Tylko po `__component`: elementy różnych komponentów mają różne pola. |

Nie można sortować po polach komponentów, a pól `json` wewnątrz komponentów nie można
filtrować. Operatory opisuje [API REST](/pl/api/rest/#filtry).
