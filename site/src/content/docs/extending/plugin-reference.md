---
title: Plugin reference
description: The plugin.toml manifest, capabilities, hooks and their payloads, host functions, routes, jobs, GraphQL fields, admin extension points and limits.
sidebar:
  order: 3
---

<!-- Written from crates/verdin-plugins (lib.rs, manifest.rs), crates/verdin-api/src/plugins.rs,
plugins_admin.rs, crates/verdin-graphql/src/lib.rs and admin/src/app/core/plugin-extensions.ts. -->

This page is the complete contract between Verdin and a plugin: the manifest, what Verdin
sends to each exported function and expects back, and the host functions a module can
call. For an introduction, see [Plugins](/extending/plugins/); for a worked example, the
[plugin tutorial](/extending/plugin-tutorial/).

## Plugin directory

Each plugin is a directory under `[plugins].path` (default `plugins/`, next to
`verdin.toml`):

| File | Required | Contents |
| --- | --- | --- |
| `plugin.toml` | yes | The manifest. |
| `plugin.wasm` | yes | The module (another path with `wasm`). |
| `admin/` | no | Files the admin panel loads: the `admin.script` module and its assets. |

At startup Verdin loads every directory that has a `plugin.toml`, in name order. A
directory is skipped, and listed with the reason in **Settings → Plugins**, when its
manifest is invalid, its module is missing, or another plugin already has its `name`.

## Manifest

```toml title="plugins/slugs/plugin.toml"
name = "slugs"
version = "1.0.0"
description = "Slugs from titles, and a color field"

[capabilities]
read = ["api::article"]
write = ["api::tag"]
http = ["api.example.com"]
kv = true

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

Unknown keys are errors, in every table.

### Top-level keys

| Key | Default | Description |
| --- | --- | --- |
| `name` | required | The plugin's id in URLs, settings and custom fields: lowercase letters, digits and `-`, starting with a letter, at most 64 characters. |
| `version` | required | Shown in the admin and the log. |
| `description` | unset | Shown in **Settings → Plugins**. |
| `wasm` | `"plugin.wasm"` | The module, relative to the plugin directory (no `..`, not absolute). |
| `wasi` | `false` | Give the module WASI: a clock and random numbers. No files or sockets either way. |

### `[capabilities]`

| Key | Default | Description |
| --- | --- | --- |
| `read` | `[]` | Content types `verdin_content` may read (`findMany`, `findOne`): uids such as `api::article`, or `"*"` for all. |
| `write` | `[]` | Content types it may `create`, `update`, `delete`, `publish` and `unpublish`. Implies `read`. |
| `http` | `[]` | Hosts the module may send HTTP requests to: `api.example.com`, or `*.example.com`. |
| `kv` | `false` | The plugin's own key-value storage (`verdin_kv_get`, `verdin_kv_set`). |

Capabilities limit host calls only. Hooks run on the types they name whatever `read` says,
and routes are reachable by anyone.

### `[limits]`

| Key | Default | Description |
| --- | --- | --- |
| `timeout_ms` | `5000` | Time limit of one call, in milliseconds. |
| `memory_mb` | `64` | Largest memory of the module, in megabytes. |

Both must be positive.

### `[[hooks]]`

| Key | Default | Description |
| --- | --- | --- |
| `on` | required | The event, below. |
| `uid` | `"*"` | The content type (`api::article`), or `"*"` for all. |
| `function` | required | The exported function to call. |

Events:

| Before the write | After the write |
| --- | --- |
| `beforeCreate` | `afterCreate` |
| `beforeUpdate` | `afterUpdate` |
| `beforeDelete` | `afterDelete` |
| `beforePublish` | `afterPublish` |
| `beforeUnpublish` | `afterUnpublish` |
| `beforeDiscardDraft` | `afterDiscardDraft` |

The names are Strapi's lifecycle names. Hooks run on writes from the admin panel, the REST
and GraphQL APIs and releases, but not on writes made by plugins (see
[Writes made by plugins](#writes-made-by-plugins)) or by the `verdin import` commands.

### `[routes]`

| Key | Description |
| --- | --- |
| `function` | The exported function that serves every request to `/api/plugins/<name>` and `/api/plugins/<name>/…`, any method. |

The path follows `[api].prefix`.

### `[[jobs]]`

| Key | Description |
| --- | --- |
| `schedule` | Cron expression, in UTC, with optional seconds: `*/15 * * * *`, `0 0 3 * * *`. |
| `function` | The exported function to call. |

### `[[graphql]]`

| Key | Default | Description |
| --- | --- | --- |
| `name` | required | The field name: starts with a lowercase letter, then letters, digits and `_`. |
| `function` | required | The exported function that resolves it. |
| `mutation` | `false` | Add the field to `Mutation` instead of `Query`. |
| `description` | unset | The field's description in the schema. |

Each entry adds `name(args: JSON): JSON`. A name that a content type already uses, or
that another plugin took first, is skipped with a warning in the log.

### `[admin]`

| Key | Description |
| --- | --- |
| `script` | ES module under `admin/` that defines the custom elements (no `..`, not absolute). |
| `[[admin.widgets]]` | Dashboard widget types: `id`, `title`, `element`, optional `description`. |
| `[[admin.fields]]` | Custom fields: `id`, `title`, `element`, `type` (the attribute type the value is stored as, such as `string` or `json`), optional `description`. |

`element` is a custom element name: lowercase letters, digits and `-`, with at least one
`-` (`slugs-color`).

### `[[settings]]`

Declares the form of **Settings → Plugins → Settings**. Without any, the settings are a
free JSON object.

| Key | Default | Description |
| --- | --- | --- |
| `key` | required | The key in the settings object: letters, digits and `_`, not starting with a digit, unique. |
| `label` | required | The form label. |
| `type` | `"string"` | `string`, `text`, `url`, `number`, `integer`, `boolean` or `select`. |
| `description` | unset | Help text under the field. |
| `required` | `false` | A value (non-empty for text) is needed, unless there is a `default`. |
| `options` | `[]` | The choices of a `select` (required for it). |
| `default` | unset | Used when the key is missing or `null`. Must fit the field. |
| `min`, `max` | unset | Bounds of `number` and `integer` values; length bounds of `string` and `text`. |

`url` values are empty or `http(s)://` URLs. With a form, the server refuses settings with
unknown keys, wrong types, values out of bounds or missing required values (400).

