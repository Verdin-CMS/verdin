---
title: "Medya"
description: "Medya kütüphanesi, medya alanları, görsel formatları, depolama sağlayıcıları (yerel veya S3) ve klasörler ile dosyaların içeriğe nasıl bağlandığı."
sidebar:
  order: 8
---

Medya kütüphanesi, içeriğinizin kullandığı görselleri, videoları, sesleri ve diğer dosyaları
tutar. Bu sayfa dosyaların nasıl saklandığını, tanımlandığını ve belgelere bağlandığını
açıklar. Sitenizde yeniden boyutlandırılmış görseller sunmak için bkz.
[Görseller](/tr/guides/frontend/images/).

## Dosyalar

Her yükleme Strapi biçiminde bir dosya kaydıdır; bu yüzden Strapi için yazılmış frontend’ler
onu değiştirmeden okur (`formats` kısaltılmıştır):

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

- `size`, Strapi’deki gibi kilobayt cinsindendir.
- MIME tipi, istemcinin iddia ettiğinden değil, her zaman dosyanın baytlarından gelir.
- `focalPoint`, bir görsel kırpıldığında görünür tutulacak kısmı işaretler.

Dosyaların taslağı yoktur: bir yükleme saklanır saklanmaz kullanılabilir.

## Medya kütüphanesi

Yönetim panelinde **Medya kütüphanesi**, dosyaları arama, tipe göre filtreler ve klasörlerle
listeler. Admin’ler dosya yükler, bir URL’den içe aktarır; adını, alternatif metnini,
açıklamasını ve odak noktasını düzenler; kimliğini koruyarak bir dosyanın içeriğini değiştirir
ve **nerede kullanıldığını** görür: medya alanları, bileşenlerin içindeki medya, zengin metin
blokları ve URL’sini içeren Markdown.

**Klasörler** kütüphaneyi editörler için düzenler. API yanıtlarındaki dosya nesneleri
klasörleri göstermez, ancak içerik API’si üzerinden yapılan bir yükleme `fileInfo` içinde bir
klasör kimliği belirtebilir. Bir klasörü silmek içindeki dosyaları da siler.

Admin erişimi `media.read`, `media.create`, `media.update` ve `media.delete` izinleriyle
denetlenir. Yerleşik Author rolü yalnızca kendi yüklediği dosyaları düzenleyip silebilir. Bkz.
[İzinler](/tr/concepts/permissions/).

## Medya alanları

Bir içerik tipi dosyaları bir `media` niteliği aracılığıyla bağlar:

```json
"cover": { "type": "media", "allowedTypes": ["images"] },
"gallery": { "type": "media", "multiple": true, "allowedTypes": ["images", "videos"] }
```

| Seçenek | Varsayılan | Açıklama |
| --- | --- | --- |
| `multiple` | `false` | Tek bir dosya yerine bir dosya listesi tutar. |
| `allowedTypes` | herhangi bir dosya | `images`, `videos`, `audios` ve `files` (diğer her şey) değerlerinden herhangi biri; her yazmada saklanan MIME tipine karşı denetlenir. |

Medya alanları ilişkiler gibi davranır: bir belgenin her sürümünün kendi bağlantıları vardır,
yayınlama onları kopyalar ve `required` yayınlamada denetlenir. Alan başına bir bağlantı
tablosunda saklanırlar. [Bileşenlerin](/tr/concepts/components-and-dynamic-zones/) içinde ise
bileşenin JSON’u dosya kimliklerini saklar.

Yazmalarda dosya kimlikleri gönderin: `5`, `{ "id": 5 }`, `[5, 6]` veya alanı temizlemek için
`null`. Okumalarda medya alanları yalnızca populate edildiklerinde (`populate=cover`) dosya
nesneleri olarak döndürülür. Bir dosyayı silmek onu kullanan tüm belgelerden kaldırır.

## Görsel formatları

