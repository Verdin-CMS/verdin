---
title: Lista de comprobación para producción
description: Qué configurar antes de que un proyecto de Verdin reciba tráfico real — secretos, base de datos, migraciones, URLs, proxies, cookies, CORS, almacenamiento de medios, correo, copias de seguridad y monitorización.
sidebar:
  order: 1
---

Repasa esta lista antes de poner un proyecto de Verdin delante de usuarios reales. Cada punto
enlaza con la página que lo explica. Las páginas de cada plataforma ([Docker](/es/deploy/docker/),
[Fly.io](/es/deploy/fly/), [Render](/es/deploy/render/), [Railway](/es/deploy/railway/),
[Kubernetes](/es/deploy/kubernetes/)) aplican estos ajustes por ti donde es posible.

## Ejecuta el servidor de producción

- [ ] **Usa `verdin start`, no `verdin dev`.** `dev` permite al constructor de tipos de
      contenido reescribir los archivos de esquema, aplica migraciones con cada cambio y
      relaja las reglas de cookies y webhooks para el trabajo en local. Cambia el esquema en
      desarrollo, confirma los archivos en git y despliégalos.
- [ ] **Aplica las migraciones al desplegar.** `verdin start` se niega a arrancar mientras la
      base de datos no esté al día con el esquema. `verdin start --migrate` aplica antes los
      pasos *seguros* pendientes (es el comando por defecto de la imagen de Docker). Los pasos
      arriesgados o destructivos (cambios de tipo, nuevas restricciones unique, columnas
      eliminadas) necesitan `verdin migrate apply --allow risky|destructive`, que ejecutas tú
      una vez. Consulta [Migraciones de esquema](/es/concepts/schema-migrations/).
- [ ] **Distribuye el esquema con el servidor.** Monta el directorio `schema/` en solo lectura,
      o inclúyelo en tu imagen, para que lo que se ejecuta sea lo que has confirmado.

## Secretos

- [ ] **Genera una sola vez los dos secretos obligatorios** con `verdin secrets` y guárdalos
      en el almacén de secretos de tu plataforma: `VERDIN_ADMIN_JWT_SECRET` firma los tokens
      de sesión y `VERDIN_TOKEN_PEPPER` es la clave de los hashes de los tokens de API y de
      otros secretos guardados. `verdin start` falla si falta alguno o si mide menos de 32
      bytes. Los secretos solo se leen del entorno, nunca de `verdin.toml`.
- [ ] **Mantenlos estables.** Cambiar `VERDIN_TOKEN_PEPPER` hace que dejen de funcionar todos
      los tokens de API, y también los códigos de las apps de autenticación y los códigos de
      recuperación de los administradores. Cambiar `VERDIN_ADMIN_JWT_SECRET` invalida los
      tokens de acceso de vida corta de los administradores y de los usuarios finales, los
      enlaces de vista previa abiertos y los inicios de sesión OAuth en curso (el panel de
      administración y los clientes con tokens de renovación los renuevan por sí solos). Todas
      las instancias de un proyecto necesitan los mismos valores.
- [ ] Pon también en el entorno los demás secretos que uses: `VERDIN_EMAIL_SMTP_PASSWORD` o
      `VERDIN_EMAIL_API_KEY`, `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`,
      `VERDIN_METRICS_TOKEN`, `VERDIN_SSO_<ID>_SECRET`, `VERDIN_IMAGE_SECRET`. La lista
      completa está en la [referencia de configuración](/es/reference/configuration/).

## Base de datos

- [ ] **Elige el motor.** PostgreSQL (14 o posterior) es la opción habitual y la que conviene
      si vas a ejecutar [varias instancias](/es/deploy/scaling/). MySQL 8.4+ y MariaDB 10.11+
      funcionan igual. SQLite encaja con una sola instancia con disco persistente.
- [ ] **Define `VERDIN_DATABASE_URL`**: `postgres://…`, `mysql://…` (MySQL y MariaDB) o
      `sqlite:///data/verdin.db`. Añade `?sslmode=require` para los servidores PostgreSQL que
      exigen TLS.
