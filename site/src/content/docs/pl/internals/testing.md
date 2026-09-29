---
title: Testowanie
description: Jak testowany jest Verdin, od testów jednostkowych w Rust po zestaw testów zgodności uruchamiany na sześciu bazach danych, testy jednostkowe i Playwright panelu administracyjnego oraz zadania CI, które pilnują każdej zmiany.
sidebar:
  order: 7
---

Ta strona wyjaśnia zestawy testów, jak uruchomić każdy z nich lokalnie i co CI sprawdza przy każdym pull requeście. Zasada stojąca za wszystkim: funkcja nie jest gotowa, dopóki nie przechodzi na każdej obsługiwanej bazie danych.

## Testy w Rust

Uruchom wszystko przez:

```sh title="Terminal"
cargo test --workspace
```

Bez konfiguracji testy używają SQLite. Są trzy rodzaje:

| Rodzaj | Gdzie | Co |
|---|---|---|
| Testy jednostkowe | Moduły `#[cfg(test)]` w każdym crate | Parsowanie i walidacja schematu, nazewnictwo, diff i plan, parsowanie zapytań, generowanie SQL per dialekt, kodowanie wartości, walidacja danych wejściowych |
| Testy integracyjne crate'ów | `crates/*/tests/` | Łączenie i wykrywanie flavor (`verdin-db`), stosowanie migracji (`verdin-migrate`), przepływy uwierzytelniania (`verdin-auth`), GraphQL, wtyczki, magazyn S3 |
| Testy API | `crates/verdin-api/tests/api/` | Żądania HTTP do API treści i API administracyjnego, łącznie z zestawem zgodności |

