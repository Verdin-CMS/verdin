---
title: Railway
description: Deploy Verdin naar Railway vanuit de Dockerfile van je repository, met Railway PostgreSQL en media op S3-compatibele opslag of een volume.
sidebar:
  order: 6
---

Deze pagina deployt een Verdin-project naar [Railway](https://railway.com): een service die wordt
gebouwd vanuit een kleine Dockerfile in je repository, een Railway PostgreSQL-database, en media op
S3-compatibele opslag (of een volume voor één instantie).

:::note
De instellingen van Railway zijn op 2026-09-29 gecontroleerd tegen de
[documentatie van Railway](https://docs.railway.com/reference/config-as-code); de opstelling is
niet op een echt Railway-account gedeployd. Waarden gemarkeerd met `# yours` of tussen punthaken
vul je zelf in.
:::

## 1. Voeg een Dockerfile, een configuratie en `railway.json` toe

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

Er is geen startcommando nodig: het image draait `start --migrate`, dat veilige migraties toepast
voordat het serveert. Houd `.env` buiten de repository.

## 2. Maak het project aan

1. Maak in Railway een project aan vanuit je GitHub-repository. Railway vindt `railway.json` en
   bouwt de Dockerfile.
2. Voeg een **PostgreSQL**-database aan het project toe.
3. Voeg in de **Variables** van de Verdin-service toe:

   | Variabele | Waarde |
   | --- | --- |
   | `VERDIN_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (de privé-URL van de databaseservice; gebruik de naam van jouw databaseservice) |
   | `VERDIN_ADMIN_JWT_SECRET` | uit `verdin secrets` |
   | `VERDIN_TOKEN_PEPPER` | uit `verdin secrets` |
   | `VERDIN_SERVER__PUBLIC_URL` | `https://<your-domain>` |
   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | je S3-inloggegevens |

   Genereer de twee geheimen lokaal:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets
   ```

4. Klik in de netwerkinstellingen van de service op **Generate Domain** en stel de doelpoort in op
   `1337`. Verdin luistert op `[server].port` en leest de variabele `PORT` van Railway niet.
5. Deploy, open `https://<your-domain>/admin/` en registreer de eerste beheerder.

## Variant: media of SQLite op een volume

Voor één instantie kun je uploads, en zelfs de database, bewaren op een Railway-volume dat op
`/data` is gemount:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

met `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` als je PostgreSQL overslaat. Houd er rekening
mee:

- Een service met een volume kan geen replica's hebben, en elke nieuwe deploy geeft een korte
  downtime.
- Railway mount volumes die eigendom zijn van root, en het image draait als uid `65532`. Stel de
  servicevariabele `RAILWAY_RUN_UID=0` in, zodat de server naar het volume kan schrijven.

## Clientadressen

De edge-proxy van Railway staat vóór de service. Het adresbereik ervan is voor deze gids niet
geverifieerd, dus `[server].trusted_proxies` blijft leeg: elke bezoeker telt dan als hetzelfde
adres voor rate limits, dus houd `[api].public_rate_limit` op `0`, tenzij je het bereik van de
proxy vindt en vertrouwt.
