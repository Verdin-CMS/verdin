---
title: "Multimèdia"
description: "La mediateca, els camps de multimèdia, els formats d'imatge, els proveïdors d'emmagatzematge (local o S3) i les carpetes, i com s'enllacen els fitxers al contingut."
sidebar:
  order: 8
---

La mediateca conté les imatges, els vídeos, l'àudio i els altres fitxers que fa servir el teu
contingut. Aquesta pàgina explica com es desen i es descriuen els fitxers i com s'enllacen als
documents. Per servir imatges redimensionades al teu lloc, consulta
[Imatges](/ca/guides/frontend/images/).

## Fitxers

Cada pujada és un registre de fitxer amb la forma de Strapi, de manera que els frontends escrits
per a Strapi el llegeixen sense canvis (`formats` abreujat):

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

- `size` és en kilobytes, com a Strapi.
- El tipus MIME surt dels bytes del fitxer, mai del que diu el client.
- `focalPoint` marca la part d'una imatge que cal mantenir visible quan es retalla.

Els fitxers no tenen esborrany: una pujada és disponible tan bon punt es desa.

## La mediateca

Al tauler d'administració, **Mediateca** llista els fitxers amb cerca, filtres per tipus i
carpetes. Els administradors pugen fitxers, els importen des d'una URL, n'editen el nom, el text
alternatiu, la llegenda i el punt focal, substitueixen el contingut d'un fitxer conservant-ne
l'id i veuen on s'utilitza (**Utilitzat a**): camps de multimèdia, mitjans dins de components,
blocs de text enriquit i Markdown que conté la seva URL.

Les **Carpetes** organitzen la mediateca per als editors. Els objectes de fitxer de les
respostes de l'API no les mostren, però una pujada per l'API de contingut pot indicar un id de
carpeta al seu `fileInfo`. Eliminar una carpeta elimina els fitxers que conté.

L'accés dels administradors es controla amb els permisos `media.read`, `media.create`,
`media.update` i `media.delete`. El rol integrat Author només pot editar i eliminar els fitxers
que ha pujat. Consulta [Permisos](/ca/concepts/permissions/).

## Camps de multimèdia

Un tipus de contingut enllaça fitxers mitjançant un atribut `media`:

```json
"cover": { "type": "media", "allowedTypes": ["images"] },
"gallery": { "type": "media", "multiple": true, "allowedTypes": ["images", "videos"] }
```

| Opció | Per defecte | Descripció |
| --- | --- | --- |
| `multiple` | `false` | Conté una llista de fitxers en lloc d'un. |
| `allowedTypes` | qualsevol fitxer | Qualsevol de `images`, `videos`, `audios` i `files` (qualsevol altra cosa), comprovat a cada escriptura contra el tipus MIME desat. |

Els camps de multimèdia es comporten com les relacions: cada versió d'un document té els seus
propis enllaços, publicar-los els copia i `required` es comprova en publicar. Es desen en una
taula d'enllaç per camp. Dins dels [components](/ca/concepts/components-and-dynamic-zones/), és
el JSON del component el que desa els ids dels fitxers.

En les escriptures, envia ids de fitxer: `5`, `{ "id": 5 }`, `[5, 6]`, o `null` per buidar el
camp. En les lectures, els camps de multimèdia només es retornen quan es poblen
(`populate=cover`), com a objectes de fitxer. Eliminar un fitxer el treu de tots els documents
que el feien servir.

## Formats d'imatge

Quan es puja una imatge ràster, Verdin genera els formats de Strapi en el mateix format de la
imatge, respectant-ne l'orientació EXIF:

| Format | Mida |
| --- | --- |
| `thumbnail` | Cap dins de 245 × 156 |
| `large` | 1000 px d'amplada |
| `medium` | 750 px d'amplada |
| `small` | 500 px d'amplada |

Un format s'omet quan l'original no és més gran que ell. `[upload].breakpoints` canvia les
amplades i els noms, i `responsive_formats = false` els desactiva. `max_original_size` redueix
els originals grans en pujar-los, cosa que també n'elimina les metadades (EXIF, GPS).
`max_image_megapixels` (100 per defecte) rebutja les imatges que necessitarien massa memòria per
descodificar-se. Amb el proveïdor local, `/uploads` també pot redimensionar i convertir imatges
sota demanda; consulta [Imatges](/ca/guides/frontend/images/).

## Proveïdors d'emmagatzematge

Els fitxers els desa un proveïdor, definit a `[upload].provider`:

| Proveïdor | Desa els fitxers | Els serveix |
| --- | --- | --- |
| `local` (per defecte) | A `public/uploads` (l'opció `dir`), relatiu al projecte | A `/uploads` al servidor de Verdin |
| `s3` | En qualsevol bucket compatible amb S3: AWS S3, Cloudflare R2, Backblaze B2, MinIO, RustFS… | Des de la `public_url` del bucket o de la CDN |

```toml title="verdin.toml"
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

Les credencials d'S3 surten de les variables d'entorn estàndard `AWS_*`, mai de `verdin.toml`.
Totes les opcions són a la [referència de configuració](/ca/reference/configuration/).

Els noms desats són `{slug}_{random}{ext}` i no canvien mai, de manera que les URL es poden
emmagatzemar a la memòria cau per sempre. Amb diverses instàncies de Verdin, fes servir S3: els
fitxers locals només existeixen a la instància que els ha rebut.

## Seguretat

- Les pujades es transmeten a fitxers temporals, mai no es guarden a la memòria, i estan
  limitades per `[upload].max_file_size` (200 MB per defecte), amb un màxim de 20 fitxers per
  petició.
- Els fitxers servits des de `/uploads` porten `Content-Security-Policy: sandbox` i
  `X-Content-Type-Options: nosniff`. Tot el que no és una imatge, un vídeo, un àudio, un PDF o
  text pla s'envia com a descàrrega, de manera que un fitxer HTML o SVG pujat no pot executar
  scripts al teu domini. A S3, els objectes d'aquests tipus també es desen com a descàrregues.

## Multimèdia a través de l'API de contingut

L'API de contingut té les rutes de pujada de Strapi, comprovades amb els permisos sobre la
**Mediateca** (`plugin::upload`):

| Ruta | Permís |
| --- | --- |
| `POST /api/upload` (`files` multipart, `fileInfo` opcional) | `create` |
| `POST /api/upload?id={id}` (`fileInfo` nou, opcionalment un fitxer nou) | `update` |
| `GET /api/upload/files` | `find` |
| `GET /api/upload/files/{id}` | `findOne` |
| `DELETE /api/upload/files/{id}` | `delete` |

Com a Strapi, aquestes rutes responen objectes i arrays de fitxers simples, sense l'embolcall
`data`. Consulta l'[API REST](/ca/api/rest/#mediateca). Els canvis envien els esdeveniments de
[webhook](/ca/api/webhooks/) i de [temps real](/ca/api/realtime/) `media.create`,
`media.update` i `media.delete`.
