---
title: Fly.io
description: Déployez Verdin sur Fly.io avec votre propre image, PostgreSQL et le stockage objet Tigris, ou une seule Machine avec SQLite sur un volume.
sidebar:
  order: 4
---

Cette page déploie un projet Verdin sur [Fly.io](https://fly.io) sous la forme d’une petite
image construite sur l’image officielle. La configuration recommandée ne garde aucun état sur
la Machine : PostgreSQL pour la base de données et Tigris (le stockage compatible S3 de Fly)
pour les médias. Une variante avec SQLite sur un volume suit.

:::note
Les formats de Fly ont été vérifiés par rapport à la
[documentation de Fly](https://docs.fly.io/reference/configuration/) le 2026-09-29 ; la
configuration n’a pas été exécutée sur un compte Fly réel. Les valeurs entre chevrons et celles
marquées `# yours` sont à remplir par vos soins.
:::

Prérequis : [`flyctl`](https://docs.fly.io/flyctl/install/) connecté, et un projet Verdin dont
le répertoire `schema/` est commité.

## 1. Ajouter un Dockerfile et une configuration

Dans le répertoire du projet, ajoutez un `Dockerfile` qui copie votre configuration et votre
schéma dans l’image officielle (voir [Votre propre image](/fr/deploy/docker/)) :

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

et un `verdin.toml` pour Fly :

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337
public_url = "https://my-verdin.fly.dev"       # yours: the app's URL or your domain

[schema]
path = "schema"

[log]
format = "json"

[upload]
provider = { name = "s3", bucket = "my-verdin-media",   # yours: the bucket name
             region = "auto", endpoint = "https://t3.storage.dev",
             public_url = "https://my-verdin-media.t3.tigrisfiles.io" }
```

Veillez à ce que `.env` reste hors du contexte de build : ajoutez-le à `.dockerignore`.

## 2. Écrire `fly.toml`

```toml title="fly.toml"
app = "my-verdin"                # yours
primary_region = "fra"           # yours

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 1337
  force_https = true
  # Keep a Machine running: webhooks, scheduled releases, plugin jobs and the
  # daily digest run inside the server process.
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "30s"
    interval = "15s"
    method = "GET"
    timeout = "5s"
    path = "/_ready"

[[vm]]
  memory = "512mb"               # adjust to your content and traffic
```

La commande par défaut de l’image, `start --migrate`, applique les migrations sans risque au
démarrage de chaque Machine : aucun `release_command` n’est donc nécessaire. (Fly exécute
`release_command` dans une Machine temporaire sans volumes, ce qui ne fonctionnerait de toute
façon pas pour SQLite.)

## 3. Créer l’application, la base de données et le bucket

1. Créez l’application sans la déployer. `--ha=false` démarre avec une seule Machine ; lisez
   [Exécuter plusieurs instances](/fr/deploy/scaling/) avant d’en ajouter.

   ```sh frame="terminal"
   fly launch --no-deploy --copy-config --ha=false
   ```

2. Créez une base PostgreSQL, par exemple avec
   [Fly Managed Postgres](https://docs.fly.io/mpg/) ou n’importe quel fournisseur PostgreSQL,
   et notez son URL de connexion.

3. Créez un bucket Tigris public. La commande définit `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3` et `BUCKET_NAME` comme secrets de
   l’application ; Verdin lit les deux premiers. Indiquez le nom du bucket dans `verdin.toml`.

   ```sh frame="terminal"
   fly storage create --public
   ```

4. Définissez les secrets de Verdin et l’URL de la base de données :

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets | fly secrets import
   fly secrets set VERDIN_DATABASE_URL='postgres://<user>:<password>@<host>:5432/<db>?sslmode=require'
   ```

5. Déployez, puis ouvrez `https://<app>.fly.dev/admin/` et créez le premier administrateur :

   ```sh frame="terminal"
   fly deploy
   ```

## Adresses des clients et limites de débit

Le proxy de Fly ajoute le client à `X-Forwarded-For` et, d’après la
[documentation de Fly sur les en-têtes de requête](https://docs.fly.io/networking/request-headers/),
l’adresse la plus à droite est la propre IP de votre application. Pour que Verdin trouve le
client, faites confiance à la plage du proxy et aux adresses de votre application
(`fly ips list`) :

```toml title="verdin.toml"
[server]
trusted_proxies = ["172.16.0.0/12", "<app IPv4>", "<app IPv6>"]
```

Cela n’a pas été vérifié sur une application en fonctionnement. Tant que vous ne l’avez pas
vérifié, laissez `[api].public_rate_limit` à `0` : sans les bons proxys, tous les visiteurs
comptent comme une même adresse.

## Variante : une Machine avec SQLite

Pour un petit projet, vous pouvez plutôt garder la base de données et les téléversements sur un
volume Fly.

- Dans `verdin.toml`, définissez `provider = { name = "local", dir = "/data/uploads" }` sous
  `[upload]` (le répertoire par défaut est relatif à `/app`, où le serveur ne peut pas écrire),
  et définissez `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` comme secret.
- Montez un volume sur `/data` :

  ```toml title="fly.toml"
  [mounts]
    source = "verdin_data"
    destination = "/data"
    initial_size = "1gb"
  ```

- Exécutez exactement une Machine (`fly scale count 1`). Un volume s’attache à une seule
  Machine, et SQLite ne peut pas être partagé.
- Fly crée des volumes appartenant à root, et l’image s’exécute avec l’uid `65532`. Si le
  démarrage échoue avec une erreur de permission sur `/data`, ajoutez `USER root` à votre
  `Dockerfile`.

Sauvegardez le volume : Fly conserve des instantanés quotidiens des volumes, et
`verdin export` vous fournit une archive portable (voir [Sauvegardes](/fr/deploy/backups/)).
