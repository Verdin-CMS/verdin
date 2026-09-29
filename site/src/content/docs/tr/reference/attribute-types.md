---
title: Nitelik tipleri başvurusu
description: Bir Verdin şema dosyasının her nitelik tipi; seçenekleri, doğrulamaları, veritabanında saklanması ve API’deki gösterimiyle.
sidebar:
  order: 4
  label: Nitelik tipleri
---

<!-- Written from crates/verdin-schema (convert.rs, validate.rs, model.rs),
crates/verdin-migrate/src/derive.rs and sql.rs (storage), and crates/verdin-content
(input.rs, output.rs, blocks.rs) (API). -->

Nitelikler, bir içerik tipinin veya bileşenin şema dosyasında `attributes` altında bildirilen
alanlarıdır. Bu sayfa her `type` değerini, kabul ettiği seçenekleri, Verdin’in onu nasıl doğrulayıp
sakladığını ve API’de nasıl göründüğünü listeler. Biçim Strapi v5’inkidir; farklar
[sonda](#strapi-ile-farklar) listelenmiştir.

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
    "readingTime": { "type": "integer", "min": 0 },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "seo": { "type": "component", "component": "shared.seo" }
  }
}
```

Şema dosyaları katıdır: bilinmeyen bir anahtar veya tipin almadığı bir seçenek, `verdin schema
check`’in yoluyla (`attributes.title.maxLength`) bildirdiği bir hatadır.

## Her niteliğin aldığı seçenekler

| Seçenek | Varsayılan | Açıklama |
| --- | --- | --- |
| `type` | zorunlu | Aşağıdaki tiplerden biri. |
| `required` | `false` | Bir değer bulunmalıdır. Bir kayıt yayınlandığında (taslaklar eksik olabilir) ve taslak ve yayınlama kullanmayan bir tipin her yazmasında denetlenir. Bileşenlerin ve dinamik bölgelerin içinde de uygulanır. |
| `private` | `false` | İçerik API’si tarafından asla döndürülmez ve `filters` veya `sort` içinde kullanılamaz. `password` nitelikleri her zaman private’tır. |
| `configurable` | `true` | Admin’in oluşturucusu için Strapi’nin bayrağı; yazıldığı gibi korunur. |
| `pluginOptions.i18n.localized` | `true` | Yerelleştirilmiş bir içerik tipinde `false`, dil başına bir değer yerine değeri diller arasında paylaştırır. |
| `customField` | ayarlanmamış | `plugin::<plugin>.<field>` (veya `global::<field>`): admin niteliği bir eklentinin özel alanıyla düzenler. `type` değerin nasıl saklandığıdır. Bkz. [Eklentiler](/tr/extending/plugins/). |
| `conditions` | ayarlanmamış | Strapi’nin koşullu alanları (`{ "visible": <JSON Logic> }`). Kural yanlış olduğu sürece düzenleyici alanı gizler ve sunucu gizli bir alanı zorunlu tutmaz. |
| `default` | ayarlanmamış | Yazma niteliği dışarıda bıraktığında yeni kayıtların değeri. Tip için geçerli olmalıdır. Her tip bir varsayılan almaz (her tipe bakın). |

Nitelik adları bir harfle başlar, ardından harfler, rakamlar ve `_` gelir, en fazla 50 karakterdir.
İçerik tiplerinde `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`,
`updatedAt`, `createdBy` ve `updatedBy`; bileşenlerde `id` ayrılmıştır. Aynı sütuna eşlenen iki ad
(`metaTitle` ve `meta_title`) hatadır.

### Değerlerin saklandığı yer

Bir içerik tipinin her niteliği, tipin tablosunda (`collectionName` veya çoğul ad) `snake_case`
adlı bir sütundur. İlişkiler ve medya bunun yerine bağlantı tablolarında bulunur. Bir taslak ve
yayınlanmış sürümü, yerelleştirilmiş tiplerde dil başına bir tane olmak üzere iki satırdır.

Veritabanı başına sütun tipleri:

| Sütun | PostgreSQL | MySQL ve MariaDB | SQLite |
| --- | --- | --- | --- |
| varchar | `varchar(255)` | `varchar(255)` | `text` |
| text | `text` | `longtext` | `text` |
| integer | `integer` | `int` | `integer` |
| bigint | `bigint` | `bigint` | `integer` |
| double | `double precision` | `double` | `real` |
| decimal | `numeric(p,s)` | `decimal(p,s)` | `text` (kesin) |
| boolean | `boolean` | `tinyint(1)` | `integer` |
| date | `date` | `date` | `text` |
| time | `time(3)` | `time(3)` | `text` |
| datetime | `timestamptz(3)` | `datetime(3)` | `text` |
| json | `jsonb` | `json` | `text` |

Bir içerik tipinin en fazla 60 `string`, `email`, `uid` ve `enumeration` niteliği olabilir
(MySQL’in satır boyutu sınırı); daha fazlası için `text` kullanın.

### `unique`

`unique: true` alan tipler `(column, locale, publication_state)` üzerinde benzersiz bir indeks
alır: aynı dildeki iki yayınlanmış kayıt veya iki taslak bir değeri paylaşamaz, bir taslak ve kendi
yayınlanmış sürümü ise paylaşabilir. Bunu bozan bir yazma, nitelik üzerinde bir doğrulama hatasıyla
başarısız olur. Bileşenlerin içinde `unique` kabul edilir ancak uygulanmaz (bileşen değerleri JSON
olarak saklanır).

## Metin

### `string`

Tek satırlık metin.

| Seçenek | Açıklama |
| --- | --- |
| `minLength`, `maxLength` | Karakter cinsinden uzunluk sınırları. `maxLength` en fazla 255’tir. |
| `regex` | Değerin eşleşmesi gereken bir kalıp. Look-around ve geri başvurular dâhil JavaScript benzeri sözdizimi. |
| `unique` | Bkz. [`unique`](#unique). |
| `default` | Sınırlar içinde ve `regex` ile eşleşen bir string. |

`varchar(255)` olarak saklanır. API: bir string.

### `text`

Daha uzun düz metin (admin’de bir textarea).

| Seçenek | Açıklama |
| --- | --- |
| `minLength`, `maxLength` | Uzunluk sınırları, üst sınır yok. |
| `default` | Sınırlar içinde bir string. |

`text` olarak saklanır (MySQL’de `longtext`). API: bir string.

### `richtext`

Markdown metni. `text` ile aynı seçenekler, saklama ve API; admin onu Markdown düzenleyicisiyle
düzenler.

### `blocks`

Strapi’nin blocks JSON’u olarak zengin metin: `paragraph`, `heading` (`level` 1’den 6’ya), `list`
(`format` `ordered` veya `unordered`, 8 düzeye kadar iç içe `list-item` alt öğeleriyle), `quote`,
`code` (isteğe bağlı `language`) ve `image` bloklarından oluşan bir liste. Satır içi alt öğeler
`bold`, `italic`, `underline`, `strikethrough` ve `code` işaretleriyle `text` düğümleri ve `link`
düğümleridir. En fazla 10.000 blok.

Seçenek yok, `default` yok. JSON olarak saklanır. API: yazıldığı gibi blok listesi.

```json
[
  { "type": "heading", "level": 2, "children": [{ "type": "text", "text": "Hello" }] },
  { "type": "paragraph", "children": [{ "type": "text", "text": "bold", "bold": true }] }
]
```

### `email`

Bir e-posta adresi (`name@domain.tld`, boşluksuz).

| Seçenek | Açıklama |
| --- | --- |
| `minLength`, `maxLength` | Uzunluk sınırları; `maxLength` en fazla 255. |
| `unique` | Bkz. [`unique`](#unique). |
| `default` | Bir e-posta adresi. |

`varchar(255)` olarak saklanır. API: bir string.

### `password`

Yazmada Argon2id ile hash’lenen bir secret.

| Seçenek | Açıklama |
| --- | --- |
| `minLength`, `maxLength` | Gönderildiği şekliyle parolanın uzunluk sınırları. |

`default` yok. Her zaman private: asla döndürülmez, filtrelenmez veya sıralanmaz. Bileşenlerin
içinde kullanılamaz. `varchar(255)` (hash) olarak saklanır. İçe aktarmalar mevcut bcrypt ve Argon2
hash’lerini olduğu gibi korur; böylece içe aktarılan hesaplar yine oturum açabilir.

### `uid`

Slug gibi URL’ler için bir tanımlayıcı. Admin onu `targetField`’dan üretir.

| Seçenek | Açıklama |
| --- | --- |
| `targetField` | Değerin üretileceği, aynı tipin bir `string` veya `text` niteliği. |
| `minLength`, `maxLength` | Uzunluk sınırları; `maxLength` en fazla 255. |
| `regex` | Değerlerin eşleşmesi gereken kalıp; belirtilmezse `^[A-Za-z0-9\-_.~]*$`. |
| `default` | Geçerli bir değer. |

Her zaman benzersizdir (bkz. [`unique`](#unique)). `varchar(255)` olarak saklanır. API: bir string.

### `enumeration`

Sabit bir listeden bir değer.

| Seçenek | Açıklama |
| --- | --- |
| `enum` | Değerler: en az bir tane, her biri 1 ile 255 karakter arası, yinelenen yok. |
| `default` | Değerlerden biri. |

`varchar(255)` olarak saklanır. API: bir string. Başka herhangi bir değerin yazılması başarısız olur.

## Sayılar

### `integer`

32 bitlik bir tam sayı (−2.147.483.648 ile 2.147.483.647 arası).

| Seçenek | Açıklama |
| --- | --- |
| `min`, `max` | Sınırlar (tam sayılar). |
| `unique` | Bkz. [`unique`](#unique). |
| `default` | Sınırlar içinde bir tam sayı. |

`integer` olarak saklanır. API: bir sayı. Yazmalar sayıları ve tam sayı string’lerini kabul eder.

### `biginteger`

64 bitlik bir tam sayı. `integer` ile aynı seçenekler.

`bigint` olarak saklanır. API: Strapi’deki gibi bir string (`"9007199254740993"`), çünkü JavaScript
sayıları 2⁵³’ün ötesinde hassasiyet kaybeder. Yazmalar string’leri ve sayıları kabul eder.

### `float`

Çift duyarlıklı kayan noktalı bir sayı. `integer` ile aynı seçenekler, sayı sınırlarıyla.

`double precision` (`double`, `real`) olarak saklanır. API: bir sayı.

### `decimal`

Kesin bir ondalık sayı.

| Seçenek | Varsayılan | Açıklama |
| --- | --- | --- |
| `precision` | `10` | Toplam basamak, 1 ile 38 arası. |
| `scale` | `2` | Ondalık noktadan sonraki basamaklar, en fazla `precision`. |
| `min`, `max` | | Sınırlar. |
| `unique` | | Bkz. [`unique`](#unique). |
| `default` | | Sınırlar içinde bir sayı. |

Değerler `scale` basamağa yuvarlanır (veritabanlarının yaptığı gibi sıfırdan uzağa yarım) ve
noktadan önce `precision - scale` basamaktan fazlası olduğunda reddedilir. Yazmalar sayıları ve
sayısal string’leri kabul eder. `numeric(precision,scale)` olarak saklanır (SQLite’ta `text`,
böylece hiçbir şey yuvarlanmaz). API: bir sayı veya
[`[api].decimal_as_string`](/tr/reference/configuration/) ile kesin bir string.

## Tarihler ve boolean’lar

### `boolean`

`true` veya `false`. `default` alır. `boolean` (`tinyint(1)`, `integer`) olarak saklanır. API: bir
boolean.

### `date`

Bir takvim tarihi, `YYYY-MM-DD`. `unique` ve `default` alır. `date` olarak saklanır. API:
`"2026-09-29"`.

### `time`

Günün bir saati, `HH:MM`, `HH:MM:SS` veya `HH:MM:SS.mmm`. `unique` ve `default` alır. Milisaniye
hassasiyetiyle saklanır. API: `"14:30:00.000"`.

### `datetime`

Bir zaman noktası: bölge içeren (`Z` veya `+02:00`) bir ISO 8601 zaman damgası. `unique` ve
`default` alır. Milisaniye hassasiyetiyle UTC’de saklanır. API: `"2026-09-29T12:30:00.000Z"`.

## `json`

Herhangi bir JSON değeri. `default` alır (herhangi bir JSON). `jsonb` (`json`, `text`) olarak
saklanır. API: yazıldığı gibi değer. `filters` içinde JSON nitelikleri yalnızca `$null` ve
`$notNull`’u destekler ve üzerlerinde sıralama yapılamaz.

## Medya

### `media`

Medya kütüphanesinden dosyalar.

| Seçenek | Varsayılan | Açıklama |
| --- | --- | --- |
| `multiple` | `false` | Tek bir dosya yerine bir dosya listesi tutar. |
| `allowedTypes` | herhangi | Dosya türleri: `images`, `videos`, `audios`, `files` (diğer her şey). |

`default` yok. Sırayla bir `{table}_{attribute}_mda` bağlantı tablosunda saklanır. Yazmalar dosya
kimlikleri alır: `12`, `{ "id": 12 }`, bunların bir listesi veya `null`. API: yalnızca `populate`
ile; bir dosya nesnesi (Strapi’deki gibi `url`, `mime`, `width`, `formats`…), bunların bir listesi
veya `null`. Bkz. [Medya](/tr/concepts/media/).

## İlişkiler

### `relation`

Başka bir içerik tipinin belgelerine bağlantılar.

| Seçenek | Açıklama |
| --- | --- |
| `relation` | `oneToOne`, `oneToMany`, `manyToOne`, `manyToMany`, `oneWay`, `manyWay` veya polimorfik bir tür (aşağıda). |
| `target` | Hedef içerik tipi: `article`, `api::article` veya `api::article.article`. |
| `inversedBy` | İki yönlü bir ilişkinin sahip tarafında: hedefin onu yansıtan niteliği. |
| `mappedBy` | Diğer tarafta: hedefin sahip niteliği. |

İki yönlü bir ilişkinin iki tarafı uyumlu olmalıdır: `oneToMany`, `manyToOne`’ı yansıtır;
`oneToOne` ve `manyToMany` kendilerini yansıtır ve `mappedBy` tarafı, `inversedBy` değeri geri
işaret eden bir niteliği belirtir. `oneWay` ve `manyWay`’in diğer tarafı yoktur.

Bağlantılar sahip tarafta (`mappedBy` içermeyen taraf) `{table}_{attribute}_lnk` içinde, hedefin
`documentId`’sine işaret ederek sırayla saklanır. Yazmalar `documentId`’ler alır:

| Yazma | Anlamı |
| --- | --- |
| `"d8f3…"`, `{ "documentId": "d8f3…" }`, bunların bir listesi | Bağlantıları değiştirir. |
| `null` veya `[]` | Tüm bağlantıları kaldırır. |
| `{ "set": [...] }` | Bağlantıları değiştirir. |
| `{ "connect": [...], "disconnect": [...] }` | Bağlantı ekler ve kaldırır. Bir `connect` öğesi `position` taşıyabilir: `{ "before": id }`, `{ "after": id }`, `{ "start": true }` veya `{ "end": true }`. |

API: yalnızca `populate` ile, ilişkili belgeler olarak (kayıt ve ilişki başına en fazla 1.000) ya da
`populate[tags][count]=true` ile `{ "count": n }`. Bkz. [İlişkiler](/tr/concepts/relations/).

Bileşenlerin içinde yalnızca `oneWay` ve `manyWay`’e izin verilir; bileşen `documentId`’leri saklar.

### Polimorfik ilişkiler

`relation`, herhangi bir içerik tipinin belgelerini bağlayan polimorfik türleri de alır:

| `relation` | Seçenekler | Açıklama |
| --- | --- | --- |
| `morphToOne` | yok | Herhangi bir tipten bir belge bağlar. |
| `morphToMany` | yok | Herhangi tiplerden belgeler bağlar. |
| `morphOne` | `target`, `morphBy` | Ters taraf: `target`’ın `morphToOne` veya `morphToMany` niteliği `morphBy`’ın bağlantılarını okur. |
| `morphMany` | `target`, `morphBy` | Aynısı, çoklu için. |

Sahipler `(type, documentId)` çiftlerini `{table}_{attribute}_mph` içinde saklar. Yazmalar
`{ "__type": "api::article", "documentId": "…" }` öğeleri alır (bir tane, bir liste, `null` veya
`{ "set": [...] }`). Populate edilen öğeler tiplerini `__type` içinde taşır. Bileşenlerin içinde
kullanılamaz.

## Bileşenler ve dinamik bölgeler

### `component`

`schema/components/<category>/<name>.json` içinde tanımlanan bir alan grubu.

| Seçenek | Varsayılan | Açıklama |
| --- | --- | --- |
| `component` | zorunlu | Bileşen uid’si, `category.name` (`shared.seo`). |
| `repeatable` | `false` | Tek bir öğe yerine bir öğe listesi tutar. |
| `min`, `max` | | Öğe sayısı; yalnızca `repeatable` ile. |

`default` yok: yeni öğeler kendi niteliklerinin varsayılanlarını alır. Kaydın satırında JSON olarak,
her öğe bir `id` ile saklanır. Yazmalar öğe nesnesini (veya bir listeyi), mevcut bir öğeyi korumak
için `id` ile alır. API: yalnızca `populate` ile, öğenin veya listenin tamamı. `filters` içinde bir
bileşenin alanlarına göre filtreleyebilirsiniz (`filters[seo][metaTitle][$eq]=…`). Bkz.
[Bileşenler ve dinamik bölgeler](/tr/concepts/components-and-dynamic-zones/).

### `dynamiczone`

Her biri birkaç bileşenden biri olan öğelerden oluşan bir liste.

| Seçenek | Açıklama |
| --- | --- |
| `components` | İzin verilen bileşen uid’leri: en az bir tane, yinelenen yok. |
| `min`, `max` | Öğe sayısı. |

Her öğe uid’siyle birlikte `__component` taşır. Kaydın satırında JSON olarak saklanır. API: yalnızca
`populate` ile, listenin tamamı. Bileşene göre `filters[blocks][__component][$eq]=blocks.hero` ile
filtreleyin. Dinamik bölgeler bileşenlerin içine yerleştirilemez.

## Alanlar arası doğrulamalar

Nitelik başına seçeneklerin yanı sıra bir içerik tipi, `required` denetlendiğinde denetlenen,
birkaç alan üzerinde kurallar `validations` içinde bildirebilir:

```json
"validations": [
  {
    "rule": { "<=": [{ "var": "startDate" }, { "var": "endDate" }] },
    "message": "The end date must be after the start date",
    "field": "endDate"
  }
]
```

`rule`, kayıt üzerinde sağlanması gereken bir JSON Logic ifadesidir. `var`, `==`, `!=`, `===`,
`!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`, `and`, `or`, `in`, `if`, `?:`, `+`, `-`, `*`, `/`, `%`,
`min`, `max` ve `cat` kullanabilir. `message`, `field` üzerinde (tipin bir niteliği) veya kayıt
üzerinde bildirilir. Bu bir Verdin eklemesidir; Strapi’de karşılığı yoktur.

## Strapi ile farklar

- **Bileşenler**, join tablolarıyla bileşen tablolarında değil, kaydın satırında **JSON olarak
  saklanır**. Okumalar join gerektirmez; bunun sonucu olarak `password` nitelikleri, polimorfik
  ilişkiler ve iki yönlü ilişkiler bileşenlerin içinde olamaz ve `unique` orada uygulanmaz.
- **Populate edilen bileşenler bütün olarak gelir.** Bir bileşen veya dinamik bölge üzerinde
  `populate` tüm alanlarını döndürür; Strapi’deki gibi iç içe alanları seçemezsiniz.
- **Katı şema dosyaları.** Strapi’nin yok saydığı bilinmeyen anahtarlar ve bir tipin almadığı
  seçenekler hatadır. `pluginOptions` içinde yalnızca `i18n.localized` okunur; gerisi yok sayılır.
- **`string`, `email` ve `uid` 255 karakterle sınırlıdır**; veritabanında başarısız olmak yerine
  sütun boyutu kadar.
- **`conditions`** (koşullu alanlar) Strapi 5.17’deki gibi çalışır: gizli alanlar zorunlu değildir.
- **`validations`** Verdin’e özgüdür.
- Geri kalanı Strapi v5 ile eşleşir: tip adları, seçenekleri, string olarak `biginteger` değerleri,
  `connect`, `disconnect`, `set` ve `position` ile ilişki yazmaları ve blocks biçimi.
