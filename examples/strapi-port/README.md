# Strapi port example

The custom code of a small Strapi v5 shop, moved to a Verdin plugin (`tienda`). It is the
worked example of the [Porting custom code](../../site/src/content/docs/migrate/porting-custom-code.mdx)
guide. Needs Verdin 0.11 or later (the startup function and `verdin_public_permissions`).

```
verdin.toml
schema/content-types/
  producto.json   product: nombre, slug, precio, a_la_venta, reservable (draft & publish)
  reserva.json    reservation: nombre, email, telefono, unidades, notas, estado, producto
  encuesta.json   poll: titulo, slug, pregunta, opciones (JSON list), estado, cierra_el
  voto.json       vote: encuesta, opcion, fingerprint, clave (unique)
plugin/           the plugin's Rust crate, manifest and admin widget
  plugin.toml
  src/lib.rs
  admin/index.js
```

| Strapi | `tienda` |
| --- | --- |
| `reserva` lifecycle `beforeCreate`: `estado` forced to `pendiente`, the product must be `a_la_venta` and `reservable`, `unidades` clamped to 1–10 | `[[hooks]] beforeCreate` → `before_create_reserva` (the maximum is the `maxUnidades` setting) |
| `reserva` lifecycle `afterCreate` | `[[hooks]] afterCreate` → `after_create_reserva` (a log line) |
| `POST /api/polls/:slug/vote`, `GET /api/polls/:slug/results` | `POST /api/plugins/tienda/polls/:slug/vote`, `GET /api/plugins/tienda/polls/:slug/results` |
| Cron task closing polls past `cierra_el` | `[[jobs]]` every 15 minutes → `close_polls` |
| `bootstrap()` setting the public role's permissions | `[startup]` → `startup`, with the `public_permissions` capability |
| Admin dashboard widget | `[[admin.widgets]]` `tienda-polls` (open polls and their votes) |

## Build

You need Rust and the WebAssembly target (`rustup target add wasm32-unknown-unknown`).
From this directory:

```sh
cd plugin
cargo build --release --target wasm32-unknown-unknown
cd ..
```

The module is `plugin/target/wasm32-unknown-unknown/release/tienda.wasm` (about 180 KB),
or under `$CARGO_TARGET_DIR` if you set it.

## Install

A plugin is a directory under `plugins/` with `plugin.toml`, `plugin.wasm` and, for the
widget, `admin/`:

```sh
mkdir -p plugins/tienda
cp plugin/plugin.toml plugins/tienda/
cp -R plugin/admin plugins/tienda/
cp plugin/target/wasm32-unknown-unknown/release/tienda.wasm plugins/tienda/plugin.wasm
```

(`plugins/` is ignored by git here; in a real project, ship it with the schema.)

Then run the example like the blog one, from the repository root:

```sh
cd examples/strapi-port
cat > .env <<ENV
VERDIN_DATABASE_URL=sqlite://data/shop.db
$(cargo run -q -- secrets)
ENV
mkdir -p data
cargo run -- dev          # migrates, then serves http://localhost:1337
```

In the admin panel (build it as described in the [blog example](../blog/README.md)), open
**Settings → Plugins**, review what `tienda` asks for and switch
it on. Its startup function runs at once and leaves the public role with `find` and
`findOne` on products and polls and `create` on reservations (check **Settings → Public
access**; turn the **Reset the public role's permissions on startup** setting off to keep
your own). Add the **Open polls** widget to the dashboard if you like.

## Try it

Create a published product (`a_la_venta` and `reservable` on) and an open poll, for
example with a full-access API token in `$TOKEN`:

```sh
curl localhost:1337/api/productos -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"data":{"nombre":"Bici","slug":"bici","a_la_venta":true,"reservable":true,"precio":250}}'
curl localhost:1337/api/encuestas -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"data":{"titulo":"Color","slug":"color","opciones":["rojo","verde"],"estado":"abierta"}}'
```

A reservation, as a visitor (the public role may create them). `estado` becomes
`pendiente` and `unidades` 10:

```sh
curl localhost:1337/api/reservas -H 'content-type: application/json' \
  -d '{"data":{"nombre":"Ana","email":"ana@example.com","unidades":50,"estado":"confirmada","producto":"<the product documentId>"}}'
```

A product that is not reservable, not on sale or not published answers a 400 with the
hook's message.

Votes. The fingerprint is made by the site (plugin routes do not see the client's
address), 8 to 128 letters, digits, `-` or `_`:

```sh
curl localhost:1337/api/plugins/tienda/polls/color/vote -H 'content-type: application/json' \
  -d '{"option":"rojo","fingerprint":"b1946ac92492d2347c62"}'      # 201 with the results
curl localhost:1337/api/plugins/tienda/polls/color/vote -H 'content-type: application/json' \
  -d '{"option":"verde","fingerprint":"b1946ac92492d2347c62"}'     # 409: already voted
curl localhost:1337/api/plugins/tienda/polls/color/results        # 200
curl localhost:1337/api/plugins/tienda/polls                      # open polls, for the widget
```

Answers follow Strapi's shapes: `{ "data": … }`, or
`{ "data": null, "error": { "status", "name", "message", "details" } }` with 400 (bad
input or option), 403 (poll closed), 404 (no such poll) or 409 (already voted).

## Rules this plugin follows

- **No after hooks on the types it writes.** Its routes write `voto` and its job writes
  `encuesta`; an after hook of the same plugin on those types would deadlock (the write
  waits for the hook, the hook waits for the plugin's instance). Its only after hook is on
  `reserva`, which it never writes.
- **Its writes skip before hooks.** Votes created by the route do not go through any
  plugin's before hooks, so the route checks everything itself.
- **No client address.** Plugin routes get only the `content-type`, `accept`,
  `user-agent` and `accept-language` headers, so the one-vote rule relies on a fingerprint
  the site sends. It stops double clicks and casual repeats, not a determined voter.
