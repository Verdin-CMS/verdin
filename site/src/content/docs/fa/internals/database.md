---
title: لایهٔ پایگاه داده
description: Verdin چگونه از طریق یک نوع اتصال، یک enum به نام Flavor و سازنده‌های SQL خودش با PostgreSQL، MySQL، MariaDB و SQLite ارتباط برقرار می‌کند، و تفاوت‌های هر گویش را چگونه مدیریت می‌کند.
sidebar:
  order: 3
---

این صفحه توضیح می‌دهد Verdin چگونه با یک مسیر کد واحد از چهار موتور پایگاه داده پشتیبانی می‌کند: crate به نام `verdin-db` که اتصال برقرار و اجرا می‌کند، سازنده‌های SQL که بر اساس موتور شاخه می‌زنند، و تفاوت‌های گویشی که مدیریت می‌کنند. پیش از نوشتن SQL در هر جای سرور، آن را بخوانید. چیدمان جدول‌ها در [ذخیره‌سازی](/fa/internals/storage/) آمده است.

## حداقل نسخه‌ها

`Database::connect` موتور و نسخهٔ آن را تشخیص می‌دهد و زیر این حداقل‌ها از شروع خودداری می‌کند (`Flavor::minimum_version` در `crates/verdin-db/src/lib.rs`):

| موتور | حداقل | دلیل |
|---|---|---|
| PostgreSQL | 14 | قدیمی‌ترین نسخه‌ای که هنوز در upstream پشتیبانی می‌شود |
| MySQL | 8.4 LTS | عمر 8.0 در آوریل 2026 به پایان رسید |
| MariaDB | 10.11 LTS | قدیمی‌ترین نسخهٔ پشتیبانی بلندمدت فعلی؛ collation `utf8mb4_uca1400_ai_ci`، JSON قابل استفاده |
| SQLite | 3.35 | `ALTER TABLE … DROP COLUMN`؛ کتابخانه درون فایل باینری کامپایل می‌شود |

CI همهٔ تست‌ها را روی PostgreSQL 14 و 17، MySQL 8.4، MariaDB 10.11 و 11.4، و SQLite اجرا می‌کند. [تست](/fa/internals/testing/) را ببینید.

## اتصال

`verdin-db` برای هر backend یک pool از `sqlx` را می‌پوشاند:

```rust
pub enum Pool { Postgres(PgPool), MySql(MySqlPool), Sqlite(SqlitePool) }

pub enum Flavor { Postgres, MySql, MariaDb, Sqlite }

pub struct Database { pool: Pool, flavor: Flavor, version: Version }
```

- schemeهای URL: `postgres://` یا `postgresql://`، `mysql://`، `mariadb://` (نام مستعار `mysql://`) و `sqlite:`. MySQL و MariaDB درایور MySQL در `sqlx` را به اشتراک می‌گذارند؛ flavor از `SELECT VERSION()` می‌آید که در MariaDB شامل `MariaDB` است.
- اتصال‌های MySQL و MariaDB از `utf8mb4` استفاده می‌کنند و منطقهٔ زمانی نشست را `+00:00` تنظیم می‌کنند، بنابراین هر مُهر زمانی به وقت UTC ذخیره می‌شود.
- اتصال‌های SQLite کلیدهای خارجی را روشن می‌کنند، از journaling از نوع WAL و مهلت busy پنج‌ثانیه‌ای استفاده می‌کنند، و اگر فایل پایگاه داده (و پوشهٔ آن) وجود نداشته باشد آن را می‌سازند. پایگاه‌های دادهٔ درون حافظه فقط یک اتصال می‌گیرند، چون هر اتصال به `:memory:` پایگاه دادهٔ متفاوتی باز می‌کند.
- `ConnectOptions` اندازهٔ pool (`[database].pool_max`، به‌طور پیش‌فرض 10) و زمان انتظار برای یک اتصال آزاد (10 ثانیه) را تنظیم می‌کند.

`Flavor` چند واقعیتی را حمل می‌کند که بقیهٔ کد بر اساس آن‌ها شاخه می‌زند: `transactional_ddl()` (PostgreSQL و SQLite)، `is_mysql_family()`، `quote(identifier)` (backtick در MySQL و MariaDB، گیومهٔ دوتایی در بقیه) و `minimum_version()`.

هیچ trait گویشی وجود ندارد. کدی که SQL می‌سازد، هر جا موتورها با هم فرق دارند، `Flavor` را بررسی می‌کند.

## اجرای دستورها

سه executor متدهای یکسانی دارند (`execute`، `fetch_all`، `has_rows`، `insert_returning_id`):

| Executor | کاربرد |
|---|---|
| `db.queries()` | یک دستور روی هر اتصالی از pool |
| `db.acquire()` → `Conn` | چند دستور روی یک اتصال، مانند اجرای مهاجرتی که یک قفل را نگه می‌دارد |
| `db.begin()` → `Tx` | یک تراکنش؛ اگر بدون `commit()` رها شود، rollback می‌شود |

