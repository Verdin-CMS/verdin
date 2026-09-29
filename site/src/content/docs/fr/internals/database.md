---
title: Couche base de données
description: Comment Verdin communique avec PostgreSQL, MySQL, MariaDB et SQLite via un seul type de connexion, une énumération Flavor et ses propres constructeurs SQL, et comment il gère les différences de chaque dialecte.
sidebar:
  order: 3
---

Cette page explique comment Verdin prend en charge quatre moteurs de base de données avec un seul chemin de code : la crate `verdin-db` qui se connecte et exécute, les constructeurs SQL qui s’adaptent au moteur, et les différences de dialecte qu’ils gèrent. Lisez-la avant d’écrire du SQL où que ce soit dans le serveur. La disposition des tables est décrite dans [Stockage](/fr/internals/storage/).

## Versions minimales

`Database::connect` détecte le moteur et sa version, et refuse de démarrer en dessous de ces minimums (`Flavor::minimum_version` dans `crates/verdin-db/src/lib.rs`) :

| Moteur | Minimum | Raison |
|---|---|---|
| PostgreSQL | 14 | Plus ancienne version encore maintenue en amont |
| MySQL | 8.4 LTS | La 8.0 est arrivée en fin de vie en avril 2026 |
| MariaDB | 10.11 LTS | Plus ancienne version long terme actuelle ; collation `utf8mb4_uca1400_ai_ci`, JSON utilisable |
| SQLite | 3.35 | `ALTER TABLE … DROP COLUMN` ; la bibliothèque est compilée dans le binaire |

La CI exécute chaque test sur PostgreSQL 14 et 17, MySQL 8.4, MariaDB 10.11 et 11.4, et SQLite. Voir [Tests](/fr/internals/testing/).

## Connexion

`verdin-db` enveloppe un pool `sqlx` par backend :

```rust
pub enum Pool { Postgres(PgPool), MySql(MySqlPool), Sqlite(SqlitePool) }

pub enum Flavor { Postgres, MySql, MariaDb, Sqlite }

pub struct Database { pool: Pool, flavor: Flavor, version: Version }
```

- Schémas d’URL : `postgres://` ou `postgresql://`, `mysql://`, `mariadb://` (un alias de `mysql://`) et `sqlite:`. MySQL et MariaDB partagent le pilote MySQL de `sqlx` ; la variante provient de `SELECT VERSION()`, qui contient `MariaDB` sur MariaDB.
- Les connexions MySQL et MariaDB utilisent `utf8mb4` et règlent le fuseau horaire de la session sur `+00:00` : chaque horodatage est donc stocké en UTC.
- Les connexions SQLite activent les clés étrangères, utilisent la journalisation WAL et un busy timeout de 5 secondes, et créent le fichier de base de données (et son dossier) s’il manque. Les bases en mémoire n’ont qu’une seule connexion, car chaque connexion à `:memory:` ouvrirait une base différente.
- `ConnectOptions` définit la taille du pool (`[database].pool_max`, 10 par défaut) et le délai d’attente d’une connexion libre (10 secondes).

`Flavor` porte les quelques informations sur lesquelles le reste du code se base : `transactional_ddl()` (PostgreSQL et SQLite), `is_mysql_family()`, `quote(identifier)` (backticks sur MySQL et MariaDB, guillemets doubles ailleurs) et `minimum_version()`.

Il n’y a pas de trait de dialecte. Le code qui construit du SQL vérifie le `Flavor` là où les moteurs diffèrent.

## Exécution des instructions

Trois exécuteurs partagent les mêmes méthodes (`execute`, `fetch_all`, `has_rows`, `insert_returning_id`) :

| Exécuteur | Usage |
|---|---|
| `db.queries()` | Une instruction sur n’importe quelle connexion du pool |
| `db.acquire()` → `Conn` | Plusieurs instructions sur une même connexion, comme une exécution de migration qui détient un verrou |
| `db.begin()` → `Tx` | Une transaction ; abandonnée sans `commit()`, elle est annulée |

Les instructions sont écrites avec des marqueurs `?`, réécrits en `$1, $2…` pour PostgreSQL. Les valeurs sont des `SqlValue`, toujours liées comme paramètres. Le texte SQL lui-même ne peut contenir que des identifiants issus du schéma validé, c’est pourquoi il est passé à `sqlx` sous forme d’`AssertSqlSafe`.

**Décodage piloté par le schéma.** Une lecture passe le `ColumnKind` de chaque colonne sélectionnée, et les valeurs sont décodées selon ce genre, et non selon le type que rapporte le pilote. C’est ce qui fait que le `JSON` de MariaDB (en réalité du `LONGTEXT`), les booléens `TINYINT(1)` de MySQL et les dates et décimaux textuels de SQLite reviennent de la même façon sur tous les moteurs. Voir `crates/verdin-db/src/value.rs`.

**Identifiants insérés.** `insert_returning_id` ajoute `RETURNING id` sur PostgreSQL, et lit l’identifiant que rapporte le pilote après l’insertion sur MySQL, MariaDB (`LAST_INSERT_ID`) et SQLite (`last_insert_rowid`).

**Violations d’unicité.** `DbError::unique_violation()` extrait le nom de l’index (PostgreSQL, MySQL, MariaDB) ou la liste des colonnes (SQLite) de l’erreur du pilote, pour que le Document Service puisse signaler une `ValidationError` sur le bon attribut.

## Constructeurs SQL

Verdin construit le SQL avec ses propres petits constructeurs plutôt qu’avec un ORM ou `sea-query`, parce que les tables n’existent qu’à l’exécution (elles proviennent du schéma) et parce que les détails propres à chaque dialecte dominent : NULL typés, collations, fonctions JSON et formats textuels de SQLite.

