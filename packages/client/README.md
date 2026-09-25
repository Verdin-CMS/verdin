# @verdin/client

Typed client for the [Verdin](https://github.com/Verdin-CMS/verdin) content API: REST documents, the media library and GraphQL. It has no dependencies and runs in any runtime with `fetch`, such as browsers, Node 20+, Deno, Bun and edge workers.

```sh
npm install @verdin/client
```

## Types from your schema

```sh
verdin types -o src/verdin-types.ts
```

The command generates one interface per content type and component, the matching `…Input` write types, and a `VerdinSchema` map of routes. Pass that map to the client:

```ts
import { createClient } from '@verdin/client';
import type { VerdinSchema } from './verdin-types';

const verdin = createClient<VerdinSchema>({
  url: 'https://cms.example.com',
  token: process.env.VERDIN_TOKEN, // omit to use the public role
});

const { data, meta } = await verdin.collection('articles').find({
  filters: { title: { $containsi: 'rust' } },
  populate: { category: true, cover: true },
  sort: ['publishedAt:desc'],
  pagination: { page: 1, pageSize: 10 },
});
```

Without the generated types every route is accepted and documents are `Record<string, unknown>`.

## API

| Call | Request |
| --- | --- |
| `collection(route).find(params?)` | `GET /api/:route` |
| `collection(route).findOne(id, params?)` | `GET /api/:route/:id` |
| `collection(route).create(data, params?)` | `POST /api/:route` (publishes unless `status: 'draft'`) |
| `collection(route).update(id, data, params?)` | `PUT /api/:route/:id` |
| `collection(route).delete(id)` | `DELETE /api/:route/:id` |
| `collection(route).publish / unpublish / discardDraft(id)` | `POST /api/:route/:id/actions/…` |
| `single(route).find / update / delete` | `/api/:route` |
| `upload(files, info?)` | `POST /api/upload` (multipart) |
| `files(params?)` | `GET /api/upload/files` |
| `graphql(query, variables?)` | `POST /graphql` (the GraphQL feature must be on) |

Query parameters use Strapi v5's format and are serialized in bracket notation. `stringify` is exported for building URLs yourself.

Errors reject with a `VerdinError` that has `status`, `name` (for example `ValidationError` or `NotFoundError`), `message` and `details`.

## Options

- `url`: the server origin.
- `token`: an API token.
- `prefix`: the content API prefix. It defaults to `/api`.
- `fetch`: a custom `fetch` implementation.
- `headers`: extra headers sent with every request.
