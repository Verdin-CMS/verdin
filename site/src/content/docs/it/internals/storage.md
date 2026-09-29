---
title: Storage
description: Come Verdin organizza i contenuti nel database, dai nomi delle tabelle e dalle colonne di sistema alle righe bozza e pubblicate, ai collegamenti delle relazioni, al JSON dei componenti e alle tabelle della piattaforma.
sidebar:
  order: 2
---

Questa pagina descrive le tabelle che Verdin ricava dal tuo schema e come viene memorizzato ogni tipo di attributo. Leggila prima di modificare qualsiasi cosa in `crates/verdin-migrate/src/derive.rs` o nel Document Service, o quando devi interrogare direttamente il database. Per cosa accetta ogni tipo di attributo, vedi [tipi di attributo](/it/reference/attribute-types/).

Non scrivi mai queste tabelle a mano: il [motore di migrazione](/it/internals/migrations/) le crea e le fa evolvere a partire dallo schema.

## Convenzioni di naming

| Oggetto | Nome |
|---|---|
| Tabella di un tipo di contenuto | `collectionName`, che di default è `pluralName` con i trattini trasformati in underscore (`blog-posts` → `blog_posts`) |
| Colonna | Il nome dell'attributo in snake case (`metaTitle` → `meta_title`) |
| Collegamenti delle relazioni | `{table}_{column}_lnk` |
| Collegamenti delle relazioni polimorfiche | `{table}_{column}_mph` |
| Collegamenti dei media | `{table}_{column}_mda` |
| Indice | `{table}_{part}_uq` per gli indici unici, `{table}_{part}_idx` per gli altri |
| Tabella della piattaforma | Prefisso `vd_` (`vd_admin_users`, `vd_schema_snapshots`…) |

Regole imposte dal validatore dello schema (`crates/verdin-schema/src/naming.rs` e `validate.rs`):

- Un `collectionName` corrisponde a `^[a-z][a-z0-9_]*$`, ha al massimo 50 caratteri, e non può iniziare con `vd_`.
- `singularName` e `pluralName` sono in kebab case (`^[a-z][a-z0-9-]*$`, senza trattini iniziali, finali o doppi). `upload`, `uploads`, `auth`, `users` e `connect` sono riservati perché la content API usa quelle route.
- I nomi degli attributi iniziano con una lettera e continuano con lettere, cifre o underscore (la regola di Strapi), e hanno al massimo 50 caratteri.
- Sui tipi di contenuto, `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`, `updatedAt`, `createdBy` e `updatedBy` sono riservati, e lo è anche qualsiasi nome il cui snake case collida con essi. Sui componenti, `id` è riservato.
- Gli identificatori generati sono limitati a 60 caratteri (PostgreSQL ne consente 63, MySQL 64). Un nome più lungo viene troncato e riceve un hash di 8 caratteri del nome completo, così nomi lunghi distinti restano distinti e il risultato è deterministico.

Ogni identificatore viene quotato nell'SQL generato, quindi le parole riservate SQL sono nomi di attributo validi.

## Colonne di sistema

Ogni tabella di un tipo di contenuto inizia con queste colonne:

```sql
id                 BIGINT       primary key, auto-increment
document_id        CHAR(26)     NOT NULL           -- ULID, shared by every version of a document
locale             VARCHAR(16)  NOT NULL DEFAULT '' -- '' for types that are not localized
publication_state  SMALLINT     NOT NULL           -- 0 = draft, 1 = published
published_at       <datetime>   NULL
created_at         <datetime>   NOT NULL
updated_at         <datetime>   NOT NULL
created_by_id      BIGINT       NULL               -- vd_admin_users.id
updated_by_id      BIGINT       NULL
UNIQUE (document_id, locale, publication_state)
INDEX  (publication_state, locale)
```

- `document_id` è un ULID minuscolo generato alla creazione. Resta lo stesso tra la bozza, la versione pubblicata e ogni lingua.
- I tipi non localizzati usano `locale = ''` invece di `NULL`, perché su nessun motore i NULL collidono negli indici unici, il che romperebbe il vincolo `(document_id, locale, publication_state)`.
- La colonna di stato è `publication_state`, non `state`, perché `state` è un nome di attributo comune.

Seguono le colonne degli attributi, una per attributo scalare. **Ogni colonna di attributo è nullable.** Come in Strapi v5, le bozze possono essere incomplete, quindi `required` viene verificato quando una versione viene pubblicata (o a ogni scrittura sui tipi senza bozza e pubblicazione), non dal database. Questo rende anche l'aggiunta di un attributo obbligatorio una migrazione sicura.

Gli attributi `unique`, e ogni `uid`, ricevono un indice unico su `(column, locale, publication_state)`. Una bozza e la sua versione pubblicata possono condividere un valore, due documenti pubblicati no, e il database lo impone senza race condition. Una violazione viene segnalata come `ValidationError` su quel campo.

