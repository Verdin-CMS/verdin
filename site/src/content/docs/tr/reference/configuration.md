---
title: Yapılandırma başvurusu
description: verdin.toml’un her bölümü ve anahtarı, varsayılanlarıyla ve Verdin’in okuduğu ortam değişkenleri.
sidebar:
  order: 1
  label: Yapılandırma
---

<!-- Written from crates/verdin/src/config.rs, crates/verdin-upload/src/config.rs and
crates/verdin-email/src/lib.rs, crates/verdin-upload/src/transform.rs,
crates/verdin-search/src/lib.rs, crates/verdin-api/src/cdn.rs and crates/verdin-api/src/ai.rs.
Keep it in step when keys change. -->

Yapılandırma katmanlıdır: **yerleşik varsayılanlar ← `verdin.toml` ← ortam**. Dosya isteğe
bağlıdır; her anahtarın bir varsayılanı vardır. Bilinmeyen anahtarlar reddedilir; böylece bir yazım
hatası yok sayılmak yerine başlangıçta başarısız olur.

- Herhangi bir anahtarı `VERDIN_<SECTION>__<KEY>` (iki alt çizgi) ile geçersiz kılın, örneğin
  `VERDIN_SERVER__PORT=8080` veya `VERDIN_ADMIN__SECURE_COOKIES=false`. İç içe tablolar bir `__`
  daha alır: `VERDIN_ADMIN__BRANDING__TITLE=ACME`. Bilinmeyen anahtarlar burada da reddedilir; bu
  yüzden `VERDIN_` ile başlayan ve `__` içeren her değişken gerçek bir anahtarı belirtmelidir.
- `VERDIN_DATABASE_URL`, `database.url` için bir kısaltmadır.
- Dosya çalışma dizinindeki `verdin.toml` ya da `-c, --config` veya `VERDIN_CONFIG` ile verilen
  yoldur. İçindeki göreli yollar (şema, eklentiler, yüklemeler, SQLite dosyaları) dosyanın dizinine
  göre çözümlenir.
- Yapılandırmanın yanındaki bir `.env` dosyası önce yüklenir; ortamda zaten ayarlanmış değişkenler
  üstün gelir.

