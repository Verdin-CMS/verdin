---
title: Referencia de plugins
description: El manifiesto plugin.toml, las capacidades, los hooks y sus payloads, las funciones del host, las rutas, las tareas, la función de arranque, los campos GraphQL, los puntos de extensión del panel, los límites y las métricas.
sidebar:
  order: 3
---

<!-- Written from crates/verdin-plugins (lib.rs, manifest.rs), crates/verdin-api/src/plugins.rs,
plugins_admin.rs, crates/verdin-graphql/src/lib.rs, crates/verdin/src/metrics.rs and
admin/src/app/core/plugin-extensions.ts. -->

Esta página es el contrato completo entre Verdin y un plugin: el manifiesto, lo que Verdin envía
a cada función exportada y lo que espera de vuelta, y las funciones del host a las que puede
llamar un módulo. Para una introducción, consulta [Plugins](/es/extending/plugins/); para un
ejemplo completo, el [tutorial de plugins](/es/extending/plugin-tutorial/).

## Directorio del plugin

Cada plugin es un directorio dentro de `[plugins].path` (por defecto `plugins/`, junto a
`verdin.toml`):

| Archivo | Obligatorio | Contenido |
| --- | --- | --- |
| `plugin.toml` | sí | El manifiesto. |
| `plugin.wasm` | sí | El módulo (otra ruta con `wasm`). |
| `admin/` | no | Archivos que carga el panel de administración: el módulo `admin.script` y sus recursos. |

Al arrancar, Verdin carga todos los directorios que tienen un `plugin.toml`, por orden de
nombre. Un directorio se omite, y aparece con el motivo en **Configuración → Plugins**, cuando
su manifiesto no es válido, falta su módulo u otro plugin ya tiene su `name`.

## Manifiesto

```toml title="plugins/slugs/plugin.toml"
name = "slugs"
version = "1.0.0"
description = "Slugs from titles, and a color field"

[capabilities]
read = ["api::article"]
write = ["api::tag"]
http = ["api.example.com"]
kv = true
public_permissions = true

[limits]
timeout_ms = 5000
memory_mb = 64

[[hooks]]
on = "beforeCreate"
uid = "api::article"
function = "before_write"

[routes]
function = "handle"

[[jobs]]
schedule = "*/15 * * * *"
function = "refresh"

[startup]
function = "seed"
timeout_ms = 30000

[[graphql]]
name = "slugStats"
function = "stats"

[admin]
script = "index.js"

[[admin.widgets]]
id = "stats"
title = "Slug stats"
element = "slugs-stats"

[[admin.fields]]
id = "color"
title = "Color"
element = "slugs-color"
type = "string"

[[settings]]
key = "separator"
label = "Separator"
type = "select"
options = ["-", "_"]
default = "-"
```

Las claves desconocidas son errores, en todas las tablas.

### Claves de nivel superior

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `name` | obligatoria | El id del plugin en las URLs, los ajustes y los campos personalizados: letras minúsculas, dígitos y `-`, empezando por una letra, hasta 64 caracteres. |
| `version` | obligatoria | Se muestra en el panel y en el log. |
| `description` | sin definir | Se muestra en **Configuración → Plugins**. |
| `wasm` | `"plugin.wasm"` | El módulo, relativo al directorio del plugin (sin `..`, no absoluto). |
| `wasi` | `false` | Da WASI al módulo: un reloj y números aleatorios. En ningún caso archivos ni sockets. |

### `[capabilities]`

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `read` | `[]` | Tipos de contenido que `verdin_content` puede leer (`findMany`, `findOne`): uids como `api::article`, o `"*"` para todos. |
| `write` | `[]` | Tipos de contenido que puede `create`, `update`, `delete`, `publish` y `unpublish`. Implica `read`. |
| `http` | `[]` | Hosts a los que el módulo puede enviar peticiones HTTP: `api.example.com`, o `*.example.com`. |
| `kv` | `false` | El almacén clave-valor propio del plugin (`verdin_kv_get`, `verdin_kv_set`). |
| `public_permissions` | `false` | Leer y reemplazar los permisos de la API de contenido del rol público (`verdin_public_permissions`). |

