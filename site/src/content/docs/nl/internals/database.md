---
title: Databaselaag
description: Hoe Verdin met PostgreSQL, MySQL, MariaDB en SQLite praat via één verbindingstype, een Flavor-enum en eigen SQL-builders, en hoe het met de verschillen tussen dialecten omgaat.
sidebar:
  order: 3
---

Deze pagina legt uit hoe Verdin vier database-engines ondersteunt met één codepad: de crate `verdin-db` die verbindt en uitvoert, de SQL-builders die per engine vertakken, en de verschillen tussen dialecten die ze afhandelen. Lees haar voordat je ergens in de server SQL schrijft. Hoe tabellen zijn ingedeeld, staat in [opslag](/nl/internals/storage/).

## Minimale versies

`Database::connect` detecteert de engine en de versie ervan en weigert te starten onder deze minima (`Flavor::minimum_version` in `crates/verdin-db/src/lib.rs`):

| Engine | Minimum | Reden |
|---|---|---|
| PostgreSQL | 14 | Oudste versie die upstream nog wordt ondersteund |
| MySQL | 8.4 LTS | 8.0 bereikte in april 2026 het einde van zijn levensduur |
| MariaDB | 10.11 LTS | Oudste actuele langetermijnrelease; collatie `utf8mb4_uca1400_ai_ci`, bruikbare JSON |
| SQLite | 3.35 | `ALTER TABLE … DROP COLUMN`; de bibliotheek is in de binary gecompileerd |

CI draait elke test tegen PostgreSQL 14 en 17, MySQL 8.4, MariaDB 10.11 en 11.4, en SQLite. Zie [testen](/nl/internals/testing/).

## Verbinden

`verdin-db` wikkelt één `sqlx`-pool per backend in:

```rust
pub enum Pool { Postgres(PgPool), MySql(MySqlPool), Sqlite(SqlitePool) }

pub enum Flavor { Postgres, MySql, MariaDb, Sqlite }

pub struct Database { pool: Pool, flavor: Flavor, version: Version }
```

- URL-schema's: `postgres://` of `postgresql://`, `mysql://`, `mariadb://` (een alias van `mysql://`) en `sqlite:`. MySQL en MariaDB delen de MySQL-driver van `sqlx`; de flavor komt uit `SELECT VERSION()`, dat op MariaDB `MariaDB` bevat.
- Verbindingen met MySQL en MariaDB gebruiken `utf8mb4` en zetten de tijdzone van de sessie op `+00:00`, zodat elke tijdstempel in UTC wordt opgeslagen.
- Verbindingen met SQLite zetten foreign keys aan, gebruiken WAL-journaling en een busy timeout van 5 seconden, en maken het databasebestand (en zijn map) aan als het ontbreekt. In-memorydatabases krijgen één verbinding, omdat elke verbinding met `:memory:` een andere database zou openen.
- `ConnectOptions` stelt de poolgrootte in (`[database].pool_max`, standaard 10) en de tijd om op een vrije verbinding te wachten (10 seconden).

`Flavor` draagt de paar feiten waarop de rest van de code vertakt: `transactional_ddl()` (PostgreSQL en SQLite), `is_mysql_family()`, `quote(identifier)` (backticks op MySQL en MariaDB, elders dubbele aanhalingstekens) en `minimum_version()`.

Er is geen dialect-trait. Code die SQL bouwt, controleert de `Flavor` waar de engines verschillen.

## Instructies uitvoeren

Drie executors delen dezelfde methoden (`execute`, `fetch_all`, `has_rows`, `insert_returning_id`):

| Executor | Gebruik |
|---|---|
| `db.queries()` | Eén instructie op een willekeurige verbinding uit de pool |
| `db.acquire()` → `Conn` | Meerdere instructies op één verbinding, zoals een migratierun die een lock vasthoudt |
| `db.begin()` → `Tx` | Een transactie; als ze zonder `commit()` wordt vrijgegeven, wordt ze teruggedraaid |

Instructies worden geschreven met placeholders `?`, die voor PostgreSQL worden herschreven naar `$1, $2…`. Waarden zijn `SqlValue`s, altijd als parameters gebonden. De SQL-tekst zelf mag alleen identifiers bevatten die uit het gevalideerde schema komen; daarom wordt hij als `AssertSqlSafe` aan `sqlx` doorgegeven.

**Decoderen op basis van het schema.** Een leesactie geeft de `ColumnKind` van elke geselecteerde kolom mee, en waarden worden volgens die soort gedecodeerd, niet volgens het type dat de driver meldt. Daardoor komen de `JSON` van MariaDB (in werkelijkheid `LONGTEXT`), de `TINYINT(1)`-booleans van MySQL en de tekstdatums en -decimalen van SQLite op elke engine op dezelfde manier terug. Zie `crates/verdin-db/src/value.rs`.

**Ingevoegde id's.** `insert_returning_id` voegt op PostgreSQL `RETURNING id` toe, en leest op MySQL, MariaDB (`LAST_INSERT_ID`) en SQLite (`last_insert_rowid`) het id dat de driver na de insert meldt.

**Uniciteitsschendingen.** `DbError::unique_violation()` haalt de indexnaam (PostgreSQL, MySQL, MariaDB) of de kolomlijst (SQLite) uit de driverfout, zodat de Document Service een `ValidationError` op het juiste attribuut kan melden.

## SQL-builders

