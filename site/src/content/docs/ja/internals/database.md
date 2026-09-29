---
title: データベース層
description: Verdin が、1 つの接続型、Flavor の enum、独自の SQL ビルダーを通じて PostgreSQL、MySQL、MariaDB、SQLite とやりとりする方法と、各方言の違いへの対処を説明します。
sidebar:
  order: 3
---

このページでは、Verdin が 1 つのコードパスで 4 つのデータベースエンジンに対応する方法を説明します。接続と実行を行う `verdin-db` クレート、エンジンによって分岐する SQL ビルダー、そしてそれらが扱う方言の違いです。サーバーのどこかで SQL を書く前に読んでください。テーブルの配置は[ストレージ](/ja/internals/storage/)にあります。

## 最低バージョン

`Database::connect` はエンジンとそのバージョンを判別し、次の最低バージョンを下回ると起動を拒否します（`crates/verdin-db/src/lib.rs` の `Flavor::minimum_version`）。

| エンジン | 最低バージョン | 理由 |
|---|---|---|
| PostgreSQL | 14 | 上流でまだサポートされている最も古いバージョン |
| MySQL | 8.4 LTS | 8.0 は 2026 年 4 月にサポートが終了 |
| MariaDB | 10.11 LTS | 現行の長期サポート版で最も古いもの。`utf8mb4_uca1400_ai_ci` の照合順序、実用的な JSON |
| SQLite | 3.35 | `ALTER TABLE … DROP COLUMN`。ライブラリはバイナリに組み込まれています |

CI は、すべてのテストを PostgreSQL 14 と 17、MySQL 8.4、MariaDB 10.11 と 11.4、SQLite に対して実行します。[テスト](/ja/internals/testing/)を参照してください。

## 接続

`verdin-db` は、バックエンドごとに 1 つの `sqlx` のプールを包みます。

```rust
pub enum Pool { Postgres(PgPool), MySql(MySqlPool), Sqlite(SqlitePool) }

pub enum Flavor { Postgres, MySql, MariaDb, Sqlite }

pub struct Database { pool: Pool, flavor: Flavor, version: Version }
```

- URL のスキーム: `postgres://` または `postgresql://`、`mysql://`、`mariadb://`（`mysql://` の別名）、`sqlite:`。MySQL と MariaDB は `sqlx` の MySQL ドライバーを共有します。flavor は `SELECT VERSION()` から判断し、MariaDB ではその結果に `MariaDB` が含まれます。
- MySQL と MariaDB の接続は `utf8mb4` を使い、セッションのタイムゾーンを `+00:00` に設定するので、すべてのタイムスタンプは UTC で保存されます。
- SQLite の接続は、外部キーをオンにし、WAL ジャーナリングと 5 秒のビジータイムアウトを使い、データベースファイル（とそのフォルダー）がなければ作成します。インメモリのデータベースでは接続を 1 つだけにします。`:memory:` への接続ごとに別のデータベースが開かれてしまうためです。
- `ConnectOptions` は、プールのサイズ（`[database].pool_max`、デフォルトは 10）と、空き接続を待つ時間（10 秒）を設定します。

`Flavor` は、他のコードが分岐に使う少数の事実を持ちます。`transactional_ddl()`（PostgreSQL と SQLite）、`is_mysql_family()`、`quote(identifier)`（MySQL と MariaDB ではバッククォート、それ以外では二重引用符）、`minimum_version()` です。

方言のトレイトはありません。SQL を組み立てるコードは、エンジンが異なる箇所で `Flavor` を確認します。

## ステートメントの実行

3 つのエグゼキューターが同じメソッド（`execute`、`fetch_all`、`has_rows`、`insert_returning_id`）を共有します。

| エグゼキューター | 用途 |
|---|---|
| `db.queries()` | プール内の任意の接続での 1 つのステートメント |
| `db.acquire()` → `Conn` | ロックを保持するマイグレーションの実行など、1 つの接続での複数のステートメント |
| `db.begin()` → `Tx` | トランザクション。`commit()` せずに破棄するとロールバックします |

ステートメントは `?` のプレースホルダーで書き、PostgreSQL では `$1, $2…` に書き換えます。値は `SqlValue` で、常にパラメーターとしてバインドされます。SQL のテキスト自体に含めてよいのは、検証済みのスキーマから来た識別子だけです。そのため、`sqlx` には `AssertSqlSafe` として渡されます。

**スキーマ駆動のデコード。** 読み取りでは、選択した各カラムの `ColumnKind` を渡し、値はドライバーが報告する型ではなくその種類でデコードされます。これにより、MariaDB の `JSON`（実体は `LONGTEXT`）、MySQL の `TINYINT(1)` のブール値、SQLite のテキストの日付や小数が、どのエンジンでも同じ形で返ってきます。`crates/verdin-db/src/value.rs` を参照してください。

**挿入された ID。** `insert_returning_id` は、PostgreSQL では `RETURNING id` を付け加え、MySQL、MariaDB（`LAST_INSERT_ID`）、SQLite（`last_insert_rowid`）では挿入後にドライバーが報告する ID を読みます。

**一意制約の違反。** `DbError::unique_violation()` は、ドライバーのエラーからインデックス名（PostgreSQL、MySQL、MariaDB）またはカラムのリスト（SQLite）を取り出すので、Document Service は正しい属性に対して `ValidationError` を報告できます。