Las capacidades solo limitan las llamadas al host. Los hooks se ejecutan sobre los tipos que
nombran diga lo que diga `read`, y cualquiera puede llegar a las rutas.

### `[limits]`

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `timeout_ms` | `5000` | Límite de tiempo de una llamada, en milisegundos. |
| `memory_mb` | `64` | Memoria máxima del módulo, en megabytes. |

Ambos deben ser positivos.

### `[[hooks]]`

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `on` | obligatoria | El evento, ver más abajo. |
| `uid` | `"*"` | El tipo de contenido (`api::article`), o `"*"` para todos. |
| `function` | obligatoria | La función exportada a la que llamar. |

Eventos:

| Antes de la escritura | Después de la escritura |
| --- | --- |
| `beforeCreate` | `afterCreate` |
| `beforeUpdate` | `afterUpdate` |
| `beforeDelete` | `afterDelete` |
| `beforePublish` | `afterPublish` |
| `beforeUnpublish` | `afterUnpublish` |
| `beforeDiscardDraft` | `afterDiscardDraft` |

Los nombres son los de los ciclos de vida de Strapi. Los hooks se ejecutan en las escrituras
desde el panel de administración, las APIs REST y GraphQL y los lanzamientos, pero no en las
escrituras hechas por los comandos `verdin import`. Las escrituras hechas por plugins ejecutan
los hooks after pero no los before (consulta
[Escrituras hechas por plugins](#escrituras-hechas-por-plugins)).

### `[routes]`

| Clave | Descripción |
| --- | --- |
| `function` | La función exportada que atiende todas las peticiones a `/api/plugins/<name>` y `/api/plugins/<name>/…`, con cualquier método. |

La ruta sigue a `[api].prefix`.

### `[[jobs]]`

| Clave | Descripción |
| --- | --- |
| `schedule` | Expresión cron, en UTC, con segundos opcionales: `*/15 * * * *`, `0 0 3 * * *`. |
| `function` | La función exportada a la que llamar. |

### `[startup]`

Una función que se ejecuta cuando el plugin arranca: lo que un proyecto de Strapi hace en
`bootstrap` (sembrar contenido, configurar el rol público).

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `function` | obligatoria | La función exportada a la que llamar. |
| `timeout_ms` | `30000` | Su propio límite de tiempo, en milisegundos (sembrar puede tardar más que un hook). Debe ser positivo. |

Consulta [Función de arranque](#función-de-arranque) para saber cuándo se ejecuta.

### `[[graphql]]`

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `name` | obligatoria | El nombre del campo: empieza por una letra minúscula, seguida de letras, dígitos y `_`. |
| `function` | obligatoria | La función exportada que lo resuelve. |
| `mutation` | `false` | Añade el campo a `Mutation` en lugar de a `Query`. |
| `description` | sin definir | La descripción del campo en el esquema. |

Cada entrada añade `name(args: JSON): JSON`. Un nombre que ya usa un tipo de contenido, o que
otro plugin tomó antes, se omite con un aviso en el log.

### `[admin]`

| Clave | Descripción |
| --- | --- |
| `script` | Módulo ES dentro de `admin/` que define los custom elements (sin `..`, no absoluto). |
| `[[admin.widgets]]` | Tipos de widget del panel de inicio: `id`, `title`, `element` y `description` opcional. |
| `[[admin.fields]]` | Campos personalizados: `id`, `title`, `element`, `type` (el tipo de atributo con el que se guarda el valor, como `string` o `json`) y `description` opcional. |

`element` es un nombre de custom element: letras minúsculas, dígitos y `-`, con al menos un `-`
(`slugs-color`).

### `[[settings]]`

Declara el formulario de **Configuración → Plugins → Configuración**. Sin ninguna entrada, los
ajustes son un objeto JSON libre.

| Clave | Por defecto | Descripción |
| --- | --- | --- |
| `key` | obligatoria | La clave en el objeto de ajustes: letras, dígitos y `_`, sin empezar por un dígito, única. |
| `label` | obligatoria | La etiqueta del formulario. |
| `type` | `"string"` | `string`, `text`, `url`, `number`, `integer`, `boolean` o `select`. |
| `description` | sin definir | Texto de ayuda bajo el campo. |
| `required` | `false` | Hace falta un valor (no vacío en el caso del texto), salvo que haya un `default`. |
| `options` | `[]` | Las opciones de un `select` (obligatorias en ese caso). |
| `default` | sin definir | Se usa cuando falta la clave o es `null`. Debe ser válido para el campo. |
| `min`, `max` | sin definir | Límites de los valores `number` e `integer`; límites de longitud de `string` y `text`. |

Los valores `url` están vacíos o son URLs `http(s)://`. Con un formulario, el servidor rechaza
los ajustes con claves desconocidas, tipos incorrectos, valores fuera de límites o valores
obligatorios que faltan (400).

## Funciones exportadas

Cada función exportada recibe un documento JSON y devuelve uno (o nada). Una salida vacía
cuenta como `null`; una salida que no es JSON cuenta como fallo.

### Hooks before

Entrada:

```json
{
  "event": "beforeUpdate",
  "uid": "api::article",
  "documentId": "01m3p88ry359w82nsx496mep5t",
  "locale": "en",
  "data": { "title": "Hello" }
}
```

| Campo | Descripción |
| --- | --- |
| `event` | El evento del hook. |
| `uid` | El tipo de contenido. |
| `documentId` | El documento, o `null` en `beforeCreate`. |
| `locale` | En los tipos localizados, el idioma que se escribe (el idioma por defecto si la petición no indicó ninguno); `null` en los demás tipos. |
| `data` | Los datos que se escriben, tal como los envió la petición: en create y update. `null` en los demás eventos. En update, solo los campos enviados. |

Salida:

| Salida | Efecto |
| --- | --- |
| `{ "data": { … } }` | Sustituye los datos que se escriben. Se validan igual que los originales. |
| `{ "error": "message" }` | Rechaza la escritura: el cliente recibe un 400 con el mensaje. |
| `{}` o cualquier otra cosa | La escritura continúa sin cambios. |

Cuando coinciden varios hooks, se ejecutan en el orden de los plugins (nombres de directorio) y
después en el orden del manifiesto; cada uno ve los datos que devolvió el anterior. Un hook que
falla (trap, tiempo agotado, salida no válida) se registra en el log y se omite: la escritura
continúa.

### Hooks after

Entrada: `{ "event", "uid", "documentId", "locale" }`, enviada después de confirmar la
escritura. La salida se ignora; los fallos se registran en el log. Lee la entrada con
`verdin_content` si necesitas sus campos (con la capacidad `read`).

### Rutas

Entrada:

```json
{
  "method": "GET",
  "path": "/stats",
  "query": "page=2&sort=title",
  "headers": { "accept": "application/json", "user-agent": "curl/8.7.1" },
  "body": "",
  "actor": { "kind": "public" }
}
```

| Campo | Descripción |
| --- | --- |
| `method` | El método HTTP. |
| `path` | La ruta después de `/api/plugins/<name>`, empezando por `/` (`/` para la raíz del plugin). |
| `query` | La query string sin procesar, sin `?` (vacía si no hay). |
| `headers` | Solo `content-type`, `accept`, `user-agent` y `accept-language`, si están presentes. |
| `body` | El cuerpo de la petición como cadena (el UTF-8 no válido se sustituye). |
| `actor` | Quién llama: `{ "kind": "public" }`, `{ "kind": "token", "id": 3 }` (un token de API) o `{ "kind": "user", "id": 12 }` (un usuario final con sesión iniciada). |

Una cabecera `Authorization` con un token no válido se rechaza con un 401 antes de llamar al
plugin. Los permisos del acceso público y de los tokens de API no se aplican: comprueba `actor`
tú mismo.

Salida:

| Campo | Por defecto | Descripción |
| --- | --- | --- |
| `status` | `200` | El estado HTTP. |
| `headers` | ninguna | Cabeceras de respuesta. Solo se conservan `content-type`, `cache-control`, `location`, `etag`, `last-modified` y `content-disposition`. |
| `body` | vacío | Una cadena se envía tal cual (`text/plain` salvo que definas `content-type`); cualquier otro valor JSON se envía como `application/json`. |

Un plugin desactivado o desconocido, o uno sin `[routes]`, responde 404. Una llamada fallida
responde 502 con `{ "data": null, "error": { "status": 502, "name": "PluginError", … } }`. Las
rutas comparten el `[server].body_limit` y el `[server].request_timeout_secs` de la API de
contenido.

### Tareas

Entrada: `{ "scheduledAt": "2026-09-29T03:00:00+00:00" }`, la hora para la que estaba
programada la ejecución. La salida se ignora; los fallos se registran en el log. Las tareas
solo se ejecutan mientras el plugin está activado, y solo en las instancias con
`[plugins].run_jobs = true`. Una ejecución perdida mientras el servidor estaba caído no se
recupera.

### Función de arranque

Entrada: `{ "reason": "start" | "enabled" | "settings" }`:

| `reason` | Cuándo |
| --- | --- |
| `start` | El servidor arrancó con el plugin activado. |
| `enabled` | El plugin se activó (aquí, o en otra instancia y se recogió aquí). |
| `settings` | Sus ajustes cambiaron mientras estaba activado (guardados aquí, o recogidos de otra instancia). |

Salida: `{ "error": "message" }` cuenta como un fallo; cualquier otra cosa (`{}`, vacío) como un
éxito. Un fallo (trap, time-out, `{ error }`) va al log del plugin y al log del servidor; el
plugin sigue activado y la función se ejecuta de nuevo en el siguiente arranque, activación o
cambio de ajustes.

La función se ejecuta en segundo plano, una vez que el servidor está en marcha, así que las
peticiones se sirven mientras tanto. Se ejecuta en una instancia del módulo propia con
`[startup].timeout_ms`, de modo que una siembra lenta no retiene los hooks ni las rutas del
plugin. Los hooks after que disparan sus escrituras se ejecutan cuando termina (consulta
[Escrituras hechas por plugins](#escrituras-hechas-por-plugins)). La memoria del módulo no se
comparte con la instancia habitual del plugin: guarda el estado en `verdin_kv_set` o en el
contenido.

Con varias instancias, solo ejecutan las funciones de arranque las que tienen
`[plugins].run_jobs = true` (una instancia, si sigues el [consejo de escalado](/es/deploy/scaling/)):
actúan sobre la base de datos compartida, así que basta con una vez. Escribe la función de modo
que ejecutarla de nuevo sea inofensivo: busca lo que siembras antes de crearlo.

### Campos GraphQL

Entrada: `{ "args": …, "actor": … }`, con `args` el argumento `args` del campo (cualquier JSON,
o `null`) y `actor` como en las rutas. La salida es el valor del campo. Un fallo, o un plugin
desactivado, responde con un error GraphQL con el código `PLUGIN_ERROR`. Como en las rutas, es
el plugin quien comprueba el acceso.

## Funciones del host

Impórtalas del espacio de nombres `extism:host/user` (`extern "ExtismHost"` en Rust). Reciben y
devuelven JSON como cadenas; `Json<Value>` de `extism-pdk` se encarga de la conversión.

| Función | Entrada | Salida |
| --- | --- | --- |
| `verdin_log` | `{ "level": "info" \| "warn" \| "error", "message": "…" }` | ninguna |
| `verdin_content` | Una petición de contenido (ver más abajo) | El resultado, o `{ "error": "…" }` |
| `verdin_kv_get` | La clave, como cadena simple | El valor JSON guardado, o `null` |
| `verdin_kv_set` | `{ "key": "…", "value": … }` | ninguna |
| `verdin_config` | ninguna | El objeto de ajustes, con los valores por defecto declarados ya rellenados |
| `verdin_public_permissions` | `{ "op": "get" }` o `{ "op": "set", "permissions": [...] }` | `{ "permissions": [...] }`, o `{ "error": "…" }` |

Un módulo que importa una función del host que el servidor no tiene (un Verdin más antiguo) no
se puede cargar: cada llamada a él falla con `unknown import` en el log del servidor.

### `verdin_log`

Escribe en el log del servidor (con el nombre del plugin) y en el log del plugin en
**Configuración → Plugins → Registros**. Los demás niveles cuentan como `info`. El log del
plugin conserva en memoria los últimos 200 mensajes, cada uno recortado a 2.000 caracteres.

### `verdin_content`

```json
{ "op": "findMany", "uid": "api::article", "query": { "filters": { "title": { "$eq": "x" } }, "sort": ["title"] } }
```

| Campo | Lo usa | Descripción |
| --- | --- | --- |
| `op` | todas | `findMany`, `findOne`, `create`, `update`, `delete`, `publish` o `unpublish`. |
| `uid` | todas | El tipo de contenido. Debe estar en las capacidades. |
| `documentId` | `findOne`, `update`, `delete`, `publish`, `unpublish` | El documento. |
| `query` | `findMany`, `findOne` | Los parámetros de la API REST como objeto JSON: `filters`, `sort`, `fields`, `populate`, `pagination`, `status`. |
| `data` | `create`, `update` | Los campos que se escriben, como en el `data` de una petición REST. |
| `status` | `create`, `update` | `"draft"` guarda un borrador. Si no, la escritura se publica, como una escritura REST sin `?status=draft`. |
| `locale` | todas | El idioma que se lee o se escribe. |

Resultados:

| `op` | Resultado |
| --- | --- |
| `findMany` | `{ "documents": [...], "meta": { "pagination": {…} } }` |
| `findOne` | `{ "document": {…} }` (`null` si no se encuentra) |
| `create`, `update` | `{ "documentId": "…" }` |
| `delete` | `{ "deleted": true }` |
| `publish` | `{ "published": true }` |
| `unpublish` | `{ "unpublished": true }` |

Una llamada fuera de las capacidades, una operación desconocida, un error de validación o un
documento que no existe responden `{ "error": "…" }` en su lugar. Las lecturas devuelven las
versiones publicadas salvo que la consulta pida `"status": "draft"`.

#### Escrituras hechas por plugins

Las escrituras a través de `verdin_content` se saltan los hooks **before** de todos los
plugins, así que un plugin no puede entrar en bucle con sus propios cambios ahí, y las reglas
que pongas en hooks before (valores por defecto, comprobaciones) no se les aplican. Todo lo
demás se aplica: la validación, las etapas de revisión, los webhooks, el historial, el registro
de auditoría y los hooks **after** de todos los plugins, incluido el que escribe.

Los hooks after que disparan las escrituras de un plugin no se ejecutan dentro de la escritura:
se ponen en cola y se ejecutan cuando la llamada del plugin (ruta, tarea, resolver de GraphQL,
hook o función de arranque) ha terminado y ha liberado la instancia del plugin, antes de enviar
la respuesta de la ruta. Así, un plugin puede escribir un tipo sobre el que tiene hooks after, y
las cadenas a través de varios plugins funcionan.

- Los hooks que escriben disparan más hooks, **como máximo `4` niveles de profundidad** (una
  escritura desde REST o GraphQL es el nivel 1). Los hooks más profundos se omiten con un aviso
  en el log del plugin, lo que impide que un hook que escribe en el tipo que escucha entre en
  bucle para siempre.
- Las funciones del host (`verdin_content`, `verdin_public_permissions`, el almacén
  clave-valor) se detienen en el límite de tiempo de la llamada y devuelven un error al módulo,
  y quien llama espera como máximo el límite de tiempo más 10 segundos a un plugin ocupado. Una
  llamada atascada no puede retener al plugin, ni una parada ordenada, para siempre.

### `verdin_kv_get` y `verdin_kv_set`

Un almacén clave-valor por plugin, en la base de datos de Verdin, compartido por todas las
instancias. Las claves miden de 1 a 255 bytes; los valores son cualquier JSON. Guardar `null`
elimina la clave. Sin la capacidad `kv`, las lecturas devuelven `null` y las escrituras se
ignoran.

### `verdin_config`

Devuelve los ajustes guardados en **Configuración → Plugins**, con el `default` de cada ajuste
declarado rellenado en las claves que faltan. `{}` si no hay nada guardado.

### `verdin_public_permissions`

Lee o reemplaza los permisos de la API de contenido del rol público, lo que edita
**Configuración → Acceso público**. Necesita la capacidad `public_permissions`; sin ella, cada
llamada responde `{ "error": "…" }`.

```json
{ "op": "set", "permissions": [
  { "subject": "api::article", "action": "find" },
  { "subject": "api::article", "action": "findOne" },
  { "subject": "api::comment", "action": "create" }
] }
```

| `op` | Efecto |
| --- | --- |
| `get` | Nada; devuelve los permisos actuales. |
| `set` | Reemplaza **todos** los permisos públicos por `permissions` (una lista vacía los elimina todos). |

Ambas responden `{ "permissions": [{ "subject", "action" }, …] }`, ordenados. `subject` es el uid
de un tipo de contenido, `plugin::upload` (la biblioteca de medios),
`plugin::users-permissions.user` (los usuarios finales a través de la API de contenido) o
`plugin::i18n.locale` (solo `find`). `action` es `find`, `findOne`, `create`, `update`, `delete`,
`publish` o `readDrafts` (las dos últimas no se aplican a las subidas ni a los usuarios
finales). Se comprueban como la cuadrícula de permisos del administrador: un subject o una
acción desconocidos, o que no se aplican, responden `{ "error": "…" }` y no cambian nada. Cada
`set` se escribe en el log del servidor.

### HTTP

Con los hosts incluidos en `http`, usa el soporte HTTP de Extism (`extism_pdk::http::request` en
Rust). Las peticiones a otros hosts fallan.

## Puntos de extensión del panel

El panel de administración pide al servidor las extensiones de los plugins activados e importa
cada `admin.script` una vez, como módulo ES, desde `/admin/plugins/<name>/<script>` (bajo
`[admin].path`). Los archivos del directorio `admin/` del plugin se sirven ahí mientras el
plugin está activado, con `X-Content-Type-Options: nosniff` y `Cache-Control: no-cache`. El
módulo debe definir los custom elements que nombra el manifiesto; un elemento que no se define
en 3 segundos se omite.

### Widgets

Cada entrada `[[admin.widgets]]` es un tipo de widget que los administradores pueden añadir al
panel de inicio. El elemento recibe una propiedad `context`:

| Propiedad | Descripción |
| --- | --- |
| `apiBase` | La base de la API de contenido, como `/api`. |
| `adminApiBase` | La base de la API de administración, como `/admin/api`. |
| `fetch(path, init)` | `fetch` con las credenciales del administrador con sesión iniciada. Las rutas relativas se resuelven contra `adminApiBase`; las rutas bajo cualquiera de las dos bases y las URLs absolutas se mantienen. |

```js title="plugins/slugs/admin/index.js"
class SlugStats extends HTMLElement {
  set context(context) {
    // Admin API, with the admin's session.
    context.fetch('auth/me').then((response) => response.json())
      .then(({ data }) => { this.textContent = `Hello ${data.firstname ?? data.email}`; });
    // The plugin's own route, on the content API: sent without the admin's session.
    context.fetch(`${context.apiBase}/plugins/slugs/stats`).then((response) => response.json())
      .then((stats) => { this.title = JSON.stringify(stats); });
  }
}
customElements.define('slugs-stats', SlugStats);
```

`context.fetch` envía la sesión del administrador solo en las peticiones a la API de
administración. Las rutas bajo `context.apiBase` (la API de contenido, incluidas las rutas de
tu plugin) van sin ella, porque la API de contenido no acepta sesiones de administración; se
responden con los permisos del rol público. Antes de la 0.10 también enviaba ahí la sesión y
esas peticiones fallaban; los widgets escritos para la 0.9 que llaman a `fetch` directamente
siguen funcionando.

### Campos personalizados

Cada entrada `[[admin.fields]]` es un campo que los atributos pueden usar con
`"customField": "plugin::<name>.<id>"`; el `type` del atributo debe coincidir con la forma en
que el campo guarda su valor. El **Constructor de tipos de contenido** lo ofrece. El elemento
recibe:

| Propiedad | Descripción |
| --- | --- |
| `value` | El valor actual. |
| `disabled` | Si la edición está desactivada. |
| `attribute` | La definición del atributo en el esquema. |
| `locale` | El idioma que se está editando. |

Comunica un valor nuevo con un evento `change` cuyo `detail` es el valor (o, sin `detail`, a
través de su propia propiedad `value`). Cuando el plugin está desactivado o falta su elemento,
el editor muestra el input normal del tipo de almacenamiento. Consulta
[Tipos de atributo](/es/reference/attribute-types/).

## Ejecución y límites

| Límite | Valor |
| --- | --- |
| Tiempo por llamada | `[limits].timeout_ms`, por defecto 5.000 ms (`[startup].timeout_ms`, por defecto 30.000 ms, para la función de arranque) |
| Memoria | `[limits].memory_mb`, por defecto 64 MB |
| Concurrencia | Una llamada a la vez por plugin; las llamadas se esperan unas a otras (la función de arranque se ejecuta junto a ellas) |
| Instancia del módulo | Una por plugin, creada en el primer uso; se vuelve a crear después de que falle una llamada (su memoria se pierde). La función de arranque recibe una nueva en cada ejecución |
| Log | 200 mensajes por plugin, de 2.000 caracteres cada uno, en memoria |
| Claves KV | De 1 a 255 bytes |
| Cabeceras de petición de las rutas | `content-type`, `accept`, `user-agent`, `accept-language` |
| Cabeceras de respuesta de las rutas | `content-type`, `cache-control`, `location`, `etag`, `last-modified`, `content-disposition` |

Los cambios en un manifiesto o en un módulo se aplican tras un reinicio; los interruptores y los
ajustes se aplican al momento. Gestionar plugins necesita `plugins.manage` (consulta la
[referencia de permisos](/es/reference/permissions/)).

## Métricas

Con [`[metrics]`](/es/deploy/monitoring/) activado, `/_metrics` informa de cada llamada que
llegó a una función exportada:

| Métrica | Tipo | Etiquetas | Significado |
| --- | --- | --- | --- |
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`, `kind`, `function` | Tiempo que tardaron las funciones de los plugins. Buckets de 5 ms a 10 s. |
| `verdin_plugin_call_errors_total` | counter | `plugin`, `kind`, `function` | Llamadas que fallaron: un trap, un time-out, una salida que no es JSON o un `{ error }` de una función de arranque. |

`kind` es `hook`, `route`, `job`, `startup` o `graphql`. Un hook before que rechaza una
escritura con `{ error }` dio una respuesta, así que no se cuenta como un fallo. Las llamadas a
una función que el módulo no exporta no se registran, así que las etiquetas quedan acotadas por
los plugins instalados. Las series aparecen tras la primera llamada de un plugin; cada
instancia cuenta sus propias llamadas.
