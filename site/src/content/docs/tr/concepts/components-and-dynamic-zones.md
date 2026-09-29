---
title: "Bileşenler ve dinamik bölgeler"
description: "Yeniden kullanılabilir alan grupları ve karışık blok listeleri, Verdin’in bunları neden belgede JSON olarak sakladığı ve bunun ilişkiler, medya, filtreleme ve populate için ne anlama geldiği."
sidebar:
  order: 2
---

Bileşenler bir alan grubunu içerik tipleri arasında yeniden kullanmanızı, dinamik bölgeler ise
editörlerin bir sayfayı blok listesinden oluşturmasını sağlar. Bu sayfa her ikisinin nasıl
modellendiğini ve saklandığını, bunun da okuma, yazma ve filtrelemeyi nasıl şekillendirdiğini
açıklar. Şema biçiminin kendisi [İçerik modeli](/tr/concepts/content-model/) sayfasındadır.

## Bileşenler

Bir bileşen, `schema/components/<category>/` altında kendi dosyası olan bir alan grubudur.
Blog örneğindeki `shared.seo` bir meta başlık ve açıklama tutar:

```json title="schema/components/shared/seo.json"
{
  "displayName": "SEO",
  "attributes": {
    "metaTitle": { "type": "string", "maxLength": 60 },
    "metaDescription": { "type": "text", "maxLength": 160 }
  }
}
```

Bir içerik tipi onu bir `component` niteliği aracılığıyla kullanır. `repeatable: true` onu,
isteğe bağlı olarak `min` ve `max` öğeyle sınırlanan bir liste yapar:

```json
"seo": { "type": "component", "component": "shared.seo" },
"links": { "type": "component", "component": "shared.link", "repeatable": true, "max": 10 }
```

Bileşenler başka bileşenler içerebilir. Bir bileşen doğrudan veya başkaları aracılığıyla
kendini içeremez; şema denetimi bu tür döngüleri reddeder.

## Dinamik bölgeler

Dinamik bölge, öğeleri adını verdiği bileşenlerden herhangi biri olabilen bir listedir. Blog’un
makale gövdesi hero’ları ve alıntıları karıştırır:

```json
"blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"], "max": 20 }
```

Her öğe hangi bileşen olduğunu `__component` içinde belirtir. `min` ve `max` öğe sayısını
sınırlar. Dinamik bölgeler yalnızca içerik tiplerine aittir: bir bileşen dinamik bölge
içeremez.

## JSON olarak saklanır

Verdin bir bileşen veya dinamik bölge değerini, belgenin satırındaki tek bir JSON sütununda
saklar (PostgreSQL’de `jsonb`, MySQL ve MariaDB’de `json`, SQLite’ta metin):

```json
// the "seo" column
{ "id": 1, "metaTitle": "Rust for CMS authors", "metaDescription": "…" }

// the "blocks" column
[
  { "__component": "blocks.hero", "id": 1, "title": "Hello", "subtitle": "…" },
  { "__component": "blocks.quote", "id": 2, "text": "…", "author": "Ferris" }
]
```

Strapi her bileşeni, polimorfik bağlantı tablolarıyla birleştirilen kendi tablosunda tutar.
Değeri bunun yerine belgeyle birlikte saklamak şu anlama gelir:

- Bir belgeyi bileşenleriyle okumak, ne kadar derin iç içe olurlarsa olsunlar join
  gerektirmez.
- Yayınlama, taslağı atma ve [içerik geçmişi](/tr/guides/content/content-history/) değeri
  olduğu gibi kopyalar.
- Bir bileşene alan eklemek hiçbir tabloyu değiştirmez: migrasyon boştur.
- Bileşen alanları üzerinde filtreleme her veritabanının JSON fonksiyonlarını kullanır ve bazı
  filtreler kullanılamaz (bkz. [Filtreleme](#filtreleme)).

Her öğe, niteliğin değeri içinde benzersiz olan pozitif bir tam sayı olan bir `id` taşır.
Verdin yeni öğelere bir tane atar; öğelerin kararlı kalması için bir listeyi güncellerken
`id`’yi geri gönderin.

## Bileşenler içindeki ilişkiler ve medya

Bir bileşen, JSON’un kendisinde saklanan ilişkiler ve medya tutabilir: ilişkiler için
`documentId`’ler ve medya için dosya kimlikleri.

- Bileşenler içindeki ilişkiler `oneWay` veya `manyWay` olmalıdır: hedeflerine işaret ederler
  ve ters tarafları yoktur. Bkz.
  [İlişkiler](/tr/concepts/relations/#bileşenler-içindeki-ilişkiler).
- Her referans yazmada denetlenir: hedef belge veya dosya mevcut olmalı ve dosyalar alanın
  `allowedTypes` değeriyle eşleşmelidir.
- Bileşen populate edildiğinde referanslar, belgeyle aynı durum ve dilde toplu sorgularla
  çözümlenir. Silinmiş ya da okunan sürümde bir sürümü olmayan hedef dışarıda bırakılır.
- Polimorfik ilişkiler (`morphToOne`, `morphToMany`) ve `password` alanları bileşenlerin
  içinde olamaz.

## Okuma

Bileşenler ve dinamik bölgeler, Strapi’deki gibi yalnızca onları populate ettiğinizde
döndürülür:

```http
GET /api/articles?populate[0]=seo&populate[1]=blocks
GET /api/articles?populate=*
```

Populate edilmiş bir bileşen; iç içe bileşenler ile çözümlenmiş ilişkiler ve medya dâhil
eksiksiz döner. Strapi her iç içe bileşen için bir `populate` düzeyi ister; Verdin uyumluluk
için bu iç içe seçenekleri kabul eder ve yok sayar. Dinamik bölge öğeleri, her biri kendi
`__component` değeriyle, saklandıkları sırada döner.

GraphQL’de bir bileşen, UID’sine göre adlandırılmış bir nesne tipidir (`ComponentSharedSeo`);
bir dinamik bölge ise fragment’larla sorguladığınız bir union’dır (`ArticleBlocksDynamicZone`).
Bkz. [GraphQL API](/tr/api/graphql/).

## Yazma

Niteliğin tüm değerini gönderin. Saklanan değerin yerini alır:

```json
{
  "data": {
    "seo": { "metaTitle": "Rust for CMS authors" },
    "blocks": [
      { "__component": "blocks.hero", "title": "Hello" },
      { "__component": "blocks.quote", "text": "Fast and small.", "author": "Ferris" }
    ]
  }
}
```

Değer her yazmada bileşenin şemasına karşı doğrulanır: bilinmeyen anahtarlar, yanlış tipler ve
dinamik bölgenin izin vermediği bir `__component`, `["blocks", 1, "text"]` gibi yollarla
birlikte hatadır. Bileşenler içindeki `required` alanlar, üst düzeydekiler gibi belge
yayınlandığında denetlenir.

## Filtreleme

| Ne | Örnek | Notlar |
| --- | --- | --- |
| Bir bileşenin alanları | `filters[seo][metaTitle][$containsi]=rust` | Skaler alanlar, iç içe bileşenler dâhil. |
| Tekrarlanabilir bir bileşenin alanları | `filters[links][url][$contains]=github` | Öğelerden biri eşleştiğinde eşleşir. |
| Dinamik bölgeler | `filters[blocks][__component][$eq]=blocks.quote` | Yalnızca `__component` ile: farklı bileşenlerin öğelerinin farklı alanları vardır. |

Bileşen alanlarına göre sıralama yapamazsınız ve bileşenlerin içindeki `json` alanları
filtrelenemez. Operatörler için bkz. [REST API](/tr/api/rest/#filtreler).