## SQL ビルダー

Verdin は、ORM や `sea-query` ではなく独自の小さなビルダーで SQL を組み立てます。テーブルは実行時にしか存在しない（スキーマから作られる）うえ、型付きの NULL、照合順序、JSON 関数、SQLite のテキスト形式といった方言ごとの細部が支配的だからです。

| クレート | 組み立てるもの |
|---|---|
| `verdin-migrate`（`sql.rs`、`Dialect`） | DDL: カラムの型、`CREATE TABLE`、`ALTER TABLE`、インデックス、SQLite のテーブルの再構築 |
| `verdin-query`（`sql.rs`、`SqlBuilder`） | フィルター用の `WHERE` 句（リレーションの `EXISTS` サブクエリと JSON パスを含む）と `ORDER BY` |
| `verdin-content`（`service.rs`） | 読み取り、挿入、更新、削除、リンクテーブルへの書き込み、バッチ化した populate のクエリ |

ビルダーは SQL のテキストと `ident()` の名前（flavor に合わせて引用符付け）を追加し、`param()` でパラメーターを集めるので、SQL の組み立てと値のバインドが 1 か所で行われます。

### 方言ごとのカラムの型

| モデルの型 | PostgreSQL | MySQL / MariaDB | SQLite |
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

SQLite は小数、日付、時刻を固定形式のテキストとして保存するので、何も丸められず、テキストの順序が数値や時系列の順序と一致します。どの属性がどのモデルの型に対応するかは[属性の型](/ja/reference/attribute-types/)にあります。

MySQL と MariaDB のテーブルは、`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` と、アクセントと大文字小文字を区別しない照合順序で作成されます。MySQL では `utf8mb4_0900_ai_ci`、MariaDB では `utf8mb4_uca1400_ai_ci` です。

## 方言の違い

| 項目 | PostgreSQL | MySQL 8.4 | MariaDB | SQLite | Verdin での対処 |
|---|---|---|---|---|---|
| 挿入された ID | `RETURNING` | `RETURNING` なし | ドライバーの ID | ドライバーの ID | `insert_returning_id()` |
| トランザクション内の DDL | あり | なし（暗黙のコミット） | なし | あり | MySQL と MariaDB ではステップのジャーナル（[マイグレーション](/ja/internals/migrations/)を参照） |
| JSON | `jsonb` | `json` | `LONGTEXT` の別名 | テキスト | スキーマ駆動のデコード |
| ブール値 | `boolean` | `tinyint(1)` | `tinyint(1)` | 整数 | スキーマ駆動のデコード |
| 日時 | `timestamptz` | `datetime(3)` | `datetime(3)` | ISO のテキスト | 常に UTC。MySQL 系のセッションはタイムゾーン `+00:00` を使います |
| 文字セットと照合順序 | UTF-8 | `utf8mb4`、`utf8mb4_0900_ai_ci` | `utf8mb4`、`utf8mb4_uca1400_ai_ci` | UTF-8、バイナリ | テーブルごとに明示的に設定 |
| テキストの完全一致（`$eq`、`$in` など） | `=` | `COLLATE utf8mb4_bin` | 同上 | `=` | どのエンジンでも同じ結果 |
| `$contains`、`$startsWith`、`$endsWith` | `LIKE` | `LIKE … COLLATE utf8mb4_bin` | 同上 | `instr()` / `substr()` | SQLite の `LIKE` は ASCII の大文字小文字を区別しないので、大文字小文字を区別する照合には使いません |
| `$containsi` などの `…i` の演算子 | `ILIKE` | `LIKE`（区別しない照合順序） | 同上 | `LIKE` | SQLite は ASCII の大文字小文字だけを同一視します |
| JSON パスのフィルター | `#>>` | `JSON_VALUE` | 同上 | `json_extract` | 方言ごとのオペランド |
| JSON 配列のフィルター | `jsonb_array_elements` | `JSON_TABLE` | 同上 | `json_each` | 項目に対する `EXISTS` |
| `ALTER COLUMN` | 完全対応 | `MODIFY COLUMN` | 同上 | 非対応 | SQLite: テーブルを再構築（作成、コピー、削除、名前変更） |
| 行ロック | `FOR UPDATE` | `FOR UPDATE` | `FOR UPDATE` | なし | SQLite では省略。書き込みトランザクションがデータベースをロックするため |
| 一意なテキストインデックスの長さ | — | 3,072 バイト | 同上 | — | `utf8mb4` の `varchar(255)` は 1,020 バイト。`text` は一意にできません |
| 行サイズ | — | 65,535 バイト | 同上 | — | 1 つの型あたり `string`、`email`、`uid`、`enumeration` の属性は最大 60 個 |

`LIKE` のパターンでは、ユーザーの入力に含まれる `%`、`_`、そしてエスケープ文字自体（`!`）をエスケープします。MySQL と MariaDB のデフォルトの照合順序は大文字小文字とアクセントを区別しないので、完全一致の演算子にはバイナリの照合順序を付けます。これで `$eq` は MySQL でも PostgreSQL と同じ意味になります。JSON パスでは `JSON_VALUE` がバイナリの照合順序の文字列を返すので、そこでの大文字小文字を区別しない演算子は、両辺の `LOWER()` を比較します。

`ORDER BY` は、どちらの方向でも NULL を最後に置き、常に `id` で終わるので、どのエンジンでもページネーションが安定します。