دستورها با placeholderهای `?` نوشته می‌شوند که برای PostgreSQL به `$1, $2…` بازنویسی می‌شوند. مقدارها `SqlValue` هستند و همیشه به‌صورت پارامتر متصل می‌شوند. خود متن SQL فقط می‌تواند شامل شناسه‌هایی باشد که از طرح‌وارهٔ اعتبارسنجی‌شده می‌آیند، و به همین دلیل به شکل `AssertSqlSafe` به `sqlx` داده می‌شود.

**decode مبتنی بر طرح‌واره.** یک خواندن `ColumnKind` هر ستون انتخاب‌شده را می‌فرستد و مقدارها بر اساس همان kind decode می‌شوند، نه بر اساس نوعی که درایور گزارش می‌دهد. همین باعث می‌شود `JSON` در MariaDB (که در واقع `LONGTEXT` است)، بولی‌های `TINYINT(1)` در MySQL و تاریخ‌ها و اعداد اعشاری متنی SQLite روی همهٔ موتورها یکسان برگردند. `crates/verdin-db/src/value.rs` را ببینید.

**شناسه‌های درج‌شده.** `insert_returning_id` در PostgreSQL عبارت `RETURNING id` را اضافه می‌کند، و در MySQL، MariaDB (`LAST_INSERT_ID`) و SQLite (`last_insert_rowid`) شناسه‌ای را که درایور پس از درج گزارش می‌دهد می‌خواند.

**نقض یکتایی.** `DbError::unique_violation()` نام نمایه (PostgreSQL، MySQL، MariaDB) یا فهرست ستون‌ها (SQLite) را از خطای درایور استخراج می‌کند، تا Document Service (سرویس سند) بتواند یک `ValidationError` را روی ویژگی درست گزارش کند.

## سازنده‌های SQL

Verdin به جای ORM یا `sea-query`، SQL را با سازنده‌های کوچک خودش می‌سازد، چون جدول‌ها فقط در زمان اجرا وجود دارند (از طرح‌واره می‌آیند) و چون جزئیات هر گویش غالب‌اند: NULLهای تایپ‌شده، collationها، تابع‌های JSON و قالب‌های متنی SQLite.

| Crate | می‌سازد |
|---|---|
| `verdin-migrate` (`sql.rs`، `Dialect`) | DDL: نوع ستون‌ها، `CREATE TABLE`، `ALTER TABLE`، نمایه‌ها، بازسازی جدول در SQLite |
| `verdin-query` (`sql.rs`، `SqlBuilder`) | بندهای `WHERE` برای فیلترها (از جمله زیرکوئری‌های `EXISTS` برای روابط و مسیرهای JSON) و `ORDER BY` |
| `verdin-content` (`service.rs`) | خواندن‌ها، درج‌ها، به‌روزرسانی‌ها، حذف‌ها، نوشتن در جدول‌های پیوند و کوئری‌های دسته‌ای populate |

یک سازنده متن SQL و نام‌های `ident()` (با نقل‌قول مناسب flavor) را اضافه می‌کند و پارامترها را با `param()` جمع می‌کند، بنابراین ساختن SQL و متصل کردن مقدارها در یک جا انجام می‌شود.

### نوع ستون‌ها در هر گویش

| نوع مدل | PostgreSQL | MySQL / MariaDB | SQLite |
|---|---|---|---|
| id | `bigint` identity | `bigint AUTO_INCREMENT` | `integer PRIMARY KEY AUTOINCREMENT` |
| integer، bigint، smallint | `integer`، `bigint`، `smallint` | `int`، `bigint`، `smallint` | `integer` |
| double | `double precision` | `double` | `real` |
| decimal | `numeric(p,s)` | `decimal(p,s)` | `text` |
| boolean | `boolean` | `tinyint(1)` | `integer` |
| char، varchar | `char(n)`، `varchar(n)` | `char(n)`، `varchar(n)` | `text` |
| text | `text` | `longtext` | `text` |
| date، time، datetime | `date`، `time(3)`، `timestamptz(3)` | `date`، `time(3)`، `datetime(3)` | `text` |
| json | `jsonb` | `json` | `text` |

SQLite تاریخ‌ها و زمان‌ها را به‌صورت متن با قالب ثابت ذخیره می‌کند، تا ترتیب متنی با ترتیب زمانی یکسان باشد. اعداد اعشاری را هم به‌صورت متن ذخیره می‌کند، پس هنگام ذخیره هیچ چیزی گرد نمی‌شود. ترتیب متنی برای اعداد اعشاری ترتیب عددی نیست، بنابراین فیلترها و مرتب‌سازی‌ها روی یک ستون اعشاری در SQLite ستون را به `REAL` تبدیل می‌کنند. این مقایسه‌ها تا حدود 15 رقم معنادار دقیق‌اند، و مقدارهای برگردانده‌شده همچنان دقیق هستند. اینکه هر ویژگی به کدام نوع مدل نگاشت می‌شود در [نوع‌های ویژگی](/fa/reference/attribute-types/) آمده است.

