---
title: "GraphQL API"
description: "Verdin’in GraphQL uç noktasını etkinleştirme, içerik tiplerinizden ürettiği şema, sorgular, mutation’lar, connection’lar, hatalar ve sınırlar."
sidebar:
  order: 2
  label: "GraphQL"
---

Verdin, içerik tiplerinizden üretilen ve Strapi v5’in GraphQL eklentisine benzer biçimde
tasarlanmış bir GraphQL API sunabilir. REST API’nin izinlerini, filtrelerini, sayfalamasını
ve doğrulamasını paylaşır: GraphQL argümanları, bir REST isteğinin yapacağı sorgunun
aynısına çevrilir. Bu sayfa başvuru kaynağıdır; örnekler
[blog örneğini](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog) kullanır.

## Etkinleştirme

GraphQL varsayılan olarak kapalıdır. **Ayarlar → Özellikler → GraphQL** bölümünden açın
(`features.manage` izni). Değişiklik yeniden başlatmadan hemen uygulanır ve uç nokta şudur:

```
POST /graphql
```

REST önekinin altında değil, sunucunun kökünde sunulur. JSON olarak
`{ "query", "variables", "operationName" }` gönderin. `GET /graphql?query=…` de sorguları
çalıştırır (mutation’lar `POST` gerektirir).

```sh title="Terminal"
curl -X POST 'https://cms.example.com/graphql' \
  -H "Authorization: Bearer $VERDIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ articles(sort: [\"publishedAt:desc\"]) { documentId title } }"}'
```

Çağıranlar REST API’deki gibi kimlik doğrular: herkese açık erişim için başlık yok, bir API
token’ı veya bir son kullanıcının JWT’si. Hatalı biçimlendirilmiş bir `Authorization` başlığı
ya da bilinmeyen bir token `401` yanıtını verir. Bkz. [İzinler](/tr/concepts/permissions/).
Başka origin’lerdeki tarayıcılar `[api].cors_origins` ayarına ihtiyaç duyar.

### Ayarlar

| Ayar | Varsayılan | Nerede | Etkisi |
| --- | --- | --- | --- |
| **GraphiQL oyun alanı** | `verdin dev` içinde açık, `verdin start` içinde kapalı | Özellik ayarları | Bir tarayıcı `GET /graphql` açtığında GraphiQL’i sunar. unpkg.com’dan yüklenir. |
| **İç gözlem (introspection)** | açık | Özellik ayarları | İstemcilerin ve araçların şemayı okumasına izin verir. Şemayı herkesten gizlemek için kapatın. |
| **Devre dışı işlemler** | yok | Özellik ayarları | İçerik tipi başına `find`, `findOne`, `create`, `update` veya `delete`’i (ya da tüm sorguları, tüm mutation’ları, her şeyi) şemanın dışında bırakır; Strapi’nin shadow CRUD anahtarları gibi. REST etkilenmez. |
| `maxDepth` | `10` | Admin API | İzin verilen en derin seçim. |
| `maxComplexity` | `1000` | Admin API | İzin verilen en yüksek sorgu karmaşıklığı (kabaca seçilen alan sayısı). |

`maxDepth` ve `maxComplexity` için panelde henüz bir alan yok. Bunları
[admin API](/tr/api/admin/) ile ayarlayın: `GET /admin/api/features` mevcut ayarları
döndürür, `PUT /admin/api/features/graphql` ise onları değiştirir; bu yüzden korumak
istediklerinizi de gönderin:

```json
{ "enabled": true, "settings": { "playground": false, "introspection": true, "maxDepth": 8, "maxComplexity": 500 } }
```

## Şema

Her içerik tipi için şemada, `singularName` değerinin PascalCase hâliyle adlandırılmış bir
nesne tipi bulunur (`article` → `Article`, `blog-post` → `BlogPost`). Bu tipte şunlar yer alır:

- `documentId: ID!`
- `private` olmayan her nitelik
- `DateTime` olarak `createdAt`, `updatedAt` ve `publishedAt`
- yerelleştirilmiş tiplerde `locale: String`

