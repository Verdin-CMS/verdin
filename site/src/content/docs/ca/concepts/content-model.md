---
title: "Model de contingut"
description: "Com descriu Verdin el teu contingut: tipus de col·lecció i tipus únics, atributs, fitxers d'esquema en el format de Strapi i regles de validació."
sidebar:
  order: 1
---

El model de contingut és el conjunt de tipus de contingut i components que defineix el teu
projecte. Verdin en deriva tota la resta: les taules de la base de dades, les API REST i
GraphQL, el document OpenAPI, la validació i els formularis del tauler d'administració. Aquesta
pàgina n'explica les peces i les regles que s'hi apliquen.

## Tipus de contingut

Un tipus de contingut descriu una mena de document, com ara un article o una pàgina d'inici. Té
un `kind`:

| Kind | Conté | Rutes REST (exemple del blog) |
| --- | --- | --- |
| `collectionType` | Qualsevol nombre de documents | `/api/articles`, `/api/articles/{documentId}` |
| `singleType` | Com a màxim un document | `/api/homepage` |

Els tipus de col·lecció se serveixen al seu `pluralName` i els tipus únics al seu
`singularName`. El primer `PUT` a un tipus únic en crea el document. Consulta l'[API REST](/ca/api/rest/)
per a totes les rutes.

Cada tipus de contingut té un UID, `api::<singularName>` (`api::article`). Strapi escriu el
mateix UID com a `api::article.article`; Verdin accepta aquesta forma als fitxers d'esquema i a
l'importador, i la normalitza a `api::article`.

Cada document té camps del sistema que no declares: `id`, `documentId` (un ULID de 26 caràcters
en minúscules, estable entre esborranys, versions publicades i idiomes), `createdAt`,
`updatedAt`, `publishedAt`, i `locale` als [tipus localitzats](/ca/concepts/internationalization/).

## Fitxers d'esquema

Els tipus de contingut i els components són fitxers JSON al directori `schema/` del teu projecte
(`[schema].path` a `verdin.toml`). Els versiones a git com el codi.

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

El format és el `schema.json` de Strapi, així que la majoria d'esquemes de Strapi es carreguen
sense canvis. Aquest és el tipus article de
l'[exemple del blog](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog):

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

