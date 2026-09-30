---
title: Eklenti başvurusu
description: plugin.toml manifest’i, yetenekler, hook’lar ve payload’ları, host fonksiyonları, rotalar, görevler, başlangıç fonksiyonu, GraphQL alanları, admin genişletme noktaları, sınırlar ve metrikler.
sidebar:
  order: 3
---

<!-- Written from crates/verdin-plugins (lib.rs, manifest.rs), crates/verdin-api/src/plugins.rs,
plugins_admin.rs, crates/verdin-graphql/src/lib.rs, crates/verdin/src/metrics.rs and
admin/src/app/core/plugin-extensions.ts. -->

Bu sayfa Verdin ile bir eklenti arasındaki eksiksiz sözleşmedir: manifest, Verdin’in dışa
aktarılan her fonksiyona gönderdikleri ve geri beklediği ile bir modülün çağırabileceği host
fonksiyonları. Bir giriş için bkz. [Eklentiler](/tr/extending/plugins/); uygulamalı bir örnek
için [eklenti eğitimi](/tr/extending/plugin-tutorial/).

## Eklenti dizini

Her eklenti `[plugins].path` altında (varsayılan `plugins/`, `verdin.toml`’un yanında) bir
dizindir:

| Dosya | Zorunlu | İçerik |
| --- | --- | --- |
| `plugin.toml` | evet | Manifest. |
| `plugin.wasm` | evet | Modül (`wasm` ile başka bir yol). |
| `admin/` | hayır | Yönetim panelinin yüklediği dosyalar: `admin.script` modülü ve varlıkları. |

Başlangıçta Verdin, `plugin.toml` içeren her dizini ad sırasıyla yükler. Manifest’i geçersizse,
modülü eksikse veya başka bir eklenti zaten onun `name` değerine sahipse dizin atlanır ve nedeniyle
birlikte **Ayarlar → Eklentiler** bölümünde listelenir.

## Manifest

```toml title="plugins/slugs/plugin.toml"
name = "slugs"
version = "1.0.0"
description = "Slugs from titles, and a color field"

[capabilities]
read = ["api::article"]
write = ["api::tag"]
http = ["api.example.com"]
kv = true
public_permissions = true

[limits]
timeout_ms = 5000
memory_mb = 64

[[hooks]]
on = "beforeCreate"
uid = "api::article"
function = "before_write"

[routes]
function = "handle"

[[jobs]]
schedule = "*/15 * * * *"
function = "refresh"

[startup]
function = "seed"
timeout_ms = 30000

[[graphql]]
name = "slugStats"
function = "stats"

[admin]
script = "index.js"

[[admin.widgets]]
id = "stats"
title = "Slug stats"
element = "slugs-stats"

[[admin.fields]]
id = "color"
title = "Color"
element = "slugs-color"
type = "string"

[[settings]]
key = "separator"
label = "Separator"
type = "select"
options = ["-", "_"]
default = "-"
```

Bilinmeyen anahtarlar her tabloda hatadır.

### Üst düzey anahtarlar

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `name` | zorunlu | Eklentinin URL’lerde, ayarlarda ve özel alanlarda kullanılan kimliği: küçük harfler, rakamlar ve `-`; bir harfle başlar, en fazla 64 karakter. |
| `version` | zorunlu | Admin’de ve günlükte gösterilir. |
| `description` | ayarlanmamış | **Ayarlar → Eklentiler** bölümünde gösterilir. |
| `wasm` | `"plugin.wasm"` | Eklenti dizinine göre modül (`..` yok, mutlak değil). |
| `wasi` | `false` | Modüle WASI verir: bir saat ve rastgele sayılar. Her iki durumda da dosya veya soket yoktur. |

