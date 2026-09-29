---
title: "Media"
description: "La libreria media, i campi media, i formati delle immagini, i provider di storage (locale o S3) e le cartelle, e come i file vengono collegati ai contenuti."
sidebar:
  order: 8
---

La libreria media contiene le immagini, i video, l'audio e gli altri file usati dai tuoi
contenuti. Questa pagina spiega come i file vengono memorizzati, descritti e collegati ai
documenti. Per servire immagini ridimensionate sul tuo sito, vedi
[Immagini](/it/guides/frontend/images/).

## File

Ogni upload è un record file nella forma di Strapi, quindi i frontend scritti per Strapi lo
leggono senza modifiche (`formats` abbreviato):

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

- `size` è in kilobyte, come in Strapi.
- Il tipo MIME viene ricavato dai byte del file, mai da ciò che dichiara il client.
- `focalPoint` indica la parte di un'immagine da mantenere visibile quando viene ritagliata.

I file non hanno bozza: un upload è disponibile appena memorizzato.

## La libreria media

Nel pannello di amministrazione, **Libreria media** elenca i file con ricerca, filtri per
tipo e cartelle. Gli admin caricano file, li importano da un URL, ne modificano nome, testo
alternativo, didascalia e punto focale, sostituiscono il contenuto di un file mantenendone
l'id, e vedono **dove è utilizzato**: campi media, media dentro i componenti, blocchi rich
text e Markdown che contiene il suo URL.

Le **Cartelle** organizzano la libreria per i redattori. Gli oggetti file nelle risposte
dell'API non le mostrano, ma un upload tramite la content API può indicare l'id di una
cartella nel suo `fileInfo`. Eliminare una cartella elimina i file che contiene.

L'accesso admin è controllato dai permessi `media.read`, `media.create`, `media.update` e
`media.delete`. Il ruolo predefinito Author può modificare ed eliminare solo i file che ha
caricato. Vedi [Permessi](/it/concepts/permissions/).

## Campi media

Un tipo di contenuto collega i file tramite un attributo `media`:

```json
"cover": { "type": "media", "allowedTypes": ["images"] },
"gallery": { "type": "media", "multiple": true, "allowedTypes": ["images", "videos"] }
```

| Opzione | Default | Descrizione |
| --- | --- | --- |
| `multiple` | `false` | Contiene una lista di file invece di uno solo. |
| `allowedTypes` | qualsiasi file | Uno qualsiasi tra `images`, `videos`, `audios` e `files` (tutto il resto), verificato a ogni scrittura rispetto al tipo MIME memorizzato. |

I campi media si comportano come relazioni: ogni versione di un documento ha i propri
collegamenti, la pubblicazione li copia, e `required` viene verificato alla pubblicazione.
Sono memorizzati in una tabella di link per campo. Dentro i
[componenti](/it/concepts/components-and-dynamic-zones/), è invece il JSON del componente a
memorizzare gli id dei file.

In scrittura, invia id di file: `5`, `{ "id": 5 }`, `[5, 6]`, o `null` per svuotare il campo.
In lettura, i campi media vengono restituiti solo se popolati (`populate=cover`), come oggetti
file. Eliminare un file lo rimuove da tutti i documenti che lo usavano.

## Formati delle immagini

Quando viene caricata un'immagine raster, Verdin genera i formati di Strapi nel formato
dell'immagine stessa, rispettando il suo orientamento EXIF:

| Formato | Dimensione |
| --- | --- |
| `thumbnail` | Entro 245 × 156 |
| `large` | 1000 px di larghezza |
| `medium` | 750 px di larghezza |
| `small` | 500 px di larghezza |

Un formato viene saltato quando l'originale non è più grande. `[upload].breakpoints` cambia
larghezze e nomi, e `responsive_formats = false` li disattiva. `max_original_size`
ridimensiona gli originali grandi al caricamento, il che elimina anche i loro metadati (EXIF,
GPS). `max_image_megapixels` (100 di default) rifiuta le immagini che richiederebbero troppa
memoria per essere decodificate. Con il provider locale, `/uploads` può anche ridimensionare e
convertire le immagini su richiesta; vedi [Immagini](/it/guides/frontend/images/).

## Provider di storage

I file vengono memorizzati da un provider, impostato in `[upload].provider`:

| Provider | Memorizza i file | Li serve |
| --- | --- | --- |
| `local` (default) | In `public/uploads` (l'opzione `dir`), relativo al progetto | Su `/uploads` del server Verdin |
| `s3` | In qualsiasi bucket compatibile S3: AWS S3, Cloudflare R2, Backblaze B2, MinIO, RustFS… | Dal `public_url` del bucket o della CDN |

```toml title="verdin.toml"
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

Le credenziali S3 arrivano dalle variabili d'ambiente standard `AWS_*`, mai da
`verdin.toml`. Tutte le opzioni sono nel
[riferimento della configurazione](/it/reference/configuration/).

I nomi memorizzati sono `{slug}_{random}{ext}` e non cambiano mai, quindi gli URL possono
essere messi in cache per sempre. Con più istanze di Verdin, usa S3: i file locali esistono
solo sull'istanza che li ha ricevuti.

## Sicurezza

- Gli upload vengono trasmessi in streaming su file temporanei, mai tenuti in memoria, e
  limitati da `[upload].max_file_size` (200 MB di default), con al massimo 20 file per
  richiesta.
- I file serviti da `/uploads` hanno `Content-Security-Policy: sandbox` e
  `X-Content-Type-Options: nosniff`. Tutto ciò che non è immagine, video, audio, PDF o testo
  semplice viene inviato come download, così un file HTML o SVG caricato non può eseguire
  script sul tuo dominio. Anche su S3 gli oggetti di questi tipi vengono memorizzati come
  download.

## Media tramite la content API

La content API ha le route di upload di Strapi, verificate rispetto ai permessi sulla
**Libreria media** (`plugin::upload`):

| Route | Permesso |
| --- | --- |
| `POST /api/upload` (multipart `files`, `fileInfo` opzionale) | `create` |
| `POST /api/upload?id={id}` (nuovo `fileInfo`, opzionalmente un nuovo file) | `update` |
| `GET /api/upload/files` | `find` |
| `GET /api/upload/files/{id}` | `findOne` |
| `DELETE /api/upload/files/{id}` | `delete` |

Come in Strapi, rispondono con oggetti file e array semplici, senza l'involucro `data`. Vedi
[API REST](/it/api/rest/#libreria-media). Le modifiche inviano gli eventi
[webhook](/it/api/webhooks/) e [realtime](/it/api/realtime/) `media.create`,
`media.update` e `media.delete`.
