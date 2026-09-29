---
title: Güvenlik
description: Verdin’in yönetim panelini, içerik API’sini ve sunucuyu nasıl koruduğu, hangi ayarların bir üretim örneğini güçlendirdiği ve bir güvenlik açığının nasıl bildirileceği.
sidebar:
  order: 2
---

Bu sayfa Verdin’in bir projeyi korumak için yaptıklarını ve sizin denetlediğiniz ayarları
açıklar. Bir örneği gerçek trafiğe hazırlarken onu
[üretim kontrol listesiyle](/tr/deploy/production-checklist/) birlikte kullanın.

## Varsayılan olarak kapalı olanlar

- **İçerik API’si.** Anonim istekler, **Ayarlar → Herkese açık erişim** bölümünde herkese açık
  izinler verene kadar hiçbir şey alamaz. Bilinmeyen, süresi dolmuş veya hatalı biçimlendirilmiş
  bir token `401` döndürür; asla public role geri düşmez. Bkz. [İzinler](/tr/concepts/permissions/).
- `/api/_openapi.json` adresindeki **OpenAPI belgesi**, onu **Ayarlar → Özellikler → API
  dokümantasyonu** bölümünde herkese açık yapana kadar geçerli bir API token’ı gerektirir.
- GraphQL, son kullanıcılar, SSO ve MCP sunucusu gibi **isteğe bağlı özellikler**,
  `features.manage` iznine sahip bir admin onları **Ayarlar → Özellikler** bölümünde açana kadar
  kapalı kalır.
- **Eklentiler**, bir admin her birini **Ayarlar → Eklentiler** bölümünde açana kadar kapalı
  kalır.
- **Çapraz origin tarayıcı çağrıları.** Siz `[api].cors_origins` içinde listeleyene kadar hiçbir
  origin bir tarayıcıdan herhangi bir API’yi çağıramaz.

## Admin oturum açma

| Koruma | Ayrıntılar |
| --- | --- |
| Parola hash’leme | OWASP parametreleriyle Argon2id; parametreler değiştiğinde yeniden hash’lenir. |
| Oturumlar | Sayfanın belleğinde tutulan (asla `localStorage`’da değil) 15 dakikalık bir erişim token’ı ve `/admin/api/auth` ile sınırlı `HttpOnly`, `SameSite=Strict` bir çerezde 30 günlük bir yenileme token’ı. Yenileme token’ı her kullanımda yenilenir; eskisini sunmak tüm oturumu sonlandırır. |
| Güvenli çerezler | Yenileme çerezi `verdin start` içinde `Secure`’dur. `[admin].secure_cookies = false` bunu kapatır ve bir uyarı yazar. |
| CSRF | Yenileme ve oturum kapatma, siteler arası bir formun gönderemediği bir `X-Verdin-CSRF` başlığı gerektirir. |
| Kilitleme | Beş başarısız deneme bir hesabı 15 dakika kilitler. Hatalar parola ve ikinci faktör adımlarında birlikte sayılır. Bilinmeyen e-postalar ve yanlış parolalar aynı yanıtı, aynı sürede alır. |
| Hız sınırı | Oturum açma, kayıt ve yenileme: dakika ve istemci adresi başına `[admin].auth_rate_limit` istek (20). |
| İkinci faktör | Kurtarma kodlarıyla kimlik doğrulayıcı uygulamalar (TOTP) ve geçiş anahtarları. Bir rol bunu zorunlu kılabilir (`requireTwoFactor`). Bkz. [İki adımlı doğrulama](/tr/guides/auth/two-factor/). |
| Super Admin’ler | Yalnızca bir Super Admin bir Super Admin’i oluşturabilir, düzenleyebilir, silebilir veya sıfırlayabilir ya da o rolü verebilir. Son aktif Super Admin kaldırılamaz. |

İlk admin, hiç admin yokken panel üzerinden kaydedilir. Bunu ilk başlatmadan hemen sonra yapın
ya da sunucuyu dışarı açmadan önce `verdin admin create --email …` ile oluşturun.

## Yönetim paneli ve admin API

