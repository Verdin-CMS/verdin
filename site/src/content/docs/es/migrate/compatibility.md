---
title: Compatibilidad con Strapi
description: Qué funcionalidades y APIs de Strapi v5 soporta Verdin, cuáles soporta en parte y cuáles no — REST, GraphQL, usuarios y permisos, subidas, i18n, borrador y publicación, extensiones de código, el panel de administración y las funcionalidades Enterprise.
sidebar:
  order: 3
---

Verdin conserva el modelo de contenido y las APIs de contenido de Strapi v5 para que los
frontends y el contenido puedan trasladarse (consulta [Migrar desde Strapi](/es/migrate/from-strapi/)).
No es un sustituto directo de un *código base* de Strapi: no hay runtime de JavaScript, así que
el código propio se reconstruye como plugins WebAssembly. Esta página enumera cada área con su
estado, a fecha de Verdin 0.10.0.

**Soportado** funciona como en Strapi v5 (con las diferencias indicadas). **Parcial** cubre los
casos habituales; la nota dice qué falta. **No soportado** no tiene equivalente.

## Modelo de contenido

| Funcionalidad | Estado | Notas |
| --- | --- | --- |
| Tipos de colección y tipos únicos | Soportado | Archivos de esquema JSON muy parecidos a los de Strapi (`schema/content-types/*.json`). Consulta [Modelo de contenido](/es/concepts/content-model/). |
| Tipos de atributo escalares | Soportado | `string`, `text`, `richtext` (Markdown), `blocks`, `email`, `uid`, `integer`, `biginteger`, `float`, `decimal`, `boolean`, `date`, `time`, `datetime`, `enumeration`, `json`, `password`. El `timestamp` de Strapi se importa como `datetime`. |
| Componentes y zonas dinámicas | Soportado | Incluidos los medios y las relaciones `oneWay`/`manyWay` dentro de los componentes. |
| Relaciones | Soportado | Uno/muchos a uno/muchos, unidireccionales (one-way y many-way) y las polimórficas `morphToOne`, `morphToMany`, `morphOne` y `morphMany`. |
| Campos de medios | Soportado | Simples o múltiples, `allowedTypes`. |
| `unique` | Parcial | No en los atributos `text`, `richtext`, `blocks` y `json`. |
| Campos condicionales (`conditions`) | Soportado | Las condiciones JSON Logic de Strapi 5.17; los campos ocultos no son obligatorios. |
| Campos personalizados | Parcial | Los atributos `customField` funcionan; el input del panel lo proporciona un [plugin](/es/extending/plugins/) de Verdin, no los plugins React de Strapi. |
| Constructor de tipos de contenido | Soportado | Solo en modo desarrollo (`verdin dev`), como en Strapi. |

## API REST

| Funcionalidad | Estado | Notas |
| --- | --- | --- |
| Rutas CRUD | Soportado | `GET`/`POST /api/{pluralName}`, `GET`/`PUT`/`DELETE /api/{pluralName}/{documentId}`, tipos únicos en `/api/{singularName}`. Las respuestas llevan `data` y `meta`, y los errores el objeto `error` de Strapi. |
| `filters` | Soportado | Todos los operadores de Strapi: `$eq`, `$eqi`, `$ne`, `$nei`, `$lt`, `$lte`, `$gt`, `$gte`, `$in`, `$notIn`, `$contains`, `$notContains`, `$containsi`, `$notContainsi`, `$null`, `$notNull`, `$between`, `$startsWith(i)`, `$endsWith(i)`, `$and`, `$or`, `$not`; a través de relaciones, componentes, componentes repetibles y zonas dinámicas (`__component`). |
| `sort` | Soportado | Varios campos, `:asc`/`:desc`, y un campo de una relación a uno (`author.name:asc`). |
| `pagination` | Soportado | `page`/`pageSize` o `start`/`limit`, `withCount`. `pageSize` está limitado a `[api].max_page_size` (100). |
| `fields` | Soportado | |
| `populate` | Soportado | `*`, listas, objetos anidados, `on` para las zonas dinámicas, `count`. Profundidad hasta 5; como máximo 1.000 entradas populadas por relación. |
| `status` | Soportado | `published` (por defecto) o `draft`; leer borradores necesita el permiso `readDrafts`. |
| `locale` | Soportado | Consulta i18n más abajo. |
| `hasPublishedVersion` | Soportado | |
| Búsqueda de texto completo `_q` | Soportado | `$containsi` sobre los campos de texto, como Strapi; búsqueda ordenada por relevancia con `[search]`. |
| Escritura de relaciones | Soportado | IDs, `connect` / `disconnect` / `set`, con `position` (`before`, `after`, `start`, `end`). |
| Publicar, despublicar, descartar el borrador | Soportado | Las escrituras publican salvo con `?status=draft`, como en Strapi v5. Verdin añade `POST /api/{pluralName}/{documentId}/actions/{publish,unpublish,discard-draft}`. |
| Formato de respuesta de Strapi v4 y `publicationState` | No soportado | Verdin solo habla v5: atributos planos, `documentId`, `status`. |
| Documento OpenAPI | Parcial | En `/api/_openapi.json` (solo con token por defecto) y una referencia interactiva en `/api/docs`, en lugar del `/documentation` del plugin de documentación. |