## Exported functions

Every exported function takes one JSON document and returns one (or nothing). An empty
output counts as `null`; output that is not JSON counts as a failure.

### Before hooks

Input:

```json
{
  "event": "beforeUpdate",
  "uid": "api::article",
  "documentId": "01m3p88ry359w82nsx496mep5t",
  "locale": "en",
  "data": { "title": "Hello" }
}
```

| Field | Description |
| --- | --- |
| `event` | The hook's event. |
| `uid` | The content type. |
| `documentId` | The document, or `null` on `beforeCreate`. |
| `locale` | On localized types, the locale written (the default locale when the request named none); `null` on other types. |
| `data` | The data being written, as the request sent it: on create and update. `null` for the other events. On update, only the fields sent. |

Output:

| Output | Effect |
| --- | --- |
| `{ "data": { … } }` | Replaces the data written. It is validated like the original. |
| `{ "error": "message" }` | Refuses the write: the caller gets a 400 with the message. |
| `{}` or anything else | The write goes on unchanged. |

When several hooks match, they run in plugin order (directory names), then manifest order;
each sees the data the previous one returned. A hook that fails (trap, timeout, invalid
output) is logged and skipped: the write goes on.

### After hooks

Input: `{ "event", "uid", "documentId", "locale" }`, sent after the write is committed.
The output is ignored; failures are logged. Read the entry with `verdin_content` if you
need its fields (with the `read` capability).

### Routes

Input:

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

