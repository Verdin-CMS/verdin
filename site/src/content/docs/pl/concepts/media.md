---
title: "Multimedia"
description: "Biblioteka multimediów, pola multimediów, formaty obrazów, dostawcy przechowywania (lokalny lub S3) i foldery oraz sposób wiązania plików z treścią."
sidebar:
  order: 8
---

Biblioteka multimediów przechowuje obrazy, filmy, nagrania audio i inne pliki używane przez
twoją treść. Ta strona wyjaśnia, jak pliki są przechowywane, opisywane i wiązane
z dokumentami. O serwowaniu przeskalowanych obrazów w witrynie przeczytasz w
[Obrazach](/pl/guides/frontend/images/).

## Pliki

Każde przesłanie to rekord pliku w formacie Strapi, więc frontendy napisane dla Strapi
odczytują go bez zmian (`formats` skrócone):

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

- `size` jest w kilobajtach, jak w Strapi.
- Typ MIME pochodzi z bajtów pliku, nigdy z tego, co deklaruje klient.
- `focalPoint` oznacza część obrazu, która ma pozostać widoczna przy przycinaniu.

Pliki nie mają szkiców: przesłany plik jest dostępny, gdy tylko zostanie zapisany.

## Biblioteka multimediów

W panelu administracyjnym **Biblioteka multimediów** wyświetla pliki z wyszukiwaniem,
filtrami według typu i folderami. Administratorzy przesyłają pliki, importują je z URL,
edytują ich nazwę, tekst alternatywny, podpis i punkt centralny, zastępują zawartość pliku
z zachowaniem jego identyfikatora i widzą, **gdzie jest używany** (**Używane w**): pola
multimediów, multimedia w komponentach, bloki rich text i Markdown zawierający jego URL.

**Foldery** porządkują bibliotekę dla redaktorów. Obiekty plików w odpowiedziach API ich nie
pokazują, ale przesłanie przez API treści może wskazać identyfikator folderu w swoim
`fileInfo`. Usunięcie folderu usuwa znajdujące się w nim pliki.

Dostęp administratorów kontrolują uprawnienia `media.read`, `media.create`, `media.update`
i `media.delete`. Wbudowana rola Author może edytować i usuwać tylko pliki, które sama
przesłała. Zobacz [Uprawnienia](/pl/concepts/permissions/).

## Pola multimediów

Typ zawartości wiąże pliki przez atrybut `media`:

```json
"cover": { "type": "media", "allowedTypes": ["images"] },
"gallery": { "type": "media", "multiple": true, "allowedTypes": ["images", "videos"] }
```

| Opcja | Domyślnie | Opis |
| --- | --- | --- |
| `multiple` | `false` | Przechowuje listę plików zamiast jednego. |
| `allowedTypes` | dowolny plik | Dowolne z `images`, `videos`, `audios` i `files` (wszystko inne), sprawdzane przy każdym zapisie względem zapisanego typu MIME. |

Pola multimediów zachowują się jak relacje: każda wersja dokumentu ma własne powiązania,
publikacja je kopiuje, a `required` jest sprawdzane przy publikacji. Są przechowywane
w tabeli powiązań dla każdego pola. Wewnątrz
[komponentów](/pl/concepts/components-and-dynamic-zones/) identyfikatory plików przechowuje
zamiast tego JSON komponentu.

Przy zapisie wysyłaj identyfikatory plików: `5`, `{ "id": 5 }`, `[5, 6]` albo `null`, aby
wyczyścić pole. Przy odczycie pola multimediów są zwracane tylko po wypełnieniu przez
populate (`populate=cover`), jako obiekty plików. Usunięcie pliku usuwa go z każdego
dokumentu, który go używał.

## Formaty obrazów

Po przesłaniu obrazu rastrowego Verdin generuje formaty Strapi w oryginalnym formacie obrazu,
z uwzględnieniem orientacji EXIF:

| Format | Rozmiar |
| --- | --- |
| `thumbnail` | Mieści się w 245 × 156 |
| `large` | 1000 px szerokości |
| `medium` | 750 px szerokości |
| `small` | 500 px szerokości |

Format jest pomijany, gdy oryginał nie jest od niego większy. `[upload].breakpoints` zmienia
szerokości i nazwy, a `responsive_formats = false` je wyłącza. `max_original_size` zmniejsza
duże oryginały przy przesyłaniu, co usuwa też ich metadane (EXIF, GPS).
`max_image_megapixels` (domyślnie 100) odrzuca obrazy, których dekodowanie zajęłoby zbyt
dużo pamięci. Z dostawcą lokalnym `/uploads` może też na żądanie skalować i konwertować
obrazy; zobacz [Obrazy](/pl/guides/frontend/images/).

## Dostawcy przechowywania

Pliki przechowuje dostawca ustawiony w `[upload].provider`:

| Dostawca | Przechowuje pliki | Serwuje je |
| --- | --- | --- |
| `local` (domyślny) | W `public/uploads` (opcja `dir`), względem projektu | Pod `/uploads` na serwerze Verdin |
| `s3` | W dowolnym buckecie zgodnym z S3: AWS S3, Cloudflare R2, Backblaze B2, MinIO, RustFS… | Z `public_url` bucketu lub CDN |

```toml title="verdin.toml"
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

Poświadczenia S3 pochodzą ze standardowych zmiennych środowiskowych `AWS_*`, nigdy
z `verdin.toml`. Wszystkie opcje są w
[dokumentacji konfiguracji](/pl/reference/configuration/).

Zapisane nazwy mają postać `{slug}_{random}{ext}` i nigdy się nie zmieniają, więc URL-e można
cache'ować na zawsze. Przy kilku instancjach Verdin używaj S3: pliki lokalne istnieją tylko
na instancji, która je otrzymała.

## Bezpieczeństwo

- Przesyłane pliki są strumieniowane do plików tymczasowych, nigdy nie są trzymane
  w pamięci, i ogranicza je `[upload].max_file_size` (domyślnie 200 MB), z najwyżej
  20 plikami na żądanie.
- Pliki serwowane z `/uploads` mają nagłówki `Content-Security-Policy: sandbox`
  i `X-Content-Type-Options: nosniff`. Wszystko, co nie jest obrazem, filmem, audio, PDF-em
  ani zwykłym tekstem, jest wysyłane jako plik do pobrania, więc przesłany plik HTML lub SVG
  nie może uruchamiać skryptów w twojej domenie. Obiekty takich typów są też zapisywane jako
  pliki do pobrania w S3.

## Multimedia przez API treści

API treści ma trasy przesyłania plików ze Strapi, sprawdzane względem uprawnień na
**Bibliotece multimediów** (`plugin::upload`):

| Trasa | Uprawnienie |
| --- | --- |
| `POST /api/upload` (multipart `files`, opcjonalnie `fileInfo`) | `create` |
| `POST /api/upload?id={id}` (nowe `fileInfo`, opcjonalnie nowy plik) | `update` |
| `GET /api/upload/files` | `find` |
| `GET /api/upload/files/{id}` | `findOne` |
| `DELETE /api/upload/files/{id}` | `delete` |

Jak w Strapi, zwracają one zwykłe obiekty plików i tablice, bez koperty `data`. Zobacz
[API REST](/pl/api/rest/#biblioteka-multimediów). Zmiany wysyłają zdarzenia
[webhooków](/pl/api/webhooks/) i [czasu rzeczywistego](/pl/api/realtime/) `media.create`,
`media.update` i `media.delete`.
