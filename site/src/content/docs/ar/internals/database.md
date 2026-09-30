---
title: طبقة قاعدة البيانات
description: كيف يتحدث Verdin إلى PostgreSQL وMySQL وMariaDB وSQLite عبر نوع اتصال واحد، وتعداد Flavor، ومنشئات SQL خاصة به، وكيف يتعامل مع اختلافات كل لهجة.
sidebar:
  order: 3
---

تشرح هذه الصفحة كيف يدعم Verdin أربعة محركات قواعد بيانات بمسار شيفرة واحد: الـ crate ‏`verdin-db` الذي يتصل وينفّذ، ومنشئات SQL التي تتفرع حسب المحرك، واختلافات اللهجات التي تتعامل معها. اقرأها قبل أن تكتب SQL في أي مكان في الخادم. أما كيفية ترتيب الجداول ففي [التخزين](/ar/internals/storage/).

## الحد الأدنى للإصدارات

يكتشف `Database::connect` المحرك وإصداره ويرفض البدء تحت هذه الحدود الدنيا (`Flavor::minimum_version` في `crates/verdin-db/src/lib.rs`):

| المحرك | الحد الأدنى | السبب |
|---|---|---|
| PostgreSQL | 14 | أقدم إصدار لا يزال مدعومًا من المشروع الأصلي |
| MySQL | 8.4 LTS | بلغ 8.0 نهاية عمره في أبريل 2026 |
| MariaDB | 10.11 LTS | أقدم إصدار حالي طويل الأمد؛ ترتيب `utf8mb4_uca1400_ai_ci`، وJSON قابل للاستخدام |
| SQLite | 3.35 | `ALTER TABLE … DROP COLUMN`؛ والمكتبة مصرَّفة داخل الملف التنفيذي |

يشغّل CI كل اختبار على PostgreSQL 14 و17، وMySQL 8.4، وMariaDB 10.11 و11.4، وSQLite. راجع [الاختبار](/ar/internals/testing/).

## الاتصال

يغلّف `verdin-db` مجمّع `sqlx` واحدًا لكل خلفية:

```rust
pub enum Pool { Postgres(PgPool), MySql(MySqlPool), Sqlite(SqlitePool) }

pub enum Flavor { Postgres, MySql, MariaDb, Sqlite }

pub struct Database { pool: Pool, flavor: Flavor, version: Version }
```

- مخططات عناوين URL: `postgres://` أو `postgresql://`، و`mysql://`، و`mariadb://` (اسم بديل لـ `mysql://`) و`sqlite:`. يتشارك MySQL وMariaDB مشغّل MySQL في `sqlx`؛ ويأتي الـ flavor من `SELECT VERSION()`، الذي يحتوي على `MariaDB` في MariaDB.
- تستخدم اتصالات MySQL وMariaDB ‏`utf8mb4` وتعيّن المنطقة الزمنية للجلسة إلى `+00:00`، فيُخزَّن كل طابع زمني بتوقيت UTC.
- تفعّل اتصالات SQLite المفاتيح الأجنبية، وتستخدم سجل WAL ومهلة انشغال مدتها 5 ثوانٍ، وتنشئ ملف قاعدة البيانات (ومجلده) إن كان مفقودًا. تحصل قواعد البيانات في الذاكرة على اتصال واحد، لأن كل اتصال بـ `:memory:` سيفتح قاعدة بيانات مختلفة.
- يعيّن `ConnectOptions` حجم المجمّع (`[database].pool_max`، 10 افتراضيًا) ومدة انتظار اتصال حر (10 ثوانٍ).

يحمل `Flavor` الحقائق القليلة التي تتفرع عليها بقية الشيفرة: `transactional_ddl()` (PostgreSQL وSQLite)، و`is_mysql_family()`، و`quote(identifier)` (علامات backtick في MySQL وMariaDB، وعلامات اقتباس مزدوجة في غيرهما) و`minimum_version()`.

لا يوجد trait للهجات. الشيفرة التي تبني SQL تتحقق من `Flavor` حيث تختلف المحركات.

## تنفيذ التعليمات

تتشارك ثلاثة منفّذات الطرق نفسها (`execute`، `fetch_all`، `has_rows`، `insert_returning_id`):

