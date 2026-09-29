---
title: Seguridad
description: Cómo protege Verdin el panel de administración, la API de contenido y el servidor, qué ajustes refuerzan una instancia de producción y cómo informar de una vulnerabilidad.
sidebar:
  order: 2
---

Esta página describe lo que hace Verdin para proteger un proyecto y los ajustes que controlas
tú. Úsala junto con la [lista de comprobación para producción](/es/deploy/production-checklist/)
cuando prepares una instancia para recibir tráfico real.

## Qué está cerrado por defecto

- **La API de contenido.** Las peticiones anónimas no obtienen nada hasta que concedes permisos
  públicos en **Configuración → Acceso público**. Un token desconocido, caducado o mal formado
  da `401`, nunca se recurre al rol público. Consulta [Permisos](/es/concepts/permissions/).
- **El documento OpenAPI** en `/api/_openapi.json` necesita un token de API válido hasta que lo
  hagas público en **Configuración → Funcionalidades → Documentación de la API**.
- **Las funcionalidades opcionales**, como GraphQL, los usuarios finales, el SSO y el servidor
  MCP, están desactivadas hasta que un administrador con el permiso `features.manage` las
  activa en **Configuración → Funcionalidades**.
- **Los plugins** están desactivados hasta que un administrador activa cada uno en
  **Configuración → Plugins**.
- **Las llamadas desde navegadores de otro origen.** Ningún origen puede llamar a ninguna API
  desde un navegador hasta que lo incluyas en `[api].cors_origins`.

## Inicio de sesión de administración

| Protección | Detalles |
| --- | --- |
| Hash de contraseñas | Argon2id con los parámetros de OWASP, que se vuelve a calcular cuando cambian. |
| Sesiones | Un token de acceso de 15 minutos guardado en la memoria de la página (nunca en `localStorage`) y un token de refresco de 30 días en una cookie `HttpOnly` y `SameSite=Strict` limitada a `/admin/api/auth`. El token de refresco rota en cada uso; presentar uno antiguo termina toda la sesión. |
| Cookies seguras | La cookie de refresco es `Secure` en `verdin start`. `[admin].secure_cookies = false` lo desactiva y registra un aviso. |
| CSRF | El refresco y el cierre de sesión necesitan una cabecera `X-Verdin-CSRF`, que un formulario de otro sitio no puede enviar. |
| Bloqueo | Cinco intentos fallidos bloquean una cuenta durante 15 minutos. Los fallos se cuentan entre el paso de la contraseña y el del segundo factor. Los correos desconocidos y las contraseñas incorrectas reciben la misma respuesta, en el mismo tiempo. |
| Límite de peticiones | Inicio de sesión, registro y refresco: `[admin].auth_rate_limit` peticiones por minuto y dirección de cliente (20). |
| Segundo factor | Apps de autenticación (TOTP) y passkeys, con códigos de recuperación. Un rol puede exigirlo (`requireTwoFactor`). Consulta [Autenticación de dos factores](/es/guides/auth/two-factor/). |
| Super Admins | Solo un Super Admin puede crear, editar, eliminar o restablecer a un Super Admin, o conceder ese rol. El último Super Admin activo no se puede eliminar. |

El primer administrador se registra desde el panel mientras no exista ninguno. Hazlo justo
después del primer arranque, o créalo con `verdin admin create --email …` antes de exponer el
servidor.

## Panel de administración y API de administración

- La API de administración (`/admin/api`) no envía cabeceras CORS, diga lo que diga
  `[api].cors_origins`: los navegadores solo dejan que el propio origen del panel lea sus
  respuestas.
- El panel se sirve con una Content Security Policy estricta (scripts solo desde su propio
  origen), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` y
  `Referrer-Policy: strict-origin-when-cross-origin`.
- Verdin no envía `Strict-Transport-Security`. Añádela en el proxy inverso que termina TLS.

## API de contenido

- **Los tokens de API** se muestran una sola vez. Verdin guarda un HMAC-SHA256 de cada token,
  con `VERDIN_TOKEN_PEPPER` como clave, y conserva un prefijo de 10 caracteres para mostrarlo.
  Los tokens pueden caducar y se pueden regenerar.
- **Los permisos por campo y por idioma** limitan lo que un rol lee y escribe, y `populate`, los
  filtros por relación y la ordenación por relación solo llegan a los tipos que el cliente
  puede leer.
- **Límites de consulta**: `pageSize` hasta `[api].max_page_size` (100), profundidad de
  `populate` hasta 5, como máximo 100 condiciones de filtro, query strings de hasta 16 KB y
  como máximo 1.000 entradas populadas por relación. Los campos desconocidos o privados en una
  consulta dan un `400`.
- **GraphQL** tiene sus propios límites de profundidad y complejidad (`maxDepth`,
  `maxComplexity`) y un interruptor de introspección en los ajustes de la funcionalidad.
- **Límites de peticiones**: `[api].public_rate_limit` por dirección de cliente sin token y
  `[api].token_rate_limit` por token de API o usuario final, en peticiones por minuto. Ambos
  están desactivados (`0`) por defecto. Las peticiones con un bearer token desconocido se
  limitan por dirección.

### CORS

`[api].cors_origins` enumera los orígenes de navegador autorizados a llamar a la API de
contenido y a GraphQL:

```toml title="verdin.toml"
[api]
cors_origins = ["https://www.example.com", "https://preview.example.com"]
```

Cada entrada es `scheme://host[:port]` sin ruta ni barra final; `["*"]` permite cualquier origen
y no se puede combinar con otros. Los métodos permitidos son `GET`, `POST`, `PUT` y `DELETE`, y
las cabeceras de petición permitidas, `Authorization`, `Content-Type` e `If-None-Match`. El
arranque falla si una entrada no es un origen.