| Field | Description |
| --- | --- |
| `method` | The HTTP method. |
| `path` | The path after `/api/plugins/<name>`, starting with `/` (`/` for the plugin's root). |
| `query` | The raw query string, without `?` (empty when there is none). |
| `headers` | Only `content-type`, `accept`, `user-agent` and `accept-language`, when present. |
| `body` | The request body as a string (invalid UTF-8 is replaced). |
| `actor` | Who is calling: `{ "kind": "public" }`, `{ "kind": "token", "id": 3 }` (an API token) or `{ "kind": "user", "id": 12 }` (a signed-in end user). |

An `Authorization` header with an invalid token is refused with a 401 before the plugin is
called. Public access and API token permissions are not applied: check `actor` yourself.

Output:

| Field | Default | Description |
| --- | --- | --- |
| `status` | `200` | The HTTP status. |
| `headers` | none | Response headers. Only `content-type`, `cache-control`, `location`, `etag`, `last-modified` and `content-disposition` are kept. |
| `body` | empty | A string is sent as is (`text/plain` unless you set `content-type`); any other JSON value is sent as `application/json`. |

A disabled or unknown plugin, or one without `[routes]`, answers 404. A failed call
answers 502 with `{ "data": null, "error": { "status": 502, "name": "PluginError", … } }`.
Routes share the content API's `[server].body_limit` and `[server].request_timeout_secs`.

### Jobs

Input: `{ "scheduledAt": "2026-09-29T03:00:00+00:00" }`, the time the run was scheduled
for. The output is ignored; failures are logged. Jobs run only while the plugin is on, and
only on instances with `[plugins].run_jobs = true`. A run missed while the server was down
is not made up.

### GraphQL fields

Input: `{ "args": …, "actor": … }`, with `args` the field's `args` argument (any JSON, or
`null`) and `actor` as for routes. The output is the field's value. A failure, or a
disabled plugin, answers a GraphQL error with the code `PLUGIN_ERROR`. As with routes, the
plugin checks access.

## Host functions

Import them from the `extism:host/user` namespace (`extern "ExtismHost"` in Rust). They
take and return JSON as strings; `Json<Value>` in `extism-pdk` handles the conversion.

| Function | Input | Output |
| --- | --- | --- |
| `verdin_log` | `{ "level": "info" \| "warn" \| "error", "message": "…" }` | none |
| `verdin_content` | A content request (below) | The result, or `{ "error": "…" }` |
| `verdin_kv_get` | The key, as a plain string | The stored JSON value, or `null` |
| `verdin_kv_set` | `{ "key": "…", "value": … }` | none |
| `verdin_config` | none | The settings object, with declared defaults filled in |

### `verdin_log`

Writes to the server log (with the plugin's name) and to the plugin's log in **Settings →
Plugins → Logs**. Other levels count as `info`. The plugin's log keeps the last 200
messages, each cut at 2,000 characters, in memory.

### `verdin_content`

```json
{ "op": "findMany", "uid": "api::article", "query": { "filters": { "title": { "$eq": "x" } }, "sort": ["title"] } }
```

| Field | Used by | Description |
| --- | --- | --- |
| `op` | all | `findMany`, `findOne`, `create`, `update`, `delete`, `publish` or `unpublish`. |
| `uid` | all | The content type. Must be in the capabilities. |
| `documentId` | `findOne`, `update`, `delete`, `publish`, `unpublish` | The document. |
| `query` | `findMany`, `findOne` | The REST API parameters as a JSON object: `filters`, `sort`, `fields`, `populate`, `pagination`, `status`. |
| `data` | `create`, `update` | The fields to write, as in a REST request's `data`. |
| `status` | `create`, `update` | `"draft"` saves a draft. Otherwise the write is published, as a REST write without `?status=draft`. |
| `locale` | all | The locale to read or write. |

Results:

| `op` | Result |
| --- | --- |
| `findMany` | `{ "documents": [...], "meta": { "pagination": {…} } }` |
| `findOne` | `{ "document": {…} }` (`null` when not found) |
| `create`, `update` | `{ "documentId": "…" }` |
| `delete` | `{ "deleted": true }` |
| `publish` | `{ "published": true }` |
| `unpublish` | `{ "unpublished": true }` |

A call outside the capabilities, an unknown operation, a validation error or a missing
document answers `{ "error": "…" }` instead. Reads return published versions unless the
query asks for `"status": "draft"`.

#### Writes made by plugins

Writes through `verdin_content` skip every plugin's **before** hooks, so a plugin cannot
loop on its own changes there. Everything else applies: validation, review stages,
webhooks, history, the audit log, and the **after** hooks of all plugins, the writing one
included. Guard an after hook that writes the type it listens to.

### `verdin_kv_get` and `verdin_kv_set`

A key-value store per plugin, in Verdin's database, shared by all instances. Keys are 1 to
255 bytes; values are any JSON. Setting `null` deletes the key. Without the `kv`
capability, reads return `null` and writes are ignored.

### `verdin_config`

Returns the settings saved in **Settings → Plugins**, with the `default` of each declared
setting filled in for missing keys. `{}` when nothing is saved.

### HTTP

With hosts listed in `http`, use Extism's HTTP support (`extism_pdk::http::request` in
Rust). Requests to other hosts fail.

