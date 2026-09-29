---
title: Тестування
description: Як тестують Verdin — від unit-тестів Rust до набору тестів відповідності, що виконується на шести базах даних, unit- і Playwright-тестів адмін-панелі та завдань CI, що перевіряють кожну зміну.
sidebar:
  order: 7
---

На цій сторінці пояснено набори тестів, як запустити кожен локально і що CI перевіряє в кожному pull request. Правило, що стоїть за всім цим: функцію не завершено, доки вона не проходить на кожній підтримуваній базі даних.

## Тести Rust

Запустіть усе командою:

```sh title="Terminal"
cargo test --workspace
```

Без конфігурації тести використовують SQLite. Є три види:

| Вид | Де | Що |
|---|---|---|
| Unit-тести | Модулі `#[cfg(test)]` у кожному crate | Розбір і валідація схеми, іменування, diff і план, розбір запитів, генерація SQL для кожного діалекту, кодування значень, валідація вхідних даних |
| Інтеграційні тести crates | `crates/*/tests/` | Підключення й визначення flavor (`verdin-db`), застосування міграцій (`verdin-migrate`), процеси автентифікації (`verdin-auth`), GraphQL, плагіни, сховище S3 |
| Тести API | `crates/verdin-api/tests/api/` | HTTP-запити до API вмісту й admin API, включно з набором тестів відповідності |

**Снапшоти DDL.** `crates/verdin-migrate/tests/sql_snapshots.rs` генерує DDL зразкової схеми для кожного діалекту й порівнює його зі снапшотами [`insta`](https://insta.rs) у `crates/verdin-migrate/tests/snapshots/`. Коли ви навмисно змінюєте DDL, перегляньте й прийміть нові снапшоти через `cargo insta review` (з `cargo-insta`) і закомітьте їх.

**Тести API** живуть в одному тестовому бінарнику (`tests/api/main.rs`, один модуль на область), щоб зменшити час лінкування й розмір `target/`. Harness у `tests/api/common/mod.rs` будує API вмісту на `/api` і admin API на `/admin/api` поверх нової мігрованої бази даних для кожного тесту. Запити містять API-токен повного доступу, якщо тест не передає інший або жодного.

## Матриця з шести баз даних

Кожен тест, що звертається до бази даних, читає `VERDIN_TEST_DATABASE_URL` і типово використовує SQLite у пам'яті. `verdin-testkit` дає кожному тесту власну базу даних: тимчасовий файл SQLite або нову базу `vd_test_…`, створену на сервері й видалену після тесту.

CI запускає весь workspace один раз для кожного рушія:

| Рушій | Образ |
|---|---|
| SQLite | вбудований |
| PostgreSQL 14 | `postgres:14-alpine` |
| PostgreSQL 17 | `postgres:17-alpine` |
| MySQL 8.4 | `mysql:8.4` |
| MariaDB 10.11 | `mariadb:10.11` |
| MariaDB 11.4 | `mariadb:11.4` |

Це [мінімальні версії](/uk/internals/database/#мінімальні-версії) плюс найновіші, на яких тестують Verdin. CI також задає `VERDIN_TEST_EXPECT_FLAVOR`, щоб `crates/verdin-db/tests/connect.rs` перевіряв, що рушій визначено правильно (до MariaDB підключаються через URL `mysql://`, і її однаково треба визначити як MariaDB).

Щоб запустити матрицю локально, запустіть бази даних через Docker:

```sh title="Terminal"
docker compose -f docker/compose.dev.yml up -d
```

Потім запустіть тести на кожному рушії. Тести створюють базу даних для кожного тесту, тож у MySQL і MariaDB вони підключаються як `root`:

```sh title="Terminal"
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5414/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5417/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3384/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3311/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3314/verdin cargo test --workspace
```

Порти відповідають PostgreSQL 14 і 17, MySQL 8.4 та MariaDB 10.11 і 11.4. Той самий файл compose запускає RustFS (S3-сумісне сховище на порту 9000) і Mailpit (SMTP на порту 1025, поштова скринька на порту 8025) для роботи з медіа й поштою.

## Набір тестів відповідності

`crates/verdin-api/tests/api/conformance.rs` надсилає однакові HTTP-запити до API вмісту на кожному рушії й перевіряє відповіді: повні цикли створення, читання, оновлення й видалення, валідацію вхідних даних, чернетки й публікацію, фільтри та їхні правила зіставлення тексту, сортування й пагінацію, типи полів і populate, унікальні значення, поодинокі типи, правила доступу до API вмісту, документ OpenAPI та фільтри за полями компонентів. Інші модулі в `tests/api/` (`filters.rs`, `populate.rs`, `relations.rs`, `components.rs`, `morph.rs`, `i18n.rs`…) так само покривають свої області, тож увесь тестовий бінарник `verdin-api` фактично і є набором тестів відповідності.

Коли виправляєте відмінність діалекту, додайте випадок сюди: тест, що проходить на PostgreSQL і падає на MySQL, — саме той, заради якого існує цей набір.

## Тести адмін-панелі

**Unit-тести** — це файли `*.spec.ts` поруч із кодом в `admin/src/app`, що запускаються через Vitest за допомогою unit-test builder Angular у jsdom. Вони покривають чисті моделі: перетворення моделі форми, правила полів, фільтри й види списків, дозволи, транспайлер ICU, початок тижня тощо.

```sh title="Terminal"
cd admin
npx ng test --watch=false
```

**End-to-end тести** — це специфікації Playwright в `admin/e2e/`. `e2e/serve.sh` створює одноразовий проєкт (зі зразковим плагіном WebAssembly) і запускає `verdin dev` на порту 1393 із SQLite, віддаючи адмінку з `admin/dist/admin/browser`. Тести виконуються по одному в Chromium з англійським інтерфейсом.

```sh title="Terminal"
cd admin
npx ng build
cargo build -p verdin
npx playwright install chromium
npx playwright test
```

Специфікації покривають вхід і двофакторну автентифікацію, редактор запису, поліморфні зв'язки, процеси перевірки, функції команди й управління, згадки, імпорт і експорт, види редагування та захист незбережених змін.

## CI

`.github/workflows/ci.yml` запускається на кожен push у `main` і кожен pull request. Усі завдання Rust збираються з `RUSTFLAGS=-D warnings`.

| Завдання | Перевіряє |
|---|---|
| `lint` | `cargo fmt --all --check`, `cargo clippy --workspace --all-targets`, `cargo deny` (ліцензії й повідомлення про вразливості) |
| `test (sqlite)` | `cargo test --workspace` на SQLite у пам'яті |
| `test (…)` | `cargo test --workspace` на PostgreSQL 14 і 17, MySQL 8.4, MariaDB 10.11 і 11.4, по одному завданню на кожен, як сервіси Docker |
| `test (s3 storage, RustFS)` | `cargo test -p verdin-upload --test s3` на контейнері RustFS |
| `admin` | Перевірка Prettier, `npm run i18n:check`, `npm audit --audit-level=high`, unit-тести, `ng build`, `cargo build -p verdin --features embed-admin`, Playwright |
| `client` | `packages/client` має ту саму версію, що й workspace, потім перевірка типів, тести й збірка |
| `site` | `npm audit` і збірка документації, що падає на будь-якому зламаному внутрішньому посиланні |

Невдалі запуски Playwright завантажують свої трасування як артефакт, що зберігається сім днів.
