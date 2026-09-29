---
title: Registro de decisiones
description: Las decisiones de diseño que hay detrás de Verdin, numeradas en el orden en que se tomaron, con el resultado y el motivo de cada una.
sidebar:
  order: 8
---

Este registro recoge las decisiones de diseño que han dado forma a Verdin, en el orden en que se tomaron, para que puedas ver por qué el código es como es antes de proponer cambiarlo. Las entradas se conservan tal como se escribieron, nombres de hitos incluidos (M2–M4 son los hitos anteriores a las primeras versiones); una entrada posterior puede matizar una anterior, como hace la 28 con la 1. Añade una fila nueva cuando tomes una decisión que, si no, alguien tendría que deducir a partir del código.

| # | Decisión | Resultado | Motivo |
|---|---|---|---|
| 1 | Componentes: JSON o tablas | **Columna JSON** ([almacenamiento](/es/internals/storage/#componentes-y-zonas-dinámicas-una-columna-json)) | Menos joins, publicación y versionado triviales, migraciones más simples. Filtrar por componentes repetibles es raro; se puede añadir más adelante con funciones JSON |
| 2 | Codificación JSON de `decimal` | **Número** por defecto, `api.decimal_as_string` opcional | La compatibilidad con Strapi maximiza la adopción; los valores exactos están disponibles cuando hacen falta |
| 3 | Formularios del panel | **Signal Forms** | Encaja con un panel basado en signals y zoneless; árboles de formulario dinámicos derivados del esquema |
| 4 | Idioma | **Inglés** para el código, la documentación y los commits | Alcance del código abierto |
| 5 | Compatibilidad con el REST de Strapi | **Mismos parámetros y misma forma de respuesta**; las extensiones propias de Verdin, bajo `actions/` | Los frontends migran con cambios mínimos |
| 6 | Algoritmo del JWT de administración | HS256 | Un único secreto, sencillo; EdDSA si algún día aparecen verificadores externos |
| 7 | IDs de documento | ULID (26 caracteres) | Ordenables y portables; los propios ids de Strapi son cadenas opacas de 24 caracteres y los clientes nunca los analizan |
| 8 | Contenido de la instantánea | El modelo físico, no el esquema | Las versiones posteriores pueden derivar tablas nuevas a partir de un esquema sin cambios |
| 9 | Nulabilidad de los atributos | Siempre admiten nulos; `required` se comprueba al publicar | Los borradores pueden estar incompletos (comportamiento de Strapi v5); añadir campos obligatorios es seguro |
| 10 | Aplicación de `unique` | Índice único sobre `(column, locale, publication_state)` | Sin condiciones de carrera; los borradores y su versión publicada comparten valores |
| 11 | Nombre de la columna de estado | `publication_state` | `state` es un nombre de atributo habitual |
| 12 | Palabras reservadas de SQL | Entrecomillar siempre los identificadores | Sin una lista arbitraria de nombres de atributo prohibidos |
| 13 | Construcción del DML | Constructor propio en lugar de `sea-query` | Predominan los detalles por dialecto (NULLs tipados, collations, formatos de SQLite); una abstracción menos |
| 14 | Escrituras sin `?status=draft` | Publicar (comportamiento del REST de Strapi v5) | Compatibilidad directa con los clientes existentes |
| 15 | Comparación de texto | Exacta por defecto en todos los motores; operadores `…i` para no distinguir mayúsculas | Los mismos resultados en MySQL que en PostgreSQL |
| 16 | Control de acceso provisional (M2–M3) | Interruptor `[api].open_access`, eliminado en M4 | Seguro por defecto hasta que existieran los permisos |
| 17 | «El destino pertenece a un solo documento» | Se aplica moviendo el destino, por estado | Un índice único impediría que un borrador y su versión publicada compartieran destino |
| 18 | Lados inversos (`mappedBy`) | De solo lectura | Escribir a través de ellos es ambiguo con borrador y publicación (¿qué versión del propietario?) |
| 19 | Posiciones de los enlaces | Se renumeran 1..n en cada escritura | Sin agotar los decimales; las listas son pequeñas |
| 20 | Filas de las tablas de enlaces | Conservan una clave primaria `id` | Tablas uniformes para el motor de migraciones y las reconstrucciones de SQLite |
| 21 | Biblioteca JWT | HS256 propio (HMAC-SHA256, verificación en tiempo constante, `alg` fijado) | `jsonwebtoken` 11 necesita un backend criptográfico que arrastra RSA |
| 22 | Tablas de la plataforma | Derivadas junto con el modelo de contenido | Un único mecanismo de migración para todo |
| 23 | Reutilización del token de refresco | Revocar toda la familia, sin margen de gracia | Sencillo y estricto; el panel vuelve a intentar el inicio de sesión |
| 24 | Borradores a través de la API de contenido | Permiso `readDrafts` aparte | Los tokens que leen el contenido publicado no filtran borradores |
| 25 | Orden de aplicación del constructor | Migrar, después escribir los archivos y después sustituir la aplicación en caliente | Una migración fallida deja intactos los archivos y la aplicación en marcha |
| 26 | Escrituras del panel | Solo se guardan borradores; publicar es una acción explícita | Coincide con lo que esperan los editores; la API de contenido mantiene la publicación por defecto de Strapi |
| 27 | Configuración de ejecución del panel | Etiqueta `<meta>`, no script en línea | Mantiene la CSP libre de scripts `unsafe-inline` |
| 28 | Filtros sobre campos de componentes | Operadores de ruta JSON por dialecto (`#>>`, `JSON_VALUE`, `json_extract`); `EXISTS` sobre los elementos del array para los componentes repetibles y las zonas dinámicas (0.8) | Las zonas dinámicas, solo por `__component`: sus elementos tienen campos distintos |
| 29 | i18n del panel | Transloco con catálogos JSON planos (`admin/public/i18n`) e ICU MessageFormat mediante FormatJS (un transpilador propio), detrás de una pequeña fachada `I18n`; no la i18n en tiempo de compilación de Angular | Cambio de idioma en ejecución; archivos estándar para Weblate/Crowdin; FormatJS interpreta los mensajes, así que la CSP estricta no necesita `unsafe-eval` (`@messageformat/core` compila con `new Function`); claves tipadas a partir de `en.json`, completitud comprobada con `npm run i18n:check` |
| 30 | Inicio de la semana | `Intl.Locale#getWeekInfo` de la etiqueta regional del navegador (en-GB ≠ en-US), con una tabla de regiones como respaldo y la opción de cambiarlo por usuario | Sigue la región de cada usuario aunque el idioma de la interfaz sea el mismo |
| 31 | Almacenamiento de la disposición del panel de inicio | Columna JSON `preferences` por usuario en `vd_admin_users` (≤ 64 KiB) | Sigue al usuario de un navegador a otro; el tema y el idioma se quedan en `localStorage` porque se aplican antes del inicio de sesión |
| 32 | Valor por defecto de `Secure` en la cookie de refresco | Activado en `start`, desactivado en `dev`, configurable | `verdin dev` sobre HTTP sin cifrar funciona en todos los navegadores; producción sigue siendo estricta |
| 33 | Perfil de release | Thin LTO, 1 codegen unit, stripped; se conserva el unwinding | Un handler que hace panic no debe tumbar el servidor |
| 34 | Documentos «sin ver» | Filas `vd_document_views` por usuario, que se eliminan para todos salvo para el editor cuando cambia un documento; se filtran con `NOT EXISTS` en SQL | La paginación y los recuentos siguen siendo exactos; no hay marcas de tiempo que comparar por fila |
| 35 | Votos y encuestas | Tablas de colaboración solo para administradores (`vd_document_votes`, `vd_polls`, `vd_poll_votes`), en cualquier tipo de contenido | Buzones de sugerencias y decisiones de equipo sin modelar campos de votos en cada esquema |
| 36 | Almacenamiento de medios | `object_store` para local y S3 | Un único camino de código; subidas multipart en streaming; RustFS en el entorno de desarrollo y en la CI |
| 37 | Enlaces de medios | Tablas de enlaces por campo, como las relaciones | La misma semántica de borrador y publicación que las relaciones; los borrados en cascada mantienen los enlaces coherentes |
| 38 | Actualizaciones de los permisos predefinidos | Marcador de versión en `vd_settings`, las adiciones se aplican una sola vez | Las instalaciones existentes obtienen los permisos nuevos sin deshacer las ediciones posteriores de un administrador |
| 39 | Funcionalidades en ejecución | Catálogo en `verdin-api`, interruptores en `vd_settings` (`features`), la aplicación se reconstruye en el sitio (ArcSwap) en todos los modos | Interruptores de plugins al estilo de Strapi sin reinicios; las funcionalidades no disponibles se enumeran con su versión prevista |
| 40 | Interfaz de la referencia de la API | Scalar (`scalar_api_reference`, bundle incrustado) en `{api}/docs`, solo cuando el documento es público; la CSP permite su arranque en línea por hash | Autoalojado (sin CDN, fuentes, agente de IA ni telemetría); el documento sigue siendo solo con token por defecto |
| 41 | GraphQL | Esquema dinámico de `async-graphql` construido con la aplicación; los argumentos y las selecciones se traducen al árbol de parámetros de REST y los analiza el mismo parser de consultas | Un único conjunto de reglas para filtros, paginación, populate, validación y permisos en REST y GraphQL; el populate derivado de la selección mantiene la carga agrupada |
| 42 | Eventos de documentos | Listeners en el Document Service, llamados después del commit | Los efectos secundarios (marcas de visto, futuros webhooks) se aplican a todas las APIs sin hooks por handler |