## Bozza e pubblicazione

Verdin segue il modello di Strapi v5. Vedi [bozza e pubblicazione](/it/concepts/draft-and-publish/) per il punto di vista dell'utente; questo è ciò che succede nella tabella.

- Un documento ha al massimo una riga bozza (`publication_state = 0`) e una riga pubblicata (`publication_state = 1`) per lingua.
- Le scritture dal pannello di amministrazione puntano alla riga bozza.
- **Pubblica** verifica gli attributi `required` e le regole di validazione sulla bozza, poi copia i valori degli attributi della bozza sulla riga pubblicata (aggiornandola, o inserendola la prima volta), in una sola transazione. I collegamenti di relazioni e media della bozza vengono copiati insieme.
- **Annulla pubblicazione** elimina la riga pubblicata. I suoi collegamenti se ne vanno con lei tramite `ON DELETE CASCADE`.
- **Scarta la bozza** sovrascrive la bozza con i valori e i collegamenti della riga pubblicata.
- I tipi di contenuto senza bozza e pubblicazione hanno sempre e solo una riga pubblicata.
- Per i tipi localizzati, gli attributi non localizzati sono condivisi: pubblicare una lingua li copia sulle righe pubblicate delle altre lingue.

## Relazioni: collegate per document id

**Questa è la differenza principale rispetto allo storage di Strapi.** Strapi collega le righe per id di riga e deve riscrivere i collegamenti quando pubblichi. Verdin memorizza una relazione come *riga di origine → documento di destinazione*:

```sql
-- articles_category_lnk
id                  BIGINT   primary key, auto-increment
source_id           BIGINT   NOT NULL REFERENCES articles(id) ON DELETE CASCADE
target_document_id  CHAR(26) NOT NULL
position            DOUBLE   NOT NULL   -- 1..n, rewritten on every write
UNIQUE (source_id, target_document_id)
UNIQUE (source_id)                      -- to-one kinds only
INDEX  (target_document_id)
```