### `[capabilities]`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `read` | `[]` | `verdin_content`’in okuyabileceği (`findMany`, `findOne`) içerik tipleri: `api::article` gibi uid’ler veya tümü için `"*"`. |
| `write` | `[]` | `create`, `update`, `delete`, `publish` ve `unpublish` yapabileceği içerik tipleri. `read`’i kapsar. |
| `http` | `[]` | Modülün HTTP isteği gönderebileceği host’lar: `api.example.com` veya `*.example.com`. |
| `kv` | `false` | Eklentinin kendi anahtar-değer depolaması (`verdin_kv_get`, `verdin_kv_set`). |
| `public_permissions` | `false` | Herkese açık rolün içerik API’si izinlerini okuma ve değiştirme (`verdin_public_permissions`). |

Yetenekler yalnızca host çağrılarını sınırlar. Hook’lar, `read` ne derse desin adını verdikleri
tiplerde çalışır ve rotalara herkes ulaşabilir.

### `[limits]`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `timeout_ms` | `5000` | Tek bir çağrının milisaniye cinsinden zaman sınırı. |
| `memory_mb` | `64` | Modülün megabayt cinsinden en büyük belleği. |

Her ikisi de pozitif olmalıdır.

### `[[hooks]]`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `on` | zorunlu | Olay, aşağıda. |
| `uid` | `"*"` | İçerik tipi (`api::article`) veya tümü için `"*"`. |
| `function` | zorunlu | Çağrılacak dışa aktarılmış fonksiyon. |

Olaylar:

| Yazmadan önce | Yazmadan sonra |
| --- | --- |
| `beforeCreate` | `afterCreate` |
| `beforeUpdate` | `afterUpdate` |
| `beforeDelete` | `afterDelete` |
| `beforePublish` | `afterPublish` |
| `beforeUnpublish` | `afterUnpublish` |
| `beforeDiscardDraft` | `afterDiscardDraft` |

