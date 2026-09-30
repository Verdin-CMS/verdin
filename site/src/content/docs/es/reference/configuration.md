---
title: Referencia de configuración
description: Todas las secciones y claves de verdin.toml, con sus valores por defecto, y las variables de entorno que lee Verdin.
sidebar:
  order: 1
  label: Configuración
---

<!-- Written from crates/verdin/src/config.rs, crates/verdin-upload/src/config.rs and
crates/verdin-email/src/lib.rs, crates/verdin-upload/src/transform.rs,
crates/verdin-search/src/lib.rs, crates/verdin-api/src/cdn.rs, crates/verdin-api/src/ai.rs
and crates/verdin/src/telemetry.rs.
Keep it in step when keys change. -->

La configuración va por capas: **valores por defecto integrados ← `verdin.toml` ← entorno**. El
archivo es opcional; todas las claves tienen un valor por defecto. Las claves desconocidas se
rechazan, así que una errata falla al arrancar en lugar de ignorarse.

- Sobrescribe cualquier clave con `VERDIN_<SECTION>__<KEY>` (dos guiones bajos), por ejemplo
  `VERDIN_SERVER__PORT=8080` o `VERDIN_ADMIN__SECURE_COOKIES=false`. Las tablas anidadas llevan
  un `__` más: `VERDIN_ADMIN__BRANDING__TITLE=ACME`. Aquí también se rechazan las claves
  desconocidas, así que cualquier variable que empiece por `VERDIN_` y contenga `__` debe nombrar
  una clave real.
- `VERDIN_DATABASE_URL` es una forma abreviada de `database.url`.
- El archivo es `verdin.toml` en el directorio de trabajo, o la ruta indicada con
  `-c, --config` o `VERDIN_CONFIG`. Las rutas relativas que contiene (esquema, plugins, subidas,
  archivos SQLite) se resuelven respecto al directorio del archivo.
- Primero se carga un archivo `.env` que esté junto a la configuración; las variables ya
  definidas en el entorno tienen prioridad.

