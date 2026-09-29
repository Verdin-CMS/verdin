---
title: Capa de base de dades
description: Com parla Verdin amb PostgreSQL, MySQL, MariaDB i SQLite a través d'un sol tipus de connexió, un enum Flavor i els seus propis constructors SQL, i com gestiona les diferències de cada dialecte.
sidebar:
  order: 3
---

Aquesta pàgina explica com Verdin admet quatre motors de base de dades amb un sol camí de codi: el
crate `verdin-db` que connecta i executa, els constructors SQL que es ramifiquen segons el motor, i
les diferències de dialecte que gestionen. Llegeix-la abans d'escriure SQL en qualsevol lloc del
servidor. Com es disposen les taules és a [emmagatzematge](/ca/internals/storage/).

## Versions mínimes

`Database::connect` detecta el motor i la seva versió i es nega a iniciar-se per sota d'aquests
mínims (`Flavor::minimum_version` a `crates/verdin-db/src/lib.rs`):

| Motor | Mínim | Motiu |
|---|---|---|
| PostgreSQL | 14 | La versió més antiga que encara té suport oficial |
| MySQL | 8.4 LTS | La 8.0 va arribar al final de la seva vida l'abril de 2026 |
| MariaDB | 10.11 LTS | La versió de suport a llarg termini més antiga vigent; col·lació `utf8mb4_uca1400_ai_ci`, JSON utilitzable |
| SQLite | 3.35 | `ALTER TABLE … DROP COLUMN`; la biblioteca es compila dins del binari |

La CI executa totes les proves contra PostgreSQL 14 i 17, MySQL 8.4, MariaDB 10.11 i 11.4, i SQLite.
Consulta [proves](/ca/internals/testing/).

## Connexió

`verdin-db` embolcalla un pool de `sqlx` per backend:

```rust
pub enum Pool { Postgres(PgPool), MySql(MySqlPool), Sqlite(SqlitePool) }

pub enum Flavor { Postgres, MySql, MariaDb, Sqlite }

pub struct Database { pool: Pool, flavor: Flavor, version: Version }
```

- Esquemes d'URL: `postgres://` o `postgresql://`, `mysql://`, `mariadb://` (un àlies de
  `mysql://`) i `sqlite:`. MySQL i MariaDB comparteixen el driver MySQL de `sqlx`; el flavor surt de
  `SELECT VERSION()`, que conté `MariaDB` a MariaDB.
- Les connexions MySQL i MariaDB fan servir `utf8mb4` i defineixen el fus horari de la sessió a
  `+00:00`, de manera que totes les marques de temps es desen en UTC.
- Les connexions SQLite activen les claus foranes, fan servir el diari WAL i un temps d'espera per
  ocupat de 5 segons, i creen el fitxer de la base de dades (i la seva carpeta) si no existeix. Les
  bases de dades en memòria tenen una sola connexió, perquè cada connexió a `:memory:` obriria una
  base de dades diferent.
- `ConnectOptions` defineix la mida del pool (`[database].pool_max`, 10 per defecte) i el temps
  d'espera per a una connexió lliure (10 segons).

`Flavor` porta els pocs fets en què es ramifica la resta del codi: `transactional_ddl()` (PostgreSQL
i SQLite), `is_mysql_family()`, `quote(identifier)` (accents greus a MySQL i MariaDB, cometes dobles
a la resta) i `minimum_version()`.

No hi ha cap trait de dialecte. El codi que construeix SQL comprova el `Flavor` on els motors són
diferents.

## Execució de sentències

Tres executors comparteixen els mateixos mètodes (`execute`, `fetch_all`, `has_rows`,
`insert_returning_id`):

| Executor | Ús |
|---|---|
| `db.queries()` | Una sentència en qualsevol connexió del pool |
| `db.acquire()` → `Conn` | Diverses sentències en una connexió, com una execució de migració que manté un bloqueig |
| `db.begin()` → `Tx` | Una transacció; si es descarta sense `commit()`, es desfà |

Les sentències s'escriuen amb marcadors `?`, que es reescriuen a `$1, $2…` per a PostgreSQL. Els
valors són `SqlValue`, sempre enllaçats com a paràmetres. El text SQL mateix només pot contenir
identificadors que provenen de l'esquema validat, i per això es passa a `sqlx` com a
`AssertSqlSafe`.

**Descodificació basada en l'esquema.** Una lectura passa el `ColumnKind` de cada columna
seleccionada, i els valors es descodifiquen segons aquest tipus, no segons el tipus que informa el
driver. Això és el que fa que el `JSON` de MariaDB (en realitat `LONGTEXT`), els booleans
`TINYINT(1)` de MySQL i les dates i decimals en text de SQLite tornin igual a tots els motors.
Consulta `crates/verdin-db/src/value.rs`.

**Ids inserits.** `insert_returning_id` afegeix `RETURNING id` a PostgreSQL, i llegeix l'id que
informa el driver després de la inserció a MySQL, MariaDB (`LAST_INSERT_ID`) i SQLite
(`last_insert_rowid`).

**Violacions d'unicitat.** `DbError::unique_violation()` extreu el nom de l'índex (PostgreSQL,
MySQL, MariaDB) o la llista de columnes (SQLite) de l'error del driver, perquè el Document Service
pugui informar d'un `ValidationError` sobre l'atribut correcte.

