---
title: Datenbankschicht
description: Wie Verdin über einen einzigen Verbindungstyp, ein Flavor-Enum und eigene SQL-Builder mit PostgreSQL, MySQL, MariaDB und SQLite spricht und wie es mit den Unterschieden der Dialekte umgeht.
sidebar:
  order: 3
---

Diese Seite erklärt, wie Verdin vier Datenbank-Engines mit einem Codepfad unterstützt: das Crate `verdin-db`, das verbindet und ausführt, die SQL-Builder, die nach Engine verzweigen, und die Unterschiede der Dialekte, die sie behandeln. Lies sie, bevor du irgendwo im Server SQL schreibst. Wie die Tabellen aufgebaut sind, steht unter [Speicherung](/de/internals/storage/).

## Mindestversionen

`Database::connect` erkennt die Engine und ihre Version und verweigert unterhalb dieser Mindestversionen den Start (`Flavor::minimum_version` in `crates/verdin-db/src/lib.rs`):

| Engine | Minimum | Grund |
|---|---|---|
| PostgreSQL | 14 | Älteste Version, die upstream noch unterstützt wird |
| MySQL | 8.4 LTS | 8.0 hat im April 2026 das Ende seiner Lebensdauer erreicht |
| MariaDB | 10.11 LTS | Ältestes aktuelles Long-Term-Release; Collation `utf8mb4_uca1400_ai_ci`, brauchbares JSON |
| SQLite | 3.35 | `ALTER TABLE … DROP COLUMN`; die Bibliothek ist in die Binärdatei einkompiliert |

Die CI führt jeden Test gegen PostgreSQL 14 und 17, MySQL 8.4, MariaDB 10.11 und 11.4 sowie SQLite aus. Siehe [Tests](/de/internals/testing/).

## Verbinden

`verdin-db` kapselt einen `sqlx`-Pool pro Backend:

```rust
pub enum Pool { Postgres(PgPool), MySql(MySqlPool), Sqlite(SqlitePool) }

pub enum Flavor { Postgres, MySql, MariaDb, Sqlite }

pub struct Database { pool: Pool, flavor: Flavor, version: Version }
```

- URL-Schemas: `postgres://` oder `postgresql://`, `mysql://`, `mariadb://` (ein Alias von `mysql://`) und `sqlite:`. MySQL und MariaDB teilen sich den MySQL-Treiber von `sqlx`; der Flavor kommt aus `SELECT VERSION()`, das auf MariaDB `MariaDB` enthält.
- Verbindungen zu MySQL und MariaDB nutzen `utf8mb4` und setzen die Zeitzone der Sitzung auf `+00:00`, sodass jeder Zeitstempel in UTC gespeichert wird.
- SQLite-Verbindungen schalten Fremdschlüssel ein, nutzen WAL-Journaling und ein Busy-Timeout von 5 Sekunden und legen die Datenbankdatei (samt Ordner) an, falls sie fehlt. In-Memory-Datenbanken bekommen eine einzige Verbindung, weil jede Verbindung zu `:memory:` eine andere Datenbank öffnen würde.
- `ConnectOptions` setzt die Poolgröße (`[database].pool_max`, standardmäßig 10) und die Wartezeit auf eine freie Verbindung (10 Sekunden).

`Flavor` trägt die wenigen Fakten, nach denen der übrige Code verzweigt: `transactional_ddl()` (PostgreSQL und SQLite), `is_mysql_family()`, `quote(identifier)` (Backticks auf MySQL und MariaDB, sonst doppelte Anführungszeichen) und `minimum_version()`.

Es gibt kein Dialekt-Trait. Code, der SQL baut, prüft den `Flavor` dort, wo sich die Engines unterscheiden.

## Anweisungen ausführen

Drei Executoren teilen sich dieselben Methoden (`execute`, `fetch_all`, `has_rows`, `insert_returning_id`):

