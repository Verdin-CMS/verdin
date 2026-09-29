---
title: "Media"
description: "The media library, media fields, image formats, storage providers (local or S3) and folders, and how files are linked to content."
sidebar:
  order: 8
---

The media library holds the images, videos, audio and other files your content uses. This
page explains how files are stored, described and linked to documents. For serving resized
images on your site, see [Images](/guides/frontend/images/).

## Files

Each upload is a file record in Strapi's shape, so frontends written for Strapi read it
unchanged (`formats` abridged):

```json
{
  "id": 5,
  "documentId": "v3k…",
  "name": "harbour.jpg",
  "alternativeText": "Boats in the harbour at dawn",
  "caption": null,
  "width": 2400,
  "height": 1600,
  "focalPoint": { "x": 0.4, "y": 0.6 },
  "formats": {
    "thumbnail": { "url": "/uploads/harbour_thumbnail_4f1c.jpg", "width": 234, "height": 156 },
    "large": { "url": "/uploads/harbour_large_4f1c.jpg", "width": 1000, "height": 667 }
  },
  "hash": "harbour_4f1c",
  "ext": ".jpg",
  "mime": "image/jpeg",
  "size": 812.4,
  "url": "/uploads/harbour_4f1c.jpg",
  "previewUrl": null,
  "provider": "local",
  "provider_metadata": null,
  "createdAt": "2026-09-25T09:00:00.000Z",
  "updatedAt": "2026-09-25T09:00:00.000Z",
  "publishedAt": "2026-09-25T09:00:00.000Z"
}
```

- `size` is in kilobytes, as in Strapi.
- The MIME type comes from the file's bytes, never from what the client claims.
- `focalPoint` marks the part of an image to keep in view when it is cropped.

Files have no draft: an upload is available as soon as it is stored.

## The media library

In the admin panel, **Media library** lists files with search, filters by type and folders.
Admins upload files, import them from a URL, edit their name, alternative text, caption and
focal point, replace a file's content while keeping its id, and see **where it is used**:
media fields, media inside components, rich text blocks and Markdown that contains its URL.

**Folders** organize the library for editors. File objects in API responses do not show
them, but an upload through the content API can name a folder id in its `fileInfo`.
Deleting a folder deletes the files in it.

Admin access is controlled by the `media.read`, `media.create`, `media.update` and
`media.delete` permissions. The built-in Author role may edit and delete only the files it
uploaded. See [Permissions](/concepts/permissions/).

## Media fields

A content type links files through a `media` attribute:

```json
"cover": { "type": "media", "allowedTypes": ["images"] },
"gallery": { "type": "media", "multiple": true, "allowedTypes": ["images", "videos"] }
```

| Option | Default | Description |
| --- | --- | --- |
| `multiple` | `false` | Hold a list of files instead of one. |
| `allowedTypes` | any file | Any of `images`, `videos`, `audios` and `files` (anything else), checked on every write against the stored MIME type. |

Media fields behave like relations: each version of a document has its own links, publishing
copies them, and `required` is checked when publishing. They are stored in a link table per
field. Inside [components](/concepts/components-and-dynamic-zones/), the component's JSON
stores the file ids instead.

On writes, send file ids: `5`, `{ "id": 5 }`, `[5, 6]`, or `null` to clear the field. On
reads, media fields are returned only when populated (`populate=cover`), as file objects.
Deleting a file removes it from every document that used it.

## Image formats

When a raster image is uploaded, Verdin generates Strapi's formats in the image's own format,
honouring its EXIF orientation:

| Format | Size |
| --- | --- |
| `thumbnail` | Fits within 245 × 156 |
| `large` | 1000 px wide |
| `medium` | 750 px wide |
| `small` | 500 px wide |

A format is skipped when the original is not larger than it. `[upload].breakpoints` changes the widths and
names, and `responsive_formats = false` turns them off. `max_original_size` scales large
originals down on upload, which also drops their metadata (EXIF, GPS).
`max_image_megapixels` (100 by default) refuses images that would take too much memory to
decode. With the local provider, `/uploads` can also resize and convert images on request;
see [Images](/guides/frontend/images/).

## Storage providers

Files are stored by a provider, set in `[upload].provider`:

| Provider | Stores files | Serves them |
| --- | --- | --- |
| `local` (default) | In `public/uploads` (the `dir` option), relative to the project | At `/uploads` on the Verdin server |
| `s3` | In any S3-compatible bucket: AWS S3, Cloudflare R2, Backblaze B2, MinIO, RustFS… | From the bucket's or CDN's `public_url` |

```toml title="verdin.toml"
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

S3 credentials come from the standard `AWS_*` environment variables, never from
`verdin.toml`. Every option is in the
[configuration reference](/reference/configuration/).

Stored names are `{slug}_{random}{ext}` and never change, so URLs can be cached forever.
With several Verdin instances, use S3: local files exist only on the instance that received
them.

## Safety

- Uploads are streamed to temporary files, never held in memory, and bounded by
  `[upload].max_file_size` (200 MB by default), with at most 20 files per request.
- Files served from `/uploads` carry `Content-Security-Policy: sandbox` and
  `X-Content-Type-Options: nosniff`. Anything that is not an image, video, audio, PDF or
  plain text is sent as a download, so an uploaded HTML or SVG file cannot run scripts on
  your domain. Objects of such types are stored as downloads on S3 too.

## Media over the content API

The content API has Strapi's upload routes, checked against grants on the **Media library**
(`plugin::upload`):

| Route | Grant |
| --- | --- |
| `POST /api/upload` (multipart `files`, optional `fileInfo`) | `create` |
| `POST /api/upload?id={id}` (new `fileInfo`, optionally a new file) | `update` |
| `GET /api/upload/files` | `find` |
| `GET /api/upload/files/{id}` | `findOne` |
| `DELETE /api/upload/files/{id}` | `delete` |

As in Strapi, these answer plain file objects and arrays, without the `data` envelope. See
[REST API](/api/rest/#media-library). Changes send `media.create`, `media.update` and
`media.delete` [webhook](/api/webhooks/) and [realtime](/api/realtime/) events.
