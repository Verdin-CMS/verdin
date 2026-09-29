---
title: テスト
description: Verdin のテスト方法。Rust のユニットテストから、6 つのデータベースで実行する適合性テストスイート、管理パネルのユニットテストと Playwright のテスト、すべての変更を関門にかける CI のジョブまでを説明します。
sidebar:
  order: 7
---

このページでは、テストスイート、それぞれをローカルで実行する方法、そして CI がすべてのプルリクエストで確認することを説明します。そのすべての背後にあるルールは、機能はサポートするすべてのデータベースで通るまで完成ではない、ということです。

## Rust のテスト

すべてを実行するには次のようにします。

```sh title="Terminal"
cargo test --workspace
```

設定がない場合、テストは SQLite を使います。テストには 3 種類あります。

| 種類 | 場所 | 内容 |
|---|---|---|
| ユニットテスト | 各クレートの `#[cfg(test)]` モジュール | スキーマの解析とバリデーション、命名、diff と plan、クエリの解析、方言ごとの SQL の生成、値のエンコード、入力のバリデーション |
| クレートの結合テスト | `crates/*/tests/` | 接続と flavor の判別（`verdin-db`）、マイグレーションの適用（`verdin-migrate`）、認証の流れ（`verdin-auth`）、GraphQL、プラグイン、S3 のストレージ |
| API のテスト | `crates/verdin-api/tests/api/` | 適合性テストスイートを含む、コンテンツ API と Admin API への HTTP リクエスト |

