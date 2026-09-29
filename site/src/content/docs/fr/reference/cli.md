---
title: Référence de la ligne de commande
description: Chaque commande, sous-commande et option du binaire verdin, avec ce qu’elle lit, écrit et affiche.
sidebar:
  order: 2
  label: Ligne de commande
---

<!-- Written from crates/verdin/src/cli.rs and crates/verdin/src/new.rs. `npm run check-cli`
(site/scripts/check-cli.mjs) fails when a subcommand or flag in cli.rs is missing here. -->

`verdin` est l’unique binaire : il crée des projets, exécute le serveur, applique les migrations,
gère les administrateurs et fait entrer et sortir le contenu. Cette page liste chaque commande et
chaque option.

```text title="Terminal"
verdin [OPTIONS] <COMMAND>
```

| Commande | Ce qu’elle fait |
| --- | --- |
| [`verdin new`](#verdin-new) | Crée un répertoire de projet. |
| [`verdin dev`](#verdin-dev) | Exécute le serveur en mode développement. |
| [`verdin start`](#verdin-start) | Exécute le serveur en mode production. |
| [`verdin schema check`](#verdin-schema-check) | Valide les fichiers de schéma. |
| [`verdin migrate plan`](#verdin-migrate-plan) | Affiche les étapes de migration et leur SQL. |
| [`verdin migrate apply`](#verdin-migrate-apply) | Applique les étapes de migration. |
| [`verdin admin create`](#verdin-admin-create) | Crée un Super Admin. |
| [`verdin admin reset-password`](#verdin-admin-reset-password) | Définit le mot de passe d’un administrateur. |
| [`verdin types`](#verdin-types) | Génère les définitions TypeScript de l’API de contenu. |
| [`verdin import strapi`](#verdin-import-strapi) | Importe un export Strapi. |
| [`verdin import verdin`](#verdin-import-verdin) | Importe un export Verdin. |
| [`verdin export`](#verdin-export) | Écrit le projet dans une archive `.tar.gz`. |
| [`verdin healthcheck`](#verdin-healthcheck) | Vérifie que le serveur local répond. |
| [`verdin secrets`](#verdin-secrets) | Affiche de nouveaux secrets. |
| [`verdin version`](#verdin-version) | Affiche la version. |

## Options globales

| Option | Valeur par défaut | Description |
| --- | --- | --- |
| `-c, --config <CONFIG>` | `verdin.toml` | Le fichier de configuration du projet. Aussi lu depuis `VERDIN_CONFIG`. La racine du projet est le répertoire du fichier : le schéma, les plugins, les téléversements et les chemins SQLite relatifs sont résolus par rapport à elle. |
| `-h, --help` | | Affiche l’aide de la commande. |
| `-V, --version` | | Affiche la version. |

`verdin help <COMMAND>` affiche la même aide que `--help`.

Chaque commande, sauf `new`, `secrets` et `version`, charge d’abord le projet :

1. Elle lit le fichier `.env` situé à côté du fichier de configuration, s’il existe. Les
   variables déjà définies dans l’environnement l’emportent.
2. Elle charge `verdin.toml` (facultatif) et les surcharges `VERDIN_*`. Voir la
   [référence de configuration](/fr/reference/configuration/).
3. Elle commence à journaliser sur la sortie d’erreur standard, selon `[log]` et `RUST_LOG`.

Les commandes qui ouvrent la base de données ont besoin de `VERDIN_DATABASE_URL` ou de
`[database].url`. Les commandes qui touchent aux comptes d’administration ou exécutent le serveur
ont aussi besoin de `VERDIN_ADMIN_JWT_SECRET` et `VERDIN_TOKEN_PEPPER`.

## `verdin new`

```text title="Terminal"
verdin new <DIR> [--database <DATABASE>]
```

Crée un projet dans `DIR`, qui ne doit pas exister ou doit être vide :

| Fichier | Contenu |
| --- | --- |
| `verdin.toml` | `[server]`, `[api]` et `[admin]` avec leurs valeurs par défaut. |
| `.env` | `VERDIN_DATABASE_URL`, et de nouveaux `VERDIN_ADMIN_JWT_SECRET` et `VERDIN_TOKEN_PEPPER`. Lisible par vous seul (mode `0600` sous Unix). |
| `.gitignore` | `.env`, `data/`, les fichiers SQLite et `.cache/`. |
| `schema/content-types/`, `schema/components/` | Répertoires de schéma vides. |
| `data/` | Pour la base de données SQLite (SQLite uniquement). |

| Argument ou option | Valeur par défaut | Description |
| --- | --- | --- |
| `<DIR>` | | Répertoire à créer. |
| `--database <DATABASE>` | `sqlite` | Base de données visée par le `.env` : `sqlite`, `postgres`, `mysql` ou `mariadb`. |

Avec `sqlite`, l’URL est `sqlite://data/verdin.db`. Avec les autres, c’est l’URL d’un serveur
local avec l’utilisateur `verdin`, le mot de passe `change-me` et une base nommée d’après le
répertoire (lettres minuscules, chiffres et `_`) : modifiez-la avant de démarrer.

```text title="Terminal"
$ verdin new blog --database postgres
created blog

  cd blog
  verdin dev

then open http://localhost:1337/admin/ to register the first admin
```

## `verdin dev`

```text title="Terminal"
verdin dev
```

Exécute le serveur en mode développement. Par rapport à `verdin start` :

- Les migrations en attente de niveau de risque `safe` s’appliquent au démarrage. Les étapes plus
  risquées arrêtent le serveur ; examinez-les avec [`verdin migrate plan`](#verdin-migrate-plan).
- Le **Constructeur de types de contenu** du panneau d’administration modifie les fichiers de
  schéma et le serveur recharge le schéma.
- Le cookie de rafraîchissement n’est pas marqué `Secure` (sauf si `[admin].secure_cookies` le
  demande) : vous pouvez donc vous connecter en HTTP simple.
- Les webhooks et les cibles de déploiement peuvent appeler des adresses de bouclage et privées
  (sauf si `[webhooks].allow_private_networks` en décide autrement).

Il s’arrête sur Ctrl+C ou `SIGTERM`.

## `verdin start`

```text title="Terminal"
verdin start [--migrate]
```

Exécute le serveur en mode production. Il refuse de démarrer quand la base de données est en
retard sur le schéma : un déploiement ne modifie donc jamais des tables que vous n’avez pas
examinées.

| Option | Description |
| --- | --- |
| `--migrate` | Applique les étapes de migration `safe` en attente avant de démarrer. Les étapes risquées et destructives nécessitent toujours `verdin migrate apply`. |

Avant d’écouter, il vérifie la configuration (`[api].prefix` et `[admin].path` ressemblent à
`/api`, les tailles de page sont cohérentes, `[server].trusted_proxies` et `[api].cors_origins`
sont analysables) et crée les rôles intégrés. Il journalise un avertissement quand
`[admin].secure_cookies` vaut `false` ou que `[email].provider` vaut `log`. Quand il n’y a encore
aucun administrateur, il journalise l’adresse du panneau d’administration, où le premier visiteur
crée le premier Super Admin.

Il s’arrête sur Ctrl+C ou `SIGTERM`.

## `verdin schema check`

```text title="Terminal"
verdin schema check
```

Valide les fichiers de schéma (`[schema].path`) sans toucher à la base de données. Il affiche un
récapitulatif, ou échoue avec les erreurs, chacune avec son fichier et le chemin de l’attribut :

```text title="Terminal"
$ verdin schema check
schema ok: 4 content types, 3 components
```

Utilisez-le en CI avant un déploiement. Voir [Types d’attributs](/fr/reference/attribute-types/)
pour ce qu’accepte chaque attribut.

## `verdin migrate plan`

```text title="Terminal"
verdin migrate plan [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Compare la base de données au schéma et affiche ce que ferait `verdin migrate apply`, sans rien
modifier : des étapes numérotées, chacune avec son niveau de risque et son SQL. Il affiche
`database is up to date` quand il n’y a rien à faire.

| Option | Description |
| --- | --- |
| `--rename-table <OLD=NEW>` | Traite la table `OLD` comme renommée en `NEW` (en conservant ses lignes) au lieu d’en supprimer une et d’en créer une autre. Répétable. |
| `--rename-column <TABLE.OLD=NEW>` | Traite la colonne `OLD` de `TABLE` comme renommée en `NEW` (en conservant ses valeurs). `TABLE` est le nouveau nom de la table. Répétable. |

Niveaux de risque :

| Niveau | Signification |
| --- | --- |
| `safe` | Ne peut ni perdre de données ni échouer sur les lignes existantes : nouvelles tables, nouvelles colonnes nullables ou dotées d’une valeur par défaut, renommages, index non uniques. |
| `risky` | Peut échouer sur les lignes existantes ou convertir des valeurs : changements de type de colonne, nouvelles colonnes non nullables sans valeur par défaut, index uniques sur des tables existantes. |
| `destructive` | Supprime des colonnes ou des tables. |

Quand une étape dépasse `safe`, le plan se termine par l’option dont il a besoin
(`requires: verdin migrate apply --allow risky`). Quand une colonne ou une table supprimée
ressemble à une colonne ou une table renommée, il liste les options de renommage à passer. Quand
une migration précédente a été interrompue, il indique combien d’étapes ont été appliquées et la
dernière erreur.

```text title="Terminal"
verdin migrate plan --rename-column articles.summary=excerpt
```

Voir [Migrations de schéma](/fr/concepts/schema-migrations/).

## `verdin migrate apply`

```text title="Terminal"
verdin migrate apply [--allow <ALLOW>] [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Applique le plan. Il accepte les mêmes options de renommage que `verdin migrate plan` ; passez
celles que vous avez examinées.

| Option | Valeur par défaut | Description |
| --- | --- | --- |
| `--allow <ALLOW>` | `safe` | Niveau de risque maximal à appliquer : `safe`, `risky` ou `destructive`. Un plan dont une étape le dépasse est refusé avant toute exécution. |
| `--rename-table <OLD=NEW>` | | Comme dans `verdin migrate plan`. |
| `--rename-column <TABLE.OLD=NEW>` | | Comme dans `verdin migrate plan`. |

Il affiche `applied N steps`, ou `database is up to date`. Après une interruption (connexion
perdue, étape en échec), corrigez la cause et relancez-le : il reprend à l’étape qui ne s’est pas
terminée.

## `verdin admin create`

```text title="Terminal"
verdin admin create --email <EMAIL>
```

Crée un Super Admin. Le mot de passe est lu dans `VERDIN_ADMIN_PASSWORD`, ou sur l’entrée
standard quand cette variable n’est pas définie. La base de données doit être à jour par rapport
au schéma.

| Option | Description |
| --- | --- |
| `--email <EMAIL>` | L’adresse e-mail du nouvel administrateur. |

```text title="Terminal"
$ VERDIN_ADMIN_PASSWORD='a long passphrase' verdin admin create --email ada@example.com
created Super Admin ada@example.com (id 1)
```

Utilisez-le pour créer le premier administrateur d’un serveur qui n’est pas encore accessible
dans un navigateur ; sinon, c’est le premier visiteur du panneau d’administration qui le crée.

## `verdin admin reset-password`

```text title="Terminal"
verdin admin reset-password --email <EMAIL>
```

Définit le mot de passe d’un administrateur, déverrouille le compte après des connexions échouées
et met fin à toutes ses sessions. Le mot de passe est lu comme pour `verdin admin create`.

| Option | Description |
| --- | --- |
| `--email <EMAIL>` | L’adresse e-mail de l’administrateur. |

Il ne supprime pas les seconds facteurs ; un administrateur disposant de
**Gérer les utilisateurs** peut les réinitialiser dans **Paramètres → Utilisateurs**.

## `verdin types`

```text title="Terminal"
verdin types [-o <OUT>]
```

Génère à partir du schéma les définitions TypeScript de l’API de contenu (une interface par type
de contenu et par composant), et les affiche sur la sortie standard. Il n’a pas besoin de la base
de données.

| Option | Description |
| --- | --- |
| `-o, --out <OUT>` | Écrit plutôt dans ce fichier. |

```text title="Terminal"
verdin types --out ../web/src/verdin.d.ts
```

Voir [Client typé](/fr/guides/frontend/typed-client/).

## `verdin import strapi`

```text title="Terminal"
verdin import strapi <PATH> [--schema-only] [--force]
```

Importe un projet Strapi v4 ou v5 à partir d’un export réalisé avec
`strapi export --no-encrypt` : un `.tar.gz`, un `.tar` ou un répertoire décompressé. Il écrit les
types de contenu et les composants sous forme de fichiers de schéma, puis importe les entrées,
les langues, les médias, les relations et les dossiers.

| Argument ou option | Description |
| --- | --- |
| `<PATH>` | Le fichier ou le répertoire d’export. |
| `--schema-only` | N’écrit que les fichiers de schéma. |
| `--force` | Écrase les fichiers de schéma existants, et importe dans des types de contenu qui ont déjà des entrées. |

Il affiche ce qu’il a écrit et importé, avec des avertissements pour ce qu’il n’a pas pu
reprendre, et écrit `strapi-id-map.json` à la racine du projet : les identifiants Strapi et leurs
nouveaux `documentId` et identifiants de fichiers Verdin, pour corriger les liens dans votre
frontend.

Voir [Migrer depuis Strapi](/fr/migrate/from-strapi/).

## `verdin import verdin`

```text title="Terminal"
verdin import verdin <PATH> [--force]
```

Importe une archive écrite par `verdin export` : fichiers de schéma, langues, médias et entrées.

| Argument ou option | Description |
| --- | --- |
| `<PATH>` | Le fichier `.tar.gz`. |
| `--force` | Écrase les fichiers de schéma qui diffèrent, et importe dans des types de contenu qui ont déjà des entrées. |

## `verdin export`

```text title="Terminal"
verdin export <OUTPUT> [--no-media]
```

Écrit le schéma, le contenu et les médias du projet dans une archive `.tar.gz` : une sauvegarde,
ou un moyen de déplacer un projet vers une autre instance avec `verdin import verdin`. L’archive
contient toutes les versions de toutes les entrées (brouillons, versions publiées, langues) avec
leurs relations. Les comptes d’administration, les jetons d’API et les paramètres ne sont pas
inclus.

| Argument ou option | Description |
| --- | --- |
| `<OUTPUT>` | L’archive à écrire. |
| `--no-media` | Exclut la médiathèque : les fichiers, les dossiers et les liens des entrées vers ceux-ci. |

```text title="Terminal"
$ verdin export backup.tar.gz
exported to backup.tar.gz: 42 documents (57 versions), 18 files, 3 folders, 2 locales
```

Voir [Sauvegardes](/fr/deploy/backups/).

## `verdin healthcheck`

```text title="Terminal"
verdin healthcheck [--port <PORT>]
```

Interroge `GET /_health` sur le serveur de cette machine (`127.0.0.1`, le `[server].port` de la
configuration) et se termine avec le statut 0 quand il répond `200`, 1 sinon, en affichant la
raison. Il n’a besoin ni de shell, ni de `curl`, ni de client HTTP : l’image Docker l’utilise donc
comme `HEALTHCHECK` ; utilisez-le de la même façon dans Compose ou dans tout superviseur qui
exécute une commande.

| Option | Description |
| --- | --- |
| `--port <PORT>` | Vérifie ce port au lieu de `[server].port`. |

```text title="Terminal"
$ verdin healthcheck
ok
```

Voir [Supervision](/fr/deploy/monitoring/).

## `verdin secrets`

```text title="Terminal"
verdin secrets
```

Affiche de nouveaux `VERDIN_ADMIN_JWT_SECRET` et `VERDIN_TOKEN_PEPPER`, prêts pour un fichier
`.env` ou pour le gestionnaire de secrets de votre plateforme. Il ne lit aucun projet.

Changer `VERDIN_ADMIN_JWT_SECRET` invalide les jetons d’accès de courte durée des administrateurs
et des utilisateurs finaux, les liens d’aperçu ouverts et les connexions OAuth en cours ; le
panneau d’administration et les clients qui utilisent des jetons de rafraîchissement en obtiennent
de nouveaux d’eux-mêmes. Changer `VERDIN_TOKEN_PEPPER` invalide les jetons stockés (dont les
jetons d’API) : conservez-le donc une fois en service.

## `verdin version`

```text title="Terminal"
verdin version
```

Affiche `verdin` et la version, comme `verdin --version`.
