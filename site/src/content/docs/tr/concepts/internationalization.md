---
title: "Uluslararasılaştırma"
description: "Verdin’in bir belgenin dil başına bir sürümünü nasıl tuttuğu, hangi alanların yerelleştirildiği veya paylaşıldığı ve API’lerin bir dili nasıl seçtiği."
sidebar:
  order: 5
---

Uluslararasılaştırma (i18n), bir belgenin içeriğini birkaç dilde tutar. Bu sayfa modeli
açıklar: diller, yerelleştirilmiş ve paylaşılan alanlar ve okuma ile yazmaların bir dili nasıl
seçtiği. Editörün iş akışı için bkz.
[İçeriği yerelleştirme](/tr/guides/content/localizing-content/).

## Diller

Projenin dilleri **Ayarlar → Uluslararasılaştırma** bölümünde listelenir (`locales.manage`
izni). İlk başlatma, varsayılan dil olarak İngilizceyi (`en`) ekler.

- Bir dil her zaman varsayılandır. Hiçbir dil belirtmeyen istekler onu kullanır ve silinemez.
- Kodlar, iki veya üç küçük harften oluşan bir dil kodudur; isteğe bağlı olarak alt etiketler
  gelir: `en`, `fr`, `pt-BR`, `zh-Hans`.

:::caution
Bir dili silmek, o dilde yazılmış tüm sürümleri de siler.
:::

## Yerelleştirilmiş içerik tipleri

Bir içerik tipi, şeması öyle söylediğinde yerelleştirilmiştir. Bu durumda her belgenin dil
başına bir sürümü olur ve hepsi aynı `documentId`’yi paylaşır:

```json title="schema/content-types/article.json (excerpt)"
{
  "kind": "collectionType",
  "singularName": "article",
  "pluralName": "articles",
  "displayName": "Article",
  "options": { "draftAndPublish": true },
  "pluginOptions": { "i18n": { "localized": true } },
  "attributes": {
    "title": { "type": "string", "required": true },
    "readingTime": { "type": "integer", "pluginOptions": { "i18n": { "localized": false } } }
  }
}
```

[Taslak ve yayınlama](/tr/concepts/draft-and-publish/) ile her dilin kendi taslağı ve
yayınlanmış sürümü vardır; böylece bir Fransızca çeviri İngilizce metinden önce veya sonra
yayınlanabilir. `pluginOptions.i18n.localized` içermeyen tipler yerelleştirilmemiştir ve
`locale` parametrelerini yok sayar.

## Neler yerelleştirilir

Yerelleştirilmiş bir tipte, `"pluginOptions": { "i18n": { "localized": false } }` demediği
sürece her nitelik yerelleştirilmiştir. Böyle **paylaşılan** bir alanın tüm belge için tek bir
değeri vardır:

- Paylaşılan bir alanı bir dilde kaydetmek, onu tüm dillerin taslaklarına yazar.
- Bir dili yayınlamak, onun paylaşılan alanlarını diğer dillerin yayınlanmış sürümlerine
  kopyalar.
- Bu ilişkiler ve medya için de geçerlidir: paylaşılan bir ilişki her dilde aynı belgeleri
  bağlar.

Sistem alanları sürümü izler: her dilin kendi `createdAt`, `updatedAt` ve `publishedAt`
değerleri vardır. `unique` ve `uid` değerleri dil başına benzersizdir; bu yüzden iki çeviri
aynı slug’ı paylaşabilir.

## Yerelleştirilmiş tipler arasındaki ilişkiler

İlişkiler sürümleri değil belgeleri bağlar (bkz.
[İlişkiler](/tr/concepts/relations/#satıra-göre-değil-belgeye-göre-bağlı)); bu yüzden dil
okuma sırasında seçilir:

- Her iki tip de yerelleştirilmişse Fransızca makale, kategorisinin Fransızca sürümünü
  gösterir. İlişki üzerinden yapılan filtreler aynı dilde eşleşir.
- Hedef tip yerelleştirilmemişse her dil aynı hedefi görür.

## API’lerde dil seçme

REST ve admin API, Strapi v5 biçiminde bir sorgu parametresi olarak `locale` alır; GraphQL
bir `locale` argümanı alır:

```http
GET /api/articles?locale=fr
PUT /api/articles/{documentId}?locale=fr
DELETE /api/articles/{documentId}?locale=fr
```

```graphql
query {
  articles(locale: "fr") {
    documentId
    title
  }
}
```

- `locale` olmadan istekler varsayılan dili okur ve yazar.
- Belgenin henüz sahip olmadığı bir dilde yapılan `PUT` o sürümü oluşturur.
- Bir `DELETE` yalnızca istenen dildeki sürümü kaldırır. Belgeye işaret eden bağlantılar,
  hiçbir dil kalmadığında kaldırılır.
- Yerelleştirilmiş tiplerin REST yanıtları `locale` içerir. Bilinmeyen bir dil `400`
  hatasıdır.
- Webhook payload’ları, gerçek zamanlı olaylar ve içerik geçmişi değişen sürümün dilini
  kaydeder.

## Dil başına izinler

Admin rolleri içerik izinlerini bazı dillerle sınırlayabilir; böylece bir Fransızca editörü
yalnızca Fransızca sürümleri okuyabilir veya değiştirebilir. Bkz.
[İzinler](/tr/concepts/permissions/#alan-ve-dil-izinleri). İçerik API’sinin yetkileri
(herkese açık erişim, API token’ları, son kullanıcı rolleri) her dile uygulanır.

## Strapi ile karşılaştırma

Model ve parametreler Strapi v5’in i18n’i ile eşleşir: yerelleştirilmiş tipler,
`localized: false` alanlar, `?locale=` ve varsayılan dil. Verdin’de i18n çekirdeğin bir
parçasıdır ve her zaman açıktır: onu şemada içerik tipi başına açarsınız.
