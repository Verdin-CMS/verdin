---
title: Railway
description: Despliega Verdin en Railway a partir del Dockerfile de tu repositorio, con PostgreSQL de Railway y los medios en un almacenamiento compatible con S3 o en un volumen.
sidebar:
  order: 6
---

Esta página despliega un proyecto de Verdin en [Railway](https://railway.com): un servicio
construido a partir de un Dockerfile pequeño en tu repositorio, una base de datos PostgreSQL de
Railway y los medios en un almacenamiento compatible con S3 (o en un volumen para una sola
instancia).

:::note
Los ajustes de Railway se han comprobado con la [documentación de Railway](https://docs.railway.com/reference/config-as-code)
el 2026-09-29; la configuración no se ha desplegado en una cuenta real de Railway. Los valores
marcados con `# yours` o entre signos de menor y mayor los tienes que rellenar tú.
:::

## 1. Añade un Dockerfile, una configuración y `railway.json`

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

No hace falta ningún comando de arranque: la imagen ejecuta `start --migrate`, que aplica las
migraciones seguras antes de empezar a servir. Deja `.env` fuera del repositorio.

## 2. Crea el proyecto

1. En Railway, crea un proyecto a partir de tu repositorio de GitHub. Railway encuentra
   `railway.json` y construye el Dockerfile.
2. Añade una base de datos **PostgreSQL** al proyecto.
3. En las **Variables** del servicio de Verdin, añade:

   | Variable | Valor |
   | --- | --- |
   | `VERDIN_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (la URL privada del servicio de base de datos; usa el nombre de tu servicio de base de datos) |
   | `VERDIN_ADMIN_JWT_SECRET` | de `verdin secrets` |
   | `VERDIN_TOKEN_PEPPER` | de `verdin secrets` |
   | `VERDIN_SERVER__PUBLIC_URL` | `https://<your-domain>` |
   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | tus credenciales de S3 |

   Genera los dos secretos en local:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets
   ```

4. En los ajustes de red del servicio, haz clic en **Generate Domain** y pon `1337` como puerto
   de destino. Verdin escucha en `[server].port` y no lee la variable `PORT` de Railway.
5. Despliega, abre `https://<your-domain>/admin/` y registra el primer administrador.

## Variante: medios o SQLite en un volumen

Para una sola instancia, puedes guardar las subidas, e incluso la base de datos, en un volumen
de Railway montado en `/data`:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

con `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` si prescindes de PostgreSQL. Ten en cuenta
que:

- Un servicio con volumen no puede tener réplicas, y cada nuevo despliegue implica una breve
  interrupción del servicio.
- Railway monta los volúmenes con root como propietario, y la imagen se ejecuta con el uid
  `65532`. Define la variable de servicio `RAILWAY_RUN_UID=0` para que el servidor pueda
  escribir en el volumen.

## Direcciones de los clientes

El proxy del edge de Railway está delante del servicio. Su rango de direcciones no se ha
verificado para esta guía, así que `[server].trusted_proxies` se queda vacío: en ese caso todos
los visitantes cuentan como la misma dirección para los límites de peticiones, así que deja
`[api].public_rate_limit` en `0` salvo que encuentres el rango del proxy y confíes en él.
