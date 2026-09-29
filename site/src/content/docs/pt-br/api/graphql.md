---
title: "API GraphQL"
description: "Como ativar o endpoint GraphQL do Verdin, o schema que ele gera a partir dos seus tipos de conteúdo, queries, mutations, connections, erros e limites."
sidebar:
  order: 2
  label: "GraphQL"
---

O Verdin pode servir uma API GraphQL gerada a partir dos seus tipos de conteúdo, no formato
do plugin GraphQL do Strapi v5. Ela compartilha as permissões, os filtros, a paginação e a
validação da API REST: os argumentos GraphQL são traduzidos na mesma consulta que uma
requisição REST faria. Esta página é a referência; os exemplos usam o
[exemplo de blog](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog).

## Como ativar

O GraphQL vem desativado por padrão. Ative-o em **Configurações → Recursos → GraphQL**
(permissão `features.manage`). A mudança vale na hora, sem reiniciar, e o endpoint é:

```
POST /graphql
```

Ele é servido na raiz do servidor, não sob o prefixo REST. Envie
`{ "query", "variables", "operationName" }` como JSON. `GET /graphql?query=…` também executa
queries (mutations precisam de `POST`).

```sh title="Terminal"
curl -X POST 'https://cms.example.com/graphql' \
  -H "Authorization: Bearer $VERDIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ articles(sort: [\"publishedAt:desc\"]) { documentId title } }"}'
```

Os clientes se autenticam como na API REST: sem cabeçalho para acesso público, com um token
de API ou com o JWT de um usuário final. Um cabeçalho `Authorization` malformado ou um token
desconhecido responde `401`. Veja [Permissões](/pt-br/concepts/permissions/). Navegadores em
outras origens precisam de `[api].cors_origins`.

### Configurações

| Configuração | Padrão | Onde | Efeito |
| --- | --- | --- | --- |
| **Playground GraphiQL** | ativado em `verdin dev`, desativado em `verdin start` | Configurações do recurso | Serve o GraphiQL quando um navegador abre `GET /graphql`. Ele é carregado de unpkg.com. |
| **Introspecção** | ativada | Configurações do recurso | Permite que clientes e ferramentas leiam o schema. Desative para esconder o schema do público. |
| **Operações desativadas** | nenhuma | Configurações do recurso | Por tipo de conteúdo, deixa `find`, `findOne`, `create`, `update` ou `delete` (ou todas as queries, todas as mutations, tudo) fora do schema, como os interruptores de shadow CRUD do Strapi. O REST não é afetado. |
| `maxDepth` | `10` | API de administração | Profundidade máxima de seleção permitida. |
| `maxComplexity` | `1000` | API de administração | Complexidade máxima de query permitida (aproximadamente, o número de campos selecionados). |

`maxDepth` e `maxComplexity` ainda não têm campo no painel. Defina-os com a
[API de administração](/pt-br/api/admin/): `GET /admin/api/features` retorna as configurações
atuais, e `PUT /admin/api/features/graphql` as substitui, então envie também as que você quer
manter:

```json
{ "enabled": true, "settings": { "playground": false, "introspection": true, "maxDepth": 8, "maxComplexity": 500 } }
```

## Schema

Para cada tipo de conteúdo, o schema tem um object type com o nome do seu `singularName` em
PascalCase (`article` → `Article`, `blog-post` → `BlogPost`), com:

- `documentId: ID!`
- todos os atributos que não são `private`
- `createdAt`, `updatedAt` e `publishedAt`, como `DateTime`
- `locale: String`, nos tipos localizados

| Atributo | Tipo GraphQL |
| --- | --- |
| `string`, `text`, `richtext`, `email`, `uid`, `enumeration` | `String` |
| `integer` | `Int` |
| `biginteger` | `Long` (uma string, como no REST) |
| `float`, `decimal` | `Float` |
| `boolean` | `Boolean` |
| `date`, `time`, `datetime` | `Date`, `Time`, `DateTime` |
| `json`, `blocks` | `JSON` |
| relação to-one | o tipo do destino, por exemplo `Category` |
| relação to-many | `[Tag!]!`, com os argumentos `filters`, `pagination` e `sort` |
| `media` | `UploadFile`, ou `[UploadFile!]!` quando `multiple` |
| `component` | `ComponentSharedSeo` (do UID `shared.seo`), ou uma lista quando repetível |
| `dynamiczone` | `[ArticleBlocksDynamicZone!]!`, uma union dos seus componentes |
| relação polimórfica | `JSON` (documentos com o seu `__type`) |

A `Query` raiz também tem `verdin: String!`, a versão do servidor.

## Queries

| Collection type `article` | Retorna |
| --- | --- |
| `articles(filters, pagination, sort, status, locale)` | `[Article!]!` |
| `articles_connection(filters, pagination, sort, status, locale)` | `ArticleEntityResponseCollection` com `nodes` e `pageInfo` |
| `article(documentId: ID!, status, locale)` | `Article` ou `null` |

