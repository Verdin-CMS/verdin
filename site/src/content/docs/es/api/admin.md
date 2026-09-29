---
title: "API de administración"
description: "La API que hay detrás del panel de administración de Verdin, para automatizar tareas: inicio de sesión, sesiones, convenciones y los principales grupos de rutas."
sidebar:
  order: 4
  label: "Administración"
---

El panel de administración es un cliente de la API de administración, que se sirve bajo
`{admin.path}/api` (`/admin/api` por defecto). Todo lo que hace el panel también lo puede
hacer un script: crear administradores y tokens de API, configurar webhooks y
funcionalidades, gestionar idiomas o trabajar con borradores y lanzamientos. Esta página explica
cómo autenticarse y enumera los grupos de rutas.

:::caution[Estabilidad]
La API de administración no tiene garantía de estabilidad antes de Verdin 1.0: las rutas y
los cuerpos pueden cambiar en versiones menores, y el changelog no recoge todos los cambios.
Para leer y escribir contenido, usa preferiblemente la API [REST](/es/api/rest/) o
[GraphQL](/es/api/graphql/) con un [token de API](/es/guides/auth/api-tokens/). Está previsto
un contrato de estabilidad para todas las APIs en la 1.0.
:::

## Iniciar sesión

La API de administración todavía no tiene tokens de API: un script inicia sesión como un
usuario administrador, idealmente uno cuyo rol solo permita lo que el script necesita.

```sh title="Terminal"
curl -s -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"bot@example.com","password":"…"}'
```

```json
{
  "data": {
    "user": { "id": 3, "email": "bot@example.com", "…": "…" },
    "accessToken": "eyJhbGciOiJIUzI1NiIs…",
    "accessTokenExpiresAt": "2026-09-29T10:15:00.000Z"
  }
}
```

Envía el token de acceso en todas las demás peticiones:

```sh title="Terminal"
curl -H "Authorization: Bearer $ACCESS_TOKEN" 'https://cms.example.com/admin/api/system/info'
```

| Credencial | Duración | Dónde |
| --- | --- | --- |
| Token de acceso (JWT) | 15 minutos | El cuerpo de la respuesta. Envíalo como `Authorization: Bearer …`. |
| Token de refresco | 30 días | La cookie `verdin_refresh` (`HttpOnly`, `SameSite=Strict`, ruta `/admin/api/auth`, `Secure` con `verdin start`). |

Para obtener un token de acceso nuevo, llama a `POST /admin/api/auth/refresh` con la cookie
y una cabecera `X-Verdin-CSRF` (con cualquier valor). Responde igual que un inicio de sesión
y rota el token de refresco: guarda la cookie nueva, porque volver a presentar un token de
refresco ya usado termina toda la sesión. `POST /admin/api/auth/logout`, con la misma
cabecera, cierra la sesión.

```sh title="Terminal"
curl -s -b cookies.txt -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/refresh' \
  -H 'X-Verdin-CSRF: 1'
```

- **Autenticación de dos factores.** Para una cuenta con segundo factor, el inicio de sesión
  responde `{ "data": { "twoFactorRequired": true, "twoFactorToken": "…", "methods": ["totp"] } }`.
  Complétalo con `POST /admin/api/auth/login/two-factor` y
  `{ "twoFactorToken": "…", "code": "123456" }` (un código TOTP o de recuperación). Consulta
  [Autenticación de dos factores](/es/guides/auth/two-factor/).
- **Límites de peticiones.** El inicio de sesión y el registro se limitan por IP de cliente
  con `[admin].auth_rate_limit` (20 por minuto por defecto); los refrescos tienen un margen
  mayor.
- **Fallos.** Las credenciales incorrectas, las cuentas desconocidas y las cuentas bloqueadas
  responden igual: `400 Invalid credentials`. Cinco contraseñas incorrectas bloquean la
  cuenta durante 15 minutos.
