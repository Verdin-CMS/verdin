---
title: Тестирование
description: Как тестируется Verdin — от модульных тестов на Rust до набора тестов совместимости, который запускается на шести базах данных, модульных тестов и тестов Playwright админ-панели и задач CI, которые проверяют каждое изменение.
sidebar:
  order: 7
---

На этой странице описаны наборы тестов, как запустить каждый из них локально и что CI проверяет в каждом pull request. Главное правило: функция не готова, пока она не проходит на всех поддерживаемых базах данных.

## Тесты на Rust

Запустите всё командой:

```sh title="Terminal"
cargo test --workspace
```

Без настройки тесты используют SQLite. Тесты бывают трёх видов:

| Вид | Где | Что |
|---|---|---|
| Модульные тесты | Модули `#[cfg(test)]` в каждом крейте | Разбор и валидация схемы, именование, diff и план, разбор запросов, генерация SQL для каждого диалекта, кодирование значений, валидация входных данных |
| Интеграционные тесты крейтов | `crates/*/tests/` | Подключение и определение варианта СУБД (`verdin-db`), применение миграций (`verdin-migrate`), сценарии аутентификации (`verdin-auth`), GraphQL, плагины, хранилище S3 |
| Тесты API | `crates/verdin-api/tests/api/` | HTTP-запросы к content API и admin API, включая набор тестов совместимости |

**Снимки DDL.** `crates/verdin-migrate/tests/sql_snapshots.rs` генерирует DDL тестовой схемы для каждого диалекта и сравнивает его со снимками [`insta`](https://insta.rs) в `crates/verdin-migrate/tests/snapshots/`. Если вы намеренно меняете DDL, просмотрите и примите новые снимки через `cargo insta review` (из `cargo-insta`) и закоммитьте их.

**Тесты API** находятся в одном тестовом бинарнике (`tests/api/main.rs`, по модулю на область), чтобы сократить время линковки и размер `target/`. Обвязка в `tests/api/common/mod.rs` собирает content API на `/api` и admin API на `/admin/api` поверх новой мигрированной базы данных для каждого теста. Запросы несут API-токен с полным доступом, если тест не передаёт другой или никакого.

## Матрица из шести баз данных

Каждый тест, который обращается к базе данных, читает `VERDIN_TEST_DATABASE_URL` и по умолчанию использует SQLite в памяти. `verdin-testkit` даёт каждому тесту собственную базу данных: временный файл SQLite или новую базу `vd_test_…`, созданную на сервере и удаляемую после теста.

CI запускает весь workspace по одному разу на каждую СУБД:

| СУБД | Образ |
|---|---|
| SQLite | встроенная |
| PostgreSQL 14 | `postgres:14-alpine` |
| PostgreSQL 17 | `postgres:17-alpine` |
| MySQL 8.4 | `mysql:8.4` |
| MariaDB 10.11 | `mariadb:10.11` |
| MariaDB 11.4 | `mariadb:11.4` |

Это [минимальные версии](/ru/internals/database/#минимальные-версии) плюс самые новые, на которых тестируется Verdin. CI также задаёт `VERDIN_TEST_EXPECT_FLAVOR`, чтобы `crates/verdin-db/tests/connect.rs` проверял, что СУБД определена правильно (к MariaDB подключаются по URL `mysql://`, и она всё равно должна определяться как MariaDB).

Чтобы запустить матрицу локально, поднимите базы данных в Docker:

```sh title="Terminal"
docker compose -f docker/compose.dev.yml up -d
```

Затем запустите тесты на каждой СУБД. Тесты создают базу данных на каждый тест, поэтому в MySQL и MariaDB они подключаются как `root`:

```sh title="Terminal"
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5414/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5417/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3384/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3311/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3314/verdin cargo test --workspace
```

Порты соответствуют PostgreSQL 14 и 17, MySQL 8.4 и MariaDB 10.11 и 11.4. Тот же файл compose запускает RustFS (S3-совместимое хранилище на порту 9000) и Mailpit (SMTP на порту 1025, почтовый ящик на порту 8025) для работы с медиа и почтой.

## Набор тестов совместимости

`crates/verdin-api/tests/api/conformance.rs` отправляет одни и те же HTTP-запросы к content API на каждой СУБД и проверяет ответы: полные циклы создания, чтения, обновления и удаления, валидацию входных данных, черновики и публикацию, фильтры и их правила сравнения текста, сортировку и пагинацию, типы полей и populate, уникальные значения, одиночные типы, правила доступа к content API, документ OpenAPI и фильтры по полям компонентов. Другие модули в `tests/api/` (`filters.rs`, `populate.rs`, `relations.rs`, `components.rs`, `morph.rs`, `i18n.rs`…) так же покрывают свои области, поэтому весь тестовый бинарник `verdin-api` фактически и есть набор тестов совместимости.

Исправляя различие диалектов, добавьте сюда соответствующий случай: тест, который проходит на PostgreSQL и падает на MySQL, — именно то, ради чего существует этот набор.

## Тесты админ-панели

**Модульные тесты** — это файлы `*.spec.ts` рядом с кодом в `admin/src/app`, которые запускаются Vitest через unit-test builder Angular в jsdom. Они покрывают чистые модели: преобразование модели формы, правила полей, фильтры и представления списков, разрешения, транспайлер ICU, начало недели и другое.

```sh title="Terminal"
cd admin
npx ng test --watch=false
```

**End-to-end тесты** — это спецификации Playwright в `admin/e2e/`. `e2e/serve.sh` создаёт одноразовый проект (с тестовым плагином WebAssembly) и запускает `verdin dev` на порту 1393 с SQLite, отдавая админку из `admin/dist/admin/browser`. Тесты выполняются по одному в Chromium с английским интерфейсом.

```sh title="Terminal"
cd admin
npx ng build
cargo build -p verdin
npx playwright install chromium
npx playwright test
```

Спецификации покрывают вход и двухфакторную аутентификацию, редактор записи, полиморфные связи, процессы проверки, командные функции и функции управления, упоминания, импорт и экспорт, представления редактирования и защиту от потери несохранённых изменений.

## CI

`.github/workflows/ci.yml` запускается при каждом push в `main` и в каждом pull request. Все задачи на Rust собираются с `RUSTFLAGS=-D warnings`.

| Задача | Проверяет |
|---|---|
| `lint` | `cargo fmt --all --check`, `cargo clippy --workspace --all-targets`, `cargo deny` (лицензии и уведомления о безопасности) |
| `test (sqlite)` | `cargo test --workspace` на SQLite в памяти |
| `test (…)` | `cargo test --workspace` на PostgreSQL 14 и 17, MySQL 8.4, MariaDB 10.11 и 11.4 — по задаче на каждую, как сервисы Docker |
| `test (s3 storage, RustFS)` | `cargo test -p verdin-upload --test s3` на контейнере RustFS |
| `admin` | Проверка Prettier, `npm run i18n:check`, `npm audit --audit-level=high`, модульные тесты, `ng build`, `cargo build -p verdin --features embed-admin`, Playwright |
| `client` | У `packages/client` та же версия, что у workspace, затем проверка типов, тесты и сборка |
| `site` | `npm audit` и сборка документации, которая падает при любой битой внутренней ссылке |

Неудачные прогоны Playwright загружают свои трассировки как артефакт, который хранится семь дней.
