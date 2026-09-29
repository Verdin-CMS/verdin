---
title: "GraphQL-API"
description: "Den GraphQL-Endpunkt von Verdin aktivieren: das aus deinen Inhaltstypen erzeugte Schema, Queries, Mutations, Connections, Fehler und Limits."
sidebar:
  order: 2
  label: "GraphQL"
---

Verdin kann eine GraphQL-API bereitstellen, die aus deinen Inhaltstypen erzeugt wird und wie
das GraphQL-Plugin von Strapi v5 aufgebaut ist. Sie teilt Berechtigungen, Filter, Paginierung
und Validierung mit der REST-API: GraphQL-Argumente werden in dieselbe Abfrage übersetzt, die
auch eine REST-Anfrage auslösen würde. Diese Seite ist die Referenz; die Beispiele nutzen das
[Blog-Beispiel](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog).

## Aktivieren

GraphQL ist standardmäßig aus. Schalte es unter **Einstellungen → Funktionen → GraphQL** ein
(Berechtigung `features.manage`). Die Änderung gilt sofort, ohne Neustart, und der Endpunkt
lautet:

```
POST /graphql
```

Er liegt im Wurzelverzeichnis des Servers, nicht unter dem REST-Präfix. Schicke
`{ "query", "variables", "operationName" }` als JSON. Auch `GET /graphql?query=…` führt
Queries aus (Mutations brauchen `POST`).

```sh title="Terminal"
curl -X POST 'https://cms.example.com/graphql' \
  -H "Authorization: Bearer $VERDIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ articles(sort: [\"publishedAt:desc\"]) { documentId title } }"}'
```

Aufrufer authentifizieren sich wie bei der REST-API: ohne Header für öffentlichen Zugriff, mit
einem API-Token oder mit dem JWT eines Endnutzers. Ein fehlerhafter `Authorization`-Header oder
ein unbekanntes Token ergibt `401`. Siehe [Berechtigungen](/de/concepts/permissions/). Browser
auf anderen Origins brauchen `[api].cors_origins`.

### Einstellungen

| Einstellung | Standard | Wo | Wirkung |
| --- | --- | --- | --- |
| **GraphiQL-Playground** | an in `verdin dev`, aus in `verdin start` | Funktionseinstellungen | Liefert GraphiQL aus, wenn ein Browser `GET /graphql` öffnet. Wird von unpkg.com geladen. |
| **Introspektion** | an | Funktionseinstellungen | Erlaubt Clients und Tools, das Schema zu lesen. Schalte sie aus, um das Schema vor der Öffentlichkeit zu verbergen. |
| **Deaktivierte Operationen** | keine | Funktionseinstellungen | Lässt pro Inhaltstyp `find`, `findOne`, `create`, `update` oder `delete` (oder alle Queries, alle Mutations, alles) aus dem Schema weg, wie die Shadow-CRUD-Schalter von Strapi. REST ist davon nicht betroffen. |
| `maxDepth` | `10` | Admin-API | Maximale Tiefe einer Selektion. |
| `maxComplexity` | `1000` | Admin-API | Maximale Komplexität einer Query (grob: die Zahl der ausgewählten Felder). |

Für `maxDepth` und `maxComplexity` gibt es im Panel noch kein Feld. Setze sie über die
[Admin-API](/de/api/admin/): `GET /admin/api/features` liefert die aktuellen Einstellungen,
und `PUT /admin/api/features/graphql` ersetzt sie, schicke also auch die mit, die du behalten
willst:

```json
{ "enabled": true, "settings": { "playground": false, "introspection": true, "maxDepth": 8, "maxComplexity": 500 } }
```

## Schema

Für jeden Inhaltstyp enthält das Schema einen Objekttyp, benannt nach seinem `singularName` in
PascalCase (`article` → `Article`, `blog-post` → `BlogPost`), mit:

- `documentId: ID!`
- jedem Attribut, das nicht `private` ist
- `createdAt`, `updatedAt` und `publishedAt` als `DateTime`
- `locale: String` bei lokalisierten Typen

| Attribut | GraphQL-Typ |
| --- | --- |
| `string`, `text`, `richtext`, `email`, `uid`, `enumeration` | `String` |
| `integer` | `Int` |
| `biginteger` | `Long` (ein String, wie bei REST) |
| `float`, `decimal` | `Float` |
| `boolean` | `Boolean` |
| `date`, `time`, `datetime` | `Date`, `Time`, `DateTime` |
| `json`, `blocks` | `JSON` |
| To-one-Relation | der Typ des Ziels, z. B. `Category` |
| To-many-Relation | `[Tag!]!`, mit den Argumenten `filters`, `pagination` und `sort` |
| `media` | `UploadFile`, oder `[UploadFile!]!` bei `multiple` |
| `component` | `ComponentSharedSeo` (aus der UID `shared.seo`), oder eine Liste, wenn wiederholbar |
| `dynamiczone` | `[ArticleBlocksDynamicZone!]!`, eine Union ihrer Komponenten |
| polymorphe Relation | `JSON` (Dokumente mit ihrem `__type`) |

Der Wurzeltyp `Query` hat außerdem `verdin: String!`, die Version des Servers.

## Queries

| Collection Type `article` | Liefert |
| --- | --- |
| `articles(filters, pagination, sort, status, locale)` | `[Article!]!` |
| `articles_connection(filters, pagination, sort, status, locale)` | `ArticleEntityResponseCollection` mit `nodes` und `pageInfo` |
| `article(documentId: ID!, status, locale)` | `Article` oder `null` |

