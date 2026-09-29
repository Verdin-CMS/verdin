---
title: "Relazioni"
description: "I tipi di relazione, come Verdin collega i documenti per documentId, l'ordinamento, le relazioni polimorfiche, e cosa significano oneWay e manyWay dentro i componenti."
sidebar:
  order: 3
---

Una relazione collega documenti di due tipi di contenuto, come un articolo e la sua
categoria. Questa pagina spiega i tipi di relazione, come i collegamenti vengono memorizzati
e risolti, e le regole per scriverli, ordinarli e leggerli. Per la sintassi delle richieste,
vedi l'[API REST](/it/api/rest/#scrittura).

## Tipi

Una relazione è un attributo di `type: "relation"` con un tipo `relation` e un tipo di
contenuto `target`:

| Tipo | Un documento collega | Un target è collegato da | Lato inverso |
| --- | --- | --- | --- |
| `oneWay` | un target | un numero qualsiasi di documenti | nessuno |
| `manyWay` | molti target | un numero qualsiasi di documenti | nessuno |
| `manyToOne` | un target | un numero qualsiasi di documenti | `oneToMany` |
| `oneToMany` | molti target | un documento | `manyToOne` |
| `oneToOne` | un target | un documento | `oneToOne` |
| `manyToMany` | molti target | un numero qualsiasi di documenti | `manyToMany` |

Il blog di esempio collega gli articoli a una categoria (con un lato inverso) e ai tag
(senza):

```json title="schema/content-types/article.json (excerpt)"
"category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
"tags": { "type": "relation", "relation": "manyToMany", "target": "tag" }
```

```json title="schema/content-types/category.json (excerpt)"
"articles": { "type": "relation", "relation": "oneToMany", "target": "article", "mappedBy": "category" }
```

- Il lato con `inversedBy` (o senza nessuna delle due chiavi) è il lato **proprietario**:
  memorizza i collegamenti ed è quello su cui scrivi.
- Il lato con `mappedBy` è il lato **inverso**: legge al contrario i collegamenti del
  proprietario ed è in sola lettura. Scriverci è un errore di validazione che nomina
  l'attributo proprietario.
- I due lati devono concordare: `mappedBy` nomina un attributo del target che punta
  indietro con `inversedBy`, con il tipo inverso corrispondente della tabella.
- `oneWay` e `manyWay` non hanno mai un lato inverso.

Il costruttore di tipi di contenuto crea per te l'attributo inverso sul target.

## Collegate per documento, non per riga

Un documento ha più righe: una bozza e una versione pubblicata, e una di ciascuna per
lingua. Verdin memorizza una relazione come un collegamento dalla **riga** di origine al
**documento** di destinazione (il suo `documentId`), in una tabella di link chiamata
`{table}_{field}_lnk`. La riga di destinazione viene scelta quando la relazione viene letta:

- Un articolo pubblicato vede la versione pubblicata della sua categoria; la sua bozza vede
  la bozza della categoria. I tipi senza bozza e pubblicazione hanno una sola versione, che
  vedono tutti i lettori.
- Quando anche il target è localizzato, le letture lo risolvono nella stessa lingua. Un tipo
  di destinazione non localizzato è condiviso da tutte le lingue.
- Annullare la pubblicazione di una categoria la nasconde dagli articoli pubblicati senza
  toccare alcun collegamento; pubblicarla di nuovo la fa ricomparire.
- Pubblicare un articolo copia sulla versione pubblicata solo i suoi collegamenti.

Strapi invece collega gli id delle righe, quindi deve riscrivere i collegamenti ogni volta
che una bozza viene pubblicata. Verdin non lo fa mai, e così la pubblicazione resta una
singola copia della riga bozza.

L'integrità è garantita da Verdin anziché da foreign key: collegare un documento che non
esiste è un errore di validazione, ed eliminare un documento rimuove, nella stessa
transazione, i collegamenti che puntano a esso.

### Un documento per target

Per `oneToOne` e `oneToMany`, un target appartiene al massimo a un documento di origine.
Collegare un target che un altro documento possiede lo **sposta**: il collegamento dell'altro
documento viene rimosso nella stessa scrittura. È il comportamento di Strapi. Viene imposto
per versione: una bozza e la sua versione pubblicata possono avere lo stesso target.

## Scrittura

Sul lato proprietario, `data` accetta un `documentId`, una lista di essi, o un oggetto che
descrive una modifica:

