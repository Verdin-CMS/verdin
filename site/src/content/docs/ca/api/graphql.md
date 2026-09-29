---
title: "API GraphQL"
description: "Com activar l'endpoint GraphQL de Verdin, l'esquema que genera a partir dels teus tipus de contingut, consultes, mutacions, connexions, errors i límits."
sidebar:
  order: 2
  label: "GraphQL"
---

Verdin pot servir una API GraphQL generada a partir dels teus tipus de contingut, amb la forma
del connector GraphQL de Strapi v5. Comparteix els permisos, els filtres, la paginació i la
validació de l'API REST: els arguments GraphQL es tradueixen a la mateixa consulta que faria
una petició REST. Aquesta pàgina és la referència; els exemples fan servir
l'[exemple del blog](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog).

## Activació

GraphQL està desactivat per defecte. Activa'l a **Configuració → Funcionalitats → GraphQL**
(permís `features.manage`). El canvi s'aplica a l'instant, sense reiniciar, i l'endpoint és:

```
POST /graphql
```

Se serveix a l'arrel del servidor, no sota el prefix REST. Envia
`{ "query", "variables", "operationName" }` com a JSON. `GET /graphql?query=…` també executa
consultes (les mutacions necessiten `POST`).

```sh title="Terminal"
curl -X POST 'https://cms.example.com/graphql' \
  -H "Authorization: Bearer $VERDIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ articles(sort: [\"publishedAt:desc\"]) { documentId title } }"}'
```

Els clients s'autentiquen com a l'API REST: sense capçalera per a l'accés públic, amb un token
d'API o amb el JWT d'un usuari final. Una capçalera `Authorization` mal formada o un token
desconegut responen `401`. Consulta [Permisos](/ca/concepts/permissions/). Els navegadors
d'altres orígens necessiten `[api].cors_origins`.

### Configuració

| Opció | Per defecte | On | Efecte |
| --- | --- | --- | --- |
| **Entorn GraphiQL** | activat a `verdin dev`, desactivat a `verdin start` | Configuració de la funcionalitat | Serveix GraphiQL quan un navegador obre `GET /graphql`. Es carrega des d'unpkg.com. |
| **Introspecció** | activada | Configuració de la funcionalitat | Permet que clients i eines llegeixin l'esquema. Desactiva-la per amagar l'esquema al públic. |
| **Operacions desactivades** | cap | Configuració de la funcionalitat | Per a cada tipus de contingut, deixa fora de l'esquema `find`, `findOne`, `create`, `update` o `delete` (o totes les consultes, totes les mutacions, tot), com els interruptors de shadow CRUD de Strapi. No afecta REST. |
| `maxDepth` | `10` | API d'administració | Profunditat màxima de selecció permesa. |
| `maxComplexity` | `1000` | API d'administració | Complexitat màxima de consulta permesa (aproximadament, el nombre de camps seleccionats). |

`maxDepth` i `maxComplexity` encara no tenen cap camp al tauler. Defineix-los amb
l'[API d'administració](/ca/api/admin/): `GET /admin/api/features` retorna la configuració
actual i `PUT /admin/api/features/graphql` la substitueix, així que envia també les opcions que
vulguis conservar:

```json
{ "enabled": true, "settings": { "playground": false, "introspection": true, "maxDepth": 8, "maxComplexity": 500 } }
```

## Esquema

Per a cada tipus de contingut, l'esquema té un tipus objecte amb el nom del seu `singularName`
en PascalCase (`article` → `Article`, `blog-post` → `BlogPost`), amb:

- `documentId: ID!`
- tots els atributs que no són `private`
- `createdAt`, `updatedAt` i `publishedAt`, com a `DateTime`
- `locale: String`, als tipus localitzats

