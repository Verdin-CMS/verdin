---
title: Railway
description: Déployez Verdin sur Railway à partir du Dockerfile de votre dépôt, avec Railway PostgreSQL et les médias sur un stockage compatible S3 ou sur un volume.
sidebar:
  order: 6
---

Cette page déploie un projet Verdin sur [Railway](https://railway.com) : un service construit à
partir d’un petit Dockerfile dans votre dépôt, une base de données Railway PostgreSQL, et les
médias sur un stockage compatible S3 (ou un volume pour une instance unique).

:::note
Les paramètres de Railway ont été vérifiés par rapport à la
[documentation de Railway](https://docs.railway.com/reference/config-as-code) le 2026-09-29 ;
la configuration n’a pas été déployée sur un compte Railway réel. Les valeurs marquées
`# yours` ou entre chevrons sont à remplir par vos soins.
:::

## 1. Ajouter un Dockerfile, une configuration et `railway.json`

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
provider = { name = "s3", bucket = "media", region = "auto",             # yours
             endpoint = "https://<account>.r2.cloudflarestorage.com",    # yours
             public_url = "https://media.example.com" }                  # yours
```

```json title="railway.json"
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "healthcheckPath": "/_ready",
    "healthcheckTimeout": 120,
    "restartPolicyType": "ON_FAILURE"
  }
}
```

Aucune commande de démarrage n’est nécessaire : l’image exécute `start --migrate`, qui applique
les migrations sans risque avant de servir. Gardez `.env` hors du dépôt.

## 2. Créer le projet

1. Dans Railway, créez un projet à partir de votre dépôt GitHub. Railway trouve
   `railway.json` et construit le Dockerfile.
2. Ajoutez une base de données **PostgreSQL** au projet.
3. Dans les **Variables** du service Verdin, ajoutez :

   | Variable | Valeur |
   | --- | --- |
   | `VERDIN_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (l’URL privée du service de base de données ; utilisez le nom de votre service de base de données) |
   | `VERDIN_ADMIN_JWT_SECRET` | issu de `verdin secrets` |
   | `VERDIN_TOKEN_PEPPER` | issu de `verdin secrets` |
   | `VERDIN_SERVER__PUBLIC_URL` | `https://<your-domain>` |
   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | vos identifiants S3 |

   Générez les deux secrets en local :

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets
   ```

4. Dans les paramètres réseau du service, cliquez sur **Generate Domain** et définissez son
   port cible sur `1337`. Verdin écoute sur `[server].port` et ne lit pas la variable `PORT` de
   Railway.
5. Déployez, ouvrez `https://<your-domain>/admin/` et créez le premier administrateur.

## Variante : médias ou SQLite sur un volume

Pour une instance unique, vous pouvez garder les téléversements, et même la base de données,
sur un volume Railway monté sur `/data` :

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

avec `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` si vous vous passez de PostgreSQL. Gardez
à l’esprit que :

- Un service avec un volume ne peut pas avoir de réplicas, et chaque redéploiement entraîne une
  courte interruption.
- Railway monte des volumes appartenant à root, et l’image s’exécute avec l’uid `65532`.
  Définissez la variable de service `RAILWAY_RUN_UID=0` pour que le serveur puisse écrire sur
  le volume.

## Adresses des clients

Le proxy edge de Railway se trouve devant le service. Sa plage d’adresses n’a pas été vérifiée
pour ce guide : `[server].trusted_proxies` reste donc vide. Tous les visiteurs comptent alors
comme une même adresse pour les limites de débit ; gardez donc `[api].public_rate_limit` à `0`,
sauf si vous trouvez la plage du proxy et lui faites confiance.
