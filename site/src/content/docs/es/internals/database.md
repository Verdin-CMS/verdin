---
title: Capa de base de datos
description: Cómo habla Verdin con PostgreSQL, MySQL, MariaDB y SQLite a través de un único tipo de conexión, un enum Flavor y sus propios constructores de SQL, y cómo gestiona las diferencias de cada dialecto.
sidebar:
  order: 3
---

Esta página explica cómo soporta Verdin cuatro motores de base de datos con un único camino de código: el crate `verdin-db`, que conecta y ejecuta, los constructores de SQL que se ramifican según el motor y las diferencias de dialecto que gestionan. Léela antes de escribir SQL en cualquier parte del servidor. Cómo se organizan las tablas está en [almacenamiento](/es/internals/storage/).

## Versiones mínimas

`Database::connect` detecta el motor y su versión y se niega a arrancar por debajo de estos mínimos (`Flavor::minimum_version` en `crates/verdin-db/src/lib.rs`):

| Motor | Mínimo | Motivo |
|---|---|---|
| PostgreSQL | 14 | La versión más antigua que sigue teniendo soporte oficial |
| MySQL | 8.4 LTS | La 8.0 llegó al fin de su vida útil en abril de 2026 |
| MariaDB | 10.11 LTS | La versión de soporte extendido más antigua vigente; collation `utf8mb4_uca1400_ai_ci`, JSON utilizable |
| SQLite | 3.35 | `ALTER TABLE … DROP COLUMN`; la biblioteca va compilada dentro del binario |

La CI ejecuta todas las pruebas contra PostgreSQL 14 y 17, MySQL 8.4, MariaDB 10.11 y 11.4, y SQLite. Consulta [pruebas](/es/internals/testing/).

## Conexión

`verdin-db` envuelve un pool de `sqlx` por backend:

```rust
pub enum Pool { Postgres(PgPool), MySql(MySqlPool), Sqlite(SqlitePool) }

pub enum Flavor { Postgres, MySql, MariaDb, Sqlite }

pub struct Database { pool: Pool, flavor: Flavor, version: Version }
```

- Esquemas de URL: `postgres://` o `postgresql://`, `mysql://`, `mariadb://` (un alias de `mysql://`) y `sqlite:`. MySQL y MariaDB comparten el driver MySQL de `sqlx`; el flavor sale de `SELECT VERSION()`, que contiene `MariaDB` en MariaDB.
- Las conexiones MySQL y MariaDB usan `utf8mb4` y ponen la zona horaria de la sesión en `+00:00`, así que todas las marcas de tiempo se guardan en UTC.
- Las conexiones SQLite activan las claves foráneas, usan el journal WAL y un busy timeout de 5 segundos, y crean el archivo de la base de datos (y su carpeta) si no existe. Las bases de datos en memoria reciben una sola conexión, porque cada conexión a `:memory:` abriría una base de datos distinta.
- `ConnectOptions` define el tamaño del pool (`[database].pool_max`, 10 por defecto) y el tiempo de espera de una conexión libre (10 segundos).

`Flavor` lleva los pocos datos según los que se ramifica el resto del código: `transactional_ddl()` (PostgreSQL y SQLite), `is_mysql_family()`, `quote(identifier)` (acentos graves en MySQL y MariaDB, comillas dobles en los demás) y `minimum_version()`.

No hay ningún trait de dialecto. El código que construye SQL comprueba el `Flavor` allí donde los motores difieren.

## Ejecución de sentencias

Tres ejecutores comparten los mismos métodos (`execute`, `fetch_all`, `has_rows`, `insert_returning_id`):

| Ejecutor | Uso |
|---|---|
| `db.queries()` | Una sentencia en cualquier conexión del pool |
| `db.acquire()` → `Conn` | Varias sentencias en una misma conexión, como una ejecución de migraciones que mantiene un bloqueo |
| `db.begin()` → `Tx` | Una transacción; si se descarta sin `commit()`, se revierte |

Las sentencias se escriben con marcadores `?`, que se reescriben a `$1, $2…` para PostgreSQL. Los valores son `SqlValue`s, siempre pasados como parámetros. El texto SQL en sí solo puede contener identificadores que vengan del esquema validado, y por eso se pasa a `sqlx` como `AssertSqlSafe`.

**Decodificación guiada por el esquema.** Una lectura pasa el `ColumnKind` de cada columna seleccionada, y los valores se decodifican según ese tipo, no según el tipo que informa el driver. Esto es lo que hace que el `JSON` de MariaDB (en realidad `LONGTEXT`), los booleanos `TINYINT(1)` de MySQL y las fechas y decimales en texto de SQLite se devuelvan igual en todos los motores. Consulta `crates/verdin-db/src/value.rs`.

**Ids insertados.** `insert_returning_id` añade `RETURNING id` en PostgreSQL, y lee el id que informa el driver después del insert en MySQL, MariaDB (`LAST_INSERT_ID`) y SQLite (`last_insert_rowid`).

**Violaciones de unicidad.** `DbError::unique_violation()` extrae el nombre del índice (PostgreSQL, MySQL, MariaDB) o la lista de columnas (SQLite) del error del driver, para que el Document Service pueda informar de un `ValidationError` en el atributo correcto.