## GraphQL

| Funcionalidad | Estado | Notas |
| --- | --- | --- |
| Consultas | Soportado | `articles`, `articles_connection` con `pageInfo`, `article(documentId)`, tipos únicos; `filters`, `sort`, `pagination`, `status`, `locale`. Desactivado hasta que actives **Configuración → Funcionalidades → GraphQL**. |
| Mutaciones | Soportado | `create…`, `update…`, `delete…` con `status` y `locale`. |
| Componentes, zonas dinámicas, medios | Soportado | Las zonas dinámicas como uniones, los medios como `UploadFile`. |
| Relaciones polimórficas | Parcial | Se devuelven como JSON, no como uniones tipadas. |
| Shadow CRUD (desactivar operaciones por tipo) | Soportado | El ajuste `disabled` de la funcionalidad. |
| Resolvers propios y extensiones del esquema | Parcial | Campos raíz resueltos por plugins (`[[graphql]]` en `plugin.toml`); sin `extensionService`. |
| Mutaciones de Users & Permissions (`login`, `register`, `me`…) | No soportado | Usa las rutas REST. |
| Consultas y mutaciones de subida e i18n (`uploadFiles`, `i18NLocales`…) | No soportado | Usa las rutas REST (`GET /api/i18n/locales`) y el panel de administración. `localizations` en los tipos localizados está soportado. |
| Límites, GraphiQL | Soportado | Interruptores de `maxDepth`, `maxComplexity`, introspección y playground. |

## Users & Permissions (usuarios finales)

Activa **Configuración → Funcionalidades → Usuarios y permisos**. Consulta
[Usuarios finales](/es/guides/auth/end-users/).

