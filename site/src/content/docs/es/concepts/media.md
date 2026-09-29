---
title: "Medios"
description: "La biblioteca de medios, los campos de medios, los formatos de imagen, los proveedores de almacenamiento (local o S3) y las carpetas, y cómo se enlazan los archivos al contenido."
sidebar:
  order: 8
---

La biblioteca de medios contiene las imágenes, vídeos, audios y demás archivos que usa tu
contenido. Esta página explica cómo se almacenan, describen y enlazan los archivos a los
documentos. Para servir imágenes redimensionadas en tu sitio, consulta
[Imágenes](/es/guides/frontend/images/).

## Archivos

Cada subida es un registro de archivo con la forma de Strapi, así que los frontends escritos
para Strapi lo leen sin cambios (`formats` abreviado):

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

- `size` está en kilobytes, como en Strapi.
- El tipo MIME se obtiene de los bytes del archivo, nunca de lo que dice el cliente.
- `focalPoint` marca la parte de una imagen que debe quedar a la vista cuando se recorta.

Los archivos no tienen borrador: una subida está disponible en cuanto se almacena.

## La biblioteca de medios

En el panel de administración, **Biblioteca de medios** enumera los archivos con búsqueda,
filtros por tipo y carpetas. Los administradores suben archivos, los importan desde una URL,
editan su nombre, texto alternativo, pie de foto y punto focal, sustituyen el contenido de un
archivo conservando su id y ven **dónde se usa**: campos de medios, medios dentro de
componentes, bloques de texto enriquecido y Markdown que contiene su URL.

Las **Carpetas** organizan la biblioteca para los editores. Los objetos de archivo de las
respuestas de la API no las muestran, pero una subida a través de la API de contenido puede
indicar un id de carpeta en su `fileInfo`. Eliminar una carpeta elimina los archivos que
contiene.

El acceso de los administradores se controla con los permisos `media.read`, `media.create`,
`media.update` y `media.delete`. El rol predefinido Author solo puede editar y eliminar los
archivos que ha subido. Consulta [Permisos](/es/concepts/permissions/).

## Campos de medios

Un tipo de contenido enlaza archivos mediante un atributo `media`:

```json
"cover": { "type": "media", "allowedTypes": ["images"] },
"gallery": { "type": "media", "multiple": true, "allowedTypes": ["images", "videos"] }
```

| Opción | Por defecto | Descripción |
| --- | --- | --- |
| `multiple` | `false` | Contiene una lista de archivos en lugar de uno. |
| `allowedTypes` | cualquier archivo | Cualquiera de `images`, `videos`, `audios` y `files` (todo lo demás), comprobado en cada escritura contra el tipo MIME guardado. |

Los campos de medios se comportan como relaciones: cada versión de un documento tiene sus
propios enlaces, al publicar se copian y `required` se comprueba al publicar. Se guardan en una
tabla de enlaces por campo. Dentro de los
[componentes](/es/concepts/components-and-dynamic-zones/), es el JSON del componente el que
guarda los ids de archivo.

En las escrituras, envía ids de archivo: `5`, `{ "id": 5 }`, `[5, 6]`, o `null` para vaciar el
campo. En las lecturas, los campos de medios solo se devuelven cuando se populan
(`populate=cover`), como objetos de archivo. Eliminar un archivo lo quita de todos los
documentos que lo usaban.

## Formatos de imagen

Cuando se sube una imagen rasterizada, Verdin genera los formatos de Strapi en el propio
formato de la imagen, respetando su orientación EXIF:

| Formato | Tamaño |
| --- | --- |
| `thumbnail` | Cabe en 245 × 156 |
| `large` | 1000 px de ancho |
| `medium` | 750 px de ancho |
| `small` | 500 px de ancho |

Un formato se omite cuando el original no es más grande que él. `[upload].breakpoints` cambia
los anchos y los nombres, y `responsive_formats = false` los desactiva. `max_original_size`
reduce los originales grandes al subirlos, lo que también elimina sus metadatos (EXIF, GPS).
`max_image_megapixels` (100 por defecto) rechaza las imágenes que ocuparían demasiada memoria
al decodificarlas. Con el proveedor local, `/uploads` también puede redimensionar y convertir
imágenes bajo demanda; consulta [Imágenes](/es/guides/frontend/images/).

## Proveedores de almacenamiento

Los archivos los almacena un proveedor, definido en `[upload].provider`:

| Proveedor | Almacena los archivos | Los sirve |
| --- | --- | --- |
| `local` (por defecto) | En `public/uploads` (la opción `dir`), relativo al proyecto | En `/uploads` del servidor de Verdin |
| `s3` | En cualquier bucket compatible con S3: AWS S3, Cloudflare R2, Backblaze B2, MinIO, RustFS… | Desde la `public_url` del bucket o de la CDN |

```toml title="verdin.toml"
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

Las credenciales de S3 se leen de las variables de entorno estándar `AWS_*`, nunca de
`verdin.toml`. Todas las opciones están en la
[referencia de configuración](/es/reference/configuration/).

Los nombres almacenados son `{slug}_{random}{ext}` y no cambian nunca, así que las URLs se
pueden cachear para siempre. Con varias instancias de Verdin, usa S3: los archivos locales
solo existen en la instancia que los recibió.

## Seguridad

- Las subidas se escriben en streaming a archivos temporales, nunca se mantienen en memoria,
  y están limitadas por `[upload].max_file_size` (200 MB por defecto), con un máximo de 20
  archivos por petición.
- Los archivos servidos desde `/uploads` llevan `Content-Security-Policy: sandbox` y
  `X-Content-Type-Options: nosniff`. Todo lo que no sea una imagen, un vídeo, un audio, un PDF
  o texto plano se envía como descarga, así que un archivo HTML o SVG subido no puede ejecutar
  scripts en tu dominio. En S3, los objetos de esos tipos también se guardan como descargas.

## Medios a través de la API de contenido

La API de contenido tiene las rutas de subida de Strapi, comprobadas contra los permisos sobre
la **Biblioteca de medios** (`plugin::upload`):

| Ruta | Permiso |
| --- | --- |
| `POST /api/upload` (multipart `files`, `fileInfo` opcional) | `create` |
| `POST /api/upload?id={id}` (nuevo `fileInfo`, opcionalmente un archivo nuevo) | `update` |
| `GET /api/upload/files` | `find` |
| `GET /api/upload/files/{id}` | `findOne` |
| `DELETE /api/upload/files/{id}` | `delete` |

Como en Strapi, responden con objetos y arrays de archivos simples, sin el envoltorio `data`.
Consulta [API REST](/es/api/rest/#biblioteca-de-medios). Los cambios envían los eventos de
[webhook](/es/api/webhooks/) y de [tiempo real](/es/api/realtime/) `media.create`,
`media.update` y `media.delete`.
