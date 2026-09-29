---
title: Tests
description: Comment Verdin est testé, des tests unitaires Rust à la suite de conformité qui tourne sur six bases de données, en passant par les tests unitaires et Playwright du panneau d’administration et les jobs de CI qui valident chaque modification.
sidebar:
  order: 7
---

Cette page présente les suites de tests, comment exécuter chacune en local, et ce que la CI vérifie sur chaque pull request. La règle derrière tout cela : une fonctionnalité n’est pas terminée tant qu’elle ne passe pas sur toutes les bases de données prises en charge.

## Tests Rust

Exécutez tout avec :

```sh title="Terminal"
cargo test --workspace
```

Sans configuration, les tests utilisent SQLite. Il en existe trois genres :

| Genre | Emplacement | Contenu |
|---|---|---|
| Tests unitaires | Modules `#[cfg(test)]` dans chaque crate | Analyse et validation du schéma, nommage, diff et plan, analyse des requêtes, génération SQL par dialecte, encodage des valeurs, validation des entrées |
| Tests d’intégration des crates | `crates/*/tests/` | Connexion et détection de la variante (`verdin-db`), application des migrations (`verdin-migrate`), flux d’authentification (`verdin-auth`), GraphQL, plugins, stockage S3 |
| Tests de l’API | `crates/verdin-api/tests/api/` | Requêtes HTTP sur l’API de contenu et l’API d’administration, y compris la suite de conformité |