## Constructores de SQL

Verdin construye el SQL con sus propios constructores pequeños en lugar de con un ORM o `sea-query`, porque las tablas solo existen en tiempo de ejecución (vienen del esquema) y porque predominan los detalles de cada dialecto: NULLs tipados, collations, funciones JSON y los formatos de texto de SQLite.

| Crate | Construye |
|---|---|
| `verdin-migrate` (`sql.rs`, `Dialect`) | DDL: tipos de columna, `CREATE TABLE`, `ALTER TABLE`, índices, reconstrucciones de tablas de SQLite |
| `verdin-query` (`sql.rs`, `SqlBuilder`) | Cláusulas `WHERE` para los filtros (incluidas las subconsultas `EXISTS` de relaciones y las rutas JSON) y `ORDER BY` |
| `verdin-content` (`service.rs`) | Lecturas, inserciones, actualizaciones, borrados, escrituras en tablas de enlaces y consultas agrupadas de populate |

Un constructor añade texto SQL y nombres `ident()` (entrecomillados según el flavor) y recoge los parámetros con `param()`, así que construir el SQL y enlazar los valores ocurre en un mismo sitio.

### Tipos de columna por dialecto

| Tipo del modelo | PostgreSQL | MySQL / MariaDB | SQLite |
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

SQLite guarda los decimales, las fechas y las horas como texto de formato fijo, para que no se redondee nada y el orden del texto coincida con el orden numérico y cronológico. Qué atributo corresponde a qué tipo del modelo está en [tipos de atributo](/es/reference/attribute-types/).

Las tablas de MySQL y MariaDB se crean con `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` y una collation que no distingue acentos ni mayúsculas: `utf8mb4_0900_ai_ci` en MySQL y `utf8mb4_uca1400_ai_ci` en MariaDB.

## Diferencias de dialecto

| Tema | PostgreSQL | MySQL 8.4 | MariaDB | SQLite | Cómo lo gestiona Verdin |
|---|---|---|---|---|---|
| Id insertado | `RETURNING` | sin `RETURNING` | id del driver | id del driver | `insert_returning_id()` |
| DDL transaccional | sí | no (commit implícito) | no | sí | Diario de pasos en MySQL y MariaDB (consulta [migraciones](/es/internals/migrations/)) |
| JSON | `jsonb` | `json` | alias de `LONGTEXT` | texto | Decodificación guiada por el esquema |
| Booleanos | `boolean` | `tinyint(1)` | `tinyint(1)` | entero | Decodificación guiada por el esquema |
| Fecha y hora | `timestamptz` | `datetime(3)` | `datetime(3)` | texto ISO | Siempre UTC; las sesiones de la familia MySQL usan la zona horaria `+00:00` |
| Juego de caracteres y collation | UTF-8 | `utf8mb4`, `utf8mb4_0900_ai_ci` | `utf8mb4`, `utf8mb4_uca1400_ai_ci` | UTF-8, binaria | Se define explícitamente por tabla |
| Coincidencia exacta de texto (`$eq`, `$in`…) | `=` | `COLLATE utf8mb4_bin` | igual | `=` | Mismos resultados en todos los motores |
| `$contains`, `$startsWith`, `$endsWith` | `LIKE` | `LIKE … COLLATE utf8mb4_bin` | igual | `instr()` / `substr()` | El `LIKE` de SQLite no distingue mayúsculas ASCII, así que no se usa para las coincidencias que sí las distinguen |
| `$containsi` y los demás operadores `…i` | `ILIKE` | `LIKE` (collation insensible) | igual | `LIKE` | SQLite solo pliega las mayúsculas ASCII |
| Filtros por ruta JSON | `#>>` | `JSON_VALUE` | igual | `json_extract` | Operando por dialecto |
| Filtros sobre arrays JSON | `jsonb_array_elements` | `JSON_TABLE` | igual | `json_each` | `EXISTS` sobre los elementos |
| `ALTER COLUMN` | completo | `MODIFY COLUMN` | igual | no soportado | SQLite: reconstruir la tabla (crear, copiar, eliminar, renombrar) |
| Bloqueos de fila | `FOR UPDATE` | `FOR UPDATE` | `FOR UPDATE` | ninguno | Se omite en SQLite, cuyas transacciones de escritura bloquean la base de datos |
| Longitud de índice único de texto | — | 3.072 bytes | igual | — | `varchar(255)` en `utf8mb4` son 1.020 bytes; `text` no puede ser único |
| Tamaño de fila | — | 65.535 bytes | igual | — | Como máximo 60 atributos `string`, `email`, `uid` o `enumeration` por tipo |

Los patrones `LIKE` escapan `%`, `_` y el propio carácter de escape (`!`) en la entrada del usuario. Las collations por defecto de MySQL y MariaDB no distinguen mayúsculas ni acentos, y por eso los operadores exactos añaden una collation binaria: `$eq` significa lo mismo en MySQL que en PostgreSQL. Con las rutas JSON, `JSON_VALUE` devuelve una cadena con collation binaria, así que ahí los operadores que no distinguen mayúsculas comparan `LOWER()` en ambos lados.

`ORDER BY` pone los NULL al final en ambas direcciones y siempre termina con `id`, así que la paginación es estable en todos los motores.
