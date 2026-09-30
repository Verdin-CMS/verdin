---
title: Docker Compose en producción
description: Una receta de Compose para producción en un solo servidor — Verdin, PostgreSQL y Caddy con HTTPS automático, y RustFS opcional para medios compatibles con S3.
sidebar:
  order: 3
---

[`deploy/compose/`](https://github.com/verdin-cms/verdin/tree/main/deploy/compose) es una
configuración lista para un solo servidor: Verdin y PostgreSQL en una red privada, y Caddy
delante con un certificado que obtiene y renueva por sí mismo. Un archivo de sobrescritura añade
RustFS, un almacén compatible con S3 en el mismo host, para los medios.
[Docker](/es/deploy/docker/) explica la imagen que usan estos archivos.

Los archivos se comprobaron con `docker compose config` y `caddy validate` el 2026-09-30.

## Archivos

| Archivo | Qué es |
| --- | --- |
| `compose.yaml` | `verdin`, `db` (PostgreSQL 17) y `caddy`. Solo Caddy publica puertos (80, 443 y 443/udp para HTTP/3). |
| `compose.s3.yaml` | Añade `rustfs` y un trabajo de una sola ejecución que crea el bucket `media` de lectura pública, y cambia a él el proveedor de subidas de Verdin. |
| `Caddyfile` | TLS para `$VERDIN_DOMAIN`, compresión, `/media/*` a RustFS y todo lo demás a Verdin. |
| `.env.example` | Las variables que lee Compose: dominio, correo de ACME, etiqueta de la imagen, contraseñas. |

## Configúralo

Requisitos previos: un servidor con Docker, un registro DNS de tu dominio que apunte a él, y los
puertos 80 y 443 abiertos.

1. Copia el directorio al servidor y rellena `.env`:

   ```sh frame="terminal"
   cp .env.example .env                                  # VERDIN_DOMAIN, ACME_EMAIL
   echo "DB_PASSWORD=$(openssl rand -hex 24)" >> .env
   docker run --rm ghcr.io/verdin-cms/verdin:0.11 secrets > verdin.env
   ```

2. Pon tu esquema confirmado en `schema/` (`content-types/` y `components/`). Se monta en solo
   lectura en `/app/schema`.
3. Arráncalo:

   ```sh frame="terminal"
   docker compose up -d
   docker compose logs -f verdin
   ```

4. Abre `https://<tu dominio>/admin/` y registra al primer administrador.

Mantén `.env` y `verdin.env` fuera del control de versiones, y haz copias de seguridad: un
`VERDIN_TOKEN_PEPPER` nuevo invalida todos los tokens de API.

## Medios en S3

Por defecto las subidas van al volumen `verdin-data`. Para guardarlas en RustFS:

```sh frame="terminal"
echo "S3_SECRET_KEY=$(openssl rand -hex 24)" >> .env
docker compose -f compose.yaml -f compose.s3.yaml up -d
```

Caddy sirve entonces los archivos en `https://<tu dominio>/media/<key>`. Para AWS S3,
Cloudflare R2 u otro proveedor, deja fuera los servicios de RustFS y pon las variables
`VERDIN_UPLOAD__PROVIDER__*` y las credenciales `AWS_*` con los valores de ese proveedor
(consulta [Almacenamiento](/es/internals/storage/)). Cambiar un sitio existente no mueve ningún
archivo: las subidas nuevas van al nuevo proveedor.

## Notas

- **Direcciones de los clientes.** Verdin confía en `X-Forwarded-For` de la red de Compose
  (`172.30.0.0/24`, fija en `compose.yaml`), donde Caddy es el único proxy. Cambia ambos si ese
  rango choca con alguna de tus redes.
- **Tiempo real.** Caddy transmite las respuestas `text/event-stream` sin almacenarlas en
  búfer, así que los [eventos en tiempo real](/es/guides/frontend/realtime/) funcionan detrás de
  él sin cambios.
- **Actualizaciones.** Cambia `VERDIN_VERSION` en `.env`, y después
  `docker compose pull && docker compose up -d`. Lee antes [Actualizar](/es/migrate/upgrading/).
- **Copias de seguridad.** Vuelca PostgreSQL y conserva el volumen `verdin-data` (o el bucket);
  consulta [Copias de seguridad](/es/deploy/backups/).
- **Comandos de administración.** La imagen no tiene shell:
  `docker compose exec verdin verdin admin create --email you@example.com`.