| المنفّذ | الاستخدام |
|---|---|
| `db.queries()` | تعليمة واحدة على أي اتصال من المجمّع |
| `db.acquire()` ← `Conn` | عدة تعليمات على اتصال واحد، مثل تشغيل ترحيل يمسك قفلًا |
| `db.begin()` ← `Tx` | معاملة؛ إذا أُسقطت دون `commit()` فإنها تتراجع |

تُكتب التعليمات بعناصر نائبة `?`، تُعاد كتابتها إلى `$1, $2…` في PostgreSQL. القيم من نوع `SqlValue`، وتُربط دائمًا كمعاملات. ولا يجوز أن يحتوي نص SQL نفسه إلا على معرّفات تأتي من المخطط المتحقق منه، ولهذا يُمرَّر إلى `sqlx` كـ `AssertSqlSafe`.

**فك الترميز المبني على المخطط.** تمرّر القراءة `ColumnKind` لكل عمود محدد، وتُفك ترميز القيم حسب ذلك النوع، لا حسب النوع الذي يبلّغ عنه المشغّل. هذا ما يجعل `JSON` في MariaDB (وهو في الحقيقة `LONGTEXT`)، والقيم المنطقية `TINYINT(1)` في MySQL، والتواريخ والأرقام العشرية النصية في SQLite تعود بالطريقة نفسها على كل محرك. راجع `crates/verdin-db/src/value.rs`.

**المعرّفات المُدرجة.** يلحق `insert_returning_id` العبارة `RETURNING id` في PostgreSQL، ويقرأ المعرّف الذي يبلّغ عنه المشغّل بعد الإدراج في MySQL وMariaDB (`LAST_INSERT_ID`) وSQLite (`last_insert_rowid`).

**انتهاكات التفرّد.** يستخرج `DbError::unique_violation()` اسم الفهرس (PostgreSQL وMySQL وMariaDB) أو قائمة الأعمدة (SQLite) من خطأ المشغّل، فتستطيع خدمة المستندات (Document Service) الإبلاغ عن `ValidationError` على السمة الصحيحة.

## منشئات SQL

يبني Verdin الـ SQL بمنشئاته الصغيرة الخاصة بدلًا من ORM أو `sea-query`، لأن الجداول لا توجد إلا وقت التشغيل (فهي تأتي من المخطط) ولأن تفاصيل كل لهجة هي الغالبة: قيم NULL المُنمَّطة، والترتيبات (collations)، ودوال JSON، والصيغ النصية في SQLite.

| الـ crate | يبني |
|---|---|
| `verdin-migrate` (`sql.rs`، `Dialect`) | DDL: أنواع الأعمدة، و`CREATE TABLE`، و`ALTER TABLE`، والفهارس، وإعادات بناء جداول SQLite |
| `verdin-query` (`sql.rs`، `SqlBuilder`) | عبارات `WHERE` لعوامل التصفية (بما في ذلك استعلامات `EXISTS` الفرعية للعلاقات ومسارات JSON) و`ORDER BY` |
| `verdin-content` (`service.rs`) | القراءات، والإدراجات، والتحديثات، والحذف، والكتابة في جداول الربط، واستعلامات التعبئة المجمّعة |

يدفع المنشئ نص SQL وأسماء `ident()` (مقتبسة وفق الـ flavor) ويجمع المعاملات بـ `param()`، فيحدث بناء SQL وربط القيم في مكان واحد.

### أنواع الأعمدة لكل لهجة

| نوع النموذج | PostgreSQL | MySQL / MariaDB | SQLite |
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

يخزّن SQLite التواريخ والأوقات كنص بصيغة ثابتة، فيطابق الترتيب النصي الترتيب الزمني. ويخزّن الأرقام العشرية كنص أيضًا، فلا يُقرَّب شيء عند حفظها. لكن الترتيب النصي ليس ترتيبًا رقميًا للأعداد العشرية، لذا تحوّل عوامل التصفية والترتيب على عمود عشري العمود إلى `REAL` في SQLite. هذه المقارنات دقيقة حتى نحو 15 رقمًا معنويًا، وتبقى القيم المُعادة دقيقة. أي سمة تقابل أي نوع نموذج موجود في [أنواع السمات](/ar/reference/attribute-types/).

