---
title: Fly.io
description: Wdróż Verdin na Fly.io z własnym obrazem, PostgreSQL i magazynem obiektów Tigris albo jako jedną maszynę z SQLite na wolumenie.
sidebar:
  order: 4
---

Ta strona wdraża projekt Verdin na [Fly.io](https://fly.io) jako mały obraz zbudowany na
bazie oficjalnego. Zalecana konfiguracja nie przechowuje stanu na maszynie: PostgreSQL jako
baza danych i Tigris (magazyn Fly zgodny z S3) na multimedia. Dalej opisany jest wariant
z SQLite na wolumenie.

:::note
Formaty Fly sprawdzono z [dokumentacją Fly](https://docs.fly.io/reference/configuration/)
2026-09-29; konfiguracji nie uruchomiono na prawdziwym koncie Fly. Wartości w nawiasach
ostrych i te oznaczone `# yours` uzupełniasz sam.
:::

Wymagania: zalogowany [`flyctl`](https://docs.fly.io/flyctl/install/) i projekt Verdin
z zatwierdzonym katalogiem `schema/`.

## 1. Dodaj Dockerfile i konfigurację

W katalogu projektu dodaj `Dockerfile`, który kopiuje twoją konfigurację i schemat do
oficjalnego obrazu (zobacz [Własny obraz](/pl/deploy/docker/)):

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

oraz `verdin.toml` dla Fly:

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

Upewnij się, że `.env` zostaje poza kontekstem buildu: dodaj go do `.dockerignore`.

## 2. Napisz `fly.toml`

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

Domyślne polecenie obrazu, `start --migrate`, stosuje bezpieczne migracje przy starcie
każdej maszyny, więc `release_command` nie jest potrzebne. (Fly uruchamia `release_command`
na tymczasowej maszynie bez wolumenów, co i tak nie zadziałałoby z SQLite).

## 3. Utwórz aplikację, bazę danych i bucket

1. Utwórz aplikację bez wdrażania. `--ha=false` zaczyna od jednej maszyny; zanim dodasz
   kolejne, przeczytaj [Uruchamianie kilku instancji](/pl/deploy/scaling/).

   ```sh frame="terminal"
   fly launch --no-deploy --copy-config --ha=false
   ```

2. Utwórz bazę PostgreSQL, np. w [Fly Managed Postgres](https://docs.fly.io/mpg/) lub
   u dowolnego dostawcy PostgreSQL, i zanotuj jej URL połączenia.

3. Utwórz publiczny bucket Tigris. Polecenie ustawia `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3` i `BUCKET_NAME` jako sekrety aplikacji;
   Verdin odczytuje dwa pierwsze. Wpisz nazwę bucketu do `verdin.toml`.

   ```sh frame="terminal"
   fly storage create --public
   ```

4. Ustaw sekrety Verdin i URL bazy danych:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets | fly secrets import
   fly secrets set VERDIN_DATABASE_URL='postgres://<user>:<password>@<host>:5432/<db>?sslmode=require'
   ```

5. Wdróż, a potem otwórz `https://<app>.fly.dev/admin/` i zarejestruj pierwszego
   administratora:

   ```sh frame="terminal"
   fly deploy
   ```

## Adresy klientów i limity żądań

Proxy Fly dodaje klienta do `X-Forwarded-For`, a według
[dokumentacji nagłówków żądań Fly](https://docs.fly.io/networking/request-headers/) adres
najbardziej po prawej to własny IP twojej aplikacji. Aby Verdin znalazł klienta, zaufaj
zakresowi proxy i adresom aplikacji (`fly ips list`):

```toml title="verdin.toml"
[server]
trusted_proxies = ["172.16.0.0/12", "<app IPv4>", "<app IPv6>"]
```

Nie zweryfikowano tego na działającej aplikacji. Dopóki tego nie sprawdzisz, zostaw
`[api].public_rate_limit` na `0`: bez właściwych proxy każdy odwiedzający liczy się jako ten
sam adres.

## Wariant: jedna maszyna z SQLite

W małym projekcie możesz zamiast tego trzymać bazę danych i przesłane pliki na wolumenie Fly.

- W `verdin.toml` ustaw `provider = { name = "local", dir = "/data/uploads" }` w sekcji
  `[upload]` (domyślny katalog jest względny wobec `/app`, do którego serwer nie może pisać)
  i ustaw `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` jako sekret.
- Zamontuj wolumen w `/data`:

  ```toml title="fly.toml"
  [mounts]
    source = "verdin_data"
    destination = "/data"
    initial_size = "1gb"
  ```

- Uruchom dokładnie jedną maszynę (`fly scale count 1`). Wolumen podłącza się do jednej
  maszyny, a SQLite nie da się współdzielić.
- Fly tworzy wolumeny należące do roota, a obraz działa jako uid `65532`. Jeśli start kończy
  się błędem uprawnień do `/data`, dodaj `USER root` do swojego `Dockerfile`.

Twórz kopie zapasowe wolumenu: Fly przechowuje codzienne snapshoty wolumenów, a
`verdin export` daje przenośne archiwum (zobacz [Kopie zapasowe](/pl/deploy/backups/)).
