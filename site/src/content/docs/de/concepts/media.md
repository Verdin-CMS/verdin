---
title: "Medien"
description: "Die Medienbibliothek, Medienfelder, Bildformate, Speicher-Provider (lokal oder S3) und Ordner und wie Dateien mit Inhalten verknüpft werden."
sidebar:
  order: 8
---

Die Medienbibliothek enthält die Bilder, Videos, Audiodateien und anderen Dateien, die deine
Inhalte verwenden. Diese Seite erklärt, wie Dateien gespeichert, beschrieben und mit
Dokumenten verknüpft werden. Wie du verkleinerte Bilder auf deiner Website auslieferst, steht
unter [Bilder](/de/guides/frontend/images/).

## Dateien

Jeder Upload ist ein Dateidatensatz im Format von Strapi, sodass für Strapi geschriebene
Frontends ihn unverändert lesen (`formats` gekürzt):

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

- `size` ist in Kilobyte angegeben, wie in Strapi.
- Der MIME-Typ wird aus den Bytes der Datei bestimmt, nie aus dem, was der Client behauptet.
- `focalPoint` markiert den Bildbereich, der beim Zuschneiden sichtbar bleiben soll.

Dateien haben keinen Entwurf: Ein Upload ist verfügbar, sobald er gespeichert ist.

## Die Medienbibliothek

Im Admin-Panel listet die **Medienbibliothek** Dateien mit Suche, Filtern nach Typ und
Ordnern. Admins laden Dateien hoch, importieren sie von einer URL, bearbeiten Name,
Alternativtext, Bildunterschrift und Fokuspunkt, ersetzen den Inhalt einer Datei unter
Beibehaltung ihrer ID und sehen, **wo sie verwendet wird**: in Medienfeldern, in Medien
innerhalb von Komponenten, in Rich-Text-Blöcken und in Markdown, das ihre URL enthält.

**Ordner** strukturieren die Bibliothek für die Redaktion. Dateiobjekte in API-Antworten zeigen
sie nicht, aber ein Upload über die Content-API kann in seinem `fileInfo` eine Ordner-ID
angeben. Wer einen Ordner löscht, löscht die Dateien darin.

Der Admin-Zugriff wird über die Berechtigungen `media.read`, `media.create`, `media.update` und
`media.delete` gesteuert. Die eingebaute Rolle Author darf nur die Dateien bearbeiten und
löschen, die sie selbst hochgeladen hat. Siehe [Berechtigungen](/de/concepts/permissions/).

## Medienfelder

Ein Inhaltstyp verknüpft Dateien über ein `media`-Attribut:

```json
"cover": { "type": "media", "allowedTypes": ["images"] },
"gallery": { "type": "media", "multiple": true, "allowedTypes": ["images", "videos"] }
```

| Option | Standard | Beschreibung |
| --- | --- | --- |
| `multiple` | `false` | Enthält eine Liste von Dateien statt einer einzelnen. |
| `allowedTypes` | jede Datei | Beliebige aus `images`, `videos`, `audios` und `files` (alles andere), bei jedem Schreiben gegen den gespeicherten MIME-Typ geprüft. |

Medienfelder verhalten sich wie Relationen: Jede Version eines Dokuments hat ihre eigenen
Verknüpfungen, Veröffentlichen kopiert sie, und `required` wird beim Veröffentlichen geprüft.
Sie liegen in einer Verknüpfungstabelle pro Feld. In
[Komponenten](/de/concepts/components-and-dynamic-zones/) speichert stattdessen das JSON der
Komponente die Datei-IDs.

Beim Schreiben schickst du Datei-IDs: `5`, `{ "id": 5 }`, `[5, 6]` oder `null`, um das Feld zu
leeren. Beim Lesen werden Medienfelder nur zurückgegeben, wenn sie per Populate geladen werden
(`populate=cover`), und zwar als Dateiobjekte. Wird eine Datei gelöscht, verschwindet sie aus
jedem Dokument, das sie verwendet hat.

