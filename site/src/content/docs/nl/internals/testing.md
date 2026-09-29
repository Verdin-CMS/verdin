---
title: Testen
description: Hoe Verdin wordt getest, van Rust-unittests tot de conformiteitssuite die op zes databases draait, de unit- en Playwright-tests van het beheerpaneel, en de CI-jobs die elke wijziging bewaken.
sidebar:
  order: 7
---

Deze pagina legt de testsuites uit, hoe je elk ervan lokaal draait, en wat CI bij elke pull request controleert. De regel achter dit alles: een functie is pas klaar als ze op elke ondersteunde database slaagt.

## Rust-tests

Draai alles met:

```sh title="Terminal"
cargo test --workspace
```

Zonder configuratie gebruiken de tests SQLite. Er zijn drie soorten:

| Soort | Waar | Wat |
|---|---|---|
| Unittests | `#[cfg(test)]`-modules in elke crate | Schema parsen en valideren, naamgeving, diff en plan, query parsen, SQL genereren per dialect, waarden coderen, input valideren |
| Integratietests per crate | `crates/*/tests/` | Verbinden en flavor-detectie (`verdin-db`), migraties toepassen (`verdin-migrate`), authflows (`verdin-auth`), GraphQL, plugins, S3-opslag |
| API-tests | `crates/verdin-api/tests/api/` | HTTP-requests tegen de content-API en de admin-API, inclusief de conformiteitssuite |

**DDL-snapshots.** `crates/verdin-migrate/tests/sql_snapshots.rs` rendert de DDL van een voorbeeldschema voor elk dialect en vergelijkt die met de [`insta`](https://insta.rs)-snapshots in `crates/verdin-migrate/tests/snapshots/`. Als je DDL bewust wijzigt, bekijk en accepteer je de nieuwe snapshots met `cargo insta review` (uit `cargo-insta`) en commit je ze.

**API-tests** staan in één testbinary (`tests/api/main.rs`, één module per gebied) om linktijden en de grootte van `target/` beperkt te houden. Het harnas in `tests/api/common/mod.rs` bouwt de content-API op `/api` en de admin-API op `/admin/api` op een verse, gemigreerde database per test. Requests bevatten een API-token met volledige toegang, tenzij de test een ander token meegeeft, of geen.

## De matrix van zes databases

Elke test die een database aanraakt, leest `VERDIN_TEST_DATABASE_URL` en valt standaard terug op SQLite in het geheugen. `verdin-testkit` geeft elke test een eigen database: een tijdelijk SQLite-bestand, of een verse database `vd_test_…` die op de server wordt aangemaakt en daarna verwijderd.

CI draait de hele workspace één keer per engine:

| Engine | Image |
|---|---|
| SQLite | meegeleverd |
| PostgreSQL 14 | `postgres:14-alpine` |
| PostgreSQL 17 | `postgres:17-alpine` |
| MySQL 8.4 | `mysql:8.4` |
| MariaDB 10.11 | `mariadb:10.11` |
| MariaDB 11.4 | `mariadb:11.4` |

Dit zijn de [minimale versies](/nl/internals/database/#minimale-versies) plus de nieuwste waarop Verdin wordt getest. CI stelt ook `VERDIN_TEST_EXPECT_FLAVOR` in, zodat `crates/verdin-db/tests/connect.rs` controleert dat de engine correct is gedetecteerd (MariaDB wordt bereikt met een `mysql://`-URL en moet toch als MariaDB worden gedetecteerd).

Om de matrix lokaal te draaien, start je de databases met Docker:

```sh title="Terminal"
docker compose -f docker/compose.dev.yml up -d
```

Draai daarna de tests tegen elke engine. Tests maken een database per test aan, dus op MySQL en MariaDB verbinden ze als `root`:

```sh title="Terminal"
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5414/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5417/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3384/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3311/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3314/verdin cargo test --workspace
```

De poorten komen overeen met PostgreSQL 14 en 17, MySQL 8.4, en MariaDB 10.11 en 11.4. Hetzelfde compose-bestand start RustFS (S3-compatibele opslag op poort 9000) en Mailpit (SMTP op poort 1025, inbox op poort 8025) voor werk aan media en e-mail.

## Conformiteitssuite

`crates/verdin-api/tests/api/conformance.rs` stuurt op elke engine dezelfde HTTP-requests naar de content-API en controleert de responses: rondes van aanmaken, lezen, bijwerken en verwijderen, inputvalidatie, concept en publicatie, filters en hun regels voor tekstvergelijking, sorteren en paginering, veldtypes en populate, unieke waarden, enkele types, toegangsregels van de content-API, het OpenAPI-document, en filters op componentvelden. Andere modules in `tests/api/` (`filters.rs`, `populate.rs`, `relations.rs`, `components.rs`, `morph.rs`, `i18n.rs`…) dekken hun gebied op dezelfde manier, dus de hele testbinary van `verdin-api` is in feite de conformiteitssuite.

Als je een verschil tussen dialecten oplost, voeg je het geval hier toe: de test die op PostgreSQL slaagt en op MySQL faalt, is precies degene waarvoor de suite bestaat.

## Tests van het beheerpaneel

**Unittests** zijn `*.spec.ts`-bestanden naast de code in `admin/src/app`, gedraaid met Vitest via de unit-test-builder van Angular in jsdom. Ze dekken de pure modellen: conversie van het formuliermodel, veldregels, lijstfilters en -weergaven, rechten, de ICU-transpiler, het begin van de week, en meer.

```sh title="Terminal"
cd admin
npx ng test --watch=false
```

**End-to-endtests** zijn Playwright-specs in `admin/e2e/`. `e2e/serve.sh` maakt een wegwerpproject aan (met een voorbeeldplugin in WebAssembly), en start `verdin dev` op poort 1393 op SQLite, met het beheerpaneel uit `admin/dist/admin/browser`. Tests draaien één voor één in Chromium met een Engelse UI.

```sh title="Terminal"
cd admin
npx ng build
cargo build -p verdin
npx playwright install chromium
npx playwright test
```

De specs dekken inloggen en tweefactor, de item-editor, polymorfe relaties, reviewworkflows, team- en governancefuncties, vermeldingen, importeren en exporteren, bewerkweergaven en de bewaking van niet-opgeslagen wijzigingen.

## CI

`.github/workflows/ci.yml` draait bij elke push naar `main` en elke pull request. Alle Rust-jobs bouwen met `RUSTFLAGS=-D warnings`.

| Job | Controleert |
|---|---|
| `lint` | `cargo fmt --all --check`, `cargo clippy --workspace --all-targets`, `cargo deny` (licenties en advisories) |
| `test (sqlite)` | `cargo test --workspace` op SQLite in het geheugen |
| `test (…)` | `cargo test --workspace` op PostgreSQL 14 en 17, MySQL 8.4, MariaDB 10.11 en 11.4, elk een eigen job, als Docker-services |
| `test (s3 storage, RustFS)` | `cargo test -p verdin-upload --test s3` tegen een RustFS-container |
| `admin` | Prettier-controle, `npm run i18n:check`, `npm audit --audit-level=high`, unittests, `ng build`, `cargo build -p verdin --features embed-admin`, Playwright |
| `client` | `packages/client` heeft dezelfde versie als de workspace, daarna typecontrole, tests en build |
| `site` | `npm audit`, en de build van de documentatie, die faalt bij elke kapotte interne link |

Mislukte Playwright-runs uploaden hun traces als artifact, zeven dagen bewaard.