Bir raster görsel yüklendiğinde Verdin, EXIF yönelimine uyarak görselin kendi formatında
Strapi’nin formatlarını üretir:

| Format | Boyut |
| --- | --- |
| `thumbnail` | 245 × 156 içine sığar |
| `large` | 1000 px genişlik |
| `medium` | 750 px genişlik |
| `small` | 500 px genişlik |

Orijinal bir formattan büyük değilse o format atlanır. `[upload].breakpoints` genişlikleri ve
adları değiştirir, `responsive_formats = false` ise onları kapatır. `max_original_size` büyük
orijinalleri yüklemede küçültür; bu, meta verilerini (EXIF, GPS) de siler.
`max_image_megapixels` (varsayılan 100), çözülmesi çok fazla bellek alacak görselleri reddeder.
Yerel sağlayıcıyla `/uploads` görselleri istek üzerine yeniden boyutlandırıp dönüştürebilir de;
bkz. [Görseller](/tr/guides/frontend/images/).

## Depolama sağlayıcıları

Dosyalar `[upload].provider` ile ayarlanan bir sağlayıcı tarafından saklanır:

| Sağlayıcı | Dosyaları saklar | Onları sunar |
| --- | --- | --- |
| `local` (varsayılan) | Projeye göre `public/uploads` içinde (`dir` seçeneği) | Verdin sunucusunda `/uploads` adresinde |
| `s3` | S3 uyumlu herhangi bir bucket’ta: AWS S3, Cloudflare R2, Backblaze B2, MinIO, RustFS… | Bucket’ın veya CDN’in `public_url` adresinden |

```toml title="verdin.toml"
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

S3 kimlik bilgileri asla `verdin.toml`’dan değil, standart `AWS_*` ortam değişkenlerinden gelir.
Tüm seçenekler [yapılandırma başvurusundadır](/tr/reference/configuration/).

Saklanan adlar `{slug}_{random}{ext}` biçimindedir ve asla değişmez; bu yüzden URL’ler
süresiz önbelleğe alınabilir. Birden fazla Verdin örneğiyle S3 kullanın: yerel dosyalar yalnızca
onları alan örnekte bulunur.

## Güvenlik

- Yüklemeler asla bellekte tutulmaz, geçici dosyalara akıtılır ve `[upload].max_file_size`
  (varsayılan 200 MB) ile sınırlanır; istek başına en fazla 20 dosya.
- `/uploads` adresinden sunulan dosyalar `Content-Security-Policy: sandbox` ve
  `X-Content-Type-Options: nosniff` taşır. Görsel, video, ses, PDF veya düz metin olmayan her
  şey indirme olarak gönderilir; böylece yüklenen bir HTML veya SVG dosyası alan adınızda betik
  çalıştıramaz. Bu tür nesneler S3’te de indirme olarak saklanır.

## İçerik API’si üzerinden medya

İçerik API’sinde, **Medya kütüphanesi** (`plugin::upload`) yetkilerine karşı denetlenen
Strapi’nin upload rotaları bulunur:

| Rota | Yetki |
| --- | --- |
| `POST /api/upload` (multipart `files`, isteğe bağlı `fileInfo`) | `create` |
| `POST /api/upload?id={id}` (yeni `fileInfo`, isteğe bağlı olarak yeni bir dosya) | `update` |
| `GET /api/upload/files` | `find` |
| `GET /api/upload/files/{id}` | `findOne` |
| `DELETE /api/upload/files/{id}` | `delete` |

Strapi’deki gibi bunlar, `data` zarfı olmadan düz dosya nesneleri ve dizileri döndürür. Bkz.
[REST API](/tr/api/rest/#medya-kütüphanesi). Değişiklikler `media.create`, `media.update` ve
`media.delete` [webhook](/tr/api/webhooks/) ve [gerçek zamanlı](/tr/api/realtime/) olaylarını
gönderir.