**Snapshoty DDL.** `crates/verdin-migrate/tests/sql_snapshots.rs` renderuje DDL przykładowego schematu dla każdego dialektu i porównuje go ze snapshotami [`insta`](https://insta.rs) w `crates/verdin-migrate/tests/snapshots/`. Gdy celowo zmieniasz DDL, przejrzyj i zaakceptuj nowe snapshoty przez `cargo insta review` (z `cargo-insta`) i je zatwierdź.

**Testy API** znajdują się w jednej binarce testowej (`tests/api/main.rs`, jeden moduł na obszar), aby ograniczyć czas linkowania i rozmiar `target/`. Harness w `tests/api/common/mod.rs` buduje API treści pod `/api` i API administracyjne pod `/admin/api` na świeżej, zmigrowanej bazie danych dla każdego testu. Żądania niosą token API z pełnym dostępem, chyba że test przekaże inny albo żaden.

## Macierz sześciu baz danych

Każdy test korzystający z bazy danych czyta `VERDIN_TEST_DATABASE_URL`, a domyślnie używa SQLite w pamięci. `verdin-testkit` daje każdemu testowi własną bazę danych: tymczasowy plik SQLite albo świeżą bazę `vd_test_…` tworzoną na serwerze i potem usuwaną.

CI uruchamia cały workspace raz na silnik:

| Silnik | Obraz |
|---|---|
| SQLite | wbudowany |
| PostgreSQL 14 | `postgres:14-alpine` |
| PostgreSQL 17 | `postgres:17-alpine` |
| MySQL 8.4 | `mysql:8.4` |
| MariaDB 10.11 | `mariadb:10.11` |
| MariaDB 11.4 | `mariadb:11.4` |

To [minimalne wersje](/pl/internals/database/#minimalne-wersje) plus najnowsze, na których testowany jest Verdin. CI ustawia też `VERDIN_TEST_EXPECT_FLAVOR`, aby `crates/verdin-db/tests/connect.rs` sprawdzał poprawne wykrycie silnika (do MariaDB łączy się przez URL `mysql://` i nadal musi zostać wykryta jako MariaDB).

Aby uruchomić macierz lokalnie, uruchom bazy danych w Dockerze:

```sh title="Terminal"
docker compose -f docker/compose.dev.yml up -d
```

Potem uruchom testy na każdym silniku. Testy tworzą bazę danych na test, więc w MySQL i MariaDB łączą się jako `root`:

```sh title="Terminal"
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5414/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5417/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3384/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3311/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3314/verdin cargo test --workspace
```

Porty odpowiadają PostgreSQL 14 i 17, MySQL 8.4 oraz MariaDB 10.11 i 11.4. Ten sam plik compose uruchamia RustFS (magazyn zgodny z S3 na porcie 9000) i Mailpit (SMTP na porcie 1025, skrzynka na porcie 8025) do pracy z multimediami i e-mailem.

## Zestaw testów zgodności

`crates/verdin-api/tests/api/conformance.rs` wysyła te same żądania HTTP do API treści na każdym silniku i sprawdza odpowiedzi: pełne cykle tworzenia, odczytu, aktualizacji i usuwania, walidację danych wejściowych, szkice i publikację, filtry i ich reguły dopasowania tekstu, sortowanie i paginację, typy pól i populate, wartości unikalne, pojedyncze typy, reguły dostępu do API treści, dokument OpenAPI i filtry po polach komponentów. Inne moduły w `tests/api/` (`filters.rs`, `populate.rs`, `relations.rs`, `components.rs`, `morph.rs`, `i18n.rs`…) pokrywają swoje obszary w ten sam sposób, więc cała binarka testowa `verdin-api` jest w praktyce zestawem zgodności.

Gdy naprawiasz różnicę między dialektami, dodaj tu przypadek: test, który przechodzi na PostgreSQL i nie przechodzi na MySQL, to dokładnie ten, dla którego istnieje zestaw.

## Testy panelu administracyjnego

**Testy jednostkowe** to pliki `*.spec.ts` obok kodu w `admin/src/app`, uruchamiane Vitestem przez unit-test builder Angulara w jsdom. Obejmują czyste modele: konwersję modelu formularza, reguły pól, filtry i widoki list, uprawnienia, transpiler ICU, początek tygodnia i więcej.

```sh title="Terminal"
cd admin
npx ng test --watch=false
```

**Testy end-to-end** to specyfikacje Playwright w `admin/e2e/`. `e2e/serve.sh` tworzy jednorazowy projekt (z przykładową wtyczką WebAssembly) i uruchamia `verdin dev` na porcie 1393 na SQLite, serwując panel z `admin/dist/admin/browser`. Testy działają pojedynczo w Chromium z angielskim interfejsem.

```sh title="Terminal"
cd admin
npx ng build
cargo build -p verdin
npx playwright install chromium
npx playwright test
```

Specyfikacje obejmują logowanie i dwa składniki, edytor wpisu, relacje polimorficzne, przepływy recenzji, funkcje zespołowe i zarządcze, wzmianki, import i eksport, widoki edycji i ochronę przed utratą niezapisanych zmian.

## CI

`.github/workflows/ci.yml` działa przy każdym pushu do `main` i każdym pull requeście. Wszystkie zadania Rust budują z `RUSTFLAGS=-D warnings`.

| Zadanie | Sprawdza |
|---|---|
| `lint` | `cargo fmt --all --check`, `cargo clippy --workspace --all-targets`, `cargo deny` (licencje i biuletyny bezpieczeństwa) |
| `test (sqlite)` | `cargo test --workspace` na SQLite w pamięci |
| `test (…)` | `cargo test --workspace` na PostgreSQL 14 i 17, MySQL 8.4, MariaDB 10.11 i 11.4, po jednym zadaniu, jako usługi Docker |
| `test (s3 storage, RustFS)` | `cargo test -p verdin-upload --test s3` na kontenerze RustFS |
| `admin` | Sprawdzenie Prettier, `npm run i18n:check`, `npm audit --audit-level=high`, testy jednostkowe, `ng build`, `cargo build -p verdin --features embed-admin`, Playwright |
| `client` | `packages/client` ma tę samą wersję co workspace, potem sprawdzenie typów, testy i build |
| `site` | `npm audit` i build dokumentacji, który kończy się błędem przy każdym zepsutym linku wewnętrznym |

Nieudane uruchomienia Playwright przesyłają swoje ślady jako artefakt, przechowywany przez siedem dni.