| Input | Effetto |
| --- | --- |
| `"k2m…"` o `{ "documentId": "k2m…" }` | Collega un target (relazioni to-one). |
| `["k2m…", "p9x…"]` | Sostituisce tutti i collegamenti, in questo ordine. |
| `null` o `[]` | Rimuove tutti i collegamenti. |
| `{ "set": ["k2m…"] }` | Sostituisce tutti i collegamenti. |
| `{ "connect": [...], "disconnect": [...] }` | Aggiunge e rimuove collegamenti, mantenendo gli altri. |

Collegare un nuovo target a una relazione to-one sostituisce il precedente. `set` non può
essere combinato con `connect` o `disconnect`.

Nel pannello di amministrazione, un campo relazione elenca le voci collegate. **Collega una
voce** (o **Collega voci** per le relazioni to-many) apre una finestra che cerca tra le voci
del tipo di destinazione, nei loro campi di testo, e nella lingua della voce quando il target
è localizzato. Scegli una voce, oppure spuntane diverse e aggiungile; le voci già collegate
sono contrassegnate.

## Ordinamento

Le relazioni to-many mantengono l'ordine dei loro collegamenti. Una lista o `set` memorizza
l'ordine che invii. Gli elementi di `connect` possono indicare dove vanno:

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

`position` è `{ "before": documentId }`, `{ "after": documentId }`, `{ "start": true }` o
`{ "end": true }`. Le posizioni vengono rinumerate a ogni scrittura. Le letture restituiscono
i documenti collegati nell'ordine dei collegamenti, a meno che il populate non chieda un
`sort`.

## Lettura

Le relazioni vengono restituite solo quando le popoli:

```http
GET /api/articles?populate[category][fields][0]=name&populate[tags][sort]=label:asc
```

Una relazione to-one è un oggetto o `null`; una relazione to-many è un array. Ogni relazione
popolata può avere i propri `fields`, `filters`, `sort`, `populate` e `count`, fino a cinque
livelli di profondità. Ogni livello è una query in batch per relazione (`WHERE … IN (…)`),
non un join, quindi i populate profondi non moltiplicano le righe. Vengono restituiti al
massimo 1.000 documenti collegati per documento e relazione; `count` dà il numero esatto.

Puoi filtrare attraverso le relazioni (`filters[category][name][$eq]=News`), su entrambi i
lati, e ordinare per un campo di una relazione to-one (`sort=category.name:asc`). Popolare,
filtrare o ordinare attraverso una relazione verso un tipo che il chiamante non può leggere
viene rifiutato (`populate=*` la salta), così le relazioni non rivelano mai contenuti che i
[permessi](/it/concepts/permissions/) del chiamante nascondono.

## Relazioni dentro i componenti

Un [componente](/it/concepts/components-and-dynamic-zones/) può contenere relazioni, ma solo
`oneWay` e `manyWay`:

```json title="schema/components/shared/related.json"
{
  "displayName": "Related",
  "attributes": {
    "label": { "type": "string" },
    "articles": { "type": "relation", "relation": "manyWay", "target": "article" }
  }
}
```

Il JSON del componente memorizza direttamente i `documentId`: una stringa per `oneWay`, un
array per `manyWay`. Ecco perché lì gli altri tipi non sono consentiti:

- Un lato inverso dovrebbe cercare nel JSON di ogni documento per sapere chi lo collega.
- Neanche "un documento per target" (`oneToOne`, `oneToMany`) si può imporre senza una
  ricerca del genere.

Dentro i componenti, l'ordine di una lista `manyWay` è l'ordine dell'array. I riferimenti
vengono verificati in scrittura e risolti quando il componente viene popolato, nello stato e
nella lingua del documento; i target che non esistono più vengono omessi. Non si possono
usare nei filtri.

## Relazioni polimorfiche

`morphToOne` e `morphToMany` collegano documenti di qualsiasi tipo di contenuto. I loro
collegamenti memorizzano il tipo del target accanto al suo `documentId`, e le scritture
indicano entrambi:

```json
{ "data": { "related": [{ "__type": "api::article", "documentId": "k2m…" }, { "__type": "api::page", "documentId": "p9x…" }] } }
```

Gli elementi popolati sono i documenti di destinazione con il loro `__type`, letti nello
stato e nella lingua della richiesta. I lati inversi `morphOne` e `morphMany` indicano il
tipo proprietario (`target`) e il suo attributo (`morphBy`), e sono in sola lettura. Le
relazioni polimorfiche non si possono filtrare né ordinare, e non possono stare dentro i
componenti.