## Constructors SQL

Verdin construeix l'SQL amb els seus propis constructors petits en lloc d'un ORM o de `sea-query`,
perquè les taules només existeixen en temps d'execució (surten de l'esquema) i perquè dominen els
detalls de cada dialecte: NULL tipats, col·lacions, funcions JSON i els formats de text de SQLite.

| Crate | Construeix |
|---|---|
| `verdin-migrate` (`sql.rs`, `Dialect`) | DDL: tipus de columna, `CREATE TABLE`, `ALTER TABLE`, índexs, reconstruccions de taules SQLite |
| `verdin-query` (`sql.rs`, `SqlBuilder`) | Clàusules `WHERE` per als filtres (incloses les subconsultes `EXISTS` de relacions i els camins JSON) i `ORDER BY` |
| `verdin-content` (`service.rs`) | Lectures, insercions, actualitzacions, eliminacions, escriptures a taules d'enllaç i consultes de populate agrupades |

Un constructor afegeix text SQL i noms amb `ident()` (entre cometes segons el flavor) i recull
paràmetres amb `param()`, de manera que construir l'SQL i enllaçar els valors passen en un sol lloc.

### Tipus de columna per dialecte

| Tipus del model | PostgreSQL | MySQL / MariaDB | SQLite |
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

SQLite desa els decimals, les dates i les hores com a text de format fix, de manera que no
s'arrodoneix res i l'ordre del text coincideix amb l'ordre numèric i cronològic. Quin atribut
correspon a quin tipus del model és a [tipus d'atribut](/ca/reference/attribute-types/).

Les taules de MySQL i MariaDB es creen amb `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` i una col·lació
que no distingeix accents ni majúscules: `utf8mb4_0900_ai_ci` a MySQL, `utf8mb4_uca1400_ai_ci` a
MariaDB.

## Diferències de dialecte

| Tema | PostgreSQL | MySQL 8.4 | MariaDB | SQLite | Com ho gestiona Verdin |
|---|---|---|---|---|---|
| Id inserit | `RETURNING` | sense `RETURNING` | id del driver | id del driver | `insert_returning_id()` |
| DDL transaccional | sí | no (commit implícit) | no | sí | Diari de passos a MySQL i MariaDB (consulta [migracions](/ca/internals/migrations/)) |
| JSON | `jsonb` | `json` | àlies de `LONGTEXT` | text | Descodificació basada en l'esquema |
| Booleans | `boolean` | `tinyint(1)` | `tinyint(1)` | integer | Descodificació basada en l'esquema |
| Data i hora | `timestamptz` | `datetime(3)` | `datetime(3)` | text ISO | Sempre UTC; les sessions de la família MySQL fan servir el fus horari `+00:00` |
| Joc de caràcters i col·lació | UTF-8 | `utf8mb4`, `utf8mb4_0900_ai_ci` | `utf8mb4`, `utf8mb4_uca1400_ai_ci` | UTF-8, binària | Definits explícitament per taula |
| Coincidència exacta de text (`$eq`, `$in`…) | `=` | `COLLATE utf8mb4_bin` | igual | `=` | Mateixos resultats a tots els motors |
| `$contains`, `$startsWith`, `$endsWith` | `LIKE` | `LIKE … COLLATE utf8mb4_bin` | igual | `instr()` / `substr()` | El `LIKE` de SQLite no distingeix majúscules ASCII, així que no es fa servir per a coincidències que les distingeixen |
| `$containsi` i altres operadors `…i` | `ILIKE` | `LIKE` (col·lació insensible) | igual | `LIKE` | SQLite només normalitza les majúscules ASCII |
| Filtres per camins JSON | `#>>` | `JSON_VALUE` | igual | `json_extract` | Operand per dialecte |
| Filtres sobre arrays JSON | `jsonb_array_elements` | `JSON_TABLE` | igual | `json_each` | `EXISTS` sobre els elements |
| `ALTER COLUMN` | complet | `MODIFY COLUMN` | igual | no admès | SQLite: reconstrueix la taula (crear, copiar, eliminar, reanomenar) |
| Bloquejos de fila | `FOR UPDATE` | `FOR UPDATE` | `FOR UPDATE` | cap | S'ometen a SQLite, on les transaccions d'escriptura bloquegen la base de dades |
| Longitud d'índex únic de text | — | 3.072 bytes | igual | — | `varchar(255)` en `utf8mb4` són 1.020 bytes; `text` no pot ser únic |
| Mida de fila | — | 65.535 bytes | igual | — | Com a màxim 60 atributs `string`, `email`, `uid` o `enumeration` per tipus |

Els patrons `LIKE` escapen `%`, `_` i el mateix caràcter d'escapament (`!`) a l'entrada de l'usuari.
Les col·lacions per defecte de MySQL i MariaDB no distingeixen majúscules ni accents, i per això els
operadors exactes hi afegeixen una col·lació binària: `$eq` vol dir el mateix a MySQL que a
PostgreSQL. Amb camins JSON, `JSON_VALUE` retorna una cadena amb col·lació binària, de manera que els
operadors que no distingeixen majúscules hi comparen `LOWER()` als dos costats.

`ORDER BY` posa els NULL al final en les dues direccions i sempre acaba amb `id`, de manera que la
paginació és estable a tots els motors.
