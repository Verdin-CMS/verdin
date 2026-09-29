---
title: "API GraphQL"
description: "Cómo activar el endpoint GraphQL de Verdin, el esquema que genera a partir de tus tipos de contenido, consultas, mutaciones, conexiones, errores y límites."
sidebar:
  order: 2
  label: "GraphQL"
---

Verdin puede servir una API GraphQL generada a partir de tus tipos de contenido, con la misma
forma que el plugin GraphQL de Strapi v5. Comparte con la API REST los permisos, los filtros,
la paginación y la validación: los argumentos de GraphQL se traducen a la misma consulta que
haría una petición REST. Esta página es la referencia; los ejemplos usan el
[blog de ejemplo](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog).

## Activarla

GraphQL está desactivado por defecto. Actívalo en
**Configuración → Funcionalidades → GraphQL** (permiso `features.manage`). El cambio se
aplica al momento, sin reiniciar, y el endpoint es:

```
POST /graphql
```

Se sirve en la raíz del servidor, no bajo el prefijo de REST. Envía
`{ "query", "variables", "operationName" }` como JSON. `GET /graphql?query=…` también ejecuta
consultas (las mutaciones necesitan `POST`).

```sh title="Terminal"
curl -X POST 'https://cms.example.com/graphql' \
  -H "Authorization: Bearer $VERDIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ articles(sort: [\"publishedAt:desc\"]) { documentId title } }"}'
```

Los clientes se autentican igual que en la API REST: sin cabecera para el acceso público, con
un token de API o con el JWT de un usuario final. Una cabecera `Authorization` mal formada o
un token desconocido responden `401`. Consulta [Permisos](/es/concepts/permissions/). Los
navegadores de otros orígenes necesitan `[api].cors_origins`.

### Ajustes

| Ajuste | Por defecto | Dónde | Efecto |
| --- | --- | --- | --- |
| **Entorno GraphiQL** | activado en `verdin dev`, desactivado en `verdin start` | Ajustes de la funcionalidad | Sirve GraphiQL cuando un navegador abre `GET /graphql`. Se carga desde unpkg.com. |
| **Introspección** | activada | Ajustes de la funcionalidad | Permite que clientes y herramientas lean el esquema. Desactívala para ocultar el esquema al público. |
| **Operaciones desactivadas** | ninguna | Ajustes de la funcionalidad | Por tipo de contenido, deja `find`, `findOne`, `create`, `update` o `delete` (o todas las consultas, todas las mutaciones, todo) fuera del esquema, como los interruptores de shadow CRUD de Strapi. No afecta a REST. |
| `maxDepth` | `10` | API de administración | Profundidad máxima de selección permitida. |
| `maxComplexity` | `1000` | API de administración | Complejidad máxima de consulta permitida (aproximadamente, el número de campos seleccionados). |

`maxDepth` y `maxComplexity` todavía no tienen campo en el panel. Defínelos con la
[API de administración](/es/api/admin/): `GET /admin/api/features` devuelve los ajustes
actuales y `PUT /admin/api/features/graphql` los sustituye, así que envía también los que
quieras conservar:

```json
{ "enabled": true, "settings": { "playground": false, "introspection": true, "maxDepth": 8, "maxComplexity": 500 } }
```

## Esquema

Para cada tipo de contenido, el esquema tiene un tipo de objeto con el nombre de su
`singularName` en PascalCase (`article` → `Article`, `blog-post` → `BlogPost`), con:

- `documentId: ID!`
- todos los atributos que no son `private`
- `createdAt`, `updatedAt` y `publishedAt`, como `DateTime`
- `locale: String`, en los tipos localizados

| Atributo | Tipo GraphQL |
| --- | --- |
| `string`, `text`, `richtext`, `email`, `uid`, `enumeration` | `String` |
| `integer` | `Int` |
| `biginteger` | `Long` (una cadena, como en REST) |
| `float`, `decimal` | `Float` |
| `boolean` | `Boolean` |
| `date`, `time`, `datetime` | `Date`, `Time`, `DateTime` |
| `json`, `blocks` | `JSON` |
| relación a uno | el tipo del destino, p. ej. `Category` |
| relación a muchos | `[Tag!]!`, con los argumentos `filters`, `pagination` y `sort` |
| `media` | `UploadFile`, o `[UploadFile!]!` si es `multiple` |
| `component` | `ComponentSharedSeo` (a partir del UID `shared.seo`), o una lista si es repetible |
| `dynamiczone` | `[ArticleBlocksDynamicZone!]!`, una unión de sus componentes |
| relación polimórfica | `JSON` (documentos con su `__type`) |

El `Query` raíz también tiene `verdin: String!`, la versión del servidor.

## Consultas

| Tipo de colección `article` | Devuelve |
| --- | --- |
| `articles(filters, pagination, sort, status, locale)` | `[Article!]!` |
| `articles_connection(filters, pagination, sort, status, locale)` | `ArticleEntityResponseCollection` con `nodes` y `pageInfo` |
| `article(documentId: ID!, status, locale)` | `Article` o `null` |