| Crate | Construit |
|---|---|
| `verdin-migrate` (`sql.rs`, `Dialect`) | Le DDL : types de colonnes, `CREATE TABLE`, `ALTER TABLE`, index, reconstructions de tables SQLite |
| `verdin-query` (`sql.rs`, `SqlBuilder`) | Les clauses `WHERE` des filtres (y compris les sous-requêtes `EXISTS` des relations et les chemins JSON) et `ORDER BY` |
| `verdin-content` (`service.rs`) | Les lectures, insertions, mises à jour, suppressions, écritures dans les tables de liaison et requêtes de populate groupées |

Un constructeur ajoute du texte SQL et des noms `ident()` (entre guillemets selon la variante) et collecte les paramètres avec `param()` : la construction du SQL et la liaison des valeurs se font donc au même endroit.

### Types de colonnes par dialecte

| Type du modèle | PostgreSQL | MySQL / MariaDB | SQLite |
|---|---|---|---|
| id | `bigint` identity | `bigint AUTO_INCREMENT` | `integer PRIMARY KEY AUTOINCREMENT` |
| integer, bigint, smallint | `integer`, `bigint`, `smallint` | `int`, `bigint`, `smallint` | `integer` |
| double | `double precision` | `double` | `real` |
| decimal | `numeric(p,s)` | `decimal(p,s)` | `text` |
| boolean | `boolean` | `tinyint(1)` | `integer` |
| char, varchar | `char(n)`, `varchar(n)` | `char(n)`, `varchar(n)` | `text` |
| text | `text` | `longtext` | `text` |
| date, time, datetime | `date`, `time(3)`, `timestamptz(3)` | `date`, `time(3)`, `datetime(3)` | `text` |
| json | `jsonb` | `json` | `text` |

SQLite stocke les décimaux, les dates et les heures sous forme de texte à format fixe, pour que rien ne soit arrondi et que l’ordre textuel corresponde à l’ordre numérique et chronologique. La correspondance entre attributs et types du modèle figure dans [Types d’attributs](/fr/reference/attribute-types/).

Les tables MySQL et MariaDB sont créées avec `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` et une collation insensible aux accents et à la casse : `utf8mb4_0900_ai_ci` sur MySQL, `utf8mb4_uca1400_ai_ci` sur MariaDB.

## Différences de dialecte

| Sujet | PostgreSQL | MySQL 8.4 | MariaDB | SQLite | Comment Verdin le gère |
|---|---|---|---|---|---|
| Identifiant inséré | `RETURNING` | pas de `RETURNING` | identifiant du pilote | identifiant du pilote | `insert_returning_id()` |
| DDL transactionnel | oui | non (commit implicite) | non | oui | Journal des étapes sur MySQL et MariaDB (voir [Migrations](/fr/internals/migrations/)) |
| JSON | `jsonb` | `json` | alias de `LONGTEXT` | texte | Décodage piloté par le schéma |
| Booléens | `boolean` | `tinyint(1)` | `tinyint(1)` | entier | Décodage piloté par le schéma |
| Date-heure | `timestamptz` | `datetime(3)` | `datetime(3)` | texte ISO | Toujours en UTC ; les sessions de la famille MySQL utilisent le fuseau `+00:00` |
| Jeu de caractères et collation | UTF-8 | `utf8mb4`, `utf8mb4_0900_ai_ci` | `utf8mb4`, `utf8mb4_uca1400_ai_ci` | UTF-8, binaire | Défini explicitement par table |
| Correspondance exacte de texte (`$eq`, `$in`…) | `=` | `COLLATE utf8mb4_bin` | idem | `=` | Mêmes résultats sur tous les moteurs |
| `$contains`, `$startsWith`, `$endsWith` | `LIKE` | `LIKE … COLLATE utf8mb4_bin` | idem | `instr()` / `substr()` | Le `LIKE` de SQLite ignore la casse ASCII : il n’est donc pas utilisé pour les correspondances sensibles à la casse |
| `$containsi` et les autres opérateurs `…i` | `ILIKE` | `LIKE` (collation insensible) | idem | `LIKE` | SQLite ne normalise que la casse ASCII |
| Filtres sur chemins JSON | `#>>` | `JSON_VALUE` | idem | `json_extract` | Opérande propre à chaque dialecte |
| Filtres sur tableaux JSON | `jsonb_array_elements` | `JSON_TABLE` | idem | `json_each` | `EXISTS` sur les éléments |
| `ALTER COLUMN` | complet | `MODIFY COLUMN` | idem | non pris en charge | SQLite : reconstruction de la table (création, copie, suppression, renommage) |
| Verrous de ligne | `FOR UPDATE` | `FOR UPDATE` | `FOR UPDATE` | aucun | Omis sur SQLite, dont les transactions d’écriture verrouillent la base |
| Longueur d’un index unique sur du texte | — | 3 072 octets | idem | — | Un `varchar(255)` en `utf8mb4` fait 1 020 octets ; `text` ne peut pas être unique |
| Taille de ligne | — | 65 535 octets | idem | — | Au plus 60 attributs `string`, `email`, `uid` ou `enumeration` par type |

Les motifs `LIKE` échappent `%`, `_` et le caractère d’échappement lui-même (`!`) dans les saisies des utilisateurs. Les collations par défaut de MySQL et MariaDB ignorent la casse et les accents, c’est pourquoi les opérateurs exacts ajoutent une collation binaire : `$eq` signifie la même chose sur MySQL que sur PostgreSQL. Avec les chemins JSON, `JSON_VALUE` renvoie une chaîne à collation binaire : les opérateurs insensibles à la casse y comparent donc `LOWER()` des deux côtés.

`ORDER BY` place les NULL en dernier dans les deux sens et se termine toujours par `id`, si bien que la pagination est stable sur tous les moteurs.