| Single type `homepage` | Retorna |
| --- | --- |
| `homepage(status, locale)` | `Homepage` ou `null` |

Os nomes de queries e campos vêm de `pluralName` e `singularName` em camelCase
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

A mesma requisição via REST:

```http
GET /api/articles?filters[category][name][$eq]=News&filters[title][$containsi]=rust
  &sort=publishedAt:desc&pagination[page]=1&pagination[pageSize]=10
  &populate[category][fields][0]=name&populate[tags][sort]=label:asc&populate[0]=seo&populate[1]=blocks
```

### Argumentos

- **`filters`**: um `ArticleFiltersInput` com um campo por atributo, além de `documentId`, os
  timestamps e `and`, `or` e `not`. Os campos escalares recebem inputs de operadores como
  `StringFilterInput`, cujos operadores são os [operadores do REST](/pt-br/api/rest/#filtros)
  sem o `$`: `eq`, `ne`, `containsi`, `in`, `between`, `null`… As relações recebem o input de
  filtros do destino, e os componentes não repetíveis, o do seu componente.
- **`pagination`**: `{ page, pageSize }` ou `{ start, limit }`, com os padrões e o máximo do
  REST.
- **`sort`**: uma lista de strings `"field"` ou `"field:asc|desc"`, como no REST.
- **`status`**: `PUBLISHED` (o padrão) ou `DRAFT`, que exige a permissão `readDrafts`. Os
  documentos relacionados sempre seguem o status do documento pai.
- **`locale`**: um código de idioma para tipos localizados; caso contrário, o idioma padrão.

Só o que você seleciona é carregado: a seleção vira o `populate` do REST, e cada nível de
relações é uma consulta em lote. O `pageInfo` de `articles_connection` conta todas as
correspondências (`total`) e as páginas (`pageCount`).

## Mutations

| Collection type `article` | Retorna |
| --- | --- |
| `createArticle(data: ArticleInput!, status, locale)` | `Article` |
| `updateArticle(documentId: ID!, data: ArticleInput!, status, locale)` | `Article` |
| `deleteArticle(documentId: ID!, locale)` | `DeleteMutationResponse` (`{ documentId }`) |

| Single type `homepage` | Retorna |
| --- | --- |
| `updateHomepage(data: HomepageInput!, status, locale)` | `Homepage`; a primeira atualização cria o documento |
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

- Como no REST, `create` e `update` publicam, a menos que `status: DRAFT`. Não há mutations
  de publicação separadas: use as [ações](/pt-br/api/rest/#ações) do REST para despublicar ou
  descartar um rascunho.
- Os inputs espelham os atributos: relações recebem `ID` ou `[ID!]` (`documentId`s), mídia
  recebe ids de arquivo, componentes o seu tipo `…Input`, e os itens de zona dinâmica são
  objetos `JSON` com um `__component`. Relações inversas (`mappedBy`) não aparecem nos inputs.
- As mutations `delete` removem a versão em `locale` (o idioma padrão, se omitido), como
  `DELETE /api/articles/{documentId}?locale=fr`.
- A mesma validação do REST é executada.

## Erros

Os erros GraphQL vêm na lista `errors` de uma resposta `200`, com um código em
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

| Código | Quando |
| --- | --- |
| `FORBIDDEN` | O cliente não tem a permissão para a operação, ou `readDrafts` para `status: DRAFT`. |
| `BAD_USER_INPUT` | Argumentos ou conteúdo inválidos; `details` lista os problemas de validação com os seus caminhos. |
| `NOT_FOUND` | O documento não existe (em atualizações e exclusões). |
| `INTERNAL_SERVER_ERROR` | Um erro inesperado, registrado no log do servidor. |

Queries mais profundas que `maxDepth` ou mais complexas que `maxComplexity` são rejeitadas
antes de executar.

## Limites

O GraphQL tem os seus próprios limites (`maxDepth`, `maxComplexity`) além dos da API REST: no
máximo `[api].max_page_size` documentos por lista, relações aninhadas em no máximo 5 níveis,
no máximo 1.000 documentos relacionados por documento e relação, e no máximo 100 condições de
filtro. Veja [limites do REST](/pt-br/api/rest/#limites).

## Plugins

Os [plugins](/pt-br/extending/plugins/) podem adicionar queries e mutations raiz no formato
`name(args: JSON): JSON`. Nomes já usados por tipos de conteúdo são ignorados.

## Comparação com o Strapi

Os nomes de tipos, queries e mutations, as queries `_connection` com `nodes` e `pageInfo`, os
argumentos `documentId`, `status` e `locale` seguem o plugin GraphQL do Strapi v5, e os tipos
localizados têm um campo `locale`. Os tipos não expõem `id`, e não há subscriptions GraphQL;
para atualizações ao vivo, use a [API de tempo real](/pt-br/api/realtime/).
