---
title: 数据库层
description: Verdin 如何通过一个连接类型、一个 Flavor 枚举和自己的 SQL 构建器与 PostgreSQL、MySQL、MariaDB 和 SQLite 通信，以及如何处理各方言之间的差异。
sidebar:
  order: 3
---

本页介绍 Verdin 如何用一条代码路径支持四种数据库引擎：负责连接和执行的 `verdin-db` crate、根据引擎分支的 SQL 构建器，以及它们所处理的方言差异。在服务器中任何地方编写 SQL 之前，请先阅读本页。表的布局请参见[存储](/zh-cn/internals/storage/)。

## 最低版本

`Database::connect` 会检测引擎及其版本，低于以下最低版本时拒绝启动（`crates/verdin-db/src/lib.rs` 中的 `Flavor::minimum_version`）：

| 引擎 | 最低版本 | 原因 |
|---|---|---|
| PostgreSQL | 14 | 上游仍在支持的最旧版本 |
| MySQL | 8.4 LTS | 8.0 已于 2026 年 4 月停止支持 |
| MariaDB | 10.11 LTS | 当前最旧的长期支持版本；提供 `utf8mb4_uca1400_ai_ci` 排序规则和可用的 JSON |
| SQLite | 3.35 | `ALTER TABLE … DROP COLUMN`；该库被编译进二进制文件 |

CI 会针对 PostgreSQL 14 和 17、MySQL 8.4、MariaDB 10.11 和 11.4 以及 SQLite 运行所有测试。参见[测试](/zh-cn/internals/testing/)。

## 连接

`verdin-db` 为每种后端封装一个 `sqlx` 连接池：

```rust
pub enum Pool { Postgres(PgPool), MySql(MySqlPool), Sqlite(SqlitePool) }

pub enum Flavor { Postgres, MySql, MariaDb, Sqlite }

pub struct Database { pool: Pool, flavor: Flavor, version: Version }
```

- URL scheme：`postgres://` 或 `postgresql://`、`mysql://`、`mariadb://`（`mysql://` 的别名）以及 `sqlite:`。MySQL 和 MariaDB 共用 `sqlx` 的 MySQL 驱动；flavor 取决于 `SELECT VERSION()` 的结果，在 MariaDB 上其中包含 `MariaDB`。
- MySQL 和 MariaDB 连接使用 `utf8mb4`，并把会话时区设置为 `+00:00`，因此所有时间戳都以 UTC 存储。
- SQLite 连接会开启外键、使用 WAL 日志模式和 5 秒的忙等待超时，并在数据库文件（及其所在文件夹）不存在时创建它。内存数据库只使用一个连接，因为每个连接到 `:memory:` 的连接都会打开一个不同的数据库。
- `ConnectOptions` 设置连接池大小（`[database].pool_max`，默认 10）以及等待空闲连接的时间（10 秒）。

`Flavor` 携带了其余代码据以分支的少数几个事实：`transactional_ddl()`（PostgreSQL 和 SQLite）、`is_mysql_family()`、`quote(identifier)`（MySQL 和 MariaDB 上使用反引号，其他使用双引号）以及 `minimum_version()`。

没有方言 trait。构建 SQL 的代码会在引擎存在差异的地方检查 `Flavor`。

## 执行语句

三种执行器共享相同的方法（`execute`、`fetch_all`、`has_rows`、`insert_returning_id`）：

| 执行器 | 用途 |
|---|---|
| `db.queries()` | 在任意池化连接上执行一条语句 |
| `db.acquire()` → `Conn` | 在同一个连接上执行多条语句，例如持有锁的迁移运行 |
| `db.begin()` → `Tx` | 一个事务；未调用 `commit()` 就被丢弃时会回滚 |

语句使用 `?` 占位符编写，在 PostgreSQL 上会被改写为 `$1, $2…`。值为 `SqlValue`，始终作为参数绑定。SQL 文本本身只能包含来自已校验 schema 的标识符，这也是它以 `AssertSqlSafe` 的形式传给 `sqlx` 的原因。

**由 schema 驱动的解码。** 读取时会传入每个所选列的 `ColumnKind`，值按该类别解码，而不是按驱动报告的类型解码。正因如此，MariaDB 的 `JSON`（实际上是 `LONGTEXT`）、MySQL 的 `TINYINT(1)` 布尔值以及 SQLite 的文本日期和小数，在所有引擎上返回的结果都相同。参见 `crates/verdin-db/src/value.rs`。

**插入的 id。** `insert_returning_id` 在 PostgreSQL 上追加 `RETURNING id`，在 MySQL、MariaDB（`LAST_INSERT_ID`）和 SQLite（`last_insert_rowid`）上则在插入后读取驱动报告的 id。

**唯一性冲突。** `DbError::unique_violation()` 会从驱动错误中提取索引名（PostgreSQL、MySQL、MariaDB）或列列表（SQLite），这样 Document Service 就可以在正确的属性上报告 `ValidationError`。

## SQL 构建器

Verdin 使用自己的小型构建器来构建 SQL，而不是使用 ORM 或 `sea-query`，因为表只在运行时存在（它们来自 schema），而且各方言的细节占据主导地位：带类型的 NULL、排序规则、JSON 函数以及 SQLite 的文本格式。

| Crate | 构建内容 |
|---|---|
| `verdin-migrate`（`sql.rs`、`Dialect`） | DDL：列类型、`CREATE TABLE`、`ALTER TABLE`、索引、SQLite 表重建 |
| `verdin-query`（`sql.rs`、`SqlBuilder`） | 用于过滤的 `WHERE` 子句（包括关联的 `EXISTS` 子查询和 JSON 路径）以及 `ORDER BY` |
| `verdin-content`（`service.rs`） | 读取、插入、更新、删除、链接表写入以及批量 populate 查询 |