جدول‌های MySQL و MariaDB با `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` و یک collation غیرحساس به اعراب و بزرگی و کوچکی حروف ساخته می‌شوند: `utf8mb4_0900_ai_ci` در MySQL و `utf8mb4_uca1400_ai_ci` در MariaDB.

## تفاوت‌های گویش‌ها

| موضوع | PostgreSQL | MySQL 8.4 | MariaDB | SQLite | Verdin چگونه آن را مدیریت می‌کند |
|---|---|---|---|---|---|
| شناسهٔ درج‌شده | `RETURNING` | بدون `RETURNING` | شناسهٔ درایور | شناسهٔ درایور | `insert_returning_id()` |
| DDL تراکنشی | بله | نه (commit ضمنی) | نه | بله | journal گام‌ها در MySQL و MariaDB ([مهاجرت‌ها](/fa/internals/migrations/) را ببینید) |
| JSON | `jsonb` | `json` | نام مستعار `LONGTEXT` | متن | decode مبتنی بر طرح‌واره |
| بولی‌ها | `boolean` | `tinyint(1)` | `tinyint(1)` | integer | decode مبتنی بر طرح‌واره |
| تاریخ‌وزمان | `timestamptz` | `datetime(3)` | `datetime(3)` | متن ISO | همیشه UTC؛ نشست‌های خانوادهٔ MySQL از منطقهٔ زمانی `+00:00` استفاده می‌کنند |
| Charset و collation | UTF-8 | `utf8mb4`، `utf8mb4_0900_ai_ci` | `utf8mb4`، `utf8mb4_uca1400_ai_ci` | UTF-8، باینری | به‌صراحت برای هر جدول تنظیم می‌شود |
| تطبیق دقیق متن (`$eq`، `$in`…) | `=` | `COLLATE utf8mb4_bin` | همان | `=` | نتیجهٔ یکسان روی همهٔ موتورها |
| `$contains`، `$startsWith`، `$endsWith` | `LIKE` | `LIKE … COLLATE utf8mb4_bin` | همان | `instr()` / `substr()` | `LIKE` در SQLite بزرگی و کوچکی حروف ASCII را نادیده می‌گیرد، پس برای تطبیق‌های حساس به حروف استفاده نمی‌شود |
| `$containsi` و دیگر عملگرهای `…i` | `ILIKE` | `LIKE` (collation غیرحساس) | همان | `LIKE` | SQLite فقط حروف ASCII را یکسان می‌کند |
| فیلترهای مسیر JSON | `#>>` | `JSON_VALUE` | همان | `json_extract` | عملوند مخصوص هر گویش |
| فیلترهای آرایهٔ JSON | `jsonb_array_elements` | `JSON_TABLE` | همان | `json_each` | `EXISTS` روی آیتم‌ها |
| `ALTER COLUMN` | کامل | `MODIFY COLUMN` | همان | پشتیبانی نمی‌شود | SQLite: بازسازی جدول (ساختن، کپی، حذف، تغییرنام) |
| قفل ردیف | `FOR UPDATE` | `FOR UPDATE` | `FOR UPDATE` | هیچ | در SQLite حذف می‌شود، چون تراکنش‌های نوشتن آن کل پایگاه داده را قفل می‌کنند |
| طول نمایهٔ یکتای متنی | — | 3,072 بایت | همان | — | `varchar(255)` در `utf8mb4` برابر 1,020 بایت است؛ `text` نمی‌تواند یکتا باشد |
| اندازهٔ ردیف | — | 65,535 بایت | همان | — | حداکثر 60 ویژگی `string`، `email`، `uid` یا `enumeration` برای هر نوع |

الگوهای `LIKE` در ورودی کاربر `%`، `_` و خود نویسهٔ escape (`!`) را escape می‌کنند. collationهای پیش‌فرض MySQL و MariaDB بزرگی و کوچکی حروف و اعراب را نادیده می‌گیرند، و به همین دلیل عملگرهای دقیق یک collation باینری اضافه می‌کنند: `$eq` در MySQL همان معنایی را دارد که در PostgreSQL. در مسیرهای JSON، `JSON_VALUE` یک رشته با collation باینری برمی‌گرداند، بنابراین عملگرهای غیرحساس به حروف در آنجا `LOWER()` هر دو طرف را مقایسه می‌کنند.

`ORDER BY` مقدارهای NULL را در هر دو جهت در انتها قرار می‌دهد و همیشه با `id` پایان می‌یابد، بنابراین صفحه‌بندی روی همهٔ موتورها پایدار است.
