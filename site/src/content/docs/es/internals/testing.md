---
title: Pruebas
description: Cómo se prueba Verdin, desde las pruebas unitarias en Rust hasta la batería de conformidad que se ejecuta en seis bases de datos, las pruebas unitarias y de Playwright del panel de administración y los jobs de CI que validan cada cambio.
sidebar:
  order: 7
---

Esta página explica las baterías de pruebas, cómo ejecutar cada una en local y qué comprueba la CI en cada pull request. La regla detrás de todo esto: una funcionalidad no está terminada hasta que pasa en todas las bases de datos soportadas.

## Pruebas en Rust

Ejecútalo todo con:

```sh title="Terminal"
cargo test --workspace
```

Sin configuración, las pruebas usan SQLite. Hay tres clases:

| Clase | Dónde | Qué |
|---|---|---|
| Pruebas unitarias | Módulos `#[cfg(test)]` de cada crate | Análisis y validación del esquema, nombres, diferencia y plan, análisis de consultas, generación de SQL por dialecto, codificación de valores, validación de la entrada |
| Pruebas de integración de los crates | `crates/*/tests/` | Conexión y detección del flavor (`verdin-db`), aplicación de migraciones (`verdin-migrate`), flujos de autenticación (`verdin-auth`), GraphQL, plugins, almacenamiento S3 |
| Pruebas de la API | `crates/verdin-api/tests/api/` | Peticiones HTTP contra la API de contenido y la API de administración, incluida la batería de conformidad |

