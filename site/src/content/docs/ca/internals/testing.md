---
title: Proves
description: Com es prova Verdin, des de les proves unitàries de Rust fins al conjunt de conformitat que s'executa amb sis bases de dades, les proves unitàries i de Playwright del tauler d'administració, i les tasques de CI que validen cada canvi.
sidebar:
  order: 7
---

Aquesta pàgina explica els conjunts de proves, com executar-los en local i què comprova la CI a cada
pull request. La regla que hi ha darrere de tot plegat: una funcionalitat no està acabada fins que no
passa a totes les bases de dades admeses.

## Proves de Rust

Executa-ho tot amb:

```sh title="Terminal"
cargo test --workspace
```

Sense configuració, les proves fan servir SQLite. N'hi ha de tres tipus:

| Tipus | On | Què |
|---|---|---|
| Proves unitàries | Mòduls `#[cfg(test)]` a cada crate | Anàlisi i validació de l'esquema, noms, diff i pla, anàlisi de consultes, generació d'SQL per dialecte, codificació de valors, validació de l'entrada |
| Proves d'integració dels crates | `crates/*/tests/` | Connexió i detecció del flavor (`verdin-db`), aplicació de migracions (`verdin-migrate`), fluxos d'autenticació (`verdin-auth`), GraphQL, connectors, emmagatzematge S3 |
| Proves de l'API | `crates/verdin-api/tests/api/` | Peticions HTTP contra l'API de contingut i l'API d'administració, inclòs el conjunt de conformitat |

**Snapshots de DDL.** `crates/verdin-migrate/tests/sql_snapshots.rs` genera el DDL d'un esquema de
mostra per a cada dialecte i el compara amb els snapshots d'[`insta`](https://insta.rs) de
`crates/verdin-migrate/tests/snapshots/`. Quan canviïs el DDL expressament, revisa i accepta els
snapshots nous amb `cargo insta review` (de `cargo-insta`) i confirma'ls.

**Les proves de l'API** viuen en un sol binari de proves (`tests/api/main.rs`, un mòdul per àrea)
per reduir els temps d'enllaç i la mida de `target/`. El marc de proves de `tests/api/common/mod.rs`
construeix l'API de contingut a `/api` i l'API d'administració a `/admin/api` sobre una base de
dades nova i migrada per prova. Les peticions porten un token d'API d'accés complet tret que la prova
en passi un altre, o cap.

## La matriu de sis bases de dades

Totes les proves que toquen una base de dades llegeixen `VERDIN_TEST_DATABASE_URL` i per defecte fan
servir SQLite en memòria. `verdin-testkit` dona a cada prova una base de dades pròpia: un fitxer
SQLite temporal, o una base de dades `vd_test_…` nova creada al servidor i eliminada després.

La CI executa tot l'espai de treball un cop per motor:

| Motor | Imatge |
|---|---|
| SQLite | inclòs |
| PostgreSQL 14 | `postgres:14-alpine` |
| PostgreSQL 17 | `postgres:17-alpine` |
| MySQL 8.4 | `mysql:8.4` |
| MariaDB 10.11 | `mariadb:10.11` |
| MariaDB 11.4 | `mariadb:11.4` |

