---
title: Copias de seguridad
description: Haz copias de seguridad de un proyecto de Verdin con volcados de la base de datos y copias del almacenamiento de medios, o trasládalo con verdin export y verdin import verdin.
sidebar:
  order: 9
---

Los datos de un proyecto de Verdin están en dos sitios: la **base de datos** (contenido,
administradores, roles, tokens, ajustes, historial, registros de auditoría) y el
**almacenamiento de medios** (los archivos de la biblioteca de medios, en disco o en un
bucket). Los archivos de esquema están en tu repositorio. Haz copia de los dos almacenes;
`verdin export` añade un archivo comprimido portable del contenido.

| Método | Contiene | Para qué sirve |
| --- | --- | --- |
| Volcado de la base de datos + copia de los medios | Todo | Recuperación ante desastres del mismo proyecto |
| `verdin export` | Esquema, idiomas, medios, todas las versiones de todas las entradas | Trasladar el contenido a otra instancia o a otro motor de base de datos; una copia adicional y portable |

## Volcados de la base de datos

Usa las herramientas de tu propia base de datos, o las copias automáticas de tu proveedor:

```sh frame="terminal"
# PostgreSQL
pg_dump --format=custom --file=verdin-$(date +%F).dump "$VERDIN_DATABASE_URL"

# MySQL / MariaDB
mysqldump --single-transaction --routines -h <host> -u <user> -p <database> > verdin-$(date +%F).sql

# SQLite: una copia consistente mientras el servidor está en marcha
sqlite3 /data/verdin.db ".backup '/backups/verdin-$(date +%F).db'"
```

No copies con `cp` un archivo SQLite en uso: usa `.backup` (o detén antes el servidor).

Un volcado contiene hashes de contraseñas, hashes de tokens de API y campos privados.
Cífralo y guárdalo lejos de los servidores que protege. Para restaurarlo también necesitas
los mismos `VERDIN_TOKEN_PEPPER` y `VERDIN_ADMIN_JWT_SECRET`: sin el pepper, los tokens de
API y los códigos de las apps de autenticación de los administradores dejan de funcionar.

## Almacenamiento de medios

- **Proveedor local**: copia el directorio de subidas (`[upload].provider.dir`,
  `/data/uploads` en la imagen de Docker) con tu copia de seguridad de archivos habitual,
  después del volcado de la base de datos, para que no falte ningún archivo al que haga
  referencia el volcado.
- **Proveedor S3**: activa el versionado o la replicación en el bucket, o cópialo con las
  herramientas de tu proveedor.

La caché de transformación de imágenes y el índice de búsqueda se pueden reconstruir y no
necesitan copia.

## `verdin export`

`verdin export` escribe el esquema, el contenido y los medios de un proyecto en un único
`.tar.gz`, y `verdin import verdin` lo restaura en el mismo proyecto o en otra instancia, con
cualquier motor de base de datos.

```sh frame="terminal"
verdin export backup-2026-09-28.tar.gz            # esquema, idiomas, medios y entradas
verdin export content-only.tar.gz --no-media      # sin archivos de medios
verdin import verdin backup-2026-09-28.tar.gz     # en este proyecto
```

Ejecútalos con la configuración del proyecto (el mismo `verdin.toml` y el mismo entorno que
el servidor). En un contenedor: `docker compose exec verdin verdin export /data/backup.tar.gz`.

### Qué incluye

- **Archivos de esquema**, tal cual.
- **Idiomas.** Un proyecto vacío los recibe todos, incluido el idioma por defecto. Un
  proyecto que ya tiene idiomas solo recibe los que le faltan.
- **Carpetas y archivos de medios**, con sus formatos responsive. Los archivos conservan su
  `documentId`; sus ids numéricos cambian.
- **Todas las versiones de todas las entradas**: borradores, versiones publicadas y todos
  los idiomas, con sus fechas, relaciones (por `documentId`) y medios, incluidos las
  relaciones y los medios dentro de componentes y zonas dinámicas. Se incluyen los campos
  privados y los hashes de contraseñas.

**No incluye**: usuarios administradores, roles, tokens de API, webhooks, ajustes de las
funcionalidades, flujos de revisión ni lanzamientos. Vuelve a crearlos en el destino, o
restaura un volcado de la base de datos en su lugar.

:::caution
Una exportación contiene campos privados y hashes de contraseñas. Guárdala como un volcado de
la base de datos.
:::

### Importación

1. La importación escribe los archivos de esquema y migra la base de datos solo con pasos
   seguros.
2. Si ya existen archivos de esquema distintos, se detiene, salvo que pases `--force`.
3. Si hay tipos de contenido que ya tienen entradas, también se detiene, salvo que pases
   `--force`; en ese caso las entradas se añaden junto a las existentes.
4. Los documentos importados conservan su `documentId`, así que importar en un proyecto que
   ya tiene los mismos documentos falla.

La importación no dispara webhooks ni hooks de plugins, y no escribe historial.

### Formato del archivo

Un archivo tar comprimido con gzip:

| Ruta | Contenido |
| --- | --- |
| `manifest.json` | `format: "verdin-export"`, versión del formato, versión de Verdin, versiones por tipo de contenido |
| `schema/…` | Los archivos de esquema |
| `locales.json` | `{ default, locales: [{ code, name }] }` |
| `folders.json`, `files.jsonl` | Carpetas y archivos de medios, un objeto JSON por línea |
| `assets/{hash}{ext}` | Los objetos almacenados de los archivos y de sus formatos |
| `entries/{uid}.jsonl` | Una versión por línea: `documentId`, `locale`, `published`, fechas, `data`, `relations`, `media` |

Para traer un proyecto de Strapi, consulta [Migrar desde Strapi](/es/migrate/from-strapi/).

## Prueba tus restauraciones

De vez en cuando, restaura en una base de datos de pruebas, arranca Verdin sobre ella con
`verdin start` y comprueba que puedes iniciar sesión y leer entradas y medios.
