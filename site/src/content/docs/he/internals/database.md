---
title: שכבת מסד הנתונים
description: איך Verdin מדבר עם PostgreSQL, MySQL, MariaDB ו-SQLite דרך טיפוס חיבור אחד, enum בשם Flavor ובוני SQL משלו, ואיך הוא מטפל בהבדלים של כל דיאלקט.
sidebar:
  order: 3
---

העמוד הזה מסביר איך Verdin תומך בארבעה מנועי מסדי נתונים עם מסלול קוד אחד: ה-crate `verdin-db` שמתחבר ומריץ, בוני ה-SQL שמתפצלים לפי המנוע, והבדלי הדיאלקטים שהם מטפלים בהם. קראו אותו לפני שאתם כותבים SQL במקום כלשהו בשרת. איך הטבלאות בנויות מופיע ב[אחסון](/he/internals/storage/).

## גרסאות מינימליות

`Database::connect` מזהה את המנוע ואת הגרסה שלו ומסרב לעלות מתחת למינימום הזה (`Flavor::minimum_version` ב-`crates/verdin-db/src/lib.rs`):

| מנוע | מינימום | סיבה |
|---|---|---|
| PostgreSQL | 14 | הגרסה הוותיקה ביותר שעדיין נתמכת במקור |
| MySQL | 8.4 LTS | ‏8.0 הגיעה לסוף חייה באפריל 2026 |
| MariaDB | 10.11 LTS | הגרסה הוותיקה ביותר מהגרסאות ארוכות הטווח הנוכחיות; collation ‏`utf8mb4_uca1400_ai_ci`, JSON שמיש |
| SQLite | 3.35 | `ALTER TABLE … DROP COLUMN`; הספרייה מהודרת לתוך הקובץ הבינארי |

ה-CI מריץ כל בדיקה מול PostgreSQL 14 ו-17, MySQL 8.4, MariaDB 10.11 ו-11.4, ו-SQLite. ראו [בדיקות](/he/internals/testing/).

## התחברות

`verdin-db` עוטף pool אחד של `sqlx` לכל backend:

```rust
pub enum Pool { Postgres(PgPool), MySql(MySqlPool), Sqlite(SqlitePool) }

pub enum Flavor { Postgres, MySql, MariaDb, Sqlite }

pub struct Database { pool: Pool, flavor: Flavor, version: Version }
```

- סכמות URL: `postgres://` או `postgresql://`, `mysql://`, `mariadb://` (כינוי של `mysql://`) ו-`sqlite:`. MySQL ו-MariaDB חולקים את מנהל ההתקן MySQL של `sqlx`; ה-flavor נקבע לפי `SELECT VERSION()`, שמכיל `MariaDB` ב-MariaDB.
- חיבורי MySQL ו-MariaDB משתמשים ב-`utf8mb4` ומגדירים את אזור הזמן של הסשן ל-`+00:00`, כך שכל חותמת זמן נשמרת ב-UTC.
- חיבורי SQLite מפעילים מפתחות זרים, משתמשים ב-WAL journaling ובזמן המתנה של 5 שניות כשהמסד עסוק, ויוצרים את קובץ מסד הנתונים (ואת התיקייה שלו) אם הוא חסר. מסדי נתונים בזיכרון מקבלים חיבור יחיד, כי כל חיבור ל-`:memory:` היה פותח מסד נתונים אחר.
- `ConnectOptions` קובע את גודל ה-pool (`[database].pool_max`, 10 כברירת מחדל) ואת זמן ההמתנה לחיבור פנוי (10 שניות).

`Flavor` נושא את העובדות המעטות ששאר הקוד מתפצל לפיהן: `transactional_ddl()` (PostgreSQL ו-SQLite), `is_mysql_family()`, `quote(identifier)` (backticks ב-MySQL וב-MariaDB, מירכאות כפולות בשאר) ו-`minimum_version()`.

אין trait של דיאלקט. קוד שבונה SQL בודק את ה-`Flavor` היכן שהמנועים שונים.

## הרצת פקודות

