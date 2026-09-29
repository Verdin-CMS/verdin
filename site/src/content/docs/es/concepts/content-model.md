---
title: "Modelo de contenido"
description: "Cómo describe Verdin tu contenido: tipos de colección y tipos únicos, atributos, archivos de esquema en el formato de Strapi y reglas de validación."
sidebar:
  order: 1
---

El modelo de contenido es el conjunto de tipos de contenido y componentes que define tu
proyecto. Verdin deriva todo lo demás de él: las tablas de la base de datos, las APIs REST y
GraphQL, el documento OpenAPI, la validación y los formularios del panel de administración.
Esta página explica las piezas y las reglas que se les aplican.

## Tipos de contenido

Un tipo de contenido describe una clase de documento, como un artículo o una página de
inicio. Tiene un `kind`:

| Kind | Contiene | Rutas REST (blog de ejemplo) |
| --- | --- | --- |
| `collectionType` | Cualquier número de documentos | `/api/articles`, `/api/articles/{documentId}` |
| `singleType` | Como máximo un documento | `/api/homepage` |

Los tipos de colección se sirven en su `pluralName` y los tipos únicos en su `singularName`.
El primer `PUT` a un tipo único crea su documento. Consulta la [API REST](/es/api/rest/) para
ver todas las rutas.

Cada tipo de contenido tiene un UID, `api::<singularName>` (`api::article`). Strapi escribe
el mismo UID como `api::article.article`; Verdin acepta esa forma en los archivos de esquema y
en el importador, y la normaliza a `api::article`.

Todo documento tiene campos del sistema que no declaras: `id`, `documentId` (un ULID de 26
caracteres en minúsculas, estable entre borradores, versiones publicadas e idiomas),
`createdAt`, `updatedAt`, `publishedAt` y, en los
[tipos localizados](/es/concepts/internationalization/), `locale`.

## Archivos de esquema

Los tipos de contenido y los componentes son archivos JSON en el directorio `schema/` de tu
proyecto (`[schema].path` en `verdin.toml`). Los versionas en git como el código.

```
schema/
├── content-types/
│   ├── article.json
│   ├── category.json
│   ├── tag.json
│   └── homepage.json
└── components/
    ├── blocks/
    │   ├── hero.json
    │   └── quote.json
    └── shared/
        └── seo.json
```

El formato es el `schema.json` de Strapi, así que la mayoría de los esquemas de Strapi se
cargan sin cambios. Este es el tipo artículo del
[blog de ejemplo](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog):

```json title="schema/content-types/article.json"
{
  "kind": "collectionType",
  "singularName": "article",
  "pluralName": "articles",
  "displayName": "Article",
  "options": { "draftAndPublish": true },
  "attributes": {
    "title": { "type": "string", "required": true, "maxLength": 200 },
    "slug": { "type": "uid", "targetField": "title", "required": true },
    "excerpt": { "type": "text", "maxLength": 500 },
    "body": { "type": "richtext" },
    "readingTime": { "type": "integer", "min": 0 },
    "featured": { "type": "boolean", "default": false },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "tags": { "type": "relation", "relation": "manyToMany", "target": "tag" },
    "seo": { "type": "component", "component": "shared.seo" },
    "blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"] }
  }
}
```