- **Primer administrador.** En una instancia nueva, `POST /admin/api/auth/register-first-admin`
  crea el Super Admin; solo funciona mientras no exista ningún administrador.
  `verdin admin create` hace lo mismo desde la línea de comandos.

## Convenciones

- Los cuerpos y las respuestas son JSON. Las respuestas envuelven su resultado en `data`
  (`{ "data": … }`); las rutas de contenido también devuelven `meta`, como la API REST.
- Las rutas de contenido reciben cuerpos `{ "data": { … } }`, como la API REST. Las rutas de
  configuración reciben objetos JSON simples.
- Los errores tienen la [forma de error de REST](/es/api/rest/#errores). Una ruta de una
  funcionalidad desactivada responde `404`. Un administrador cuyo rol exige autenticación de
  dos factores recibe `403 TwoFactorRequiredError` hasta que la configure.
- Cada ruta comprueba los [permisos](/es/concepts/permissions/) del administrador: las rutas
  de contenido, las acciones de contenido sobre el tipo; las rutas de configuración, su
  acción de configuración.
- La API de administración nunca responde a peticiones de otro origen: llámala desde un
  servidor o un script, no desde las páginas de otro sitio.
- Los cambios realizados con éxito quedan en el
  [registro de auditoría](/es/guides/content/audit-logs/).

## Grupos de rutas

Las rutas son relativas a `/admin/api`. Los routers están en
[`crates/verdin-api/src/admin.rs`](https://github.com/Verdin-CMS/verdin/blob/main/crates/verdin-api/src/admin.rs)
y en los módulos `*_admin.rs` que hay junto a él.

| Grupo | Rutas | Permiso |
| --- | --- | --- |
| Inicio de sesión y cuenta | `GET /auth/status`, `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `GET\|PUT /users/me`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, invitaciones y restablecimiento de contraseña bajo `/auth/*` | Sesión iniciada (las rutas de inicio de sesión son públicas) |
| Dos factores | `/auth/two-factor/*`, `POST /auth/login/two-factor`, `POST /auth/login/passkey/options`, `DELETE /users/{id}/two-factor` | Sesión iniciada; `users.manage` para restablecer a otro administrador |
| SSO | `GET /auth/sso`, `GET /auth/sso/{id}`, `GET /auth/sso/{id}/callback` | Público |
| Usuarios administradores | `GET\|POST /users`, `GET\|PUT\|DELETE /users/{id}`, `POST /users/{id}/invite` | `users.manage` |
| Roles y acceso público | `GET\|POST /roles`, `GET\|PUT\|DELETE /roles/{id}`, `GET\|PUT /public-permissions` | `roles.manage` |
| Tokens de API | `GET\|POST /api-tokens`, `GET\|PUT\|DELETE /api-tokens/{id}`, `POST /api-tokens/{id}/regenerate` | `tokens.manage` |
| Esquema | `GET /content-types`, `GET /components`, `GET\|PUT\|DELETE /content-types/{uid}/edit-view`; `GET /schema`, `POST /schema/plan`, `POST /schema/apply` solo en `verdin dev` | Sesión iniciada; `views.manage` para las vistas de edición; `schema.manage` para el constructor |
| Contenido | `GET\|POST /content/{uid}`, `GET\|PUT\|DELETE /content/{uid}/{documentId}`, `POST /content/{uid}/{documentId}/actions/{publish\|unpublish\|discard-draft}`, `POST …/clone`, `GET …/locales`, `GET …/usage`, `GET /content/{uid}/uid-available`, `GET /content/{uid}/stats` | Acciones de contenido sobre `{uid}` |
| Importación y exportación | `GET /content/{uid}/export`, `POST /content/{uid}/import` | Acciones de contenido sobre `{uid}` |
| Historial | `GET /history/{uid}/{documentId}`, `GET /history/versions/{id}`, `POST /history/versions/{id}/restore` | Acciones de contenido sobre el tipo |
| Lanzamientos | `GET\|POST /releases`, `GET\|PUT\|DELETE /releases/{id}`, `POST /releases/{id}/actions`, `DELETE /releases/{id}/actions/{actionId}`, `POST /releases/{id}/publish` | `releases.manage` |
| Flujos de revisión | `GET\|POST /review-workflows`, `GET\|PUT\|DELETE /review-workflows/{id}`, `GET\|PUT /content/{uid}/{documentId}/review`, `GET /review/*` | `workflows.manage` para configurar |
| Medios | `POST /upload`, `POST /upload/from-url`, `GET /upload/files`, `GET\|PUT\|DELETE /upload/files/{id}`, `POST /upload/files/{id}/replace`, `GET /upload/files/{id}/usage`, `/upload/folders…` | `media.*` |
| Idiomas | `GET\|POST /i18n/locales`, `PUT\|DELETE /i18n/locales/{code}` | `locales.manage` para modificar |
| Webhooks | `GET\|POST /webhooks`, `GET\|PUT\|DELETE /webhooks/{id}`, `POST\|DELETE /webhooks/{id}/secret`, `POST /webhooks/{id}/trigger`, `GET /webhooks/{id}/deliveries`, `POST /webhooks/deliveries/{id}/retry` | `webhooks.manage` |
| Usuarios finales | `GET\|POST /end-users`, `GET\|PUT\|DELETE /end-users/{id}`, `GET\|POST /end-user-roles`, `PUT\|DELETE /end-user-roles/{id}` | `endusers.manage` |
| Funcionalidades | `GET /features`, `PUT /features/{id}`, `POST /email/test` | `features.manage` para modificar |
| Plugins | `GET /plugins`, `GET /plugins/extensions`, `PUT /plugins/{name}`, `GET /plugins/{name}/logs` | `plugins.manage` |
| Despliegues y CDN | `/deploy/targets…`, `GET /deploy/deployments`, `GET /deploy/cdn`, `POST /deploy/cdn/purge` | `deploy.manage`; `deploy.trigger` para lanzarlos |
| Sitio | `/site/redirects…`, `/site/menus…`, `/site/forms…` y los envíos de formularios | `site.manage` |
| Colaboración | `/comments…`, `/tasks…`, `/engagement/*`, `/polls…` | Acceso de lectura al tipo de la entrada |
| Tiempo real | `GET /events`, `GET\|POST /presence` | Consulta la [API en tiempo real](/es/api/realtime/#flujo-de-administración) |
| IA | `GET /ai`, `POST /ai/translate`, `/ai/alt-text`, `/ai/summarize`, `/ai/seo` | Consulta [Acciones de IA](/es/guides/integrations/ai-actions/) |
| Registros de auditoría | `GET /audit-logs` | `audit.read` |
| Sistema | `GET /system/info` (versión, base de datos y modo) | Sesión iniciada |

## Rutas de contenido

Las rutas de contenido usan el mismo Document Service que la API REST, con reglas de
administración:

- `{uid}` es el UID del tipo de contenido, por ejemplo `api::article`.
- Las lecturas devuelven los **borradores** salvo que pases `status=published`. Aceptan los
  [parámetros de consulta](/es/api/rest/#parámetros-de-consulta) de REST, además de
  `unseen=true` para los documentos que el administrador no ha abierto desde su último
  cambio.
- Las escrituras solo guardan el borrador. Publicar es siempre una acción explícita.
- Las escrituras registran al administrador como creador o como último editor. Las
  restricciones de campos, idiomas e `is-creator` de los roles del administrador se aplican a
  las lecturas y a las escrituras.

```sh title="Terminal"
curl -X PUT 'https://cms.example.com/admin/api/content/api::article/k2m7q4…?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"data":{"title":"Bonjour, Verdin"}}'
curl -X POST 'https://cms.example.com/admin/api/content/api::article/k2m7q4…/actions/publish?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```