שלושה executors חולקים את אותן מתודות (`execute`, `fetch_all`, `has_rows`, `insert_returning_id`):

| Executor | שימוש |
|---|---|
| `db.queries()` | פקודה אחת על כל חיבור מה-pool |
| `db.acquire()` → `Conn` | כמה פקודות על חיבור אחד, כמו הרצת הגירה שמחזיקה נעילה |
| `db.begin()` → `Tx` | טרנזקציה; כשהיא נזרקת בלי `commit()`, היא מתבטלת |

הפקודות נכתבות עם placeholders מסוג `?`, שנכתבים מחדש ל-`$1, $2…` ב-PostgreSQL. הערכים הם `SqlValue`s, שתמיד נקשרים כפרמטרים. טקסט ה-SQL עצמו יכול להכיל רק מזהים שמגיעים מהסכמה המאומתת, ולכן הוא מועבר ל-`sqlx` כ-`AssertSqlSafe`.

**פענוח מונחה סכמה.** קריאה מעבירה את ה-`ColumnKind` של כל עמודה שנבחרה, והערכים מפוענחים לפי ה-kind הזה, לא לפי הטיפוס שמנהל ההתקן מדווח. זה מה שגורם ל-`JSON` של MariaDB (שהוא בעצם `LONGTEXT`), לבוליאניים `TINYINT(1)` של MySQL ולתאריכים ולמספרים עשרוניים כטקסט של SQLite לחזור באותה דרך בכל מנוע. ראו `crates/verdin-db/src/value.rs`.

**מזהים שהוכנסו.** `insert_returning_id` מוסיף `RETURNING id` ב-PostgreSQL, וקורא את המזהה שמנהל ההתקן מדווח אחרי ההכנסה ב-MySQL, ב-MariaDB (`LAST_INSERT_ID`) וב-SQLite (`last_insert_rowid`).

**הפרות ייחודיות.** `DbError::unique_violation()` מחלץ את שם האינדקס (PostgreSQL, MySQL, MariaDB) או את רשימת העמודות (SQLite) משגיאת מנהל ההתקן, כך שה-Document Service יכול לדווח `ValidationError` על המאפיין הנכון.

## בוני SQL

Verdin בונה SQL עם בונים קטנים משלו במקום ORM או `sea-query`, כי הטבלאות קיימות רק בזמן ריצה (הן מגיעות מהסכמה) וכי הפרטים של כל דיאלקט הם העיקר: NULLs עם טיפוס, collations, פונקציות JSON ופורמטי הטקסט של SQLite.

| Crate | בונה |
|---|---|
| `verdin-migrate` (`sql.rs`, `Dialect`) | DDL: סוגי עמודות, `CREATE TABLE`, `ALTER TABLE`, אינדקסים, בנייה מחדש של טבלאות SQLite |
| `verdin-query` (`sql.rs`, `SqlBuilder`) | פסוקיות `WHERE` למסננים (כולל תת-שאילתות `EXISTS` לקשרים ונתיבי JSON) ו-`ORDER BY` |
| `verdin-content` (`service.rs`) | קריאות, הכנסות, עדכונים, מחיקות, כתיבות לטבלאות קישור ושאילתות populate מקובצות |

בונה דוחף טקסט SQL ושמות `ident()` (במירכאות לפי ה-flavor) ואוסף פרמטרים עם `param()`, כך שבניית ה-SQL וקשירת הערכים קורות במקום אחד.

### סוגי עמודות לפי דיאלקט

| טיפוס במודל | PostgreSQL | MySQL / MariaDB | SQLite |
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

SQLite שומר מספרים עשרוניים, תאריכים ושעות כטקסט בפורמט קבוע, כך ששום דבר לא מעוגל וסדר הטקסט תואם לסדר המספרי והכרונולוגי. איזה מאפיין ממופה לאיזה טיפוס במודל מופיע ב[טיפוסי מאפיינים](/he/reference/attribute-types/).

טבלאות MySQL ו-MariaDB נוצרות עם `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` ועם collation שאינו תלוי בסימני הטעמה וברישיות: `utf8mb4_0900_ai_ci` ב-MySQL, `utf8mb4_uca1400_ai_ci` ב-MariaDB.

