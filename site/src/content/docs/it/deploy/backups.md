---
title: Backup
description: Fai il backup di un progetto Verdin con dump del database e copie dello storage dei media, o spostalo con verdin export e verdin import verdin.
sidebar:
  order: 9
---

I dati di un progetto Verdin stanno in due posti: il **database** (contenuti, admin, ruoli,
token, impostazioni, cronologia, log di audit) e lo **storage dei media** (i file della
libreria media, su disco o in un bucket). I file dello schema sono nel tuo repository. Fai il
backup di entrambi; `verdin export` aggiunge un archivio portabile dei contenuti.

| Metodo | Contiene | Usalo per |
| --- | --- | --- |
| Dump del database + copia dei media | Tutto | Disaster recovery dello stesso progetto |
| `verdin export` | Schema, lingue, media, tutte le versioni di tutte le voci | Spostare i contenuti su un'altra istanza o un altro motore di database; una copia extra e portabile |

## Dump del database

Usa gli strumenti del tuo database, o i backup automatici del tuo provider:

```sh frame="terminal"
# PostgreSQL
pg_dump --format=custom --file=verdin-$(date +%F).dump "$VERDIN_DATABASE_URL"

# MySQL / MariaDB
mysqldump --single-transaction --routines -h <host> -u <user> -p <database> > verdin-$(date +%F).sql

# SQLite: una copia coerente mentre il server gira
sqlite3 /data/verdin.db ".backup '/backups/verdin-$(date +%F).db'"
```

Non copiare un file SQLite in uso con `cp`: usa `.backup` (o ferma prima il server).

Un dump contiene hash delle password, hash dei token API e campi privati. Cifralo e tienilo
lontano dai server che protegge. Per ripristinarlo ti servono anche gli stessi
`VERDIN_TOKEN_PEPPER` e `VERDIN_ADMIN_JWT_SECRET`: senza il pepper, i token API e i codici
delle app di autenticazione degli admin smettono di funzionare.

## Storage dei media

- **Provider locale**: copia la directory degli upload (`[upload].provider.dir`,
  `/data/uploads` nell'immagine Docker) con il tuo normale backup dei file, dopo il dump del
  database, così che non manchi nessun file a cui il dump fa riferimento.
- **Provider S3**: attiva il versioning o la replica sul bucket, o copialo con gli strumenti
  del tuo provider.

La cache delle trasformazioni delle immagini e l'indice di ricerca si possono ricostruire e
non richiedono backup.

## `verdin export`

`verdin export` scrive schema, contenuti e media di un progetto in un unico `.tar.gz`, e
`verdin import verdin` lo ripristina nello stesso progetto o in un'altra istanza, su
qualsiasi motore di database.

```sh frame="terminal"
verdin export backup-2026-09-28.tar.gz            # schema, lingue, media e voci
verdin export content-only.tar.gz --no-media      # senza i file media
verdin import verdin backup-2026-09-28.tar.gz     # in questo progetto
```

Eseguili con la configurazione del progetto (lo stesso `verdin.toml` e lo stesso ambiente del
server). In un container: `docker compose exec verdin verdin export /data/backup.tar.gz`.

### Cosa è incluso

- **File dello schema**, così come sono.
- **Lingue.** Un progetto vuoto le prende tutte, compresa quella di default. Un progetto che
  ha già delle lingue riceve solo quelle mancanti.
- **Cartelle e file media**, con i loro formati responsive. I file mantengono il loro
  `documentId`; i loro id numerici cambiano.
- **Tutte le versioni di tutte le voci**: bozze, versioni pubblicate e tutte le lingue, con
  date, relazioni (per `documentId`) e media, comprese relazioni e media dentro componenti e
  zone dinamiche. Campi privati e hash delle password sono inclusi.

**Non incluso**: utenti admin, ruoli, token API, webhook, impostazioni delle funzionalità,
flussi di revisione e rilasci. Ricreali sulla destinazione, o ripristina invece un dump del
database.

:::caution
Un export contiene campi privati e hash delle password. Conservalo come un dump del database.
:::

### Importare

1. L'import scrive i file dello schema e migra il database solo con passaggi sicuri.
2. File dello schema già esistenti e diversi lo fanno fermare, a meno che tu non passi
   `--force`.
3. Anche i tipi di contenuto che hanno già voci lo fanno fermare, a meno che tu non passi
   `--force`; le voci vengono allora aggiunte accanto a quelle esistenti.
4. I documenti importati mantengono il loro `documentId`, quindi importare in un progetto
   che ha già gli stessi documenti fallisce.

L'import non attiva webhook né hook dei plugin, e non scrive la cronologia.

### Formato dell'archivio

Un archivio tar compresso con gzip:

| Path | Contenuto |
| --- | --- |
| `manifest.json` | `format: "verdin-export"`, versione del formato, versione di Verdin, versioni per tipo di contenuto |
| `schema/…` | I file dello schema |
| `locales.json` | `{ default, locales: [{ code, name }] }` |
| `folders.json`, `files.jsonl` | Cartelle e file media, un oggetto JSON per riga |
| `assets/{hash}{ext}` | Gli oggetti memorizzati dei file e dei loro formati |
| `entries/{uid}.jsonl` | Una versione per riga: `documentId`, `locale`, `published`, date, `data`, `relations`, `media` |

Per portare invece un progetto Strapi, vedi [Migrare da Strapi](/it/migrate/from-strapi/).

## Prova i ripristini

Di tanto in tanto ripristina in un database di prova, avvia Verdin su di esso con
`verdin start`, e verifica di poter accedere e leggere voci e media.