Los secretos nunca se leen de `verdin.toml`; consulta
[Variables de entorno](#variables-de-entorno).

## `[server]`

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `host` | `"0.0.0.0"` | Dirección en la que escuchar. |
| `port` | `1337` | Puerto en el que escuchar. |
| `public_url` | sin definir | Dónde llegan los navegadores al servidor, p. ej. `"https://cms.example.com"`. Se usa para los enlaces de los correos y los callbacks de SSO; por defecto `http://localhost:{port}`. |
| `body_limit` | `"1mb"` | Cuerpo máximo de las peticiones normales a la API (las subidas tienen su propio límite). Un número de bytes o una cadena con `b`, `kb`, `mb` o `gb`. |
| `request_timeout_secs` | `30` | Tiempo máximo de las peticiones normales a la API. |
| `sync_interval_secs` | `10` | Cada cuánto se recogen los ajustes que han cambiado otras instancias (funcionalidades, interruptores de plugins, idiomas, flujos de revisión); `0` lo desactiva (una sola instancia). |
| `trusted_proxies` | `[]` | Proxies inversos (IPs o rangos CIDR, p. ej. `["10.0.0.0/8"]`) cuyo `X-Forwarded-For` identifica al cliente. Los límites de peticiones y los registros de auditoría usan esa dirección; sin él, todos los clientes detrás del proxy comparten una. |

## `[database]`

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `url` | sin definir | URL de conexión: `postgres://…`, `mysql://…` (MySQL y MariaDB) o `sqlite://…`. Obligatoria; normalmente se define con `VERDIN_DATABASE_URL`. |
| `pool_max` | `10` | Número máximo de conexiones del pool. |

## `[schema]`

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `path` | `"schema"` | Directorio del esquema, relativo al archivo de configuración. |

## `[api]`

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `prefix` | `"/api"` | Ruta bajo la que se sirve la API de contenido. Debe empezar por `/` y no terminar en `/`. |
| `default_page_size` | `25` | Tamaño de página cuando la petición no indica ninguno. Entre 1 y `max_page_size`. |
| `max_page_size` | `100` | Tamaño de página máximo que puede pedir una petición. |
| `decimal_as_string` | `false` | Serializa los decimales como cadenas (exactas) en lugar de como números (compatible con Strapi). |
| `public_rate_limit` | `0` | Peticiones por minuto e IP de cliente sin token (`0`: sin límite). |
| `token_rate_limit` | `0` | Peticiones por minuto y token de API o usuario final (`0`: sin límite). |
| `cache_ttl_secs` | `0` | Tiempo que se conservan en memoria las lecturas anónimas (`0`: sin caché); los cambios vacían la caché. |
| `cache_entries` | `1000` | Número máximo de respuestas cacheadas. |
| `cors_origins` | `[]` | Orígenes de navegador autorizados a llamar a la API de contenido y a GraphQL desde otro sitio (`["https://www.example.com"]`: esquema, host y puerto, sin ruta), o `["*"]` para cualquiera (solo: `*` no se puede combinar con orígenes). Vacío: solo las páginas del mismo origen pueden llamarlas desde un navegador. La API de administración nunca acepta llamadas de otro origen. |

## `[admin]`

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `path` | `"/admin"` | Ruta bajo la que se sirve el panel de administración; su API vive en `{path}/api`. |
| `secure_cookies` | sin definir | Marca la cookie de refresco como `Secure`. Sin definir significa sí en `verdin start` y no en `verdin dev` (desarrollo local sobre HTTP sin cifrar). |
| `auth_rate_limit` | `20` | Intentos de inicio de sesión, registro y refresco por IP de cliente y minuto. |
| `assets_dir` | sin definir | Sirve el panel de administración desde este directorio (relativo al archivo de configuración) en lugar de la copia incrustada en el binario. |

### `[admin.branding]`

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `title` | `"Verdin"` | Se muestra en la barra lateral, en la página de inicio de sesión y en la pestaña del navegador. |
| `logo` | sin definir | Archivo de imagen (SVG, PNG, WebP), relativo al archivo de configuración. |
| `favicon` | sin definir | Archivo de icono (ICO, PNG, SVG), relativo al archivo de configuración. |
| `accent` | sin definir | Color `#rrggbb` de los botones, los enlaces y los anillos de foco. |
| `translations` | `{}` | Textos del panel sustituidos por idioma, por ejemplo `[admin.branding.translations.en]` con `"auth.login.title" = "Welcome to ACME"`. Las claves son las de `admin/public/i18n/en.json`. |

## `[upload]`

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `provider` | `{ name = "local", dir = "public/uploads" }` | Dónde se guardan los archivos; consulta más abajo. |
| `max_file_size` | `209715200` | Archivo máximo aceptado, en bytes (200 MB). |
| `responsive_formats` | `true` | Genera formatos responsive para las imágenes rasterizadas. |
| `breakpoints` | large 1000, medium 750, small 500 | Formatos responsive como tablas `{ name, width }` (los `breakpoints` de Strapi). Los formatos más anchos que la imagen se omiten. |
| `max_image_megapixels` | `100` | Límite de decodificación contra las bombas de descompresión, en megapíxeles. |
| `max_original_size` | sin definir | Los originales rasterizados más grandes que este número de píxeles (en cualquier lado) se reducen al subirlos, lo que también elimina sus metadatos (EXIF, GPS). Sin definir, los originales se conservan tal como se envían. |

```toml
[upload]
breakpoints = [{ name = "large", width = 1000 }, { name = "small", width = 500 }]
```

### Proveedor local

Archivos en `dir` (relativo al proyecto), servidos por Verdin en `/uploads`.

```toml
[upload]
provider = { name = "local", dir = "public/uploads" }
```

### `[upload.transforms]`

Transformaciones de imágenes de los archivos locales: `/uploads/<file>?preset=thumb`, o
`?w=&h=&fit=&format=&q=` con una firma. Las versiones generadas se cachean en disco y se
descartan cuando cambia el archivo (incluido su punto focal). Los recortes cover mantienen a la
vista el punto focal del archivo; las imágenes nunca se amplían. Se pueden transformar JPEG, PNG,
WebP, TIFF y BMP (no los GIF, que pueden estar animados).

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `enabled` | `true` | Sirve las transformaciones. |
| `presets` | `{}` | Transformaciones con nombre, siempre permitidas: `{ w, h, fit, format, q }`. |
| `allow_arbitrary` | `false` | Acepta cualquier parámetro sin firma. Cada URL distinta se genera y se cachea, así que solo para redes de confianza. |
| `max_size` | `4096` | `w` o `h` máximos, en píxeles. |
| `cache_dir` | `".cache/transforms"` | Dónde se guardan las versiones generadas (relativo al proyecto; se puede borrar sin problema). |

Parámetros: `w`, `h` (píxeles), `fit` (`cover`, por defecto, recorta al recuadro; `inside` encaja
dentro de él; `fill` estira), `format` (`jpeg`, `png`, `webp`; la salida WebP es sin pérdida) y
`q` (calidad JPEG, 1–100, por defecto 80).

```toml
[upload.transforms.presets]
thumb = { w = 300, h = 300 }
hero = { w = 1600, h = 600, format = "webp" }
```

**URLs firmadas.** Con `VERDIN_IMAGE_SECRET` definido, `s` es el HMAC-SHA256 en hexadecimal de
`<file>?<canonical query>`, donde la query canónica enumera los parámetros que no tienen el valor
por defecto ordenados por nombre (`fit`, `format`, `h`, `q`, `w`; se omite `fit=cover`):

```js
import { createHmac } from 'node:crypto';
const s = createHmac('sha256', process.env.VERDIN_IMAGE_SECRET)
  .update('photo_1a2b.jpg?format=webp&w=800')
  .digest('hex');
const url = `/uploads/photo_1a2b.jpg?format=webp&w=800&s=${s}`;
```

### Proveedor S3

Cualquier servicio compatible con S3 (AWS, Cloudflare R2, MinIO, Backblaze B2…). Las credenciales
se leen de las variables de entorno estándar `AWS_*` (`AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`).

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `bucket` | obligatoria | Nombre del bucket. |
| `region` | sin definir | Región del bucket. |
| `endpoint` | sin definir | Endpoint propio para servicios que no son AWS, p. ej. `https://<account>.r2.cloudflarestorage.com`. |
| `public_url` | obligatoria | URL base pública del bucket o de su CDN; los archivos se enlazan como `{public_url}/{key}`. |
| `prefix` | `""` | Prefijo de las claves dentro del bucket. |
| `path_style` | `false` | Peticiones de estilo path (MinIO y la mayoría de los servicios autoalojados). |

```toml
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

## `[webhooks]`

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `allow_private_networks` | sin definir | Permite URLs de webhooks en direcciones de loopback, privadas y de enlace local; se aplica también a los objetivos de despliegue y al webhook de `[cdn]`. Sin definir significa no en `verdin start` (si no, un administrador podría llegar a servicios internos) y sí en `verdin dev`. |
| `timeout_secs` | `10` | Tiempo máximo de cada envío. |
| `retention_days` | `30` | Días que se conserva el registro de envíos. |

Consulta [Webhooks](/es/guides/integrations/webhooks/).

## `[history]`

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `max_versions` | `50` | Versiones que se conservan por documento (las más antiguas se eliminan). |

## `[email]`

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `provider` | `"log"` | `log` (escribe los correos en el log), `smtp`, `resend` o `postmark`. |
| `from` | `"Verdin <no-reply@localhost>"` | Remitente. |
| `reply_to` | sin definir | Dirección de respuesta. |

### `[email.smtp]`

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `host` | `"localhost"` | Servidor SMTP. |
| `port` | `587` | Puerto SMTP. |
| `username` | sin definir | Usuario SMTP; la contraseña se lee de `VERDIN_EMAIL_SMTP_PASSWORD`. |
| `security` | `"starttls"` | `starttls`, `tls` (implícito, normalmente en el puerto 465) o `none` (relays locales). |

## `[plugins]`

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `path` | `"plugins"` | Directorio de los plugins (un subdirectorio por plugin), relativo al archivo de configuración. |
| `run_jobs` | `true` | Ejecuta en esta instancia las tareas programadas de los plugins (en una sola instancia cuando hay varias). |

Consulta [Plugins](/es/extending/plugins/).

## `[audit]`

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `retention_days` | `90` | Días que se conservan las entradas del registro de auditoría. |

## `[digest]`

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `enabled` | `true` | Envía el resumen diario desde esta instancia (desde una sola cuando hay varias). |
| `hour_utc` | `8` | Hora (UTC, 0–23) a la que sale el resumen diario de novedades. |

## `[log]`

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `format` | `"pretty"` | `pretty` o `json`. |
| `level` | sin definir (`info`) | Filtro por defecto; `RUST_LOG` tiene prioridad si está definida. |

## `[metrics]`

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `enabled` | `false` | Sirve métricas de Prometheus en `/_metrics`: peticiones HTTP por área (`api`, `admin_api`, `graphql`, `mcp`, `uploads`…), método y clase de estado con histogramas de latencia, envíos de webhooks pendientes, flujos en tiempo real abiertos, tráfico del bus de eventos y tiempo en marcha. |
| `token` | sin definir | Los scrapes necesitan `Authorization: Bearer <token>`. `VERDIN_METRICS_TOKEN` tiene prioridad sobre él. Sin token, cualquiera que llegue al puerto puede leer las métricas. |

## `[telemetry]`

Trazas e informes de errores, ambos desactivados por defecto y usados solo por `verdin start` y
`verdin dev` (consulta [Monitorización](/es/deploy/monitoring/#trazas-opentelemetry)).

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `enabled` | `false` | Exporta trazas de OpenTelemetry de las peticiones HTTP y sus consultas a la base de datos mediante OTLP/HTTP (protobuf). `OTEL_SDK_DISABLED=true` lo desactiva. |
| `endpoint` | sin definir (`http://localhost:4318`) | URL base del colector; se le añade `/v1/traces`. `OTEL_EXPORTER_OTLP_ENDPOINT` (URL base) y `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (URL completa) tienen prioridad. |
| `service_name` | `"verdin"` | `service.name` de las trazas. `OTEL_SERVICE_NAME` tiene prioridad. |
| `sample_ratio` | `1.0` | Proporción de trazas que se conservan, de `0.0` a `1.0`. Una petición que lleva una cabecera `traceparent` sigue la decisión del llamante. |
| `sentry_dsn` | sin definir | Informa de los pánicos y las respuestas 5xx a Sentry. `SENTRY_DSN` tiene prioridad. |
| `sentry_environment` | sin definir | Entorno de Sentry. `SENTRY_ENVIRONMENT` tiene prioridad; sin definir, `production` en `verdin start` y `development` en `verdin dev`. |

## `[ai]`

Acciones de IA en el panel (con la funcionalidad **Acciones de IA** activada en
**Configuración → Funcionalidades**): traducir una entrada a otro idioma, escribir el texto
alternativo de las imágenes, resumir texto y sugerir metadatos SEO. Devuelven sugerencias; no se
guarda nada sin el editor. La clave se lee de `VERDIN_AI_KEY` (los servidores locales no la
necesitan).

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `provider` | `"none"` | `anthropic`, `openai` u `openai-compatible` (Ollama, LM Studio, vLLM…). |
| `model` | `claude-sonnet-5` para `anthropic` | El modelo; obligatorio para los demás proveedores. |
| `base_url` | el del proveedor | Otro endpoint, p. ej. `http://localhost:11434/v1`. |
| `max_tokens` | `2048` | Respuesta más larga. |

```toml
[ai]
provider = "anthropic"
```

Cada administrador puede hacer 30 peticiones de IA por minuto. El contenido y las imágenes se
envían al proveedor: elige uno que permita tu organización.

## `[cdn]`

Purga las cachés de la CDN cuando el contenido cambia públicamente. Las respuestas de la API de
contenido se etiquetan con `vd` y `vd-<singularName>` (cabeceras `Cache-Tag` y `Surrogate-Key`).

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `provider` | `"none"` | `cloudflare`, `fastly` o `webhook`. |
| `zone_id` | sin definir | Zona de Cloudflare (purga por etiqueta). |
| `service_id` | sin definir | Servicio de Fastly (purga por surrogate key). |
| `url` | sin definir | `webhook`: recibe `POST { "tags": [...] }`. |
| `debounce_ms` | `1000` | Tiempo durante el que se agrupan los cambios antes de purgar. |

El token de API se lee de `VERDIN_CDN_TOKEN` (se envía como bearer token a los webhooks).

## `[search]`

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `enabled` | `false` | Ordena `_q` con un índice de texto completo (Tantivy) en lugar de `$containsi`. |
| `dir` | `"data/search"` | Directorio del índice, relativo al proyecto. Si se borra, el índice se reconstruye en el siguiente arranque. |
| `memory_mb` | `50` | Memoria para la indexación. |

El índice vive en el disco de la instancia. Con varias instancias, activa el
[bus de eventos](#cluster) para que cada índice siga las escrituras de todas.

## `[cluster]`

El bus de eventos compartido, para varias instancias de un mismo proyecto (consulta
[Ejecutar varias instancias](/es/deploy/scaling/#bus-de-eventos-compartido)).

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `bus` | `"none"` | `none`: los eventos en tiempo real, la presencia, la invalidación de cachés y las actualizaciones de búsqueda se quedan en cada instancia. `database`: llegan a todas las instancias a través de la base de datos del proyecto (`LISTEN/NOTIFY` en PostgreSQL, sondeo en MySQL, MariaDB y SQLite). |
| `poll_interval_ms` | `1000` | Cada cuánto leen MySQL, MariaDB y SQLite los eventos de otras instancias. PostgreSQL se despierta con `NOTIFY` y usa este ritmo solo mientras no puede escuchar. |
| `instance_id` | sin definir (aleatorio en cada arranque) | El nombre de esta instancia en el bus y en los logs. |

```toml
[cluster]
bus = "database"
```

Defínelo en todas las instancias, o con `VERDIN_CLUSTER__BUS=database`.

## Variables de entorno

Además de las sobrescrituras `VERDIN_<SECTION>__<KEY>`, Verdin lee estas variables:

| Variable | Descripción |
| --- | --- |
| `VERDIN_CONFIG` | Ruta del archivo de configuración (igual que `--config`). |
| `VERDIN_DATABASE_URL` | Forma abreviada de `database.url`. |
| `VERDIN_ADMIN_JWT_SECRET` | Firma los tokens de sesión de administración. Obligatoria, de al menos 32 bytes; genérala con `verdin secrets`. |
| `VERDIN_TOKEN_PEPPER` | Clave del hash de los tokens guardados. Obligatoria, de al menos 32 bytes; genérala con `verdin secrets`. |
| `VERDIN_ADMIN_PASSWORD` | Contraseña para `verdin admin create` y `verdin admin reset-password` (si no, se lee de stdin); consulta la [referencia de la línea de comandos](/es/reference/cli/). |
| `VERDIN_EMAIL_SMTP_PASSWORD` | Contraseña SMTP. |
| `VERDIN_EMAIL_API_KEY` | Clave de API de los proveedores Resend y Postmark. |
| `VERDIN_SSO_<ID>_SECRET` | Secreto de cliente de un proveedor de SSO; `<ID>` es el id del proveedor en mayúsculas con `-` como `_` (consulta [Inicio de sesión único](/es/guides/auth/sso/)). |
| `VERDIN_OAUTH_<PROVIDER>_SECRET` | Secreto de cliente de un proveedor OAuth de usuarios finales, con el mismo formato de nombre que los de SSO (consulta [Usuarios finales](/es/guides/auth/end-users/)). |
| `VERDIN_AI_KEY` | Clave de API del proveedor de `[ai]`. |
| `VERDIN_CDN_TOKEN` | Token de API del proveedor de `[cdn]`. |
| `VERDIN_IMAGE_SECRET` | Firma las URLs de transformación de imágenes (consulta [`[upload.transforms]`](#uploadtransforms)). |
| `VERDIN_METRICS_TOKEN` | Bearer token para los scrapes de `/_metrics` cuando `[metrics].enabled`; tiene prioridad sobre `[metrics].token`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Colector de las trazas de [`[telemetry]`](#telemetry); tienen prioridad sobre `[telemetry].endpoint`. Las demás variables estándar `OTEL_EXPORTER_OTLP_*` (cabeceras, timeout, compresión) también se aplican. |
| `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` | Recurso de las trazas exportadas; `OTEL_SERVICE_NAME` tiene prioridad sobre `[telemetry].service_name`. |
| `OTEL_SDK_DISABLED` | `true` desactiva la exportación de trazas aunque `[telemetry].enabled` esté activado. |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | Informes de errores a Sentry; tienen prioridad sobre `[telemetry].sentry_dsn` y `sentry_environment`. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Credenciales del proveedor de subidas S3. |
| `RUST_LOG` | Filtro de los logs; tiene prioridad sobre `[log].level`. |