| Executor | Verwendung |
|---|---|
| `db.queries()` | Eine Anweisung auf einer beliebigen Verbindung aus dem Pool |
| `db.acquire()` → `Conn` | Mehrere Anweisungen auf einer Verbindung, etwa ein Migrationslauf, der eine Sperre hält |
| `db.begin()` → `Tx` | Eine Transaktion; wird sie ohne `commit()` verworfen, rollt sie zurück |

Anweisungen werden mit `?`-Platzhaltern geschrieben, die für PostgreSQL in `$1, $2…` umgeschrieben werden. Werte sind `SqlValue`s und werden immer als Parameter gebunden. Der SQL-Text selbst darf nur Bezeichner enthalten, die aus dem validierten Schema stammen, weshalb er als `AssertSqlSafe` an `sqlx` übergeben wird.

**Schemagesteuertes Dekodieren.** Ein Lesezugriff übergibt die `ColumnKind` jeder ausgewählten Spalte, und Werte werden nach dieser Art dekodiert, nicht nach dem Typ, den der Treiber meldet. Deshalb kommen das `JSON` von MariaDB (in Wahrheit `LONGTEXT`), die `TINYINT(1)`-Booleans von MySQL und die Text-Datumswerte und -Dezimalzahlen von SQLite auf jeder Engine gleich zurück. Siehe `crates/verdin-db/src/value.rs`.

**Eingefügte IDs.** `insert_returning_id` hängt auf PostgreSQL `RETURNING id` an und liest auf MySQL, MariaDB (`LAST_INSERT_ID`) und SQLite (`last_insert_rowid`) die ID, die der Treiber nach dem Insert meldet.

**Verletzungen der Eindeutigkeit.** `DbError::unique_violation()` holt den Indexnamen (PostgreSQL, MySQL, MariaDB) bzw. die Spaltenliste (SQLite) aus dem Treiberfehler, damit der Document Service einen `ValidationError` am richtigen Attribut melden kann.

## SQL-Builder

Verdin baut SQL mit eigenen kleinen Buildern statt mit einem ORM oder `sea-query`, weil Tabellen erst zur Laufzeit existieren (sie kommen aus dem Schema) und weil die Details pro Dialekt überwiegen: typisierte NULLs, Collations, JSON-Funktionen und die Textformate von SQLite.

| Crate | Baut |
|---|---|
| `verdin-migrate` (`sql.rs`, `Dialect`) | DDL: Spaltentypen, `CREATE TABLE`, `ALTER TABLE`, Indizes, Neuaufbau von SQLite-Tabellen |
| `verdin-query` (`sql.rs`, `SqlBuilder`) | `WHERE`-Klauseln für Filter (einschließlich `EXISTS`-Subqueries für Relationen und JSON-Pfade) und `ORDER BY` |
| `verdin-content` (`service.rs`) | Lesezugriffe, Inserts, Updates, Deletes, Schreibzugriffe auf Verknüpfungstabellen und gebündelte Populate-Abfragen |

Ein Builder schiebt SQL-Text und `ident()`-Namen (für den Flavor gequotet) und sammelt Parameter mit `param()`, sodass SQL-Bau und Wertebindung an einer Stelle passieren.

### Spaltentypen pro Dialekt

| Modelltyp | PostgreSQL | MySQL / MariaDB | SQLite |
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

SQLite speichert Datumswerte und Uhrzeiten als Text in festem Format, damit die Textreihenfolge der chronologischen Reihenfolge entspricht. Dezimalzahlen speichert es ebenfalls als Text, damit beim Speichern nichts gerundet wird. Die Textreihenfolge ist bei Dezimalzahlen nicht die numerische Reihenfolge, deshalb wandeln Filter und Sortierungen auf einer Dezimalzahl die Spalte auf SQLite in `REAL` um. Diese Vergleiche sind auf etwa 15 signifikante Stellen genau, und die zurückgegebenen Werte sind weiterhin exakt. Welches Attribut auf welchen Modelltyp abgebildet wird, steht unter [Attributtypen](/de/reference/attribute-types/).