**Snapshots de DDL.** `crates/verdin-migrate/tests/sql_snapshots.rs` génère le DDL d’un schéma d’exemple pour chaque dialecte et le compare aux snapshots [`insta`](https://insta.rs) de `crates/verdin-migrate/tests/snapshots/`. Quand vous modifiez volontairement le DDL, examinez et acceptez les nouveaux snapshots avec `cargo insta review` (de `cargo-insta`) et commitez-les.

Les **tests de l’API** résident dans un seul binaire de test (`tests/api/main.rs`, un module par domaine) pour limiter les temps d’édition des liens et la taille de `target/`. Le harnais de `tests/api/common/mod.rs` construit l’API de contenu sur `/api` et l’API d’administration sur `/admin/api` au-dessus d’une base de données neuve et migrée pour chaque test. Les requêtes portent un jeton d’API à accès complet, sauf si le test en passe un autre, ou aucun.

## La matrice des six bases de données

Chaque test qui touche une base de données lit `VERDIN_TEST_DATABASE_URL` et utilise par défaut SQLite en mémoire. `verdin-testkit` donne à chaque test sa propre base : un fichier SQLite temporaire, ou une base `vd_test_…` neuve créée sur le serveur et supprimée ensuite.

La CI exécute tout le workspace une fois par moteur :

| Moteur | Image |
|---|---|
| SQLite | intégré |
| PostgreSQL 14 | `postgres:14-alpine` |
| PostgreSQL 17 | `postgres:17-alpine` |
| MySQL 8.4 | `mysql:8.4` |
| MariaDB 10.11 | `mariadb:10.11` |
| MariaDB 11.4 | `mariadb:11.4` |

Ce sont les [versions minimales](/fr/internals/database/#versions-minimales) plus les plus récentes sur lesquelles Verdin est testé. La CI définit aussi `VERDIN_TEST_EXPECT_FLAVOR` pour que `crates/verdin-db/tests/connect.rs` vérifie que le moteur a été correctement détecté (MariaDB est atteint avec une URL `mysql://` et doit malgré tout être détecté comme MariaDB).

Pour exécuter la matrice en local, démarrez les bases de données avec Docker :

```sh title="Terminal"
docker compose -f docker/compose.dev.yml up -d
```

Exécutez ensuite les tests sur chaque moteur. Les tests créent une base par test : sur MySQL et MariaDB, ils se connectent donc en tant que `root` :

```sh title="Terminal"
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5414/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5417/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3384/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3311/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3314/verdin cargo test --workspace
```

Les ports correspondent à PostgreSQL 14 et 17, MySQL 8.4, et MariaDB 10.11 et 11.4. Le même fichier compose démarre RustFS (stockage compatible S3 sur le port 9000) et Mailpit (SMTP sur le port 1025, boîte de réception sur le port 8025) pour le travail sur les médias et les e-mails.

## Suite de conformité

`crates/verdin-api/tests/api/conformance.rs` envoie les mêmes requêtes HTTP à l’API de contenu sur chaque moteur et vérifie les réponses : allers-retours de création, lecture, mise à jour et suppression, validation des entrées, brouillon et publication, filtres et leurs règles de correspondance de texte, tri et pagination, types de champs et populate, valeurs uniques, types uniques, règles d’accès de l’API de contenu, document OpenAPI, et filtres sur les champs de composants. Les autres modules de `tests/api/` (`filters.rs`, `populate.rs`, `relations.rs`, `components.rs`, `morph.rs`, `i18n.rs`…) couvrent leurs domaines de la même façon : tout le binaire de test de `verdin-api` constitue donc en pratique la suite de conformité.

Quand vous corrigez une différence de dialecte, ajoutez le cas ici : le test qui passe sur PostgreSQL et échoue sur MySQL est exactement celui que la suite doit attraper.

## Tests du panneau d’administration

Les **tests unitaires** sont des fichiers `*.spec.ts` placés à côté du code dans `admin/src/app`, exécutés avec Vitest via le builder de tests unitaires d’Angular dans jsdom. Ils couvrent les modèles purs : conversion du modèle de formulaire, règles des champs, filtres et vues des listes, autorisations, transpileur ICU, premier jour de la semaine, et plus encore.

```sh title="Terminal"
cd admin
npx ng test --watch=false
```

Les **tests de bout en bout** sont des specs Playwright dans `admin/e2e/`. `e2e/serve.sh` crée un projet jetable (avec un plugin WebAssembly d’exemple) et démarre `verdin dev` sur le port 1393 avec SQLite, en servant l’administration depuis `admin/dist/admin/browser`. Les tests s’exécutent un par un dans Chromium avec une interface en anglais.

```sh title="Terminal"
cd admin
npx ng build
cargo build -p verdin
npx playwright install chromium
npx playwright test
```

Les specs couvrent la connexion et la double authentification, l’éditeur d’entrée, les relations polymorphes, les workflows de relecture, les fonctionnalités d’équipe et de gouvernance, les mentions, l’import et l’export, les vues d’édition et les garde-fous sur les modifications non enregistrées.

## CI

`.github/workflows/ci.yml` s’exécute à chaque push sur `main` et sur chaque pull request. Tous les jobs Rust compilent avec `RUSTFLAGS=-D warnings`.

| Job | Vérifications |
|---|---|
| `lint` | `cargo fmt --all --check`, `cargo clippy --workspace --all-targets`, `cargo deny` (licences et alertes de sécurité) |
| `test (sqlite)` | `cargo test --workspace` sur SQLite en mémoire |
| `test (…)` | `cargo test --workspace` sur PostgreSQL 14 et 17, MySQL 8.4, MariaDB 10.11 et 11.4, un job chacun, sous forme de services Docker |
| `test (s3 storage, RustFS)` | `cargo test -p verdin-upload --test s3` sur un conteneur RustFS |
| `admin` | Vérification Prettier, `npm run i18n:check`, `npm audit --audit-level=high`, tests unitaires, `ng build`, `cargo build -p verdin --features embed-admin`, Playwright |
| `client` | `packages/client` a la même version que le workspace, puis vérification des types, tests et build |
| `site` | `npm audit`, et la build de la documentation, qui échoue sur tout lien interne cassé |

Les exécutions Playwright en échec téléversent leurs traces comme artefact, conservé sept jours.
