---
title: Render
description: Déployez Verdin sur Render avec un Blueprint — un service web Docker construit à partir de votre dépôt, une base de données Render PostgreSQL et les médias sur un stockage compatible S3 ou sur un disque.
sidebar:
  order: 5
---

Cette page déploie un projet Verdin sur [Render](https://render.com) avec un Blueprint
(`render.yaml`) : un service web construit à partir d’un petit Dockerfile dans votre dépôt, et
une base de données Render PostgreSQL. Le système de fichiers de Render est éphémère : les
médias vont donc sur un stockage compatible S3, ou sur un disque persistant si vous exécutez
une seule instance.

:::note
Le format Blueprint a été vérifié par rapport à la
[référence Blueprint de Render](https://render.com/docs/blueprint-spec) le 2026-09-29 ; il n’a
pas été déployé sur un compte Render réel. Les valeurs marquées `# yours` sont à remplir par
vos soins.
:::

Prérequis : votre projet Verdin (avec `schema/`) dans un dépôt Git que Render peut lire.

## 1. Ajouter un Dockerfile et une configuration

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337

[schema]
path = "schema"

[log]
format = "json"

[upload]
# Cloudflare R2 as an example; any S3-compatible service works.
provider = { name = "s3", bucket = "media", region = "auto",             # yours
             endpoint = "https://<account>.r2.cloudflarestorage.com",    # yours
             public_url = "https://media.example.com" }                  # yours
```

Gardez `.env` hors du dépôt et hors de l’image (`.dockerignore`).

## 2. Écrire `render.yaml`

```yaml title="render.yaml"
services:
  - type: web
    name: verdin
    runtime: docker
    repo: https://github.com/<you>/<your-project>   # yours
    branch: main
    dockerfilePath: ./Dockerfile
    region: frankfurt                               # yours
    healthCheckPath: /_ready
    envVars:
      - key: VERDIN_DATABASE_URL
        fromDatabase:
          name: verdin-db
          property: connectionString
      - key: VERDIN_ADMIN_JWT_SECRET
        generateValue: true
      - key: VERDIN_TOKEN_PEPPER
        generateValue: true
      - key: VERDIN_SERVER__PUBLIC_URL
        value: https://verdin.onrender.com          # yours: the service URL or your domain
      - key: AWS_ACCESS_KEY_ID
        sync: false                                 # asked for when you create the Blueprint
      - key: AWS_SECRET_ACCESS_KEY
        sync: false

databases:
  - name: verdin-db
    databaseName: verdin
    user: verdin
    region: frankfurt                               # yours: the same region
    postgresMajorVersion: "17"
```

Ajoutez un `plan` au service et à la base de données pour choisir un type d’instance (voir la
page des tarifs de Render) ; sans cela, Render utilise sa valeur par défaut.

`generateValue: true` crée chaque secret une fois, à la première application du Blueprint, et
le conserve ensuite. Ne les régénérez pas : un nouveau `VERDIN_TOKEN_PEPPER` rend inutilisables
tous les jetons d’API.

## 3. Déployer

1. Dans le tableau de bord de Render, créez un **Blueprint** à partir du dépôt et saisissez les
   valeurs des variables `sync: false`.
2. Attendez le premier déploiement. La commande par défaut de l’image, `start --migrate`, crée
   les tables au premier démarrage et applique les migrations sans risque lors des déploiements
   suivants.
3. Ouvrez `https://<service>.onrender.com/admin/` et créez le premier administrateur.

Render envoie `SIGTERM` avant d’arrêter une instance ; Verdin termine alors son travail et
s’arrête.

## Variante : médias sur un disque

Pour une instance unique, vous pouvez stocker les téléversements sur un disque persistant
Render au lieu de S3. Définissez le fournisseur local dans `verdin.toml` :

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

et ajoutez un disque au service :

```yaml title="render.yaml"
    disk:
      name: verdin-data
      mountPath: /data
      sizeGB: 5
```

Avec un disque, Render ne vous permet pas de faire passer le service à plusieurs instances, et
les déploiements arrêtent l’ancienne instance avant de démarrer la nouvelle : chaque
déploiement entraîne donc une courte interruption. Le même disque peut contenir une base SQLite
(`sqlite:///data/verdin.db`) si vous ne voulez pas de base Render. Vérifiez que l’utilisateur de
l’image (uid `65532`) peut écrire sur le disque ; si le démarrage échoue avec une erreur de
permission sur `/data`, ajoutez `USER root` à votre `Dockerfile`.

## Adresses des clients

Le proxy de Render se trouve devant le service. Sa plage d’adresses n’a pas été vérifiée pour
ce guide : `[server].trusted_proxies` reste donc vide. Tous les visiteurs comptent alors comme
une même adresse pour les limites de débit ; gardez donc `[api].public_rate_limit` à `0`, sauf
si vous trouvez la plage du proxy et lui faites confiance.
