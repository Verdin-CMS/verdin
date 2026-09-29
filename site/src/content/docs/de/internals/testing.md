---
title: Tests
description: Wie Verdin getestet wird, von Rust-Unit-Tests über die Konformitätssuite auf sechs Datenbanken und die Unit- und Playwright-Tests des Admin-Panels bis zu den CI-Jobs, die jede Änderung absichern.
sidebar:
  order: 7
---

Diese Seite erklärt die Testsuiten, wie du jede lokal ausführst und was die CI bei jedem Pull Request prüft. Die Regel dahinter: Eine Funktion ist erst fertig, wenn sie auf jeder unterstützten Datenbank besteht.

## Rust-Tests

Führe alles aus mit:

```sh title="Terminal"
cargo test --workspace
```

Ohne Konfiguration nutzen die Tests SQLite. Es gibt drei Arten:

| Art | Wo | Was |
|---|---|---|
| Unit-Tests | `#[cfg(test)]`-Module in jedem Crate | Parsen und Validieren des Schemas, Benennung, Diff und Plan, Parsen von Abfragen, SQL-Erzeugung pro Dialekt, Kodierung von Werten, Validierung von Eingaben |
| Integrationstests der Crates | `crates/*/tests/` | Verbinden und Erkennen des Flavors (`verdin-db`), Anwenden von Migrationen (`verdin-migrate`), Auth-Abläufe (`verdin-auth`), GraphQL, Plugins, S3-Speicher |
| API-Tests | `crates/verdin-api/tests/api/` | HTTP-Anfragen gegen Content-API und Admin-API, einschließlich der Konformitätssuite |

