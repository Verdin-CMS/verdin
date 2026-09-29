---
title: "GraphQL-API"
description: "Het GraphQL-endpoint van Verdin inschakelen, het schema dat het uit je contenttypes genereert, queries, mutaties, connections, fouten en limieten."
sidebar:
  order: 2
  label: "GraphQL"
---

Verdin kan een GraphQL-API serveren die uit je contenttypes wordt gegenereerd, in de vorm van de
GraphQL-plugin van Strapi v5. Hij deelt de rechten, filters, paginering en validatie van de
REST-API: GraphQL-argumenten worden vertaald naar dezelfde query die een REST-request zou doen.
Deze pagina is de referentie; de voorbeelden gebruiken het
[blogvoorbeeld](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog).

## Inschakelen

GraphQL staat standaard uit. Zet het aan in **Instellingen → Functies → GraphQL** (recht
`features.manage`). De wijziging geldt meteen, zonder herstart, en het endpoint is:

```
POST /graphql
```

Het wordt geserveerd vanaf de root van de server, niet onder het REST-prefix. Stuur
`{ "query", "variables", "operationName" }` als JSON. `GET /graphql?query=…` voert ook queries
uit (mutaties hebben `POST` nodig).

```sh title="Terminal"
curl -X POST 'https://cms.example.com/graphql' \
  -H "Authorization: Bearer $VERDIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ articles(sort: [\"publishedAt:desc\"]) { documentId title } }"}'
```

Aanroepers authenticeren zoals bij de REST-API: geen header voor openbare toegang, een
API-token, of de JWT van een eindgebruiker. Een ongeldige header `Authorization` of een onbekend
token geeft `401`. Zie [Rechten](/nl/concepts/permissions/). Browsers op andere origins hebben
`[api].cors_origins` nodig.

### Instellingen

| Instelling | Standaard | Waar | Effect |
| --- | --- | --- | --- |
| **GraphiQL-playground** | aan in `verdin dev`, uit in `verdin start` | Functie-instellingen | Serveert GraphiQL wanneer een browser `GET /graphql` opent. Het laadt van unpkg.com. |
| **Introspectie** | aan | Functie-instellingen | Laat clients en tools het schema lezen. Zet het uit om het schema voor het publiek te verbergen. |
| **Uitgeschakelde bewerkingen** | geen | Functie-instellingen | Laat per contenttype `find`, `findOne`, `create`, `update` of `delete` (of alle queries, alle mutaties, alles) weg uit het schema, zoals de shadow-CRUD-schakelaars van Strapi. REST blijft ongewijzigd. |
| `maxDepth` | `10` | Admin-API | Diepste toegestane selectie. |
| `maxComplexity` | `1000` | Admin-API | Hoogste toegestane querycomplexiteit (ruwweg het aantal geselecteerde velden). |

`maxDepth` en `maxComplexity` hebben nog geen veld in het paneel. Stel ze in met de
[admin-API](/nl/api/admin/): `GET /admin/api/features` geeft de huidige instellingen terug, en
`PUT /admin/api/features/graphql` vervangt ze, dus stuur ook de instellingen mee die je wilt
behouden:

```json
{ "enabled": true, "settings": { "playground": false, "introspection": true, "maxDepth": 8, "maxComplexity": 500 } }
```

## Schema

Voor elk contenttype heeft het schema een objecttype dat naar zijn `singularName` in PascalCase
is genoemd (`article` → `Article`, `blog-post` → `BlogPost`), met:

- `documentId: ID!`
- elk attribuut dat niet `private` is
- `createdAt`, `updatedAt` en `publishedAt`, als `DateTime`
- `locale: String`, op gelokaliseerde types

| Attribuut | GraphQL-type |
| --- | --- |
| `string`, `text`, `richtext`, `email`, `uid`, `enumeration` | `String` |
| `integer` | `Int` |
| `biginteger` | `Long` (een string, zoals bij REST) |
| `float`, `decimal` | `Float` |
| `boolean` | `Boolean` |
| `date`, `time`, `datetime` | `Date`, `Time`, `DateTime` |
| `json`, `blocks` | `JSON` |
| to-one-relatie | het type van het doel, bijv. `Category` |
| to-many-relatie | `[Tag!]!`, met de argumenten `filters`, `pagination` en `sort` |
| `media` | `UploadFile`, of `[UploadFile!]!` bij `multiple` |
| `component` | `ComponentSharedSeo` (uit de UID `shared.seo`), of een lijst als hij herhaalbaar is |
| `dynamiczone` | `[ArticleBlocksDynamicZone!]!`, een union van zijn componenten |
| polymorfe relatie | `JSON` (documenten met hun `__type`) |

De root-`Query` heeft ook `verdin: String!`, de versie van de server.

## Queries

| Collectietype `article` | Geeft terug |
| --- | --- |
| `articles(filters, pagination, sort, status, locale)` | `[Article!]!` |
| `articles_connection(filters, pagination, sort, status, locale)` | `ArticleEntityResponseCollection` met `nodes` en `pageInfo` |
| `article(documentId: ID!, status, locale)` | `Article` of `null` |

