---
title: "İlişkiler"
description: "İlişki türleri, Verdin’in belgeleri documentId ile nasıl bağladığı, sıralama, polimorfik ilişkiler ve bileşenler içinde oneWay ile manyWay’in ne anlama geldiği."
sidebar:
  order: 3
---

Bir ilişki, makale ve kategorisi gibi iki içerik tipinin belgelerini bağlar. Bu sayfa ilişki
türlerini, bağlantıların nasıl saklanıp çözümlendiğini ve bunları yazma, sıralama ve okuma
kurallarını açıklar. İstek sözdizimi için bkz. [REST API](/tr/api/rest/#yazma).

## Türler

Bir ilişki, bir `relation` türü ve bir `target` içerik tipi olan `type: "relation"`
niteliğidir:

| Tür | Bir belge şuna bağlanır | Bir hedefe şuradan bağlanılır | Ters taraf |
| --- | --- | --- | --- |
| `oneWay` | tek hedef | herhangi sayıda belge | yok |
| `manyWay` | çok hedef | herhangi sayıda belge | yok |
| `manyToOne` | tek hedef | herhangi sayıda belge | `oneToMany` |
| `oneToMany` | çok hedef | tek belge | `manyToOne` |
| `oneToOne` | tek hedef | tek belge | `oneToOne` |
| `manyToMany` | çok hedef | herhangi sayıda belge | `manyToMany` |

Blog örneği makaleleri bir kategoriye (ters tarafla) ve etiketlere (ters tarafsız) bağlar:

```json title="schema/content-types/article.json (excerpt)"
"category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
"tags": { "type": "relation", "relation": "manyToMany", "target": "tag" }
```

```json title="schema/content-types/category.json (excerpt)"
"articles": { "type": "relation", "relation": "oneToMany", "target": "article", "mappedBy": "category" }
```

- `inversedBy` içeren (veya iki anahtarı da içermeyen) taraf **sahip** taraftır: bağlantıları
  saklar ve yazdığınız taraftır.
- `mappedBy` içeren taraf **ters** taraftır: sahibin bağlantılarını tersinden okur ve salt
  okunurdur. Ona yazmak, sahip niteliği belirten bir doğrulama hatasıdır.
- İki taraf uyumlu olmalıdır: `mappedBy`, hedefin tablodaki eşleşen ters türüyle `inversedBy`
  kullanarak geri işaret eden bir niteliğini belirtir.
- `oneWay` ve `manyWay` asla ters tarafa sahip değildir.

İçerik tipi oluşturucusu ters niteliği hedefte sizin için oluşturur.

## Satıra göre değil, belgeye göre bağlı

Bir belgenin birkaç satırı vardır: bir taslak ve bir yayınlanmış sürüm, dil başına her birinden
bir tane. Verdin bir ilişkiyi, `{table}_{field}_lnk` adlı bir bağlantı tablosunda, kaynak
**satırdan** hedef **belgeye** (onun `documentId` değerine) bir bağlantı olarak saklar. Hedef
satır, ilişki okunduğunda seçilir:

- Yayınlanmış bir makale kategorisinin yayınlanmış sürümünü görür; taslağı ise kategorinin
  taslağını görür. Taslak ve yayınlama kullanmayan tiplerin, her okuyucunun gördüğü tek bir
  sürümü vardır.
- Hedef de yerelleştirilmişse okumalar onu aynı dilde çözümler. Yerelleştirilmemiş bir hedef
  tip tüm diller tarafından paylaşılır.
- Bir kategoriyi yayından kaldırmak, hiçbir bağlantıya dokunmadan onu yayınlanmış
  makalelerden gizler; yeniden yayınlamak onu geri getirir.
- Bir makaleyi yayınlamak yalnızca kendi bağlantılarını yayınlanmış sürüme kopyalar.

Strapi bunun yerine satır kimliklerini bağlar, bu yüzden bir taslak her yayınlandığında
bağlantıları yeniden yazmak zorundadır. Verdin bunu asla yapmaz; bu da yayınlamayı taslak
satırının tek bir kopyası olarak tutar.

Bütünlük yabancı anahtarlar yerine Verdin tarafından korunur: var olmayan bir belgeyi bağlamak
bir doğrulama hatasıdır ve bir belgeyi silmek, ona işaret eden bağlantıları aynı transaction
içinde kaldırır.

### Hedef başına tek belge

`oneToOne` ve `oneToMany` için bir hedef en fazla bir kaynak belgeye aittir. Başka bir belgenin
tuttuğu bir hedefi bağlamak onu **taşır**: diğer belgenin bağlantısı aynı yazmada kaldırılır.
Bu, Strapi’nin davranışıdır. Sürüm başına uygulanır: bir taslak ve onun yayınlanmış sürümü
aynı hedefi tutabilir.

## Yazma

Sahip tarafta `data`, bir `documentId`, bunların bir listesini veya bir değişikliği tanımlayan
bir nesne alır:

| Girdi | Etkisi |
| --- | --- |
| `"k2m…"` veya `{ "documentId": "k2m…" }` | Tek bir hedef bağlar (tekli ilişkiler). |
| `["k2m…", "p9x…"]` | Tüm bağlantıları bu sırayla değiştirir. |
| `null` veya `[]` | Tüm bağlantıları kaldırır. |
| `{ "set": ["k2m…"] }` | Tüm bağlantıları değiştirir. |
| `{ "connect": [...], "disconnect": [...] }` | Diğerlerini koruyarak bağlantı ekler ve kaldırır. |

Tekli bir ilişkiye yeni bir hedef bağlamak öncekinin yerini alır. `set`, `connect` veya
`disconnect` ile birleştirilemez.

Yönetim panelinde bir ilişki alanı bağlı kayıtları listeler. **Bir kayıt bağla** (çoklu
ilişkiler için **Kayıt bağla**), hedef tipin kayıtlarını metin alanlarında ve hedef
yerelleştirilmişse kaydın dilinde arayan bir diyalog açar. Bir kayıt seçin ya da birkaçını
işaretleyip ekleyin; zaten bağlı olan kayıtlar işaretlenmiştir.

## Sıralama

Çoklu ilişkiler bağlantılarının sırasını korur. Bir liste veya `set`, gönderdiğiniz sırayı
saklar. `connect` öğeleri nereye gideceklerini belirtebilir:

```json
{
  "data": {
    "tags": {
      "connect": [
        { "documentId": "k2m…", "position": { "before": "p9x…" } },
        { "documentId": "a7c…", "position": { "end": true } }
      ]
    }
  }
}
```

`position`; `{ "before": documentId }`, `{ "after": documentId }`, `{ "start": true }` veya
`{ "end": true }` değerlerinden biridir. Konumlar her yazmada yeniden numaralandırılır.
Okumalar, populate bir `sort` istemedikçe ilişkili belgeleri bağlantı sırasıyla döndürür.

## Okuma

İlişkiler yalnızca onları populate ettiğinizde döndürülür:

```http
GET /api/articles?populate[category][fields][0]=name&populate[tags][sort]=label:asc
```

Tekli bir ilişki bir nesne veya `null`’dır; çoklu bir ilişki bir dizidir. Populate edilen her
ilişki, beş düzey derinliğe kadar kendi `fields`, `filters`, `sort`, `populate` ve `count`
değerlerini alabilir. Her düzey bir join değil, ilişki başına tek bir toplu sorgudur
(`WHERE … IN (…)`); bu yüzden derin populate’ler satırları çoğaltmaz. Belge ve ilişki başına en
fazla 1.000 ilişkili belge döndürülür; `count` kesin sayıyı verir.

İlişkiler üzerinden her iki tarafta filtreleyebilir (`filters[category][name][$eq]=News`) ve
tekli bir ilişkinin alanına göre sıralayabilirsiniz (`sort=category.name:asc`). Çağıranın
okuyamadığı bir tipe giden ilişki üzerinden populate etmek, filtrelemek veya sıralamak reddedilir
(`populate=*` onu atlar); böylece ilişkiler, çağıranın [izinlerinin](/tr/concepts/permissions/)
gizlediği içeriği asla açığa çıkarmaz.

## Bileşenler içindeki ilişkiler

Bir [bileşen](/tr/concepts/components-and-dynamic-zones/) ilişki tutabilir, ancak yalnızca
`oneWay` ve `manyWay`:

```json title="schema/components/shared/related.json"
{
  "displayName": "Related",
  "attributes": {
    "label": { "type": "string" },
    "articles": { "type": "relation", "relation": "manyWay", "target": "article" }
  }
}
```

Bileşenin JSON’u `documentId`’lerin kendisini saklar: `oneWay` için bir string, `manyWay` için
bir dizi. Diğer türlere burada bu yüzden izin verilmez:

- Bir ters tarafın, ona kimin bağlandığını bulmak için her belgenin JSON’unu araması gerekirdi.
- “Hedef başına tek belge” (`oneToOne`, `oneToMany`) de böyle bir arama olmadan
  uygulanamaz.

Bileşenlerin içinde bir `manyWay` listesinin sırası dizinin sırasıdır. Referanslar yazmada
denetlenir ve bileşen populate edildiğinde belgenin durumu ve dilinde çözümlenir; artık var
olmayan hedefler dışarıda bırakılır. Bunlar üzerinde filtreleme yapılamaz.

## Polimorfik ilişkiler

`morphToOne` ve `morphToMany` herhangi bir içerik tipinin belgelerini bağlar. Bağlantıları
hedefin tipini `documentId`’sinin yanında saklar ve yazmalar her ikisini de belirtir:

```json
{ "data": { "related": [{ "__type": "api::article", "documentId": "k2m…" }, { "__type": "api::page", "documentId": "p9x…" }] } }
```

Populate edilen öğeler, isteğin durumu ve dilinde okunan, `__type` değerleriyle birlikte hedef
belgelerdir. Ters taraflar `morphOne` ve `morphMany`, sahip tipi (`target`) ve niteliğini
(`morphBy`) belirtir ve salt okunurdur. Polimorfik ilişkiler üzerinde filtreleme veya sıralama
yapılamaz ve bileşenlerin içinde olamazlar.
