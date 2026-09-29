---
title: Test
description: Come viene testato Verdin, dagli unit test in Rust alla suite di conformità che gira su sei database, agli unit test e ai test Playwright del pannello di amministrazione, e ai job di CI che controllano ogni modifica.
sidebar:
  order: 7
---

Questa pagina spiega le suite di test, come eseguire ciascuna in locale, e cosa verifica la CI su ogni pull request. La regola dietro a tutto: una funzionalità non è finita finché non passa su ogni database supportato.

## Test in Rust

Esegui tutto con:

```sh title="Terminal"
cargo test --workspace
```

Senza configurazione, i test usano SQLite. Ce ne sono di tre tipi:

| Tipo | Dove | Cosa |
|---|---|---|
| Unit test | Moduli `#[cfg(test)]` in ogni crate | Parsing e validazione dello schema, naming, diff e piano, parsing delle query, generazione dell'SQL per dialetto, codifica dei valori, validazione dell'input |
| Test di integrazione dei crate | `crates/*/tests/` | Connessione e rilevamento del flavor (`verdin-db`), applicazione delle migrazioni (`verdin-migrate`), flussi di autenticazione (`verdin-auth`), GraphQL, plugin, storage S3 |
| Test delle API | `crates/verdin-api/tests/api/` | Richieste HTTP verso la content API e l'API admin, compresa la suite di conformità |

**Snapshot del DDL.** `crates/verdin-migrate/tests/sql_snapshots.rs` genera il DDL di uno schema di esempio per ogni dialetto e lo confronta con gli snapshot [`insta`](https://insta.rs) in `crates/verdin-migrate/tests/snapshots/`. Quando modifichi il DDL di proposito, rivedi e accetta i nuovi snapshot con `cargo insta review` (da `cargo-insta`) e fanne il commit.

**I test delle API** vivono in un unico binario di test (`tests/api/main.rs`, un modulo per area) per contenere i tempi di link e la dimensione di `target/`. L'harness in `tests/api/common/mod.rs` costruisce la content API su `/api` e l'API admin su `/admin/api` sopra un database nuovo e migrato per ogni test. Le richieste portano un token API con accesso completo a meno che il test non ne passi un altro, o nessuno.

## La matrice dei sei database

Ogni test che tocca un database legge `VERDIN_TEST_DATABASE_URL` e di default usa SQLite in memoria. `verdin-testkit` dà a ogni test un proprio database: un file SQLite temporaneo, o un nuovo database `vd_test_…` creato sul server ed eliminato dopo.

La CI esegue l'intero workspace una volta per motore:

| Motore | Immagine |
|---|---|
| SQLite | incluso |
| PostgreSQL 14 | `postgres:14-alpine` |
| PostgreSQL 17 | `postgres:17-alpine` |
| MySQL 8.4 | `mysql:8.4` |
| MariaDB 10.11 | `mariadb:10.11` |
| MariaDB 11.4 | `mariadb:11.4` |

Queste sono le [versioni minime](/it/internals/database/#versioni-minime) più le più recenti su cui Verdin viene testato. La CI imposta anche `VERDIN_TEST_EXPECT_FLAVOR` così che `crates/verdin-db/tests/connect.rs` verifichi che il motore sia stato rilevato correttamente (MariaDB viene raggiunto con un URL `mysql://` e deve comunque essere rilevato come MariaDB).

Per eseguire la matrice in locale, avvia i database con Docker:

```sh title="Terminal"
docker compose -f docker/compose.dev.yml up -d
```

Poi esegui i test su ogni motore. I test creano un database per test, quindi su MySQL e MariaDB si connettono come `root`:

```sh title="Terminal"
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5414/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5417/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3384/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3311/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3314/verdin cargo test --workspace
```

Le porte corrispondono a PostgreSQL 14 e 17, MySQL 8.4, e MariaDB 10.11 e 11.4. Lo stesso file compose avvia RustFS (storage compatibile S3 sulla porta 9000) e Mailpit (SMTP sulla porta 1025, casella sulla porta 8025) per lavorare su media ed email.

## Suite di conformità

`crates/verdin-api/tests/api/conformance.rs` invia le stesse richieste HTTP alla content API su ogni motore e verifica le risposte: cicli completi di creazione, lettura, aggiornamento ed eliminazione, validazione dell'input, bozza e pubblicazione, filtri e le loro regole di confronto del testo, ordinamento e paginazione, tipi di campo e populate, valori unici, single type, regole di accesso della content API, il documento OpenAPI, e filtri sui campi dei componenti. Altri moduli in `tests/api/` (`filters.rs`, `populate.rs`, `relations.rs`, `components.rs`, `morph.rs`, `i18n.rs`…) coprono le loro aree allo stesso modo, quindi l'intero binario di test di `verdin-api` è di fatto la suite di conformità.

Quando correggi una differenza tra dialetti, aggiungi qui il caso: il test che passa su PostgreSQL e fallisce su MySQL è esattamente quello che la suite esiste per intercettare.

## Test del pannello di amministrazione

**Gli unit test** sono file `*.spec.ts` accanto al codice in `admin/src/app`, eseguiti con Vitest tramite il builder di unit test di Angular in jsdom. Coprono i modelli puri: conversione del modello del form, regole dei campi, filtri e viste delle liste, permessi, il transpiler ICU, l'inizio della settimana, e altro.

```sh title="Terminal"
cd admin
npx ng test --watch=false
```

**I test end-to-end** sono spec Playwright in `admin/e2e/`. `e2e/serve.sh` crea un progetto usa e getta (con un plugin WebAssembly di esempio), e avvia `verdin dev` sulla porta 1393 su SQLite, servendo l'admin da `admin/dist/admin/browser`. I test girano uno alla volta in Chromium con l'interfaccia in inglese.

```sh title="Terminal"
cd admin
npx ng build
cargo build -p verdin
npx playwright install chromium
npx playwright test
```

Le spec coprono accesso e due fattori, l'editor delle voci, le relazioni polimorfiche, i flussi di revisione, le funzionalità di team e governance, le menzioni, import ed export, le viste di modifica e le protezioni sulle modifiche non salvate.

## CI

`.github/workflows/ci.yml` gira a ogni push su `main` e a ogni pull request. Tutti i job Rust compilano con `RUSTFLAGS=-D warnings`.

| Job | Verifica |
|---|---|
| `lint` | `cargo fmt --all --check`, `cargo clippy --workspace --all-targets`, `cargo deny` (licenze e advisory) |
| `test (sqlite)` | `cargo test --workspace` su SQLite in memoria |
| `test (…)` | `cargo test --workspace` su PostgreSQL 14 e 17, MySQL 8.4, MariaDB 10.11 e 11.4, un job ciascuno, come servizi Docker |
| `test (s3 storage, RustFS)` | `cargo test -p verdin-upload --test s3` su un container RustFS |
| `admin` | Controllo Prettier, `npm run i18n:check`, `npm audit --audit-level=high`, unit test, `ng build`, `cargo build -p verdin --features embed-admin`, Playwright |
| `client` | `packages/client` ha la stessa versione del workspace, poi type check, test e build |
| `site` | `npm audit`, e la build della documentazione, che fallisce su qualsiasi link interno rotto |

Le esecuzioni Playwright fallite caricano le loro trace come artifact, conservate per sette giorni.
