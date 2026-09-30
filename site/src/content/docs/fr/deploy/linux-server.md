---
title: Serveur Linux
description: Exécutez Verdin sur un serveur Debian ou Ubuntu à partir du paquet .deb — un service systemd, un utilisateur système verdin, l’état dans /var/lib/verdin — derrière un reverse proxy.
sidebar:
  order: 3
---

Cette page exécute Verdin directement sur un serveur Debian ou Ubuntu, sans conteneurs, à partir
du paquet `.deb` joint à chaque release. La même organisation fonctionne sur d’autres
distributions avec le binaire du [script d’installation](/fr/start/installation/) et les fichiers
de [`deploy/deb/`](https://github.com/verdin-cms/verdin/tree/main/deploy/deb) copiés à la main.

Le paquet a été construit et inspecté avec `cargo deb` le 2026-09-30 ; il n’a pas été installé
sur un serveur en production pour ce guide.

## Ce que le paquet installe

| Chemin | Quoi |
| --- | --- |
| `/usr/bin/verdin` | Le binaire (statique, panneau d’administration intégré). |
| `/etc/verdin/verdin.toml` | La configuration (un conffile : les mises à niveau conservent vos modifications). |
| `/etc/verdin/verdin.env` | Créé à la première installation, mode `0640` : de nouveaux `VERDIN_ADMIN_JWT_SECRET` et `VERDIN_TOKEN_PEPPER`, et `VERDIN_DATABASE_URL` (SQLite par défaut). |
| `/var/lib/verdin/` | Répertoire personnel de l’utilisateur système `verdin` : la base de données SQLite, `schema/`, `uploads/`, l’index de recherche et le cache d’images. |
| `/usr/lib/systemd/system/verdin.service` | Le service, installé mais non activé. |

Le service exécute `verdin -c /etc/verdin/verdin.toml start --migrate` sous l’utilisateur
`verdin`, avec l’isolation de systemd (système en lecture seule, `/tmp` privé, pas de nouveaux
privilèges) et un accès en écriture à `/var/lib/verdin` uniquement. Il écoute sur
`127.0.0.1:1337`.

## 1. Installer

```sh frame="terminal"
curl -fsSLO https://github.com/verdin-cms/verdin/releases/download/v0.11.0/verdin_0.11.0-1_amd64.deb
sudo apt install ./verdin_0.11.0-1_amd64.deb
```

Utilisez `arm64` dans le nom du fichier sur les serveurs ARM.

## 2. Configurer

1. Copiez votre schéma commité dans `/var/lib/verdin/schema/` (`content-types/` et
   `components/`), avec `verdin` comme propriétaire :

   ```sh frame="terminal"
   sudo rsync -a --chown=verdin:verdin schema/ /var/lib/verdin/schema/
   ```

2. Pour PostgreSQL, MySQL ou MariaDB, modifiez `VERDIN_DATABASE_URL` dans
   `/etc/verdin/verdin.env`. Gardez les deux secrets : un nouveau `VERDIN_TOKEN_PEPPER`
   invalide tous les jetons d’API.
3. Dans `/etc/verdin/verdin.toml`, définissez `[server].public_url` à l’adresse utilisée par les
   navigateurs, et `trusted_proxies = ["127.0.0.1"]` quand le reverse proxy s’exécute sur la même
   machine. Toutes les autres clés sont dans la [référence de configuration](/fr/reference/configuration/).

## 3. Démarrer

```sh frame="terminal"
sudo systemctl enable --now verdin
journalctl -u verdin -f
```

Le premier démarrage crée les tables. Créez le premier administrateur en ligne de commande (le
fichier d’environnement du service contient l’URL de la base de données) :

```sh frame="terminal"
sudo -u verdin sh -c 'set -a; . /etc/verdin/verdin.env; verdin -c /etc/verdin/verdin.toml admin create --email you@example.com'
```

ou ouvrez le panneau d’administration via votre proxy et enregistrez-vous là.

## 4. Placer un reverse proxy devant

Verdin sert du HTTP simple sur l’interface de loopback. Avec Caddy, qui obtient et renouvelle le
certificat lui-même :

```text title="/etc/caddy/Caddyfile"
cms.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:1337
}
```

nginx fonctionne aussi ; désactivez la mise en mémoire tampon pour `/api/_events` afin que les
événements temps réel ne soient pas retenus (`proxy_buffering off;`).

## Mises à niveau et suppression

- **Mettre à niveau :** installez le `.deb` de la release suivante avec
  `apt install ./verdin_….deb`. Le service redémarre s’il tournait, et `start --migrate`
  applique les migrations sûres. Lisez d’abord [Mettre à niveau Verdin](/fr/migrate/upgrading/).
- **Supprimer :** `apt remove verdin` arrête le service et conserve les données et la
  configuration ; `apt purge verdin` supprime aussi `/etc/verdin/verdin.env` (les secrets).
  L’utilisateur `verdin` et `/var/lib/verdin` ne sont jamais supprimés par le paquet :
  supprimez-les vous-même une fois que vous avez une [sauvegarde](/fr/deploy/backups/).
