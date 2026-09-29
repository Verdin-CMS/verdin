---
title: API reference
description: The content API is generated from each project's schema; this reference shows the one of the blog example.
---

Verdin's content API is shaped by your schema: every content type gets Strapi v5
compatible routes under `[api].prefix` (`/api` by default). The server describes the
routes of *your* project in an OpenAPI 3.1 document at `/api/_openapi.json`.

- By default only API tokens can read the document
  (`curl -H "authorization: Bearer $TOKEN" localhost:1337/api/_openapi.json`).
- Make it public in **Settings → Features → API documentation** to also get an
  interactive reference at `/api/docs`.

## Blog example

The [Content API (blog example)](../../reference/api/) pages render the document of the
example project in [`examples/blog`](https://github.com/verdin-cms/verdin/tree/main/examples/blog):
articles, categories, tags and a single-type homepage, with their components. They
show what the routes, parameters (filters, sort, pagination, `populate`, `status`,
`locale`) and response shapes look like for a real schema.

The document is committed as `site/src/openapi/blog.json`, so the site builds without
Rust. To regenerate it after changing the example schema or the generator, build the
server and run the script in `site/`:

```sh
cargo build -p verdin
cd site && npm run openapi
```

The script starts the server on a copy of the schema with a temporary SQLite database,
creates a read-only API token, downloads the document and stops the server. It adds a
local `servers` entry and the bearer-token security scheme for the rendered examples.
