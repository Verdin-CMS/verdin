# Visual editing

Click on your site, land on the field in the admin. Verdin hides a small source map in
each text it returns — who the text belongs to and where to edit it — and an overlay
script finds them on the page.

## Turn it on in your preview

Source maps are only added to **authenticated** reads that ask for them, so public
traffic (and caches) never see them:

```js
const response = await fetch(`${CMS}/api/articles/${id}?status=draft`, {
  headers: {
    'x-verdin-preview': previewToken, // or Authorization: Bearer <API token>
    'x-verdin-stega': 'true',
  },
});
```

Then load the overlay on the preview page:

```html
<script src="https://cms.example.com/admin/api/visual-editing.js" defer></script>
```

Hovering marked text outlines it with an **Edit** button. Inside the admin's preview
frame the button asks the admin to open the field; on its own it opens the entry in a
new tab.

## What is marked

- `string`, `text` and `richtext` attributes, and the first text of each block of
  `blocks` attributes.
- The same inside components and dynamic zones (`seo.metaTitle`, `sections.2.title`).
- Populated relations, with their own entry.

Identifiers are left alone: `uid`, `email`, `enumeration`, numbers and dates.

## Using marked values

The marks are invisible characters at the end of the text. Where a value is used as data
rather than shown — a key, a URL, a comparison — strip them first:

```js
const clean = (text) => text.replace(/\u2064[\u200b-\u200d\u2060]*\u2063/g, '');
```

## Format

A mark is U+2064, then each UTF-8 byte of
`{"origin":"verdin","href":"<admin>/content/<uid>/<documentId>?locale=<locale>&field=<path>"}`
as four base-4 digits (most significant first) written with U+200B, U+200C, U+200D and
U+2060, then U+2063. The admin URL comes from `[server].public_url` and `[admin].path`.