Los frontends que se ejecutan en el servidor (Astro, Next.js en el servidor) llaman a la API sin
navegador y no necesitan ninguna entrada CORS.

## Peticiones y subidas

| Ajuste | Por defecto | Protege contra |
| --- | --- | --- |
| `[server].body_limit` | `"1mb"` | Cuerpos de petición grandes en las APIs normales. |
| `[server].request_timeout_secs` | `30` | Peticiones lentas que retienen conexiones. |
| `[upload].max_file_size` | 200 MB | Subidas grandes (las subidas tienen su propio límite en lugar de `body_limit`). |
| `[upload].max_image_megapixels` | `100` | Bombas de descompresión. |

El tipo de un archivo subido se obtiene de sus bytes, no del tipo que envía el cliente; el
nombre del archivo solo se usa como último recurso, y nunca para los tipos que los navegadores
ejecutan activamente (esos archivos se guardan como `application/octet-stream`). Los enlaces del
texto enriquecido `blocks` deben ser `http(s)`, `mailto:` o relativos.

## Direcciones de los clientes detrás de un proxy

Los límites de peticiones y los registros de auditoría usan la dirección del cliente. Detrás de
un proxy inverso, todas las peticiones vienen del proxy, así que inclúyelo en
`[server].trusted_proxies`:

```toml title="verdin.toml"
[server]
trusted_proxies = ["10.0.0.0/8"]   # the proxies' IPs or CIDR ranges
```

Verdin lee entonces `X-Forwarded-For` de derecha a izquierda y toma la primera dirección que no
sea un proxy de confianza. Las peticiones de cualquier otra dirección conservan su dirección de
conexión, así que un cliente no puede falsificar su dirección enviando él mismo la cabecera. No
incluyas rangos desde los que puedan conectarse clientes que no sean de confianza.

## Peticiones salientes

Los webhooks, los hooks de despliegue, los webhooks de purga de la CDN y las subidas desde una
URL hacen peticiones que elige un administrador. En `verdin start` rechazan las direcciones de
loopback, privadas y de enlace local (incluidas las formas IPv6 que contienen direcciones IPv4
privadas), así que un administrador no puede usarlas para llegar a servicios de tu red interna.
`[webhooks].allow_private_networks = true` quita esa restricción; hazlo solo si confías la red
interna a todos los administradores.

## Secretos

`VERDIN_ADMIN_JWT_SECRET` y `VERDIN_TOKEN_PEPPER` solo se leen del entorno y cada uno debe medir
al menos 32 bytes (`verdin secrets` imprime valores nuevos). El pepper también sella los
secretos TOTP de los administradores y deriva la clave con la que se calcula el hash de las
direcciones de quienes envían formularios. Guarda ambos en el gestor de secretos de tu
plataforma y no confirmes nunca `.env` en git.

Los logs de peticiones ocultan los valores de los parámetros de consulta cuyos nombres parecen
secretos (`token`, `code`, `password`, `key`, `signature`…) y la parte secreta de las URLs de
callback de despliegue.

## Métricas

`/_metrics` está desactivado salvo con `[metrics].enabled = true`. Si está activado y no hay
token, cualquiera que llegue al puerto puede leerlo. Define `VERDIN_METRICS_TOKEN` (o
`[metrics].token`) y haz scrape con `Authorization: Bearer <token>`, o bloquea la ruta en el
proxy. Consulta [Monitorización](/es/deploy/monitoring/).

## Plugins

Los plugins son módulos WebAssembly que Extism ejecuta en un sandbox. Un módulo no tiene
sistema de archivos, red ni base de datos propios: todo pasa por funciones del host limitadas
por las capacidades de su `plugin.toml` (los tipos de contenido que lee o escribe, los hosts
HTTP, su propio almacén clave-valor), con un límite de tiempo y de memoria por llamada
(`[limits]`, 5 s y 64 MB en el manifiesto de ejemplo). Los administradores ven lo que pide un
plugin antes de activarlo. Los scripts de administración de los plugins se ejecutan en la
página del panel, así que instala solo plugins de confianza. Consulta
[Plugins](/es/extending/plugins/).

## Exportaciones y copias de seguridad

Los archivos de `verdin export` contienen campos privados y hashes de contraseñas. Guárdalos
como los volcados de la base de datos. Consulta [Copias de seguridad](/es/deploy/backups/).

## Informar de una vulnerabilidad

No abras una issue pública para un problema de seguridad. Sigue la
[política de seguridad](https://github.com/Verdin-CMS/verdin/blob/main/SECURITY.md) del
repositorio: infórmalo de forma privada desde la pestaña **Security** del
[repositorio](https://github.com/Verdin-CMS/verdin/security) (**Report a vulnerability**), con la
versión, los pasos para reproducirlo y el impacto que observas. Las correcciones de seguridad
aparecen en la sección **Security** del [changelog](/es/project/changelog/).
