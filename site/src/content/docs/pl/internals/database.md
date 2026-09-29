---
title: Warstwa bazy danych
description: Jak Verdin rozmawia z PostgreSQL, MySQL, MariaDB i SQLite przez jeden typ połączenia, enum Flavor i własne buildery SQL oraz jak obsługuje różnice między dialektami.
sidebar:
  order: 3
---

Ta strona wyjaśnia, jak Verdin obsługuje cztery silniki baz danych jedną ścieżką kodu: crate `verdin-db`, który łączy się i wykonuje zapytania, buildery SQL, które rozgałęziają się według silnika, i różnice między dialektami, które obsługują. Przeczytaj ją, zanim napiszesz SQL gdziekolwiek w serwerze. Układ tabel opisuje [przechowywanie](/pl/internals/storage/).

## Minimalne wersje

`Database::connect` wykrywa silnik i jego wersję i odmawia startu poniżej tych minimów (`Flavor::minimum_version` w `crates/verdin-db/src/lib.rs`):

| Silnik | Minimum | Powód |
|---|---|---|
| PostgreSQL | 14 | Najstarsza wersja nadal wspierana przez upstream |
| MySQL | 8.4 LTS | 8.0 osiągnęło koniec życia w kwietniu 2026 |
| MariaDB | 10.11 LTS | Najstarsze aktualne wydanie długoterminowe; kolacja `utf8mb4_uca1400_ai_ci`, używalny JSON |
| SQLite | 3.35 | `ALTER TABLE … DROP COLUMN`; biblioteka jest wkompilowana w binarkę |

CI uruchamia każdy test na PostgreSQL 14 i 17, MySQL 8.4, MariaDB 10.11 i 11.4 oraz SQLite. Zobacz [testowanie](/pl/internals/testing/).

## Łączenie

`verdin-db` opakowuje jedną pulę `sqlx` na backend:

```rust
pub enum Pool { Postgres(PgPool), MySql(MySqlPool), Sqlite(SqlitePool) }

pub enum Flavor { Postgres, MySql, MariaDb, Sqlite }

pub struct Database { pool: Pool, flavor: Flavor, version: Version }
```

- Schematy URL: `postgres://` lub `postgresql://`, `mysql://`, `mariadb://` (alias `mysql://`) i `sqlite:`. MySQL i MariaDB dzielą sterownik MySQL z `sqlx`; flavor pochodzi z `SELECT VERSION()`, które w MariaDB zawiera `MariaDB`.
- Połączenia MySQL i MariaDB używają `utf8mb4` i ustawiają strefę czasową sesji na `+00:00`, więc każdy znacznik czasu jest przechowywany w UTC.
- Połączenia SQLite włączają klucze obce, używają dziennika WAL i 5-sekundowego busy timeout oraz tworzą plik bazy danych (i jego folder), jeśli nie istnieje. Bazy w pamięci dostają jedno połączenie, bo każde połączenie z `:memory:` otwierałoby inną bazę.
- `ConnectOptions` ustawia rozmiar puli (`[database].pool_max`, domyślnie 10) i czas oczekiwania na wolne połączenie (10 sekund).

`Flavor` niesie te kilka faktów, według których rozgałęzia się reszta kodu: `transactional_ddl()` (PostgreSQL i SQLite), `is_mysql_family()`, `quote(identifier)` (backticki w MySQL i MariaDB, cudzysłowy w pozostałych) i `minimum_version()`.

Nie ma traitu dialektu. Kod budujący SQL sprawdza `Flavor` tam, gdzie silniki się różnią.

## Wykonywanie instrukcji

Trzy executory mają te same metody (`execute`, `fetch_all`, `has_rows`, `insert_returning_id`):

| Executor | Zastosowanie |
|---|---|
| `db.queries()` | Jedna instrukcja na dowolnym połączeniu z puli |
| `db.acquire()` → `Conn` | Kilka instrukcji na jednym połączeniu, np. uruchomienie migracji trzymające blokadę |
| `db.begin()` → `Tx` | Transakcja; porzucona bez `commit()` jest wycofywana |

Instrukcje pisze się z symbolami `?`, przepisywanymi na `$1, $2…` dla PostgreSQL. Wartości to `SqlValue`, zawsze wiązane jako parametry. Sam tekst SQL może zawierać tylko identyfikatory pochodzące ze zwalidowanego schematu, dlatego jest przekazywany do `sqlx` jako `AssertSqlSafe`.

**Dekodowanie sterowane schematem.** Odczyt przekazuje `ColumnKind` każdej wybranej kolumny, a wartości są dekodowane według tego rodzaju, a nie według typu zgłaszanego przez sterownik. Dzięki temu `JSON` z MariaDB (w rzeczywistości `LONGTEXT`), wartości logiczne `TINYINT(1)` z MySQL oraz tekstowe daty i liczby dziesiętne z SQLite wracają tak samo w każdym silniku. Zobacz `crates/verdin-db/src/value.rs`.

**Identyfikatory wstawionych wierszy.** `insert_returning_id` dopisuje `RETURNING id` w PostgreSQL, a w MySQL, MariaDB (`LAST_INSERT_ID`) i SQLite (`last_insert_rowid`) odczytuje identyfikator zgłoszony przez sterownik po wstawieniu.

**Naruszenia unikalności.** `DbError::unique_violation()` wyciąga z błędu sterownika nazwę indeksu (PostgreSQL, MySQL, MariaDB) lub listę kolumn (SQLite), aby Document Service mógł zgłosić `ValidationError` na właściwym atrybucie.

## Buildery SQL