| Atribut | Tipus GraphQL |
| --- | --- |
| `string`, `text`, `richtext`, `email`, `uid`, `enumeration` | `String` |
| `integer` | `Int` |
| `biginteger` | `Long` (una cadena, com a REST) |
| `float`, `decimal` | `Float` |
| `boolean` | `Boolean` |
| `date`, `time`, `datetime` | `Date`, `Time`, `DateTime` |
| `json`, `blocks` | `JSON` |
| relació a un | el tipus de la destinació, p. ex. `Category` |
| relació a molts | `[Tag!]!`, amb els arguments `filters`, `pagination` i `sort` |
| `media` | `UploadFile`, o `[UploadFile!]!` quan és `multiple` |
| `component` | `ComponentSharedSeo` (de l'UID `shared.seo`), o una llista quan és repetible |
| `dynamiczone` | `[ArticleBlocksDynamicZone!]!`, una unió dels seus components |
| relació polimòrfica | `JSON` (documents amb el seu `__type`) |

L'arrel `Query` també té `verdin: String!`, la versió del servidor.

## Consultes

| Tipus de col·lecció `article` | Retorna |
| --- | --- |
| `articles(filters, pagination, sort, status, locale)` | `[Article!]!` |
| `articles_connection(filters, pagination, sort, status, locale)` | `ArticleEntityResponseCollection` amb `nodes` i `pageInfo` |
| `article(documentId: ID!, status, locale)` | `Article` o `null` |

| Tipus únic `homepage` | Retorna |
| --- | --- |
| `homepage(status, locale)` | `Homepage` o `null` |

Els noms de consultes i camps surten de `pluralName` i `singularName` en camelCase
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

La mateixa petició per REST:

```http
GET /api/articles?filters[category][name][$eq]=News&filters[title][$containsi]=rust
  &sort=publishedAt:desc&pagination[page]=1&pagination[pageSize]=10
  &populate[category][fields][0]=name&populate[tags][sort]=label:asc&populate[0]=seo&populate[1]=blocks
```

### Arguments

- **`filters`**: un `ArticleFiltersInput` amb un camp per atribut, més `documentId`, les
  marques de temps i `and`, `or` i `not`. Els camps escalars accepten entrades d'operadors com
  `StringFilterInput`, els operadors del qual són els [operadors de REST](/ca/api/rest/#filtres)
  sense el `$`: `eq`, `ne`, `containsi`, `in`, `between`, `null`… Les relacions accepten
  l'entrada de filtres de la destinació, i els components no repetibles la del seu component.
- **`pagination`**: `{ page, pageSize }` o `{ start, limit }`, amb els valors per defecte i el
  màxim de REST.
- **`sort`**: una llista de cadenes `"field"` o `"field:asc|desc"`, com a REST.
- **`status`**: `PUBLISHED` (per defecte) o `DRAFT`, que necessita el permís `readDrafts`. Els
  documents relacionats sempre segueixen l'estat del pare.
- **`locale`**: un codi d'idioma per als tipus localitzats; si no, l'idioma per defecte.

Només es carrega el que selecciones: la selecció es converteix en el `populate` de REST, i cada
nivell de relacions és una consulta agrupada. El `pageInfo` d'`articles_connection` compta totes
les coincidències (`total`) i les pàgines (`pageCount`).

## Mutacions

| Tipus de col·lecció `article` | Retorna |
| --- | --- |
| `createArticle(data: ArticleInput!, status, locale)` | `Article` |
| `updateArticle(documentId: ID!, data: ArticleInput!, status, locale)` | `Article` |
| `deleteArticle(documentId: ID!, locale)` | `DeleteMutationResponse` (`{ documentId }`) |

| Tipus únic `homepage` | Retorna |
| --- | --- |
| `updateHomepage(data: HomepageInput!, status, locale)` | `Homepage`; la primera actualització crea el document |
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

- Com a REST, `create` i `update` publiquen tret que indiquis `status: DRAFT`. No hi ha
  mutacions de publicació separades: fes servir les [accions](/ca/api/rest/#accions) de REST per
  despublicar o descartar un esborrany.
- Les entrades reflecteixen els atributs: les relacions accepten `ID` o `[ID!]` (`documentId`),
  els mitjans accepten ids de fitxer, els components el seu tipus `…Input`, i els elements de
  zona dinàmica són objectes `JSON` amb un `__component`. Les relacions inverses (`mappedBy`) no
  són a les entrades.
- Les mutacions `delete` eliminen la versió de `locale` (l'idioma per defecte si no n'hi ha),
  com `DELETE /api/articles/{documentId}?locale=fr`.
- S'executa la mateixa validació que a REST.

## Errors

Els errors GraphQL arriben a la llista `errors` d'una resposta `200`, amb un codi a
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

| Codi | Quan |
| --- | --- |
| `FORBIDDEN` | El client no té el permís per a l'operació, o `readDrafts` per a `status: DRAFT`. |
| `BAD_USER_INPUT` | Arguments o contingut no vàlids; `details` llista els problemes de validació amb els seus camins. |
| `NOT_FOUND` | El document no existeix (en actualitzacions i eliminacions). |
| `INTERNAL_SERVER_ERROR` | Un error inesperat, registrat al servidor. |

Les consultes més profundes que `maxDepth` o més complexes que `maxComplexity` es rebutgen abans
d'executar-se.

## Límits

GraphQL té els seus propis límits (`maxDepth`, `maxComplexity`) a més dels de l'API REST: com a
màxim `[api].max_page_size` documents per llista, relacions imbricades fins a 5 nivells, com a
màxim 1.000 documents relacionats per document i relació, i com a màxim 100 condicions de
filtre. Consulta els [límits de REST](/ca/api/rest/#límits).

## Connectors

Els [connectors](/ca/extending/plugins/) poden afegir consultes i mutacions arrel de la forma
`name(args: JSON): JSON`. Els noms que ja fan servir els tipus de contingut s'ometen.

## Comparació amb Strapi

Els noms de tipus, consultes i mutacions, les consultes `_connection` amb `nodes` i `pageInfo`,
els arguments `documentId`, `status` i `locale` segueixen el connector GraphQL de Strapi v5, i
els tipus localitzats tenen un camp `locale`. Els tipus no exposen `id` i no hi ha subscripcions
GraphQL; per a actualitzacions en directe, fes servir l'[API de temps real](/ca/api/realtime/).