| Funcionalidad | Estado | Notas |
| --- | --- | --- |
| `POST /api/auth/local`, `/auth/local/register` | Soportado | Misma forma de petición y de respuesta. |
| Confirmación por correo, contraseña olvidada, restablecimiento y cambio de contraseña | Soportado | `/auth/email-confirmation`, `/auth/send-email-confirmation`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/change-password`. |
| Tokens de renovación | Soportado | `jwtManagement: "refresh"`, `/auth/refresh`, `/auth/logout`. |
| `/api/users`, `/users/me`, `/users/count` | Soportado | JSON simple, permisos sobre `plugin::users-permissions.user`. |
| Proveedores OAuth | Parcial | GitHub, Google, Microsoft, Discord, Facebook, GitLab, LinkedIn y cualquier proveedor OAuth 2; no todos los predefinidos de Strapi. |
| Rutas de roles y permisos (`/api/users-permissions/roles`, `/permissions`) | No soportado | Gestiona los roles en **Configuración → Usuarios finales**. |
| Usuarios importados | Soportado | Los hashes bcrypt siguen funcionando; se vuelven a calcular con Argon2id al iniciar sesión. |

## Biblioteca de medios y API de subida

| Funcionalidad | Estado | Notas |
| --- | --- | --- |
| `POST /api/upload` | Soportado | Multipart `files` y `fileInfo`; `?id=` actualiza la información de un archivo, o sustituye el archivo si se envía uno. |
| Enlazar al subir (`ref`, `refId`, `field`) | No soportado | Sube el archivo y después define el campo de medios con su id. |
| `GET /api/upload/files`, `/files/{id}`, `DELETE /files/{id}` | Parcial | El listado solo acepta `pagination[page]`, `pagination[pageSize]`, `sort` y `filters[name][$containsi]`. |
| Formatos responsive, breakpoints | Soportado | `thumbnail` más `[upload].breakpoints`. |
| Carpetas, puntos focales, texto alternativo, pies de foto | Soportado | |
| Proveedores de subida | Parcial | Disco local y almacenamiento compatible con S3 (AWS, R2, B2, MinIO, Tigris…). Sin Cloudinary ni otros paquetes de proveedores. |
| Transformaciones de imágenes | Solo en Verdin | `/uploads/<file>?preset=…` y URLs firmadas (proveedor local). |

## Internacionalización

| Funcionalidad | Estado | Notas |
| --- | --- | --- |
| Tipos localizados y campos no localizados | Soportado | `pluginOptions.i18n.localized`, también por atributo. |
| `?locale=` en REST, `locale` en GraphQL | Soportado | Un idioma desconocido da un `400`. |
| `localizations` en las respuestas | Soportado | Solo cuando se puebla (`populate=localizations`, `populate=*`), con las mismas opciones que una relación. También es un campo de GraphQL. La API de administración lo deja fuera. |
| `GET /api/i18n/locales` | Soportado | Un array simple con la forma de Strapi. Necesita `find` sobre `plugin::i18n.locale` (fila **Idiomas** de la cuadrícula de permisos), como el `listLocales` de Strapi. `documentId` se deriva del código del idioma. Los idiomas se gestionan en el panel (**Configuración → Internacionalización**). |

## Borrador y publicación

| Funcionalidad | Estado | Notas |
| --- | --- | --- |
| Versiones de borrador y publicada por documento | Soportado | Por idioma. Consulta [Borrador y publicación](/es/concepts/draft-and-publish/). |
| Descartar el borrador | Soportado | |
| Publicación programada | Soportado | A través de los [lanzamientos](/es/guides/content/releases/). |

## Personalización del servidor

Consulta [Portar código propio](/es/migrate/porting-custom-code/) para saber cómo mover cada uno.

| Strapi | Estado | Verdin |
| --- | --- | --- |
| Hooks de ciclo de vida, middlewares del Document Service | Parcial | Hooks before/after en plugins WebAssembly, que pueden cambiar o rechazar una escritura. Sin JavaScript. |
| Controladores, servicios y rutas propios | Parcial | Rutas de plugins bajo `/api/plugins/<name>/`. |
| Policies y middlewares | No soportado | Los permisos y los límites de peticiones vienen integrados. |
| `register` / `bootstrap` | Parcial | La función de arranque de un plugin, que se ejecuta cuando el plugin arranca, se activa o cambian sus ajustes; puede sembrar contenido y reemplazar los permisos del rol público. |
| Tareas cron | Parcial | Tareas de plugins. |
| Document Service / Entity Service en JavaScript | No soportado | No hay runtime de JavaScript. |
| Plugins npm del marketplace de Strapi | No soportado | |
| Webhooks | Soportado | Firmados, reintentados y registrados; `entry.draft-discard` es `entry.discard-draft`. Consulta [Webhooks](/es/guides/integrations/webhooks/). |
| Tokens de API (solo lectura, acceso completo, personalizados) | Soportado | Las mismas clases, caducidad opcional, regeneración. |
| Transfer tokens, `strapi transfer` | No soportado | Usa `verdin export` y `verdin import verdin`. |
| Archivos de `strapi export` | Soportado (importación) | `verdin import strapi`; las exportaciones cifradas no se leen. |
| `config/*.js`, `.env` | Parcial | `verdin.toml` y variables de entorno. |
| Tipos TypeScript | Soportado | `verdin types`. |
| Proveedores de correo | Parcial | SMTP, Resend y Postmark. |

## Panel de administración

| Funcionalidad | Estado | Notas |
| --- | --- | --- |
| Gestor de contenido, biblioteca de medios, constructor de tipos de contenido | Soportado | Un panel propio en Angular, no el panel React de Strapi. |
| Usuarios administradores, roles, roles personalizados | Soportado | Super Admin, Editor y Author predefinidos, más roles personalizados. |
| Permisos por campo y por idioma | Soportado | |
| Condiciones de RBAC | Parcial | Solo la condición predefinida `is-creator`; sin condiciones propias. |
| Personalización del panel (`src/admin/app`) | Parcial | Logotipo, favicon, título, color de acento y textos en `[admin.branding]`; widgets y campos personalizados desde plugins. Sin páginas propias, zonas de inyección ni extensiones React. |
| API de administración (`/admin/…`) | No soportado | La API de administración de Verdin es propia; no construyas sobre la de Strapi. |
| Configuración de la vista de edición y de la vista de lista | Soportado | |

## Funcionalidades Enterprise

Todo en Verdin es de código abierto; en Strapi, estas son funcionalidades Enterprise o de pago.

| Funcionalidad de Strapi | Estado | Notas |
| --- | --- | --- |
| SSO | Parcial | Proveedores OpenID Connect, con asignación de grupos a roles. Sin SAML ni otras estrategias de passport. Consulta [Inicio de sesión único](/es/guides/auth/sso/). |
| Registros de auditoría | Soportado | Consulta [Registros de auditoría](/es/guides/content/audit-logs/). |
| Flujos de revisión | Soportado | Los roles por etapa limitan quién mueve entradas *hacia* una etapa, y una etapa de publicación obligatoria se aplica a todas las APIs. Consulta [Flujos de revisión](/es/guides/content/review-workflows/). |
| Releases | Soportado | Programados o inmediatos. Consulta [Lanzamientos](/es/guides/content/releases/). |
| Historial de contenido | Soportado | `[history].max_versions` versiones por documento. |
| Vista previa y vista previa en directo | Soportado | URLs de vista previa con tokens de vida corta, vista previa en paralelo y [edición visual](/es/guides/frontend/visual-editing/). |
| Roles de administración personalizados | Soportado | Sin límite de número. |