Verdin buduje SQL własnymi małymi builderami zamiast ORM lub `sea-query`, bo tabele istnieją dopiero w czasie działania (pochodzą ze schematu) i bo dominują szczegóły dialektów: typowane NULL-e, kolacje, funkcje JSON i formaty tekstowe SQLite.

| Crate | Buduje |
|---|---|
| `verdin-migrate` (`sql.rs`, `Dialect`) | DDL: typy kolumn, `CREATE TABLE`, `ALTER TABLE`, indeksy, przebudowy tabel SQLite |
| `verdin-query` (`sql.rs`, `SqlBuilder`) | Klauzule `WHERE` dla filtrów (łącznie z podzapytaniami `EXISTS` dla relacji i ścieżkami JSON) oraz `ORDER BY` |
| `verdin-content` (`service.rs`) | Odczyty, wstawienia, aktualizacje, usunięcia, zapisy do tabel powiązań i zbiorcze zapytania populate |

Builder dokłada tekst SQL i nazwy `ident()` (cytowane dla danego flavor) oraz zbiera parametry przez `param()`, więc budowanie SQL i wiązanie wartości dzieje się w jednym miejscu.

### Typy kolumn w poszczególnych dialektach

| Typ modelu | PostgreSQL | MySQL / MariaDB | SQLite |
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

SQLite przechowuje liczby dziesiętne, daty i godziny jako tekst o stałym formacie, więc nic nie jest zaokrąglane, a kolejność tekstowa odpowiada kolejności liczbowej i chronologicznej. Który atrybut odpowiada któremu typowi modelu, opisują [typy atrybutów](/pl/reference/attribute-types/).

Tabele MySQL i MariaDB są tworzone z `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` i kolacją niewrażliwą na akcenty i wielkość liter: `utf8mb4_0900_ai_ci` w MySQL, `utf8mb4_uca1400_ai_ci` w MariaDB.

## Różnice między dialektami

| Temat | PostgreSQL | MySQL 8.4 | MariaDB | SQLite | Jak radzi sobie Verdin |
|---|---|---|---|---|---|
| Identyfikator wstawionego wiersza | `RETURNING` | brak `RETURNING` | id ze sterownika | id ze sterownika | `insert_returning_id()` |
| Transakcyjne DDL | tak | nie (niejawny commit) | nie | tak | Dziennik kroków w MySQL i MariaDB (zobacz [migracje](/pl/internals/migrations/)) |
| JSON | `jsonb` | `json` | alias `LONGTEXT` | tekst | Dekodowanie sterowane schematem |
| Wartości logiczne | `boolean` | `tinyint(1)` | `tinyint(1)` | integer | Dekodowanie sterowane schematem |
| Data z godziną | `timestamptz` | `datetime(3)` | `datetime(3)` | tekst ISO | Zawsze UTC; sesje rodziny MySQL używają strefy czasowej `+00:00` |
| Zestaw znaków i kolacja | UTF-8 | `utf8mb4`, `utf8mb4_0900_ai_ci` | `utf8mb4`, `utf8mb4_uca1400_ai_ci` | UTF-8, binarna | Ustawiane jawnie dla każdej tabeli |
| Dokładne dopasowanie tekstu (`$eq`, `$in`…) | `=` | `COLLATE utf8mb4_bin` | to samo | `=` | Te same wyniki w każdym silniku |
| `$contains`, `$startsWith`, `$endsWith` | `LIKE` | `LIKE … COLLATE utf8mb4_bin` | to samo | `instr()` / `substr()` | `LIKE` w SQLite ignoruje wielkość liter ASCII, więc nie jest używane do dopasowań z rozróżnianiem wielkości liter |
| `$containsi` i inne operatory `…i` | `ILIKE` | `LIKE` (kolacja niewrażliwa) | to samo | `LIKE` | SQLite sprowadza tylko wielkość liter ASCII |
| Filtry po ścieżkach JSON | `#>>` | `JSON_VALUE` | to samo | `json_extract` | Operand zależny od dialektu |
| Filtry po tablicach JSON | `jsonb_array_elements` | `JSON_TABLE` | to samo | `json_each` | `EXISTS` po elementach |
| `ALTER COLUMN` | pełne | `MODIFY COLUMN` | to samo | nieobsługiwane | SQLite: przebudowa tabeli (utworzenie, kopia, usunięcie, zmiana nazwy) |
| Blokady wierszy | `FOR UPDATE` | `FOR UPDATE` | `FOR UPDATE` | brak | Pomijane w SQLite, którego transakcje zapisu blokują bazę danych |
| Długość unikalnego indeksu tekstowego | — | 3072 bajty | to samo | — | `varchar(255)` w `utf8mb4` to 1020 bajtów; `text` nie może być unikalny |
| Rozmiar wiersza | — | 65 535 bajtów | to samo | — | Najwyżej 60 atrybutów `string`, `email`, `uid` lub `enumeration` na typ |

Wzorce `LIKE` escapują w danych użytkownika `%`, `_` i sam znak escape (`!`). Domyślne kolacje MySQL i MariaDB ignorują wielkość liter i akcenty, dlatego operatory dokładne dodają kolację binarną: `$eq` znaczy w MySQL to samo co w PostgreSQL. Przy ścieżkach JSON `JSON_VALUE` zwraca string z kolacją binarną, więc operatory niewrażliwe na wielkość liter porównują tam `LOWER()` po obu stronach.

`ORDER BY` stawia NULL-e na końcu w obu kierunkach i zawsze kończy się na `id`, więc paginacja jest stabilna w każdym silniku.
