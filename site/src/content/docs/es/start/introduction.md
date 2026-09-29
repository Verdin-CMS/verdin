---
title: Qué es Verdin
description: Verdin es un CMS headless de código abierto escrito en Rust, con APIs de contenido compatibles con Strapi v5 y un panel de administración en un solo binario.
sidebar:
  order: 1
  label: Introducción
---

Verdin es un CMS headless de código abierto escrito en Rust. Tú modelas los tipos de
contenido, tus editores redactan y publican en un panel de administración, y tus sitios y
aplicaciones leen el contenido a través de una API REST o GraphQL. Verdin no renderiza
páginas: de eso se encarga tu frontend.

Es una reescritura de [Strapi v5](https://strapi.io): el formato del esquema y la API de
contenido tienen la misma forma, así que un proyecto de Strapi y su frontend pueden
migrarse con pocos cambios.

## Para quién es

- **Desarrolladores que construyen un sitio o una aplicación** y quieren un CMS que se
  ejecute como un único proceso, mantener el modelo de contenido en git y leerlo desde
  cualquier frontend: Astro, Next.js, una aplicación móvil.
- **Equipos que usan Strapi** y quieren la misma API con menos consumo de recursos, o
  necesitan funciones que Strapi reserva para sus planes de pago. Verdin no tiene edición
  enterprise: SSO, registros de auditoría, flujos de revisión y lanzamientos forman parte del
  proyecto de código abierto.
- **Editores**, que disponen de borradores, publicación, historial y vistas previas en un
  panel de administración disponible en 18 idiomas.

## Qué incluye

Un único ejecutable, `verdin`, es el servidor, la herramienta de línea de comandos y el
panel de administración. En producción no hay runtime de Node.js ni `node_modules`.

| Área | Qué obtienes |
| --- | --- |
| Bases de datos | PostgreSQL 14+, MySQL 8.4+, MariaDB 10.11+ y SQLite, cubiertas por la misma batería de pruebas. |
| Modelo de contenido | Tipos de colección, tipos únicos, componentes, zonas dinámicas, relaciones, medios y texto enriquecido en Markdown o en el formato de bloques de Strapi. El esquema son archivos JSON dentro de tu proyecto. |
| Cambios de esquema | Cada cambio se convierte en un plan de migración con un nivel de riesgo y el SQL exacto. Los pasos destructivos solo se ejecutan si los permites. |
| APIs | REST bajo `/api` con los parámetros de Strapi v5 (`filters`, `populate`, `sort`, `pagination`), un endpoint GraphQL opcional, un documento OpenAPI y un cliente TypeScript tipado. |
| Edición | Borrador y publicación, contenido localizado, historial de contenido, lanzamientos, flujos de revisión, comentarios y tareas, presencia en tiempo real, vista previa y edición visual en tu propio sitio. |
| Acceso | Roles de administración con detalle hasta campos e idiomas, tokens de API, permisos de acceso público, SSO con OpenID Connect, autenticación de dos factores con passkeys, registros de auditoría. |
| Funciones para el sitio | Búsqueda de texto completo, sitemap, redirecciones, menús y formularios, webhooks, actualizaciones en tiempo real. |
| Extensión | Plugins WebAssembly que intervienen en las escrituras, añaden rutas y tareas, y aportan widgets al panel y campos personalizados, limitados a las capacidades que declaran. |

## Relación con Strapi v5

**Lo que es igual:**

- Los archivos de esquema usan el formato de Strapi: `schema/content-types/<singularName>.json` y
  `schema/components/<category>/<name>.json`.
- La API de contenido REST: las rutas, el formato de respuesta plano con `documentId`, los
  parámetros y operadores de consulta, la semántica de escritura (un `POST` o un `PUT`
  publica salvo que pases `?status=draft`) y los cuerpos de error.
- El esquema GraphQL tiene la misma forma que el del plugin GraphQL de Strapi v5.
- Los usuarios finales (registro, inicio de sesión, OAuth, roles) siguen la API de
  `users-permissions`.

**Lo que cambia:**

- **Los cambios de esquema son migraciones planificadas.** Verdin compara los archivos de
  esquema con la base de datos y te muestra los pasos antes de ejecutarlos. `verdin start`
  se niega a arrancar mientras la base de datos no esté al día con el esquema.
- **El constructor de tipos de contenido solo funciona en modo desarrollo.** En producción,
  el esquema viene de tu repositorio.
- **Los plugins son WebAssembly, no JavaScript.** Los plugins de Strapi, así como los
  controladores, servicios o archivos de ciclo de vida personalizados en `src/`, no se
  ejecutan en Verdin.
- **La base de datos no se comparte con Strapi.** Un proyecto de Strapi se trae con
  `verdin import strapi`, que asigna un id nuevo a cada documento.
- **Algunos extras sobre REST**: acciones para publicar y despublicar
  (`POST /api/<route>/<documentId>/actions/publish`), y un componente poblado se devuelve
  completo, incluidos sus componentes anidados.

[Compatibilidad con Strapi](/es/migrate/compatibility/) detalla las diferencias.

## Cuándo no usarlo

- **Dependes de plugins de Strapi o de código de servidor propio en JavaScript.** Verdin no
  puede ejecutarlos; tendrías que reescribirlos como plugins WebAssembly o llevar esa lógica
  a otra parte.
- **Necesitas una versión 1.0 estable.** Verdin está en la 0.10: las versiones menores
  todavía pueden cambiar la configuración y el comportamiento. Lee
  [Actualizar de versión](/es/migrate/upgrading/) antes de cada una.
- **Quieres que el CMS renderice tus páginas.** Verdin es headless; combínalo con un
  framework de frontend o un generador de sitios estáticos.
- **Quieres un servicio gestionado.** Verdin es autoalojado: ejecutas el binario o la
  imagen de Docker en tu propia infraestructura.

## Siguientes pasos

- [Inicio rápido](/es/start/quickstart/): ejecuta Verdin y lee tu primera entrada desde la API.
- [Tutorial: un blog con Astro](/es/start/tutorial-astro/) o
  [con Next.js](/es/start/tutorial-nextjs/): construye un frontend sobre el blog de ejemplo.
- [Modelo de contenido](/es/concepts/content-model/): tipos de contenido, campos y cómo se almacenan.
- [Importar un proyecto de Strapi](/es/migrate/from-strapi/): trae un proyecto existente.
