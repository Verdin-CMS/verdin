# Site features

Four features for the sites Verdin feeds, switched on in **Settings → Features**. Admins
with `site.manage` (Editors, built in) manage redirects, menus and forms.

## SEO and sitemap (`seo`)

The feature's settings map content types to the paths of their pages:

```json
{
  "baseUrl": "https://www.example.com",
  "types": {
    "api::article": { "pattern": "/{locale}/blog/{slug}", "changefreq": "weekly", "priority": 0.7 },
    "api::page": { "pattern": "/{slug}" }
  }
}
```

Patterns use attributes of the type and `{locale}`. Verdin then serves
`/sitemap.xml` with every published entry whose pattern fills (entries with an empty
`slug` are left out), their last change, and `hreflang` alternates between the locales
of localized entries (up to 50,000 URLs). Menus use the same patterns to link entries.

`GET /admin/api/site/seo/component` returns the suggested `shared.seo` component —
`metaTitle`, `metaDescription`, `metaImage`, `keywords`, `metaRobots`, `canonicalURL`,
`structuredData` — to add with the schema builder.

## Redirects (`redirects`)

Pairs of `source` path and `destination` (a path or an `http(s)` URL) with a status
(301, 302, 307 or 308). Sources are unique and chains that loop are refused. Sites fetch
them from `GET /api/_redirects` (cached for a minute) and apply them in their
middleware:

```js
// Next.js middleware
const { data } = await (await fetch(`${CMS}/api/_redirects`)).json();
const hit = data.find((redirect) => redirect.source === request.nextUrl.pathname);
if (hit) return NextResponse.redirect(new URL(hit.destination, request.url), hit.status);
```

## Menus (`menus`)

Named trees of links, up to 5 levels and 500 items. An item has a `label` and links to a
`url` (a path, `#anchor`, `http(s)`, `mailto:` or `tel:`) or an `entry`
(`{ "uid": "api::page", "documentId": "…" }`), with an optional `target` (`_self`,
`_blank`) and `children`.

`GET /api/_menus/{slug}?locale=es` returns the tree with entry links resolved: entries
that are not published (in that locale) are left out, and the others get their `path`
from the sitemap pattern (also as `url` when the item has none).

## Forms (`forms`)

A form has a `slug`, a name, fields — `text`, `email`, `textarea`, `number`, `select`
(with `options`), `checkbox`, `date`, `url`, `tel`, each with a `label`, `required`,
`maxLength` and `placeholder` — and settings: `notifyEmails`, `successMessage` and
`honeypot` (on by default).

- `GET /api/_forms/{slug}`: the definition, to render the form.
- `POST /api/_forms/{slug}`: a submission, as JSON (`{ "email": … }` or `{ "data": … }`)
  or a plain form post. Values are checked against the fields; unknown ones are dropped.
  Submissions that fill the hidden `_gotcha` field are answered as accepted and thrown
  away. Each IP may send 10 submissions a minute per form.
- Accepted submissions are stored with a hash of the sender's IP and their user agent, and
  emailed to `notifyEmails`. Admins list them, delete them and export them as CSV
  (`/admin/api/site/forms/{id}/submissions[/export]`).
