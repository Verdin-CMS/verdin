---
title: Livello database
description: Come Verdin parla con PostgreSQL, MySQL, MariaDB e SQLite tramite un unico tipo di connessione, un enum Flavor e i propri builder SQL, e come gestisce le differenze di ogni dialetto.
sidebar:
  order: 3
---

Questa pagina spiega come Verdin supporta quattro motori di database con un solo percorso di codice: il crate `verdin-db` che si connette ed esegue, i builder SQL che si diramano in base al motore, e le differenze di dialetto che gestiscono. Leggila prima di scrivere SQL in qualsiasi punto del server. Come sono organizzate le tabelle è in [storage](/it/internals/storage/).

## Versioni minime

`Database::connect` rileva il motore e la sua versione e si rifiuta di partire sotto questi minimi (`Flavor::minimum_version` in `crates/verdin-db/src/lib.rs`):

| Motore | Minimo | Motivo |
|---|---|---|
| PostgreSQL | 14 | La versione più vecchia ancora supportata upstream |
| MySQL | 8.4 LTS | La 8.0 ha raggiunto la fine del supporto ad aprile 2026 |
| MariaDB | 10.11 LTS | La più vecchia release long-term attuale; collation `utf8mb4_uca1400_ai_ci`, JSON utilizzabile |
| SQLite | 3.35 | `ALTER TABLE … DROP COLUMN`; la libreria è compilata nel binario |

La CI esegue ogni test su PostgreSQL 14 e 17, MySQL 8.4, MariaDB 10.11 e 11.4, e SQLite. Vedi [test](/it/internals/testing/).

## Connessione

`verdin-db` racchiude un pool `sqlx` per backend:

```rust
pub enum Pool { Postgres(PgPool), MySql(MySqlPool), Sqlite(SqlitePool) }

pub enum Flavor { Postgres, MySql, MariaDb, Sqlite }

pub struct Database { pool: Pool, flavor: Flavor, version: Version }
```

- Schemi di URL: `postgres://` o `postgresql://`, `mysql://`, `mariadb://` (un alias di `mysql://`) e `sqlite:`. MySQL e MariaDB condividono il driver MySQL di `sqlx`; il flavor deriva da `SELECT VERSION()`, che su MariaDB contiene `MariaDB`.
- Le connessioni MySQL e MariaDB usano `utf8mb4` e impostano il fuso orario della sessione a `+00:00`, così ogni timestamp viene memorizzato in UTC.
- Le connessioni SQLite attivano le foreign key, usano il journaling WAL e un busy timeout di 5 secondi, e creano il file del database (e la sua cartella) se mancano. I database in memoria ricevono una sola connessione, perché ogni connessione a `:memory:` aprirebbe un database diverso.
- `ConnectOptions` imposta la dimensione del pool (`[database].pool_max`, 10 di default) e il tempo di attesa di una connessione libera (10 secondi).

`Flavor` porta i pochi fatti su cui si dirama il resto del codice: `transactional_ddl()` (PostgreSQL e SQLite), `is_mysql_family()`, `quote(identifier)` (backtick su MySQL e MariaDB, doppi apici altrove) e `minimum_version()`.

Non c'è un trait per i dialetti. Il codice che costruisce SQL controlla il `Flavor` dove i motori differiscono.

## Esecuzione delle istruzioni

Tre executor condividono gli stessi metodi (`execute`, `fetch_all`, `has_rows`, `insert_returning_id`):

| Executor | Uso |
|---|---|
| `db.queries()` | Un'istruzione su una qualsiasi connessione del pool |
| `db.acquire()` → `Conn` | Più istruzioni su una connessione, come un'esecuzione di migrazione che tiene un lock |
| `db.begin()` → `Tx` | Una transazione; se viene rilasciata senza `commit()`, fa rollback |

Le istruzioni si scrivono con placeholder `?`, riscritti in `$1, $2…` per PostgreSQL. I valori sono `SqlValue`, sempre passati come parametri. Il testo SQL stesso può contenere solo identificatori che vengono dallo schema validato, ed è per questo che viene passato a `sqlx` come `AssertSqlSafe`.

**Decodifica guidata dallo schema.** Una lettura passa il `ColumnKind` di ogni colonna selezionata, e i valori vengono decodificati in base a quel kind, non al tipo riportato dal driver. È ciò che fa tornare allo stesso modo su ogni motore il `JSON` di MariaDB (in realtà `LONGTEXT`), i booleani `TINYINT(1)` di MySQL e le date e i decimali in testo di SQLite. Vedi `crates/verdin-db/src/value.rs`.

**Id inseriti.** `insert_returning_id` aggiunge `RETURNING id` su PostgreSQL, e legge l'id riportato dal driver dopo l'insert su MySQL, MariaDB (`LAST_INSERT_ID`) e SQLite (`last_insert_rowid`).

**Violazioni di unicità.** `DbError::unique_violation()` estrae dall'errore del driver il nome dell'indice (PostgreSQL, MySQL, MariaDB) o la lista delle colonne (SQLite), così il Document Service può segnalare un `ValidationError` sull'attributo giusto.

## Builder SQL

Verdin costruisce l'SQL con i propri piccoli builder invece di un ORM o di `sea-query`, perché le tabelle esistono solo a runtime (vengono dallo schema) e perché dominano i dettagli per dialetto: NULL tipizzati, collation, funzioni JSON e i formati di testo di SQLite.

| Crate | Costruisce |
|---|---|
| `verdin-migrate` (`sql.rs`, `Dialect`) | DDL: tipi di colonna, `CREATE TABLE`, `ALTER TABLE`, indici, ricostruzioni di tabelle SQLite |
| `verdin-query` (`sql.rs`, `SqlBuilder`) | Clausole `WHERE` per i filtri (comprese le subquery `EXISTS` sulle relazioni e i path JSON) e `ORDER BY` |
| `verdin-content` (`service.rs`) | Letture, insert, update, delete, scritture sulle tabelle di link e query di populate in batch |

