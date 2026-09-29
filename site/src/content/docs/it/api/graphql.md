---
title: "API GraphQL"
description: "Attivare l'endpoint GraphQL di Verdin, lo schema generato dai tuoi tipi di contenuto, query, mutation, connection, errori e limiti."
sidebar:
  order: 2
  label: "GraphQL"
---

Verdin può servire un'API GraphQL generata dai tuoi tipi di contenuto, con la stessa forma
del plugin GraphQL di Strapi v5. Condivide con l'API REST permessi, filtri, paginazione e
validazione: gli argomenti GraphQL vengono tradotti nella stessa query che farebbe una
richiesta REST. Questa pagina è il riferimento; gli esempi usano il
[blog di esempio](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog).

## Attivarlo

GraphQL è disattivato di default. Attivalo in **Impostazioni → Funzionalità → GraphQL**
(permesso `features.manage`). La modifica si applica subito, senza riavvio, e l'endpoint è:

```
POST /graphql
```

È servito alla radice del server, non sotto il prefisso REST. Invia
`{ "query", "variables", "operationName" }` come JSON. Anche `GET /graphql?query=…` esegue
query (le mutation richiedono `POST`).

```sh title="Terminal"
curl -X POST 'https://cms.example.com/graphql' \
  -H "Authorization: Bearer $VERDIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ articles(sort: [\"publishedAt:desc\"]) { documentId title } }"}'
```

I chiamanti si autenticano come sull'API REST: nessun header per l'accesso pubblico, un
token API, o il JWT di un utente finale. Un header `Authorization` malformato o un token
sconosciuto risponde `401`. Vedi [Permessi](/it/concepts/permissions/). I browser su altre
origini richiedono `[api].cors_origins`.

### Impostazioni

| Impostazione | Default | Dove | Effetto |
| --- | --- | --- | --- |
| **Playground GraphiQL** | attivo in `verdin dev`, disattivo in `verdin start` | Impostazioni della funzionalità | Serve GraphiQL quando un browser apre `GET /graphql`. Si carica da unpkg.com. |
| **Introspezione** | attiva | Impostazioni della funzionalità | Permette a client e strumenti di leggere lo schema. Disattivala per nascondere lo schema al pubblico. |
| **Operazioni disattivate** | nessuna | Impostazioni della funzionalità | Per tipo di contenuto, esclude dallo schema `find`, `findOne`, `create`, `update` o `delete` (oppure tutte le query, tutte le mutation, tutto), come gli interruttori shadow CRUD di Strapi. REST non ne è toccato. |
| `maxDepth` | `10` | API admin | Profondità massima di selezione consentita. |
| `maxComplexity` | `1000` | API admin | Complessità massima della query consentita (circa, il numero di campi selezionati). |

`maxDepth` e `maxComplexity` non hanno ancora un campo nel pannello. Impostali con
l'[API admin](/it/api/admin/): `GET /admin/api/features` restituisce le impostazioni
attuali, e `PUT /admin/api/features/graphql` le sostituisce, quindi invia anche quelle che
vuoi mantenere:

```json
{ "enabled": true, "settings": { "playground": false, "introspection": true, "maxDepth": 8, "maxComplexity": 500 } }
```

## Schema

Per ogni tipo di contenuto, lo schema ha un object type chiamato come il suo
`singularName` in PascalCase (`article` → `Article`, `blog-post` → `BlogPost`), con:

- `documentId: ID!`
- ogni attributo che non è `private`
- `createdAt`, `updatedAt` e `publishedAt`, come `DateTime`
- `locale: String`, sui tipi localizzati

