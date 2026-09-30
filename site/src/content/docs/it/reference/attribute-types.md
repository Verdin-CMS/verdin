---
title: Riferimento dei tipi di attributo
description: Ogni tipo di attributo di un file dello schema di Verdin, con le sue opzioni, le validazioni, la memorizzazione nel database e la rappresentazione nell'API.
sidebar:
  order: 4
  label: Tipi di attributo
---

<!-- Written from crates/verdin-schema (convert.rs, validate.rs, model.rs),
crates/verdin-migrate/src/derive.rs and sql.rs (storage), and crates/verdin-content
(input.rs, output.rs, blocks.rs) (API). -->

Gli attributi sono i campi di un tipo di contenuto o di un componente, dichiarati sotto
`attributes` nel suo file dello schema. Questa pagina elenca ogni `type`, le opzioni che
accetta, come Verdin lo valida e lo memorizza, e come appare nell'API. Il formato è quello di
Strapi v5; le differenze sono elencate [alla fine](#differenze-rispetto-a-strapi).

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

I file dello schema sono rigorosi: una chiave sconosciuta, o un'opzione che il tipo non
accetta, è un errore che `verdin schema check` segnala con il suo path
(`attributes.title.maxLength`).

## Opzioni accettate da ogni attributo

| Opzione | Default | Descrizione |
| --- | --- | --- |
| `type` | obbligatoria | Uno dei tipi qui sotto. |
| `required` | `false` | Deve essere presente un valore. Verificato quando una voce viene pubblicata (le bozze possono essere incomplete), e a ogni scrittura di un tipo senza bozza e pubblicazione. Si applica anche dentro componenti e zone dinamiche. |
| `private` | `false` | Mai restituito dalla content API, e non utilizzabile in `filters` o `sort`. Gli attributi `password` sono sempre privati. |
| `configurable` | `true` | Il flag di Strapi per il costruttore dell'admin; mantenuto così come scritto. |
| `pluginOptions.i18n.localized` | `true` | In un tipo di contenuto localizzato, `false` condivide il valore tra le lingue invece di avere un valore per lingua. |
| `customField` | non impostato | `plugin::<plugin>.<field>` (o `global::<field>`): l'admin modifica l'attributo con il campo personalizzato di un plugin. Il `type` è il modo in cui viene memorizzato il valore. Vedi [Plugin](/it/extending/plugins/). |
| `conditions` | non impostato | I campi condizionali di Strapi (`{ "visible": <JSON Logic> }`). L'editor nasconde il campo finché la regola è falsa, e il server non richiede un campo nascosto. |
| `default` | non impostato | Valore delle nuove voci quando la scrittura omette l'attributo. Deve essere valido per il tipo. Non tutti i tipi lo accettano (vedi ogni tipo). |

I nomi degli attributi iniziano con una lettera, seguita da lettere, cifre e `_`, al massimo
50 caratteri. Sui tipi di contenuto, `id`, `documentId`, `locale`, `publicationState`,
`publishedAt`, `createdAt`, `updatedAt`, `createdBy` e `updatedBy` sono riservati; sui
componenti, `id`. Due nomi che corrispondono alla stessa colonna (`metaTitle` e
`meta_title`) sono un errore.

### Dove vengono memorizzati i valori

Ogni attributo di un tipo di contenuto è una colonna della tabella del tipo
(`collectionName`, o il nome plurale), con il nome in `snake_case`. Relazioni e media vivono
invece in tabelle di link. Una bozza e la sua versione pubblicata sono due righe, una per
lingua nei tipi localizzati.

Tipi di colonna per database:

| Colonna | PostgreSQL | MySQL e MariaDB | SQLite |
| --- | --- | --- | --- |
| varchar | `varchar(255)` | `varchar(255)` | `text` |
| text | `text` | `longtext` | `text` |
| integer | `integer` | `int` | `integer` |
| bigint | `bigint` | `bigint` | `integer` |
| double | `double precision` | `double` | `real` |
| decimal | `numeric(p,s)` | `decimal(p,s)` | `text` (esatto) |
| boolean | `boolean` | `tinyint(1)` | `integer` |
| date | `date` | `date` | `text` |
| time | `time(3)` | `time(3)` | `text` |
| datetime | `timestamptz(3)` | `datetime(3)` | `text` |
| json | `jsonb` | `json` | `text` |

Un tipo di contenuto può avere al massimo 60 attributi `string`, `email`, `uid` ed
`enumeration` (il limite di dimensione delle righe di MySQL); usa `text` per gli altri.

### `unique`

I tipi che accettano `unique: true` ricevono un indice unico su
`(column, locale, publication_state)`: due voci pubblicate, o due bozze, nella stessa lingua
non possono condividere un valore, mentre una bozza e la sua versione pubblicata sì. Una
scrittura che lo viola fallisce con un errore di validazione sull'attributo. Dentro i
componenti, `unique` viene accettato ma non imposto (i valori dei componenti sono memorizzati
come JSON).

## Testo

### `string`

Una sola riga di testo.

| Opzione | Descrizione |
| --- | --- |
| `minLength`, `maxLength` | Limiti di lunghezza in caratteri. `maxLength` è al massimo 255. |
| `regex` | Un pattern a cui il valore deve corrispondere. Sintassi in stile JavaScript, look-around e backreference compresi. |
| `unique` | Vedi [`unique`](#unique). |
| `default` | Una stringa entro i limiti che corrisponde a `regex`. |

Memorizzato come `varchar(255)`. API: una stringa.

### `text`

Testo semplice più lungo (una textarea nell'admin).

| Opzione | Descrizione |
| --- | --- |
| `minLength`, `maxLength` | Limiti di lunghezza, senza limite superiore. |
| `default` | Una stringa entro i limiti. |

Memorizzato come `text` (`longtext` su MySQL). API: una stringa.

### `richtext`

Testo Markdown. Stesse opzioni, memorizzazione e API di `text`; l'admin lo modifica con
l'editor Markdown.

### `blocks`

Rich text come JSON blocks di Strapi: una lista di blocchi `paragraph`, `heading` (`level`
da 1 a 6), `list` (`format` `ordered` o `unordered`, con figli `list-item`, annidati fino a 8
livelli), `quote`, `code` (`language` opzionale) e `image`. I figli inline sono nodi `text`,
con le marcature `bold`, `italic`, `underline`, `strikethrough` e `code`, e nodi `link`. Al
massimo 10.000 blocchi.

Nessuna opzione, nessun `default`. Memorizzato come JSON. API: la lista dei blocchi, così
come scritta.

```json
[
  { "type": "heading", "level": 2, "children": [{ "type": "text", "text": "Hello" }] },
  { "type": "paragraph", "children": [{ "type": "text", "text": "bold", "bold": true }] }
]
```

### `email`

Un indirizzo email (`name@domain.tld`, senza spazi).

| Opzione | Descrizione |
| --- | --- |
| `minLength`, `maxLength` | Limiti di lunghezza; `maxLength` al massimo 255. |
| `unique` | Vedi [`unique`](#unique). |
| `default` | Un indirizzo email. |

Memorizzato come `varchar(255)`. API: una stringa.

### `password`

Un segreto, sottoposto a hash in scrittura con Argon2id.

| Opzione | Descrizione |
| --- | --- |
| `minLength`, `maxLength` | Limiti di lunghezza della password come viene inviata. |

Nessun `default`. Sempre privato: mai restituito, filtrato o ordinato. Non consentito dentro i
componenti. Memorizzato come `varchar(255)` (l'hash). Gli import mantengono così come sono gli
hash bcrypt e Argon2 esistenti, così gli account importati possono ancora accedere.

### `uid`

Un identificatore per gli URL, come uno slug. L'admin lo genera da `targetField`.

| Opzione | Descrizione |
| --- | --- |
| `targetField` | Un attributo `string` o `text` dello stesso tipo da cui generare il valore. |
| `minLength`, `maxLength` | Limiti di lunghezza; `maxLength` al massimo 255. |
| `regex` | Il pattern a cui devono corrispondere i valori; senza, `^[A-Za-z0-9\-_.~]*$`. |
| `default` | Un valore valido. |

Sempre unico (vedi [`unique`](#unique)). Memorizzato come `varchar(255)`. API: una stringa.

### `enumeration`

Un valore scelto da una lista fissa.

| Opzione | Descrizione |
| --- | --- |
| `enum` | I valori: almeno uno, ciascuno da 1 a 255 caratteri, senza duplicati. |
| `default` | Uno dei valori. |

Memorizzato come `varchar(255)`. API: una stringa. Le scritture di qualsiasi altro valore
falliscono.

## Numeri

### `integer`

Un intero a 32 bit (da −2.147.483.648 a 2.147.483.647).

| Opzione | Descrizione |
| --- | --- |
| `min`, `max` | Limiti (interi). |
| `unique` | Vedi [`unique`](#unique). |
| `default` | Un intero entro i limiti. |

Memorizzato come `integer`. API: un numero. Le scritture accettano numeri e stringhe intere.

### `biginteger`

Un intero a 64 bit. Stesse opzioni di `integer`.

Memorizzato come `bigint`. API: una stringa (`"9007199254740993"`), come in Strapi, perché i
numeri JavaScript perdono precisione oltre 2⁵³. Le scritture accettano stringhe e numeri.

### `float`

Un numero in virgola mobile a doppia precisione. Stesse opzioni di `integer`, con limiti
numerici.

Memorizzato come `double precision` (`double`, `real`). API: un numero.

### `decimal`

Un numero decimale esatto.

| Opzione | Default | Descrizione |
| --- | --- | --- |
| `precision` | `10` | Cifre totali, da 1 a 38. |
| `scale` | `2` | Cifre dopo la virgola, al massimo `precision`. |
| `min`, `max` | | Limiti. |
| `unique` | | Vedi [`unique`](#unique). |
| `default` | | Un numero entro i limiti. |

I valori vengono arrotondati a `scale` cifre (arrotondamento half away from zero, come fanno
i database), e rifiutati quando hanno più di `precision - scale` cifre prima della virgola.
Le scritture accettano numeri e stringhe numeriche. Memorizzato come
`numeric(precision,scale)` (`text` su SQLite, così nulla viene arrotondato). API: un numero, come lo restituisce Strapi. I valori interi
sono interi (`25`, non `25.0`) e gli altri sono il float più corto che si rilegge identico
(`12.5`). Con [`[api].decimal_as_string`](/it/reference/configuration/) l'API restituisce
invece una stringa esatta.

## Date e booleani

### `boolean`

`true` o `false`. Accetta `default`. Memorizzato come `boolean` (`tinyint(1)`, `integer`).
API: un booleano.

### `date`

Una data di calendario, `YYYY-MM-DD`. Accetta `unique` e `default`. Memorizzato come `date`.
API: `"2026-09-29"`.

### `time`

Un'ora del giorno, `HH:MM`, `HH:MM:SS` o `HH:MM:SS.mmm`. Accetta `unique` e `default`.
Memorizzato con precisione al millisecondo. API: `"14:30:00.000"`.

### `datetime`

Un istante: un timestamp ISO 8601 con un fuso (`Z` o `+02:00`). Accetta `unique` e
`default`. Memorizzato in UTC con precisione al millisecondo. API:
`"2026-09-29T12:30:00.000Z"`.

## `json`

Qualsiasi valore JSON. Accetta `default` (qualsiasi JSON). Memorizzato come `jsonb` (`json`,
`text`). API: il valore così come scritto. In `filters`, gli attributi JSON supportano solo
`$null` e `$notNull`, e non si possono usare per ordinare.

## Media

### `media`

File della libreria media.

| Opzione | Default | Descrizione |
| --- | --- | --- |
| `multiple` | `false` | Contiene una lista di file invece di uno solo. |
| `allowedTypes` | qualsiasi | Tipi di file: `images`, `videos`, `audios`, `files` (tutto il resto). |

Nessun `default`. Memorizzato in una tabella di link `{table}_{attribute}_mda`, in ordine. Le
scritture accettano id di file: `12`, `{ "id": 12 }`, una lista di essi, o `null`. API: solo
con `populate`; un oggetto file (`url`, `mime`, `width`, `formats`…, come in Strapi), una
lista di essi, o `null`. Vedi [Media](/it/concepts/media/).

## Relazioni

### `relation`

Collegamenti a documenti di un altro tipo di contenuto.

| Opzione | Descrizione |
| --- | --- |
| `relation` | `oneToOne`, `oneToMany`, `manyToOne`, `manyToMany`, `oneWay`, `manyWay`, o un tipo polimorfico (sotto). |
| `target` | Il tipo di contenuto di destinazione: `article`, `api::article` o `api::article.article`. |
| `inversedBy` | Sul lato proprietario di una relazione bidirezionale: l'attributo del target che la rispecchia. |
| `mappedBy` | Sull'altro lato: l'attributo proprietario del target. |

I due lati di una relazione bidirezionale devono concordare: `oneToMany` rispecchia
`manyToOne`, `oneToOne` e `manyToMany` rispecchiano sé stessi, e il lato `mappedBy` nomina un
attributo il cui `inversedBy` punta indietro. `oneWay` e `manyWay` non hanno un altro lato.

I collegamenti sono memorizzati in `{table}_{attribute}_lnk` sul lato proprietario (il lato
senza `mappedBy`), puntando al `documentId` del target, in ordine. Le scritture accettano
`documentId`:

| Scrittura | Significato |
| --- | --- |
| `"d8f3…"`, `{ "documentId": "d8f3…" }`, una lista di essi | Sostituisce i collegamenti. |
| `null` o `[]` | Rimuove tutti i collegamenti. |
| `{ "set": [...] }` | Sostituisce i collegamenti. |
| `{ "connect": [...], "disconnect": [...] }` | Aggiunge e rimuove collegamenti. Un elemento di `connect` può avere `position`: `{ "before": id }`, `{ "after": id }`, `{ "start": true }` o `{ "end": true }`. |

API: solo con `populate`, come documenti collegati (al massimo 1.000 per voce e relazione), o
`{ "count": n }` con `populate[tags][count]=true`. Vedi
[Relazioni](/it/concepts/relations/).

Dentro i componenti sono consentite solo `oneWay` e `manyWay`; il componente memorizza i
`documentId`.

### Relazioni polimorfiche

`relation` accetta anche i tipi polimorfici, che collegano documenti di qualsiasi tipo di
contenuto:

| `relation` | Opzioni | Descrizione |
| --- | --- | --- |
| `morphToOne` | nessuna | Collega un documento di qualsiasi tipo. |
| `morphToMany` | nessuna | Collega documenti di qualsiasi tipo. |
| `morphOne` | `target`, `morphBy` | Lato inverso: legge i collegamenti dell'attributo `morphToOne` o `morphToMany` `morphBy` di `target`. |
| `morphMany` | `target`, `morphBy` | Lo stesso, per molti. |

I proprietari memorizzano coppie `(type, documentId)` in `{table}_{attribute}_mph`. Le
scritture accettano elementi `{ "__type": "api::article", "documentId": "…" }` (uno, una
lista, `null` o `{ "set": [...] }`). Gli elementi popolati portano il loro tipo in `__type`.
Non consentite dentro i componenti.

## Componenti e zone dinamiche

### `component`

Un gruppo di campi definito in `schema/components/<category>/<name>.json`.

| Opzione | Default | Descrizione |
| --- | --- | --- |
| `component` | obbligatoria | L'uid del componente, `category.name` (`shared.seo`). |
| `repeatable` | `false` | Contiene una lista di elementi invece di uno solo. |
| `min`, `max` | | Numero di elementi; solo con `repeatable`. |

Nessun `default`: i nuovi elementi ricevono i default dei propri attributi. Memorizzato come
JSON nella riga della voce, ogni elemento con un `id`. Le scritture accettano l'oggetto
dell'elemento (o una lista), con `id` per mantenere un elemento esistente. API: solo con
`populate`, l'elemento o la lista per intero. In `filters`, puoi filtrare sui campi di un
componente (`filters[seo][metaTitle][$eq]=…`). Vedi
[Componenti e zone dinamiche](/it/concepts/components-and-dynamic-zones/).

### `dynamiczone`

Una lista di elementi, ciascuno uno tra più componenti.

| Opzione | Descrizione |
| --- | --- |
| `components` | Gli uid dei componenti consentiti: almeno uno, senza duplicati. |
| `min`, `max` | Numero di elementi. |

Ogni elemento porta `__component` con il suo uid. Memorizzato come JSON nella riga della
voce. API: solo con `populate`, la lista intera. Filtra per componente con
`filters[blocks][__component][$eq]=blocks.hero`. Le zone dinamiche non possono essere
annidate dentro i componenti.

## Validazioni tra campi

Oltre alle opzioni per attributo, un tipo di contenuto può dichiarare regole su più campi in
`validations`, verificate ogni volta che lo è `required`:

```json
"validations": [
  {
    "rule": { "<=": [{ "var": "startDate" }, { "var": "endDate" }] },
    "message": "The end date must be after the start date",
    "field": "endDate"
  }
]
```

`rule` è un'espressione JSON Logic sulla voce che deve essere vera. Può usare `var`, `==`,
`!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`, `and`, `or`, `in`, `if`, `?:`, `+`, `-`,
`*`, `/`, `%`, `min`, `max` e `cat`. `message` viene segnalato su `field` (un attributo del
tipo) o sulla voce. È un'aggiunta di Verdin; Strapi non ha un equivalente.

## Differenze rispetto a Strapi

- **I componenti sono memorizzati come JSON** nella riga della voce, non in tabelle dei
  componenti con tabelle di join. Le letture non richiedono join; di conseguenza, attributi
  `password`, relazioni polimorfiche e relazioni bidirezionali non possono stare dentro i
  componenti, e lì `unique` non viene imposto.
- **I componenti popolati arrivano per intero.** `populate` su un componente o una zona
  dinamica restituisce tutti i suoi campi; non puoi scegliere i campi annidati come in Strapi.
- **File dello schema rigorosi.** Le chiavi sconosciute e le opzioni che un tipo non accetta
  sono errori, mentre Strapi le ignora. In `pluginOptions` viene letto solo
  `i18n.localized`; il resto viene ignorato.
- **`string`, `email` e `uid` sono limitati a 255 caratteri**, la dimensione della colonna,
  invece di fallire nel database.
- **`conditions`** (campi condizionali) funzionano come in Strapi 5.17: i campi nascosti non sono obbligatori.
- **`validations`** sono proprie di Verdin.
- Il resto corrisponde a Strapi v5: i nomi dei tipi, le loro opzioni, i valori `biginteger`
  come stringhe, le scritture delle relazioni con `connect`, `disconnect`, `set` e
  `position`, e il formato blocks.
