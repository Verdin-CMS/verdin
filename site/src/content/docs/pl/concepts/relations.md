---
title: "Relacje"
description: "Rodzaje relacji, jak Verdin wiąże dokumenty przez documentId, kolejność, relacje polimorficzne i co oznaczają oneWay i manyWay wewnątrz komponentów."
sidebar:
  order: 3
---

Relacja wiąże dokumenty dwóch typów zawartości, np. artykuł i jego kategorię. Ta strona
wyjaśnia rodzaje relacji, sposób przechowywania i rozwiązywania powiązań oraz reguły ich
zapisu, porządkowania i odczytu. Składnię żądań opisuje [API REST](/pl/api/rest/#zapis).

## Rodzaje

Relacja to atrybut z `type: "relation"`, rodzajem `relation` i docelowym typem zawartości
`target`:

| Rodzaj | Dokument wskazuje | Cel jest wskazywany przez | Strona odwrotna |
| --- | --- | --- | --- |
| `oneWay` | jeden cel | dowolną liczbę dokumentów | brak |
| `manyWay` | wiele celów | dowolną liczbę dokumentów | brak |
| `manyToOne` | jeden cel | dowolną liczbę dokumentów | `oneToMany` |
| `oneToMany` | wiele celów | jeden dokument | `manyToOne` |
| `oneToOne` | jeden cel | jeden dokument | `oneToOne` |
| `manyToMany` | wiele celów | dowolną liczbę dokumentów | `manyToMany` |

Przykład bloga wiąże artykuły z kategorią (ze stroną odwrotną) i z tagami (bez niej):

```json title="schema/content-types/article.json (excerpt)"
"category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
"tags": { "type": "relation", "relation": "manyToMany", "target": "tag" }
```

```json title="schema/content-types/category.json (excerpt)"
"articles": { "type": "relation", "relation": "oneToMany", "target": "article", "mappedBy": "category" }
```

- Strona z `inversedBy` (albo bez żadnego z tych kluczy) to strona **właścicielska**:
  przechowuje powiązania i to ją zapisujesz.
- Strona z `mappedBy` to strona **odwrotna**: czyta powiązania właściciela w odwrotnym
  kierunku i jest tylko do odczytu. Zapis do niej to błąd walidacji, który wskazuje atrybut
  właścicielski.
- Obie strony muszą się zgadzać: `mappedBy` wskazuje atrybut celu, który odsyła z powrotem
  przez `inversedBy`, z odpowiednim rodzajem odwrotnym z tabeli.
- `oneWay` i `manyWay` nigdy nie mają strony odwrotnej.

Kreator typów zawartości sam tworzy atrybut odwrotny w typie docelowym.

## Powiązanie przez dokument, nie przez wiersz

Dokument ma kilka wierszy: szkic i opublikowaną wersję, po jednym z każdego na język. Verdin
przechowuje relację jako powiązanie od **wiersza** źródłowego do **dokumentu** docelowego
(jego `documentId`), w tabeli powiązań o nazwie `{table}_{field}_lnk`. Wiersz docelowy jest
wybierany przy odczycie relacji:

- Opublikowany artykuł widzi opublikowaną wersję swojej kategorii; jego szkic widzi szkic
  kategorii. Typy bez szkiców i publikacji mają jedną wersję, którą widzi każdy czytelnik.
- Gdy cel też jest lokalizowany, odczyty rozwiązują go w tym samym języku. Typ docelowy
  nielokalizowany jest wspólny dla wszystkich języków.
- Cofnięcie publikacji kategorii ukrywa ją w opublikowanych artykułach bez ruszania
  jakiegokolwiek powiązania; ponowna publikacja ją przywraca.
- Publikacja artykułu kopiuje do opublikowanej wersji tylko jego własne powiązania.

Strapi wiąże zamiast tego identyfikatory wierszy, więc musi przepisywać powiązania przy
każdej publikacji szkicu. Verdin nigdy tego nie robi, dzięki czemu publikacja pozostaje
pojedynczą kopią wiersza szkicu.

Spójność zapewnia Verdin, a nie klucze obce: powiązanie dokumentu, który nie istnieje, to błąd
walidacji, a usunięcie dokumentu usuwa wskazujące go powiązania w tej samej transakcji.

### Jeden dokument na cel

W `oneToOne` i `oneToMany` cel należy do najwyżej jednego dokumentu źródłowego. Powiązanie
celu, który trzyma inny dokument, **przenosi** go: powiązanie tamtego dokumentu jest
usuwane w tym samym zapisie. Tak działa Strapi. Reguła jest egzekwowana per wersja: szkic
i jego opublikowana wersja mogą trzymać ten sam cel.

## Zapis

Po stronie właścicielskiej `data` przyjmuje `documentId`, ich listę albo obiekt opisujący
zmianę:

| Dane wejściowe | Efekt |
| --- | --- |
| `"k2m…"` lub `{ "documentId": "k2m…" }` | Wiąże jeden cel (relacje do jednego). |
| `["k2m…", "p9x…"]` | Zastępuje wszystkie powiązania, w tej kolejności. |
| `null` lub `[]` | Usuwa wszystkie powiązania. |
| `{ "set": ["k2m…"] }` | Zastępuje wszystkie powiązania. |
| `{ "connect": [...], "disconnect": [...] }` | Dodaje i usuwa powiązania, zachowując pozostałe. |

Podłączenie nowego celu do relacji do jednego zastępuje poprzedni. `set` nie może być łączone
z `connect` ani `disconnect`.

W panelu administracyjnym pole relacji wymienia powiązane wpisy. **Połącz wpis** (albo
**Połącz wpisy** w relacjach do wielu) otwiera okno, które przeszukuje wpisy typu
docelowego po ich polach tekstowych, w języku wpisu, gdy cel jest lokalizowany. Wybierz
jeden wpis albo zaznacz kilka i je dodaj; już powiązane wpisy są oznaczone.

## Kolejność

Relacje do wielu zachowują kolejność swoich powiązań. Lista lub `set` zapisuje wysłaną
kolejność. Elementy `connect` mogą określić, gdzie trafiają:

```json
{
  "data": {
    "tags": {
      "connect": [
        { "documentId": "k2m…", "position": { "before": "p9x…" } },
        { "documentId": "a7c…", "position": { "end": true } }
      ]
    }
  }
}
```

`position` to `{ "before": documentId }`, `{ "after": documentId }`, `{ "start": true }` lub
`{ "end": true }`. Pozycje są numerowane od nowa przy każdym zapisie. Odczyty zwracają
powiązane dokumenty w kolejności powiązań, chyba że populate prosi o `sort`.

## Odczyt

Relacje są zwracane tylko wtedy, gdy je wypełnisz przez populate:

```http
GET /api/articles?populate[category][fields][0]=name&populate[tags][sort]=label:asc
```

Relacja do jednego to obiekt lub `null`; relacja do wielu to tablica. Każda wypełniana
relacja może mieć własne `fields`, `filters`, `sort`, `populate` i `count`, do pięciu
poziomów w głąb. Każdy poziom to jedno zbiorcze zapytanie na relację (`WHERE … IN (…)`), nie
złączenie, więc głębokie populate nie mnożą wierszy. Zwracanych jest najwyżej 1000
powiązanych dokumentów na dokument i relację; `count` podaje dokładną liczbę.

Możesz filtrować przez relacje (`filters[category][name][$eq]=News`), po dowolnej stronie,
i sortować po polu relacji do jednego (`sort=category.name:asc`). Populate, filtrowanie lub
sortowanie przez relację do typu, którego wywołujący nie może czytać, jest odrzucane
(`populate=*` go pomija), więc relacje nigdy nie ujawniają treści ukrytej przez
[uprawnienia](/pl/concepts/permissions/) wywołującego.

## Relacje wewnątrz komponentów

[Komponent](/pl/concepts/components-and-dynamic-zones/) może zawierać relacje, ale tylko
`oneWay` i `manyWay`:

```json title="schema/components/shared/related.json"
{
  "displayName": "Related",
  "attributes": {
    "label": { "type": "string" },
    "articles": { "type": "relation", "relation": "manyWay", "target": "article" }
  }
}
```

JSON komponentu przechowuje same `documentId`: string dla `oneWay`, tablicę dla `manyWay`.
Dlatego inne rodzaje nie są tam dozwolone:

- Strona odwrotna musiałaby przeszukiwać JSON każdego dokumentu, aby znaleźć, kto ją wskazuje.
- Reguły „jeden dokument na cel” (`oneToOne`, `oneToMany`) też nie da się egzekwować bez
  takiego przeszukiwania.

Wewnątrz komponentów kolejność listy `manyWay` to kolejność tablicy. Odwołania są sprawdzane
przy zapisie i rozwiązywane, gdy komponent jest wypełniany, w statusie i języku dokumentu;
cele, które już nie istnieją, są pomijane. Nie można po nich filtrować.

## Relacje polimorficzne

`morphToOne` i `morphToMany` wiążą dokumenty dowolnego typu zawartości. Ich powiązania
przechowują typ celu obok jego `documentId`, a zapisy podają oba:

```json
{ "data": { "related": [{ "__type": "api::article", "documentId": "k2m…" }, { "__type": "api::page", "documentId": "p9x…" }] } }
```

Wypełnione elementy to dokumenty docelowe z ich `__type`, odczytane w statusie i języku
żądania. Strony odwrotne `morphOne` i `morphMany` wskazują typ właściciela (`target`) i jego
atrybut (`morphBy`) i są tylko do odczytu. Po relacjach polimorficznych nie można filtrować
ani sortować i nie mogą być wewnątrz komponentów.
