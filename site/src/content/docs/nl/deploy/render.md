---
title: Render
description: Deploy Verdin naar Render met een Blueprint — een Docker-webservice gebouwd vanuit je repository, een Render PostgreSQL-database, en media op S3-compatibele opslag of een schijf.
sidebar:
  order: 5
---

Deze pagina deployt een Verdin-project naar [Render](https://render.com) met een Blueprint
(`render.yaml`): een webservice die wordt gebouwd vanuit een kleine Dockerfile in je repository,
en een Render PostgreSQL-database. Het bestandssysteem van Render is vluchtig, dus media gaan naar
S3-compatibele opslag, of naar een persistente schijf als je één instantie draait.

:::note
Het Blueprint-formaat is op 2026-09-29 gecontroleerd tegen de
[Blueprint-referentie van Render](https://render.com/docs/blueprint-spec); het is niet op een echt
Render-account gedeployd. Waarden gemarkeerd met `# yours` vul je zelf in.
:::

Vereisten: je Verdin-project (met `schema/`) in een Git-repository die Render kan lezen.

## 1. Voeg een Dockerfile en een configuratie toe

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

Houd `.env` buiten de repository en buiten het image (`.dockerignore`).

## 2. Schrijf `render.yaml`

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

Voeg een `plan` toe aan de service en de database om een instantietype te kiezen (zie de
prijzenpagina van Render); zonder `plan` gebruikt Render zijn standaard.

`generateValue: true` maakt elk geheim één keer aan, wanneer de Blueprint voor het eerst wordt
toegepast, en behoudt het daarna. Genereer ze niet opnieuw: met een nieuwe `VERDIN_TOKEN_PEPPER`
werkt geen enkel API-token meer.

## 3. Deploy

1. Maak in het dashboard van Render een **Blueprint** aan vanuit de repository en vul de waarden in
   voor de variabelen met `sync: false`.
2. Wacht op de eerste deploy. Het standaardcommando van het image, `start --migrate`, maakt bij de
   eerste start de tabellen aan en past bij latere deploys veilige migraties toe.
3. Open `https://<service>.onrender.com/admin/` en registreer de eerste beheerder.

Render stuurt `SIGTERM` voordat het een instantie stopt; Verdin rondt dan af en sluit af.

## Variant: media op een schijf

Voor één instantie kun je uploads in plaats van op S3 op een persistente schijf van Render
bewaren. Stel de lokale provider in `verdin.toml` in:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

en voeg een schijf toe aan de service:

```yaml title="render.yaml"
    disk:
      name: verdin-data
      mountPath: /data
      sizeGB: 5
```

Met een schijf laat Render je de service niet naar meerdere instanties schalen, en stoppen deploys
de oude instantie voordat de nieuwe start, dus elke deploy geeft een korte downtime. Dezelfde
schijf kan een SQLite-database bevatten (`sqlite:///data/verdin.db`) als je geen Render-database
wilt. Controleer dat de gebruiker van het image (uid `65532`) naar de schijf kan schrijven; als het
starten mislukt met een rechtenfout op `/data`, voeg dan `USER root` toe aan je `Dockerfile`.

## Clientadressen

De proxy van Render staat vóór de service. Het adresbereik ervan is voor deze gids niet
geverifieerd, dus `[server].trusted_proxies` blijft leeg: elke bezoeker telt dan als hetzelfde
adres voor rate limits, dus houd `[api].public_rate_limit` op `0`, tenzij je het bereik van de
proxy vindt en vertrouwt.