| Nitelik | GraphQL tipi |
| --- | --- |
| `string`, `text`, `richtext`, `email`, `uid`, `enumeration` | `String` |
| `integer` | `Int` |
| `biginteger` | `Long` (REST’teki gibi bir string) |
| `float`, `decimal` | `Float` |
| `boolean` | `Boolean` |
| `date`, `time`, `datetime` | `Date`, `Time`, `DateTime` |
| `json`, `blocks` | `JSON` |
| tekli (to-one) ilişki | hedefin tipi, örn. `Category` |
| çoklu (to-many) ilişki | `filters`, `pagination` ve `sort` argümanlarıyla `[Tag!]!` |
| `media` | `UploadFile`, `multiple` olduğunda `[UploadFile!]!` |
| `component` | `ComponentSharedSeo` (`shared.seo` UID’sinden), tekrarlanabilirse bir liste |
| `dynamiczone` | `[ArticleBlocksDynamicZone!]!`, bileşenlerinin bir union’ı |
| polimorfik ilişki | `JSON` (`__type` değerleriyle belgeler) |

Kök `Query` ayrıca sunucunun sürümü olan `verdin: String!` alanını içerir.

## Sorgular

| Koleksiyon tipi `article` | Döndürür |
| --- | --- |
| `articles(filters, pagination, sort, status, locale)` | `[Article!]!` |
| `articles_connection(filters, pagination, sort, status, locale)` | `nodes` ve `pageInfo` ile `ArticleEntityResponseCollection` |
| `article(documentId: ID!, status, locale)` | `Article` veya `null` |

| Tekil tip `homepage` | Döndürür |
| --- | --- |
| `homepage(status, locale)` | `Homepage` veya `null` |

Sorgu ve alan adları camelCase hâlinde `pluralName` ve `singularName` değerlerinden gelir
(`blog-posts` → `blogPosts`).

```graphql
query LatestArticles($page: Int) {
  articles_connection(
    filters: { category: { name: { eq: "News" } }, title: { containsi: "rust" } }
    sort: ["publishedAt:desc"]
    pagination: { page: $page, pageSize: 10 }
  ) {
    nodes {
      documentId
      title
      slug
      category { name }
      tags(sort: ["label:asc"]) { label }
      seo { metaTitle metaDescription }
      blocks {
        __typename
        ... on ComponentBlocksHero { title subtitle }
        ... on ComponentBlocksQuote { text author }
      }
    }
    pageInfo { page pageSize pageCount total }
  }
}
```

Aynı istek REST üzerinden:

```http
GET /api/articles?filters[category][name][$eq]=News&filters[title][$containsi]=rust
  &sort=publishedAt:desc&pagination[page]=1&pagination[pageSize]=10
  &populate[category][fields][0]=name&populate[tags][sort]=label:asc&populate[0]=seo&populate[1]=blocks
```

### Argümanlar