Un builder aggiunge testo SQL e nomi `ident()` (quotati per il flavor) e raccoglie i parametri con `param()`, così costruire l'SQL e passare i valori avviene in un solo posto.

### Tipi di colonna per dialetto

| Tipo del modello | PostgreSQL | MySQL / MariaDB | SQLite |
|---|---|---|---|
| id | `bigint` identity | `bigint AUTO_INCREMENT` | `integer PRIMARY KEY AUTOINCREMENT` |
| integer, bigint, smallint | `integer`, `bigint`, `smallint` | `int`, `bigint`, `smallint` | `integer` |
| double | `double precision` | `double` | `real` |
| decimal | `numeric(p,s)` | `decimal(p,s)` | `text` |
| boolean | `boolean` | `tinyint(1)` | `integer` |
| char, varchar | `char(n)`, `varchar(n)` | `char(n)`, `varchar(n)` | `text` |
| text | `text` | `longtext` | `text` |
| date, time, datetime | `date`, `time(3)`, `timestamptz(3)` | `date`, `time(3)`, `datetime(3)` | `text` |
| json | `jsonb` | `json` | `text` |

SQLite memorizza date e orari come testo a formato fisso, così l'ordine del testo corrisponde all'ordine cronologico. Memorizza come testo anche i decimali, così nulla viene arrotondato al salvataggio. L'ordine del testo non è l'ordine numerico per i decimali, quindi filtri e ordinamenti su un decimale convertono la colonna in `REAL` su SQLite. Quei confronti sono esatti fino a circa 15 cifre significative, e i valori restituiti restano esatti. Quale attributo corrisponde a quale tipo del modello è in [tipi di attributo](/it/reference/attribute-types/).

Le tabelle MySQL e MariaDB vengono create con `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` e una collation insensibile ad accenti e maiuscole/minuscole: `utf8mb4_0900_ai_ci` su MySQL, `utf8mb4_uca1400_ai_ci` su MariaDB.

## Differenze tra dialetti

| Argomento | PostgreSQL | MySQL 8.4 | MariaDB | SQLite | Come lo gestisce Verdin |
|---|---|---|---|---|---|
| Id inserito | `RETURNING` | niente `RETURNING` | id del driver | id del driver | `insert_returning_id()` |
| DDL transazionale | sì | no (commit implicito) | no | sì | Journal dei passaggi su MySQL e MariaDB (vedi [migrazioni](/it/internals/migrations/)) |
| JSON | `jsonb` | `json` | alias di `LONGTEXT` | testo | Decodifica guidata dallo schema |
| Booleani | `boolean` | `tinyint(1)` | `tinyint(1)` | intero | Decodifica guidata dallo schema |
| Datetime | `timestamptz` | `datetime(3)` | `datetime(3)` | testo ISO | Sempre UTC; le sessioni della famiglia MySQL usano il fuso orario `+00:00` |
| Charset e collation | UTF-8 | `utf8mb4`, `utf8mb4_0900_ai_ci` | `utf8mb4`, `utf8mb4_uca1400_ai_ci` | UTF-8, binaria | Impostati esplicitamente per tabella |
| Corrispondenza esatta del testo (`$eq`, `$in`…) | `=` | `COLLATE utf8mb4_bin` | uguale | `=` | Stessi risultati su ogni motore |
| `$contains`, `$startsWith`, `$endsWith` | `LIKE` | `LIKE … COLLATE utf8mb4_bin` | uguale | `instr()` / `substr()` | Il `LIKE` di SQLite ignora le maiuscole ASCII, quindi non viene usato per le corrispondenze case-sensitive |
| `$containsi` e gli altri operatori `…i` | `ILIKE` | `LIKE` (collation insensibile) | uguale | `LIKE` | SQLite normalizza solo le maiuscole ASCII |
| Filtri su path JSON | `#>>` | `JSON_VALUE` | uguale | `json_extract` | Operando per dialetto |
| Filtri su array JSON | `jsonb_array_elements` | `JSON_TABLE` | uguale | `json_each` | `EXISTS` sugli elementi |
| `ALTER COLUMN` | completo | `MODIFY COLUMN` | uguale | non supportato | SQLite: ricostruire la tabella (crea, copia, elimina, rinomina) |
| Lock di riga | `FOR UPDATE` | `FOR UPDATE` | `FOR UPDATE` | nessuno | Omessi su SQLite, le cui transazioni di scrittura bloccano il database |
| Lunghezza degli indici unici su testo | — | 3.072 byte | uguale | — | `varchar(255)` in `utf8mb4` è 1.020 byte; `text` non può essere unico |
| Dimensione della riga | — | 65.535 byte | uguale | — | Al massimo 60 attributi `string`, `email`, `uid` o `enumeration` per tipo |

I pattern `LIKE` fanno l'escape di `%`, `_` e del carattere di escape stesso (`!`) nell'input dell'utente. Le collation di default di MySQL e MariaDB ignorano maiuscole e accenti, ed è per questo che gli operatori esatti aggiungono una collation binaria: `$eq` significa la stessa cosa su MySQL e su PostgreSQL. Con i path JSON, `JSON_VALUE` restituisce una stringa con collation binaria, quindi lì gli operatori case-insensitive confrontano `LOWER()` su entrambi i lati.

`ORDER BY` mette i NULL per ultimi in entrambe le direzioni e termina sempre con `id`, così la paginazione è stabile su ogni motore.
