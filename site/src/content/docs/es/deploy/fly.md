---
title: Fly.io
description: Despliega Verdin en Fly.io con tu propia imagen, PostgreSQL y el almacenamiento de objetos Tigris, o una sola Machine con SQLite en un volumen.
sidebar:
  order: 4
---

Esta página despliega un proyecto de Verdin en [Fly.io](https://fly.io) como una imagen
pequeña construida sobre la oficial. La configuración recomendada no guarda ningún estado en
la Machine: PostgreSQL para la base de datos y Tigris (el almacenamiento compatible con S3 de
Fly) para los medios. Después viene una variante con SQLite en un volumen.

:::note
Los formatos de Fly se han comprobado con la [documentación de Fly](https://docs.fly.io/reference/configuration/)
el 2026-09-29; la configuración no se ha ejecutado en una cuenta real de Fly. Los valores entre
signos de menor y mayor y los marcados con `# yours` los tienes que rellenar tú.
:::

Requisitos previos: [`flyctl`](https://docs.fly.io/flyctl/install/) con la sesión iniciada, y
un proyecto de Verdin con su directorio `schema/` confirmado en git.

## 1. Añade un Dockerfile y una configuración

En el directorio del proyecto, añade un `Dockerfile` que copie tu configuración y tu esquema en
la imagen oficial (consulta [Tu propia imagen](/es/deploy/docker/)):

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

y un `verdin.toml` para Fly:

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

Asegúrate de que `.env` queda fuera del contexto de build: añádelo a `.dockerignore`.

## 2. Escribe `fly.toml`

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

El comando por defecto de la imagen, `start --migrate`, aplica las migraciones seguras cuando
arranca cada Machine, así que no hace falta `release_command`. (Fly ejecuta `release_command`
en una Machine temporal sin volúmenes, lo que de todos modos no funcionaría con SQLite).

## 3. Crea la app, la base de datos y el bucket

1. Crea la app sin desplegarla. `--ha=false` empieza con una sola Machine; lee
   [Ejecutar varias instancias](/es/deploy/scaling/) antes de añadir más.

   ```sh frame="terminal"
   fly launch --no-deploy --copy-config --ha=false
   ```

2. Crea una base de datos PostgreSQL, por ejemplo con
   [Fly Managed Postgres](https://docs.fly.io/mpg/) o con cualquier proveedor de PostgreSQL, y
   apunta su URL de conexión.

3. Crea un bucket público de Tigris. El comando define `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3` y `BUCKET_NAME` como secretos de la app;
   Verdin lee los dos primeros. Pon el nombre del bucket en `verdin.toml`.

   ```sh frame="terminal"
   fly storage create --public
   ```

4. Define los secretos de Verdin y la URL de la base de datos:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets | fly secrets import
   fly secrets set VERDIN_DATABASE_URL='postgres://<user>:<password>@<host>:5432/<db>?sslmode=require'
   ```

5. Despliega, abre `https://<app>.fly.dev/admin/` y registra el primer administrador:

   ```sh frame="terminal"
   fly deploy
   ```

## Direcciones de los clientes y límites de peticiones

El proxy de Fly añade el cliente a `X-Forwarded-For` y, según la
[documentación de cabeceras de petición de Fly](https://docs.fly.io/networking/request-headers/),
la dirección de más a la derecha es la IP de tu propia app. Para que Verdin encuentre al
cliente, confía en el rango del proxy y en las direcciones de tu app (`fly ips list`):

```toml title="verdin.toml"
[server]
trusted_proxies = ["172.16.0.0/12", "<app IPv4>", "<app IPv6>"]
```

Esto no se ha verificado en una app en marcha. Hasta que lo hayas comprobado, deja
`[api].public_rate_limit` en `0`: sin los proxies correctos, todos los visitantes cuentan como
la misma dirección.

## Variante: una Machine con SQLite

Para un proyecto pequeño, puedes guardar la base de datos y las subidas en un volumen de Fly.

- En `verdin.toml`, define `provider = { name = "local", dir = "/data/uploads" }` en
  `[upload]` (el directorio por defecto es relativo a `/app`, donde el servidor no puede
  escribir), y define `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` como secreto.
- Monta un volumen en `/data`:

  ```toml title="fly.toml"
  [mounts]
    source = "verdin_data"
    destination = "/data"
    initial_size = "1gb"
  ```

- Ejecuta exactamente una Machine (`fly scale count 1`). Un volumen se conecta a una sola
  Machine, y SQLite no se puede compartir.
- Fly crea los volúmenes con root como propietario, y la imagen se ejecuta con el uid `65532`.
  Si el arranque falla con un error de permisos en `/data`, añade `USER root` a tu
  `Dockerfile`.

Haz copia de seguridad del volumen: Fly guarda instantáneas diarias de los volúmenes, y
`verdin export` te da un archivo portable (consulta
[Copias de seguridad](/es/deploy/backups/)).