- **`filters`**: her nitelik için bir alan, ayrıca `documentId`, zaman damgaları ve `and`,
  `or` ve `not` içeren bir `ArticleFiltersInput`. Skaler alanlar `StringFilterInput` gibi
  operatör girdileri alır; bunların operatörleri `$` olmadan
  [REST operatörleridir](/tr/api/rest/#filtreler): `eq`, `ne`, `containsi`, `in`,
  `between`, `null`… İlişkiler hedefin filtre girdisini, tekrarlanamayan bileşenler ise kendi
  bileşeninkini alır.
- **`pagination`**: REST varsayılanları ve üst sınırıyla `{ page, pageSize }` veya
  `{ start, limit }`.
- **`sort`**: REST’teki gibi `"field"` veya `"field:asc|desc"` string’lerinden oluşan bir liste.
- **`status`**: `PUBLISHED` (varsayılan) veya `readDrafts` yetkisi gerektiren `DRAFT`. İlişkili
  belgeler her zaman üst belgelerinin durumunu izler.
- **`locale`**: yerelleştirilmiş tipler için bir dil kodu; aksi hâlde varsayılan dil.

Yalnızca seçtiğiniz şey yüklenir: seçim REST `populate` hâline gelir ve her ilişki düzeyi tek
bir toplu (batched) sorgudur. `articles_connection` içindeki `pageInfo` tüm eşleşmeleri
(`total`) ve sayfaları (`pageCount`) sayar.

## Mutation’lar

| Koleksiyon tipi `article` | Döndürür |
| --- | --- |
| `createArticle(data: ArticleInput!, status, locale)` | `Article` |
| `updateArticle(documentId: ID!, data: ArticleInput!, status, locale)` | `Article` |
| `deleteArticle(documentId: ID!, locale)` | `DeleteMutationResponse` (`{ documentId }`) |

| Tekil tip `homepage` | Döndürür |
| --- | --- |
| `updateHomepage(data: HomepageInput!, status, locale)` | `Homepage`; ilk güncelleme belgeyi oluşturur |
| `deleteHomepage(locale)` | `DeleteMutationResponse` |

```graphql
mutation {
  createArticle(
    data: { title: "Hello, Verdin", slug: "hello-verdin", category: "k2m7q4…", tags: ["a7c1…"] }
    status: DRAFT
  ) {
    documentId
    publishedAt
  }
}
```

- REST’te olduğu gibi `create` ve `update`, `status: DRAFT` verilmedikçe yayınlar. Ayrı
  yayınlama mutation’ları yoktur: yayından kaldırmak veya bir taslağı atmak için REST
  [eylemlerini](/tr/api/rest/#eylemler) kullanın.
- Girdiler nitelikleri yansıtır: ilişkiler `ID` veya `[ID!]` (`documentId`’ler), medya dosya
  kimlikleri, bileşenler kendi `…Input` tiplerini alır ve dinamik bölge öğeleri
  `__component` içeren `JSON` nesneleridir. Ters (`mappedBy`) ilişkiler girdilerde yer almaz.
- `delete` mutation’ları `locale` içindeki sürümü kaldırır (belirtilmezse varsayılan dil);
  `DELETE /api/articles/{documentId}?locale=fr` gibi.
- REST’tekiyle aynı doğrulama çalışır.

## Hatalar

GraphQL hataları, `200` yanıtının `errors` listesinde, `extensions.code` içinde bir kodla
gelir:

```json
{
  "data": { "createArticle": null },
  "errors": [
    {
      "message": "title is a required field",
      "path": ["createArticle"],
      "extensions": {
        "code": "BAD_USER_INPUT",
        "details": [{ "path": ["title"], "message": "title is a required field", "name": "ValidationError" }]
      }
    }
  ]
}
```

| Kod | Ne zaman |
| --- | --- |
| `FORBIDDEN` | Çağıranın işlem için yetkisi yok ya da `status: DRAFT` için `readDrafts` yetkisi yok. |
| `BAD_USER_INPUT` | Geçersiz argümanlar veya içerik; `details` doğrulama sorunlarını yollarıyla listeler. |
| `NOT_FOUND` | Belge mevcut değil (güncellemelerde ve silmelerde). |
| `INTERNAL_SERVER_ERROR` | Beklenmeyen bir hata; sunucuda günlüğe yazılır. |

`maxDepth`’ten derin veya `maxComplexity`’den karmaşık sorgular çalışmadan önce reddedilir.

## Sınırlar

GraphQL’in REST API’ninkilere ek olarak kendi sınırları vardır (`maxDepth`,
`maxComplexity`): liste başına en fazla `[api].max_page_size` belge, en fazla 5 düzey iç içe
ilişki, belge ve ilişki başına en fazla 1.000 ilişkili belge ve en fazla 100 filtre koşulu.
Bkz. [REST sınırları](/tr/api/rest/#sınırlar).

## Eklentiler

[Eklentiler](/tr/extending/plugins/), `name(args: JSON): JSON` biçiminde kök sorgular ve
mutation’lar ekleyebilir. İçerik tiplerinin zaten kullandığı adlar atlanır.

## Strapi ile karşılaştırma

Tip, sorgu ve mutation adları, `nodes` ve `pageInfo` içeren `_connection` sorguları,
`documentId` argümanları, `status` ve `locale`, Strapi v5’in GraphQL eklentisini izler ve
yerelleştirilmiş tiplerin bir `locale` alanı vardır. Tipler `id` sunmaz ve GraphQL
subscription’ları yoktur; canlı güncellemeler için
[gerçek zamanlı API’yi](/tr/api/realtime/) kullanın.
