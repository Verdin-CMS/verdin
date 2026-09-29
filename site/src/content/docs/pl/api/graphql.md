---
title: "API GraphQL"
description: "Włączanie endpointu GraphQL w Verdin, schemat generowany z typów zawartości, zapytania, mutacje, połączenia, błędy i limity."
sidebar:
  order: 2
  label: "GraphQL"
---

Verdin może udostępniać API GraphQL generowane z typów zawartości, wzorowane na wtyczce
GraphQL ze Strapi v5. Dzieli z API REST uprawnienia, filtry, paginację i walidację: argumenty
GraphQL są tłumaczone na to samo zapytanie, które wykonałoby żądanie REST. Ta strona jest
dokumentacją referencyjną; przykłady korzystają z
[przykładu bloga](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog).

## Włączanie

GraphQL jest domyślnie wyłączony. Włącz go w **Ustawienia → Funkcje → GraphQL** (uprawnienie
`features.manage`). Zmiana działa od razu, bez restartu, a endpoint to:

```
POST /graphql
```

Jest udostępniany w katalogu głównym serwera, nie pod prefiksem REST. Wysyłaj
`{ "query", "variables", "operationName" }` jako JSON. `GET /graphql?query=…` też wykonuje
zapytania (mutacje wymagają `POST`).

```sh title="Terminal"
curl -X POST 'https://cms.example.com/graphql' \
  -H "Authorization: Bearer $VERDIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ articles(sort: [\"publishedAt:desc\"]) { documentId title } }"}'
```

Wywołujący uwierzytelniają się tak jak w API REST: bez nagłówka dla dostępu publicznego,
tokenem API albo JWT użytkownika końcowego. Niepoprawny nagłówek `Authorization` lub nieznany
token daje `401`. Zobacz [Uprawnienia](/pl/concepts/permissions/). Przeglądarki z innych
originów wymagają `[api].cors_origins`.

### Ustawienia

| Ustawienie | Domyślnie | Gdzie | Efekt |
| --- | --- | --- | --- |
| **Playground GraphiQL** | włączony w `verdin dev`, wyłączony w `verdin start` | Ustawienia funkcji | Serwuje GraphiQL, gdy przeglądarka otwiera `GET /graphql`. Ładuje się z unpkg.com. |
| **Introspekcja** | włączona | Ustawienia funkcji | Pozwala klientom i narzędziom odczytać schemat. Wyłącz ją, aby ukryć schemat przed publicznością. |
| **Wyłączone operacje** | brak | Ustawienia funkcji | Dla każdego typu zawartości pomija w schemacie `find`, `findOne`, `create`, `update` lub `delete` (albo wszystkie zapytania, wszystkie mutacje, wszystko), jak przełączniki shadow CRUD w Strapi. Nie wpływa na REST. |
| `maxDepth` | `10` | API administracyjne | Największa dozwolona głębokość selekcji. |
| `maxComplexity` | `1000` | API administracyjne | Największa dozwolona złożoność zapytania (w przybliżeniu liczba wybranych pól). |

`maxDepth` i `maxComplexity` nie mają jeszcze pola w panelu. Ustaw je przez
[API administracyjne](/pl/api/admin/): `GET /admin/api/features` zwraca bieżące ustawienia,
a `PUT /admin/api/features/graphql` je zastępuje, więc wyślij też te, które chcesz zachować:

```json
{ "enabled": true, "settings": { "playground": false, "introspection": true, "maxDepth": 8, "maxComplexity": 500 } }
```

## Schemat

Dla każdego typu zawartości schemat zawiera typ obiektowy nazwany od jego `singularName`
w PascalCase (`article` → `Article`, `blog-post` → `BlogPost`), z polami:

- `documentId: ID!`
- każdy atrybut, który nie jest `private`
- `createdAt`, `updatedAt` i `publishedAt`, jako `DateTime`
- `locale: String`, w typach lokalizowanych

