---
title: Riferimento della riga di comando
description: Ogni comando, sottocomando e flag del binario verdin, con cosa legge, scrive e stampa.
sidebar:
  order: 2
  label: Riga di comando
---

<!-- Written from crates/verdin/src/cli.rs and crates/verdin/src/new.rs. `npm run check-cli`
(site/scripts/check-cli.mjs) fails when a subcommand or flag in cli.rs is missing here. -->

`verdin` è l'unico binario: crea progetti, esegue il server, applica le migrazioni, gestisce
gli utenti admin e fa entrare e uscire i contenuti. Questa pagina elenca ogni comando e flag.

```text title="Terminal"
verdin [OPTIONS] <COMMAND>
```

| Comando | Cosa fa |
| --- | --- |
| [`verdin new`](#verdin-new) | Crea una directory di progetto. |
| [`verdin dev`](#verdin-dev) | Esegue il server in modalità sviluppo. |
| [`verdin start`](#verdin-start) | Esegue il server in modalità produzione. |
| [`verdin schema check`](#verdin-schema-check) | Valida i file dello schema. |
| [`verdin migrate plan`](#verdin-migrate-plan) | Mostra i passaggi della migrazione e il loro SQL. |
| [`verdin migrate apply`](#verdin-migrate-apply) | Applica i passaggi della migrazione. |
| [`verdin admin create`](#verdin-admin-create) | Crea un Super Admin. |
| [`verdin admin reset-password`](#verdin-admin-reset-password) | Imposta la password di un admin. |
| [`verdin types`](#verdin-types) | Genera le definizioni TypeScript della content API. |
| [`verdin import strapi`](#verdin-import-strapi) | Importa un export di Strapi. |
| [`verdin import verdin`](#verdin-import-verdin) | Importa un export di Verdin. |
| [`verdin export`](#verdin-export) | Scrive il progetto in un archivio `.tar.gz`. |
| [`verdin healthcheck`](#verdin-healthcheck) | Verifica che il server locale risponda. |
| [`verdin secrets`](#verdin-secrets) | Stampa nuovi segreti. |
| [`verdin version`](#verdin-version) | Stampa la versione. |

## Opzioni globali

| Opzione | Default | Descrizione |
| --- | --- | --- |
| `-c, --config <CONFIG>` | `verdin.toml` | Il file di configurazione del progetto. Letto anche da `VERDIN_CONFIG`. La radice del progetto è la directory del file: schema, plugin, upload e path SQLite relativi vengono risolti rispetto a essa. |
| `-h, --help` | | Stampa l'aiuto del comando. |
| `-V, --version` | | Stampa la versione. |

`verdin help <COMMAND>` stampa lo stesso aiuto di `--help`.

Ogni comando tranne `new`, `secrets` e `version` carica prima il progetto:

1. Legge il file `.env` accanto al file di configurazione, se c'è. Le variabili già impostate
   nell'ambiente prevalgono.
2. Carica `verdin.toml` (opzionale) e gli override `VERDIN_*`. Vedi il
   [riferimento della configurazione](/it/reference/configuration/).
3. Avvia il logging sullo standard error, con `[log]` e `RUST_LOG`.

I comandi che aprono il database richiedono `VERDIN_DATABASE_URL` o `[database].url`. I
comandi che toccano gli account admin o eseguono il server richiedono anche
`VERDIN_ADMIN_JWT_SECRET` e `VERDIN_TOKEN_PEPPER`.

## `verdin new`

```text title="Terminal"
verdin new <DIR> [--database <DATABASE>]
```

Crea un progetto in `DIR`, che non deve esistere o deve essere vuota:

| File | Contenuto |
| --- | --- |
| `verdin.toml` | `[server]`, `[api]` e `[admin]` con i loro default. |
| `.env` | `VERDIN_DATABASE_URL`, e nuovi `VERDIN_ADMIN_JWT_SECRET` e `VERDIN_TOKEN_PEPPER`. Leggibile solo da te (modalità `0600` su Unix). |
| `.gitignore` | `.env`, `data/`, i file SQLite e `.cache/`. |
| `schema/content-types/`, `schema/components/` | Directory dello schema vuote. |
| `data/` | Per il database SQLite (solo SQLite). |

| Argomento o opzione | Default | Descrizione |
| --- | --- | --- |
| `<DIR>` | | Directory da creare. |
| `--database <DATABASE>` | `sqlite` | Database a cui punta il `.env`: `sqlite`, `postgres`, `mysql` o `mariadb`. |

Con `sqlite`, l'URL è `sqlite://data/verdin.db`. Con gli altri è l'URL di un server locale
con l'utente `verdin`, la password `change-me` e un database con il nome della directory
(lettere minuscole, cifre e `_`): modificalo prima di avviare.

```text title="Terminal"
$ verdin new blog --database postgres
created blog

  cd blog
  verdin dev

then open http://localhost:1337/admin/ to register the first admin
```

## `verdin dev`

```text title="Terminal"
verdin dev
```

Esegue il server in modalità sviluppo. Rispetto a `verdin start`:

- Le migrazioni in sospeso con livello di rischio `safe` vengono applicate all'avvio. I
  passaggi più rischiosi fermano il server; rivedili con
  [`verdin migrate plan`](#verdin-migrate-plan).
- Il **Costruttore di tipi di contenuto** del pannello di amministrazione modifica i file
  dello schema e il server ricarica lo schema.
- Il cookie di refresh non è segnato `Secure` (a meno che `[admin].secure_cookies` non lo
  dica), così puoi accedere su HTTP semplice.
- Webhook e destinazioni di deploy possono chiamare indirizzi di loopback e privati (a meno
  che `[webhooks].allow_private_networks` non dica altrimenti).

Si ferma con Ctrl+C o `SIGTERM`.

## `verdin start`

```text title="Terminal"
verdin start [--migrate]
```

Esegue il server in modalità produzione. Si rifiuta di partire quando il database è indietro
rispetto allo schema, così un deploy non modifica mai tabelle che non hai rivisto.

| Opzione | Descrizione |
| --- | --- |
| `--migrate` | Applica i passaggi di migrazione `safe` in sospeso prima dell'avvio. I passaggi rischiosi e distruttivi richiedono comunque `verdin migrate apply`. |

Prima di mettersi in ascolto, verifica la configurazione (`[api].prefix` e `[admin].path`
hanno la forma di `/api`, le dimensioni delle pagine sono coerenti, `[server].trusted_proxies`
e `[api].cors_origins` sono validi) e crea i ruoli predefiniti. Registra un avviso quando
`[admin].secure_cookies` è `false` o `[email].provider` è `log`. Quando non c'è ancora nessun
admin, registra l'indirizzo del pannello di amministrazione, dove il primo visitatore
registra il primo Super Admin.

Si ferma con Ctrl+C o `SIGTERM`.

## `verdin schema check`

```text title="Terminal"
verdin schema check
```

Valida i file dello schema (`[schema].path`) senza toccare il database. Stampa un riepilogo,
o fallisce con gli errori, ciascuno con il suo file e il path dell'attributo:

```text title="Terminal"
$ verdin schema check
schema ok: 4 content types, 3 components
```

Usalo in CI prima di un deploy. Vedi [Tipi di attributo](/it/reference/attribute-types/) per
cosa accetta ogni attributo.

## `verdin migrate plan`

```text title="Terminal"
verdin migrate plan [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Confronta il database con lo schema e stampa cosa farebbe `verdin migrate apply`, senza
cambiare nulla: passaggi numerati, ciascuno con il suo livello di rischio e il suo SQL.
Stampa `database is up to date` quando non c'è nulla da fare.

| Opzione | Descrizione |
| --- | --- |
| `--rename-table <OLD=NEW>` | Tratta la tabella `OLD` come rinominata in `NEW` (mantiene le sue righe) invece di eliminarne una e crearne un'altra. Ripetibile. |
| `--rename-column <TABLE.OLD=NEW>` | Tratta la colonna `OLD` di `TABLE` come rinominata in `NEW` (mantiene i suoi valori). `TABLE` è il nuovo nome della tabella. Ripetibile. |

Livelli di rischio:

| Livello | Significato |
| --- | --- |
| `safe` | Non può perdere dati né fallire sulle righe esistenti: nuove tabelle, nuove colonne nullable o con un default, rinomine, indici non unici. |
| `risky` | Può fallire sulle righe esistenti o convertire valori: cambi di tipo di colonna, nuove colonne non nullable e senza default, indici unici su tabelle esistenti. |
| `destructive` | Elimina colonne o tabelle. |

Quando un passaggio supera `safe`, il piano termina con il flag che richiede
(`requires: verdin migrate apply --allow risky`). Quando una colonna o una tabella eliminata
sembra rinominata, elenca i flag di rinomina da passare. Quando una migrazione precedente è
stata interrotta, mostra quanti passaggi sono stati applicati e l'ultimo errore.

```text title="Terminal"
verdin migrate plan --rename-column articles.summary=excerpt
```

Vedi [Migrazioni dello schema](/it/concepts/schema-migrations/).

## `verdin migrate apply`

```text title="Terminal"
verdin migrate apply [--allow <ALLOW>] [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Applica il piano. Accetta le stesse opzioni di rinomina di `verdin migrate plan`; passa le
stesse che hai rivisto.

| Opzione | Default | Descrizione |
| --- | --- | --- |
| `--allow <ALLOW>` | `safe` | Livello di rischio massimo da applicare: `safe`, `risky` o `destructive`. Un piano con un passaggio oltre questo livello viene rifiutato prima di eseguire qualsiasi cosa. |
| `--rename-table <OLD=NEW>` | | Come in `verdin migrate plan`. |
| `--rename-column <TABLE.OLD=NEW>` | | Come in `verdin migrate plan`. |

Stampa `applied N steps`, o `database is up to date`. Dopo un'interruzione (una connessione
persa, un passaggio fallito), correggi la causa ed eseguilo di nuovo: riprende dal passaggio
che non è stato completato.

## `verdin admin create`

```text title="Terminal"
verdin admin create --email <EMAIL>
```

Crea un Super Admin. La password viene letta da `VERDIN_ADMIN_PASSWORD`, o dallo standard
input quando non è impostata. Il database deve essere aggiornato rispetto allo schema.

| Opzione | Descrizione |
| --- | --- |
| `--email <EMAIL>` | L'indirizzo email del nuovo admin. |

```text title="Terminal"
$ VERDIN_ADMIN_PASSWORD='a long passphrase' verdin admin create --email ada@example.com
created Super Admin ada@example.com (id 1)
```

Usalo per creare il primo admin di un server non ancora raggiungibile da un browser;
altrimenti lo registra il primo visitatore del pannello di amministrazione.

## `verdin admin reset-password`

```text title="Terminal"
verdin admin reset-password --email <EMAIL>
```

Imposta la password di un admin, sblocca l'account dopo accessi falliti e chiude tutte le sue
sessioni. La password viene letta come per `verdin admin create`.

| Opzione | Descrizione |
| --- | --- |
| `--email <EMAIL>` | L'indirizzo email dell'admin. |

Non rimuove i secondi fattori; un admin con **Gestisci utenti** può reimpostarli in
**Impostazioni → Utenti**.

## `verdin types`

```text title="Terminal"
verdin types [-o <OUT>]
```

Genera le definizioni TypeScript della content API (un'interfaccia per tipo di contenuto e
componente) a partire dallo schema, e le stampa sullo standard output. Non ha bisogno del
database.

| Opzione | Descrizione |
| --- | --- |
| `-o, --out <OUT>` | Scrive invece in questo file. |

```text title="Terminal"
verdin types --out ../web/src/verdin.d.ts
```

Vedi [Client tipizzato](/it/guides/frontend/typed-client/).

## `verdin import strapi`

```text title="Terminal"
verdin import strapi <PATH> [--schema-only] [--force]
```

Importa un progetto Strapi v4 o v5 da un export fatto con `strapi export --no-encrypt`: un
`.tar.gz`, un `.tar` o una directory estratta. Scrive tipi di contenuto e componenti come
file dello schema, poi importa voci, lingue, media, relazioni e cartelle.

| Argomento o opzione | Descrizione |
| --- | --- |
| `<PATH>` | Il file o la directory dell'export. |
| `--schema-only` | Scrive solo i file dello schema. |
| `--force` | Sovrascrive i file dello schema esistenti, e importa nei tipi di contenuto che hanno già voci. |

Stampa cosa ha scritto e importato, con avvisi per ciò che non ha potuto portare, e scrive
`strapi-id-map.json` nella radice del progetto: gli id di Strapi e i loro nuovi `documentId`
e id di file Verdin, per correggere i link nel tuo frontend.

Vedi [Migrare da Strapi](/it/migrate/from-strapi/).

## `verdin import verdin`

```text title="Terminal"
verdin import verdin <PATH> [--force]
```

Importa un archivio scritto da `verdin export`: file dello schema, lingue, media e voci.

| Argomento o opzione | Descrizione |
| --- | --- |
| `<PATH>` | Il file `.tar.gz`. |
| `--force` | Sovrascrive i file dello schema diversi, e importa nei tipi di contenuto che hanno già voci. |

## `verdin export`

```text title="Terminal"
verdin export <OUTPUT> [--no-media]
```

Scrive schema, contenuti e media del progetto in un archivio `.tar.gz`: un backup, o un modo
per spostare un progetto su un'altra istanza con `verdin import verdin`. L'archivio contiene
tutte le versioni di tutte le voci (bozze, versioni pubblicate, lingue) con le loro relazioni.
Account admin, token API e impostazioni non sono inclusi.

| Argomento o opzione | Descrizione |
| --- | --- |
| `<OUTPUT>` | L'archivio da scrivere. |
| `--no-media` | Esclude la libreria media: file, cartelle e i collegamenti delle voci a essi. |

```text title="Terminal"
$ verdin export backup.tar.gz
exported to backup.tar.gz: 42 documents (57 versions), 18 files, 3 folders, 2 locales
```

Vedi [Backup](/it/deploy/backups/).

## `verdin healthcheck`

```text title="Terminal"
verdin healthcheck [--port <PORT>]
```

Chiede `GET /_health` al server su questa macchina (`127.0.0.1`, la `[server].port` della
configurazione) ed esce con stato 0 quando risponde `200`, 1 altrimenti, stampando il motivo.
Non ha bisogno di shell, `curl` o di un client HTTP, quindi l'immagine Docker lo usa come suo
`HEALTHCHECK`; usalo allo stesso modo in Compose o in qualsiasi supervisore che esegue un
comando.

| Opzione | Descrizione |
| --- | --- |
| `--port <PORT>` | Verifica questa porta invece di `[server].port`. |

```text title="Terminal"
$ verdin healthcheck
ok
```

Vedi [Monitoraggio](/it/deploy/monitoring/).

## `verdin secrets`

```text title="Terminal"
verdin secrets
```

Stampa nuovi `VERDIN_ADMIN_JWT_SECRET` e `VERDIN_TOKEN_PEPPER`, pronti per un file `.env` o
per il secret store della tua piattaforma. Non legge alcun progetto.

Cambiare `VERDIN_ADMIN_JWT_SECRET` invalida gli access token di breve durata di admin e utenti
finali, i link di anteprima aperti e gli accessi OAuth in corso; il pannello di
amministrazione e i client che usano i refresh token ne ottengono di nuovi da soli. Cambiare
`VERDIN_TOKEN_PEPPER` invalida i token memorizzati (tra cui i token API), quindi mantienilo
una volta in uso.

## `verdin version`

```text title="Terminal"
verdin version
```

Stampa `verdin` e la versione, come `verdin --version`.
