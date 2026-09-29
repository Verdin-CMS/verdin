---
title: Render
description: Distribuisci Verdin su Render con un Blueprint — un web service Docker costruito dal tuo repository, un database Render PostgreSQL, e i media su uno storage compatibile S3 o su un disco.
sidebar:
  order: 5
---

Questa pagina distribuisce un progetto Verdin su [Render](https://render.com) con un
Blueprint (`render.yaml`): un web service costruito da un piccolo Dockerfile nel tuo
repository, e un database Render PostgreSQL. Il filesystem di Render è effimero, quindi i
media vanno su uno storage compatibile S3, o su un disco persistente se esegui una sola
istanza.

:::note
Il formato del Blueprint è stato verificato rispetto al
[riferimento dei Blueprint di Render](https://render.com/docs/blueprint-spec) il 2026-09-29;
non è stato distribuito su un account Render reale. I valori segnati `# yours` sono da
compilare con i tuoi.
:::

Prerequisiti: il tuo progetto Verdin (con `schema/`) in un repository Git leggibile da
Render.

## 1. Aggiungi un Dockerfile e una configurazione

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

Tieni `.env` fuori dal repository e fuori dall'immagine (`.dockerignore`).

## 2. Scrivi `render.yaml`

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

Aggiungi un `plan` al servizio e al database per scegliere un tipo di istanza (vedi la
pagina dei prezzi di Render); senza, Render usa il suo default.

`generateValue: true` crea ogni segreto una volta, quando il Blueprint viene applicato per
la prima volta, e lo mantiene in seguito. Non rigenerarli: un nuovo `VERDIN_TOKEN_PEPPER` fa
smettere di funzionare ogni token API.

## 3. Distribuisci

1. Nella dashboard di Render, crea un **Blueprint** dal repository e inserisci i valori per
   le variabili `sync: false`.
2. Aspetta il primo deploy. Il comando di default dell'immagine, `start --migrate`, crea le
   tabelle al primo avvio e applica le migrazioni sicure nei deploy successivi.
3. Apri `https://<service>.onrender.com/admin/` e registra il primo admin.

Render invia `SIGTERM` prima di fermare un'istanza; Verdin termina ed esce quando lo riceve.

## Variante: media su un disco

Per una singola istanza puoi memorizzare gli upload su un disco persistente di Render invece
che su S3. Imposta il provider locale in `verdin.toml`:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

e aggiungi un disco al servizio:

```yaml title="render.yaml"
    disk:
      name: verdin-data
      mountPath: /data
      sizeGB: 5
```

Con un disco, Render non ti permette di scalare il servizio su più istanze, e i deploy
fermano la vecchia istanza prima che parta la nuova, quindi ogni deploy ha un breve
downtime. Lo stesso disco può contenere un database SQLite (`sqlite:///data/verdin.db`) se
non vuoi un database Render. Verifica che l'utente dell'immagine (uid `65532`) possa
scrivere sul disco; se l'avvio fallisce con un errore di permessi su `/data`, aggiungi
`USER root` al tuo `Dockerfile`.

## Indirizzi dei client

Il proxy di Render sta davanti al servizio. Il suo intervallo di indirizzi non è stato
verificato per questa guida, quindi `[server].trusted_proxies` resta vuoto: ogni visitatore
conta allora come lo stesso indirizzo per i limiti di frequenza, quindi lascia
`[api].public_rate_limit` a `0` a meno che tu non trovi e consideri affidabile l'intervallo
del proxy.