| Atrybut | Typ GraphQL |
| --- | --- |
| `string`, `text`, `richtext`, `email`, `uid`, `enumeration` | `String` |
| `integer` | `Int` |
| `biginteger` | `Long` (string, jak w REST) |
| `float`, `decimal` | `Float` |
| `boolean` | `Boolean` |
| `date`, `time`, `datetime` | `Date`, `Time`, `DateTime` |
| `json`, `blocks` | `JSON` |
| relacja do jednego | typ celu, np. `Category` |
| relacja do wielu | `[Tag!]!`, z argumentami `filters`, `pagination` i `sort` |
| `media` | `UploadFile` lub `[UploadFile!]!` przy `multiple` |
| `component` | `ComponentSharedSeo` (z UID `shared.seo`) lub lista, gdy powtarzalny |
| `dynamiczone` | `[ArticleBlocksDynamicZone!]!`, unia jej komponentów |
| relacja polimorficzna | `JSON` (dokumenty z ich `__type`) |

Główny typ `Query` ma też `verdin: String!`, czyli wersję serwera.

## Zapytania

| Typ kolekcji `article` | Zwraca |
| --- | --- |
| `articles(filters, pagination, sort, status, locale)` | `[Article!]!` |
| `articles_connection(filters, pagination, sort, status, locale)` | `ArticleEntityResponseCollection` z `nodes` i `pageInfo` |
| `article(documentId: ID!, status, locale)` | `Article` lub `null` |

| Pojedynczy typ `homepage` | Zwraca |
| --- | --- |
| `homepage(status, locale)` | `Homepage` lub `null` |

Nazwy zapytań i pól pochodzą z `pluralName` i `singularName` w camelCase
(`blog-posts` → `blogPosts`).

```graphql
query LatestArticles($page: Int) {
  articles_connection(
    filters: { category: { name: { eq: "News" } }, title: { containsi: "rust" } }
    sort: ["publishedAt:desc"]
    pagination: { page: $page, pageSize: 10 }
  ) {
    nodes {
      documentId
      title
      slug
      category { name }
      tags(sort: ["label:asc"]) { label }
      seo { metaTitle metaDescription }
      blocks {
        __typename
        ... on ComponentBlocksHero { title subtitle }
        ... on ComponentBlocksQuote { text author }
      }
    }
    pageInfo { page pageSize pageCount total }
  }
}
```

To samo żądanie przez REST:

```http
GET /api/articles?filters[category][name][$eq]=News&filters[title][$containsi]=rust
  &sort=publishedAt:desc&pagination[page]=1&pagination[pageSize]=10
  &populate[category][fields][0]=name&populate[tags][sort]=label:asc&populate[0]=seo&populate[1]=blocks
```

### Argumenty