**Snapshots del DDL.** `crates/verdin-migrate/tests/sql_snapshots.rs` genera el DDL de un esquema de ejemplo para cada dialecto y lo compara con los snapshots de [`insta`](https://insta.rs) de `crates/verdin-migrate/tests/snapshots/`. Cuando cambies el DDL a propósito, revisa y acepta los snapshots nuevos con `cargo insta review` (de `cargo-insta`) y confírmalos en git.

**Las pruebas de la API** viven en un único binario de pruebas (`tests/api/main.rs`, un módulo por área) para reducir los tiempos de enlazado y el tamaño de `target/`. El arnés de `tests/api/common/mod.rs` monta la API de contenido en `/api` y la API de administración en `/admin/api` sobre una base de datos nueva y migrada para cada prueba. Las peticiones llevan un token de API de acceso completo salvo que la prueba pase otro, o ninguno.

## La matriz de seis bases de datos

Toda prueba que toca una base de datos lee `VERDIN_TEST_DATABASE_URL` y, por defecto, usa SQLite en memoria. `verdin-testkit` da a cada prueba su propia base de datos: un archivo SQLite temporal, o una base de datos `vd_test_…` nueva creada en el servidor y eliminada después.

La CI ejecuta el workspace entero una vez por motor:

| Motor | Imagen |
|---|---|
| SQLite | incluido |
| PostgreSQL 14 | `postgres:14-alpine` |
| PostgreSQL 17 | `postgres:17-alpine` |
| MySQL 8.4 | `mysql:8.4` |
| MariaDB 10.11 | `mariadb:10.11` |
| MariaDB 11.4 | `mariadb:11.4` |

Son las [versiones mínimas](/es/internals/database/#versiones-mínimas) más las más recientes con las que se prueba Verdin. La CI también define `VERDIN_TEST_EXPECT_FLAVOR` para que `crates/verdin-db/tests/connect.rs` compruebe que el motor se ha detectado correctamente (a MariaDB se llega con una URL `mysql://` y aun así debe detectarse como MariaDB).

Para ejecutar la matriz en local, arranca las bases de datos con Docker:

```sh title="Terminal"
docker compose -f docker/compose.dev.yml up -d
```

Después ejecuta las pruebas contra cada motor. Las pruebas crean una base de datos por prueba, así que en MySQL y MariaDB se conectan como `root`:

```sh title="Terminal"
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5414/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5417/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3384/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3311/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3314/verdin cargo test --workspace
```

Los puertos corresponden a PostgreSQL 14 y 17, MySQL 8.4 y MariaDB 10.11 y 11.4. El mismo archivo de Compose arranca RustFS (almacenamiento compatible con S3 en el puerto 9000) y Mailpit (SMTP en el puerto 1025, bandeja de entrada en el puerto 8025) para trabajar con medios y correo.

## Batería de conformidad

`crates/verdin-api/tests/api/conformance.rs` envía las mismas peticiones HTTP a la API de contenido en todos los motores y comprueba las respuestas: ciclos completos de creación, lectura, actualización y borrado, validación de la entrada, borrador y publicación, filtros y sus reglas de coincidencia de texto, ordenación y paginación, tipos de campo y populate, valores únicos, tipos únicos, reglas de acceso a la API de contenido, el documento OpenAPI y los filtros sobre campos de componentes. Otros módulos de `tests/api/` (`filters.rs`, `populate.rs`, `relations.rs`, `components.rs`, `morph.rs`, `i18n.rs`…) cubren sus áreas de la misma forma, así que el binario de pruebas de `verdin-api` entero es, en la práctica, la batería de conformidad.

Cuando corrijas una diferencia de dialecto, añade el caso aquí: la prueba que pasa en PostgreSQL y falla en MySQL es justo la que la batería existe para detectar.

## Pruebas del panel de administración

**Las pruebas unitarias** son archivos `*.spec.ts` junto al código en `admin/src/app`, que se ejecutan con Vitest mediante el unit-test builder de Angular en jsdom. Cubren los modelos puros: la conversión del modelo del formulario, las reglas de los campos, los filtros y las vistas de las listas, los permisos, el transpilador ICU, el inicio de la semana y más.

```sh title="Terminal"
cd admin
npx ng test --watch=false
```

**Las pruebas de extremo a extremo** son specs de Playwright en `admin/e2e/`. `e2e/serve.sh` crea un proyecto desechable (con un plugin WebAssembly de ejemplo) y arranca `verdin dev` en el puerto 1393 sobre SQLite, sirviendo el panel desde `admin/dist/admin/browser`. Las pruebas se ejecutan de una en una en Chromium con la interfaz en inglés.

```sh title="Terminal"
cd admin
npx ng build
cargo build -p verdin
npx playwright install chromium
npx playwright test
```

Los specs cubren el inicio de sesión y los dos factores, el editor de entradas, las relaciones polimórficas, los flujos de revisión, las funcionalidades de equipo y de gobierno, las menciones, la importación y la exportación, las vistas de edición y los avisos de cambios sin guardar.

## CI

`.github/workflows/ci.yml` se ejecuta en cada push a `main` y en cada pull request. Todos los jobs de Rust compilan con `RUSTFLAGS=-D warnings`.

| Job | Comprueba |
|---|---|
| `lint` | `cargo fmt --all --check`, `cargo clippy --workspace --all-targets`, `cargo deny` (licencias y avisos de seguridad) |
| `test (sqlite)` | `cargo test --workspace` sobre SQLite en memoria |
| `test (…)` | `cargo test --workspace` sobre PostgreSQL 14 y 17, MySQL 8.4 y MariaDB 10.11 y 11.4, un job por motor, como servicios de Docker |
| `test (s3 storage, RustFS)` | `cargo test -p verdin-upload --test s3` contra un contenedor de RustFS |
| `admin` | Comprobación de Prettier, `npm run i18n:check`, `npm audit --audit-level=high`, pruebas unitarias, `ng build`, `cargo build -p verdin --features embed-admin`, Playwright |
| `client` | Que `packages/client` tenga la misma versión que el workspace, y después comprobación de tipos, pruebas y build |
| `site` | `npm audit`, y el build de la documentación, que falla ante cualquier enlace interno roto |

Las ejecuciones fallidas de Playwright suben sus trazas como artefacto, que se conserva durante siete días.
