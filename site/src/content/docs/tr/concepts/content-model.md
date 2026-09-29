---
title: "İçerik modeli"
description: "Verdin’in içeriğinizi nasıl tanımladığı: koleksiyon ve tekil tipler, nitelikler, Strapi biçimindeki şema dosyaları ve doğrulama kuralları."
sidebar:
  order: 1
---

İçerik modeli, projenizin tanımladığı içerik tipleri ve bileşenler kümesidir. Verdin diğer her
şeyi bundan türetir: veritabanı tabloları, REST ve GraphQL API’leri, OpenAPI belgesi,
doğrulama ve yönetim panelinin formları. Bu sayfa parçaları ve onlara uygulanan kuralları
açıklar.

## İçerik tipleri

Bir içerik tipi, makale veya ana sayfa gibi tek bir belge türünü tanımlar. Bir `kind` değeri
vardır:

| Tür | Tuttuğu | REST rotaları (blog örneği) |
| --- | --- | --- |
| `collectionType` | Herhangi sayıda belge | `/api/articles`, `/api/articles/{documentId}` |
| `singleType` | En fazla bir belge | `/api/homepage` |

Koleksiyon tipleri `pluralName`, tekil tipler `singularName` değerlerinde sunulur. Tekil bir
tipe yapılan ilk `PUT` belgesini oluşturur. Tüm rotalar için bkz. [REST API](/tr/api/rest/).

Her içerik tipinin `api::<singularName>` biçiminde bir UID’si vardır (`api::article`). Strapi
aynı UID’yi `api::article.article` olarak yazar; Verdin bu biçimi şema dosyalarında ve içe
aktarıcıda kabul eder ve `api::article` biçimine normalleştirir.

Her belgenin sizin bildirmediğiniz sistem alanları vardır: `id`, `documentId` (taslaklar,
yayınlanan sürümler ve diller arasında sabit kalan 26 karakterlik küçük harfli bir ULID),
`createdAt`, `updatedAt`, `publishedAt` ve [yerelleştirilmiş tiplerde](/tr/concepts/internationalization/)
`locale`.

## Şema dosyaları

İçerik tipleri ve bileşenler, projenizin `schema/` dizinindeki JSON dosyalarıdır
(`verdin.toml` içinde `[schema].path`). Onları kod gibi git’te sürümlersiniz.

```
schema/
├── content-types/
│   ├── article.json
│   ├── category.json
│   ├── tag.json
│   └── homepage.json
└── components/
    ├── blocks/
    │   ├── hero.json
    │   └── quote.json
    └── shared/
        └── seo.json
```

Biçim Strapi’nin `schema.json` biçimidir, bu yüzden Strapi şemalarının çoğu değişmeden
yüklenir. Bu, [blog örneğinin](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog)
makale tipidir:

```json title="schema/content-types/article.json"
{
  "kind": "collectionType",
  "singularName": "article",
  "pluralName": "articles",
  "displayName": "Article",
  "options": { "draftAndPublish": true },
  "attributes": {
    "title": { "type": "string", "required": true, "maxLength": 200 },
    "slug": { "type": "uid", "targetField": "title", "required": true },
    "excerpt": { "type": "text", "maxLength": 500 },
    "body": { "type": "richtext" },
    "readingTime": { "type": "integer", "min": 0 },
    "featured": { "type": "boolean", "default": false },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "tags": { "type": "relation", "relation": "manyToMany", "target": "tag" },
    "seo": { "type": "component", "component": "shared.seo" },
    "blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"] }
  }
}
```

