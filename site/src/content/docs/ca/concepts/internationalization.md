---
title: "Internacionalització"
description: "Com manté Verdin una versió de cada document per idioma, quins camps són localitzats o compartits i com trien un idioma les API."
sidebar:
  order: 5
---

La internacionalització (i18n) conserva el contingut d'un document en diverses llengües. Aquesta
pàgina explica el model: idiomes, camps localitzats i compartits, i com trien un idioma les
lectures i les escriptures. Per al flux de treball dels editors, consulta
[Localitzar contingut](/ca/guides/content/localizing-content/).

## Idiomes

Els idiomes del projecte es llisten a **Configuració → Internacionalització** (permís
`locales.manage`). El primer inici afegeix l'anglès (`en`) com a idioma per defecte.

- Sempre hi ha un idioma per defecte. Les peticions que no indiquen cap idioma el fan servir, i
  no es pot eliminar.
- Els codis són una llengua de dues o tres lletres minúscules, seguida opcionalment de
  subetiquetes: `en`, `fr`, `pt-BR`, `zh-Hans`.

:::caution
Eliminar un idioma també elimina totes les versions escrites en aquest idioma.
:::

## Tipus de contingut localitzats

Un tipus de contingut és localitzat quan ho diu el seu esquema. Aleshores cada document té una
versió per idioma, i totes comparteixen el `documentId`:

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

Amb [esborrany i publicació](/ca/concepts/draft-and-publish/), cada idioma té el seu propi
esborrany i la seva pròpia versió publicada, de manera que una traducció francesa es pot publicar
abans o després del text anglès. Els tipus sense `pluginOptions.i18n.localized` no són
localitzats i ignoren els paràmetres `locale`.

## Què es localitza

En un tipus localitzat, tots els atributs són localitzats tret que indiquin
`"pluginOptions": { "i18n": { "localized": false } }`. Un camp així, **compartit**, té un sol
valor per a tot el document:

- Desar un camp compartit en un idioma l'escriu als esborranys de tots els idiomes.
- Publicar un idioma copia els seus camps compartits a les versions publicades dels altres
  idiomes.
- Això també s'aplica a les relacions i a la multimèdia: una relació compartida enllaça els
  mateixos documents a tots els idiomes.

Els camps del sistema segueixen la versió: cada idioma té els seus propis `createdAt`,
`updatedAt` i `publishedAt`. Els valors `unique` i `uid` són únics per idioma, de manera que dues
traduccions poden compartir un slug.

## Relacions entre tipus localitzats

Les relacions enllacen documents, no versions (consulta
[Relacions](/ca/concepts/relations/#enllaçades-per-document-no-per-fila)), així que l'idioma es
tria en llegir:

- Quan tots dos tipus són localitzats, l'article francès mostra la versió francesa de la seva
  categoria. Els filtres a través de la relació coincideixen en el mateix idioma.
- Quan el tipus de destinació no és localitzat, tots els idiomes veuen la mateixa destinació.

## Triar un idioma a les API

REST i l'API d'administració accepten `locale` com a paràmetre de consulta, en el format de
Strapi v5; GraphQL accepta un argument `locale`:

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

- Sense `locale`, les peticions llegeixen i escriuen l'idioma per defecte.
- Un `PUT` en un idioma que el document encara no té crea aquesta versió.
- Un `DELETE` només elimina la versió de l'idioma demanat. Els enllaços que apunten al document
  s'eliminen quan ja no en queda cap idioma.
- Les respostes REST dels tipus localitzats inclouen `locale`. Un idioma desconegut és un error
  `400`.
- Les càrregues dels webhooks, els esdeveniments en temps real i l'historial de contingut
  registren l'idioma de la versió que ha canviat.

## Permisos per idioma

Els rols d'administració poden limitar els permisos de contingut a alguns idiomes, de manera que
un editor francès només pugui llegir o canviar les versions franceses. Consulta
[Permisos](/ca/concepts/permissions/#permisos-per-camp-i-per-idioma). Els permisos de l'API de
contingut (accés públic, tokens d'API, rols d'usuari final) s'apliquen a tots els idiomes.

## Comparació amb Strapi

El model i els paràmetres coincideixen amb l'i18n de Strapi v5: tipus localitzats, camps
`localized: false`, `?locale=` i l'idioma per defecte. A Verdin, l'i18n forma part del nucli i
sempre està disponible: l'actives per a cada tipus de contingut a l'esquema.
