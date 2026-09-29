---
title: 测试
description: Verdin 是如何测试的：从 Rust 单元测试，到在六种数据库上运行的一致性测试套件，再到管理后台的单元测试和 Playwright 测试，以及把关每次变更的 CI 任务。
sidebar:
  order: 7
---

本页介绍各个测试套件、如何在本地运行它们，以及 CI 在每个 pull request 上检查什么。这一切背后的规则是：一个功能只有在所有受支持的数据库上都通过测试，才算完成。

## Rust 测试

运行全部测试：

```sh title="Terminal"
cargo test --workspace
```

没有任何配置时，测试使用 SQLite。测试分为三类：

| 类别 | 位置 | 内容 |
|---|---|---|
| 单元测试 | 每个 crate 中的 `#[cfg(test)]` 模块 | schema 解析和校验、命名、diff 和 plan、查询解析、各方言的 SQL 生成、值编码、输入校验 |
| crate 集成测试 | `crates/*/tests/` | 连接和 flavor 检测（`verdin-db`）、执行迁移（`verdin-migrate`）、认证流程（`verdin-auth`）、GraphQL、插件、S3 存储 |
| API 测试 | `crates/verdin-api/tests/api/` | 针对内容 API 和管理 API 的 HTTP 请求，包括一致性测试套件 |

**DDL 快照。** `crates/verdin-migrate/tests/sql_snapshots.rs` 为每种方言渲染一个示例 schema 的 DDL，并与 `crates/verdin-migrate/tests/snapshots/` 中的 [`insta`](https://insta.rs) 快照进行比较。当你有意修改 DDL 时，请用 `cargo insta review`（来自 `cargo-insta`）审查并接受新的快照，然后提交它们。

**API 测试**位于同一个测试二进制文件中（`tests/api/main.rs`，每个领域一个模块），以减少链接时间和 `target/` 的大小。`tests/api/common/mod.rs` 中的测试框架会为每个测试在一个全新的、已迁移的数据库上构建位于 `/api` 的内容 API 和位于 `/admin/api` 的管理 API。除非测试传入了其他令牌或不传令牌，否则请求会携带一个完全访问的 API 令牌。

## 六种数据库的矩阵

每个涉及数据库的测试都会读取 `VERDIN_TEST_DATABASE_URL`，默认使用内存中的 SQLite。`verdin-testkit` 为每个测试提供一个独立的数据库：一个临时的 SQLite 文件，或者在服务器上创建、之后删除的全新 `vd_test_…` 数据库。

CI 针对每种引擎运行一次整个工作区：

| 引擎 | 镜像 |
|---|---|
| SQLite | 内置 |
| PostgreSQL 14 | `postgres:14-alpine` |
| PostgreSQL 17 | `postgres:17-alpine` |
| MySQL 8.4 | `mysql:8.4` |
| MariaDB 10.11 | `mariadb:10.11` |
| MariaDB 11.4 | `mariadb:11.4` |

这些是[最低版本](/zh-cn/internals/database/#最低版本)加上 Verdin 测试所用的最新版本。CI 还会设置 `VERDIN_TEST_EXPECT_FLAVOR`，让 `crates/verdin-db/tests/connect.rs` 断言引擎被正确检测（MariaDB 通过 `mysql://` URL 访问，但仍必须被识别为 MariaDB）。

要在本地运行该矩阵，请用 Docker 启动数据库：

```sh title="Terminal"
docker compose -f docker/compose.dev.yml up -d
```

然后针对每种引擎运行测试。测试会为每个测试创建一个数据库，因此在 MySQL 和 MariaDB 上以 `root` 连接：

```sh title="Terminal"
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5414/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5417/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3384/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3311/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3314/verdin cargo test --workspace
```

这些端口分别对应 PostgreSQL 14 和 17、MySQL 8.4，以及 MariaDB 10.11 和 11.4。同一个 compose 文件还会启动 RustFS（端口 9000 上的 S3 兼容存储）和 Mailpit（端口 1025 上的 SMTP，端口 8025 上的收件箱），用于媒体和邮件相关的开发。

## 一致性测试套件

`crates/verdin-api/tests/api/conformance.rs` 会在每种引擎上向内容 API 发送相同的 HTTP 请求并检查响应：创建、读取、更新和删除的往返、输入校验、草稿与发布、过滤及其文本匹配规则、排序和分页、字段类型和 populate、唯一值、单一类型、内容 API 访问规则、OpenAPI 文档，以及按组件字段过滤。`tests/api/` 中的其他模块（`filters.rs`、`populate.rs`、`relations.rs`、`components.rs`、`morph.rs`、`i18n.rs`……）以同样的方式覆盖各自的领域，因此整个 `verdin-api` 测试二进制文件实际上就是一致性测试套件。

修复一个方言差异时，请把该用例加到这里：在 PostgreSQL 上通过、在 MySQL 上失败的测试，正是这个套件要捕获的。

## 管理后台测试

**单元测试**是 `admin/src/app` 中与代码放在一起的 `*.spec.ts` 文件，通过 Angular 的单元测试构建器在 jsdom 中用 Vitest 运行。它们覆盖纯模型：表单模型转换、字段规则、列表过滤和视图、权限、ICU 转译器、一周起始日等。

```sh title="Terminal"
cd admin
npx ng test --watch=false
```

**端到端测试**是 `admin/e2e/` 中的 Playwright 测试。`e2e/serve.sh` 会创建一个一次性项目（带有一个示例 WebAssembly 插件），并在 SQLite 上以端口 1393 启动 `verdin dev`，从 `admin/dist/admin/browser` 提供管理后台。测试在 Chromium 中以英文界面逐个运行。

```sh title="Terminal"
cd admin
npx ng build
cargo build -p verdin
npx playwright install chromium
npx playwright test
```

这些测试覆盖登录和双因素认证、条目编辑器、多态关联、审核工作流、团队和治理功能、提及、导入和导出、编辑视图以及未保存更改的保护。

## CI

`.github/workflows/ci.yml` 在每次推送到 `main` 以及每个 pull request 时运行。所有 Rust 任务都以 `RUSTFLAGS=-D warnings` 构建。

| 任务 | 检查内容 |
|---|---|
| `lint` | `cargo fmt --all --check`、`cargo clippy --workspace --all-targets`、`cargo deny`（许可证和安全公告） |
| `test (sqlite)` | 在内存 SQLite 上运行 `cargo test --workspace` |
| `test (…)` | 在 PostgreSQL 14 和 17、MySQL 8.4、MariaDB 10.11 和 11.4 上运行 `cargo test --workspace`，每种一个任务，以 Docker 服务的形式运行 |
| `test (s3 storage, RustFS)` | 针对一个 RustFS 容器运行 `cargo test -p verdin-upload --test s3` |
| `admin` | Prettier 检查、`npm run i18n:check`、`npm audit --audit-level=high`、单元测试、`ng build`、`cargo build -p verdin --features embed-admin`、Playwright |
| `client` | `packages/client` 与工作区版本一致，然后进行类型检查、测试和构建 |
| `site` | `npm audit`，以及文档构建，任何失效的内部链接都会导致构建失败 |

失败的 Playwright 运行会把其 trace 作为构件上传，保留七天。