| Anahtar | Zorunlu | Açıklama |
| --- | --- | --- |
| `kind` | evet | `collectionType` veya `singleType`. |
| `singularName` | evet | Kebab-case. Dosya adıyla eşleşmelidir (`article.json`). |
| `pluralName` | evet | Kebab-case, `singularName`’den farklı. |
| `displayName` | evet | Yönetim panelinin gösterdiği ad. |
| `description` | hayır | Yönetim panelinde gösterilir. |
| `collectionName` | hayır | Tablo adı. Varsayılan olarak snake_case `pluralName`. |
| `options.draftAndPublish` | hayır | Her belgenin bir taslağını ve bir yayınlanmış sürümünü tutar. Varsayılan `false`. Bkz. [Taslak ve yayınlama](/tr/concepts/draft-and-publish/). |
| `pluginOptions.i18n.localized` | hayır | Dil başına bir sürüm. Varsayılan `false`. Bkz. [Uluslararasılaştırma](/tr/concepts/internationalization/). |
| `attributes` | hayır | API’nin döndürdüğü sırayla alanlar. |
| `validations` | hayır | Alanlar arası kurallar; bkz. [aşağısı](#alanlar-arası-doğrulamalar). |

Şemalar katıdır: bilinmeyen bir anahtar, bir tipin desteklemediği bir seçenek veya eksik bir
tipe ya da bileşene referans, dosyayı ve yolu belirten bir hatadır ve sunucu başlamaz.
Dosyaları sunucuyu başlatmadan doğrulamak için `verdin schema check` çalıştırın.

Bazı adlar ayrılmıştır:

- Nitelik adları bir harfle başlar, ardından harfler, rakamlar ve alt çizgiler gelir; en fazla
  50 karakterdir. snake_case sütunlara dönüşürler (`metaTitle` → `meta_title`).
- `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`,
  `updatedAt`, `createdBy` ve `updatedBy` içerik tiplerinde, `id` ise bileşenlerin içinde
  ayrılmıştır.
- `upload`, `uploads`, `auth`, `users` ve `connect`, bir `singularName` veya `pluralName`
  olamaz: bu rotalar API’ye aittir.
- Bir içerik tipinin en fazla 60 `string`, `email`, `uid` ve `enumeration` niteliği olabilir;
  bu, satırları MySQL’in satır boyutu sınırı içinde tutar. Bazıları için `text` kullanın.

Dosyaları, sunucu `verdin dev` ile çalışırken kullanılabilen admin’in **İçerik Tipi
Oluşturucu** ekranında ya da elle düzenlersiniz. Her iki durumda da bir değişiklik bir
[şema migrasyonuna](/tr/concepts/schema-migrations/) dönüşür. Düzenleyicinin yerleşimi (alan
sırası, genişlikler, etiketler) şemanın parçası değildir: admin’ler bunu panelde yapılandırır
ve veritabanında saklanır.

## Bileşenler

Bir bileşen, `shared.seo` (bir meta başlık ve bir meta açıklama) gibi yeniden kullanılabilir
bir alan grubudur. UID’si yolundan alınan `<category>.<name>` biçimindedir:
`schema/components/shared/seo.json`, `shared.seo`’dur. Bir bileşen dosyasında `displayName`,
isteğe bağlı `description` ve `icon` ile `attributes` bulunur.

Dinamik bölge, hero ve alıntı bloklarından oluşan bir makale gövdesi gibi birkaç bileşeni
karıştıran bir listedir. Her ikisi de belgenin içinde JSON olarak saklanır; bkz.
[Bileşenler ve dinamik bölgeler](/tr/concepts/components-and-dynamic-zones/).

## Nitelikler

Her niteliğin bir `type` değeri ve buna bağlı seçenekleri vardır. Tiplerin, seçeneklerinin ve
veritabanı başına sütun tiplerinin tam listesi
[nitelik tipleri başvurusundadır](/tr/reference/attribute-types/).

| Kategori | Tipler |
| --- | --- |
| Metin | `string`, `text`, `richtext` (Markdown), `blocks` (Strapi’nin yapılandırılmış zengin metni), `email`, `uid`, `password`, `enumeration` |
| Sayılar | `integer`, `biginteger`, `float`, `decimal` |
| Tarihler | `date`, `time`, `datetime` |
| Diğer skalerler | `boolean`, `json` |
| Bağlantılar | `relation` (bkz. [İlişkiler](/tr/concepts/relations/)), `media` (bkz. [Medya](/tr/concepts/media/)) |
| Yapı | `component`, `dynamiczone` |

Ortak seçenekler:

| Seçenek | Etkisi |
| --- | --- |
| `required` | Bir sürüm yayınlandığında (taslak ve yayınlama kullanmayan tiplerde her yazmada) değer ayarlanmış olmalıdır. Taslaklar eksik olabilir. |
| `private` | İçerik API’si tarafından asla döndürülmez, filtrelenmez, sıralanmaz veya populate edilmez. `password` nitelikleri her zaman private’tır. |
| `default` | Yeni bir belge alanı dışarıda bıraktığında kullanılan değer. Niteliğin kendi kurallarına karşı denetlenir. |
| `unique` | Dil ve sürüm başına hiçbir iki belge aynı değeri paylaşamaz. `string`, `email`, sayı, tarih ve saat tiplerinde kullanılabilir; `uid` her zaman benzersizdir. |
| `configurable` | `false`, niteliği içerik tipi oluşturucusunda kilitler: orada düzenlenemez, yeniden adlandırılamaz veya silinemez. |
| `pluginOptions.i18n.localized` | `false`, değeri diller arasında paylaştırır. |

Her nitelik sütunu veritabanında nullable’dır. Strapi v5’te olduğu gibi `required`, bir
`NOT NULL` kısıtıyla değil, yayınlama sırasında Verdin tarafından uygulanır; bu yüzden zaten
satırları olan bir tipe zorunlu bir nitelik eklemek güvenli bir değişikliktir.

## Doğrulama

Her yazma, veritabanına bir şey ulaşmadan önce şemaya karşı denetlenir:

- **Tipler ve kısıtlar**, her yazmada: değer tipleri, `minLength`/`maxLength`, `min`/`max`,
  `regex`, `enum` değerleri, tekrarlanabilir bileşenlerdeki ve dinamik bölgelerdeki öğe
  sayısı, bir dinamik bölgenin izin verdiği bileşen tipleri ve bir medya alanının kabul ettiği
  dosya tipleri. Girdideki bilinmeyen anahtarlar ve sistem alanları hatadır.
- **Zorunlu alanlar ve alanlar arası kurallar**, bir sürüm yayınlandığında ve taslak ve
  yayınlama kullanmayan tiplere yapılan her yazmada. Bileşenlerin ve dinamik bölgelerin
  içinde de uygulanır.
- **Benzersizlik**, veritabanındaki benzersiz indekslerle; böylece iki eşzamanlı yazmanın her
  ikisi birden başarılı olamaz.

Başarısız bir denetim, `details.errors` alanı her sorunu `["seo", "metaTitle"]` veya
`["blocks", 2, "text"]` gibi yoluyla listeleyen bir `ValidationError` ile `400` yanıtını
verir. Bkz. [Hatalar](/tr/api/rest/#hatalar).

### Alanlar arası doğrulamalar

Bir içerik tipi, kendi alanlarını karşılaştıran ve [JSON Logic](https://jsonlogic.com) ile
yazılmış kurallar bildirebilir. Bu etkinlik tipi, bitiş tarihinin başlangıç tarihinden sonra
gelmesini gerektirir ve satılan biletleri koltuk sayısıyla sınırlar:

```json title="schema/content-types/event.json"
{
  "kind": "collectionType",
  "singularName": "event",
  "pluralName": "events",
  "displayName": "Event",
  "attributes": {
    "startDate": { "type": "date", "required": true },
    "endDate": { "type": "date" },
    "seats": { "type": "integer", "min": 0 },
    "sold": { "type": "integer", "min": 0 }
  },
  "validations": [
    {
      "rule": { "or": [{ "!": { "var": "endDate" } }, { "<=": [{ "var": "startDate" }, { "var": "endDate" }] }] },
      "message": "must be after the start date",
      "field": "endDate"
    },
    { "rule": { "<=": [{ "var": "sold" }, { "var": "seats" }] }, "message": "more tickets sold than seats" }
  ]
}
```

- Sağlanmayan bir kural, verilmişse `field` üzerinde, aksi hâlde belge üzerinde (`path: []`)
  `message` ile bir doğrulama hatasıdır.
- Kurallar `required` ile aynı anda çalışır: yayınlamada ve taslak ve yayınlama kullanmayan
  tiplere yapılan her yazmada. Taslaklar bunları ihlal edebilir.
- `var`, bileşenlerin içine noktalı yollarla, belgenin kendi alanlarını okur. İlişkiler ve
  medya kurallarda kullanılamaz.
- Karşılaştırmalar her iki taraf sayı olduğunda sayısal, her ikisi string olduğunda metinseldir;
  böylece ISO tarihleri, saatleri ve tarih-saatleri doğru karşılaştırılır. Boş bir alan
  `null`’dır: ilk kuralın yaptığı gibi isteğe bağlı alanları koruma altına alın.
- İzin verilen operatörler: `var`, `==`, `!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`,
  `and`, `or`, `in`, `if`, `?:`, `+`, `-`, `*`, `/`, `%`, `min`, `max`, `cat`. Bilinmeyen bir
  operatör, bilinmeyen bir `field` veya boş bir `message` şema hatasıdır.

Kuralları sunucu denetler; bir yayınlama başarısız olduğunda yönetim paneli mesajlarını adını
verdikleri alanlarda gösterir. Strapi’de bunun bir karşılığı yoktur. Strapi’nin koşullu
alanları (`conditions`) şema dosyalarında kabul edilir ve korunur, ancak henüz uygulanmaz.
