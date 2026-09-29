---
title: Panel de administración
description: Cómo está estructurado el panel de administración en Angular de Verdin, cómo construye formularios y listas a partir del esquema, y cómo se compila, se incrusta en el binario y se traduce.
sidebar:
  order: 6
  label: Panel de administración
---

Esta página es para quienes contribuyen al panel de administración en `admin/`: cómo está organizada la aplicación Angular, cómo convierte el esquema de contenido en formularios y listas, y cómo acaba dentro del binario `verdin`. Cómo usar el panel se explica en las guías; cómo funciona la parte de servidor de la API de administración, en la [referencia de la API de administración](/es/api/admin/).

El panel es una single-page app en Angular 22: componentes standalone, detección de cambios zoneless, signals, rutas con carga diferida y componentes de spartan/ui sobre Tailwind CSS v4.

## Estructura

```text
admin/
├── src/app/
│   ├── app.config.ts     # providers: router, HttpClient interceptors, Transloco, icons
│   ├── app.routes.ts     # lazy routes, guards (auth, permissions, unsaved changes)
│   ├── core/             # services and pure models: api, auth, schema, i18n, permissions…
│   ├── layout/           # the shell (sidebar, header), home, deploy button
│   ├── features/
│   │   ├── auth/         # login, first admin, invitations, password reset
│   │   ├── dashboard/    # home widgets
│   │   ├── content/      # lists, the entry editor, history, releases, review, import
│   │   │   ├── fields/   # schema-driven form controls and the form model
│   │   │   └── collab/   # comments and tasks
│   │   ├── builder/      # content-type builder (verdin dev only)
│   │   ├── media/        # media library
│   │   ├── releases/
│   │   ├── profile/      # own account, two-factor, passkeys, sessions
│   │   └── settings/     # users, roles, tokens, webhooks, locales, plugins, site features…
│   └── shared/
│       ├── ui/           # spartan helm components, owned by the project
│       └── components/   # app-level shared components (confirm dialog, page header…)
├── public/i18n/          # translation catalogs, one JSON file per language
├── scripts/check-i18n.mjs
└── e2e/                  # Playwright tests and the server they run against
```

El **estado** vive en signals dentro de servicios inyectables de `core/` (`Auth`, `Schema`, `I18n`, `Theme`…). No hay librería de store.

El **acceso a la API** pasa por `core/api.ts`, un pequeño envoltorio basado en promesas sobre el `HttpClient` de Angular, con tipos escritos a mano en `core/types.ts`. La configuración de ejecución (ruta del panel, prefijo de la API, modo, marca) viene de una etiqueta `<meta name="verdin-config">` que inyecta el servidor.

**Sesión.** El token de acceso solo vive en memoria; el token de refresco es una cookie `HttpOnly` limitada a las rutas de autenticación. Un interceptor HTTP añade el bearer token y, ante un `401`, refresca una vez y reintenta; si el refresco falla, envía al usuario a la página de inicio de sesión. Las peticiones de refresco y de cierre de sesión llevan la cabecera `X-Verdin-CSRF` que exige el servidor. Los guards restauran la sesión a partir de la cookie al cargar la página. Un `403` que indica que el rol exige autenticación de dos factores envía al usuario a configurarla.

## Formularios a partir del esquema

El editor de entradas (`features/content/edit.ts`) no tiene código por tipo. Lee los tipos de contenido y los componentes de `GET /admin/api/content-types` y `GET /admin/api/components`, y la disposición del editor de los ajustes de la vista de edición, y construye el formulario en tiempo de ejecución con **Signal Forms** (`@angular/forms/signals`):

- El modelo del documento es un signal de un objeto simple (`FormModel` en `fields/model.ts`); el árbol de campos y sus validadores se derivan del esquema.
- Un componente recursivo `vd-fields` (`fields/fields.ts`) muestra cualquier mapa de atributos contra un árbol de campos. Los textos, las fechas y las horas usan inputs nativos enlazados con `[formField]`. Unos `FormValueControl` propios gestionan los números (admiten nulos; los enteros grandes siguen siendo cadenas), los interruptores, las enumeraciones, las fechas con hora (hora local en el input, UTC en el modelo), el JSON, el Markdown, los `blocks` (TipTap), los medios, las relaciones (selector con búsqueda mientras se escribe y ordenación) y las relaciones polimórficas.
- Los componentes son fieldsets anidados; los componentes repetibles y las zonas dinámicas son listas reordenables. Los plugins pueden registrar tipos de campo propios, que se muestran como custom elements.
- `toModel` convierte un documento populado en el modelo del formulario (las relaciones pasan a ser `documentId`s y los archivos, ids), y `toPayload` hace la conversión inversa al payload `data`: las cadenas vacías pasan a `null`, y se descartan las claves de renderizado (`__key`) y los lados de solo lectura (`mappedBy`, `morphOne`, `morphMany`). Ambos tienen pruebas unitarias en `fields/model.spec.ts`.
- La validación derivada del esquema da respuesta inmediata. Los campos condicionales (`conditions.visible`) se evalúan en el navegador con una versión del evaluador de JSON Logic del servidor (`core/logic.ts`). Las reglas de validación entre campos solo las comprueba el servidor. El servidor sigue siendo la autoridad: sus entradas `details.errors[].path` se asocian de vuelta al campo correspondiente.
- Guardar es explícito, con seguimiento de cambios y un aviso al salir de la página (un route guard más `beforeunload`). Los botones **Publicar**, **Despublicar** y **Descartar cambios** aparecen según el estado del documento. El panel solo guarda borradores; publicar es siempre una acción aparte.