Verdin bouwt SQL met eigen kleine builders in plaats van een ORM of `sea-query`, omdat tabellen pas tijdens runtime bestaan (ze komen uit het schema) en omdat de details per dialect overheersen: getypeerde NULLs, collaties, JSON-functies en de tekstformaten van SQLite.

| Crate | Bouwt |
|---|---|
| `verdin-migrate` (`sql.rs`, `Dialect`) | DDL: kolomtypes, `CREATE TABLE`, `ALTER TABLE`, indexen, herbouw van SQLite-tabellen |
| `verdin-query` (`sql.rs`, `SqlBuilder`) | `WHERE`-clausules voor filters (inclusief `EXISTS`-subqueries voor relaties en JSON-paden) en `ORDER BY` |
| `verdin-content` (`service.rs`) | Leesacties, inserts, updates, deletes, schrijfacties in koppeltabellen en gebundelde populate-queries |

Een builder voegt SQL-tekst en `ident()`-namen toe (gequote voor de flavor) en verzamelt parameters met `param()`, zodat SQL bouwen en waarden binden op één plek gebeuren.

### Kolomtypes per dialect

| Modeltype | PostgreSQL | MySQL / MariaDB | SQLite |
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

SQLite slaat datums en tijden op als tekst in een vast formaat, zodat de tekstvolgorde overeenkomt met de chronologische volgorde. Decimalen slaat het ook als tekst op, zodat er bij het opslaan niets wordt afgerond. De tekstvolgorde is voor decimalen niet de numerieke volgorde, dus filters en sorteringen op een decimaal casten de kolom op SQLite naar `REAL`. Die vergelijkingen zijn exact tot ongeveer 15 significante cijfers, en de teruggegeven waarden blijven exact. Welk attribuut bij welk modeltype hoort, staat in [attribuuttypes](/nl/reference/attribute-types/).

Tabellen in MySQL en MariaDB worden aangemaakt met `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` en een collatie die accenten en hoofdletters negeert: `utf8mb4_0900_ai_ci` op MySQL, `utf8mb4_uca1400_ai_ci` op MariaDB.

## Verschillen tussen dialecten

| Onderwerp | PostgreSQL | MySQL 8.4 | MariaDB | SQLite | Hoe Verdin ermee omgaat |
|---|---|---|---|---|---|
| Ingevoegd id | `RETURNING` | geen `RETURNING` | driver-id | driver-id | `insert_returning_id()` |
| Transactionele DDL | ja | nee (impliciete commit) | nee | ja | Stappenjournaal op MySQL en MariaDB (zie [migraties](/nl/internals/migrations/)) |
| JSON | `jsonb` | `json` | alias van `LONGTEXT` | tekst | Decoderen op basis van het schema |
| Booleans | `boolean` | `tinyint(1)` | `tinyint(1)` | integer | Decoderen op basis van het schema |
| Datetime | `timestamptz` | `datetime(3)` | `datetime(3)` | ISO-tekst | Altijd UTC; sessies van de MySQL-familie gebruiken tijdzone `+00:00` |
| Tekenset en collatie | UTF-8 | `utf8mb4`, `utf8mb4_0900_ai_ci` | `utf8mb4`, `utf8mb4_uca1400_ai_ci` | UTF-8, binair | Expliciet per tabel ingesteld |
| Exacte tekstvergelijking (`$eq`, `$in`…) | `=` | `COLLATE utf8mb4_bin` | idem | `=` | Dezelfde resultaten op elke engine |
| `$contains`, `$startsWith`, `$endsWith` | `LIKE` | `LIKE … COLLATE utf8mb4_bin` | idem | `instr()` / `substr()` | `LIKE` van SQLite negeert hoofdletters in ASCII, dus wordt het niet gebruikt voor hoofdlettergevoelige vergelijkingen |
| `$containsi` en andere `…i`-operatoren | `ILIKE` | `LIKE` (ongevoelige collatie) | idem | `LIKE` | SQLite vouwt alleen ASCII-hoofdletters |
| Filters op JSON-paden | `#>>` | `JSON_VALUE` | idem | `json_extract` | Operand per dialect |
| Filters op JSON-arrays | `jsonb_array_elements` | `JSON_TABLE` | idem | `json_each` | `EXISTS` over de items |
| `ALTER COLUMN` | volledig | `MODIFY COLUMN` | idem | niet ondersteund | SQLite: de tabel opnieuw opbouwen (aanmaken, kopiëren, verwijderen, hernoemen) |
| Rijlocks | `FOR UPDATE` | `FOR UPDATE` | `FOR UPDATE` | geen | Weggelaten op SQLite, waarvan schrijftransacties de database vergrendelen |
| Lengte van unieke tekstindex | — | 3.072 bytes | idem | — | `varchar(255)` in `utf8mb4` is 1.020 bytes; `text` kan niet uniek zijn |
| Rijgrootte | — | 65.535 bytes | idem | — | Hoogstens 60 attributen `string`, `email`, `uid` of `enumeration` per type |

`LIKE`-patronen escapen `%`, `_` en het escapeteken zelf (`!`) in gebruikersinput. De standaardcollaties van MySQL en MariaDB negeren hoofdletters en accenten; daarom voegen exacte operatoren een binaire collatie toe: `$eq` betekent op MySQL hetzelfde als op PostgreSQL. Bij JSON-paden geeft `JSON_VALUE` een string met binaire collatie terug, dus hoofdletterongevoelige operatoren vergelijken daar `LOWER()` aan beide kanten.

`ORDER BY` zet NULLs in beide richtingen als laatste en eindigt altijd met `id`, zodat paginering op elke engine stabiel is.
