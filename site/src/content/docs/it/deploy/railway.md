---
title: Railway
description: Distribuisci Verdin su Railway dal Dockerfile del tuo repository, con Railway PostgreSQL e i media su uno storage compatibile S3 o su un volume.
sidebar:
  order: 6
---

Questa pagina distribuisce un progetto Verdin su [Railway](https://railway.com): un servizio
costruito da un piccolo Dockerfile nel tuo repository, un database Railway PostgreSQL, e i
media su uno storage compatibile S3 (o su un volume per una singola istanza).

:::note
Le impostazioni di Railway sono state verificate rispetto alla
[documentazione di Railway](https://docs.railway.com/reference/config-as-code) il
2026-09-29; la configurazione non è stata distribuita su un account Railway reale. I valori
segnati `# yours` o tra parentesi angolari sono da compilare con i tuoi.
:::

## 1. Aggiungi un Dockerfile, una configurazione e `railway.json`

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

Non serve un comando di avvio: l'immagine esegue `start --migrate`, che applica le
migrazioni sicure prima di servire. Tieni `.env` fuori dal repository.

## 2. Crea il progetto

1. In Railway, crea un progetto dal tuo repository GitHub. Railway trova `railway.json` e
   costruisce il Dockerfile.
2. Aggiungi un database **PostgreSQL** al progetto.
3. Nelle **Variables** del servizio Verdin, aggiungi:

   | Variabile | Valore |
   | --- | --- |
   | `VERDIN_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (l'URL privato del servizio database; usa il nome del tuo servizio database) |
   | `VERDIN_ADMIN_JWT_SECRET` | da `verdin secrets` |
   | `VERDIN_TOKEN_PEPPER` | da `verdin secrets` |
   | `VERDIN_SERVER__PUBLIC_URL` | `https://<your-domain>` |
   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | le tue credenziali S3 |

   Genera i due segreti in locale:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets
   ```

4. Nelle impostazioni di rete del servizio, fai clic su **Generate Domain** e imposta la
   porta di destinazione a `1337`. Verdin ascolta su `[server].port` e non legge la
   variabile `PORT` di Railway.
5. Distribuisci, apri `https://<your-domain>/admin/` e registra il primo admin.

## Variante: media o SQLite su un volume

Per una singola istanza puoi tenere gli upload, e persino il database, su un volume Railway
montato su `/data`:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

con `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` se rinunci a PostgreSQL. Tieni presente
che:

- Un servizio con un volume non può avere repliche, e ogni nuovo deploy ha un breve
  downtime.
- Railway monta i volumi di proprietà di root, e l'immagine gira come uid `65532`. Imposta
  la variabile di servizio `RAILWAY_RUN_UID=0` perché il server possa scrivere sul volume.

## Indirizzi dei client

Il proxy edge di Railway sta davanti al servizio. Il suo intervallo di indirizzi non è stato
verificato per questa guida, quindi `[server].trusted_proxies` resta vuoto: ogni visitatore
conta allora come lo stesso indirizzo per i limiti di frequenza, quindi lascia
`[api].public_rate_limit` a `0` a meno che tu non trovi e consideri affidabile l'intervallo
del proxy.