**DDL のスナップショット。** `crates/verdin-migrate/tests/sql_snapshots.rs` は、サンプルのスキーマの DDL をすべての方言で出力し、`crates/verdin-migrate/tests/snapshots/` の [`insta`](https://insta.rs) のスナップショットと比較します。意図して DDL を変更したときは、`cargo insta review`（`cargo-insta` のコマンド）で新しいスナップショットを確認・承認し、コミットしてください。

**API のテスト**は、リンクの時間と `target/` のサイズを抑えるために、1 つのテストバイナリ（`tests/api/main.rs`、領域ごとに 1 つのモジュール）にまとめています。`tests/api/common/mod.rs` のハーネスは、テストごとに新しくマイグレーションしたデータベースの上に、`/api` のコンテンツ API と `/admin/api` の Admin API を構築します。テストが別のトークンを渡すかトークンなしにしない限り、リクエストにはフルアクセスの API トークンが付きます。

## 6 つのデータベースのマトリクス

データベースに触れるすべてのテストは `VERDIN_TEST_DATABASE_URL` を読み、デフォルトはインメモリの SQLite です。`verdin-testkit` は各テストに専用のデータベースを与えます。一時的な SQLite ファイルか、サーバー上に作成して後で削除する新しい `vd_test_…` データベースです。

CI は、エンジンごとにワークスペース全体を 1 回実行します。

| エンジン | イメージ |
|---|---|
| SQLite | 組み込み |
| PostgreSQL 14 | `postgres:14-alpine` |
| PostgreSQL 17 | `postgres:17-alpine` |
| MySQL 8.4 | `mysql:8.4` |
| MariaDB 10.11 | `mariadb:10.11` |
| MariaDB 11.4 | `mariadb:11.4` |

これらは[最低バージョン](/ja/internals/database/#最低バージョン)と、Verdin がテストされている最新のバージョンです。CI は `VERDIN_TEST_EXPECT_FLAVOR` も設定するので、`crates/verdin-db/tests/connect.rs` はエンジンが正しく判別されたことを確認します（MariaDB には `mysql://` の URL で接続しますが、MariaDB として判別される必要があります）。

ローカルでマトリクスを実行するには、Docker でデータベースを起動します。

```sh title="Terminal"
docker compose -f docker/compose.dev.yml up -d
```

その後、各エンジンに対してテストを実行します。テストはテストごとにデータベースを作成するので、MySQL と MariaDB では `root` として接続します。

```sh title="Terminal"
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5414/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5417/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3384/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3311/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3314/verdin cargo test --workspace
```

ポートは、PostgreSQL 14 と 17、MySQL 8.4、MariaDB 10.11 と 11.4 に対応します。同じ compose ファイルで、メディアとメールの作業のために RustFS（ポート 9000 の S3 互換ストレージ）と Mailpit（ポート 1025 の SMTP、ポート 8025 の受信箱）も起動します。

## 適合性テストスイート

`crates/verdin-api/tests/api/conformance.rs` は、すべてのエンジンでコンテンツ API に同じ HTTP リクエストを送り、レスポンスを確認します。作成、読み取り、更新、削除の往復、入力のバリデーション、下書きと公開、フィルターとそのテキスト照合のルール、ソートとページネーション、フィールドの型と populate、一意の値、シングルタイプ、コンテンツ API のアクセスルール、OpenAPI ドキュメント、コンポーネントのフィールドでのフィルターです。`tests/api/` の他のモジュール（`filters.rs`、`populate.rs`、`relations.rs`、`components.rs`、`morph.rs`、`i18n.rs` など）も同じようにそれぞれの領域をカバーするので、`verdin-api` のテストバイナリ全体が実質的に適合性テストスイートです。

方言の違いを直したら、そのケースをここに追加してください。PostgreSQL では通り MySQL では失敗するテストこそ、このスイートが捕まえるために存在するものです。

## 管理パネルのテスト

**ユニットテスト**は `admin/src/app` のコードの隣にある `*.spec.ts` ファイルで、jsdom 上で Angular のユニットテストビルダーを通じて Vitest で実行します。純粋なモデルをカバーします。フォームのモデルの変換、フィールドのルール、一覧のフィルターとビュー、権限、ICU のトランスパイラー、週の始まりなどです。

```sh title="Terminal"
cd admin
npx ng test --watch=false
```

**エンドツーエンドのテスト**は `admin/e2e/` にある Playwright の spec です。`e2e/serve.sh` は使い捨てのプロジェクト（サンプルの WebAssembly プラグイン付き）を作成し、SQLite でポート 1393 の `verdin dev` を起動し、`admin/dist/admin/browser` から管理画面を提供します。テストは、英語の UI の Chromium で 1 つずつ実行されます。

```sh title="Terminal"
cd admin
npx ng build
cargo build -p verdin
npx playwright install chromium
npx playwright test
```

spec がカバーするのは、ログインと二段階認証、エントリーエディター、ポリモーフィックリレーション、レビューワークフロー、チームとガバナンスの機能、メンション、インポートとエクスポート、編集ビューと未保存の変更のガードです。

## CI

`.github/workflows/ci.yml` は、`main` へのすべてのプッシュとすべてのプルリクエストで実行されます。Rust のジョブはすべて `RUSTFLAGS=-D warnings` でビルドします。

| ジョブ | 確認すること |
|---|---|
| `lint` | `cargo fmt --all --check`、`cargo clippy --workspace --all-targets`、`cargo deny`（ライセンスとアドバイザリー） |
| `test (sqlite)` | インメモリの SQLite での `cargo test --workspace` |
| `test (…)` | Docker のサービスとして、PostgreSQL 14 と 17、MySQL 8.4、MariaDB 10.11 と 11.4 での `cargo test --workspace`。それぞれ 1 つのジョブ |
| `test (s3 storage, RustFS)` | RustFS のコンテナに対する `cargo test -p verdin-upload --test s3` |
| `admin` | Prettier のチェック、`npm run i18n:check`、`npm audit --audit-level=high`、ユニットテスト、`ng build`、`cargo build -p verdin --features embed-admin`、Playwright |
| `client` | `packages/client` がワークスペースと同じバージョンであることを確認し、次に型チェック、テスト、ビルド |
| `site` | `npm audit` と、壊れた内部リンクがあると失敗するドキュメントのビルド |

失敗した Playwright の実行はトレースをアーティファクトとしてアップロードし、7 日間保持されます。