Tabellen auf MySQL und MariaDB werden mit `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` und einer akzent- und groß-/kleinschreibungsunabhängigen Collation angelegt: `utf8mb4_0900_ai_ci` auf MySQL, `utf8mb4_uca1400_ai_ci` auf MariaDB.

## Unterschiede der Dialekte

| Thema | PostgreSQL | MySQL 8.4 | MariaDB | SQLite | Wie Verdin damit umgeht |
|---|---|---|---|---|---|
| Eingefügte ID | `RETURNING` | kein `RETURNING` | ID vom Treiber | ID vom Treiber | `insert_returning_id()` |
| Transaktionale DDL | ja | nein (impliziter Commit) | nein | ja | Schrittjournal auf MySQL und MariaDB (siehe [Migrationen](/de/internals/migrations/)) |
| JSON | `jsonb` | `json` | Alias von `LONGTEXT` | Text | Schemagesteuertes Dekodieren |
| Booleans | `boolean` | `tinyint(1)` | `tinyint(1)` | integer | Schemagesteuertes Dekodieren |
| Zeitstempel | `timestamptz` | `datetime(3)` | `datetime(3)` | ISO-Text | Immer UTC; Sitzungen der MySQL-Familie nutzen die Zeitzone `+00:00` |
| Zeichensatz und Collation | UTF-8 | `utf8mb4`, `utf8mb4_0900_ai_ci` | `utf8mb4`, `utf8mb4_uca1400_ai_ci` | UTF-8, binär | Pro Tabelle ausdrücklich gesetzt |
| Exakter Textvergleich (`$eq`, `$in`…) | `=` | `COLLATE utf8mb4_bin` | ebenso | `=` | Gleiche Ergebnisse auf jeder Engine |
| `$contains`, `$startsWith`, `$endsWith` | `LIKE` | `LIKE … COLLATE utf8mb4_bin` | ebenso | `instr()` / `substr()` | Das `LIKE` von SQLite ignoriert die Groß-/Kleinschreibung bei ASCII, deshalb wird es für schreibungsabhängige Vergleiche nicht genutzt |
| `$containsi` und andere `…i`-Operatoren | `ILIKE` | `LIKE` (unabhängige Collation) | ebenso | `LIKE` | SQLite faltet nur ASCII-Buchstaben |
| Filter auf JSON-Pfaden | `#>>` | `JSON_VALUE` | ebenso | `json_extract` | Operand pro Dialekt |
| Filter auf JSON-Arrays | `jsonb_array_elements` | `JSON_TABLE` | ebenso | `json_each` | `EXISTS` über die Elemente |
| `ALTER COLUMN` | vollständig | `MODIFY COLUMN` | ebenso | nicht unterstützt | SQLite: Tabelle neu aufbauen (anlegen, kopieren, löschen, umbenennen) |
| Zeilensperren | `FOR UPDATE` | `FOR UPDATE` | `FOR UPDATE` | keine | Auf SQLite weggelassen, dessen Schreibtransaktionen die Datenbank sperren |
| Länge eindeutiger Textindizes | — | 3.072 Bytes | ebenso | — | `varchar(255)` in `utf8mb4` sind 1.020 Bytes; `text` kann nicht eindeutig sein |
| Zeilengröße | — | 65.535 Bytes | ebenso | — | Höchstens 60 Attribute vom Typ `string`, `email`, `uid` oder `enumeration` pro Typ |

`LIKE`-Muster maskieren `%`, `_` und das Escape-Zeichen selbst (`!`) in Benutzereingaben. Die Standard-Collations von MySQL und MariaDB ignorieren Groß-/Kleinschreibung und Akzente, weshalb exakte Operatoren eine binäre Collation ergänzen: `$eq` bedeutet auf MySQL dasselbe wie auf PostgreSQL. Bei JSON-Pfaden liefert `JSON_VALUE` einen binär kollationierten String, deshalb vergleichen schreibungsunabhängige Operatoren dort `LOWER()` auf beiden Seiten.

`ORDER BY` setzt NULLs in beiden Richtungen ans Ende und endet immer mit `id`, sodass die Paginierung auf jeder Engine stabil ist.