| Enkel type `homepage` | Geeft terug |
| --- | --- |
| `homepage(status, locale)` | `Homepage` of `null` |

Query- en veldnamen komen van `pluralName` en `singularName` in camelCase
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

Hetzelfde request via REST:

```http
GET /api/articles?filters[category][name][$eq]=News&filters[title][$containsi]=rust
  &sort=publishedAt:desc&pagination[page]=1&pagination[pageSize]=10
  &populate[category][fields][0]=name&populate[tags][sort]=label:asc&populate[0]=seo&populate[1]=blocks
```

### Argumenten

- **`filters`**: een `ArticleFiltersInput` met één veld per attribuut, plus `documentId`, de
  tijdstempels, en `and`, `or` en `not`. Scalaire velden nemen operatorinputs zoals
  `StringFilterInput`, waarvan de operatoren de [REST-operatoren](/nl/api/rest/#filters) zonder
  de `$` zijn: `eq`, `ne`, `containsi`, `in`, `between`, `null`… Relaties nemen de filtersinput
  van het doel, en niet-herhaalbare componenten die van hun component.
- **`pagination`**: `{ page, pageSize }` of `{ start, limit }`, met de standaardwaarden en het
  maximum van REST.
- **`sort`**: een lijst van strings `"field"` of `"field:asc|desc"`, zoals bij REST.
- **`status`**: `PUBLISHED` (de standaard) of `DRAFT`, waarvoor de grant `readDrafts` nodig is.
  Gerelateerde documenten volgen altijd de status van hun ouder.
- **`locale`**: een localecode voor gelokaliseerde types; anders de standaardlocale.

Alleen wat je selecteert wordt geladen: de selectie wordt de REST-`populate`, en elk niveau van
relaties is één gebundelde query. `pageInfo` van `articles_connection` telt alle treffers
(`total`) en pagina's (`pageCount`).

## Mutaties

| Collectietype `article` | Geeft terug |
| --- | --- |
| `createArticle(data: ArticleInput!, status, locale)` | `Article` |
| `updateArticle(documentId: ID!, data: ArticleInput!, status, locale)` | `Article` |
| `deleteArticle(documentId: ID!, locale)` | `DeleteMutationResponse` (`{ documentId }`) |

| Enkel type `homepage` | Geeft terug |
| --- | --- |
| `updateHomepage(data: HomepageInput!, status, locale)` | `Homepage`; de eerste update maakt het document aan |
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

- Net als bij REST publiceren `create` en `update`, tenzij `status: DRAFT`. Er zijn geen aparte
  publicatiemutaties: gebruik de REST-[acties](/nl/api/rest/#acties) om te depubliceren of een
  concept te verwerpen.
- Inputs volgen de attributen: relaties nemen `ID` of `[ID!]` (`documentId`s), media nemen
  bestands-id's, componenten hun type `…Input`, en items van dynamische zones zijn `JSON`-objecten
  met een `__component`. Inverse relaties (`mappedBy`) zitten niet in de inputs.
- `delete`-mutaties verwijderen de versie in `locale` (zonder die parameter de standaardlocale),
  zoals `DELETE /api/articles/{documentId}?locale=fr`.
- Dezelfde validatie draait als bij REST.

## Fouten

GraphQL-fouten komen in de lijst `errors` van een response `200`, met een code in
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

| Code | Wanneer |
| --- | --- |
| `FORBIDDEN` | De aanroeper mist de grant voor de bewerking, of `readDrafts` voor `status: DRAFT`. |
| `BAD_USER_INPUT` | Ongeldige argumenten of content; `details` somt validatieproblemen op met hun paden. |
| `NOT_FOUND` | Het document bestaat niet (bij updates en verwijderingen). |
| `INTERNAL_SERVER_ERROR` | Een onverwachte fout, gelogd op de server. |

Queries die dieper gaan dan `maxDepth` of complexer zijn dan `maxComplexity` worden geweigerd
voordat ze draaien.

## Limieten

GraphQL heeft eigen limieten (`maxDepth`, `maxComplexity`) bovenop die van de REST-API: hoogstens
`[api].max_page_size` documenten per lijst, relaties hoogstens 5 niveaus diep genest, hoogstens
1.000 gerelateerde documenten per document en relatie, en hoogstens 100 filtervoorwaarden. Zie
[REST-limieten](/nl/api/rest/#limieten).

## Plugins

[Plugins](/nl/extending/plugins/) kunnen root-queries en -mutaties toevoegen van de vorm
`name(args: JSON): JSON`. Namen die al door contenttypes worden gebruikt, worden overgeslagen.

## Vergeleken met Strapi

Namen van types, queries en mutaties, `_connection`-queries met `nodes` en `pageInfo`,
`documentId`-argumenten, `status` en `locale` volgen de GraphQL-plugin van Strapi v5, en
gelokaliseerde types hebben een veld `locale`. Types stellen geen `id` beschikbaar, en er zijn
geen GraphQL-subscriptions; gebruik voor live updates de [realtime-API](/nl/api/realtime/).