تُنشأ جداول MySQL وMariaDB بـ `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` وبترتيب لا يميّز العلامات وحالة الأحرف: `utf8mb4_0900_ai_ci` في MySQL، و`utf8mb4_uca1400_ai_ci` في MariaDB.

## اختلافات اللهجات

| الموضوع | PostgreSQL | MySQL 8.4 | MariaDB | SQLite | كيف يتعامل Verdin معه |
|---|---|---|---|---|---|
| المعرّف المُدرج | `RETURNING` | بلا `RETURNING` | معرّف المشغّل | معرّف المشغّل | `insert_returning_id()` |
| DDL ضمن معاملة | نعم | لا (اعتماد ضمني) | لا | نعم | سجل خطوات في MySQL وMariaDB (راجع [الترحيلات](/ar/internals/migrations/)) |
| JSON | `jsonb` | `json` | اسم بديل لـ `LONGTEXT` | نص | فك الترميز المبني على المخطط |
| القيم المنطقية | `boolean` | `tinyint(1)` | `tinyint(1)` | integer | فك الترميز المبني على المخطط |
| التاريخ والوقت | `timestamptz` | `datetime(3)` | `datetime(3)` | نص ISO | UTC دائمًا؛ وتستخدم جلسات عائلة MySQL المنطقة الزمنية `+00:00` |
| مجموعة المحارف والترتيب | UTF-8 | `utf8mb4`، `utf8mb4_0900_ai_ci` | `utf8mb4`، `utf8mb4_uca1400_ai_ci` | UTF-8، ثنائي | يُعيَّن صراحةً لكل جدول |
| المطابقة النصية الدقيقة (`$eq`، `$in`…) | `=` | `COLLATE utf8mb4_bin` | نفسه | `=` | نتائج متطابقة على كل محرك |
| `$contains`، `$startsWith`، `$endsWith` | `LIKE` | `LIKE … COLLATE utf8mb4_bin` | نفسه | `instr()` / `substr()` | يتجاهل `LIKE` في SQLite حالة أحرف ASCII، لذا لا يُستخدم للمطابقات الحساسة لحالة الأحرف |
| `$containsi` وعوامل `…i` الأخرى | `ILIKE` | `LIKE` (ترتيب غير حساس) | نفسه | `LIKE` | لا يطوي SQLite إلا حالة أحرف ASCII |
| عوامل التصفية على مسارات JSON | `#>>` | `JSON_VALUE` | نفسه | `json_extract` | معامل خاص بكل لهجة |
| عوامل التصفية على مصفوفات JSON | `jsonb_array_elements` | `JSON_TABLE` | نفسه | `json_each` | `EXISTS` على العناصر |
| `ALTER COLUMN` | كامل | `MODIFY COLUMN` | نفسه | غير مدعوم | SQLite: إعادة بناء الجدول (إنشاء، نسخ، حذف، إعادة تسمية) |
| أقفال الصفوف | `FOR UPDATE` | `FOR UPDATE` | `FOR UPDATE` | لا يوجد | تُحذف في SQLite، حيث تقفل معاملات الكتابة قاعدة البيانات |
| طول الفهرس النصي الفريد | — | 3,072 بايت | نفسه | — | `varchar(255)` في `utf8mb4` هو 1,020 بايت؛ ولا يمكن أن يكون `text` فريدًا |
| حجم الصف | — | 65,535 بايت | نفسه | — | 60 سمة على الأكثر من `string` أو `email` أو `uid` أو `enumeration` لكل نوع |

تهرّب أنماط `LIKE` المحارف `%` و`_` ومحرف الهروب نفسه (`!`) في مدخلات المستخدم. تتجاهل الترتيبات الافتراضية في MySQL وMariaDB حالة الأحرف والعلامات، ولهذا تضيف العوامل الدقيقة ترتيبًا ثنائيًا: يعني `$eq` في MySQL الشيء نفسه الذي يعنيه في PostgreSQL. ومع مسارات JSON، يعيد `JSON_VALUE` سلسلة بترتيب ثنائي، لذا تقارن العوامل غير الحساسة لحالة الأحرف هناك `LOWER()` على الطرفين.

يضع `ORDER BY` قيم NULL في النهاية في الاتجاهين وينتهي دائمًا بـ `id`، فيكون التقسيم إلى صفحات مستقرًا على كل محرك.
