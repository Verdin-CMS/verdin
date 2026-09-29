---
title: "Relacions"
description: "Tipus de relació, com enllaça Verdin els documents per documentId, l'ordenació, les relacions polimòrfiques i què volen dir oneWay i manyWay dins dels components."
sidebar:
  order: 3
---

Una relació enllaça documents de dos tipus de contingut, com un article i la seva categoria.
Aquesta pàgina explica els tipus de relació, com es desen i es resolen els enllaços, i les regles
per escriure'ls, ordenar-los i llegir-los. Per a la sintaxi de les peticions, consulta
l'[API REST](/ca/api/rest/#escriptura).

## Tipus

Una relació és un atribut de `type: "relation"` amb un tipus `relation` i un tipus de contingut
`target`:

| Tipus | Un document enllaça amb | Una destinació és enllaçada des de | Costat invers |
| --- | --- | --- | --- |
| `oneWay` | una destinació | qualsevol nombre de documents | cap |
| `manyWay` | moltes destinacions | qualsevol nombre de documents | cap |
| `manyToOne` | una destinació | qualsevol nombre de documents | `oneToMany` |
| `oneToMany` | moltes destinacions | un document | `manyToOne` |
| `oneToOne` | una destinació | un document | `oneToOne` |
| `manyToMany` | moltes destinacions | qualsevol nombre de documents | `manyToMany` |

L'exemple del blog enllaça els articles amb una categoria (amb costat invers) i amb etiquetes
(sense):

```json title="schema/content-types/article.json (excerpt)"
"category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
"tags": { "type": "relation", "relation": "manyToMany", "target": "tag" }
```

```json title="schema/content-types/category.json (excerpt)"
"articles": { "type": "relation", "relation": "oneToMany", "target": "article", "mappedBy": "category" }
```

- El costat amb `inversedBy` (o sense cap de les dues claus) és el costat **propietari**: desa
  els enllaços i és el que escrius.
- El costat amb `mappedBy` és el costat **invers**: llegeix els enllaços del propietari a la
  inversa i és de només lectura. Escriure-hi és un error de validació que indica l'atribut
  propietari.
- Els dos costats han de coincidir: `mappedBy` anomena un atribut de la destinació que torna a
  apuntar amb `inversedBy`, amb el tipus invers corresponent de la taula.
- `oneWay` i `manyWay` mai no tenen costat invers.

El constructor de tipus de contingut crea per tu l'atribut invers a la destinació.

## Enllaçades per document, no per fila

Un document té diverses files: un esborrany i una versió publicada, i una de cada per idioma.
Verdin desa una relació com un enllaç de la **fila** d'origen al **document** de destinació (el
seu `documentId`), en una taula d'enllaç anomenada `{table}_{field}_lnk`. La fila de destinació
es tria quan es llegeix la relació:

- Un article publicat veu la versió publicada de la seva categoria; el seu esborrany veu
  l'esborrany de la categoria. Els tipus sense esborrany i publicació tenen una sola versió, que
  veuen tots els lectors.
- Quan la destinació també és localitzada, les lectures la resolen en el mateix idioma. Un tipus
  de destinació no localitzat és compartit per tots els idiomes.
- Despublicar una categoria l'amaga dels articles publicats sense tocar cap enllaç; tornar-la a
  publicar la recupera.
- Publicar un article només copia els seus propis enllaços a la versió publicada.

Strapi enllaça ids de fila, així que ha de reescriure els enllaços cada cop que es publica un
esborrany. Verdin no ho fa mai, cosa que redueix la publicació a una sola còpia de la fila de
l'esborrany.

La integritat la manté Verdin en lloc de les claus foranes: enllaçar un document que no existeix
és un error de validació, i eliminar un document elimina els enllaços que hi apunten en la
mateixa transacció.

### Un document per destinació

Per a `oneToOne` i `oneToMany`, una destinació pertany com a màxim a un document d'origen.
Enllaçar una destinació que té un altre document la **mou**: l'enllaç de l'altre document
s'elimina en la mateixa escriptura. Aquest és el comportament de Strapi. Es fa complir per
versió: un esborrany i la seva versió publicada poden tenir la mateixa destinació.

## Escriptura

Al costat propietari, `data` accepta un `documentId`, una llista de `documentId` o un objecte que
descriu un canvi:

