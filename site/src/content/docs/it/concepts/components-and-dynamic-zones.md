---
title: "Componenti e zone dinamiche"
description: "Gruppi di campi riutilizzabili e liste di blocchi misti, perché Verdin li memorizza come JSON sul documento, e cosa significa per relazioni, media, filtri e populate."
sidebar:
  order: 2
---

I componenti ti permettono di riutilizzare un gruppo di campi in più tipi di contenuto, e le
zone dinamiche permettono ai redattori di costruire una pagina da una lista di blocchi.
Questa pagina spiega come entrambi vengono modellati e memorizzati, e come questo influisce
su lettura, scrittura e filtri. Il formato dello schema in sé è in
[Modello dei contenuti](/it/concepts/content-model/).

## Componenti

Un componente è un gruppo di campi con un proprio file sotto
`schema/components/<category>/`. Il componente `shared.seo` del blog di esempio contiene un
meta title e una description:

```json title="schema/components/shared/seo.json"
{
  "displayName": "SEO",
  "attributes": {
    "metaTitle": { "type": "string", "maxLength": 60 },
    "metaDescription": { "type": "text", "maxLength": 160 }
  }
}
```

Un tipo di contenuto lo usa tramite un attributo `component`. `repeatable: true` lo rende una
lista, eventualmente limitata con `min` e `max` elementi:

```json
"seo": { "type": "component", "component": "shared.seo" },
"links": { "type": "component", "component": "shared.link", "repeatable": true, "max": 10 }
```

I componenti possono contenere altri componenti. Un componente non può contenere sé stesso,
direttamente o tramite altri; il controllo dello schema rifiuta questi cicli.

## Zone dinamiche

Una zona dinamica è una lista i cui elementi possono essere uno qualsiasi dei componenti che
nomina. Il corpo degli articoli del blog mescola hero e citazioni:

```json
"blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"], "max": 20 }
```

Ogni elemento dice quale componente è in `__component`. `min` e `max` limitano il numero di
elementi. Le zone dinamiche appartengono solo ai tipi di contenuto: un componente non può
contenerne una.

## Memorizzati come JSON

Verdin memorizza il valore di un componente o di una zona dinamica in una colonna JSON della
riga del documento (`jsonb` su PostgreSQL, `json` su MySQL e MariaDB, testo su SQLite):

```json
// la colonna "seo"
{ "id": 1, "metaTitle": "Rust for CMS authors", "metaDescription": "…" }

// la colonna "blocks"
[
  { "__component": "blocks.hero", "id": 1, "title": "Hello", "subtitle": "…" },
  { "__component": "blocks.quote", "id": 2, "text": "…", "author": "Ferris" }
]
```

Strapi tiene ogni componente in una tabella propria, collegata tramite tabelle di link
polimorfiche. Memorizzare invece il valore con il documento significa che:

- Leggere un documento con i suoi componenti non richiede join, per quanto siano annidati.
- Pubblicazione, scarto di una bozza e [cronologia dei contenuti](/it/guides/content/content-history/)
  copiano il valore così com'è.
- Aggiungere un campo a un componente non modifica nessuna tabella: la migrazione è vuota.
- I filtri sui campi dei componenti usano le funzioni JSON di ciascun database, e alcuni
  filtri non sono disponibili (vedi [Filtrare](#filtrare)).

Ogni elemento ha un `id`, un intero positivo unico all'interno del valore dell'attributo.
Verdin ne assegna uno ai nuovi elementi; rimanda l'`id` quando aggiorni una lista per
mantenere stabili gli elementi.

## Relazioni e media dentro i componenti

Un componente può contenere relazioni e media, memorizzati nel JSON stesso: `documentId`
per le relazioni e id di file per i media.

- Le relazioni dentro i componenti devono essere `oneWay` o `manyWay`: puntano ai loro
  target e non hanno un lato inverso. Vedi
  [Relazioni](/it/concepts/relations/#relazioni-dentro-i-componenti).
- Ogni riferimento viene verificato in scrittura: il documento o file di destinazione deve
  esistere, e i file devono rispettare gli `allowedTypes` del campo.
- Quando il componente viene popolato, i riferimenti vengono risolti con query in batch,
  nello stesso stato e nella stessa lingua del documento. Un target eliminato, o che non ha
  una versione in quella letta, viene omesso.
- Relazioni polimorfiche (`morphToOne`, `morphToMany`) e campi `password` non possono stare
  dentro i componenti.

## Lettura

Componenti e zone dinamiche vengono restituiti solo quando li popoli, come in Strapi:

```http
GET /api/articles?populate[0]=seo&populate[1]=blocks
GET /api/articles?populate=*
```

Un componente popolato torna per intero, con componenti annidati e relazioni e media
risolti. Strapi richiede un livello di `populate` per ogni componente annidato; Verdin
accetta quelle opzioni annidate per compatibilità e le ignora. Gli elementi delle zone
dinamiche tornano nell'ordine memorizzato, ciascuno con il suo `__component`.

In GraphQL, un componente è un object type con il nome del suo UID (`ComponentSharedSeo`) e
una zona dinamica è una union (`ArticleBlocksDynamicZone`) che interroghi con i fragment. Vedi
[API GraphQL](/it/api/graphql/).

## Scrittura

Invia il valore intero dell'attributo. Sostituisce ciò che era memorizzato:

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

Il valore viene validato rispetto allo schema del componente a ogni scrittura: chiavi
sconosciute, tipi sbagliati e un `__component` che la zona dinamica non consente sono errori
con path come `["blocks", 1, "text"]`. I campi `required` dentro i componenti vengono
verificati quando il documento viene pubblicato, come quelli di primo livello.

## Filtrare

| Cosa | Esempio | Note |
| --- | --- | --- |
| Campi di un componente | `filters[seo][metaTitle][$containsi]=rust` | Campi scalari, componenti annidati inclusi. |
| Campi di un componente ripetibile | `filters[links][url][$contains]=github` | Corrisponde quando almeno un elemento corrisponde. |
| Zone dinamiche | `filters[blocks][__component][$eq]=blocks.quote` | Solo per `__component`: elementi di componenti diversi hanno campi diversi. |

Non puoi ordinare per campi dei componenti, e i campi `json` dentro i componenti non si
possono filtrare. Vedi [API REST](/it/api/rest/#filtri) per gli operatori.
