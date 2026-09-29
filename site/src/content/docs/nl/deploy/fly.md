---
title: Fly.io
description: Deploy Verdin naar Fly.io met je eigen image, PostgreSQL en Tigris-objectopslag, of één Machine met SQLite op een volume.
sidebar:
  order: 4
---

Deze pagina deployt een Verdin-project naar [Fly.io](https://fly.io) als een klein image dat op
het officiële is gebouwd. De aanbevolen opstelling houdt geen state op de Machine: PostgreSQL voor
de database en Tigris (de S3-compatibele opslag van Fly) voor media. Daarna volgt een variant met
SQLite op een volume.

:::note
De formaten van Fly zijn op 2026-09-29 gecontroleerd tegen de
[documentatie van Fly](https://docs.fly.io/reference/configuration/); de opstelling is niet op een
echt Fly-account gedraaid. Waarden tussen punthaken en de waarden gemarkeerd met `# yours` vul je
zelf in.
:::

Vereisten: [`flyctl`](https://docs.fly.io/flyctl/install/) ingelogd, en een Verdin-project met
zijn map `schema/` gecommit.

## 1. Voeg een Dockerfile en een configuratie toe

Voeg in de projectmap een `Dockerfile` toe die je configuratie en schema naar het officiële image
kopieert (zie [Je eigen image](/nl/deploy/docker/)):

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

en een `verdin.toml` voor Fly:

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

Zorg dat `.env` buiten de buildcontext blijft: voeg hem toe aan `.dockerignore`.

## 2. Schrijf `fly.toml`

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

Het standaardcommando van het image, `start --migrate`, past veilige migraties toe wanneer elke
Machine start, dus een `release_command` is niet nodig. (Fly draait `release_command` in een
tijdelijke Machine zonder volumes, wat voor SQLite toch niet zou werken.)

## 3. Maak de app, database en bucket aan

1. Maak de app aan zonder hem te deployen. `--ha=false` begint met één Machine; lees
   [Meerdere instanties draaien](/nl/deploy/scaling/) voordat je er meer toevoegt.

   ```sh frame="terminal"
   fly launch --no-deploy --copy-config --ha=false
   ```

2. Maak een PostgreSQL-database aan, bijvoorbeeld met
   [Fly Managed Postgres](https://docs.fly.io/mpg/) of een andere PostgreSQL-provider, en noteer
   de verbindings-URL.

3. Maak een openbare Tigris-bucket aan. Het commando stelt `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3` en `BUCKET_NAME` in als secrets van de app;
   Verdin leest de eerste twee. Zet de bucketnaam in `verdin.toml`.

   ```sh frame="terminal"
   fly storage create --public
   ```

4. Stel de geheimen van Verdin en de database-URL in:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets | fly secrets import
   fly secrets set VERDIN_DATABASE_URL='postgres://<user>:<password>@<host>:5432/<db>?sslmode=require'
   ```

5. Deploy, open daarna `https://<app>.fly.dev/admin/` en registreer de eerste beheerder:

   ```sh frame="terminal"
   fly deploy
   ```

## Clientadressen en rate limits

De proxy van Fly voegt de client toe aan `X-Forwarded-For`, en volgens de
[documentatie over request-headers van Fly](https://docs.fly.io/networking/request-headers/) is het
meest rechtse adres het eigen IP van je app. Om Verdin de client te laten vinden, vertrouw je het
bereik van de proxy en de adressen van je app (`fly ips list`):

```toml title="verdin.toml"
[server]
trusted_proxies = ["172.16.0.0/12", "<app IPv4>", "<app IPv6>"]
```

Dit is niet op een draaiende app geverifieerd. Laat `[api].public_rate_limit` op `0` staan totdat
je het hebt gecontroleerd: zonder de juiste proxy's telt elke bezoeker als hetzelfde adres.

## Variant: één Machine met SQLite

Voor een klein project kun je de database en uploads in plaats daarvan op een Fly-volume
bewaren.

- Stel in `verdin.toml` onder `[upload]` `provider = { name = "local", dir = "/data/uploads" }` in
  (de standaardmap is relatief ten opzichte van `/app`, waar de server niet kan schrijven), en
  stel `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` in als secret.
- Mount een volume op `/data`:

  ```toml title="fly.toml"
  [mounts]
    source = "verdin_data"
    destination = "/data"
    initial_size = "1gb"
  ```

- Draai precies één Machine (`fly scale count 1`). Een volume hangt aan één Machine, en SQLite kan
  niet worden gedeeld.
- Fly maakt volumes aan die eigendom zijn van root, en het image draait als uid `65532`. Als het
  starten mislukt met een rechtenfout op `/data`, voeg dan `USER root` toe aan je `Dockerfile`.

Maak een back-up van het volume: Fly bewaart dagelijkse snapshots van volumes, en `verdin export`
geeft je een draagbaar archief (zie [Back-ups](/nl/deploy/backups/)).
