---
title: Шар бази даних
description: Як Verdin працює з PostgreSQL, MySQL, MariaDB і SQLite через один тип з'єднання, enum Flavor і власні SQL-білдери і як він обробляє відмінності кожного діалекту.
sidebar:
  order: 3
---

На цій сторінці пояснено, як Verdin підтримує чотири рушії баз даних одним шляхом коду: crate `verdin-db`, що підключається й виконує запити, SQL-білдери, що розгалужуються за рушієм, і відмінності діалектів, які вони обробляють. Прочитайте її, перш ніж писати SQL будь-де на сервері. Як розкладено таблиці, описано в [сховищі](/uk/internals/storage/).

## Мінімальні версії

`Database::connect` визначає рушій і його версію та відмовляється запускатися нижче цих мінімумів (`Flavor::minimum_version` у `crates/verdin-db/src/lib.rs`):

| Рушій | Мінімум | Причина |
|---|---|---|
| PostgreSQL | 14 | Найстаріша версія, яку ще підтримують розробники |
| MySQL | 8.4 LTS | Підтримку 8.0 завершено у квітні 2026 |
| MariaDB | 10.11 LTS | Найстаріший актуальний довгостроковий реліз; колація `utf8mb4_uca1400_ai_ci`, придатний JSON |
| SQLite | 3.35 | `ALTER TABLE … DROP COLUMN`; бібліотеку вкомпільовано в бінарник |

CI запускає всі тести на PostgreSQL 14 і 17, MySQL 8.4, MariaDB 10.11 і 11.4 та SQLite. Див. [тестування](/uk/internals/testing/).

## Підключення

`verdin-db` обгортає один пул `sqlx` на бекенд:

```rust
pub enum Pool { Postgres(PgPool), MySql(MySqlPool), Sqlite(SqlitePool) }

pub enum Flavor { Postgres, MySql, MariaDb, Sqlite }

pub struct Database { pool: Pool, flavor: Flavor, version: Version }
```

- Схеми URL: `postgres://` або `postgresql://`, `mysql://`, `mariadb://` (псевдонім `mysql://`) і `sqlite:`. MySQL і MariaDB використовують спільний драйвер MySQL у `sqlx`; flavor визначається з `SELECT VERSION()`, що в MariaDB містить `MariaDB`.
- З'єднання MySQL і MariaDB використовують `utf8mb4` і встановлюють часовий пояс сесії `+00:00`, тож кожна мітка часу зберігається в UTC.
- З'єднання SQLite вмикають зовнішні ключі, використовують журнал WAL і 5-секундний busy timeout та створюють файл бази даних (і його папку), якщо їх немає. Бази даних у пам'яті отримують одне з'єднання, бо кожне з'єднання з `:memory:` відкривало б іншу базу.
- `ConnectOptions` задає розмір пулу (`[database].pool_max`, типово 10) і час очікування вільного з'єднання (10 секунд).

`Flavor` містить кілька фактів, за якими розгалужується решта коду: `transactional_ddl()` (PostgreSQL і SQLite), `is_mysql_family()`, `quote(identifier)` (зворотні лапки в MySQL і MariaDB, подвійні лапки деінде) і `minimum_version()`.

Trait діалекту немає. Код, що будує SQL, перевіряє `Flavor` там, де рушії різняться.

## Виконання операторів

Три виконавці мають однакові методи (`execute`, `fetch_all`, `has_rows`, `insert_returning_id`):

| Виконавець | Використання |
|---|---|
| `db.queries()` | Один оператор на будь-якому з'єднанні з пулу |
| `db.acquire()` → `Conn` | Кілька операторів на одному з'єднанні, наприклад запуск міграції, що тримає блокування |
| `db.begin()` → `Tx` | Транзакція; якщо її відкинуто без `commit()`, вона відкочується |

Оператори пишуться з плейсхолдерами `?`, які для PostgreSQL переписуються на `$1, $2…`. Значення — це `SqlValue`, завжди прив'язані як параметри. Сам текст SQL може містити лише ідентифікатори з перевіреної схеми, тому він передається в `sqlx` як `AssertSqlSafe`.

**Декодування на основі схеми.** Читання передає `ColumnKind` кожної вибраної колонки, і значення декодуються за цим видом, а не за типом, який повідомляє драйвер. Саме завдяки цьому `JSON` у MariaDB (насправді `LONGTEXT`), булеві `TINYINT(1)` у MySQL і текстові дати й десяткові числа в SQLite повертаються однаково в кожному рушії. Див. `crates/verdin-db/src/value.rs`.

**Id вставлених рядків.** `insert_returning_id` додає `RETURNING id` у PostgreSQL і читає id, який повідомляє драйвер після вставки, у MySQL, MariaDB (`LAST_INSERT_ID`) і SQLite (`last_insert_rowid`).

**Порушення унікальності.** `DbError::unique_violation()` витягає з помилки драйвера назву індексу (PostgreSQL, MySQL, MariaDB) або список колонок (SQLite), тож Document Service може повідомити `ValidationError` для правильного атрибута.

## SQL-білдери