Secret’lar asla `verdin.toml`’dan okunmaz; bkz. [Ortam değişkenleri](#ortam-değişkenleri).

## `[server]`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `host` | `"0.0.0.0"` | Dinlenecek adres. |
| `port` | `1337` | Dinlenecek port. |
| `public_url` | ayarlanmamış | Tarayıcıların sunucuya ulaştığı yer, örn. `"https://cms.example.com"`. E-postalardaki bağlantılar ve SSO callback’leri için kullanılır; varsayılanı `http://localhost:{port}`. |
| `body_limit` | `"1mb"` | Normal API isteklerinin en büyük istek gövdesi (yüklemelerin kendi sınırı vardır). Bayt sayısı veya `b`, `kb`, `mb` ya da `gb` içeren bir string. |
| `request_timeout_secs` | `30` | Normal API isteklerinin zaman sınırı. |
| `sync_interval_secs` | `10` | Diğer örneklerin değiştirdiği ayarların (özellikler, eklenti anahtarları, diller, inceleme iş akışları) ne sıklıkla alınacağı; `0` bunu kapatır (tek bir örnek). |
| `trusted_proxies` | `[]` | `X-Forwarded-For` başlığı istemciyi belirten reverse proxy’ler (IP’ler veya CIDR aralıkları, örn. `["10.0.0.0/8"]`). Hız sınırları ve denetim kayıtları bu adresi kullanır; bu olmadan proxy arkasındaki her istemci tek bir adresi paylaşır. |

## `[database]`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `url` | ayarlanmamış | Bağlantı URL’si: `postgres://…`, `mysql://…` (MySQL ve MariaDB) veya `sqlite://…`. Zorunlu; genellikle `VERDIN_DATABASE_URL` ile ayarlanır. |
| `pool_max` | `10` | Havuzdaki en fazla bağlantı. |

## `[schema]`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `path` | `"schema"` | Yapılandırma dosyasına göre şema dizini. |

## `[api]`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `prefix` | `"/api"` | İçerik API’sinin sunulduğu yol. `/` ile başlamalı ve onunla bitmemelidir. |
| `default_page_size` | `25` | Bir istek ayarlamadığında sayfa boyutu. 1 ile `max_page_size` arasında. |
| `max_page_size` | `100` | Bir isteğin isteyebileceği en büyük sayfa boyutu. |
| `decimal_as_string` | `false` | Ondalıkları sayılar (Strapi uyumlu) yerine string olarak (kesin) serileştirir. |
| `public_rate_limit` | `0` | Token’sız, dakika ve istemci IP’si başına istek (`0`: sınırsız). |
| `token_rate_limit` | `0` | Dakika ve API token’ı veya son kullanıcı başına istek (`0`: sınırsız). |
| `cache_ttl_secs` | `0` | Anonim okumaları bu kadar süre bellekte tutar (`0`: önbellek yok); değişiklikler önbelleği boşaltır. |
| `cache_entries` | `1000` | Önbelleğe alınan en fazla yanıt sayısı. |
| `cors_origins` | `[]` | İçerik API’sini ve GraphQL’i başka bir siteden çağırmasına izin verilen tarayıcı origin’leri (`["https://www.example.com"]`: şema, host ve port, yol yok) veya herhangi biri için `["*"]` (tek başına: `*` origin’lerle birleştirilemez). Boş: onları tarayıcıdan yalnızca aynı origin’deki sayfalar çağırabilir. Admin API asla çapraz origin çağrıları kabul etmez. |

## `[admin]`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `path` | `"/admin"` | Yönetim panelinin sunulduğu yol; API’si `{path}/api` adresindedir. |
| `secure_cookies` | ayarlanmamış | Yenileme çerezini `Secure` olarak işaretler. Ayarlanmamışsa `verdin start` içinde evet, `verdin dev` içinde hayır anlamına gelir (düz HTTP yerel geliştirme). |
| `auth_rate_limit` | `20` | Dakikada istemci IP’si başına oturum açma, kayıt ve yenileme denemeleri. |
| `assets_dir` | ayarlanmamış | Yönetim panelini ikili dosyaya gömülü kopya yerine bu dizinden (yapılandırma dosyasına göre) sunar. |

### `[admin.branding]`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `title` | `"Verdin"` | Kenar çubuğunda, oturum açma sayfasında ve tarayıcı sekmesinde gösterilir. |
| `logo` | ayarlanmamış | Yapılandırma dosyasına göre görsel dosyası (SVG, PNG, WebP). |
| `favicon` | ayarlanmamış | Yapılandırma dosyasına göre ikon dosyası (ICO, PNG, SVG). |
| `accent` | ayarlanmamış | Düğmelerin, bağlantıların ve odak halkalarının `#rrggbb` rengi. |
| `translations` | `{}` | Dil başına değiştirilen admin metinleri; örneğin `"auth.login.title" = "Welcome to ACME"` ile `[admin.branding.translations.en]`. Anahtarlar `admin/public/i18n/en.json` içindekilerdir. |

## `[upload]`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `provider` | `{ name = "local", dir = "public/uploads" }` | Dosyaların saklandığı yer; aşağıya bakın. |
| `max_file_size` | `209715200` | Bayt cinsinden kabul edilen en büyük dosya (200 MB). |
| `responsive_formats` | `true` | Raster görseller için duyarlı formatlar üretir. |
| `breakpoints` | large 1000, medium 750, small 500 | `{ name, width }` tabloları olarak duyarlı formatlar (Strapi’nin `breakpoints`’i). Görselden geniş formatlar atlanır. |
| `max_image_megapixels` | `100` | Megapiksel cinsinden sıkıştırma bombalarına karşı çözme sınırı. |
| `max_original_size` | ayarlanmamış | Bu kadar pikselden (herhangi bir kenarı) büyük raster orijinaller yüklemede küçültülür; bu, meta verilerini (EXIF, GPS) de siler. Ayarlanmamışsa orijinaller gönderildiği gibi korunur. |

```toml
[upload]
breakpoints = [{ name = "large", width = 1000 }, { name = "small", width = 500 }]
```

### Yerel sağlayıcı

`dir` altındaki (projeye göre) dosyalar, Verdin tarafından `/uploads` adresinde sunulur.

```toml
[upload]
provider = { name = "local", dir = "public/uploads" }
```

### `[upload.transforms]`

Yerel dosyaların görsel dönüştürmeleri: `/uploads/<file>?preset=thumb` veya imzayla
`?w=&h=&fit=&format=&q=`. Oluşturmalar diskte önbelleğe alınır ve dosya (odak noktası dâhil)
değiştiğinde atılır. Cover kırpmaları dosyanın odak noktasını görünür tutar; görseller asla
büyütülmez. JPEG, PNG, WebP, TIFF ve BMP dönüştürülebilir (animasyonlu olabilecek GIF’ler değil).

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `enabled` | `true` | Dönüştürmeleri sunar. |
| `presets` | `{}` | Her zaman izin verilen adlandırılmış dönüştürmeler: `{ w, h, fit, format, q }`. |
| `allow_arbitrary` | `false` | İmzasız herhangi bir parametreyi kabul eder. Her farklı URL oluşturulur ve önbelleğe alınır; bu yüzden yalnızca güvenilir ağlar için. |
| `max_size` | `4096` | Piksel cinsinden en büyük `w` veya `h`. |
| `cache_dir` | `".cache/transforms"` | Oluşturmaların tutulduğu yer (projeye göre; silmek güvenlidir). |

Parametreler: `w`, `h` (piksel), `fit` (varsayılan `cover` kutuya kırpar; `inside` içine sığdırır;
`fill` uzatır), `format` (`jpeg`, `png`, `webp`; WebP çıktısı kayıpsızdır) ve `q` (JPEG kalitesi,
1–100, varsayılan 80).

```toml
[upload.transforms.presets]
thumb = { w = 300, h = 300 }
hero = { w = 1600, h = 600, format = "webp" }
```

**İmzalı URL’ler.** `VERDIN_IMAGE_SECRET` ayarlandığında `s`, `<file>?<canonical query>` değerinin
hex HMAC-SHA256’sıdır; kanonik sorgu varsayılan olmayan parametreleri ada göre sıralanmış olarak
listeler (`fit`, `format`, `h`, `q`, `w`; `fit=cover` atlanır):

```js
import { createHmac } from 'node:crypto';
const s = createHmac('sha256', process.env.VERDIN_IMAGE_SECRET)
  .update('photo_1a2b.jpg?format=webp&w=800')
  .digest('hex');
const url = `/uploads/photo_1a2b.jpg?format=webp&w=800&s=${s}`;
```

### S3 sağlayıcısı

S3 uyumlu herhangi bir servis (AWS, Cloudflare R2, MinIO, Backblaze B2…). Kimlik bilgileri standart
`AWS_*` ortam değişkenlerinden (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) gelir.

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `bucket` | zorunlu | Bucket adı. |
| `region` | ayarlanmamış | Bucket bölgesi. |
| `endpoint` | ayarlanmamış | AWS dışı servisler için özel uç nokta, örn. `https://<account>.r2.cloudflarestorage.com`. |
| `public_url` | zorunlu | Bucket’ın veya CDN’inin herkese açık temel URL’si; dosyalar `{public_url}/{key}` olarak bağlanır. |
| `prefix` | `""` | Bucket içindeki anahtar öneki. |
| `path_style` | `false` | Path-style istekler (MinIO ve çoğu kendi barındırılan servis). |

```toml
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

## `[webhooks]`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `allow_private_networks` | ayarlanmamış | Loopback, özel ve link-local adreslerdeki webhook URL’lerine izin verir; dağıtım hedeflerine ve `[cdn]` webhook’una da uygulanır. Ayarlanmamışsa `verdin start` içinde hayır (aksi hâlde bir admin iç servislere ulaşabilirdi), `verdin dev` içinde evet anlamına gelir. |
| `timeout_secs` | `10` | Her teslimin zaman sınırı. |
| `retention_days` | `30` | Teslim günlüğünün tutulduğu gün sayısı. |

Bkz. [Webhook’lar](/tr/guides/integrations/webhooks/).

## `[history]`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `max_versions` | `50` | Belge başına tutulan sürümler (eskileri kaldırılır). |

## `[email]`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `provider` | `"log"` | `log` (e-postaları günlüğe yazar), `smtp`, `resend` veya `postmark`. |
| `from` | `"Verdin <no-reply@localhost>"` | Gönderen. |
| `reply_to` | ayarlanmamış | Yanıt adresi. |

### `[email.smtp]`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `host` | `"localhost"` | SMTP sunucusu. |
| `port` | `587` | SMTP portu. |
| `username` | ayarlanmamış | SMTP kullanıcısı; parola `VERDIN_EMAIL_SMTP_PASSWORD`’dan gelir. |
| `security` | `"starttls"` | `starttls`, `tls` (örtük, genellikle 465 portu) veya `none` (yerel relay’ler). |

## `[plugins]`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `path` | `"plugins"` | Yapılandırma dosyasına göre eklentilerin dizini (her biri için bir alt dizin). |
| `run_jobs` | `true` | Eklentilerin zamanlanmış görevlerini bu örnekte çalıştırır (birden fazla örnek olduğunda tek bir örnekte). |

Bkz. [Eklentiler](/tr/extending/plugins/).

## `[audit]`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `retention_days` | `90` | Denetim kaydı girdilerinin tutulduğu gün sayısı. |

## `[digest]`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `enabled` | `true` | Günlük özeti bu örnekten gönderir (birden fazla örnek olduğunda tek bir örnekten). |
| `hour_utc` | `8` | Görülmemiş değişikliklerin günlük özetinin gönderildiği saat (UTC, 0–23). |

## `[log]`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `format` | `"pretty"` | `pretty` veya `json`. |
| `level` | ayarlanmamış (`info`) | Varsayılan filtre; ayarlandığında `RUST_LOG` önceliklidir. |

## `[metrics]`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `enabled` | `false` | `/_metrics` adresinde Prometheus metrikleri sunar: alana (`api`, `admin_api`, `graphql`, `mcp`, `uploads`…), yönteme ve durum sınıfına göre gecikme histogramlarıyla HTTP istekleri, bekleyen webhook teslimleri, açık gerçek zamanlı akışlar ve çalışma süresi. |
| `token` | ayarlanmamış | Scrape’ler `Authorization: Bearer <token>` gerektirir. `VERDIN_METRICS_TOKEN` ona üstün gelir. Token olmadan porta ulaşan herkes metrikleri okuyabilir. |

## `[ai]`

Admin’de AI eylemleri (Ayarlar → Özellikler’de **AI eylemleri** özelliği açıkken): bir kaydı başka
bir dile çevirme, görseller için alternatif metin yazma, metni özetleme, SEO meta verisi önerme.
Öneriler döndürürler; editör olmadan hiçbir şey kaydedilmez. Anahtar `VERDIN_AI_KEY`’den okunur
(yerel sunucular gerektirmez).

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `provider` | `"none"` | `anthropic`, `openai` veya `openai-compatible` (Ollama, LM Studio, vLLM…). |
| `model` | `anthropic` için `claude-sonnet-5` | Model; diğer sağlayıcılar için zorunlu. |
| `base_url` | sağlayıcınınki | Başka bir uç nokta, örn. `http://localhost:11434/v1`. |
| `max_tokens` | `2048` | En uzun yanıt. |

```toml
[ai]
provider = "anthropic"
```

Her admin dakikada 30 AI isteği yapabilir. İçerik ve görseller sağlayıcıya gönderilir: kuruluşunuzun
izin verdiği birini seçin.

## `[cdn]`

İçerik herkese açık olarak değiştiğinde CDN önbelleklerini temizler. İçerik API’si yanıtları `vd` ve
`vd-<singularName>` ile etiketlenir (`Cache-Tag` ve `Surrogate-Key` başlıkları).

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `provider` | `"none"` | `cloudflare`, `fastly` veya `webhook`. |
| `zone_id` | ayarlanmamış | Cloudflare bölgesi (etikete göre temizleme). |
| `service_id` | ayarlanmamış | Fastly servisi (surrogate key’e göre temizleme). |
| `url` | ayarlanmamış | `webhook`: `POST { "tags": [...] }` alır. |
| `debounce_ms` | `1000` | Temizlemeden önce toplanan değişiklikler. |

API token’ı `VERDIN_CDN_TOKEN`’dan okunur (webhook’lara bearer token olarak gönderilir).

## `[search]`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `enabled` | `false` | `_q`’yu `$containsi` yerine bir tam metin diziniyle (Tantivy) sıralar. |
| `dir` | `"data/search"` | Projeye göre dizin klasörü. Onu silmek bir sonraki başlatmada dizini yeniden oluşturur. |
| `memory_mb` | `50` | Dizinleme bellek bütçesi. |

Dizin örneğin diskinde bulunur ve o örneğin yazmalarını izler: birden fazla örnekle aramayı tek bir
örnekte tutun (veya bir dağıtımdan sonra yeniden oluşturun).

## Ortam değişkenleri

`VERDIN_<SECTION>__<KEY>` geçersiz kılmalarının yanı sıra Verdin şu değişkenleri okur:

| Değişken | Açıklama |
| --- | --- |
| `VERDIN_CONFIG` | Yapılandırma dosyasının yolu (`--config` ile aynı). |
| `VERDIN_DATABASE_URL` | `database.url` için kısaltma. |
| `VERDIN_ADMIN_JWT_SECRET` | Admin oturum token’larını imzalar. Zorunlu, en az 32 bayt; `verdin secrets` ile üretin. |
| `VERDIN_TOKEN_PEPPER` | Saklanan token’lar için anahtarlı hash. Zorunlu, en az 32 bayt; `verdin secrets` ile üretin. |
| `VERDIN_ADMIN_PASSWORD` | `verdin admin create` ve `verdin admin reset-password` için parola (aksi hâlde stdin’den okunur); bkz. [komut satırı başvurusu](/tr/reference/cli/). |
| `VERDIN_EMAIL_SMTP_PASSWORD` | SMTP parolası. |
| `VERDIN_EMAIL_API_KEY` | Resend ve Postmark sağlayıcılarının API anahtarı. |
| `VERDIN_SSO_<ID>_SECRET` | Bir SSO sağlayıcısının istemci secret’ı; `<ID>`, büyük harfle ve `-` yerine `_` ile sağlayıcının kimliğidir (bkz. [Çoklu oturum açma](/tr/guides/auth/sso/)). |
| `VERDIN_OAUTH_<PROVIDER>_SECRET` | Bir son kullanıcı OAuth sağlayıcısının istemci secret’ı, SSO’dakiler gibi adlandırılır (bkz. [Son kullanıcılar](/tr/guides/auth/end-users/)). |
| `VERDIN_AI_KEY` | `[ai]` sağlayıcısının API anahtarı. |
| `VERDIN_CDN_TOKEN` | `[cdn]` sağlayıcısının API token’ı. |
| `VERDIN_IMAGE_SECRET` | Görsel dönüştürme URL’lerini imzalar (bkz. [`[upload.transforms]`](#uploadtransforms)). |
| `VERDIN_METRICS_TOKEN` | `[metrics].enabled` olduğunda `/_metrics` scrape’leri için bearer token; `[metrics].token`’a üstün gelir. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | S3 yükleme sağlayıcısının kimlik bilgileri. |
| `RUST_LOG` | Günlük filtresi; `[log].level`’a göre önceliklidir. |
