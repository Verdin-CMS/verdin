---
title: "Internacionalización"
description: "Cómo mantiene Verdin una versión de cada documento por idioma, qué campos se localizan o se comparten y cómo eligen idioma las APIs."
sidebar:
  order: 5
---

La internacionalización (i18n) guarda el contenido de un documento en varios idiomas. Esta
página explica el modelo: idiomas, campos localizados y compartidos, y cómo eligen idioma las
lecturas y las escrituras. Para el flujo de trabajo del editor, consulta
[Localizar contenido](/es/guides/content/localizing-content/).

## Idiomas

Los idiomas del proyecto se enumeran en **Configuración → Internacionalización** (permiso
`locales.manage`). El primer arranque añade el inglés (`en`) como idioma por defecto.

- Siempre hay un idioma por defecto. Las peticiones que no indican idioma lo usan, y no se
  puede eliminar.
- Los códigos son un idioma de dos o tres letras minúsculas, seguido opcionalmente de
  subetiquetas: `en`, `fr`, `pt-BR`, `zh-Hans`.

:::caution
Eliminar un idioma también elimina todas las versiones escritas en él.
:::

## Tipos de contenido localizados

Un tipo de contenido está localizado cuando su esquema lo indica. Cada documento tiene
entonces una versión por idioma, y todas comparten el `documentId`:

```json title="schema/content-types/article.json (excerpt)"
{
  "kind": "collectionType",
  "singularName": "article",
  "pluralName": "articles",
  "displayName": "Article",
  "options": { "draftAndPublish": true },
  "pluginOptions": { "i18n": { "localized": true } },
  "attributes": {
    "title": { "type": "string", "required": true },
    "readingTime": { "type": "integer", "pluginOptions": { "i18n": { "localized": false } } }
  }
}
```

Con [borrador y publicación](/es/concepts/draft-and-publish/), cada idioma tiene su propio
borrador y su propia versión publicada, así que una traducción al francés se puede publicar
antes o después que el texto en inglés. Los tipos sin `pluginOptions.i18n.localized` no están
localizados e ignoran los parámetros `locale`.

## Qué se localiza

En un tipo localizado, todos los atributos se localizan salvo que indiquen
`"pluginOptions": { "i18n": { "localized": false } }`. Un campo así, **compartido**, tiene un
único valor para todo el documento:

- Guardar un campo compartido en un idioma lo escribe en los borradores de todos los idiomas.
- Publicar un idioma copia sus campos compartidos a las versiones publicadas de los demás
  idiomas.
- Esto también se aplica a las relaciones y los medios: una relación compartida enlaza los
  mismos documentos en todos los idiomas.

Los campos del sistema siguen a la versión: cada idioma tiene su propio `createdAt`,
`updatedAt` y `publishedAt`. Los valores `unique` y `uid` son únicos por idioma, así que dos
traducciones pueden compartir slug.

## Relaciones entre tipos localizados

Las relaciones enlazan documentos, no versiones (consulta
[Relaciones](/es/concepts/relations/#enlazadas-por-documento-no-por-fila)), así que el idioma
se elige al leer:

- Cuando los dos tipos están localizados, el artículo en francés muestra la versión en
  francés de su categoría. Los filtros a través de la relación comparan en el mismo idioma.
- Cuando el tipo de destino no está localizado, todos los idiomas ven el mismo destino.

## Elegir idioma en las APIs

REST y la API de administración reciben `locale` como parámetro de consulta, en el formato de
Strapi v5; GraphQL recibe un argumento `locale`:

```http
GET /api/articles?locale=fr
PUT /api/articles/{documentId}?locale=fr
DELETE /api/articles/{documentId}?locale=fr
```

```graphql
query {
  articles(locale: "fr") {
    documentId
    title
  }
}
```

- Sin `locale`, las peticiones leen y escriben el idioma por defecto.
- Un `PUT` en un idioma que el documento todavía no tiene crea esa versión.
- Un `DELETE` elimina solo la versión del idioma pedido. Los enlaces que apuntan al documento
  se eliminan cuando ya no le queda ningún idioma.
- Las respuestas REST de los tipos localizados incluyen `locale`. Un idioma desconocido es un
  error `400`.
- Los payloads de los webhooks, los eventos en tiempo real y el historial de contenido
  registran el idioma de la versión que ha cambiado.

## Permisos por idioma

Los roles de administración pueden limitar los permisos de contenido a algunos idiomas, de
modo que un editor de francés solo pueda leer o cambiar las versiones en francés. Consulta
[Permisos](/es/concepts/permissions/#permisos-por-campo-y-por-idioma). Los permisos de la API
de contenido (acceso público, tokens de API, roles de usuario final) se aplican a todos los
idiomas.

## Comparación con Strapi

El modelo y los parámetros coinciden con la i18n de Strapi v5: tipos localizados, campos
`localized: false`, `?locale=` y el idioma por defecto. En Verdin, la i18n forma parte del
núcleo y está siempre disponible: la activas por tipo de contenido en el esquema.
