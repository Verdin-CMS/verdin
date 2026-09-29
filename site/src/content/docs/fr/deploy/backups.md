---
title: Sauvegardes
description: Sauvegardez un projet Verdin avec des dumps de base de données et des copies du stockage des médias, ou déplacez-le avec verdin export et verdin import verdin.
sidebar:
  order: 9
---

Les données d’un projet Verdin se trouvent à deux endroits : la **base de données** (contenu,
administrateurs, rôles, jetons, paramètres, historique, journaux d’audit) et le **stockage des
médias** (les fichiers de la médiathèque, sur disque ou dans un bucket). Les fichiers de schéma
sont dans votre dépôt. Sauvegardez les deux ; `verdin export` y ajoute une archive portable du
contenu.

| Méthode | Contient | À utiliser pour |
| --- | --- | --- |
| Dump de la base + copie des médias | Tout | La reprise après sinistre du même projet |
| `verdin export` | Schéma, langues, médias, toutes les versions de toutes les entrées | Déplacer le contenu vers une autre instance ou un autre moteur de base de données ; une copie supplémentaire et portable |

## Dumps de base de données

Utilisez les outils propres à votre base de données, ou les sauvegardes automatiques de votre
fournisseur :

```sh frame="terminal"
# PostgreSQL
pg_dump --format=custom --file=verdin-$(date +%F).dump "$VERDIN_DATABASE_URL"

# MySQL / MariaDB
mysqldump --single-transaction --routines -h <host> -u <user> -p <database> > verdin-$(date +%F).sql

# SQLite : une copie cohérente pendant que le serveur tourne
sqlite3 /data/verdin.db ".backup '/backups/verdin-$(date +%F).db'"
```

Ne copiez pas un fichier SQLite en cours d’utilisation avec `cp` : utilisez `.backup` (ou
arrêtez d’abord le serveur).

Un dump contient les hachages des mots de passe, les hachages des jetons d’API et les champs
privés. Chiffrez-le et conservez-le loin des serveurs qu’il protège. Pour en restaurer un, il
vous faut aussi les mêmes `VERDIN_TOKEN_PEPPER` et `VERDIN_ADMIN_JWT_SECRET` : sans le pepper,
les jetons d’API et les codes d’application d’authentification des administrateurs cessent de
fonctionner.

## Stockage des médias

- **Fournisseur local** : copiez le répertoire de téléversement (`[upload].provider.dir`,
  `/data/uploads` dans l’image Docker) avec votre sauvegarde de fichiers habituelle, après le
  dump de la base, pour qu’aucun fichier référencé par le dump ne manque.
- **Fournisseur S3** : activez le versioning ou la réplication sur le bucket, ou copiez-le avec
  les outils de votre fournisseur.

Le cache de transformation d’images et l’index de recherche peuvent être reconstruits et
n’ont pas besoin de sauvegarde.

## `verdin export`

`verdin export` écrit le schéma, le contenu et les médias d’un projet dans un seul `.tar.gz`,
et `verdin import verdin` le restaure dans le même projet ou dans une autre instance, sur
n’importe quel moteur de base de données.

```sh frame="terminal"
verdin export backup-2026-09-28.tar.gz            # schéma, langues, médias et entrées
verdin export content-only.tar.gz --no-media      # sans les fichiers de médias
verdin import verdin backup-2026-09-28.tar.gz     # dans ce projet
```

Exécutez-les avec la configuration du projet (le même `verdin.toml` et le même environnement
que le serveur). Dans un conteneur :
`docker compose exec verdin verdin export /data/backup.tar.gz`.

### Ce qui est inclus

- **Les fichiers de schéma**, tels quels.
- **Les langues.** Un projet vide les reprend toutes, y compris la langue par défaut. Un
  projet qui a déjà des langues ne reçoit que celles qui manquent.
- **Les dossiers et fichiers de médias**, avec leurs formats responsives. Les fichiers
  conservent leur `documentId` ; leurs identifiants numériques changent.
- **Toutes les versions de toutes les entrées** : brouillons, versions publiées et toutes les
  langues, avec leurs dates, leurs relations (par `documentId`) et leurs médias, y compris les
  relations et médias dans les composants et les zones dynamiques. Les champs privés et les
  hachages de mots de passe sont inclus.

**Non inclus** : les administrateurs, les rôles, les jetons d’API, les webhooks, les paramètres
des fonctionnalités, les workflows de relecture et les releases. Recréez-les sur la cible, ou
restaurez plutôt un dump de la base de données.

:::caution
Un export contient les champs privés et les hachages de mots de passe. Stockez-le comme un
dump de base de données.
:::

### Import

1. L’import écrit les fichiers de schéma et migre la base de données avec des étapes sans
   risque uniquement.
2. Des fichiers de schéma qui existent déjà et diffèrent l’arrêtent, sauf si vous passez
   `--force`.
3. Des types de contenu qui ont déjà des entrées l’arrêtent aussi, sauf si vous passez
   `--force` ; les entrées sont alors ajoutées à côté des entrées existantes.
4. Les documents importés conservent leur `documentId` : importer dans un projet qui contient
   déjà les mêmes documents échoue donc.

L’import ne déclenche ni webhooks ni hooks de plugins, et n’écrit pas d’historique.

### Format de l’archive

Une archive tar compressée avec gzip :

| Chemin | Contenu |
| --- | --- |
| `manifest.json` | `format: "verdin-export"`, version du format, version de Verdin, versions par type de contenu |
| `schema/…` | Les fichiers de schéma |
| `locales.json` | `{ default, locales: [{ code, name }] }` |
| `folders.json`, `files.jsonl` | Les dossiers et fichiers de médias, un objet JSON par ligne |
| `assets/{hash}{ext}` | Les objets stockés des fichiers et de leurs formats |
| `entries/{uid}.jsonl` | Une version par ligne : `documentId`, `locale`, `published`, dates, `data`, `relations`, `media` |

Pour importer plutôt un projet Strapi, voir [Migrer depuis Strapi](/fr/migrate/from-strapi/).

## Testez vos restaurations

Restaurez de temps en temps dans une base de données jetable, démarrez Verdin dessus avec
`verdin start`, et vérifiez que vous pouvez vous connecter et lire les entrées et les médias.
