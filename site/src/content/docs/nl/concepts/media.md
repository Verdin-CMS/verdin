---
title: "Media"
description: "De mediabibliotheek, mediavelden, afbeeldingsformaten, opslagproviders (lokaal of S3) en mappen, en hoe bestanden aan content worden gekoppeld."
sidebar:
  order: 8
---

De mediabibliotheek bevat de afbeeldingen, video's, audio en andere bestanden die je content
gebruikt. Deze pagina legt uit hoe bestanden worden opgeslagen, beschreven en aan documenten
gekoppeld. Voor het serveren van geschaalde afbeeldingen op je site, zie
[Afbeeldingen](/nl/guides/frontend/images/).

## Bestanden

Elke upload is een bestandsrecord in de vorm van Strapi, dus frontends die voor Strapi zijn
geschreven, lezen het ongewijzigd (`formats` ingekort):

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

- `size` is in kilobytes, zoals in Strapi.
- Het MIME-type komt uit de bytes van het bestand, nooit uit wat de client beweert.
- `focalPoint` markeert het deel van een afbeelding dat in beeld moet blijven als ze wordt
  bijgesneden.

Bestanden hebben geen concept: een upload is beschikbaar zodra hij is opgeslagen.

## De mediabibliotheek

In het beheerpaneel toont **Mediabibliotheek** bestanden met zoeken, filters op type en mappen.
Beheerders uploaden bestanden, importeren ze vanaf een URL, bewerken hun naam, alternatieve
tekst, bijschrift en focuspunt, vervangen de inhoud van een bestand met behoud van zijn id, en
zien **waar het wordt gebruikt**: mediavelden, media in componenten, rich-textblokken en
Markdown die de URL bevat.

**Mappen** ordenen de bibliotheek voor redacteuren. Bestandsobjecten in API-responses tonen ze
niet, maar een upload via de content-API kan een map-id noemen in zijn `fileInfo`. Een map
verwijderen verwijdert de bestanden erin.

Beheerderstoegang wordt geregeld door de rechten `media.read`, `media.create`, `media.update` en
`media.delete`. De ingebouwde rol Author mag alleen de bestanden bewerken en verwijderen die hij
zelf heeft geüpload. Zie [Rechten](/nl/concepts/permissions/).

## Mediavelden

Een contenttype koppelt bestanden via een attribuut `media`:

```json
"cover": { "type": "media", "allowedTypes": ["images"] },
"gallery": { "type": "media", "multiple": true, "allowedTypes": ["images", "videos"] }
```

| Optie | Standaard | Beschrijving |
| --- | --- | --- |
| `multiple` | `false` | Bevat een lijst bestanden in plaats van één. |
| `allowedTypes` | elk bestand | Een of meer van `images`, `videos`, `audios` en `files` (al het andere), bij elke schrijfactie gecontroleerd tegen het opgeslagen MIME-type. |

Mediavelden gedragen zich als relaties: elke versie van een document heeft zijn eigen
koppelingen, publiceren kopieert ze, en `required` wordt bij het publiceren gecontroleerd. Ze
worden per veld in een koppeltabel opgeslagen. Binnen
[componenten](/nl/concepts/components-and-dynamic-zones/) slaat de JSON van de component in
plaats daarvan de bestands-id's op.

Stuur bij schrijfacties bestands-id's: `5`, `{ "id": 5 }`, `[5, 6]`, of `null` om het veld te
legen. Bij leesacties worden mediavelden alleen teruggegeven als ze gepopuleerd zijn
(`populate=cover`), als bestandsobjecten. Een bestand verwijderen haalt het weg uit elk document
dat het gebruikte.

## Afbeeldingsformaten

Wanneer een rasterafbeelding wordt geüpload, genereert Verdin de formaten van Strapi in het eigen
formaat van de afbeelding, met inachtneming van de EXIF-oriëntatie:

| Formaat | Grootte |
| --- | --- |
| `thumbnail` | Past binnen 245 × 156 |
| `large` | 1000 px breed |
| `medium` | 750 px breed |
| `small` | 500 px breed |

Een formaat wordt overgeslagen als het origineel niet groter is. `[upload].breakpoints` wijzigt de
breedtes en namen, en `responsive_formats = false` zet ze uit. `max_original_size` schaalt grote
originelen bij het uploaden omlaag, waarbij ook hun metadata (EXIF, GPS) verdwijnt.
`max_image_megapixels` (standaard 100) weigert afbeeldingen die te veel geheugen zouden kosten om
te decoderen. Met de lokale provider kan `/uploads` afbeeldingen ook op verzoek schalen en
converteren; zie [Afbeeldingen](/nl/guides/frontend/images/).

## Opslagproviders

Bestanden worden opgeslagen door een provider, ingesteld in `[upload].provider`:

| Provider | Slaat bestanden op | Serveert ze |
| --- | --- | --- |
| `local` (standaard) | In `public/uploads` (de optie `dir`), relatief ten opzichte van het project | Op `/uploads` op de Verdin-server |
| `s3` | In elke S3-compatibele bucket: AWS S3, Cloudflare R2, Backblaze B2, MinIO, RustFS… | Vanaf de `public_url` van de bucket of de CDN |

```toml title="verdin.toml"
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

S3-inloggegevens komen uit de standaard omgevingsvariabelen `AWS_*`, nooit uit `verdin.toml`.
Elke optie staat in de [configuratiereferentie](/nl/reference/configuration/).

Opgeslagen namen zijn `{slug}_{random}{ext}` en veranderen nooit, dus URL's kunnen voor altijd
worden gecachet. Gebruik met meerdere Verdin-instanties S3: lokale bestanden bestaan alleen op de
instantie die ze heeft ontvangen.

## Veiligheid

- Uploads worden naar tijdelijke bestanden gestreamd, nooit in het geheugen gehouden, en begrensd
  door `[upload].max_file_size` (standaard 200 MB), met hoogstens 20 bestanden per request.
- Bestanden die vanaf `/uploads` worden geserveerd, krijgen `Content-Security-Policy: sandbox` en
  `X-Content-Type-Options: nosniff`. Alles wat geen afbeelding, video, audio, PDF of platte tekst
  is, wordt als download verzonden, zodat een geüpload HTML- of SVG-bestand geen scripts op je
  domein kan uitvoeren. Objecten van zulke types worden ook op S3 als download opgeslagen.

## Media via de content-API

De content-API heeft de uploadroutes van Strapi, gecontroleerd tegen grants op de
**Mediabibliotheek** (`plugin::upload`):

| Route | Grant |
| --- | --- |
| `POST /api/upload` (multipart `files`, optioneel `fileInfo`) | `create` |
| `POST /api/upload?id={id}` (nieuwe `fileInfo`, optioneel een nieuw bestand) | `update` |
| `GET /api/upload/files` | `find` |
| `GET /api/upload/files/{id}` | `findOne` |
| `DELETE /api/upload/files/{id}` | `delete` |

Net als in Strapi antwoorden deze met gewone bestandsobjecten en arrays, zonder de
`data`-envelop. Zie [REST-API](/nl/api/rest/#mediabibliotheek). Wijzigingen sturen de
[webhook](/nl/api/webhooks/)- en [realtime](/nl/api/realtime/)-events `media.create`,
`media.update` en `media.delete`.