## Admin extension points

The admin panel asks the server for the extensions of the enabled plugins and imports each
`admin.script` once, as an ES module, from `/admin/plugins/<name>/<script>` (under
`[admin].path`). Files under the plugin's `admin/` directory are served there while the
plugin is on, with `X-Content-Type-Options: nosniff` and `Cache-Control: no-cache`. The
module must define the custom elements the manifest names; an element not defined within
3 seconds is left out.

### Widgets

Each `[[admin.widgets]]` entry is a widget type admins can add to the dashboard. The
element receives a `context` property:

| Property | Description |
| --- | --- |
| `apiBase` | The content API base, such as `/api`. |
| `adminApiBase` | The admin API base, such as `/admin/api`. |
| `fetch(path, init)` | `fetch` with the signed-in admin's credentials. Relative paths resolve against `adminApiBase`; paths under either base and absolute URLs are kept. |

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

`context.fetch` sends the admin's session with admin API requests only. Paths under
`context.apiBase` (the content API, your plugin's routes included) go without it, since
the content API does not accept admin sessions; they are answered with the public role's
permissions. Before 0.10 it sent the session there too and those requests failed; widgets
written for 0.9 that call plain `fetch` keep working.

### Custom fields

Each `[[admin.fields]]` entry is a field attributes can use with
`"customField": "plugin::<name>.<id>"`; the attribute's `type` must match how the field
stores its value. The **Content-type builder** offers it. The element receives:

| Property | Description |
| --- | --- |
| `value` | The current value. |
| `disabled` | Whether editing is off. |
| `attribute` | The attribute's definition from the schema. |
| `locale` | The locale being edited. |

It reports a new value with a `change` event whose `detail` is the value (or, without
`detail`, through its own `value` property). When the plugin is off or its element is
missing, the editor shows the regular input for the storage type. See
[Attribute types](/reference/attribute-types/).

## Runtime and limits

| Limit | Value |
| --- | --- |
| Time per call | `[limits].timeout_ms`, default 5,000 ms |
| Memory | `[limits].memory_mb`, default 64 MB |
| Concurrency | One call at a time per plugin; calls wait for each other |
| Module instance | One per plugin, built on first use; rebuilt after a call fails (its memory is lost) |
| Log | 200 messages per plugin, 2,000 characters each, in memory |
| KV keys | 1 to 255 bytes |
| Route request headers | `content-type`, `accept`, `user-agent`, `accept-language` |
| Route response headers | `content-type`, `cache-control`, `location`, `etag`, `last-modified`, `content-disposition` |

Changes to a manifest or a module apply after a restart; switches and settings apply at
once. Managing plugins needs `plugins.manage` (see the
[permissions reference](/reference/permissions/)).