| Clau | Obligatòria | Descripció |
| --- | --- | --- |
| `kind` | sí | `collectionType` o `singleType`. |
| `singularName` | sí | En kebab-case. Ha de coincidir amb el nom del fitxer (`article.json`). |
| `pluralName` | sí | En kebab-case, diferent de `singularName`. |
| `displayName` | sí | El nom que mostra el tauler d'administració. |
| `description` | no | Es mostra al tauler d'administració. |
| `collectionName` | no | Nom de la taula. Per defecte, el `pluralName` en snake_case. |
| `options.draftAndPublish` | no | Manté un esborrany i una versió publicada de cada document. Per defecte `false`. Consulta [Esborrany i publicació](/ca/concepts/draft-and-publish/). |
| `pluginOptions.i18n.localized` | no | Una versió per idioma. Per defecte `false`. Consulta [Internacionalització](/ca/concepts/internationalization/). |
| `attributes` | no | Els camps, en l'ordre en què els retorna l'API. |
| `validations` | no | Regles entre camps; consulta [més avall](#validacions-entre-camps). |

Els esquemes són estrictes: una clau desconeguda, una opció que un tipus no admet o una
referència a un tipus o component que no existeix és un error que indica el fitxer i el camí, i
el servidor no s'inicia. Executa `verdin schema check` per validar els fitxers sense iniciar-lo.

Alguns noms estan reservats:

- Els noms d'atribut comencen per una lletra, seguida de lletres, dígits i guions baixos, com a
  màxim 50 caràcters. Es converteixen en columnes en snake_case (`metaTitle` → `meta_title`).
- `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`,
  `updatedAt`, `createdBy` i `updatedBy` estan reservats als tipus de contingut, i `id` dins
  dels components.
- `upload`, `uploads`, `auth`, `users` i `connect` no poden ser un `singularName` ni un
  `pluralName`: aquestes rutes pertanyen a l'API.
- Un tipus de contingut té com a màxim 60 atributs `string`, `email`, `uid` i `enumeration`, cosa
  que manté les files dins del límit de mida de fila de MySQL. Fes servir `text` per a alguns.

Edites els fitxers al **Constructor de tipus de contingut** del tauler, disponible mentre el
servidor s'executa amb `verdin dev`, o a mà. En tots dos casos, un canvi es converteix en una
[migració d'esquema](/ca/concepts/schema-migrations/). La disposició de l'editor (ordre dels
camps, amplades, etiquetes) no forma part de l'esquema: els administradors la configuren al
tauler i es desa a la base de dades.

## Components

Un component és un grup de camps reutilitzable, com ara `shared.seo` (un meta títol i una meta
descripció). El seu UID és `<category>.<name>`, extret del seu camí:
`schema/components/shared/seo.json` és `shared.seo`. Un fitxer de component té `displayName`,
`description` i `icon` opcionals, i `attributes`.

Una zona dinàmica és una llista que barreja diversos components, com ara el cos d'un article fet
de blocs de capçalera destacada i de cita. Tots dos es desen dins del document com a JSON;
consulta [Components i zones dinàmiques](/ca/concepts/components-and-dynamic-zones/).

## Atributs

Cada atribut té un `type` i opcions que en depenen. La llista completa de tipus, les seves
opcions i els seus tipus de columna per base de dades és a la
[referència de tipus d'atribut](/ca/reference/attribute-types/).

| Categoria | Tipus |
| --- | --- |
| Text | `string`, `text`, `richtext` (Markdown), `blocks` (el text enriquit estructurat de Strapi), `email`, `uid`, `password`, `enumeration` |
| Nombres | `integer`, `biginteger`, `float`, `decimal` |
| Dates | `date`, `time`, `datetime` |
| Altres escalars | `boolean`, `json` |
| Enllaços | `relation` (consulta [Relacions](/ca/concepts/relations/)), `media` (consulta [Multimèdia](/ca/concepts/media/)) |
| Estructura | `component`, `dynamiczone` |

Opcions comunes:

| Opció | Efecte |
| --- | --- |
| `required` | El valor ha d'estar definit quan es publica una versió (o a cada escriptura, per als tipus sense esborrany i publicació). Els esborranys poden estar incomplets. |
| `private` | L'API de contingut mai no el retorna, filtra, ordena ni pobla. Els atributs `password` sempre són privats. |
| `default` | Valor que es fa servir quan un document nou no inclou el camp. Es comprova amb les regles del mateix atribut. |
| `unique` | Dos documents no poden compartir el valor, per idioma i versió. Disponible als tipus `string`, `email`, numèrics, de data i d'hora; `uid` sempre és únic. |
| `configurable` | `false` bloqueja l'atribut al constructor de tipus de contingut: no s'hi pot editar, reanomenar ni eliminar. |
| `pluginOptions.i18n.localized` | `false` comparteix el valor entre idiomes. |

Totes les columnes d'atribut admeten nuls a la base de dades. Com a Strapi v5, Verdin fa complir
`required` en publicar, no amb una restricció `NOT NULL`, de manera que afegir un atribut
obligatori a un tipus que ja té files és un canvi segur.

## Validació

Cada escriptura es comprova contra l'esquema abans que res arribi a la base de dades:

- **Tipus i restriccions**, a cada escriptura: tipus dels valors, `minLength`/`maxLength`,
  `min`/`max`, `regex`, valors d'`enum`, el nombre d'elements dels components repetibles i de
  les zones dinàmiques, els tipus de component que permet una zona dinàmica i els tipus de
  fitxer que accepta un camp de multimèdia. Les claus desconegudes i els camps del sistema a
  l'entrada són errors.
- **Camps obligatoris i regles entre camps**, quan es publica una versió, i a cada escriptura
  per als tipus sense esborrany i publicació. També s'apliquen dins dels components i de les
  zones dinàmiques.
- **Unicitat**, mitjançant índexs únics a la base de dades, perquè dues escriptures concurrents
  no puguin tenir èxit totes dues.

Una comprovació fallida respon `400` amb un `ValidationError` el `details.errors` del qual
llista cada problema amb el seu camí, com ara `["seo", "metaTitle"]` o `["blocks", 2, "text"]`.
Consulta [Errors](/ca/api/rest/#errors).

### Validacions entre camps

Un tipus de contingut pot declarar regles que comparen els seus propis camps, escrites en
[JSON Logic](https://jsonlogic.com). Aquest tipus d'esdeveniment exigeix que la data de fi sigui
posterior a la d'inici, i limita les entrades venudes al nombre de places:

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

- Una regla que no es compleix és un error de validació amb `message`, a `field` si s'indica, o
  al document (`path: []`).
- Les regles s'executen quan s'executa `required`: en publicar, i a cada escriptura per als tipus
  sense esborrany i publicació. Els esborranys les poden incomplir.
- `var` llegeix els camps del mateix document, amb camins amb punts dins dels components. Les
  relacions i els mitjans no estan disponibles per a les regles.
- Les comparacions són numèriques quan tots dos costats són nombres i textuals quan tots dos són
  cadenes, de manera que les dates, hores i dates i hores ISO es comparen correctament. Un camp
  buit és `null`: protegeix els camps opcionals, com fa la primera regla.
- Operadors permesos: `var`, `==`, `!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`, `and`,
  `or`, `in`, `if`, `?:`, `+`, `-`, `*`, `/`, `%`, `min`, `max`, `cat`. Un operador desconegut,
  un `field` desconegut o un `message` buit és un error d'esquema.

El servidor comprova les regles; el tauler d'administració mostra els seus missatges als camps
que indiquen quan falla una publicació. Strapi no té cap equivalent. Els camps condicionals de
Strapi (`conditions`) s'accepten als fitxers d'esquema i es conserven, però encara no s'apliquen.
