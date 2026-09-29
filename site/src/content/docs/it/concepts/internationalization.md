---
title: "Internazionalizzazione"
description: "Come Verdin mantiene una versione di un documento per lingua, quali campi sono localizzati o condivisi, e come le API scelgono una lingua."
sidebar:
  order: 5
---

L'internazionalizzazione (i18n) mantiene il contenuto di un documento in più lingue. Questa
pagina spiega il modello: lingue, campi localizzati e condivisi, e come letture e scritture
scelgono una lingua. Per il flusso di lavoro dei redattori, vedi
[Localizzare i contenuti](/it/guides/content/localizing-content/).

## Lingue

Le lingue del progetto sono elencate in **Impostazioni → Internazionalizzazione** (permesso
`locales.manage`). Il primo avvio aggiunge l'inglese (`en`) come lingua di default.

- Una lingua è sempre quella di default. Le richieste che non indicano una lingua la usano,
  e non può essere eliminata.
- I codici sono una lingua di due o tre lettere minuscole, eventualmente seguita da
  subtag: `en`, `fr`, `pt-BR`, `zh-Hans`.

:::caution
Eliminare una lingua elimina anche tutte le versioni scritte in essa.
:::

## Tipi di contenuto localizzati

Un tipo di contenuto è localizzato quando il suo schema lo dice. Ogni documento ha allora
una versione per lingua, e tutte condividono il `documentId`:

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

Con [bozza e pubblicazione](/it/concepts/draft-and-publish/), ogni lingua ha la propria
bozza e la propria versione pubblicata, quindi una traduzione francese può essere pubblicata
prima o dopo il testo inglese. I tipi senza `pluginOptions.i18n.localized` non sono
localizzati e ignorano i parametri `locale`.

## Cosa è localizzato

In un tipo localizzato, ogni attributo è localizzato a meno che non indichi
`"pluginOptions": { "i18n": { "localized": false } }`. Un campo così, **condiviso**, ha un
solo valore per tutto il documento:

- Salvare un campo condiviso in una lingua lo scrive nelle bozze di tutte le lingue.
- Pubblicare una lingua copia i suoi campi condivisi nelle versioni pubblicate delle altre
  lingue.
- Questo vale anche per relazioni e media: una relazione condivisa collega gli stessi
  documenti in ogni lingua.

I campi di sistema seguono la versione: ogni lingua ha i propri `createdAt`, `updatedAt` e
`publishedAt`. I valori `unique` e `uid` sono unici per lingua, quindi due traduzioni
possono avere lo stesso slug.

## Relazioni tra tipi localizzati

Le relazioni collegano documenti, non versioni (vedi
[Relazioni](/it/concepts/relations/#collegate-per-documento-non-per-riga)), quindi la lingua
viene scelta in lettura:

- Quando entrambi i tipi sono localizzati, l'articolo francese mostra la versione francese
  della sua categoria. I filtri attraverso la relazione confrontano nella stessa lingua.
- Quando il tipo di destinazione non è localizzato, tutte le lingue vedono lo stesso target.

## Scegliere una lingua nelle API

REST e l'API admin accettano `locale` come parametro di query, nel formato di Strapi v5;
GraphQL accetta un argomento `locale`:

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

- Senza `locale`, le richieste leggono e scrivono la lingua di default.
- Un `PUT` in una lingua che il documento non ha ancora crea quella versione.
- Un `DELETE` rimuove solo la versione nella lingua richiesta. I collegamenti che puntano al
  documento vengono rimossi quando non resta più nessuna lingua.
- Le risposte REST dei tipi localizzati includono `locale`. Una lingua sconosciuta è un
  errore `400`.
- I payload dei webhook, gli eventi realtime e la cronologia dei contenuti registrano la
  lingua della versione modificata.

## Permessi per lingua

I ruoli admin possono limitare i permessi sui contenuti ad alcune lingue, così un redattore
francese può leggere o modificare solo le versioni francesi. Vedi
[Permessi](/it/concepts/permissions/#permessi-su-campi-e-lingue). I permessi della content
API (accesso pubblico, token API, ruoli degli utenti finali) si applicano a tutte le lingue.

## Confronto con Strapi

Il modello e i parametri corrispondono all'i18n di Strapi v5: tipi localizzati, campi
`localized: false`, `?locale=` e la lingua di default. In Verdin, l'i18n fa parte del core
ed è sempre attivo: lo attivi per tipo di contenuto nello schema.