- **`filters`**: `ArticleFiltersInput` z jednym polem na atrybut oraz `documentId`,
  znacznikami czasu i `and`, `or` oraz `not`. Pola skalarne przyjmują wejścia operatorów, np.
  `StringFilterInput`, których operatory to [operatory REST](/pl/api/rest/#filtry) bez `$`:
  `eq`, `ne`, `containsi`, `in`, `between`, `null`… Relacje przyjmują wejście filtrów celu,
  a niepowtarzalne komponenty wejście swojego komponentu.
- **`pagination`**: `{ page, pageSize }` lub `{ start, limit }`, z domyślnymi wartościami
  i maksimum z REST.
- **`sort`**: lista stringów `"field"` lub `"field:asc|desc"`, jak w REST.
- **`status`**: `PUBLISHED` (domyślnie) lub `DRAFT`, który wymaga uprawnienia `readDrafts`.
  Powiązane dokumenty zawsze mają status rodzica.
- **`locale`**: kod wersji językowej dla typów lokalizowanych; w przeciwnym razie domyślny
  język.

Ładowane jest tylko to, co wybierzesz: selekcja staje się `populate` z REST, a każdy poziom
relacji to jedno zbiorcze zapytanie. `pageInfo` z `articles_connection` liczy wszystkie
trafienia (`total`) i strony (`pageCount`).

## Mutacje

| Typ kolekcji `article` | Zwraca |
| --- | --- |
| `createArticle(data: ArticleInput!, status, locale)` | `Article` |
| `updateArticle(documentId: ID!, data: ArticleInput!, status, locale)` | `Article` |
| `deleteArticle(documentId: ID!, locale)` | `DeleteMutationResponse` (`{ documentId }`) |

| Pojedynczy typ `homepage` | Zwraca |
| --- | --- |
| `updateHomepage(data: HomepageInput!, status, locale)` | `Homepage`; pierwsza aktualizacja tworzy dokument |
| `deleteHomepage(locale)` | `DeleteMutationResponse` |

```graphql
mutation {
  createArticle(
    data: { title: "Hello, Verdin", slug: "hello-verdin", category: "k2m7q4…", tags: ["a7c1…"] }
    status: DRAFT
  ) {
    documentId
    publishedAt
  }
}
```

- Tak jak w REST, `create` i `update` publikują, chyba że podasz `status: DRAFT`. Nie ma
  osobnych mutacji publikacji: aby cofnąć publikację lub odrzucić szkic, użyj
  [akcji](/pl/api/rest/#akcje) REST.
- Wejścia odzwierciedlają atrybuty: relacje przyjmują `ID` lub `[ID!]` (`documentId`),
  multimedia identyfikatory plików, komponenty swój typ `…Input`, a elementy strefy
  dynamicznej to obiekty `JSON` z `__component`. Relacji odwrotnych (`mappedBy`) nie ma
  w wejściach.
- Mutacje `delete` usuwają wersję w `locale` (bez niego w domyślnym języku), jak
  `DELETE /api/articles/{documentId}?locale=fr`.
- Działa ta sama walidacja co w REST.

## Błędy

Błędy GraphQL trafiają na listę `errors` odpowiedzi `200`, z kodem w `extensions.code`:

```json
{
  "data": { "createArticle": null },
  "errors": [
    {
      "message": "title is a required field",
      "path": ["createArticle"],
      "extensions": {
        "code": "BAD_USER_INPUT",
        "details": [{ "path": ["title"], "message": "title is a required field", "name": "ValidationError" }]
      }
    }
  ]
}
```

| Kod | Kiedy |
| --- | --- |
| `FORBIDDEN` | Wywołujący nie ma uprawnienia do operacji albo `readDrafts` przy `status: DRAFT`. |
| `BAD_USER_INPUT` | Niepoprawne argumenty lub treść; `details` wymienia problemy walidacji z ich ścieżkami. |
| `NOT_FOUND` | Dokument nie istnieje (przy aktualizacjach i usunięciach). |
| `INTERNAL_SERVER_ERROR` | Nieoczekiwany błąd, zapisany w logach serwera. |

Zapytania głębsze niż `maxDepth` lub bardziej złożone niż `maxComplexity` są odrzucane przed
wykonaniem.

## Limity

GraphQL ma własne limity (`maxDepth`, `maxComplexity`) oprócz limitów API REST: najwyżej
`[api].max_page_size` dokumentów na listę, relacje zagnieżdżone najwyżej na 5 poziomach,
najwyżej 1000 powiązanych dokumentów na dokument i relację oraz najwyżej 100 warunków
filtrowania. Zobacz [limity REST](/pl/api/rest/#limity).

## Wtyczki

[Wtyczki](/pl/extending/plugins/) mogą dodawać główne zapytania i mutacje w postaci
`name(args: JSON): JSON`. Nazwy już zajęte przez typy zawartości są pomijane.

## Porównanie ze Strapi

Nazwy typów, zapytań i mutacji, zapytania `_connection` z `nodes` i `pageInfo`, argumenty
`documentId`, `status` i `locale` są zgodne z wtyczką GraphQL ze Strapi v5, a typy
lokalizowane mają pole `locale`. Typy nie udostępniają `id` i nie ma subskrypcji GraphQL; do
aktualizacji na żywo użyj [API czasu rzeczywistego](/pl/api/realtime/).