| Tipo único `homepage` | Devuelve |
| --- | --- |
| `homepage(status, locale)` | `Homepage` o `null` |

Los nombres de consultas y campos salen de `pluralName` y `singularName` en camelCase
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

La misma petición por REST:

```http
GET /api/articles?filters[category][name][$eq]=News&filters[title][$containsi]=rust
  &sort=publishedAt:desc&pagination[page]=1&pagination[pageSize]=10
  &populate[category][fields][0]=name&populate[tags][sort]=label:asc&populate[0]=seo&populate[1]=blocks
```

### Argumentos

- **`filters`**: un `ArticleFiltersInput` con un campo por atributo, además de `documentId`,
  las marcas de tiempo, y `and`, `or` y `not`. Los campos escalares reciben inputs de
  operadores como `StringFilterInput`, cuyos operadores son los
  [operadores de REST](/es/api/rest/#filtros) sin el `$`: `eq`, `ne`, `containsi`, `in`,
  `between`, `null`… Las relaciones reciben el input de filtros del destino, y los
  componentes no repetibles, el de su componente.
- **`pagination`**: `{ page, pageSize }` o `{ start, limit }`, con los valores por defecto y
  el máximo de REST.
- **`sort`**: una lista de cadenas `"field"` o `"field:asc|desc"`, como en REST.
- **`status`**: `PUBLISHED` (por defecto) o `DRAFT`, que necesita el permiso `readDrafts`.
  Los documentos relacionados siempre siguen el estado de su padre.
- **`locale`**: un código de idioma para los tipos localizados; si no, el idioma por defecto.

Solo se carga lo que seleccionas: la selección se convierte en el `populate` de REST, y cada
nivel de relaciones es una consulta agrupada. El `pageInfo` de `articles_connection` cuenta
todas las coincidencias (`total`) y las páginas (`pageCount`).

## Mutaciones

| Tipo de colección `article` | Devuelve |
| --- | --- |
| `createArticle(data: ArticleInput!, status, locale)` | `Article` |
| `updateArticle(documentId: ID!, data: ArticleInput!, status, locale)` | `Article` |
| `deleteArticle(documentId: ID!, locale)` | `DeleteMutationResponse` (`{ documentId }`) |

| Tipo único `homepage` | Devuelve |
| --- | --- |
| `updateHomepage(data: HomepageInput!, status, locale)` | `Homepage`; la primera actualización crea el documento |
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

- Como en REST, `create` y `update` publican salvo que pases `status: DRAFT`. No hay
  mutaciones de publicación aparte: usa las [acciones](/es/api/rest/#acciones) de REST para
  despublicar o descartar un borrador.
- Los inputs reflejan los atributos: las relaciones reciben `ID` o `[ID!]` (`documentId`s),
  los medios, ids de archivo, los componentes, su tipo `…Input`, y los elementos de las zonas
  dinámicas son objetos `JSON` con un `__component`. Las relaciones inversas (`mappedBy`) no
  están en los inputs.
- Las mutaciones `delete` eliminan la versión en `locale` (el idioma por defecto si no se
  indica), igual que `DELETE /api/articles/{documentId}?locale=fr`.
- Se ejecuta la misma validación que en REST.

## Errores

Los errores de GraphQL llegan en la lista `errors` de una respuesta `200`, con un código en
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

| Código | Cuándo |
| --- | --- |
| `FORBIDDEN` | El cliente no tiene permiso para la operación, o no tiene `readDrafts` para `status: DRAFT`. |
| `BAD_USER_INPUT` | Argumentos o contenido no válidos; `details` enumera los problemas de validación con sus rutas. |
| `NOT_FOUND` | El documento no existe (en actualizaciones y borrados). |
| `INTERNAL_SERVER_ERROR` | Un error inesperado, registrado en el log del servidor. |

Las consultas más profundas que `maxDepth` o más complejas que `maxComplexity` se rechazan
antes de ejecutarse.

## Límites

GraphQL tiene sus propios límites (`maxDepth`, `maxComplexity`) además de los de la API
REST: como máximo `[api].max_page_size` documentos por lista, relaciones anidadas hasta 5
niveles, como máximo 1.000 documentos relacionados por documento y relación, y como máximo
100 condiciones de filtro. Consulta los [límites de REST](/es/api/rest/#límites).

## Plugins

Los [plugins](/es/extending/plugins/) pueden añadir consultas y mutaciones raíz de la forma
`name(args: JSON): JSON`. Los nombres que ya usan los tipos de contenido se omiten.

## Comparación con Strapi

Los nombres de tipos, consultas y mutaciones, las consultas `_connection` con `nodes` y
`pageInfo`, los argumentos `documentId`, `status` y `locale` siguen el plugin GraphQL de
Strapi v5, y los tipos localizados tienen un campo `locale`. Los tipos no exponen `id` y no
hay suscripciones GraphQL; para recibir actualizaciones en directo, usa la
[API en tiempo real](/es/api/realtime/).
