---
title: Fly.io
description: Distribuisci Verdin su Fly.io con la tua immagine, PostgreSQL e lo storage a oggetti Tigris, oppure una sola Machine con SQLite su un volume.
sidebar:
  order: 4
---

Questa pagina distribuisce un progetto Verdin su [Fly.io](https://fly.io) come una piccola
immagine costruita su quella ufficiale. La configurazione consigliata non tiene stato sulla
Machine: PostgreSQL per il database e Tigris (lo storage compatibile S3 di Fly) per i media.
Segue una variante con SQLite su un volume.

:::note
I formati di Fly sono stati verificati rispetto alla
[documentazione di Fly](https://docs.fly.io/reference/configuration/) il 2026-09-29; la
configurazione non è stata eseguita su un account Fly reale. I valori tra parentesi angolari
e quelli segnati `# yours` sono da compilare con i tuoi.
:::

Prerequisiti: [`flyctl`](https://docs.fly.io/flyctl/install/) con accesso effettuato, e un
progetto Verdin con la directory `schema/` sotto commit.

## 1. Aggiungi un Dockerfile e una configurazione

Nella directory del progetto, aggiungi un `Dockerfile` che copia la tua configurazione e il
tuo schema nell'immagine ufficiale (vedi [La tua immagine](/it/deploy/docker/)):

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

e un `verdin.toml` per Fly:

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

Assicurati che `.env` resti fuori dal contesto di build: aggiungilo a `.dockerignore`.

## 2. Scrivi `fly.toml`

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

Il comando di default dell'immagine, `start --migrate`, applica le migrazioni sicure
all'avvio di ogni Machine, quindi non serve un `release_command`. (Fly esegue
`release_command` in una Machine temporanea senza volumi, che comunque non funzionerebbe con
SQLite.)

## 3. Crea l'app, il database e il bucket

1. Crea l'app senza distribuirla. `--ha=false` parte con una Machine; leggi
   [Eseguire più istanze](/it/deploy/scaling/) prima di aggiungerne altre.

   ```sh frame="terminal"
   fly launch --no-deploy --copy-config --ha=false
   ```

2. Crea un database PostgreSQL, per esempio con
   [Fly Managed Postgres](https://docs.fly.io/mpg/) o qualsiasi provider PostgreSQL, e
   annota il suo URL di connessione.

3. Crea un bucket Tigris pubblico. Il comando imposta `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3` e `BUCKET_NAME` come secret dell'app;
   Verdin legge i primi due. Metti il nome del bucket in `verdin.toml`.

   ```sh frame="terminal"
   fly storage create --public
   ```

4. Imposta i segreti di Verdin e l'URL del database:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets | fly secrets import
   fly secrets set VERDIN_DATABASE_URL='postgres://<user>:<password>@<host>:5432/<db>?sslmode=require'
   ```

5. Distribuisci, poi apri `https://<app>.fly.dev/admin/` e registra il primo admin:

   ```sh frame="terminal"
   fly deploy
   ```

## Indirizzi dei client e limiti di frequenza

Il proxy di Fly aggiunge il client a `X-Forwarded-For`, e secondo la
[documentazione degli header di richiesta di Fly](https://docs.fly.io/networking/request-headers/)
l'indirizzo più a destra è l'IP della tua app. Perché Verdin trovi il client, considera
affidabili l'intervallo del proxy e gli indirizzi della tua app (`fly ips list`):

```toml title="verdin.toml"
[server]
trusted_proxies = ["172.16.0.0/12", "<app IPv4>", "<app IPv6>"]
```

Questo non è stato verificato su un'app in esecuzione. Finché non l'hai verificato, lascia
`[api].public_rate_limit` a `0`: senza i proxy giusti, ogni visitatore conta come lo stesso
indirizzo.

## Variante: una Machine con SQLite

Per un piccolo progetto puoi invece tenere database e upload su un volume Fly.

- In `verdin.toml`, imposta `provider = { name = "local", dir = "/data/uploads" }` sotto
  `[upload]` (la directory di default è relativa ad `/app`, dove il server non può
  scrivere), e imposta `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` come secret.
- Monta un volume su `/data`:

  ```toml title="fly.toml"
  [mounts]
    source = "verdin_data"
    destination = "/data"
    initial_size = "1gb"
  ```

- Esegui esattamente una Machine (`fly scale count 1`). Un volume si collega a una sola
  Machine, e SQLite non può essere condiviso.
- Fly crea i volumi di proprietà di root, e l'immagine gira come uid `65532`. Se l'avvio
  fallisce con un errore di permessi su `/data`, aggiungi `USER root` al tuo `Dockerfile`.

Fai il backup del volume: Fly conserva snapshot giornalieri dei volumi, e `verdin export`
ti dà un archivio portabile (vedi [Backup](/it/deploy/backups/)).