构建器会推入 SQL 文本和 `ident()` 名称（按 flavor 加引号），并通过 `param()` 收集参数，因此构建 SQL 和绑定值在同一个地方完成。

### 各方言的列类型

| 模型类型 | PostgreSQL | MySQL / MariaDB | SQLite |
|---|---|---|---|
| id | `bigint` identity | `bigint AUTO_INCREMENT` | `integer PRIMARY KEY AUTOINCREMENT` |
| integer、bigint、smallint | `integer`、`bigint`、`smallint` | `int`、`bigint`、`smallint` | `integer` |
| double | `double precision` | `double` | `real` |
| decimal | `numeric(p,s)` | `decimal(p,s)` | `text` |
| boolean | `boolean` | `tinyint(1)` | `integer` |
| char、varchar | `char(n)`、`varchar(n)` | `char(n)`、`varchar(n)` | `text` |
| text | `text` | `longtext` | `text` |
| date、time、datetime | `date`、`time(3)`、`timestamptz(3)` | `date`、`time(3)`、`datetime(3)` | `text` |
| json | `jsonb` | `json` | `text` |

SQLite 把日期和时间存储为固定格式的文本，这样文本顺序与时间顺序一致。它也把小数存储为文本，因此保存时不会发生舍入。对小数来说，文本顺序并不是数值顺序，所以在 SQLite 上，对小数的过滤和排序会把该列转换为 `REAL`。这些比较精确到约 15 位有效数字，返回的值仍然是精确的。哪个属性对应哪个模型类型，请参见[属性类型](/zh-cn/reference/attribute-types/)。

MySQL 和 MariaDB 的表以 `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` 以及不区分重音和大小写的排序规则创建：MySQL 上为 `utf8mb4_0900_ai_ci`，MariaDB 上为 `utf8mb4_uca1400_ai_ci`。

## 方言差异

| 主题 | PostgreSQL | MySQL 8.4 | MariaDB | SQLite | Verdin 的处理方式 |
|---|---|---|---|---|---|
| 插入的 id | `RETURNING` | 没有 `RETURNING` | 驱动 id | 驱动 id | `insert_returning_id()` |
| 事务性 DDL | 是 | 否（隐式提交） | 否 | 是 | 在 MySQL 和 MariaDB 上使用步骤日志（参见[迁移](/zh-cn/internals/migrations/)） |
| JSON | `jsonb` | `json` | `LONGTEXT` 的别名 | 文本 | 由 schema 驱动的解码 |
| 布尔值 | `boolean` | `tinyint(1)` | `tinyint(1)` | 整数 | 由 schema 驱动的解码 |
| 日期时间 | `timestamptz` | `datetime(3)` | `datetime(3)` | ISO 文本 | 始终为 UTC；MySQL 系列的会话使用时区 `+00:00` |
| 字符集和排序规则 | UTF-8 | `utf8mb4`、`utf8mb4_0900_ai_ci` | `utf8mb4`、`utf8mb4_uca1400_ai_ci` | UTF-8，二进制 | 按表显式设置 |
| 精确文本匹配（`$eq`、`$in`……） | `=` | `COLLATE utf8mb4_bin` | 同上 | `=` | 在所有引擎上结果相同 |
| `$contains`、`$startsWith`、`$endsWith` | `LIKE` | `LIKE … COLLATE utf8mb4_bin` | 同上 | `instr()` / `substr()` | SQLite 的 `LIKE` 会忽略 ASCII 大小写，因此不用于区分大小写的匹配 |
| `$containsi` 及其他 `…i` 运算符 | `ILIKE` | `LIKE`（不区分大小写的排序规则） | 同上 | `LIKE` | SQLite 只折叠 ASCII 大小写 |
| JSON 路径过滤 | `#>>` | `JSON_VALUE` | 同上 | `json_extract` | 按方言选择操作数 |
| JSON 数组过滤 | `jsonb_array_elements` | `JSON_TABLE` | 同上 | `json_each` | 对各项使用 `EXISTS` |
| `ALTER COLUMN` | 完整支持 | `MODIFY COLUMN` | 同上 | 不支持 | SQLite：重建表（创建、复制、删除、重命名） |
| 行锁 | `FOR UPDATE` | `FOR UPDATE` | `FOR UPDATE` | 无 | 在 SQLite 上省略，其写事务会锁定整个数据库 |
| 唯一文本索引长度 | — | 3,072 字节 | 同上 | — | `utf8mb4` 下的 `varchar(255)` 为 1,020 字节；`text` 不能设为唯一 |
| 行大小 | — | 65,535 字节 | 同上 | — | 每个类型最多 60 个 `string`、`email`、`uid` 或 `enumeration` 属性 |

`LIKE` 模式会对用户输入中的 `%`、`_` 以及转义字符本身（`!`）进行转义。MySQL 和 MariaDB 的默认排序规则会忽略大小写和重音，这就是精确运算符要添加二进制排序规则的原因：`$eq` 在 MySQL 上的含义与在 PostgreSQL 上相同。对于 JSON 路径，`JSON_VALUE` 返回的是二进制排序规则的字符串，因此那里的不区分大小写运算符会对两边都做 `LOWER()` 后比较。

无论哪个方向，`ORDER BY` 都会把 NULL 放在最后，并始终以 `id` 结尾，因此在所有引擎上分页都是稳定的。