Aquestes són les [versions mínimes](/ca/internals/database/#versions-mínimes) més les més recents amb
què es prova Verdin. La CI també defineix `VERDIN_TEST_EXPECT_FLAVOR` perquè
`crates/verdin-db/tests/connect.rs` comprovi que el motor s'ha detectat correctament (a MariaDB s'hi
arriba amb un URL `mysql://` i s'ha de detectar igualment com a MariaDB).

Per executar la matriu en local, inicia les bases de dades amb Docker:

```sh title="Terminal"
docker compose -f docker/compose.dev.yml up -d
```

Després executa les proves contra cada motor. Les proves creen una base de dades per prova, així que a
MySQL i MariaDB es connecten com a `root`:

```sh title="Terminal"
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5414/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5417/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3384/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3311/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3314/verdin cargo test --workspace
```

Els ports corresponen a PostgreSQL 14 i 17, MySQL 8.4, i MariaDB 10.11 i 11.4. El mateix fitxer
compose inicia RustFS (emmagatzematge compatible amb S3 al port 9000) i Mailpit (SMTP al port 1025,
safata d'entrada al port 8025) per treballar amb multimèdia i correu.

## Conjunt de conformitat

`crates/verdin-api/tests/api/conformance.rs` envia les mateixes peticions HTTP a l'API de contingut
a tots els motors i comprova les respostes: cicles complets de creació, lectura, actualització i
eliminació, validació de l'entrada, esborrany i publicació, filtres i les seves regles de
coincidència de text, ordenació i paginació, tipus de camp i populate, valors únics, tipus únics,
regles d'accés a l'API de contingut, el document OpenAPI i filtres sobre camps de components. Altres
mòduls de `tests/api/` (`filters.rs`, `populate.rs`, `relations.rs`, `components.rs`, `morph.rs`,
`i18n.rs`…) cobreixen les seves àrees de la mateixa manera, de manera que tot el binari de proves de
`verdin-api` és, a la pràctica, el conjunt de conformitat.

Quan corregeixis una diferència de dialecte, afegeix-hi el cas: la prova que passa a PostgreSQL i
falla a MySQL és exactament la que el conjunt ha de detectar.

## Proves del tauler d'administració

**Les proves unitàries** són fitxers `*.spec.ts` al costat del codi a `admin/src/app`, executats amb
Vitest mitjançant el constructor de proves unitàries d'Angular a jsdom. Cobreixen els models purs:
conversió del model del formulari, regles dels camps, filtres i vistes de llista, permisos, el
transpilador ICU, l'inici de la setmana i més.

```sh title="Terminal"
cd admin
npx ng test --watch=false
```

**Les proves de punta a punta** són especificacions de Playwright a `admin/e2e/`. `e2e/serve.sh` crea
un projecte d'un sol ús (amb un connector WebAssembly de mostra) i inicia `verdin dev` al port 1393
amb SQLite, servint l'administració des d'`admin/dist/admin/browser`. Les proves s'executen una per
una a Chromium amb la interfície en anglès.

```sh title="Terminal"
cd admin
npx ng build
cargo build -p verdin
npx playwright install chromium
npx playwright test
```

Les especificacions cobreixen l'inici de sessió i els dos factors, l'editor d'entrades, les relacions
polimòrfiques, els fluxos de revisió, les funcionalitats d'equip i de governança, les mencions, la
importació i l'exportació, les vistes d'edició i els guards de canvis sense desar.

## CI

`.github/workflows/ci.yml` s'executa a cada push a `main` i a cada pull request. Totes les tasques de
Rust compilen amb `RUSTFLAGS=-D warnings`.

| Tasca | Comprova |
|---|---|
| `lint` | `cargo fmt --all --check`, `cargo clippy --workspace --all-targets`, `cargo deny` (llicències i avisos) |
| `test (sqlite)` | `cargo test --workspace` amb SQLite en memòria |
| `test (…)` | `cargo test --workspace` amb PostgreSQL 14 i 17, MySQL 8.4, MariaDB 10.11 i 11.4, una tasca per a cadascun, com a serveis Docker |
| `test (s3 storage, RustFS)` | `cargo test -p verdin-upload --test s3` contra un contenidor RustFS |
| `admin` | Comprovació de Prettier, `npm run i18n:check`, `npm audit --audit-level=high`, proves unitàries, `ng build`, `cargo build -p verdin --features embed-admin`, Playwright |
| `client` | `packages/client` té la mateixa versió que l'espai de treball, i després comprovació de tipus, proves i build |
| `site` | `npm audit`, i la compilació de la documentació, que falla amb qualsevol enllaç intern trencat |

Les execucions de Playwright fallides pugen les seves traces com a artefacte, que es conserva durant
set dies.
