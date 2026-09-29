---
title: Referencia de la línea de comandos
description: Todos los comandos, subcomandos y opciones del binario verdin, con lo que leen, escriben e imprimen.
sidebar:
  order: 2
  label: Línea de comandos
---

<!-- Written from crates/verdin/src/cli.rs and crates/verdin/src/new.rs. `npm run check-cli`
(site/scripts/check-cli.mjs) fails when a subcommand or flag in cli.rs is missing here. -->

`verdin` es el único binario: crea proyectos, ejecuta el servidor, aplica migraciones, gestiona
los usuarios administradores y mete y saca contenido. Esta página enumera todos los comandos y
opciones.

```text title="Terminal"
verdin [OPTIONS] <COMMAND>
```

| Comando | Qué hace |
| --- | --- |
| [`verdin new`](#verdin-new) | Crea un directorio de proyecto. |
| [`verdin dev`](#verdin-dev) | Ejecuta el servidor en modo desarrollo. |
| [`verdin start`](#verdin-start) | Ejecuta el servidor en modo producción. |
| [`verdin schema check`](#verdin-schema-check) | Valida los archivos de esquema. |
| [`verdin migrate plan`](#verdin-migrate-plan) | Muestra los pasos de la migración y su SQL. |
| [`verdin migrate apply`](#verdin-migrate-apply) | Aplica los pasos de la migración. |
| [`verdin admin create`](#verdin-admin-create) | Crea un Super Admin. |
| [`verdin admin reset-password`](#verdin-admin-reset-password) | Pone la contraseña de un administrador. |
| [`verdin types`](#verdin-types) | Genera las definiciones TypeScript de la API de contenido. |
| [`verdin import strapi`](#verdin-import-strapi) | Importa una exportación de Strapi. |
| [`verdin import verdin`](#verdin-import-verdin) | Importa una exportación de Verdin. |
| [`verdin export`](#verdin-export) | Escribe el proyecto en un archivo `.tar.gz`. |
| [`verdin healthcheck`](#verdin-healthcheck) | Comprueba que responde el servidor local. |
| [`verdin secrets`](#verdin-secrets) | Imprime secretos nuevos. |
| [`verdin version`](#verdin-version) | Imprime la versión. |

## Opciones globales

| Opción | Por defecto | Descripción |
| --- | --- | --- |
| `-c, --config <CONFIG>` | `verdin.toml` | El archivo de configuración del proyecto. También se lee de `VERDIN_CONFIG`. La raíz del proyecto es el directorio del archivo: el esquema, los plugins, las subidas y las rutas relativas de SQLite se resuelven respecto a él. |
| `-h, --help` | | Imprime la ayuda del comando. |
| `-V, --version` | | Imprime la versión. |

`verdin help <COMMAND>` imprime la misma ayuda que `--help`.

Todos los comandos salvo `new`, `secrets` y `version` cargan primero el proyecto:

1. Leen el archivo `.env` que hay junto al archivo de configuración, si existe. Las variables ya
   definidas en el entorno tienen prioridad.
2. Cargan `verdin.toml` (opcional) y las sobrescrituras `VERDIN_*`. Consulta la
   [referencia de configuración](/es/reference/configuration/).
3. Empiezan a escribir logs en la salida de error estándar, con `[log]` y `RUST_LOG`.

Los comandos que abren la base de datos necesitan `VERDIN_DATABASE_URL` o `[database].url`. Los
comandos que tocan cuentas de administración o ejecutan el servidor necesitan además
`VERDIN_ADMIN_JWT_SECRET` y `VERDIN_TOKEN_PEPPER`.

## `verdin new`

```text title="Terminal"
verdin new <DIR> [--database <DATABASE>]
```

Crea un proyecto en `DIR`, que no debe existir o debe estar vacío:

| Archivo | Contenido |
| --- | --- |
| `verdin.toml` | `[server]`, `[api]` y `[admin]` con sus valores por defecto. |
| `.env` | `VERDIN_DATABASE_URL`, y un `VERDIN_ADMIN_JWT_SECRET` y un `VERDIN_TOKEN_PEPPER` nuevos. Solo lo puedes leer tú (modo `0600` en Unix). |
| `.gitignore` | `.env`, `data/`, los archivos SQLite y `.cache/`. |
| `schema/content-types/`, `schema/components/` | Directorios de esquema vacíos. |
| `data/` | Para la base de datos SQLite (solo con SQLite). |

| Argumento u opción | Por defecto | Descripción |
| --- | --- | --- |
| `<DIR>` | | Directorio que se crea. |
| `--database <DATABASE>` | `sqlite` | Base de datos a la que apunta el `.env`: `sqlite`, `postgres`, `mysql` o `mariadb`. |

Con `sqlite`, la URL es `sqlite://data/verdin.db`. Con las demás es la URL de un servidor local
con el usuario `verdin`, la contraseña `change-me` y una base de datos con el nombre del
directorio (letras minúsculas, dígitos y `_`): edítala antes de arrancar.

```text title="Terminal"
$ verdin new blog --database postgres
created blog

  cd blog
  verdin dev

then open http://localhost:1337/admin/ to register the first admin
```

## `verdin dev`

```text title="Terminal"
verdin dev
```

Ejecuta el servidor en modo desarrollo. En comparación con `verdin start`:

- Las migraciones pendientes con nivel de riesgo `safe` se aplican al arrancar. Los pasos más
  arriesgados detienen el servidor; revísalos con [`verdin migrate plan`](#verdin-migrate-plan).
- El **Constructor de tipos de contenido** del panel edita los archivos de esquema y el servidor
  recarga el esquema.
- La cookie de refresco no se marca como `Secure` (salvo que `[admin].secure_cookies` lo
  indique), así que puedes iniciar sesión sobre HTTP sin cifrar.
- Los webhooks y los objetivos de despliegue pueden llamar a direcciones de loopback y privadas
  (salvo que `[webhooks].allow_private_networks` indique lo contrario).

Se detiene con Ctrl+C o `SIGTERM`.

## `verdin start`

```text title="Terminal"
verdin start [--migrate]
```

Ejecuta el servidor en modo producción. Se niega a arrancar cuando la base de datos no está al
día con el esquema, para que un despliegue nunca cambie tablas que no hayas revisado.

| Opción | Descripción |
| --- | --- |
| `--migrate` | Aplica los pasos de migración `safe` pendientes antes de arrancar. Los pasos arriesgados y destructivos siguen necesitando `verdin migrate apply`. |

Antes de escuchar, comprueba la configuración (que `[api].prefix` y `[admin].path` tengan la
forma de `/api`, que los tamaños de página sean coherentes y que `[server].trusted_proxies` y
`[api].cors_origins` se puedan interpretar) y crea los roles predefinidos. Registra un aviso
cuando `[admin].secure_cookies` es `false` o `[email].provider` es `log`. Cuando todavía no hay
ningún administrador, registra la dirección del panel de administración, donde el primer
visitante registra el primer Super Admin.

Se detiene con Ctrl+C o `SIGTERM`.

## `verdin schema check`

```text title="Terminal"
verdin schema check
```

Valida los archivos de esquema (`[schema].path`) sin tocar la base de datos. Imprime un resumen,
o falla con los errores, cada uno con su archivo y la ruta del atributo:

```text title="Terminal"
$ verdin schema check
schema ok: 4 content types, 3 components
```

Úsalo en la CI antes de un despliegue. Consulta [Tipos de atributo](/es/reference/attribute-types/)
para ver qué acepta cada atributo.

## `verdin migrate plan`

```text title="Terminal"
verdin migrate plan [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Compara la base de datos con el esquema e imprime lo que haría `verdin migrate apply`, sin
cambiar nada: pasos numerados, cada uno con su nivel de riesgo y su SQL. Imprime
`database is up to date` cuando no hay nada que hacer.

| Opción | Descripción |
| --- | --- |
| `--rename-table <OLD=NEW>` | Trata la tabla `OLD` como renombrada a `NEW` (conserva sus filas) en lugar de eliminar una y crear la otra. Se puede repetir. |
| `--rename-column <TABLE.OLD=NEW>` | Trata la columna `OLD` de `TABLE` como renombrada a `NEW` (conserva sus valores). `TABLE` es el nombre nuevo de la tabla. Se puede repetir. |

Niveles de riesgo:

| Nivel | Significado |
| --- | --- |
| `safe` | No puede perder datos ni fallar con las filas existentes: tablas nuevas, columnas nuevas que admiten nulos o tienen valor por defecto, renombrados, índices no únicos. |
| `risky` | Puede fallar con las filas existentes o convertir valores: cambios de tipo de columna, columnas nuevas que no admiten nulos y no tienen valor por defecto, índices únicos en tablas existentes. |
| `destructive` | Elimina columnas o tablas. |

Cuando un paso supera `safe`, el plan termina con la opción que necesita
(`requires: verdin migrate apply --allow risky`). Cuando una columna o tabla eliminada parece
una renombrada, enumera las opciones de renombrado que hay que pasar. Cuando una migración
anterior se interrumpió, muestra cuántos pasos se aplicaron y el último error.

```text title="Terminal"
verdin migrate plan --rename-column articles.summary=excerpt
```

Consulta [Migraciones de esquema](/es/concepts/schema-migrations/).

## `verdin migrate apply`

```text title="Terminal"
verdin migrate apply [--allow <ALLOW>] [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Aplica el plan. Acepta las mismas opciones de renombrado que `verdin migrate plan`; pasa las
mismas que revisaste.

| Opción | Por defecto | Descripción |
| --- | --- | --- |
| `--allow <ALLOW>` | `safe` | Nivel de riesgo máximo que se aplica: `safe`, `risky` o `destructive`. Un plan con un paso por encima se rechaza antes de ejecutar nada. |
| `--rename-table <OLD=NEW>` | | Como en `verdin migrate plan`. |
| `--rename-column <TABLE.OLD=NEW>` | | Como en `verdin migrate plan`. |

Imprime `applied N steps`, o `database is up to date`. Tras una interrupción (una conexión
perdida, un paso que falló), corrige la causa y vuelve a ejecutarlo: se reanuda en el paso que no
se completó.

## `verdin admin create`

```text title="Terminal"
verdin admin create --email <EMAIL>
```

Crea un Super Admin. La contraseña se lee de `VERDIN_ADMIN_PASSWORD`, o de la entrada estándar si
no está definida. La base de datos debe estar al día con el esquema.

| Opción | Descripción |
| --- | --- |
| `--email <EMAIL>` | La dirección de correo del nuevo administrador. |

```text title="Terminal"
$ VERDIN_ADMIN_PASSWORD='a long passphrase' verdin admin create --email ada@example.com
created Super Admin ada@example.com (id 1)
```

Úsalo para crear el primer administrador de un servidor que todavía no es accesible desde un
navegador; si no, lo registra el primer visitante del panel de administración.

## `verdin admin reset-password`

```text title="Terminal"
verdin admin reset-password --email <EMAIL>
```

Pone la contraseña de un administrador, desbloquea la cuenta tras los inicios de sesión fallidos
y cierra todas sus sesiones. La contraseña se lee igual que en `verdin admin create`.

| Opción | Descripción |
| --- | --- |
| `--email <EMAIL>` | La dirección de correo del administrador. |

No quita los segundos factores; un administrador con **Gestionar usuarios** puede restablecerlos
en **Configuración → Usuarios**.

## `verdin types`

```text title="Terminal"
verdin types [-o <OUT>]
```

Genera las definiciones TypeScript de la API de contenido (una interfaz por tipo de contenido y
por componente) a partir del esquema, y las imprime en la salida estándar. No necesita la base de
datos.

| Opción | Descripción |
| --- | --- |
| `-o, --out <OUT>` | Escribe en este archivo. |

```text title="Terminal"
verdin types --out ../web/src/verdin.d.ts
```

Consulta [Cliente tipado](/es/guides/frontend/typed-client/).

## `verdin import strapi`

```text title="Terminal"
verdin import strapi <PATH> [--schema-only] [--force]
```

Importa un proyecto de Strapi v4 o v5 a partir de una exportación hecha con
`strapi export --no-encrypt`: un `.tar.gz`, un `.tar` o un directorio descomprimido. Escribe los
tipos de contenido y los componentes como archivos de esquema y después importa las entradas,
los idiomas, los medios, las relaciones y las carpetas.

| Argumento u opción | Descripción |
| --- | --- |
| `<PATH>` | El archivo o el directorio de la exportación. |
| `--schema-only` | Solo escribe los archivos de esquema. |
| `--force` | Sobrescribe los archivos de esquema existentes e importa en tipos de contenido que ya tienen entradas. |

Imprime lo que ha escrito e importado, con avisos de lo que no ha podido trasladar, y escribe
`strapi-id-map.json` en la raíz del proyecto: los ids de Strapi y sus nuevos `documentId`s e ids
de archivo de Verdin, para corregir los enlaces de tu frontend.

Consulta [Migrar desde Strapi](/es/migrate/from-strapi/).

## `verdin import verdin`

```text title="Terminal"
verdin import verdin <PATH> [--force]
```

Importa un archivo escrito por `verdin export`: archivos de esquema, idiomas, medios y entradas.

| Argumento u opción | Descripción |
| --- | --- |
| `<PATH>` | El archivo `.tar.gz`. |
| `--force` | Sobrescribe los archivos de esquema que difieren e importa en tipos de contenido que ya tienen entradas. |

## `verdin export`

```text title="Terminal"
verdin export <OUTPUT> [--no-media]
```

Escribe el esquema, el contenido y los medios del proyecto en un archivo `.tar.gz`: una copia de
seguridad, o una forma de trasladar un proyecto a otra instancia con `verdin import verdin`. El
archivo contiene todas las versiones de todas las entradas (borradores, versiones publicadas,
idiomas) con sus relaciones. No incluye las cuentas de administración, los tokens de API ni los
ajustes.

| Argumento u opción | Descripción |
| --- | --- |
| `<OUTPUT>` | El archivo que se escribe. |
| `--no-media` | Deja fuera la biblioteca de medios: los archivos, las carpetas y los enlaces de las entradas hacia ellos. |

```text title="Terminal"
$ verdin export backup.tar.gz
exported to backup.tar.gz: 42 documents (57 versions), 18 files, 3 folders, 2 locales
```

Consulta [Copias de seguridad](/es/deploy/backups/).

## `verdin healthcheck`

```text title="Terminal"
verdin healthcheck [--port <PORT>]
```

Pide `GET /_health` al servidor de esta máquina (`127.0.0.1`, el `[server].port` de la
configuración) y termina con el estado 0 cuando responde `200`, o 1 en caso contrario, indicando
el motivo. No necesita shell, `curl` ni cliente HTTP, así que la imagen de Docker lo usa como su
`HEALTHCHECK`; úsalo de la misma forma en Compose o en cualquier supervisor que ejecute un
comando.

| Opción | Descripción |
| --- | --- |
| `--port <PORT>` | Comprueba este puerto en lugar de `[server].port`. |

```text title="Terminal"
$ verdin healthcheck
ok
```

Consulta [Monitorización](/es/deploy/monitoring/).

## `verdin secrets`

```text title="Terminal"
verdin secrets
```

Imprime un `VERDIN_ADMIN_JWT_SECRET` y un `VERDIN_TOKEN_PEPPER` nuevos, listos para un archivo
`.env` o para el almacén de secretos de tu plataforma. No lee ningún proyecto.

Cambiar `VERDIN_ADMIN_JWT_SECRET` invalida los tokens de acceso de vida corta de los
administradores y de los usuarios finales, los enlaces de vista previa abiertos y los inicios de
sesión OAuth en curso; el panel de administración y los clientes que usan tokens de renovación
obtienen otros nuevos por sí solos. Cambiar `VERDIN_TOKEN_PEPPER` invalida los tokens guardados
(entre ellos los tokens de API), así que consérvalo una vez en uso.

## `verdin version`

```text title="Terminal"
verdin version
```

Imprime `verdin` y la versión, igual que `verdin --version`.
