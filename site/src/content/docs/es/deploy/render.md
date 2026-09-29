---
title: Render
description: Despliega Verdin en Render con un Blueprint — un servicio web Docker construido a partir de tu repositorio, una base de datos PostgreSQL de Render y los medios en un almacenamiento compatible con S3 o en un disco.
sidebar:
  order: 5
---

Esta página despliega un proyecto de Verdin en [Render](https://render.com) con un Blueprint
(`render.yaml`): un servicio web construido a partir de un Dockerfile pequeño en tu repositorio
y una base de datos PostgreSQL de Render. El sistema de archivos de Render es efímero, así que
los medios van a un almacenamiento compatible con S3, o a un disco persistente si ejecutas una
sola instancia.

:::note
El formato del Blueprint se ha comprobado con la [referencia de Blueprint de Render](https://render.com/docs/blueprint-spec)
el 2026-09-29; no se ha desplegado en una cuenta real de Render. Los valores marcados con
`# yours` los tienes que rellenar tú.
:::

Requisitos previos: tu proyecto de Verdin (con `schema/`) en un repositorio Git que Render pueda
leer.

## 1. Añade un Dockerfile y una configuración

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

Deja `.env` fuera del repositorio y fuera de la imagen (`.dockerignore`).

## 2. Escribe `render.yaml`

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

Añade un `plan` al servicio y a la base de datos para elegir un tipo de instancia (consulta la
página de precios de Render); sin él, Render usa el suyo por defecto.

`generateValue: true` crea cada secreto una sola vez, cuando se aplica el Blueprint por primera
vez, y lo conserva después. No los regeneres: un `VERDIN_TOKEN_PEPPER` nuevo hace que dejen de
funcionar todos los tokens de API.

## 3. Despliega

1. En el panel de Render, crea un **Blueprint** a partir del repositorio e introduce los valores
   de las variables con `sync: false`.
2. Espera al primer despliegue. El comando por defecto de la imagen, `start --migrate`, crea las
   tablas en el primer arranque y aplica las migraciones seguras en los despliegues
   posteriores.
3. Abre `https://<service>.onrender.com/admin/` y registra el primer administrador.

Render envía `SIGTERM` antes de detener una instancia; Verdin termina lo que está haciendo y
sale al recibirlo.

## Variante: medios en un disco

Para una sola instancia, puedes guardar las subidas en un disco persistente de Render en lugar
de en S3. Configura el proveedor local en `verdin.toml`:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

y añade un disco al servicio:

```yaml title="render.yaml"
    disk:
      name: verdin-data
      mountPath: /data
      sizeGB: 5
```

Con un disco, Render no te deja escalar el servicio a varias instancias, y los despliegues
detienen la instancia antigua antes de arrancar la nueva, así que cada despliegue implica una
breve interrupción del servicio. El mismo disco puede contener una base de datos SQLite
(`sqlite:///data/verdin.db`) si no quieres una base de datos de Render. Comprueba que el usuario
de la imagen (uid `65532`) puede escribir en el disco; si el arranque falla con un error de
permisos en `/data`, añade `USER root` a tu `Dockerfile`.

## Direcciones de los clientes

El proxy de Render está delante del servicio. Su rango de direcciones no se ha verificado para
esta guía, así que `[server].trusted_proxies` se deja vacío: en ese caso todos los visitantes
cuentan como la misma dirección para los límites de peticiones, así que deja
`[api].public_rate_limit` en `0` salvo que encuentres el rango del proxy y confíes en él.