| Single Type `homepage` | Liefert |
| --- | --- |
| `homepage(status, locale)` | `Homepage` oder `null` |

Die Namen von Queries und Feldern stammen aus `pluralName` und `singularName` in camelCase
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

Dieselbe Anfrage über REST:

```http
GET /api/articles?filters[category][name][$eq]=News&filters[title][$containsi]=rust
  &sort=publishedAt:desc&pagination[page]=1&pagination[pageSize]=10
  &populate[category][fields][0]=name&populate[tags][sort]=label:asc&populate[0]=seo&populate[1]=blocks
```

### Argumente

- **`filters`**: ein `ArticleFiltersInput` mit einem Feld pro Attribut, dazu `documentId`,
  die Zeitstempel sowie `and`, `or` und `not`. Skalare Felder nehmen Operator-Inputs wie
  `StringFilterInput`, deren Operatoren die [REST-Operatoren](/de/api/rest/#filter) ohne `$`
  sind: `eq`, `ne`, `containsi`, `in`, `between`, `null`… Relationen nehmen den Filter-Input
  ihres Ziels, nicht wiederholbare Komponenten den ihrer Komponente.
- **`pagination`**: `{ page, pageSize }` oder `{ start, limit }`, mit den Standardwerten und
  dem Maximum von REST.
- **`sort`**: eine Liste von Strings `"field"` oder `"field:asc|desc"`, wie bei REST.
- **`status`**: `PUBLISHED` (Standard) oder `DRAFT`, das die Berechtigung `readDrafts`
  braucht. Verknüpfte Dokumente folgen immer dem Status ihres Elternelements.
- **`locale`**: ein Sprachcode bei lokalisierten Typen; sonst die Standardsprache.

Geladen wird nur, was du auswählst: Die Selektion wird zum REST-`populate`, und jede Ebene von
Relationen ist eine gebündelte Abfrage. `pageInfo` von `articles_connection` zählt alle
Treffer (`total`) und Seiten (`pageCount`).

## Mutations

| Collection Type `article` | Liefert |
| --- | --- |
| `createArticle(data: ArticleInput!, status, locale)` | `Article` |
| `updateArticle(documentId: ID!, data: ArticleInput!, status, locale)` | `Article` |
| `deleteArticle(documentId: ID!, locale)` | `DeleteMutationResponse` (`{ documentId }`) |

| Single Type `homepage` | Liefert |
| --- | --- |
| `updateHomepage(data: HomepageInput!, status, locale)` | `Homepage`; das erste Update legt das Dokument an |
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

- Wie bei REST veröffentlichen `create` und `update`, sofern nicht `status: DRAFT` gesetzt
  ist. Eigene Mutations zum Veröffentlichen gibt es nicht: Nutze die
  [REST-Aktionen](/de/api/rest/#aktionen), um zurückzuziehen oder einen Entwurf zu verwerfen.
- Die Inputs spiegeln die Attribute: Relationen nehmen `ID` oder `[ID!]` (`documentId`s),
  Medien Datei-IDs, Komponenten ihren `…Input`-Typ, und Einträge einer Dynamic Zone sind
  `JSON`-Objekte mit einem `__component`. Inverse Relationen (`mappedBy`) sind nicht in den
  Inputs enthalten.
- `delete`-Mutations entfernen die Version in `locale` (ohne Angabe die Standardsprache), wie
  `DELETE /api/articles/{documentId}?locale=fr`.
- Es läuft dieselbe Validierung wie bei REST.

## Fehler

GraphQL-Fehler stehen in der Liste `errors` einer `200`-Antwort, mit einem Code in
`extensions.code`:

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

| Code | Wann |
| --- | --- |
| `FORBIDDEN` | Dem Aufrufer fehlt die Berechtigung für die Operation oder `readDrafts` für `status: DRAFT`. |
| `BAD_USER_INPUT` | Ungültige Argumente oder Inhalte; `details` listet die Validierungsprobleme mit ihren Pfaden. |
| `NOT_FOUND` | Das Dokument existiert nicht (bei Updates und Löschungen). |
| `INTERNAL_SERVER_ERROR` | Ein unerwarteter Fehler, der auf dem Server protokolliert wird. |

Queries, die tiefer als `maxDepth` oder komplexer als `maxComplexity` sind, werden abgelehnt,
bevor sie laufen.

## Limits

GraphQL hat eigene Limits (`maxDepth`, `maxComplexity`) zusätzlich zu denen der REST-API:
höchstens `[api].max_page_size` Dokumente pro Liste, Relationen höchstens 5 Ebenen tief
verschachtelt, höchstens 1.000 verknüpfte Dokumente pro Dokument und Relation und höchstens
100 Filterbedingungen. Siehe [REST-Limits](/de/api/rest/#limits).

## Plugins

[Plugins](/de/extending/plugins/) können Root-Queries und -Mutations der Form
`name(args: JSON): JSON` hinzufügen. Namen, die schon von Inhaltstypen belegt sind, werden
übersprungen.

## Im Vergleich zu Strapi

Namen von Typen, Queries und Mutations, `_connection`-Queries mit `nodes` und `pageInfo`,
`documentId`-Argumente, `status` und `locale` folgen dem GraphQL-Plugin von Strapi v5, und
lokalisierte Typen haben ein Feld `locale`. Die Typen legen kein `id` offen, und es gibt keine
GraphQL-Subscriptions; für Live-Updates nutze die [Echtzeit-API](/de/api/realtime/).