La disposición del editor (orden de los campos, anchos, etiquetas, descripciones, campos de solo lectura, el campo que da nombre a las entradas relacionadas) la comparten todos los administradores y se guarda en el servidor en `vd_settings`; se cambia desde la página **Configurar la vista** con el permiso `views.manage`.

## Listas

Las listas de contenido (`features/content/list.ts`) usan la tabla de spartan helm con paginación, ordenación y filtros en el servidor. Los filtros, la búsqueda (`_q`) y la página se reflejan en la URL, así que una lista filtrada es un enlace que se puede compartir. Cada administrador elige por tipo las columnas visibles, el orden por defecto y el tamaño de página (`list-view.ts`); esas elecciones se guardan en sus propias preferencias en el servidor, así que le siguen de un navegador a otro. Las listas también se actualizan en directo a partir del flujo de eventos de administración.

## Constructor de tipos de contenido

El **Constructor de tipos de contenido** solo es visible cuando el servidor se ejecuta en modo desarrollo (`verdin dev`) y el administrador tiene `schema.manage`. Edita los tipos de contenido y los componentes en su formato de archivo: campos, tipos de relación y destinos (creando el atributo inverso en el destino), componentes, zonas dinámicas, longitudes, rangos y los indicadores `required`, `unique` y `private`.

Cada cambio se envía primero a `POST /admin/api/schema/plan`, que valida el esquema resultante y devuelve los pasos de la migración con su riesgo, su SQL y las sugerencias de renombrado que el usuario puede aceptar. Al confirmar se llama a `POST /admin/api/schema/apply` con el nivel de riesgo aceptado y los renombrados. El servidor migra, escribe `schema/*.json` y sustituye la aplicación en marcha por la del nuevo esquema sin reiniciar. Consulta el [motor de migraciones](/es/internals/migrations/) para ver qué pasa en el servidor.

## Compilación y distribución

- `ng build` escribe la compilación de producción en `admin/dist/admin/browser`, con `<base href="/admin/">`.
- El servidor incrusta esa carpeta con `rust-embed` cuando se compila con la feature `embed-admin`, que usan las compilaciones de release y la imagen de Docker. Sin la feature, o cuando se define `[admin].assets_dir`, sirve los archivos desde disco. `assets_dir` tiene prioridad sobre la compilación incrustada.
- El servidor reescribe `<base href>` con `[admin].path` e inyecta la configuración de ejecución como etiqueta `<meta>`, no como script en línea. Cambiar `admin.path` nunca exige recompilar el panel.
- Las rutas desconocidas sin extensión de archivo recurren a `index.html` para el enrutado en el cliente. Los bundles con huella (`main-ABC123.js`) se cachean como `immutable` durante un año; todo lo demás es `no-cache`.
- Cada respuesta del panel lleva una Content Security Policy estricta (`script-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`…), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` y `Referrer-Policy: strict-origin-when-cross-origin`. La inserción en línea del CSS crítico de Angular está desactivada en `angular.json` porque depende de manejadores de eventos en línea que la política prohíbe.

Para trabajar en el frontend, arranca el servidor y después `npm start` en `admin/`: `ng serve` hace de proxy de `/admin/api` y `/api` hacia `http://localhost:1337` (`admin/proxy.conf.json`).

## Traducciones

El panel se traduce en tiempo de ejecución con Transloco, no con la i18n en tiempo de compilación de Angular, así que una sola compilación sirve para todos los idiomas y los usuarios pueden cambiar de idioma sin recargar.

- Los catálogos son archivos JSON planos en `admin/public/i18n/` (`en.json` es el original), que se cargan bajo demanda.
- Los mensajes usan ICU MessageFormat (`{name}`, `{count, plural, one {# entry} other {# entries}}`), interpretado por FormatJS (`intl-messageformat`) mediante un transpilador de Transloco propio. FormatJS interpreta los mensajes en lugar de compilarlos a funciones, así que la CSP no necesita `unsafe-eval`.
- Las claves de los mensajes están tipadas a partir de `en.json` (`core/i18n/keys.ts`): usar una clave que no existe es un error de compilación.
- `npm run i18n:check` comprueba cada catálogo contra `en.json`: mismas claves, sintaxis ICU válida, los mismos argumentos y todas las categorías de plural del idioma. La CI lo ejecuta.
- El servicio `I18n` también ofrece formato según el idioma y el primer día de la semana, tomados de la configuración regional del navegador, con la posibilidad de cambiarlos por usuario.

Cómo añadir o actualizar un idioma se explica en [traducir](/es/project/translating/).