Verdin будує SQL власними невеликими білдерами замість ORM чи `sea-query`, бо таблиці існують лише під час виконання (вони беруться зі схеми) і бо переважають подробиці окремих діалектів: типізовані NULL, колації, JSON-функції та текстові формати SQLite.

| Crate | Що будує |
|---|---|
| `verdin-migrate` (`sql.rs`, `Dialect`) | DDL: типи колонок, `CREATE TABLE`, `ALTER TABLE`, індекси, перебудови таблиць SQLite |
| `verdin-query` (`sql.rs`, `SqlBuilder`) | Клаузи `WHERE` для фільтрів (включно з підзапитами `EXISTS` для зв'язків і JSON-шляхами) і `ORDER BY` |
| `verdin-content` (`service.rs`) | Читання, вставки, оновлення, видалення, записи в таблиці зв'язків і пакетні запити populate |

Білдер додає текст SQL і назви через `ident()` (у лапках для flavor) та збирає параметри через `param()`, тож побудова SQL і прив'язка значень відбуваються в одному місці.

### Типи колонок за діалектом

| Тип моделі | PostgreSQL | MySQL / MariaDB | SQLite |
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

SQLite зберігає дати й час як текст фіксованого формату, тож текстовий порядок збігається з хронологічним. Десяткові числа він теж зберігає як текст, тож нічого не округлюється під час збереження. Текстовий порядок для десяткових чисел не числовий, тому фільтри й сортування за десятковим полем на SQLite приводять колонку до `REAL`. Такі порівняння точні приблизно до 15 значущих цифр, а повернені значення залишаються точними. Який атрибут якому типу моделі відповідає, описано в [типах атрибутів](/uk/reference/attribute-types/).

Таблиці MySQL і MariaDB створюються з `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` і колацією, нечутливою до діакритики й регістру: `utf8mb4_0900_ai_ci` у MySQL, `utf8mb4_uca1400_ai_ci` у MariaDB.

## Відмінності діалектів

| Тема | PostgreSQL | MySQL 8.4 | MariaDB | SQLite | Як це обробляє Verdin |
|---|---|---|---|---|---|
| Id вставленого рядка | `RETURNING` | без `RETURNING` | id драйвера | id драйвера | `insert_returning_id()` |
| Транзакційний DDL | так | ні (неявний commit) | ні | так | Журнал кроків у MySQL і MariaDB (див. [міграції](/uk/internals/migrations/)) |
| JSON | `jsonb` | `json` | псевдонім `LONGTEXT` | текст | Декодування на основі схеми |
| Булеві | `boolean` | `tinyint(1)` | `tinyint(1)` | integer | Декодування на основі схеми |
| Дата з часом | `timestamptz` | `datetime(3)` | `datetime(3)` | текст ISO | Завжди UTC; сесії родини MySQL використовують часовий пояс `+00:00` |
| Кодування й колація | UTF-8 | `utf8mb4`, `utf8mb4_0900_ai_ci` | `utf8mb4`, `utf8mb4_uca1400_ai_ci` | UTF-8, binary | Задаються явно для кожної таблиці |
| Точний збіг тексту (`$eq`, `$in`…) | `=` | `COLLATE utf8mb4_bin` | те саме | `=` | Однакові результати в кожному рушії |
| `$contains`, `$startsWith`, `$endsWith` | `LIKE` | `LIKE … COLLATE utf8mb4_bin` | те саме | `instr()` / `substr()` | `LIKE` у SQLite ігнорує регістр ASCII, тож для чутливих до регістру збігів не використовується |
| `$containsi` та інші оператори `…i` | `ILIKE` | `LIKE` (нечутлива колація) | те саме | `LIKE` | SQLite зводить регістр лише для ASCII |
| Фільтри за JSON-шляхом | `#>>` | `JSON_VALUE` | те саме | `json_extract` | Операнд для кожного діалекту |
| Фільтри за JSON-масивом | `jsonb_array_elements` | `JSON_TABLE` | те саме | `json_each` | `EXISTS` за елементами |
| `ALTER COLUMN` | повністю | `MODIFY COLUMN` | те саме | не підтримується | SQLite: перебудова таблиці (create, copy, drop, rename) |
| Блокування рядків | `FOR UPDATE` | `FOR UPDATE` | `FOR UPDATE` | немає | Пропускається в SQLite, чиї транзакції запису блокують базу даних |
| Довжина унікального текстового індексу | — | 3 072 байти | те саме | — | `varchar(255)` в `utf8mb4` — це 1 020 байтів; `text` не може бути унікальним |
| Розмір рядка | — | 65 535 байтів | те саме | — | Щонайбільше 60 атрибутів `string`, `email`, `uid` або `enumeration` на тип |

Шаблони `LIKE` екранують `%`, `_` і сам символ екранування (`!`) у введенні користувача. Типові колації MySQL і MariaDB ігнорують регістр і діакритику, тому точні оператори додають бінарну колацію: `$eq` означає в MySQL те саме, що й у PostgreSQL. Із JSON-шляхами `JSON_VALUE` повертає рядок із бінарною колацією, тож нечутливі до регістру оператори там порівнюють `LOWER()` з обох боків.

`ORDER BY` ставить NULL в кінець в обох напрямках і завжди завершується `id`, тож пагінація стабільна в кожному рушії.
