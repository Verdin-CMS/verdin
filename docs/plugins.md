# Plugins

Plugins extend Verdin with WebAssembly modules, run by [Extism](https://extism.org). A plugin can:

- **hook into writes**: before a document is created, updated, published, unpublished or deleted it can change the data or refuse the write; after the write it can react
- **serve routes** under `/api/plugins/<name>/…`
- **run scheduled jobs** (cron)
- **add to the admin panel**: dashboard widgets and custom fields, as Web Components

Modules run in a sandbox. They have no files, no network and no database access of their own. Everything goes through host functions, and those are limited by the capabilities the plugin declares. An installed plugin stays off until an admin switches it on in **Settings → Plugins** (permission `plugins.manage`), after reviewing what it asks for.

## Installing

Put each plugin in its own directory under `plugins/`. The path is set by `[plugins].path`, relative to `verdin.toml`. Then restart Verdin.

```
plugins/
  slugs/
    plugin.toml
    plugin.wasm
    admin/            # optional: the panel's module and assets
      index.js
```

## `plugin.toml`

```toml
name = "slugs"                    # lowercase letters, digits, dashes
version = "1.0.0"
description = "Slugs from titles, and a color field"
wasm = "plugin.wasm"              # default
wasi = false                      # give the module WASI (clock, random)

[capabilities]
read = ["api::article"]           # content types it may read ("*": all)
write = ["api::tag"]              # …create, update, publish and delete (implies read)
http = ["api.example.com"]        # hosts it may call (Extism HTTP)
kv = true                         # its own key-value storage

[limits]
timeout_ms = 5000                 # per call
memory_mb = 64

[[hooks]]
on = "beforeCreate"               # beforeCreate, beforeUpdate, beforeDelete, beforePublish,
uid = "api::article"              # beforeUnpublish, afterCreate, afterUpdate, afterDelete,
function = "before_write"         # afterPublish, afterUnpublish, afterDiscardDraft

[routes]
function = "handle"               # serves /api/plugins/slugs/…

[[jobs]]
schedule = "*/15 * * * *"         # cron, UTC; seconds optional
function = "refresh"

[admin]
script = "index.js"               # ES module under admin/, defines the elements
[[admin.widgets]]
id = "stats"
title = "Slug stats"
element = "slugs-stats"
[[admin.fields]]
id = "color"
title = "Color"
element = "slugs-color"
type = "string"                   # how the value is stored
```

## Functions

Exported functions take JSON and return JSON.

| Called for | Input | Output |
|---|---|---|
| Before hooks | `{ event, uid, documentId, locale, data }` | `{ "data": {…} }` replaces the data, `{ "error": "…" }` refuses the write (400), `{}` changes nothing |
| After hooks | `{ event, uid, documentId, locale }` | ignored |
| Routes | `{ method, path, query, headers, body, actor: { kind: "public" \| "token" \| "user", id? } }` | `{ status, headers?, body }` (a string, or JSON) |
| Jobs | `{ scheduledAt }` | ignored |

Some rules apply to all of them:

- **Access checks.** Routes do their own checks, using `actor`. Public access and API token permissions do not apply to them.
- **Failures.** A failing before hook is logged and the write goes on. A failing route answers `502`.
- **No recursion.** Writes a plugin makes through `verdin_content` do not trigger plugin hooks. Webhooks and history still see them.

## Host functions

Import them from the `extism:host/user` namespace. Every one takes and returns JSON strings.

| Function | |
|---|---|
| `verdin_log({ level, message })` | Writes to the server log and to the plugin's log (**Settings → Plugins → Logs**) |
| `verdin_content({ op, uid, documentId?, query?, data?, status?, locale? })` | `op` is one of findMany, findOne, create, update, delete, publish, unpublish. `query` uses the REST parameters as an object, for example `{ "filters": { "title": { "$eq": "x" } }, "sort": ["title"] }`. The answer is the result, or `{ "error": "…" }` |
| `verdin_kv_get(key)` / `verdin_kv_set({ key, value })` | The plugin's storage. A `null` value deletes the key. Needs `kv` |
| `verdin_config()` | The plugin's settings, edited in **Settings → Plugins** |

In Rust, with `extism-pdk`, this looks like the following. [`crates/verdin-plugins/tests/fixtures/sample`](../crates/verdin-plugins/tests/fixtures/sample) is a complete plugin.

```rust
use extism_pdk::*;
use serde_json::{json, Value};

#[host_fn]
extern "ExtismHost" {
    fn verdin_content(input: Json<Value>) -> Json<Value>;
}

#[plugin_fn]
pub fn before_write(Json(input): Json<Value>) -> FnResult<Json<Value>> {
    let mut data = input["data"].clone();
    if let Some(title) = data["title"].as_str() {
        data["slug"] = json!(title.to_lowercase().replace(' ', "-"));
        return Ok(Json(json!({ "data": data })));
    }
    Ok(Json(json!({})))
}
```

Build it with `cargo build --release --target wasm32-unknown-unknown`. Extism also has PDKs for JavaScript, Go, Zig, C and others.

## Admin extensions

The panel imports the `admin.script` of each enabled plugin once. It is served from `/admin/plugins/<name>/`. The module defines the custom elements that the manifest names.

- **Widgets** appear as a dashboard widget type. The element gets a `context` property, `{ apiBase, adminApiBase, fetch(path, init) }`. Its `fetch` sends the admin's credentials.
- **Custom fields** are attributes with `"customField": "plugin::<name>.<id>"`. The attribute's `type` is how the value is stored, and the builder offers the field. The element receives these properties:
  - `value` and `disabled`
  - `attribute`, the attribute's definition
  - `locale`

  It reports changes with a `change` event whose `detail` is the new value. If the plugin is missing, the admin falls back to the input for the storage type. Strapi's `customField` attributes are imported as they are.

## Operations

- **Instances.** Each plugin keeps one instance and handles one call at a time. A module that traps or times out is rebuilt on its next call.
- **Several servers.** Jobs run on every server instance.
- **Changes.** Changes to `plugin.toml` or the module apply after a restart. Switches and settings apply immediately.
