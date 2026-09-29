---
title: Fly.io
description: Desplega Verdin a Fly.io amb la teva pròpia imatge, PostgreSQL i l'emmagatzematge d'objectes Tigris, o una sola Machine amb SQLite en un volum.
sidebar:
  order: 4
---

Aquesta pàgina desplega un projecte Verdin a [Fly.io](https://fly.io) com una imatge petita
construïda sobre l'oficial. La configuració recomanada no guarda cap estat a la Machine:
PostgreSQL per a la base de dades i Tigris (l'emmagatzematge compatible amb S3 de Fly) per a la
multimèdia. Després hi ha una variant amb SQLite en un volum.

:::note
Els formats de Fly s'han comprovat amb la [documentació de Fly](https://docs.fly.io/reference/configuration/)
el 29-09-2026; la configuració no s'ha executat en un compte real de Fly. Els valors entre
angles i els marcats amb `# yours` els has d'omplir tu.
:::

Requisits previs: [`flyctl`](https://docs.fly.io/flyctl/install/) amb la sessió iniciada, i un
projecte Verdin amb el seu directori `schema/` confirmat.

## 1. Afegeix un Dockerfile i una configuració

Al directori del projecte, afegeix un `Dockerfile` que copiï la teva configuració i el teu
esquema dins de la imatge oficial (consulta [La teva pròpia imatge](/ca/deploy/docker/)):

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

i un `verdin.toml` per a Fly:

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

Assegura't que `.env` queda fora del context de build: afegeix-lo a `.dockerignore`.

## 2. Escriu `fly.toml`

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

L'ordre per defecte de la imatge, `start --migrate`, aplica les migracions segures quan s'inicia
cada Machine, així que no cal cap `release_command`. (Fly executa `release_command` en una
Machine temporal sense volums, cosa que de totes maneres no funcionaria amb SQLite.)

## 3. Crea l'aplicació, la base de dades i el bucket

1. Crea l'aplicació sense desplegar-la. `--ha=false` comença amb una sola Machine; llegeix
   [Executar diverses instàncies](/ca/deploy/scaling/) abans d'afegir-ne més.

   ```sh frame="terminal"
   fly launch --no-deploy --copy-config --ha=false
   ```

2. Crea una base de dades PostgreSQL, per exemple amb
   [Fly Managed Postgres](https://docs.fly.io/mpg/) o qualsevol proveïdor de PostgreSQL, i
   apunta't la seva URL de connexió.

3. Crea un bucket públic de Tigris. L'ordre defineix `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3` i `BUCKET_NAME` com a secrets de l'aplicació;
   Verdin llegeix els dos primers. Posa el nom del bucket a `verdin.toml`.

   ```sh frame="terminal"
   fly storage create --public
   ```

4. Defineix els secrets de Verdin i la URL de la base de dades:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets | fly secrets import
   fly secrets set VERDIN_DATABASE_URL='postgres://<user>:<password>@<host>:5432/<db>?sslmode=require'
   ```

5. Desplega, obre `https://<app>.fly.dev/admin/` i registra el primer administrador:

   ```sh frame="terminal"
   fly deploy
   ```

## Adreces dels clients i límits de freqüència

El proxy de Fly afegeix el client a `X-Forwarded-For` i, segons la
[documentació de capçaleres de petició de Fly](https://docs.fly.io/networking/request-headers/),
l'adreça de més a la dreta és la IP de la teva pròpia aplicació. Perquè Verdin trobi el client,
confia en el rang del proxy i en les adreces de la teva aplicació (`fly ips list`):

```toml title="verdin.toml"
[server]
trusted_proxies = ["172.16.0.0/12", "<app IPv4>", "<app IPv6>"]
```

Això no s'ha verificat en una aplicació en execució. Fins que no ho hagis comprovat, deixa
`[api].public_rate_limit` a `0`: sense els proxies correctes, tots els visitants compten com la
mateixa adreça.

## Variant: una Machine amb SQLite

Per a un projecte petit, pots guardar la base de dades i les pujades en un volum de Fly.

- A `verdin.toml`, defineix `provider = { name = "local", dir = "/data/uploads" }` a `[upload]`
  (el directori per defecte és relatiu a `/app`, on el servidor no pot escriure), i defineix
  `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` com a secret.
- Munta un volum a `/data`:

  ```toml title="fly.toml"
  [mounts]
    source = "verdin_data"
    destination = "/data"
    initial_size = "1gb"
  ```

- Executa exactament una Machine (`fly scale count 1`). Un volum s'associa a una sola Machine, i
  SQLite no es pot compartir.
- Fly crea els volums amb root com a propietari, i la imatge s'executa amb l'uid `65532`. Si
  l'inici falla amb un error de permisos a `/data`, afegeix `USER root` al teu `Dockerfile`.

Fes còpia de seguretat del volum: Fly conserva instantànies diàries dels volums, i
`verdin export` et dona un arxiu portable (consulta [Còpies de seguretat](/ca/deploy/backups/)).