## Bildformate

Beim Upload eines Rasterbilds erzeugt Verdin die Formate von Strapi im Format des Bilds selbst
und berücksichtigt dabei seine EXIF-Ausrichtung:

| Format | Größe |
| --- | --- |
| `thumbnail` | Passt in 245 × 156 |
| `large` | 1000 px breit |
| `medium` | 750 px breit |
| `small` | 500 px breit |

Ein Format wird übersprungen, wenn das Original nicht größer ist. `[upload].breakpoints` ändert
Breiten und Namen, und `responsive_formats = false` schaltet die Formate ab.
`max_original_size` verkleinert große Originale beim Upload, wodurch auch ihre Metadaten (EXIF,
GPS) entfallen. `max_image_megapixels` (standardmäßig 100) lehnt Bilder ab, deren Dekodierung
zu viel Speicher bräuchte. Mit dem lokalen Provider kann `/uploads` Bilder außerdem auf Anfrage
skalieren und umwandeln; siehe [Bilder](/de/guides/frontend/images/).

## Speicher-Provider

Dateien werden von einem Provider gespeichert, der in `[upload].provider` festgelegt wird:

| Provider | Speichert Dateien | Liefert sie aus |
| --- | --- | --- |
| `local` (Standard) | In `public/uploads` (Option `dir`), relativ zum Projekt | Unter `/uploads` auf dem Verdin-Server |
| `s3` | In einem beliebigen S3-kompatiblen Bucket: AWS S3, Cloudflare R2, Backblaze B2, MinIO, RustFS… | Über die `public_url` des Buckets oder CDNs |

```toml title="verdin.toml"
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

S3-Zugangsdaten kommen aus den üblichen `AWS_*`-Umgebungsvariablen, nie aus `verdin.toml`.
Alle Optionen stehen in der [Konfigurationsreferenz](/de/reference/configuration/).

Gespeicherte Namen haben die Form `{slug}_{random}{ext}` und ändern sich nie, URLs lassen sich
also für immer cachen. Mit mehreren Verdin-Instanzen nimm S3: Lokale Dateien existieren nur auf
der Instanz, die sie empfangen hat.

## Sicherheit

- Uploads werden in temporäre Dateien gestreamt, nie im Speicher gehalten, und sind durch
  `[upload].max_file_size` (standardmäßig 200 MB) begrenzt, mit höchstens 20 Dateien pro
  Anfrage.
- Dateien, die über `/uploads` ausgeliefert werden, tragen
  `Content-Security-Policy: sandbox` und `X-Content-Type-Options: nosniff`. Alles, was kein
  Bild, Video, Audio, PDF oder reiner Text ist, wird als Download gesendet, sodass eine
  hochgeladene HTML- oder SVG-Datei keine Skripte auf deiner Domain ausführen kann. Auch auf S3
  werden Objekte solcher Typen als Downloads gespeichert.

## Medien über die Content-API

Die Content-API hat die Upload-Routen von Strapi, geprüft gegen die Berechtigungen der
**Medienbibliothek** (`plugin::upload`):

| Route | Berechtigung |
| --- | --- |
| `POST /api/upload` (Multipart `files`, optional `fileInfo`) | `create` |
| `POST /api/upload?id={id}` (neues `fileInfo`, optional eine neue Datei) | `update` |
| `GET /api/upload/files` | `find` |
| `GET /api/upload/files/{id}` | `findOne` |
| `DELETE /api/upload/files/{id}` | `delete` |

Wie in Strapi antworten sie mit einfachen Dateiobjekten und Arrays, ohne die `data`-Hülle.
Siehe [REST-API](/de/api/rest/#medienbibliothek). Änderungen senden die
[Webhook-](/de/api/webhooks/) und [Echtzeit-Events](/de/api/realtime/) `media.create`,
`media.update` und `media.delete`.