Adlar Strapi’nin lifecycle adlarıdır. Hook’lar yönetim panelinden, REST ve GraphQL API’lerinden
ve sürümlerden gelen yazmalarda çalışır; ancak `verdin import` komutlarının yaptığı yazmalarda
çalışmaz. Eklentilerin yaptığı yazmalar after hook’larını çalıştırır, before hook’larını
çalıştırmaz (bkz. [Eklentilerin yaptığı yazmalar](#eklentilerin-yaptığı-yazmalar)).

### `[routes]`

| Anahtar | Açıklama |
| --- | --- |
| `function` | `/api/plugins/<name>` ve `/api/plugins/<name>/…` adreslerine gelen, herhangi bir yöntemdeki her isteği sunan dışa aktarılmış fonksiyon. |

Yol `[api].prefix`’i izler.

### `[[jobs]]`

| Anahtar | Açıklama |
| --- | --- |
| `schedule` | UTC’de, isteğe bağlı saniyeli cron ifadesi: `*/15 * * * *`, `0 0 3 * * *`. |
| `function` | Çağrılacak dışa aktarılmış fonksiyon. |

### `[startup]`

Eklenti başladığında çalışan bir fonksiyon: bir Strapi projesinin `bootstrap` içinde yaptığı
şey (içerik ekleme, herkese açık rolü ayarlama).

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `function` | zorunlu | Çağrılacak dışa aktarılmış fonksiyon. |
| `timeout_ms` | `30000` | Kendi zaman sınırı, milisaniye cinsinden (içerik ekleme bir hook’tan uzun sürebilir). Pozitif olmalıdır. |

Ne zaman çalıştığı için bkz. [Başlangıç fonksiyonu](#başlangıç-fonksiyonu).

### `[[graphql]]`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `name` | zorunlu | Alan adı: küçük harfle başlar, ardından harfler, rakamlar ve `_`. |
| `function` | zorunlu | Onu çözümleyen dışa aktarılmış fonksiyon. |
| `mutation` | `false` | Alanı `Query` yerine `Mutation`’a ekler. |
| `description` | ayarlanmamış | Alanın şemadaki açıklaması. |

Her girdi `name(args: JSON): JSON` ekler. Bir içerik tipinin zaten kullandığı ya da başka bir
eklentinin önce aldığı bir ad, günlükte bir uyarıyla atlanır.

### `[admin]`

| Anahtar | Açıklama |
| --- | --- |
| `script` | `admin/` altında, özel elemanları tanımlayan ES modülü (`..` yok, mutlak değil). |
| `[[admin.widgets]]` | Pano widget tipleri: `id`, `title`, `element`, isteğe bağlı `description`. |
| `[[admin.fields]]` | Özel alanlar: `id`, `title`, `element`, `type` (değerin saklandığı nitelik tipi, örneğin `string` veya `json`), isteğe bağlı `description`. |

`element` bir özel eleman (custom element) adıdır: küçük harfler, rakamlar ve `-`; en az bir `-`
içerir (`slugs-color`).

### `[[settings]]`

**Ayarlar → Eklentiler → Ayarlar** formunu bildirir. Hiçbiri yoksa ayarlar serbest bir JSON
nesnesidir.

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `key` | zorunlu | Ayarlar nesnesindeki anahtar: harfler, rakamlar ve `_`; rakamla başlamaz, benzersizdir. |
| `label` | zorunlu | Form etiketi. |
| `type` | `"string"` | `string`, `text`, `url`, `number`, `integer`, `boolean` veya `select`. |
| `description` | ayarlanmamış | Alanın altındaki yardım metni. |
| `required` | `false` | Bir `default` yoksa bir değer (metin için boş olmayan) gerekir. |
| `options` | `[]` | Bir `select`’in seçenekleri (onun için zorunlu). |
| `default` | ayarlanmamış | Anahtar eksik veya `null` olduğunda kullanılır. Alana uymalıdır. |
| `min`, `max` | ayarlanmamış | `number` ve `integer` değerlerinin sınırları; `string` ve `text`’in uzunluk sınırları. |

`url` değerleri boş veya `http(s)://` URL’leridir. Bir formla sunucu; bilinmeyen anahtarlar, yanlış
tipler, sınır dışı değerler veya eksik zorunlu değerler içeren ayarları reddeder (400).

## Dışa aktarılan fonksiyonlar

Her dışa aktarılan fonksiyon bir JSON belgesi alır ve bir tane döndürür (ya da hiçbir şey). Boş
bir çıktı `null` sayılır; JSON olmayan çıktı hata sayılır.

### Before hook’ları

Girdi:

```json
{
  "event": "beforeUpdate",
  "uid": "api::article",
  "documentId": "01m3p88ry359w82nsx496mep5t",
  "locale": "en",
  "data": { "title": "Hello" }
}
```

| Alan | Açıklama |
| --- | --- |
| `event` | Hook’un olayı. |
| `uid` | İçerik tipi. |
| `documentId` | Belge veya `beforeCreate`’te `null`. |
| `locale` | Yerelleştirilmiş tiplerde yazılan dil (istek dil belirtmediyse varsayılan dil); diğer tiplerde `null`. |
| `data` | Yazılan veri, isteğin gönderdiği şekliyle: create ve update’te. Diğer olaylarda `null`. Update’te yalnızca gönderilen alanlar. |

Çıktı:

| Çıktı | Etkisi |
| --- | --- |
| `{ "data": { … } }` | Yazılan verinin yerini alır. Orijinal gibi doğrulanır. |
| `{ "error": "message" }` | Yazmayı reddeder: çağıran mesajla birlikte 400 alır. |
| `{}` veya başka herhangi bir şey | Yazma değişmeden devam eder. |

Birden fazla hook eşleştiğinde eklenti sırasıyla (dizin adları), ardından manifest sırasıyla
çalışırlar; her biri öncekinin döndürdüğü veriyi görür. Başarısız olan bir hook (trap, zaman
aşımı, geçersiz çıktı) günlüğe yazılır ve atlanır: yazma devam eder.

### After hook’ları

Girdi: yazma commit edildikten sonra gönderilen `{ "event", "uid", "documentId", "locale" }`.
Çıktı yok sayılır; hatalar günlüğe yazılır. Kaydın alanlarına ihtiyacınız varsa onu
`verdin_content` ile okuyun (`read` yeteneğiyle).

### Rotalar

Girdi:

```json
{
  "method": "GET",
  "path": "/stats",
  "query": "page=2&sort=title",
  "headers": { "accept": "application/json", "user-agent": "curl/8.7.1" },
  "body": "",
  "actor": { "kind": "public" }
}
```

| Alan | Açıklama |
| --- | --- |
| `method` | HTTP yöntemi. |
| `path` | `/api/plugins/<name>` sonrasındaki yol, `/` ile başlar (eklentinin kökü için `/`). |
| `query` | `?` olmadan ham sorgu string’i (yoksa boş). |
| `headers` | Varsa yalnızca `content-type`, `accept`, `user-agent` ve `accept-language`. |
| `body` | String olarak istek gövdesi (geçersiz UTF-8 değiştirilir). |
| `actor` | Çağıran: `{ "kind": "public" }`, `{ "kind": "token", "id": 3 }` (bir API token’ı) veya `{ "kind": "user", "id": 12 }` (oturum açmış bir son kullanıcı). |

Geçersiz bir token içeren `Authorization` başlığı, eklenti çağrılmadan önce 401 ile reddedilir.
Herkese açık erişim ve API token izinleri uygulanmaz: `actor`’ı kendiniz denetleyin.

Çıktı:

| Alan | Varsayılan | Açıklama |
| --- | --- | --- |
| `status` | `200` | HTTP durumu. |
| `headers` | yok | Yanıt başlıkları. Yalnızca `content-type`, `cache-control`, `location`, `etag`, `last-modified` ve `content-disposition` korunur. |
| `body` | boş | Bir string olduğu gibi gönderilir (`content-type` ayarlamadıkça `text/plain`); diğer tüm JSON değerleri `application/json` olarak gönderilir. |

Devre dışı veya bilinmeyen bir eklenti ya da `[routes]` içermeyen bir eklenti 404 yanıtını verir.
Başarısız bir çağrı `{ "data": null, "error": { "status": 502, "name": "PluginError", … } }` ile
502 yanıtını verir. Rotalar içerik API’sinin `[server].body_limit` ve
`[server].request_timeout_secs` değerlerini paylaşır.

### Görevler

Girdi: çalıştırmanın zamanlandığı an olan `{ "scheduledAt": "2026-09-29T03:00:00+00:00" }`. Çıktı
yok sayılır; hatalar günlüğe yazılır. Görevler yalnızca eklenti açıkken ve yalnızca
`[plugins].run_jobs = true` olan örneklerde çalışır. Sunucu kapalıyken kaçırılan bir çalıştırma
telafi edilmez.

### Başlangıç fonksiyonu

Girdi: `{ "reason": "start" | "enabled" | "settings" }`:

| `reason` | Ne zaman |
| --- | --- |
| `start` | Sunucu eklenti açıkken başladı. |
| `enabled` | Eklenti açıldı (burada ya da başka bir örnekte ve burada devralındı). |
| `settings` | Açıkken ayarları değişti (burada kaydedildi ya da başka bir örnekten devralındı). |

Çıktı: `{ "error": "message" }` bir başarısızlık sayılır; başka her şey (`{}`, boş) başarı.
Bir başarısızlık (trap, zaman aşımı, `{ error }`) eklentinin günlüğüne ve sunucu günlüğüne
yazılır; eklenti açık kalır ve fonksiyon bir sonraki başlangıçta, açmada veya ayar
değişikliğinde yeniden çalışır.

Fonksiyon, sunucu ayağa kalktıktan sonra arka planda çalışır; bu sırada istekler sunulur.
`[startup].timeout_ms` ile kendi modül örneğinde çalışır; böylece yavaş bir içerik ekleme
eklentinin hook’larını ve rotalarını geciktirmez. Yazmalarının tetiklediği after hook’ları o
döndükten sonra çalışır (bkz. [Eklentilerin yaptığı yazmalar](#eklentilerin-yaptığı-yazmalar)).
Modülün belleği eklentinin normal örneğiyle paylaşılmaz: durumu `verdin_kv_set` içinde ya da
içerikte tutun.

Birden fazla örnekle başlangıç fonksiyonlarını yalnızca `[plugins].run_jobs = true` olanlar
çalıştırır ([ölçekleme tavsiyesini](/tr/deploy/scaling/) izlediğinizde bir örnek): paylaşılan
veritabanı üzerinde işlem yaparlar; bu yüzden bir kez yeterlidir. Fonksiyonu, yeniden
çalıştırılması zararsız olacak şekilde yazın: eklediğiniz şeyi oluşturmadan önce arayın.

### GraphQL alanları

Girdi: `{ "args": …, "actor": … }`; `args` alanın `args` argümanıdır (herhangi bir JSON veya
`null`), `actor` ise rotalardaki gibidir. Çıktı alanın değeridir. Bir hata veya devre dışı bir
eklenti, `PLUGIN_ERROR` kodlu bir GraphQL hatası döndürür. Rotalarda olduğu gibi erişimi eklenti
denetler.

## Host fonksiyonları

Bunları `extism:host/user` ad alanından içe aktarın (Rust’ta `extern "ExtismHost"`). String
olarak JSON alır ve döndürürler; `extism-pdk` içindeki `Json<Value>` dönüştürmeyi yapar.

| Fonksiyon | Girdi | Çıktı |
| --- | --- | --- |
| `verdin_log` | `{ "level": "info" \| "warn" \| "error", "message": "…" }` | yok |
| `verdin_content` | Bir içerik isteği (aşağıda) | Sonuç veya `{ "error": "…" }` |
| `verdin_kv_get` | Düz string olarak anahtar | Saklanan JSON değeri veya `null` |
| `verdin_kv_set` | `{ "key": "…", "value": … }` | yok |
| `verdin_config` | yok | Bildirilen varsayılanlarla doldurulmuş ayarlar nesnesi |
| `verdin_public_permissions` | `{ "op": "get" }` veya `{ "op": "set", "permissions": [...] }` | `{ "permissions": [...] }` veya `{ "error": "…" }` |

Sunucunun sahip olmadığı bir host fonksiyonunu içe aktaran bir modül (eski bir Verdin)
yüklenemez: ona yapılan her çağrı sunucu günlüğünde `unknown import` ile başarısız olur.

### `verdin_log`

Sunucu günlüğüne (eklentinin adıyla) ve **Ayarlar → Eklentiler → Günlükler** içindeki eklentinin
günlüğüne yazar. Diğer düzeyler `info` sayılır. Eklentinin günlüğü, her biri 2.000 karakterde
kesilen son 200 mesajı bellekte tutar.

### `verdin_content`

```json
{ "op": "findMany", "uid": "api::article", "query": { "filters": { "title": { "$eq": "x" } }, "sort": ["title"] } }
```

| Alan | Kullanan | Açıklama |
| --- | --- | --- |
| `op` | tümü | `findMany`, `findOne`, `create`, `update`, `delete`, `publish` veya `unpublish`. |
| `uid` | tümü | İçerik tipi. Yeteneklerde bulunmalıdır. |
| `documentId` | `findOne`, `update`, `delete`, `publish`, `unpublish` | Belge. |
| `query` | `findMany`, `findOne` | JSON nesnesi olarak REST API parametreleri: `filters`, `sort`, `fields`, `populate`, `pagination`, `status`. |
| `data` | `create`, `update` | Bir REST isteğinin `data` alanındaki gibi yazılacak alanlar. |
| `status` | `create`, `update` | `"draft"` bir taslak kaydeder. Aksi hâlde yazma, `?status=draft` içermeyen bir REST yazması gibi yayınlanır. |
| `locale` | tümü | Okunacak veya yazılacak dil. |

Sonuçlar:

| `op` | Sonuç |
| --- | --- |
| `findMany` | `{ "documents": [...], "meta": { "pagination": {…} } }` |
| `findOne` | `{ "document": {…} }` (bulunamadığında `null`) |
| `create`, `update` | `{ "documentId": "…" }` |
| `delete` | `{ "deleted": true }` |
| `publish` | `{ "published": true }` |
| `unpublish` | `{ "unpublished": true }` |

Yeteneklerin dışındaki bir çağrı, bilinmeyen bir işlem, bir doğrulama hatası veya eksik bir belge
bunun yerine `{ "error": "…" }` döndürür. Okumalar, sorgu `"status": "draft"` istemedikçe
yayınlanmış sürümleri döndürür.

#### Eklentilerin yaptığı yazmalar

`verdin_content` üzerinden yapılan yazmalar tüm eklentilerin **before** hook’larını atlar;
böylece bir eklenti orada kendi değişiklikleri üzerinde döngüye giremez ve before hook’larına
koyduğunuz kurallar (varsayılanlar, denetimler) bunlara uygulanmaz. Diğer her şey uygulanır:
doğrulama, inceleme aşamaları, webhook’lar, geçmiş, denetim kaydı ve yazan dâhil tüm eklentilerin
**after** hook’ları.

Bir eklentinin yazmalarının tetiklediği after hook’ları yazmanın içinde çalışmaz: kuyruğa
alınırlar ve eklentinin çağrısı (rota, görev, GraphQL çözücüsü, hook veya başlangıç fonksiyonu)
döndükten ve eklentinin örneğini serbest bıraktıktan sonra, rotanın yanıtı gönderilmeden önce
çalışırlar. Böylece bir eklenti after hook’ları olan bir tipe yazabilir ve birkaç eklenti
üzerinden zincirler çalışır.

- Yazan hook’lar başka hook’ları tetikler, **en fazla `4` düzey derinliğe** kadar (REST veya
  GraphQL’den gelen bir yazma 1. düzeydir). Daha derin hook’lar eklentinin günlüğünde bir
  uyarıyla atlanır; bu, dinlediği tipe yazan bir hook’un sonsuza dek döngüye girmesini önler.
- Host fonksiyonları (`verdin_content`, `verdin_public_permissions`, anahtar-değer deposu)
  çağrının zaman sınırında durur ve modüle bir hata döndürür; bir çağıran, meşgul bir eklenti
  için en fazla zaman sınırı artı 10 saniye bekler. Takılmış bir çağrı eklentiyi ya da düzgün
  bir durdurmayı sonsuza dek tutamaz.

### `verdin_kv_get` ve `verdin_kv_set`

Verdin’in veritabanında, tüm örneklerin paylaştığı eklenti başına bir anahtar-değer deposu.
Anahtarlar 1 ile 255 bayt arasındadır; değerler herhangi bir JSON’dur. `null` ayarlamak anahtarı
siler. `kv` yeteneği olmadan okumalar `null` döndürür ve yazmalar yok sayılır.

### `verdin_config`

**Ayarlar → Eklentiler** bölümünde kaydedilen ayarları, eksik anahtarlar için bildirilen her
ayarın `default` değeriyle doldurarak döndürür. Hiçbir şey kaydedilmediğinde `{}`.

### `verdin_public_permissions`

Herkese açık rolün içerik API’si izinlerini, yani **Ayarlar → Herkese açık erişim**’in
düzenlediği şeyi okur veya değiştirir. `public_permissions` yeteneğini gerektirir; o olmadan
her çağrı `{ "error": "…" }` yanıtlar.

```json
{ "op": "set", "permissions": [
  { "subject": "api::article", "action": "find" },
  { "subject": "api::article", "action": "findOne" },
  { "subject": "api::comment", "action": "create" }
] }
```

| `op` | Etki |
| --- | --- |
| `get` | Hiçbir şey; geçerli izinleri döndürür. |
| `set` | Herkese açık **tüm** izinleri `permissions` ile değiştirir (boş bir liste hepsini kaldırır). |

İkisi de sıralanmış olarak `{ "permissions": [{ "subject", "action" }, …] }` yanıtlar.
`subject` bir içerik tipi uid’si, `plugin::upload` (medya kitaplığı),
`plugin::users-permissions.user` (içerik API’si üzerinden son kullanıcılar) veya
`plugin::i18n.locale` (yalnızca `find`) olabilir. `action` `find`, `findOne`, `create`,
`update`, `delete`, `publish` veya `readDrafts`’tır (son ikisi yüklemelere ve son kullanıcılara
uygulanmaz). Admin’in izin ızgarası gibi denetlenirler: bilinmeyen ya da uygulanmayan bir
subject veya action `{ "error": "…" }` yanıtlar ve hiçbir şeyi değiştirmez. Her `set` sunucu
günlüğüne yazılır.

### HTTP

`http` içinde listelenmiş host’larla Extism’in HTTP desteğini kullanın (Rust’ta
`extism_pdk::http::request`). Diğer host’lara yapılan istekler başarısız olur.

## Admin genişletme noktaları

Yönetim paneli sunucudan etkin eklentilerin uzantılarını ister ve her `admin.script`’i bir kez,
bir ES modülü olarak `/admin/plugins/<name>/<script>` adresinden (`[admin].path` altında) içe
aktarır. Eklentinin `admin/` dizini altındaki dosyalar, eklenti açıkken orada
`X-Content-Type-Options: nosniff` ve `Cache-Control: no-cache` ile sunulur. Modül, manifest’in
adını verdiği özel elemanları tanımlamalıdır; 3 saniye içinde tanımlanmayan bir eleman dışarıda
bırakılır.

### Widget’lar

Her `[[admin.widgets]]` girdisi, admin’lerin panoya ekleyebileceği bir widget tipidir. Eleman bir
`context` özelliği alır:

| Özellik | Açıklama |
| --- | --- |
| `apiBase` | İçerik API’si tabanı, örneğin `/api`. |
| `adminApiBase` | Admin API tabanı, örneğin `/admin/api`. |
| `fetch(path, init)` | Oturum açmış admin’in kimlik bilgileriyle `fetch`. Göreli yollar `adminApiBase`’e göre çözümlenir; iki tabandan birinin altındaki yollar ve mutlak URL’ler korunur. |

```js title="plugins/slugs/admin/index.js"
class SlugStats extends HTMLElement {
  set context(context) {
    // Admin API, with the admin's session.
    context.fetch('auth/me').then((response) => response.json())
      .then(({ data }) => { this.textContent = `Hello ${data.firstname ?? data.email}`; });
    // The plugin's own route, on the content API: sent without the admin's session.
    context.fetch(`${context.apiBase}/plugins/slugs/stats`).then((response) => response.json())
      .then((stats) => { this.title = JSON.stringify(stats); });
  }
}
customElements.define('slugs-stats', SlugStats);
```

`context.fetch`, admin’in oturumunu yalnızca admin API isteklerinde gönderir. `context.apiBase`
altındaki yollar (eklentinizin rotaları dâhil içerik API’si) oturum olmadan gider, çünkü içerik
API’si admin oturumlarını kabul etmez; bunlar public rolünün izinleriyle yanıtlanır. 0.10’dan
önce oturum oraya da gönderiliyordu ve bu istekler başarısız oluyordu; 0.9 için yazılmış, düz
`fetch` çağıran widget’lar çalışmaya devam eder.

### Özel alanlar

Her `[[admin.fields]]` girdisi, niteliklerin `"customField": "plugin::<name>.<id>"` ile
kullanabileceği bir alandır; niteliğin `type` değeri alanın değerini nasıl sakladığıyla
eşleşmelidir. **İçerik Tipi Oluşturucu** onu sunar. Eleman şunları alır:

| Özellik | Açıklama |
| --- | --- |
| `value` | Mevcut değer. |
| `disabled` | Düzenlemenin kapalı olup olmadığı. |
| `attribute` | Niteliğin şemadaki tanımı. |
| `locale` | Düzenlenen dil. |

Yeni bir değeri, `detail` alanı değer olan bir `change` olayıyla (ya da `detail` olmadan kendi
`value` özelliği aracılığıyla) bildirir. Eklenti kapalıyken veya elemanı eksikken düzenleyici,
depolama tipi için normal girdiyi gösterir. Bkz. [Nitelik tipleri](/tr/reference/attribute-types/).

## Çalışma zamanı ve sınırlar

| Sınır | Değer |
| --- | --- |
| Çağrı başına süre | `[limits].timeout_ms`, varsayılan 5.000 ms (başlangıç fonksiyonu için `[startup].timeout_ms`, varsayılan 30.000 ms) |
| Bellek | `[limits].memory_mb`, varsayılan 64 MB |
| Eşzamanlılık | Eklenti başına aynı anda bir çağrı; çağrılar birbirini bekler (başlangıç fonksiyonu onların yanında çalışır) |
| Modül örneği | Eklenti başına bir tane, ilk kullanımda oluşturulur; bir çağrı başarısız olduktan sonra yeniden oluşturulur (belleği kaybolur). Başlangıç fonksiyonu her çalıştırmada yeni bir tane alır |
| Günlük | Eklenti başına 200 mesaj, her biri 2.000 karakter, bellekte |
| KV anahtarları | 1 ile 255 bayt |
| Rota istek başlıkları | `content-type`, `accept`, `user-agent`, `accept-language` |
| Rota yanıt başlıkları | `content-type`, `cache-control`, `location`, `etag`, `last-modified`, `content-disposition` |

Bir manifest’te veya modülde yapılan değişiklikler yeniden başlatmadan sonra uygulanır; anahtarlar
ve ayarlar hemen uygulanır. Eklentileri yönetmek `plugins.manage` gerektirir (bkz.
[izin başvurusu](/tr/reference/permissions/)).

## Metrikler

[`[metrics]`](/tr/deploy/monitoring/) açıkken `/_metrics`, dışa aktarılmış bir fonksiyona ulaşan
her çağrıyı raporlar:

| Metrik | Tip | Etiketler | Anlamı |
| --- | --- | --- | --- |
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`, `kind`, `function` | Eklenti fonksiyonlarının harcadığı süre. 5 ms’den 10 sn’ye kadar bucket’lar. |
| `verdin_plugin_call_errors_total` | counter | `plugin`, `kind`, `function` | Başarısız çağrılar: bir trap, zaman aşımı, JSON olmayan çıktı veya bir başlangıç fonksiyonunun `{ error }` değeri. |

`kind` değeri `hook`, `route`, `job`, `startup` veya `graphql`’dir. Bir yazmayı `{ error }` ile
reddeden bir before hook’u bir yanıt verdi; bu yüzden başarısızlık sayılmaz. Modülün dışa
aktarmadığı bir fonksiyona yapılan çağrılar kaydedilmez; böylece etiketler kurulu eklentilerle
sınırlı kalır. Seriler bir eklentinin ilk çağrısından sonra görünür; her örnek kendi çağrılarını
sayar.