| Entrada | Efecte |
| --- | --- |
| `"k2m…"` o `{ "documentId": "k2m…" }` | Enllaça una destinació (relacions a un). |
| `["k2m…", "p9x…"]` | Substitueix tots els enllaços, en aquest ordre. |
| `null` o `[]` | Elimina tots els enllaços. |
| `{ "set": ["k2m…"] }` | Substitueix tots els enllaços. |
| `{ "connect": [...], "disconnect": [...] }` | Afegeix i elimina enllaços, i conserva els altres. |

Connectar una destinació nova a una relació a un substitueix l'anterior. `set` no es pot
combinar amb `connect` ni `disconnect`.

Al tauler d'administració, un camp de relació llista les entrades enllaçades. **Enllaça una
entrada** (o **Enllaça entrades** per a relacions a molts) obre un diàleg que cerca entre les
entrades del tipus de destinació, als seus camps de text, i en l'idioma de l'entrada quan la
destinació és localitzada. Tria una entrada, o marca'n diverses i afegeix-les; les entrades ja
enllaçades apareixen marcades.

## Ordenació

Les relacions a molts conserven l'ordre dels seus enllaços. Una llista o un `set` desa l'ordre
que envies. Els elements de `connect` poden indicar on van:

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

`position` és `{ "before": documentId }`, `{ "after": documentId }`, `{ "start": true }` o
`{ "end": true }`. Les posicions es tornen a numerar a cada escriptura. Les lectures retornen els
documents relacionats en l'ordre dels enllaços tret que el populate demani un `sort`.

## Lectura

Les relacions només es retornen quan les pobles:

```http
GET /api/articles?populate[category][fields][0]=name&populate[tags][sort]=label:asc
```

Una relació a un és un objecte o `null`; una relació a molts és un array. Cada relació poblada
pot tenir els seus propis `fields`, `filters`, `sort`, `populate` i `count`, fins a cinc nivells
de profunditat. Cada nivell és una consulta agrupada per relació (`WHERE … IN (…)`), no un join,
de manera que els populate profunds no multipliquen les files. Es retornen com a màxim 1.000
documents relacionats per document i relació; `count` dona el nombre exacte.

Pots filtrar a través de relacions (`filters[category][name][$eq]=News`), per qualsevol dels
costats, i ordenar per un camp d'una relació a un (`sort=category.name:asc`). Poblar, filtrar o
ordenar a través d'una relació cap a un tipus que el client no pot llegir es rebutja
(`populate=*` l'omet), de manera que les relacions mai no revelen contingut que els
[permisos](/ca/concepts/permissions/) del client amaguen.

## Relacions dins de components

Un [component](/ca/concepts/components-and-dynamic-zones/) pot contenir relacions, però només
`oneWay` i `manyWay`:

```json title="schema/components/shared/related.json"
{
  "displayName": "Related",
  "attributes": {
    "label": { "type": "string" },
    "articles": { "type": "relation", "relation": "manyWay", "target": "article" }
  }
}
```

El JSON del component desa els mateixos `documentId`: una cadena per a `oneWay`, un array per a
`manyWay`. Per això no s'hi permeten els altres tipus:

- Un costat invers hauria de cercar al JSON de tots els documents per saber qui l'enllaça.
- «Un document per destinació» (`oneToOne`, `oneToMany`) tampoc no es pot fer complir sense
  aquesta cerca.

Dins dels components, l'ordre d'una llista `manyWay` és l'ordre de l'array. Les referències es
comproven en escriure i es resolen quan es pobla el component, en l'estat i l'idioma del
document; les destinacions que ja no existeixen queden fora. No es poden filtrar.

## Relacions polimòrfiques

`morphToOne` i `morphToMany` enllacen documents de qualsevol tipus de contingut. Els seus
enllaços desen el tipus de la destinació al costat del seu `documentId`, i les escriptures
indiquen tots dos:

```json
{ "data": { "related": [{ "__type": "api::article", "documentId": "k2m…" }, { "__type": "api::page", "documentId": "p9x…" }] } }
```

Els elements poblats són els documents de destinació amb el seu `__type`, llegits en l'estat i
l'idioma de la petició. Els costats inversos `morphOne` i `morphMany` indiquen el tipus
propietari (`target`) i el seu atribut (`morphBy`), i són de només lectura. Les relacions
polimòrfiques no es poden filtrar ni ordenar, i no poden estar dins de components.