- [ ] **Dimensiona el pool.** Cada instancia abre hasta `[database].pool_max` conexiones (10).
      Mantén `instances × pool_max` por debajo del límite de conexiones del servidor.

## URLs, proxies y cookies

- [ ] **Sirve por HTTPS.** Verdin habla HTTP sin cifrar; termina TLS en un proxy inverso, un
      balanceador de carga o el edge de tu plataforma.
- [ ] **Define `[server].public_url`** (`VERDIN_SERVER__PUBLIC_URL`) con la dirección que usan
      los navegadores, como `https://cms.example.com`. Los enlaces de los correos, los
      callbacks de SSO, el resumen diario y las passkeys dependen de ella; las passkeys quedan
      ligadas a su host.
- [ ] **Define `[server].trusted_proxies`** con las direcciones de tus proxies inversos (IPs o
      rangos CIDR). Solo entonces lee Verdin la dirección del cliente de `X-Forwarded-For`;
      sin ello, todos los clientes detrás del proxy comparten una misma dirección para los
      límites de peticiones y los registros de auditoría.
- [ ] **Mantén activadas las cookies seguras.** En `verdin start`, la cookie de refresco del
      panel es `Secure` por defecto. No definas `[admin].secure_cookies`; ponerla a `false` en
      producción registra un aviso al arrancar.

## APIs

- [ ] **Concede solo lo que necesita el público.** La API de contenido está cerrada hasta que
      concedes permisos públicos (**Configuración → Acceso público**) o creas tokens de API.
      Consulta [Permisos](/es/concepts/permissions/).
- [ ] **Define `[api].cors_origins`** si un navegador de otro origen llama a la API de
      contenido o a GraphQL, por ejemplo `["https://www.example.com"]`. Sin ello, solo las
      páginas del mismo origen pueden llamarlas desde un navegador. La API de administración
      nunca responde a peticiones de otro origen.
- [ ] **Plantéate límites de peticiones** para el tráfico anónimo: `[api].public_rate_limit` y
      `[api].token_rate_limit` (peticiones por minuto; `0`, el valor por defecto, es sin
      límite).

## Medios

- [ ] **Guarda las subidas donde sobrevivan a un nuevo despliegue.** El proveedor local por
      defecto escribe en disco: dale un volumen persistente o usa el proveedor S3 (AWS S3,
      Cloudflare R2, Backblaze B2, MinIO, Tigris…). En plataformas con discos efímeros, y con
      varias instancias, usa S3. Consulta [Medios](/es/concepts/media/).

## Correo electrónico

- [ ] **Configura un proveedor real.** El valor por defecto `[email].provider = "log"` escribe
      los correos en el log, y `verdin start` avisa de ello. Las invitaciones, los
      restablecimientos de contraseña, las confirmaciones de usuarios finales, las menciones en
      comentarios y el resumen necesitan `smtp`, `resend` o `postmark`, y `[email].from` con una
      dirección que acepte tu proveedor.

## Copias de seguridad y monitorización

- [ ] **Haz copias de la base de datos y del almacenamiento de medios** de forma programada, y
      prueba una restauración. Consulta [Copias de seguridad](/es/deploy/backups/).
- [ ] **Apunta las comprobaciones de salud a `/_ready`** y las de liveness a `/_health`.
- [ ] **Escribe los logs en JSON** (`[log].format = "json"`, el valor por defecto de la imagen
      de Docker) y recoge la salida de error estándar.
- [ ] **Haz scrape de `/_metrics`** si usas Prometheus, con un `VERDIN_METRICS_TOKEN`.
      Consulta [Monitorización](/es/deploy/monitoring/).

## Antes de salir a producción

- [ ] Registra tú mismo el primer administrador justo después del primer arranque: mientras no
      exista ningún administrador, cualquiera que llegue a `/admin/` puede registrarse como
      Super Admin. También puedes crearlo desde la línea de comandos con
      `verdin admin create --email …`.
- [ ] Revisa el [modelo de seguridad](/es/deploy/security/) y activa la
      [autenticación de dos factores](/es/guides/auth/two-factor/) para los Super Admins.