| Attributo | Tipo GraphQL |
| --- | --- |
| `string`, `text`, `richtext`, `email`, `uid`, `enumeration` | `String` |
| `integer` | `Int` |
| `biginteger` | `Long` (una stringa, come in REST) |
| `float`, `decimal` | `Float` |
| `boolean` | `Boolean` |
| `date`, `time`, `datetime` | `Date`, `Time`, `DateTime` |
| `json`, `blocks` | `JSON` |
| relazione to-one | il tipo del target, ad es. `Category` |
| relazione to-many | `[Tag!]!`, con argomenti `filters`, `pagination` e `sort` |
| `media` | `UploadFile`, o `[UploadFile!]!` quando `multiple` |
| `component` | `ComponentSharedSeo` (dall'UID `shared.seo`), o una lista quando ripetibile |
| `dynamiczone` | `[ArticleBlocksDynamicZone!]!`, una union dei suoi componenti |
| relazione polimorfica | `JSON` (documenti con il loro `__type`) |

La `Query` radice ha anche `verdin: String!`, la versione del server.

## Query

| Collection type `article` | Restituisce |
| --- | --- |
| `articles(filters, pagination, sort, status, locale)` | `[Article!]!` |
| `articles_connection(filters, pagination, sort, status, locale)` | `ArticleEntityResponseCollection` con `nodes` e `pageInfo` |
| `article(documentId: ID!, status, locale)` | `Article` o `null` |

| Single type `homepage` | Restituisce |
| --- | --- |
| `homepage(status, locale)` | `Homepage` o `null` |

I nomi di query e campi derivano da `pluralName` e `singularName` in camelCase
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

La stessa richiesta in REST:

```http
GET /api/articles?filters[category][name][$eq]=News&filters[title][$containsi]=rust
  &sort=publishedAt:desc&pagination[page]=1&pagination[pageSize]=10
  &populate[category][fields][0]=name&populate[tags][sort]=label:asc&populate[0]=seo&populate[1]=blocks
```

### Argomenti

- **`filters`**: un `ArticleFiltersInput` con un campo per attributo, più `documentId`, i
  timestamp, e `and`, `or` e `not`. I campi scalari accettano input di operatori come
  `StringFilterInput`, i cui operatori sono gli [operatori REST](/it/api/rest/#filtri) senza
  il `$`: `eq`, `ne`, `containsi`, `in`, `between`, `null`… Le relazioni accettano l'input
  dei filtri del target, e i componenti non ripetibili quello del loro componente.
- **`pagination`**: `{ page, pageSize }` o `{ start, limit }`, con i default e il massimo di
  REST.
- **`sort`**: una lista di stringhe `"field"` o `"field:asc|desc"`, come in REST.
- **`status`**: `PUBLISHED` (il default) o `DRAFT`, che richiede il permesso `readDrafts`.
  I documenti collegati seguono sempre lo stato del loro genitore.
- **`locale`**: un codice lingua per i tipi localizzati; altrimenti la lingua di default.

Viene caricato solo ciò che selezioni: la selezione diventa il `populate` REST, e ogni
livello di relazioni è una query in batch. `pageInfo` di `articles_connection` conta tutte
le corrispondenze (`total`) e le pagine (`pageCount`).

## Mutation

| Collection type `article` | Restituisce |
| --- | --- |
| `createArticle(data: ArticleInput!, status, locale)` | `Article` |
| `updateArticle(documentId: ID!, data: ArticleInput!, status, locale)` | `Article` |
| `deleteArticle(documentId: ID!, locale)` | `DeleteMutationResponse` (`{ documentId }`) |

| Single type `homepage` | Restituisce |
| --- | --- |
| `updateHomepage(data: HomepageInput!, status, locale)` | `Homepage`; il primo update crea il documento |
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

- Come in REST, `create` e `update` pubblicano a meno di `status: DRAFT`. Non ci sono
  mutation di pubblicazione separate: usa le [azioni](/it/api/rest/#azioni) REST per
  rimuovere dalla pubblicazione o scartare una bozza.
- Gli input rispecchiano gli attributi: le relazioni accettano `ID` o `[ID!]`
  (`documentId`), i media gli id dei file, i componenti il loro tipo `…Input`, e gli elementi
  delle zone dinamiche sono oggetti `JSON` con un `__component`. Le relazioni inverse
  (`mappedBy`) non sono negli input.
- Le mutation `delete` rimuovono la versione in `locale` (la lingua di default se assente),
  come `DELETE /api/articles/{documentId}?locale=fr`.
- Viene eseguita la stessa validazione di REST.

## Errori

Gli errori GraphQL arrivano nella lista `errors` di una risposta `200`, con un codice in
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

| Codice | Quando |
| --- | --- |
| `FORBIDDEN` | Al chiamante manca il permesso per l'operazione, o `readDrafts` per `status: DRAFT`. |
| `BAD_USER_INPUT` | Argomenti o contenuto non validi; `details` elenca i problemi di validazione con i loro path. |
| `NOT_FOUND` | Il documento non esiste (su update e delete). |
| `INTERNAL_SERVER_ERROR` | Un errore imprevisto, registrato nei log del server. |

Le query più profonde di `maxDepth` o più complesse di `maxComplexity` vengono rifiutate
prima di essere eseguite.

## Limiti

GraphQL ha i propri limiti (`maxDepth`, `maxComplexity`) oltre a quelli dell'API REST: al
massimo `[api].max_page_size` documenti per lista, relazioni annidate al massimo per 5
livelli, al massimo 1.000 documenti collegati per documento e relazione, e al massimo 100
condizioni di filtro. Vedi [limiti REST](/it/api/rest/#limiti).

## Plugin

I [plugin](/it/extending/plugins/) possono aggiungere query e mutation radice della forma
`name(args: JSON): JSON`. I nomi già usati dai tipi di contenuto vengono saltati.

## Confronto con Strapi

Nomi di tipi, query e mutation, query `_connection` con `nodes` e `pageInfo`, argomenti
`documentId`, `status` e `locale` seguono il plugin GraphQL di Strapi v5, e i tipi
localizzati hanno un campo `locale`. I tipi non espongono `id`, e non ci sono subscription
GraphQL; per gli aggiornamenti in tempo reale, usa l'[API realtime](/it/api/realtime/).