## הבדלי דיאלקטים

| נושא | PostgreSQL | MySQL 8.4 | MariaDB | SQLite | איך Verdin מטפל בזה |
|---|---|---|---|---|---|
| מזהה שהוכנס | `RETURNING` | בלי `RETURNING` | מזהה ממנהל ההתקן | מזהה ממנהל ההתקן | `insert_returning_id()` |
| DDL בטרנזקציה | כן | לא (commit מרומז) | לא | כן | יומן שלבים ב-MySQL וב-MariaDB (ראו [הגירות](/he/internals/migrations/)) |
| JSON | `jsonb` | `json` | כינוי של `LONGTEXT` | טקסט | פענוח מונחה סכמה |
| בוליאניים | `boolean` | `tinyint(1)` | `tinyint(1)` | integer | פענוח מונחה סכמה |
| תאריך-שעה | `timestamptz` | `datetime(3)` | `datetime(3)` | טקסט ISO | תמיד UTC; סשנים ממשפחת MySQL משתמשים באזור הזמן `+00:00` |
| Charset ו-collation | UTF-8 | `utf8mb4`, `utf8mb4_0900_ai_ci` | `utf8mb4`, `utf8mb4_uca1400_ai_ci` | UTF-8, בינארי | מוגדר במפורש לכל טבלה |
| התאמת טקסט מדויקת (`$eq`, `$in`…) | `=` | `COLLATE utf8mb4_bin` | כנ"ל | `=` | אותן תוצאות בכל מנוע |
| `$contains`, `$startsWith`, `$endsWith` | `LIKE` | `LIKE … COLLATE utf8mb4_bin` | כנ"ל | `instr()` / `substr()` | ה-`LIKE` של SQLite מתעלם מרישיות ASCII, ולכן לא משתמשים בו להתאמות תלויות רישיות |
| `$containsi` ושאר אופרטורי `…i` | `ILIKE` | `LIKE` (collation לא תלוי רישיות) | כנ"ל | `LIKE` | SQLite מקפל רק רישיות ASCII |
| מסנני נתיב JSON | `#>>` | `JSON_VALUE` | כנ"ל | `json_extract` | אופרנד לפי דיאלקט |
| מסנני מערך JSON | `jsonb_array_elements` | `JSON_TABLE` | כנ"ל | `json_each` | `EXISTS` על הפריטים |
| `ALTER COLUMN` | מלא | `MODIFY COLUMN` | כנ"ל | לא נתמך | SQLite: בנייה מחדש של הטבלה (יצירה, העתקה, מחיקה, שינוי שם) |
| נעילות שורה | `FOR UPDATE` | `FOR UPDATE` | `FOR UPDATE` | אין | מושמט ב-SQLite, שטרנזקציות הכתיבה שלו נועלות את מסד הנתונים |
| אורך אינדקס טקסט ייחודי | — | ‏3,072 בייטים | כנ"ל | — | `varchar(255)` ב-`utf8mb4` הוא 1,020 בייטים; `text` לא יכול להיות ייחודי |
| גודל שורה | — | ‏65,535 בייטים | כנ"ל | — | לכל היותר 60 מאפייני `string`, `email`, `uid` או `enumeration` לכל סוג |

תבניות `LIKE` מבצעות escape ל-`%`, ל-`_` ולתו ה-escape עצמו (`!`) בקלט של המשתמש. ה-collations של ברירת המחדל ב-MySQL וב-MariaDB מתעלמים מרישיות ומסימני הטעמה, ולכן אופרטורים מדויקים מוסיפים collation בינארי: `$eq` אומר ב-MySQL את אותו הדבר כמו ב-PostgreSQL. עם נתיבי JSON, `JSON_VALUE` מחזיר מחרוזת עם collation בינארי, ולכן אופרטורים לא תלויי רישיות שם משווים `LOWER()` בשני הצדדים.

`ORDER BY` שם NULLs אחרונים בשני הכיוונים ותמיד מסתיים ב-`id`, כך שהעימוד יציב בכל מנוע.