- La riga di destinazione viene scelta in lettura, nella versione letta: un articolo pubblicato vede categorie pubblicate, una bozza vede bozze. Se la pubblicazione di una categoria viene annullata, questa scompare dagli articoli pubblicati senza che nessun collegamento venga toccato.
- La pubblicazione copia solo i collegamenti della riga di origine stessa.
- Solo il lato **proprietario** (l'attributo con `inversedBy`, o una relazione one-way) ha una tabella di link. Il lato inverso (`mappedBy`) legge la stessa tabella al contrario, ed è in sola lettura: scriverci è un errore di validazione che nomina l'attributo proprietario.
- "Al massimo un target" (`oneToOne`, `manyToOne`, `oneWay`) è l'indice unico su `source_id`. "Un target appartiene a un solo documento di origine" (`oneToOne`, `oneToMany`) non può essere un indice, perché una bozza e la sua versione pubblicata condividono legittimamente i target. Il Document Service lo impone *spostando* il target: collegarlo rimuove i collegamenti che altri documenti hanno verso di esso nello stesso stato, che è il comportamento di Strapi.
- Non c'è una foreign key su `target_document_id`, perché `document_id` non è unico nella tabella di destinazione. Il Document Service rifiuta i collegamenti a documenti che non esistono e, quando viene eliminata l'ultima versione di un documento, rimuove nella stessa transazione i collegamenti che puntano a esso.
- Le righe di link mantengono una primary key `id`, così le tabelle di link appaiono come qualsiasi altra tabella al motore di migrazione e alle ricostruzioni delle tabelle SQLite.
- Rinominare una tabella rinomina con lei le sue tabelle di link. Le migrazioni girano con i `foreign_keys` di SQLite disattivati, così ricostruire una tabella non si propaga a cascata sulle sue tabelle di link.

**Le relazioni polimorfiche** (`morphToOne`, `morphToMany`) collegano documenti di qualsiasi tipo di contenuto. I loro collegamenti vivono in `{table}_{column}_mph` con `source_id`, `target_type` (l'uid del target), `target_document_id` e `position`, un unique `(source_id, target_type, target_document_id)`, e per `morphToOne` un `source_id` unico. I lati inversi (`morphOne`, `morphMany`) non hanno tabella: leggono i collegamenti del proprietario che puntano a loro, e sono in sola lettura. Eliminare un documento rimuove i collegamenti polimorfici verso di esso. Vedi [relazioni](/it/concepts/relations/) per cosa puoi e non puoi fare con esse.

## Componenti e zone dinamiche: una colonna JSON

Un attributo componente o una zona dinamica è **una colonna JSON** sulla riga del documento (`jsonb` su PostgreSQL, `json` su MySQL e MariaDB, `text` su SQLite). Strapi memorizza ogni componente in una tabella propria con tabelle di join polimorfiche; una colonna evita quei join e rende pubblicazione e cronologia una semplice copia.

```json
// "seo" column (a single component)
{ "id": 1, "metaTitle": "…", "metaDescription": "…" }

// "blocks" column (a dynamic zone)
[
  { "id": 1, "__component": "blocks.hero", "title": "…" },
  { "id": 2, "__component": "blocks.quote", "text": "…", "author": "…" }
]
```

- Ogni elemento di un componente ha un `id` intero, unico all'interno del suo attributo. I nuovi elementi ricevono il prossimo numero libero.
- I dati vengono validati rispetto allo schema del componente a ogni scrittura.
- Pubblicazione e scarto copiano il JSON così com'è.
- **Relazioni e media dentro i componenti** sono memorizzati nel JSON stesso: `documentId` per le relazioni (lì sono consentite solo `oneWay` e `manyWay`) e id di file per i media. Vengono verificati in scrittura e risolti con query in batch quando il componente viene popolato. Relazioni polimorfiche e attributi `password` non possono stare dentro i componenti.
- **Filtrare** richiede funzioni JSON specifiche per dialetto. I campi scalari dei componenti singoli vengono letti tramite un path JSON (`#>>` su PostgreSQL, `JSON_VALUE` su MySQL e MariaDB, `json_extract` su SQLite). I componenti ripetibili usano `EXISTS` sugli elementi dell'array (`jsonb_array_elements`, `JSON_TABLE`, `json_each`). Le zone dinamiche si possono filtrare solo per `__component`, perché i loro elementi hanno campi diversi.

Vedi [componenti e zone dinamiche](/it/concepts/components-and-dynamic-zones/) per il lato della modellazione.

## Tabelle della piattaforma

Le tabelle della piattaforma fanno parte di ogni modello derivato, quindi il motore di migrazione le crea e le fa evolvere esattamente come le tabelle dei contenuti; compaiono come passaggi sicuri in `verdin migrate plan`. Sono definite in `crates/verdin-migrate/src/system.rs`.

| Area | Tabelle |
|---|---|
| Migrazioni | `vd_schema_snapshots`, `vd_migrations_journal` (gestite dal motore di migrazione, create al primo uso) |
| Admin | `vd_admin_users`, `vd_admin_roles`, `vd_admin_user_roles`, `vd_admin_permissions`, `vd_sessions` (refresh token), `vd_admin_tokens` (link di invito e di reimpostazione), `vd_admin_two_factor`, `vd_admin_passkeys`, `vd_spent_challenges` |
| Accesso alla content API | `vd_api_tokens`, `vd_api_token_permissions`, `vd_public_permissions` |
| Utenti finali | `vd_users`, `vd_user_roles`, `vd_user_role_permissions`, `vd_end_user_sessions` |
| Istanza | `vd_settings` (interruttori delle funzionalità, layout delle viste di modifica, marcatori di aggiornamenti una tantum), `vd_locales` |
| Media | `vd_files`, `vd_folders` |
| Flusso dei contenuti | `vd_history_versions`, `vd_releases`, `vd_release_actions`, `vd_workflows`, `vd_workflow_stages`, `vd_document_stages` |
| Collaborazione | `vd_comments`, `vd_tasks`, `vd_document_views`, `vd_document_votes`, `vd_polls`, `vd_poll_votes` |
| Integrazioni | `vd_webhooks`, `vd_webhook_deliveries`, `vd_deploy_targets`, `vd_deployments`, `vd_plugin_kv`, `vd_audit_logs` |
| Funzionalità per il sito | `vd_redirects`, `vd_menus`, `vd_forms`, `vd_form_submissions` |

## Tabelle dei media

I file sono righe di `vd_files` nella forma di Strapi (`name`, `alternative_text`, `caption`, `width`, `height`, `formats`, `hash`, `ext`, `mime`, `size`, `url`, `provider`…), più `focal_point`, `folder_id` e `folder_path`. Le cartelle (`vd_folders`) mantengono il `path` di `path_id` di Strapi, come `/1/4`.

Un attributo media è una tabella di link `{table}_{column}_mda` con `source_id` (la riga del contenuto), `file_id` (una riga di `vd_files`) e `position`. Ha un unique `(source_id, file_id)` e, quando l'attributo non è `multiple`, un `source_id` unico. Entrambe le colonne sono foreign key con `ON DELETE CASCADE`, quindi eliminare un file o una riga ne rimuove i collegamenti. I collegamenti dei media seguono le stesse regole di bozza e pubblicazione dei collegamenti delle relazioni: ogni versione possiede i propri collegamenti e la pubblicazione li copia.

Come funzionano upload, formati e provider di storage è spiegato in [media](/it/concepts/media/).
