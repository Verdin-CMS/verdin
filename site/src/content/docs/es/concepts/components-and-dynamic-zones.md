---
title: "Componentes y zonas dinámicas"
description: "Grupos de campos reutilizables y listas de bloques mixtos, por qué Verdin los guarda como JSON en el documento y qué implica eso para las relaciones, los medios, el filtrado y populate."
sidebar:
  order: 2
---

Los componentes te permiten reutilizar un grupo de campos en varios tipos de contenido, y las
zonas dinámicas permiten a los editores construir una página a partir de una lista de bloques.
Esta página explica cómo se modelan y se almacenan ambos, y cómo eso condiciona su lectura,
escritura y filtrado. El formato del esquema en sí está en
[Modelo de contenido](/es/concepts/content-model/).

## Componentes

Un componente es un grupo de campos con su propio archivo en `schema/components/<category>/`.
El `shared.seo` del blog de ejemplo contiene un meta título y una descripción:

```json title="schema/components/shared/seo.json"
{
  "displayName": "SEO",
  "attributes": {
    "metaTitle": { "type": "string", "maxLength": 60 },
    "metaDescription": { "type": "text", "maxLength": 160 }
  }
}
```

Un tipo de contenido lo usa mediante un atributo `component`. `repeatable: true` lo convierte
en una lista, opcionalmente acotada con un mínimo (`min`) y un máximo (`max`) de elementos:

```json
"seo": { "type": "component", "component": "shared.seo" },
"links": { "type": "component", "component": "shared.link", "repeatable": true, "max": 10 }
```

Los componentes pueden contener otros componentes. Un componente no puede contenerse a sí
mismo, ni directamente ni a través de otros; la comprobación del esquema rechaza esos ciclos.

## Zonas dinámicas

Una zona dinámica es una lista cuyos elementos pueden ser cualquiera de los componentes que
nombra. El cuerpo de los artículos del blog mezcla heroes y citas:

```json
"blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"], "max": 20 }
```

Cada elemento indica en `__component` qué componente es. `min` y `max` acotan el número de
elementos. Las zonas dinámicas solo pertenecen a tipos de contenido: un componente no puede
contener una.

## Almacenados como JSON

Verdin guarda el valor de un componente o de una zona dinámica en una columna JSON de la fila
del documento (`jsonb` en PostgreSQL, `json` en MySQL y MariaDB, texto en SQLite):

```json
// the "seo" column
{ "id": 1, "metaTitle": "Rust for CMS authors", "metaDescription": "…" }

// the "blocks" column
[
  { "__component": "blocks.hero", "id": 1, "title": "Hello", "subtitle": "…" },
  { "__component": "blocks.quote", "id": 2, "text": "…", "author": "Ferris" }
]
```

Strapi guarda cada componente en su propia tabla, unida mediante tablas de enlace
polimórficas. Guardar el valor junto al documento significa que:

- Leer un documento con sus componentes no necesita joins, por mucho que se aniden.
- Publicar, descartar un borrador y el [historial de contenido](/es/guides/content/content-history/)
  copian el valor tal cual.
- Añadir un campo a un componente no cambia ninguna tabla: la migración está vacía.
- El filtrado por campos de componentes usa las funciones JSON de cada base de datos, y
  algunos filtros no están disponibles (consulta [Filtrado](#filtrado)).

Cada elemento lleva un `id`, un entero positivo único dentro del valor del atributo. Verdin
asigna uno a los elementos nuevos; devuelve el `id` cuando actualices una lista para que los
elementos se mantengan estables.

## Relaciones y medios dentro de componentes

Un componente puede contener relaciones y medios, guardados en el propio JSON: `documentId`s
para las relaciones e ids de archivo para los medios.

- Las relaciones dentro de componentes deben ser `oneWay` o `manyWay`: apuntan a sus destinos
  y no tienen lado inverso. Consulta
  [Relaciones](/es/concepts/relations/#relaciones-dentro-de-componentes).
- Cada referencia se comprueba al escribir: el documento o el archivo de destino debe existir,
  y los archivos deben cumplir los `allowedTypes` del campo.
- Cuando se popula el componente, las referencias se resuelven con consultas agrupadas, con el
  mismo estado e idioma que el documento. Un destino que se eliminó, o que no tiene versión en
  la que se está leyendo, se omite.
- Las relaciones polimórficas (`morphToOne`, `morphToMany`) y los campos `password` no pueden
  estar dentro de componentes.

## Lectura

Los componentes y las zonas dinámicas solo se devuelven cuando los populas, como en Strapi:

```http
GET /api/articles?populate[0]=seo&populate[1]=blocks
GET /api/articles?populate=*
```

Un componente populado se devuelve completo, con sus componentes anidados y sus relaciones y
medios resueltos. Strapi necesita un nivel de `populate` por cada componente anidado; Verdin
acepta esas opciones anidadas por compatibilidad y las ignora. Los elementos de una zona
dinámica se devuelven en el orden en que se guardaron, cada uno con su `__component`.

En GraphQL, un componente es un tipo de objeto con el nombre de su UID (`ComponentSharedSeo`)
y una zona dinámica es una unión (`ArticleBlocksDynamicZone`) que se consulta con fragmentos.
Consulta [API GraphQL](/es/api/graphql/).

## Escritura

Envía el valor completo del atributo. Sustituye lo que había guardado:

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

El valor se valida contra el esquema del componente en cada escritura: las claves
desconocidas, los tipos incorrectos y un `__component` que la zona dinámica no permite son
errores con rutas como `["blocks", 1, "text"]`. Los campos `required` dentro de los
componentes se comprueban al publicar el documento, igual que los del nivel superior.

## Filtrado

| Qué | Ejemplo | Notas |
| --- | --- | --- |
| Campos de un componente | `filters[seo][metaTitle][$containsi]=rust` | Campos escalares, incluidos los de componentes anidados. |
| Campos de un componente repetible | `filters[links][url][$contains]=github` | Coincide cuando algún elemento coincide. |
| Zonas dinámicas | `filters[blocks][__component][$eq]=blocks.quote` | Solo por `__component`: los elementos de componentes distintos tienen campos distintos. |

No se puede ordenar por campos de componentes, y los campos `json` dentro de componentes no se
pueden filtrar. Consulta la [API REST](/es/api/rest/#filtros) para ver los operadores.
