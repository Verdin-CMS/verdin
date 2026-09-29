---
title: Referencia de tipos de atributo
description: Todos los tipos de atributo de un archivo de esquema de Verdin, con sus opciones, sus validaciones, su almacenamiento en la base de datos y su representación en la API.
sidebar:
  order: 4
  label: Tipos de atributo
---

<!-- Written from crates/verdin-schema (convert.rs, validate.rs, model.rs),
crates/verdin-migrate/src/derive.rs and sql.rs (storage), and crates/verdin-content
(input.rs, output.rs, blocks.rs) (API). -->

Los atributos son los campos de un tipo de contenido o de un componente, declarados en
`attributes` en su archivo de esquema. Esta página enumera cada `type`, las opciones que acepta,
cómo lo valida y lo almacena Verdin y cómo aparece en la API. El formato es el de Strapi v5; las
diferencias se enumeran [al final](#diferencias-con-strapi).

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
    "readingTime": { "type": "integer", "min": 0 },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "seo": { "type": "component", "component": "shared.seo" }
  }
}
```

Los archivos de esquema son estrictos: una clave desconocida, o una opción que el tipo no acepta,
es un error que `verdin schema check` indica con su ruta (`attributes.title.maxLength`).

## Opciones que acepta cualquier atributo

| Opción | Por defecto | Descripción |
| --- | --- | --- |
| `type` | obligatoria | Uno de los tipos de más abajo. |
| `required` | `false` | Debe haber un valor. Se comprueba cuando se publica una entrada (los borradores pueden estar incompletos) y en cada escritura de un tipo sin borrador y publicación. También se aplica dentro de componentes y zonas dinámicas. |
| `private` | `false` | La API de contenido nunca lo devuelve, y no se puede usar en `filters` ni en `sort`. Los atributos `password` son siempre privados. |
| `configurable` | `true` | El indicador de Strapi para el constructor del panel; se conserva tal cual se escribe. |
| `pluginOptions.i18n.localized` | `true` | En un tipo de contenido localizado, `false` comparte el valor entre idiomas en lugar de tener un valor por idioma. |
| `customField` | sin definir | `plugin::<plugin>.<field>` (o `global::<field>`): el panel edita el atributo con el campo personalizado de un plugin. El `type` es cómo se guarda el valor. Consulta [Plugins](/es/extending/plugins/). |
| `conditions` | sin definir | Los campos condicionales de Strapi (`{ "visible": <JSON Logic> }`). El editor oculta el campo mientras la regla es falsa, y el servidor no exige un campo oculto. |
| `default` | sin definir | Valor de las entradas nuevas cuando la escritura omite el atributo. Debe ser válido para el tipo. No todos los tipos lo aceptan (consulta cada tipo). |

Los nombres de atributo empiezan por una letra, seguida de letras, dígitos y `_`, hasta 50
caracteres. En los tipos de contenido, `id`, `documentId`, `locale`, `publicationState`,
`publishedAt`, `createdAt`, `updatedAt`, `createdBy` y `updatedBy` están reservados; en los
componentes, `id`. Dos nombres que corresponden a la misma columna (`metaTitle` y `meta_title`)
son un error.

### Dónde se guardan los valores

Cada atributo de un tipo de contenido es una columna de la tabla del tipo (`collectionName`, o el
nombre en plural), con el nombre en `snake_case`. Las relaciones y los medios viven en cambio en
tablas de enlaces. Un borrador y su versión publicada son dos filas, una por idioma en los tipos
localizados.

Tipos de columna por base de datos:

| Columna | PostgreSQL | MySQL y MariaDB | SQLite |
| --- | --- | --- | --- |
| varchar | `varchar(255)` | `varchar(255)` | `text` |
| text | `text` | `longtext` | `text` |
| integer | `integer` | `int` | `integer` |
| bigint | `bigint` | `bigint` | `integer` |
| double | `double precision` | `double` | `real` |
| decimal | `numeric(p,s)` | `decimal(p,s)` | `text` (exacto) |
| boolean | `boolean` | `tinyint(1)` | `integer` |
| date | `date` | `date` | `text` |
| time | `time(3)` | `time(3)` | `text` |
| datetime | `timestamptz(3)` | `datetime(3)` | `text` |
| json | `jsonb` | `json` | `text` |

Un tipo de contenido puede tener como máximo 60 atributos `string`, `email`, `uid` y
`enumeration` (el límite de tamaño de fila de MySQL); usa `text` para los demás.

### `unique`

Los tipos que aceptan `unique: true` reciben un índice único sobre
`(column, locale, publication_state)`: dos entradas publicadas, o dos borradores, en el mismo
idioma no pueden compartir un valor, mientras que un borrador y su propia versión publicada sí
pueden. Una escritura que lo incumple falla con un error de validación en el atributo. Dentro de
los componentes, `unique` se acepta pero no se aplica (los valores de los componentes se guardan
como JSON).

## Texto

### `string`

Una sola línea de texto.

| Opción | Descripción |
| --- | --- |
| `minLength`, `maxLength` | Límites de longitud en caracteres. `maxLength` es como máximo 255. |
| `regex` | Un patrón que debe cumplir el valor. Sintaxis al estilo de JavaScript, con look-around y referencias hacia atrás. |
| `unique` | Consulta [`unique`](#unique). |
| `default` | Una cadena dentro de los límites que cumpla `regex`. |

Se guarda como `varchar(255)`. API: una cadena.

### `text`

Texto plano más largo (un textarea en el panel).

| Opción | Descripción |
| --- | --- |
| `minLength`, `maxLength` | Límites de longitud, sin límite superior. |
| `default` | Una cadena dentro de los límites. |

Se guarda como `text` (`longtext` en MySQL). API: una cadena.

### `richtext`

Texto en Markdown. Las mismas opciones, el mismo almacenamiento y la misma API que `text`; el
panel lo edita con el editor Markdown.

### `blocks`

Texto enriquecido en el JSON de bloques de Strapi: una lista de bloques `paragraph`, `heading`
(`level` de 1 a 6), `list` (`format` `ordered` o `unordered`, con hijos `list-item`, anidados
hasta 8 niveles), `quote`, `code` (`language` opcional) e `image`. Los hijos en línea son nodos
`text`, con las marcas `bold`, `italic`, `underline`, `strikethrough` y `code`, y nodos `link`.
Como máximo 10.000 bloques.

Sin opciones ni `default`. Se guarda como JSON. API: la lista de bloques, tal como se escribió.

```json
[
  { "type": "heading", "level": 2, "children": [{ "type": "text", "text": "Hello" }] },
  { "type": "paragraph", "children": [{ "type": "text", "text": "bold", "bold": true }] }
]
```

### `email`

Una dirección de correo (`name@domain.tld`, sin espacios).

| Opción | Descripción |
| --- | --- |
| `minLength`, `maxLength` | Límites de longitud; `maxLength` como máximo 255. |
| `unique` | Consulta [`unique`](#unique). |
| `default` | Una dirección de correo. |

Se guarda como `varchar(255)`. API: una cadena.

### `password`

Un secreto, que se hashea con Argon2id al escribirlo.

| Opción | Descripción |
| --- | --- |
| `minLength`, `maxLength` | Límites de longitud de la contraseña tal como se envía. |

Sin `default`. Siempre privado: nunca se devuelve, filtra ni ordena. No se permite dentro de
componentes. Se guarda como `varchar(255)` (el hash). Las importaciones conservan tal cual los
hashes bcrypt y Argon2 existentes, para que las cuentas importadas puedan seguir iniciando sesión.

### `uid`

Un identificador para URLs, como un slug. El panel lo genera a partir de `targetField`.

| Opción | Descripción |
| --- | --- |
| `targetField` | Un atributo `string` o `text` del mismo tipo a partir del cual se genera el valor. |
| `minLength`, `maxLength` | Límites de longitud; `maxLength` como máximo 255. |
| `regex` | El patrón que deben cumplir los valores; sin él, `^[A-Za-z0-9\-_.~]*$`. |
| `default` | Un valor válido. |

Siempre único (consulta [`unique`](#unique)). Se guarda como `varchar(255)`. API: una cadena.

### `enumeration`

Un valor de una lista fija.

| Opción | Descripción |
| --- | --- |
| `enum` | Los valores: al menos uno, cada uno de 1 a 255 caracteres, sin duplicados. |
| `default` | Uno de los valores. |

Se guarda como `varchar(255)`. API: una cadena. Las escrituras con cualquier otro valor fallan.

## Números

### `integer`

Un entero de 32 bits (de −2.147.483.648 a 2.147.483.647).

| Opción | Descripción |
| --- | --- |
| `min`, `max` | Límites (enteros). |
| `unique` | Consulta [`unique`](#unique). |
| `default` | Un entero dentro de los límites. |

Se guarda como `integer`. API: un número. Las escrituras aceptan números y cadenas de enteros.

### `biginteger`

Un entero de 64 bits. Las mismas opciones que `integer`.

Se guarda como `bigint`. API: una cadena (`"9007199254740993"`), como en Strapi, porque los
números de JavaScript pierden precisión más allá de 2⁵³. Las escrituras aceptan cadenas y números.

### `float`

Un número de coma flotante de doble precisión. Las mismas opciones que `integer`, con límites
numéricos.

Se guarda como `double precision` (`double`, `real`). API: un número.

### `decimal`

Un número decimal exacto.

| Opción | Por defecto | Descripción |
| --- | --- | --- |
| `precision` | `10` | Número total de dígitos, de 1 a 38. |
| `scale` | `2` | Dígitos después del separador decimal, como máximo `precision`. |
| `min`, `max` | | Límites. |
| `unique` | | Consulta [`unique`](#unique). |
| `default` | | Un número dentro de los límites. |

Los valores se redondean a `scale` dígitos (hacia fuera del cero en caso de empate, como hacen
las bases de datos), y se rechazan cuando tienen más de `precision - scale` dígitos antes del
separador. Las escrituras aceptan números y cadenas numéricas. Se guarda como
`numeric(precision,scale)` (`text` en SQLite, para que no se redondee nada). API: un número, o una
cadena exacta con [`[api].decimal_as_string`](/es/reference/configuration/).

## Fechas y booleanos

### `boolean`

`true` o `false`. Acepta `default`. Se guarda como `boolean` (`tinyint(1)`, `integer`). API: un
booleano.

### `date`

Una fecha del calendario, `YYYY-MM-DD`. Acepta `unique` y `default`. Se guarda como `date`. API:
`"2026-09-29"`.

### `time`

Una hora del día, `HH:MM`, `HH:MM:SS` o `HH:MM:SS.mmm`. Acepta `unique` y `default`. Se guarda con
precisión de milisegundos. API: `"14:30:00.000"`.

### `datetime`

Un instante: una marca de tiempo ISO 8601 con zona (`Z` o `+02:00`). Acepta `unique` y `default`.
Se guarda en UTC con precisión de milisegundos. API: `"2026-09-29T12:30:00.000Z"`.

## `json`

Cualquier valor JSON. Acepta `default` (cualquier JSON). Se guarda como `jsonb` (`json`, `text`).
API: el valor tal como se escribió. En `filters`, los atributos JSON solo admiten `$null` y
`$notNull`, y no se puede ordenar por ellos.

## Medios

### `media`

Archivos de la biblioteca de medios.

| Opción | Por defecto | Descripción |
| --- | --- | --- |
| `multiple` | `false` | Contiene una lista de archivos en lugar de uno. |
| `allowedTypes` | cualquiera | Clases de archivo: `images`, `videos`, `audios`, `files` (todo lo demás). |

Sin `default`. Se guarda en una tabla de enlaces `{table}_{attribute}_mda`, en orden. Las
escrituras reciben ids de archivo: `12`, `{ "id": 12 }`, una lista de ellos, o `null`. API: solo
con `populate`; un objeto de archivo (`url`, `mime`, `width`, `formats`…, como en Strapi), una
lista de ellos, o `null`. Consulta [Medios](/es/concepts/media/).

## Relaciones

### `relation`

Enlaces a documentos de otro tipo de contenido.

| Opción | Descripción |
| --- | --- |
| `relation` | `oneToOne`, `oneToMany`, `manyToOne`, `manyToMany`, `oneWay`, `manyWay`, o un tipo polimórfico (ver más abajo). |
| `target` | El tipo de contenido de destino: `article`, `api::article` o `api::article.article`. |
| `inversedBy` | En el lado propietario de una relación bidireccional: el atributo del destino que la refleja. |
| `mappedBy` | En el otro lado: el atributo propietario del destino. |

Los dos lados de una relación bidireccional deben coincidir: `oneToMany` refleja `manyToOne`,
`oneToOne` y `manyToMany` se reflejan a sí mismos, y el lado `mappedBy` nombra un atributo cuyo
`inversedBy` apunta de vuelta. `oneWay` y `manyWay` no tienen otro lado.

Los enlaces se guardan en `{table}_{attribute}_lnk` en el lado propietario (el lado sin
`mappedBy`), apuntando al `documentId` del destino, en orden. Las escrituras reciben
`documentId`s:

| Escritura | Significado |
| --- | --- |
| `"d8f3…"`, `{ "documentId": "d8f3…" }`, una lista de ellos | Sustituye los enlaces. |
| `null` o `[]` | Elimina todos los enlaces. |
| `{ "set": [...] }` | Sustituye los enlaces. |
| `{ "connect": [...], "disconnect": [...] }` | Añade y quita enlaces. Un elemento de `connect` puede llevar `position`: `{ "before": id }`, `{ "after": id }`, `{ "start": true }` o `{ "end": true }`. |

API: solo con `populate`, como los documentos relacionados (como máximo 1.000 por entrada y
relación), o `{ "count": n }` con `populate[tags][count]=true`. Consulta
[Relaciones](/es/concepts/relations/).

Dentro de los componentes solo se permiten `oneWay` y `manyWay`; el componente guarda los
`documentId`s.

### Relaciones polimórficas

`relation` también acepta los tipos polimórficos, que enlazan documentos de cualquier tipo de
contenido:

| `relation` | Opciones | Descripción |
| --- | --- | --- |
| `morphToOne` | ninguna | Enlaza un documento de cualquier tipo. |
| `morphToMany` | ninguna | Enlaza documentos de cualquier tipo. |
| `morphOne` | `target`, `morphBy` | Lado inverso: lee los enlaces del atributo `morphToOne` o `morphToMany` `morphBy` de `target`. |
| `morphMany` | `target`, `morphBy` | Lo mismo, para muchos. |

Los propietarios guardan pares `(type, documentId)` en `{table}_{attribute}_mph`. Las escrituras
reciben elementos `{ "__type": "api::article", "documentId": "…" }` (uno, una lista, `null` o
`{ "set": [...] }`). Los elementos populados llevan su tipo en `__type`. No se permiten dentro de
componentes.

## Componentes y zonas dinámicas

### `component`

Un grupo de campos definido en `schema/components/<category>/<name>.json`.

| Opción | Por defecto | Descripción |
| --- | --- | --- |
| `component` | obligatoria | El uid del componente, `category.name` (`shared.seo`). |
| `repeatable` | `false` | Contiene una lista de elementos en lugar de uno. |
| `min`, `max` | | Número de elementos; solo con `repeatable`. |

Sin `default`: los elementos nuevos reciben los valores por defecto de sus propios atributos. Se
guarda como JSON en la fila de la entrada, cada elemento con un `id`. Las escrituras reciben el
objeto del elemento (o una lista), con `id` para conservar un elemento existente. API: solo con
`populate`, el elemento o la lista entera. En `filters` se puede filtrar por los campos de un
componente (`filters[seo][metaTitle][$eq]=…`). Consulta
[Componentes y zonas dinámicas](/es/concepts/components-and-dynamic-zones/).

### `dynamiczone`

Una lista de elementos, cada uno de ellos uno de varios componentes.

| Opción | Descripción |
| --- | --- |
| `components` | Los uids de componente permitidos: al menos uno, sin duplicados. |
| `min`, `max` | Número de elementos. |

Cada elemento lleva `__component` con su uid. Se guarda como JSON en la fila de la entrada. API:
solo con `populate`, la lista entera. Filtra por componente con
`filters[blocks][__component][$eq]=blocks.hero`. Las zonas dinámicas no se pueden anidar dentro de
componentes.

## Validaciones entre campos

Además de las opciones por atributo, un tipo de contenido puede declarar en `validations` reglas
sobre varios campos, que se comprueban siempre que se comprueba `required`:

```json
"validations": [
  {
    "rule": { "<=": [{ "var": "startDate" }, { "var": "endDate" }] },
    "message": "The end date must be after the start date",
    "field": "endDate"
  }
]
```

`rule` es una expresión JSON Logic sobre la entrada que debe cumplirse. Puede usar `var`, `==`,
`!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`, `and`, `or`, `in`, `if`, `?:`, `+`, `-`,
`*`, `/`, `%`, `min`, `max` y `cat`. `message` se indica en `field` (un atributo del tipo) o en la
entrada. Es un añadido de Verdin; Strapi no tiene equivalente.

## Diferencias con Strapi

- **Los componentes se guardan como JSON** en la fila de la entrada, no en tablas de componentes
  con tablas de unión. Las lecturas no necesitan joins; como consecuencia, los atributos
  `password`, las relaciones polimórficas y las relaciones bidireccionales no pueden estar dentro
  de componentes, y `unique` no se aplica ahí.
- **Los componentes populados se devuelven completos.** `populate` sobre un componente o una zona
  dinámica devuelve todos sus campos; no se pueden elegir campos anidados como en Strapi.
- **Archivos de esquema estrictos.** Las claves desconocidas y las opciones que un tipo no acepta
  son errores, mientras que Strapi las ignora. En `pluginOptions` solo se lee `i18n.localized`; el
  resto se ignora.
- **`string`, `email` y `uid` están limitados a 255 caracteres**, el tamaño de la columna, en
  lugar de fallar en la base de datos.
- **`conditions`** (campos condicionales) funcionan como en Strapi 5.17: los campos ocultos no son obligatorios.
- **`validations`** son propias de Verdin.
- El resto coincide con Strapi v5: los nombres de los tipos, sus opciones, los valores
  `biginteger` como cadenas, la escritura de relaciones con `connect`, `disconnect`, `set` y
  `position`, y el formato de bloques.
