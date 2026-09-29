---
title: "Modello dei contenuti"
description: "Come Verdin descrive i tuoi contenuti: collection type e single type, attributi, file dello schema nel formato di Strapi e regole di validazione."
sidebar:
  order: 1
---

Il modello dei contenuti è l'insieme di tipi di contenuto e componenti definiti dal tuo
progetto. Verdin ne ricava tutto il resto: le tabelle del database, le API REST e GraphQL, il
documento OpenAPI, la validazione e i form del pannello di amministrazione. Questa pagina
spiega i pezzi e le regole che si applicano.

## Tipi di contenuto

Un tipo di contenuto descrive un genere di documento, come un articolo o una homepage. Ha un
`kind`:

| Kind | Contiene | Route REST (blog di esempio) |
| --- | --- | --- |
| `collectionType` | Un numero qualsiasi di documenti | `/api/articles`, `/api/articles/{documentId}` |
| `singleType` | Al massimo un documento | `/api/homepage` |

I collection type sono serviti al loro `pluralName`, i single type al loro `singularName`.
Il primo `PUT` a un single type crea il suo documento. Vedi l'[API REST](/it/api/rest/) per
tutte le route.

Ogni tipo di contenuto ha un UID, `api::<singularName>` (`api::article`). Strapi scrive lo
stesso UID come `api::article.article`; Verdin accetta quella forma nei file dello schema e
nell'importer, e la normalizza in `api::article`.

Ogni documento ha campi di sistema che non dichiari: `id`, `documentId` (un ULID minuscolo
di 26 caratteri, stabile tra bozze, versioni pubblicate e lingue), `createdAt`, `updatedAt`,
`publishedAt`, e `locale` sui [tipi localizzati](/it/concepts/internationalization/).

## File dello schema

Tipi di contenuto e componenti sono file JSON nella directory `schema/` del tuo progetto
(`[schema].path` in `verdin.toml`). Li versioni in git come il codice.

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

Il formato è lo `schema.json` di Strapi, quindi la maggior parte degli schemi Strapi si
carica senza modifiche. Questo è il tipo article del
[blog di esempio](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog):

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

| Chiave | Obbligatoria | Descrizione |
| --- | --- | --- |
| `kind` | sì | `collectionType` o `singleType`. |
| `singularName` | sì | Kebab-case. Deve corrispondere al nome del file (`article.json`). |
| `pluralName` | sì | Kebab-case, diverso da `singularName`. |
| `displayName` | sì | Il nome mostrato dal pannello di amministrazione. |
| `description` | no | Mostrata nel pannello di amministrazione. |
| `collectionName` | no | Nome della tabella. Di default il `pluralName` in snake_case. |
| `options.draftAndPublish` | no | Mantiene una bozza e una versione pubblicata di ogni documento. Default `false`. Vedi [Bozza e pubblicazione](/it/concepts/draft-and-publish/). |
| `pluginOptions.i18n.localized` | no | Una versione per lingua. Default `false`. Vedi [Internazionalizzazione](/it/concepts/internationalization/). |
| `attributes` | no | I campi, nell'ordine in cui li restituisce l'API. |
| `validations` | no | Regole tra campi; vedi [sotto](#validazioni-tra-campi). |

Gli schemi sono rigorosi: una chiave sconosciuta, un'opzione che un tipo non supporta, o un
riferimento a un tipo o componente mancante è un errore che nomina il file e il path, e il
server non parte. Esegui `verdin schema check` per validare i file senza avviarlo.

Alcuni nomi sono già presi:

- I nomi degli attributi iniziano con una lettera, seguita da lettere, cifre e underscore,
  al massimo 50 caratteri. Diventano colonne in snake_case (`metaTitle` → `meta_title`).
- `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`,
  `updatedAt`, `createdBy` e `updatedBy` sono riservati sui tipi di contenuto, e `id` dentro
  i componenti.
- `upload`, `uploads`, `auth`, `users` e `connect` non possono essere un `singularName` o un
  `pluralName`: quelle route appartengono all'API.
- Un tipo di contenuto ha al massimo 60 attributi `string`, `email`, `uid` ed
  `enumeration`, per restare entro il limite di dimensione delle righe di MySQL. Usa `text`
  per alcuni di essi.

Modifichi i file nel **Costruttore di tipi di contenuto** dell'admin, disponibile mentre il
server gira con `verdin dev`, oppure a mano. In entrambi i casi, una modifica diventa una
[migrazione dello schema](/it/concepts/schema-migrations/). Il layout dell'editor (ordine dei
campi, larghezze, etichette) non fa parte dello schema: lo configurano gli admin nel
pannello, ed è memorizzato nel database.

## Componenti

Un componente è un gruppo di campi riutilizzabile, come `shared.seo` (un meta title e una
meta description). Il suo UID è `<category>.<name>`, preso dal suo path:
`schema/components/shared/seo.json` è `shared.seo`. Un file di componente ha `displayName`,
`description` e `icon` opzionali, e `attributes`.