**DDL-Snapshots.** `crates/verdin-migrate/tests/sql_snapshots.rs` rendert die DDL eines Beispielschemas für jeden Dialekt und vergleicht sie mit den [`insta`](https://insta.rs)-Snapshots in `crates/verdin-migrate/tests/snapshots/`. Wenn du die DDL absichtlich änderst, prüfe und akzeptiere die neuen Snapshots mit `cargo insta review` (aus `cargo-insta`) und committe sie.

**API-Tests** liegen in einer einzigen Test-Binärdatei (`tests/api/main.rs`, ein Modul pro Bereich), um Linkzeiten und die Größe von `target/` klein zu halten. Das Harness in `tests/api/common/mod.rs` baut die Content-API unter `/api` und die Admin-API unter `/admin/api` über einer frischen, migrierten Datenbank pro Test. Anfragen tragen ein API-Token mit Vollzugriff, sofern der Test nicht ein anderes oder keines übergibt.

## Die Matrix mit sechs Datenbanken

Jeder Test, der eine Datenbank berührt, liest `VERDIN_TEST_DATABASE_URL` und nutzt standardmäßig In-Memory-SQLite. `verdin-testkit` gibt jedem Test eine eigene Datenbank: eine temporäre SQLite-Datei oder eine frische Datenbank `vd_test_…`, die auf dem Server angelegt und danach wieder entfernt wird.

Die CI führt den ganzen Workspace einmal pro Engine aus:

| Engine | Image |
|---|---|
| SQLite | mitgeliefert |
| PostgreSQL 14 | `postgres:14-alpine` |
| PostgreSQL 17 | `postgres:17-alpine` |
| MySQL 8.4 | `mysql:8.4` |
| MariaDB 10.11 | `mariadb:10.11` |
| MariaDB 11.4 | `mariadb:11.4` |

Das sind die [Mindestversionen](/de/internals/database/#mindestversionen) plus die neuesten, auf denen Verdin getestet wird. Die CI setzt außerdem `VERDIN_TEST_EXPECT_FLAVOR`, damit `crates/verdin-db/tests/connect.rs` prüft, dass die Engine richtig erkannt wurde (MariaDB wird mit einer `mysql://`-URL erreicht und muss trotzdem als MariaDB erkannt werden).

Um die Matrix lokal auszuführen, starte die Datenbanken mit Docker:

```sh title="Terminal"
docker compose -f docker/compose.dev.yml up -d
```

Führe dann die Tests gegen jede Engine aus. Die Tests legen pro Test eine Datenbank an, auf MySQL und MariaDB verbinden sie sich deshalb als `root`:

```sh title="Terminal"
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5414/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5417/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3384/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3311/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3314/verdin cargo test --workspace
```

Die Ports gehören zu PostgreSQL 14 und 17, MySQL 8.4 sowie MariaDB 10.11 und 11.4. Dieselbe Compose-Datei startet RustFS (S3-kompatibler Speicher auf Port 9000) und Mailpit (SMTP auf Port 1025, Posteingang auf Port 8025) für die Arbeit an Medien und E-Mail.

## Konformitätssuite

`crates/verdin-api/tests/api/conformance.rs` schickt auf jeder Engine dieselben HTTP-Anfragen an die Content-API und prüft die Antworten: Anlegen, Lesen, Aktualisieren und Löschen im Rundlauf, Validierung von Eingaben, Entwurf und Veröffentlichung, Filter und ihre Regeln für Textvergleiche, Sortierung und Paginierung, Feldtypen und Populate, eindeutige Werte, Single Types, Zugriffsregeln der Content-API, das OpenAPI-Dokument und Filter auf Komponentenfeldern. Andere Module in `tests/api/` (`filters.rs`, `populate.rs`, `relations.rs`, `components.rs`, `morph.rs`, `i18n.rs`…) decken ihre Bereiche genauso ab, die ganze Test-Binärdatei von `verdin-api` ist also faktisch die Konformitätssuite.

Wenn du einen Unterschied zwischen Dialekten behebst, ergänze den Fall hier: Der Test, der auf PostgreSQL besteht und auf MySQL scheitert, ist genau der, für den es die Suite gibt.

## Tests des Admin-Panels

**Unit-Tests** sind `*.spec.ts`-Dateien neben dem Code in `admin/src/app`, ausgeführt mit Vitest über den Unit-Test-Builder von Angular in jsdom. Sie decken die reinen Modelle ab: Umwandlung des Formularmodells, Feldregeln, Listenfilter und -ansichten, Berechtigungen, den ICU-Transpiler, den Wochenbeginn und mehr.

```sh title="Terminal"
cd admin
npx ng test --watch=false
```

**End-to-End-Tests** sind Playwright-Specs in `admin/e2e/`. `e2e/serve.sh` legt ein Wegwerfprojekt an (mit einem WebAssembly-Beispiel-Plugin) und startet `verdin dev` auf Port 1393 mit SQLite, wobei das Admin-Panel aus `admin/dist/admin/browser` ausgeliefert wird. Die Tests laufen einzeln nacheinander in Chromium mit englischer Oberfläche.

```sh title="Terminal"
cd admin
npx ng build
cargo build -p verdin
npx playwright install chromium
npx playwright test
```

Die Specs decken Anmeldung und Zwei-Faktor, den Eintragseditor, polymorphe Relationen, Review-Workflows, Team- und Governance-Funktionen, Erwähnungen, Import und Export, Bearbeitungsansichten und Guards für ungespeicherte Änderungen ab.

## CI

`.github/workflows/ci.yml` läuft bei jedem Push auf `main` und bei jedem Pull Request. Alle Rust-Jobs bauen mit `RUSTFLAGS=-D warnings`.

| Job | Prüft |
|---|---|
| `lint` | `cargo fmt --all --check`, `cargo clippy --workspace --all-targets`, `cargo deny` (Lizenzen und Advisories) |
| `test (sqlite)` | `cargo test --workspace` auf In-Memory-SQLite |
| `test (…)` | `cargo test --workspace` auf PostgreSQL 14 und 17, MySQL 8.4, MariaDB 10.11 und 11.4, je ein Job, als Docker-Services |
| `test (s3 storage, RustFS)` | `cargo test -p verdin-upload --test s3` gegen einen RustFS-Container |
| `admin` | Prettier-Check, `npm run i18n:check`, `npm audit --audit-level=high`, Unit-Tests, `ng build`, `cargo build -p verdin --features embed-admin`, Playwright |
| `client` | `packages/client` hat dieselbe Version wie der Workspace, dann Typprüfung, Tests und Build |
| `site` | `npm audit` und der Build der Dokumentation, der bei jedem kaputten internen Link fehlschlägt |

Fehlgeschlagene Playwright-Läufe laden ihre Traces als Artefakt hoch, das sieben Tage aufbewahrt wird.
