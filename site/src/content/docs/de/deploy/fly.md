---
title: Fly.io
description: Deploye Verdin auf Fly.io mit deinem eigenen Image, PostgreSQL und dem Objektspeicher Tigris, oder auf einer einzelnen Machine mit SQLite auf einem Volume.
sidebar:
  order: 4
---

Diese Seite deployt ein Verdin-Projekt auf [Fly.io](https://fly.io) als kleines Image, das auf
dem offiziellen aufbaut. Das empfohlene Setup hält keinen Zustand auf der Machine: PostgreSQL
für die Datenbank und Tigris (der S3-kompatible Speicher von Fly) für Medien. Danach folgt eine
Variante mit SQLite auf einem Volume.

:::note
Die Formate von Fly wurden am 29.09.2026 mit der
[Dokumentation von Fly](https://docs.fly.io/reference/configuration/) abgeglichen; das Setup
lief nicht auf einem echten Fly-Konto. Werte in spitzen Klammern und die mit `# yours`
markierten füllst du selbst aus.
:::

Voraussetzungen: ein angemeldetes [`flyctl`](https://docs.fly.io/flyctl/install/) und ein
Verdin-Projekt mit committetem `schema/`-Verzeichnis.

## 1. Ein Dockerfile und eine Konfiguration hinzufügen

Füge im Projektverzeichnis ein `Dockerfile` hinzu, das deine Konfiguration und dein Schema in
das offizielle Image kopiert (siehe [Ein eigenes Image](/de/deploy/docker/)):

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

und eine `verdin.toml` für Fly:

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

Achte darauf, dass `.env` nicht im Build-Kontext landet: Trag sie in `.dockerignore` ein.

## 2. `fly.toml` schreiben

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

Der Standardbefehl des Images, `start --migrate`, wendet beim Start jeder Machine sichere
Migrationen an, ein `release_command` ist also nicht nötig. (Fly führt `release_command` in
einer temporären Machine ohne Volumes aus, was für SQLite ohnehin nicht funktionieren würde.)

## 3. App, Datenbank und Bucket anlegen

1. Leg die App an, ohne sie zu deployen. `--ha=false` startet mit einer Machine; lies
   [Mehrere Instanzen betreiben](/de/deploy/scaling/), bevor du weitere hinzufügst.

   ```sh frame="terminal"
   fly launch --no-deploy --copy-config --ha=false
   ```

2. Leg eine PostgreSQL-Datenbank an, etwa mit
   [Fly Managed Postgres](https://docs.fly.io/mpg/) oder bei einem beliebigen
   PostgreSQL-Anbieter, und notiere ihre Verbindungs-URL.

3. Leg einen öffentlichen Tigris-Bucket an. Der Befehl setzt `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3` und `BUCKET_NAME` als Secrets der App;
   Verdin liest die ersten beiden. Trag den Bucket-Namen in `verdin.toml` ein.

   ```sh frame="terminal"
   fly storage create --public
   ```

4. Setze die Secrets von Verdin und die Datenbank-URL:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets | fly secrets import
   fly secrets set VERDIN_DATABASE_URL='postgres://<user>:<password>@<host>:5432/<db>?sslmode=require'
   ```

5. Deploye, öffne dann `https://<app>.fly.dev/admin/` und registriere den ersten Admin:

   ```sh frame="terminal"
   fly deploy
   ```

## Client-Adressen und Rate Limits

Der Proxy von Fly hängt den Client an `X-Forwarded-For` an, und laut der
[Dokumentation von Fly zu Request-Headern](https://docs.fly.io/networking/request-headers/)
ist die Adresse ganz rechts die eigene IP deiner App. Damit Verdin den Client findet, vertraue
dem Bereich des Proxys und den Adressen deiner App (`fly ips list`):

```toml title="verdin.toml"
[server]
trusted_proxies = ["172.16.0.0/12", "<app IPv4>", "<app IPv6>"]
```

Das wurde nicht auf einer laufenden App überprüft. Bis du es geprüft hast, lass
`[api].public_rate_limit` auf `0`: Ohne die richtigen Proxys zählt jeder Besucher als dieselbe
Adresse.

## Variante: eine Machine mit SQLite

Für ein kleines Projekt kannst du Datenbank und Uploads stattdessen auf einem Fly-Volume
halten.

- Setze in `verdin.toml` unter `[upload]` `provider = { name = "local", dir = "/data/uploads" }`
  (das Standardverzeichnis ist relativ zu `/app`, wo der Server nicht schreiben kann), und setze
  `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` als Secret.
- Binde ein Volume unter `/data` ein:

  ```toml title="fly.toml"
  [mounts]
    source = "verdin_data"
    destination = "/data"
    initial_size = "1gb"
  ```

- Betreibe genau eine Machine (`fly scale count 1`). Ein Volume hängt an einer Machine, und
  SQLite lässt sich nicht teilen.
- Fly legt Volumes mit root als Eigentümer an, und das Image läuft als UID `65532`. Scheitert
  der Start mit einem Berechtigungsfehler auf `/data`, füge `USER root` zu deinem `Dockerfile`
  hinzu.

Sichere das Volume: Fly hält tägliche Volume-Snapshots vor, und `verdin export` gibt dir ein
portables Archiv (siehe [Backups](/de/deploy/backups/)).