| Clave | Obligatoria | Descripción |
| --- | --- | --- |
| `kind` | sí | `collectionType` o `singleType`. |
| `singularName` | sí | En kebab-case. Debe coincidir con el nombre del archivo (`article.json`). |
| `pluralName` | sí | En kebab-case, distinto de `singularName`. |
| `displayName` | sí | El nombre que muestra el panel de administración. |
| `description` | no | Se muestra en el panel de administración. |
| `collectionName` | no | Nombre de la tabla. Por defecto, el `pluralName` en snake_case. |
| `options.draftAndPublish` | no | Mantiene un borrador y una versión publicada de cada documento. Por defecto `false`. Consulta [Borrador y publicación](/es/concepts/draft-and-publish/). |
| `pluginOptions.i18n.localized` | no | Una versión por idioma. Por defecto `false`. Consulta [Internacionalización](/es/concepts/internationalization/). |
| `attributes` | no | Los campos, en el orden en que los devuelve la API. |
| `validations` | no | Reglas entre campos; consulta [más abajo](#validaciones-entre-campos). |

Los esquemas son estrictos: una clave desconocida, una opción que un tipo no admite o una
referencia a un tipo o componente que no existe es un error que indica el archivo y la ruta,
y el servidor no arranca. Ejecuta `verdin schema check` para validar los archivos sin
arrancarlo.

Algunos nombres están ocupados:

- Los nombres de atributo empiezan por una letra, seguida de letras, dígitos y guiones bajos,
  hasta 50 caracteres. Se convierten en columnas en snake_case (`metaTitle` → `meta_title`).
- `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`,
  `updatedAt`, `createdBy` y `updatedBy` están reservados en los tipos de contenido, e `id`
  dentro de los componentes.
- `upload`, `uploads`, `auth`, `users` y `connect` no pueden ser un `singularName` ni un
  `pluralName`: esas rutas pertenecen a la API.
- Un tipo de contenido tiene como máximo 60 atributos `string`, `email`, `uid` y
  `enumeration`, lo que mantiene las filas dentro del límite de tamaño de fila de MySQL. Usa
  `text` para algunos de ellos.

Los archivos se editan en el **Constructor de tipos de contenido** del panel, disponible
mientras el servidor se ejecuta con `verdin dev`, o a mano. En ambos casos, un cambio se
convierte en una [migración de esquema](/es/concepts/schema-migrations/). La disposición del
editor (orden de los campos, anchos, etiquetas) no forma parte del esquema: los
administradores la configuran en el panel y se guarda en la base de datos.

## Componentes

Un componente es un grupo de campos reutilizable, como `shared.seo` (un meta título y una
meta descripción). Su UID es `<category>.<name>`, tomado de su ruta:
`schema/components/shared/seo.json` es `shared.seo`. Un archivo de componente tiene
`displayName`, `description` e `icon` opcionales, y `attributes`.

Una zona dinámica es una lista que mezcla varios componentes, como el cuerpo de un artículo
hecho de bloques hero y de cita. Ambos se guardan dentro del documento como JSON; consulta
[Componentes y zonas dinámicas](/es/concepts/components-and-dynamic-zones/).

## Atributos

Cada atributo tiene un `type` y unas opciones que dependen de él. La lista completa de tipos,
sus opciones y sus tipos de columna en cada base de datos está en la
[referencia de tipos de atributo](/es/reference/attribute-types/).

| Categoría | Tipos |
| --- | --- |
| Texto | `string`, `text`, `richtext` (Markdown), `blocks` (el texto enriquecido estructurado de Strapi), `email`, `uid`, `password`, `enumeration` |
| Números | `integer`, `biginteger`, `float`, `decimal` |
| Fechas | `date`, `time`, `datetime` |
| Otros escalares | `boolean`, `json` |
| Enlaces | `relation` (consulta [Relaciones](/es/concepts/relations/)), `media` (consulta [Medios](/es/concepts/media/)) |
| Estructura | `component`, `dynamiczone` |

Opciones comunes:

| Opción | Efecto |
| --- | --- |
| `required` | El valor debe estar definido cuando se publica una versión (o en cada escritura, en los tipos sin borrador y publicación). Los borradores pueden estar incompletos. |
| `private` | La API de contenido nunca lo devuelve, filtra, ordena ni popula. Los atributos `password` son siempre privados. |
| `default` | Valor que se usa cuando un documento nuevo omite el campo. Se comprueba con las reglas del propio atributo. |
| `unique` | Dos documentos no pueden compartir el valor, por idioma y versión. Disponible en `string`, `email` y los tipos numéricos, de fecha y de hora; `uid` es siempre único. |
| `configurable` | `false` bloquea el atributo en el constructor de tipos de contenido: allí no se puede editar, renombrar ni eliminar. |
| `pluginOptions.i18n.localized` | `false` comparte el valor entre idiomas. |

Todas las columnas de atributos admiten nulos en la base de datos. Como en Strapi v5, Verdin
hace cumplir `required` al publicar, no mediante una restricción `NOT NULL`, así que añadir un
atributo obligatorio a un tipo que ya tiene filas es un cambio seguro.

## Validación

Cada escritura se comprueba contra el esquema antes de que llegue nada a la base de datos:

- **Tipos y restricciones**, en cada escritura: tipos de valor, `minLength`/`maxLength`,
  `min`/`max`, `regex`, valores de `enum`, el número de elementos de los componentes
  repetibles y las zonas dinámicas, los tipos de componente que admite una zona dinámica y los
  tipos de archivo que acepta un campo de medios. Las claves desconocidas y los campos del
  sistema en la entrada son errores.
- **Campos obligatorios y reglas entre campos**, cuando se publica una versión, y en cada
  escritura en los tipos sin borrador y publicación. También se aplican dentro de componentes
  y zonas dinámicas.
- **Unicidad**, mediante índices únicos en la base de datos, de modo que dos escrituras
  concurrentes no pueden tener éxito las dos.

Una comprobación fallida responde `400` con un `ValidationError` cuyo `details.errors`
enumera cada problema con su ruta, como `["seo", "metaTitle"]` o `["blocks", 2, "text"]`.
Consulta [Errores](/es/api/rest/#errores).

### Validaciones entre campos

Un tipo de contenido puede declarar reglas que comparan sus propios campos, escritas en
[JSON Logic](https://jsonlogic.com). Este tipo evento exige que la fecha de fin sea posterior
a la de inicio y limita las entradas vendidas al número de plazas:

```json title="schema/content-types/event.json"
{
  "kind": "collectionType",
  "singularName": "event",
  "pluralName": "events",
  "displayName": "Event",
  "attributes": {
    "startDate": { "type": "date", "required": true },
    "endDate": { "type": "date" },
    "seats": { "type": "integer", "min": 0 },
    "sold": { "type": "integer", "min": 0 }
  },
  "validations": [
    {
      "rule": { "or": [{ "!": { "var": "endDate" } }, { "<=": [{ "var": "startDate" }, { "var": "endDate" }] }] },
      "message": "must be after the start date",
      "field": "endDate"
    },
    { "rule": { "<=": [{ "var": "sold" }, { "var": "seats" }] }, "message": "more tickets sold than seats" }
  ]
}
```

- Una regla que no se cumple es un error de validación con `message`, en `field` si se
  indica, o en el documento (`path: []`).
- Las reglas se ejecutan cuando lo hace `required`: al publicar, y en cada escritura en los
  tipos sin borrador y publicación. Los borradores pueden incumplirlas.
- `var` lee los propios campos del documento, con rutas con puntos para entrar en los
  componentes. Las relaciones y los medios no están disponibles para las reglas.
- Las comparaciones son numéricas cuando ambos lados son números y textuales cuando ambos son
  cadenas, así que las fechas, horas y fechas con hora ISO se comparan correctamente. Un
  campo vacío es `null`: protege los campos opcionales, como hace la primera regla.
- Operadores permitidos: `var`, `==`, `!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`,
  `and`, `or`, `in`, `if`, `?:`, `+`, `-`, `*`, `/`, `%`, `min`, `max`, `cat`. Un operador
  desconocido, un `field` desconocido o un `message` vacío es un error de esquema.

El servidor comprueba las reglas; el panel de administración muestra sus mensajes en los
campos que nombran cuando falla una publicación. Strapi no tiene equivalente. Los campos
condicionales de Strapi (`conditions`) se aceptan en los archivos de esquema y se conservan,
pero todavía no se aplican.
