---
title: "Permisos"
description: "Visión general del control de acceso en Verdin: roles de administración y RBAC con permisos por campo y por idioma, el rol público, los tokens de API y los roles de usuario final."
sidebar:
  order: 6
---

Verdin controla por separado dos públicos: los **administradores**, que inician sesión en el
panel de administración, y los **clientes de la API de contenido**, que leen y escriben
contenido desde tus sitios y aplicaciones. Esta página explica cómo se autoriza a cada uno y
cómo encajan las piezas. La lista completa de acciones está en la
[referencia de permisos](/es/reference/permissions/).

| Quién | Se autentica con | Los permisos vienen de | Se aplica a |
| --- | --- | --- | --- |
| Administrador | Correo electrónico y contraseña (más un segundo factor o SSO) | Sus [roles](#roles-de-administración) | Panel de administración y [API de administración](/es/api/admin/) |
| Cliente anónimo | Sin cabecera `Authorization` | [Acceso público](#acceso-público) | REST, GraphQL, tiempo real |
| Servidor o build | `Authorization: Bearer vd_…` | El tipo del [token de API](#tokens-de-api) | REST, GraphQL, tiempo real |
| Usuario final con sesión iniciada | `Authorization: Bearer <JWT>` | Su [rol de usuario final](#usuarios-finales) | REST, GraphQL, tiempo real |

Todo está cerrado por defecto: la API de contenido responde `403` hasta que concedes acceso, y
un administrador solo puede hacer lo que le permiten sus roles.

## Roles de administración

Un administrador tiene uno o varios roles; sus permisos se suman. Hay tres roles
predefinidos:

| Rol | Puede |
| --- | --- |
| **Super Admin** | Todo, incluidos usuarios, roles y tokens de API. No se puede editar. |
| **Editor** | Leer, crear, actualizar, eliminar y publicar todo el contenido; usar la biblioteca de medios; lanzar despliegues; gestionar SEO, redirecciones, menús y formularios. |
| **Author** | Crear contenido, y leer, actualizar y eliminar solo las entradas que ha creado. No puede publicar. Sube archivos y solo edita o elimina los suyos. |

Los demás roles se crean en **Configuración → Roles** (permiso `roles.manage`). El último
Super Admin activo no se puede desactivar, eliminar ni degradar, así que la instancia nunca se
queda sin acceso. Un rol también puede exigir a sus miembros que configuren la
[autenticación de dos factores](/es/guides/auth/two-factor/): hasta que lo hagan, solo pueden
acceder a su perfil.

### Qué es un permiso

Un permiso es una **acción**, un **objeto** para las acciones de contenido y unas
**condiciones** opcionales:

- **Acciones de contenido**: `content.read`, `content.create`, `content.update`,
  `content.delete` y `content.publish`, sobre un tipo de contenido (`api::article`) o sobre
  todos (`*`).
- **Acciones de medios**: `media.read`, `media.create`, `media.update` y `media.delete`, para
  la biblioteca de medios.
- **Acciones de configuración**, como `users.manage`, `tokens.manage`, `webhooks.manage` o
  `features.manage`, que abren las páginas correspondientes de **Configuración**.
- **Condiciones**: `is-creator` limita un permiso de contenido o de medios a lo que ha creado
  el administrador. Así funciona el rol Author.

Las condiciones pasan a formar parte de la consulta a la base de datos: una lista filtrada por
`is-creator` cuenta y pagina correctamente, en lugar de ocultar filas a posteriori.

### Permisos por campo y por idioma

Los permisos de contenido se pueden restringir más:

- **Campos.** `content.read`, `content.create` y `content.update` pueden enumerar los
  atributos que cubren. Los campos que quedan fuera de la lista se ocultan en las lecturas
  (incluidas la búsqueda, los filtros, la ordenación y las entradas relacionadas) y se
  rechazan en las escrituras.
- **Idiomas.** En los [tipos localizados](/es/concepts/internationalization/), los permisos de
  contenido pueden enumerar los idiomas que cubren. Las versiones en otros idiomas no se
  pueden leer ni cambiar.

Ambos se definen por tipo de contenido en el editor del rol, en **Campos** e **Idiomas**.

## API de contenido

Los clientes de la API de contenido se comprueban contra permisos: una **acción** sobre un
**objeto**.

| Acción | Permite |
| --- | --- |
| `find` | Listar documentos (`GET /api/articles`) o leer un tipo único. |
| `findOne` | Leer un documento (`GET /api/articles/{documentId}`). |
| `create` | `POST` |
| `update` | `PUT` |
| `delete` | `DELETE` |
| `publish` | Las rutas `actions/publish`, `actions/unpublish` y `actions/discard-draft`. |
| `readDrafts` | Leer con `status=draft`. |

Los objetos son los tipos de contenido, la biblioteca de medios (`plugin::upload`) y las
cuentas de usuario final (`plugin::users-permissions.user`) cuando los
[usuarios finales](/es/guides/auth/end-users/) están activados.

Algunas reglas valen para todos los clientes:

- Leer borradores necesita `readDrafts` además de `find` o `findOne`. Un permiso que lee el
  contenido de tu sitio no puede leer por accidente el trabajo sin publicar.
- Popular, filtrar u ordenar a través de una relación necesita acceso de lectura a su tipo de
  destino.
- Los campos `private` nunca se devuelven, sean cuales sean los permisos.
- Una escritura devuelve el documento escrito aunque no se tenga `find`, como en Strapi.
- Los mismos permisos se aplican a [GraphQL](/es/api/graphql/) y al
  [flujo en tiempo real](/es/api/realtime/).

### Acceso público

Las peticiones sin cabecera `Authorization` reciben los permisos de
**Configuración → Acceso público**. Por defecto no se concede nada. Lo habitual es conceder
`find` y `findOne` sobre los tipos que muestra tu sitio.

### Tokens de API

Los tokens de API son para servidores, pasos de build y scripts. Créalos en
**Configuración → Tokens de API** (permiso `tokens.manage`):

| Tipo | Permisos |
| --- | --- |
| **Solo lectura** | `find` y `findOne` sobre todos los tipos. Nunca borradores. |
| **Acceso completo** | Todas las acciones sobre todos los tipos, borradores incluidos. |
| **Personalizado** | Los permisos que elijas, como en el acceso público. |

- Un token empieza por `vd_`. Su secreto se muestra una sola vez, al crearlo o regenerarlo;
  Verdin solo guarda un hash con clave del mismo.
- Los tokens pueden caducar. Un token desconocido, caducado o mal formado da `401`: nunca se
  recurre al acceso público en su lugar.
- Cualquier token válido puede leer el documento OpenAPI en `/api/_openapi.json`, salvo que
  hagas pública la documentación.

Consulta [Tokens de API](/es/guides/auth/api-tokens/) para crearlos y rotarlos.

### Usuarios finales

Los usuarios finales son las personas que inician sesión en tu sitio o tu aplicación, como con
el plugin users-permissions de Strapi. La funcionalidad está desactivada por defecto. Cada
cuenta tiene un rol:

- **Public** es el rol de las peticiones sin token: sus permisos son los de
  **Configuración → Acceso público**.
- **Authenticated** se asigna por defecto a las cuentas nuevas.
- Los roles personalizados contienen cualquier conjunto de permisos, con las mismas acciones
  que arriba.

Un usuario final envía el JWT que obtuvo al iniciar sesión como `Authorization: Bearer <jwt>`.
Verdin lo distingue de los tokens de API por el prefijo `vd_`. Consulta
[Usuarios finales](/es/guides/auth/end-users/).

## Comparación con Strapi

El modelo sigue a Strapi v5: RBAC de administración con condiciones `is-creator`, y una API de
contenido con acceso público, tokens de API y roles de users-permissions. Las diferencias:

- Todas las funciones están disponibles para todos los proyectos: roles personalizados,
  permisos por campo y por idioma, [SSO](/es/guides/auth/sso/) y
  [registros de auditoría](/es/guides/content/audit-logs/).
- Leer borradores a través de la API de contenido es un permiso aparte, `readDrafts`.
- Publicar por REST tiene su propio permiso, `publish`, y sus propias rutas.