Una zona dinamica è una lista che mescola più componenti, come il corpo di un articolo fatto
di blocchi hero e citazione. Entrambi sono memorizzati dentro il documento come JSON; vedi
[Componenti e zone dinamiche](/it/concepts/components-and-dynamic-zones/).

## Attributi

Ogni attributo ha un `type` e opzioni che dipendono da esso. L'elenco completo dei tipi,
delle loro opzioni e dei tipi di colonna per database è nel
[riferimento dei tipi di attributo](/it/reference/attribute-types/).

| Categoria | Tipi |
| --- | --- |
| Testo | `string`, `text`, `richtext` (Markdown), `blocks` (il rich text strutturato di Strapi), `email`, `uid`, `password`, `enumeration` |
| Numeri | `integer`, `biginteger`, `float`, `decimal` |
| Date | `date`, `time`, `datetime` |
| Altri scalari | `boolean`, `json` |
| Collegamenti | `relation` (vedi [Relazioni](/it/concepts/relations/)), `media` (vedi [Media](/it/concepts/media/)) |
| Struttura | `component`, `dynamiczone` |

Opzioni comuni:

| Opzione | Effetto |
| --- | --- |
| `required` | Il valore deve essere impostato quando una versione viene pubblicata (o a ogni scrittura, per i tipi senza bozza e pubblicazione). Le bozze possono essere incomplete. |
| `private` | Mai restituito, filtrato, ordinato o popolato dalla content API. Gli attributi `password` sono sempre privati. |
| `default` | Valore usato quando un nuovo documento omette il campo. Verificato rispetto alle regole dell'attributo stesso. |
| `unique` | Due documenti non possono condividere il valore, per lingua e versione. Disponibile su `string`, `email`, tipi numerici, di data e di orario; `uid` è sempre unico. |
| `configurable` | `false` blocca l'attributo nel costruttore di tipi di contenuto: lì non può essere modificato, rinominato o eliminato. |
| `pluginOptions.i18n.localized` | `false` condivide il valore tra le lingue. |

Ogni colonna di attributo è nullable nel database. Come in Strapi v5, `required` viene
imposto da Verdin in fase di pubblicazione, non da un vincolo `NOT NULL`, quindi aggiungere
un attributo obbligatorio a un tipo che ha già righe è una modifica sicura.

## Validazione

Ogni scrittura viene verificata rispetto allo schema prima che qualcosa raggiunga il
database:

- **Tipi e vincoli**, a ogni scrittura: tipi dei valori, `minLength`/`maxLength`,
  `min`/`max`, `regex`, valori `enum`, il numero di elementi nei componenti ripetibili e
  nelle zone dinamiche, i tipi di componente che una zona dinamica consente, e i tipi di
  file che un campo media accetta. Chiavi sconosciute e campi di sistema nell'input sono
  errori.
- **Campi obbligatori e regole tra campi**, quando una versione viene pubblicata, e a ogni
  scrittura sui tipi senza bozza e pubblicazione. Si applicano anche dentro componenti e
  zone dinamiche.
- **Unicità**, tramite indici unici nel database, così due scritture concorrenti non possono
  riuscire entrambe.

Una verifica fallita risponde `400` con un `ValidationError` il cui `details.errors` elenca
ogni problema con il suo path, come `["seo", "metaTitle"]` o `["blocks", 2, "text"]`. Vedi
[Errori](/it/api/rest/#errori).

### Validazioni tra campi

Un tipo di contenuto può dichiarare regole che confrontano i suoi campi, scritte in
[JSON Logic](https://jsonlogic.com). Questo tipo event richiede che la data di fine segua
quella di inizio, e limita i biglietti venduti al numero di posti:

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

- Una regola non rispettata è un errore di validazione con `message`, su `field` se
  indicato, oppure sul documento (`path: []`).
- Le regole vengono eseguite quando lo è `required`: alla pubblicazione, e a ogni scrittura
  sui tipi senza bozza e pubblicazione. Le bozze possono violarle.
- `var` legge i campi del documento stesso, con path puntati dentro i componenti. Relazioni
  e media non sono disponibili nelle regole.
- I confronti sono numerici quando entrambi i lati sono numeri e testuali quando entrambi
  sono stringhe, quindi date, orari e datetime ISO si confrontano correttamente. Un campo
  vuoto è `null`: proteggi i campi opzionali, come fa la prima regola.
- Operatori consentiti: `var`, `==`, `!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`,
  `and`, `or`, `in`, `if`, `?:`, `+`, `-`, `*`, `/`, `%`, `min`, `max`, `cat`. Un operatore
  sconosciuto, un `field` sconosciuto o un `message` vuoto è un errore dello schema.

Il server verifica le regole; il pannello di amministrazione mostra i loro messaggi sui campi
che nominano quando una pubblicazione fallisce. Strapi non ha un equivalente. I campi
condizionali di Strapi (`conditions`) sono accettati nei file dello schema e conservati, ma
non ancora applicati.
