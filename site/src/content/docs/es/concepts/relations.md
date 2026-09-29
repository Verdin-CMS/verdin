---
title: "Relaciones"
description: "Los tipos de relación, cómo enlaza Verdin los documentos por documentId, el orden, las relaciones polimórficas y qué significan oneWay y manyWay dentro de los componentes."
sidebar:
  order: 3
---

Una relación enlaza documentos de dos tipos de contenido, como un artículo y su categoría.
Esta página explica los tipos de relación, cómo se almacenan y resuelven los enlaces, y las
reglas para escribirlos, ordenarlos y leerlos. Para la sintaxis de las peticiones, consulta la
[API REST](/es/api/rest/#escritura).

## Tipos

Una relación es un atributo con `type: "relation"`, un tipo de relación en `relation` y un
tipo de contenido de destino en `target`:

| Tipo | Un documento enlaza con | Un destino está enlazado desde | Lado inverso |
| --- | --- | --- | --- |
| `oneWay` | un destino | cualquier número de documentos | ninguno |
| `manyWay` | muchos destinos | cualquier número de documentos | ninguno |
| `manyToOne` | un destino | cualquier número de documentos | `oneToMany` |
| `oneToMany` | muchos destinos | un documento | `manyToOne` |
| `oneToOne` | un destino | un documento | `oneToOne` |
| `manyToMany` | muchos destinos | cualquier número de documentos | `manyToMany` |

El blog de ejemplo enlaza los artículos con una categoría (con lado inverso) y con etiquetas
(sin él):

```json title="schema/content-types/article.json (excerpt)"
"category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
"tags": { "type": "relation", "relation": "manyToMany", "target": "tag" }
```

```json title="schema/content-types/category.json (excerpt)"
"articles": { "type": "relation", "relation": "oneToMany", "target": "article", "mappedBy": "category" }
```

- El lado con `inversedBy` (o sin ninguna de las dos claves) es el lado **propietario**:
  guarda los enlaces y es el que se escribe.
- El lado con `mappedBy` es el lado **inverso**: lee los enlaces del propietario en sentido
  contrario y es de solo lectura. Escribirlo es un error de validación que indica el atributo
  propietario.
- Los dos lados deben coincidir: `mappedBy` nombra un atributo del destino que apunta de
  vuelta con `inversedBy`, con el tipo inverso correspondiente de la tabla.
- `oneWay` y `manyWay` nunca tienen lado inverso.

El constructor de tipos de contenido crea por ti el atributo inverso en el destino.

## Enlazadas por documento, no por fila

Un documento tiene varias filas: un borrador y una versión publicada, y una de cada por
idioma. Verdin guarda una relación como un enlace de la **fila** de origen al **documento** de
destino (su `documentId`), en una tabla de enlaces llamada `{table}_{field}_lnk`. La fila de
destino se elige al leer la relación:

- Un artículo publicado ve la versión publicada de su categoría; su borrador ve el borrador de
  la categoría. Los tipos sin borrador y publicación tienen una sola versión, que ven todos
  los lectores.
- Cuando el destino también está localizado, las lecturas lo resuelven en el mismo idioma. Un
  tipo de destino no localizado lo comparten todos los idiomas.
- Despublicar una categoría la oculta de los artículos publicados sin tocar ningún enlace;
  volver a publicarla la hace reaparecer.
- Publicar un artículo solo copia sus propios enlaces a la versión publicada.

Strapi enlaza ids de fila, así que tiene que reescribir los enlaces cada vez que se publica un
borrador. Verdin nunca lo hace, lo que reduce la publicación a una única copia de la fila del
borrador.

Es Verdin, y no las claves foráneas, quien mantiene la integridad: enlazar un documento que no
existe es un error de validación, y eliminar un documento elimina en la misma transacción los
enlaces que apuntan a él.

### Un documento por destino

En `oneToOne` y `oneToMany`, un destino pertenece como máximo a un documento de origen. Enlazar
un destino que tiene otro documento lo **mueve**: el enlace del otro documento se elimina en la
misma escritura. Es el comportamiento de Strapi. Se aplica por versión: un borrador y su
versión publicada pueden tener el mismo destino.

## Escritura

En el lado propietario, `data` recibe un `documentId`, una lista de ellos o un objeto que
describe un cambio:

| Entrada | Efecto |
| --- | --- |
| `"k2m…"` o `{ "documentId": "k2m…" }` | Enlaza un destino (relaciones a uno). |
| `["k2m…", "p9x…"]` | Sustituye todos los enlaces, en este orden. |
| `null` o `[]` | Elimina todos los enlaces. |
| `{ "set": ["k2m…"] }` | Sustituye todos los enlaces. |
| `{ "connect": [...], "disconnect": [...] }` | Añade y quita enlaces, conservando los demás. |

Conectar un destino nuevo a una relación a uno sustituye el anterior. `set` no se puede
combinar con `connect` ni con `disconnect`.

En el panel de administración, un campo de relación enumera las entradas enlazadas.
**Vincular una entrada** (o **Vincular entradas** en las relaciones a muchos) abre un diálogo
que busca entre las entradas del tipo de destino, en sus campos de texto, y en el idioma de la
entrada cuando el destino está localizado. Elige una entrada, o marca varias y añádelas; las
entradas ya enlazadas aparecen marcadas.

## Orden

Las relaciones a muchos conservan el orden de sus enlaces. Una lista o un `set` guarda el
orden que envías. Los elementos de `connect` pueden indicar dónde van:

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

`position` es `{ "before": documentId }`, `{ "after": documentId }`, `{ "start": true }` o
`{ "end": true }`. Las posiciones se renumeran en cada escritura. Las lecturas devuelven los
documentos relacionados en el orden de los enlaces, salvo que el populate pida un `sort`.

## Lectura

Las relaciones solo se devuelven cuando las populas:

```http
GET /api/articles?populate[category][fields][0]=name&populate[tags][sort]=label:asc
```

Una relación a uno es un objeto o `null`; una relación a muchos es un array. Cada relación
populada puede recibir sus propios `fields`, `filters`, `sort`, `populate` y `count`, hasta
cinco niveles de profundidad. Cada nivel es una consulta agrupada por relación
(`WHERE … IN (…)`), no un join, así que los populate profundos no multiplican las filas. Se
devuelven como máximo 1.000 documentos relacionados por documento y relación; `count` da el
número exacto.

Puedes filtrar a través de relaciones (`filters[category][name][$eq]=News`), desde cualquiera
de los dos lados, y ordenar por un campo de una relación a uno (`sort=category.name:asc`).
Popular, filtrar u ordenar a través de una relación hacia un tipo que el cliente no puede leer
se rechaza (`populate=*` la omite), así que las relaciones nunca revelan contenido que los
[permisos](/es/concepts/permissions/) del cliente ocultan.

## Relaciones dentro de componentes

Un [componente](/es/concepts/components-and-dynamic-zones/) puede contener relaciones, pero
solo `oneWay` y `manyWay`:

```json title="schema/components/shared/related.json"
{
  "displayName": "Related",
  "attributes": {
    "label": { "type": "string" },
    "articles": { "type": "relation", "relation": "manyWay", "target": "article" }
  }
}
```

El JSON del componente guarda los propios `documentId`s: una cadena para `oneWay` y un array
para `manyWay`. Por eso los demás tipos no se permiten ahí:

- Un lado inverso tendría que buscar en el JSON de todos los documentos para saber quién lo
  enlaza.
- La regla de «un documento por destino» (`oneToOne`, `oneToMany`) tampoco se puede hacer
  cumplir sin esa búsqueda.

Dentro de los componentes, el orden de una lista `manyWay` es el orden del array. Las
referencias se comprueban al escribir y se resuelven cuando se popula el componente, con el
estado y el idioma del documento; los destinos que ya no existen se omiten. No se puede
filtrar por ellas.

## Relaciones polimórficas

`morphToOne` y `morphToMany` enlazan documentos de cualquier tipo de contenido. Sus enlaces
guardan el tipo del destino junto a su `documentId`, y las escrituras indican ambos:

```json
{ "data": { "related": [{ "__type": "api::article", "documentId": "k2m…" }, { "__type": "api::page", "documentId": "p9x…" }] } }
```

Los elementos populados son los documentos de destino con su `__type`, leídos con el estado y
el idioma de la petición. Los lados inversos `morphOne` y `morphMany` nombran el tipo
propietario (`target`) y su atributo (`morphBy`), y son de solo lectura. Las relaciones
polimórficas no se pueden filtrar ni ordenar, y no pueden estar dentro de componentes.