- Admin API (`/admin/api`), `[api].cors_origins` ne derse desin hiçbir CORS başlığı göndermez:
  tarayıcılar yanıtlarını yalnızca panelin kendi origin’inin okumasına izin verir.
- Panel katı bir Content Security Policy (yalnızca kendi origin’inden betikler),
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` ve
  `Referrer-Policy: strict-origin-when-cross-origin` ile sunulur.
- Verdin `Strict-Transport-Security` göndermez. Onu TLS’i sonlandıran reverse proxy’de ekleyin.

## İçerik API’si

- **API token’ları** bir kez gösterilir. Verdin her token’ın `VERDIN_TOKEN_PEPPER` ile
  anahtarlanmış bir HMAC-SHA256’sını saklar ve görüntüleme için 10 karakterlik bir önek tutar.
  Token’ların süresi dolabilir ve yeniden oluşturulabilirler.
- **Alan ve dil izinleri** bir rolün okuduklarını ve yazdıklarını sınırlar; `populate`, ilişki
  filtreleri ve ilişki sıralamaları yalnızca çağıranın okuyabildiği tiplere ulaşır.
- **Sorgu sınırları**: `[api].max_page_size`’a (100) kadar `pageSize`, 5’e kadar `populate`
  derinliği, en fazla 100 filtre koşulu, 16 KB’a kadar sorgu string’leri ve ilişki başına en
  fazla 1.000 populate edilmiş kayıt. Bir sorgudaki bilinmeyen veya private alanlar `400`
  hatasıdır.
- **GraphQL**’in kendi derinlik ve karmaşıklık sınırları (`maxDepth`, `maxComplexity`) ve
  özelliğin ayarlarında bir introspection anahtarı vardır.
- **Hız sınırları**: token’sız istemci adresi başına `[api].public_rate_limit` ve API token’ı
  veya son kullanıcı başına `[api].token_rate_limit`, dakika başına istek olarak. Her ikisi de
  varsayılan olarak kapalıdır (`0`). Bilinmeyen bir bearer token’lı istekler adres başına
  sınırlanır.

### CORS

`[api].cors_origins`, içerik API’sini ve GraphQL’i çağırmasına izin verilen tarayıcı
origin’lerini listeler:

```toml title="verdin.toml"
[api]
cors_origins = ["https://www.example.com", "https://preview.example.com"]
```

Her girdi yol veya sondaki eğik çizgi olmadan `scheme://host[:port]` biçimindedir; `["*"]` her
origin’e izin verir ve diğerleriyle birleştirilemez. İzin verilen yöntemler `GET`, `POST`, `PUT`
ve `DELETE`; izin verilen istek başlıkları ise `Authorization`, `Content-Type` ve
`If-None-Match`’tir. Origin olmayan bir girdide başlatma başarısız olur.

Sunucu taraflı frontend’ler (Astro, sunucuda Next.js) API’yi tarayıcı olmadan çağırır ve CORS
girdisine ihtiyaç duymaz.

## İstekler ve yüklemeler

| Ayar | Varsayılan | Koruduğu durum |
| --- | --- | --- |
| `[server].body_limit` | `"1mb"` | Normal API’lerde büyük istek gövdeleri. |
| `[server].request_timeout_secs` | `30` | Bağlantıları meşgul eden yavaş istekler. |
| `[upload].max_file_size` | 200 MB | Büyük yüklemeler (yüklemelerin `body_limit` yerine kendi sınırı vardır). |
| `[upload].max_image_megapixels` | `100` | Sıkıştırma bombaları. |

Yüklenen bir dosyanın tipi, istemcinin gönderdiği tipten değil baytlarından gelir; dosya adı
yalnızca bir yedektir ve tarayıcıların etkin olarak çalıştırdığı tipler için asla kullanılmaz
(bu tür dosyalar `application/octet-stream` olarak saklanır). Zengin metin `blocks`
bağlantıları `http(s)`, `mailto:` veya göreli olmalıdır.

## Proxy arkasındaki istemci adresleri

Hız sınırları ve denetim kayıtları istemcinin adresini kullanır. Bir reverse proxy arkasında her
istek proxy’den gelir; bu yüzden proxy’yi `[server].trusted_proxies` içinde listeleyin:

```toml title="verdin.toml"
[server]
trusted_proxies = ["10.0.0.0/8"]   # the proxies' IPs or CIDR ranges
```

Verdin bu durumda `X-Forwarded-For`’u sağdan sola okur ve güvenilir bir proxy olmayan ilk adresi
alır. Başka herhangi bir adresten gelen istekler bağlantı adreslerini korur; böylece bir istemci
başlığı kendisi göndererek adresini taklit edemez. Güvenilmeyen istemcilerin bağlanabileceği
aralıkları listelemeyin.

## Giden istekler

Webhook’lar, deploy hook’ları, CDN temizleme webhook’ları ve bir URL’den yüklemeler, bir admin’in
seçtiği istekleri yapar. `verdin start` içinde bunlar loopback, özel ve link-local adresleri
(özel IPv4 adreslerini gömen IPv6 biçimleri dâhil) reddeder; böylece bir admin bunları iç
ağınızdaki servislere ulaşmak için kullanamaz. `[webhooks].allow_private_networks = true` bunu
kaldırır; bunu yalnızca her admin’e iç ağ konusunda güvenildiğinde yapın.

## Secret’lar

`VERDIN_ADMIN_JWT_SECRET` ve `VERDIN_TOKEN_PEPPER` yalnızca ortamdan okunur ve her biri en az 32
bayt olmalıdır (`verdin secrets` yenilerini yazdırır). Pepper ayrıca admin’lerin TOTP
secret’larını mühürler ve form gönderenlerin adreslerini hash’leyen anahtarı türetir. Her ikisini
de platformunuzun secret yöneticisinde saklayın ve `.env` dosyasını asla commit etmeyin.

İstek günlükleri, adları gizli gibi görünen sorgu parametrelerinin (`token`, `code`, `password`,
`key`, `signature`…) değerlerini ve deploy callback URL’lerinin gizli kısmını gizler.

## Metrikler

`[metrics].enabled = true` olmadıkça `/_metrics` kapalıdır. Açıkken ve token ayarlanmamışken
porta ulaşan herkes onu okuyabilir. `VERDIN_METRICS_TOKEN` (veya `[metrics].token`) ayarlayın ve
`Authorization: Bearer <token>` ile scrape edin ya da yolu proxy’de engelleyin. Bkz.
[İzleme](/tr/deploy/monitoring/).

## Eklentiler

Eklentiler, Extism tarafından bir sandbox içinde çalıştırılan WebAssembly modülleridir. Bir
modülün kendine ait dosya sistemi, ağı veya veritabanı yoktur: her şey, `plugin.toml` içindeki
yeteneklerle (okuduğu veya yazdığı içerik tipleri, HTTP host’ları, kendi anahtar-değer deposu)
sınırlanan host fonksiyonlarından geçer; çağrı başına bir zaman ve bellek sınırıyla
(`[limits]`, örnek manifest’te 5 sn ve 64 MB). Admin’ler bir eklentiyi açmadan önce ne istediğini
görür. Eklenti admin betikleri panelin sayfasında çalışır; bu yüzden yalnızca güvendiğiniz
eklentileri kurun. Bkz. [Eklentiler](/tr/extending/plugins/).

## Dışa aktarmalar ve yedekler

`verdin export` arşivleri private alanları ve parola hash’lerini içerir. Onları veritabanı
dökümleri gibi saklayın. Bkz. [Yedekler](/tr/deploy/backups/).

## Güvenlik açığı bildirme

Bir güvenlik sorunu için herkese açık bir issue açmayın. Deponun
[güvenlik politikasını](https://github.com/Verdin-CMS/verdin/blob/main/SECURITY.md) izleyin:
sorunu [deponun](https://github.com/Verdin-CMS/verdin/security) **Security** sekmesi üzerinden
(**Report a vulnerability**) sürümü, yeniden üretme adımlarını ve gördüğünüz etkiyi belirterek
gizli olarak bildirin. Güvenlik düzeltmeleri [changelog](/tr/project/changelog/) içinde
**Security** başlığı altında listelenir.
