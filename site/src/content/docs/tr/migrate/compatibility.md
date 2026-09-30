---
title: Strapi uyumluluğu
description: Verdin’in hangi Strapi v5 özelliklerini ve API’lerini desteklediği, kısmen desteklediği veya desteklemediği — REST, GraphQL, kullanıcılar ve izinler, yüklemeler, i18n, taslak ve yayınlama, kod uzantıları, yönetim paneli ve Enterprise özellikleri.
sidebar:
  order: 3
---

Verdin, frontend’lerin ve içeriğin taşınabilmesi için Strapi v5’in içerik modelini ve içerik
API’lerini korur (bkz. [Strapi’den geçiş](/tr/migrate/from-strapi/)). Bir Strapi *kod tabanının*
doğrudan yerine geçen bir şey değildir: JavaScript çalışma zamanı yoktur, bu yüzden özel kod
WebAssembly eklentileri olarak yeniden yazılır. Bu sayfa her alanı Verdin 0.10.0 itibarıyla durumuyla
listeler.

**Destekleniyor**, Strapi v5’teki gibi çalışır (farklar belirtilmiştir). **Kısmi**, yaygın durumları
kapsar; not eksik olanı söyler. **Desteklenmiyor**’un karşılığı yoktur.

## İçerik modeli

| Özellik | Durum | Notlar |
| --- | --- | --- |
| Koleksiyon tipleri ve tekil tipler | Destekleniyor | Strapi’ninkine yakın JSON şema dosyaları (`schema/content-types/*.json`). Bkz. [İçerik modeli](/tr/concepts/content-model/). |
| Skaler nitelik tipleri | Destekleniyor | `string`, `text`, `richtext` (Markdown), `blocks`, `email`, `uid`, `integer`, `biginteger`, `float`, `decimal`, `boolean`, `date`, `time`, `datetime`, `enumeration`, `json`, `password`. Strapi’nin `timestamp`’i `datetime` olarak içe aktarılır. |
| Bileşenler ve dinamik bölgeler | Destekleniyor | Bileşenlerin içindeki medya ve `oneWay`/`manyWay` ilişkiler dâhil. |
| İlişkiler | Destekleniyor | Bire/çoğa-bir/çok, tek yönlü ve çok yönlü ve polimorfik `morphToOne`, `morphToMany`, `morphOne`, `morphMany`. |
| Medya alanları | Destekleniyor | Tekli veya çoklu, `allowedTypes`. |
| `unique` | Kısmi | `text`, `richtext`, `blocks` ve `json` niteliklerinde yok. |
| Koşullu alanlar (`conditions`) | Destekleniyor | Strapi 5.17’nin JSON Logic koşulları; gizli alanlar zorunlu değildir. |
| Özel alanlar | Kısmi | `customField` nitelikleri çalışır; admin girdisi Strapi’nin React eklentilerinden değil, bir Verdin [eklentisinden](/tr/extending/plugins/) gelir. |
| İçerik tipi oluşturucusu | Destekleniyor | Strapi gibi yalnızca geliştirme modunda (`verdin dev`). |

## REST API

| Özellik | Durum | Notlar |
| --- | --- | --- |
| CRUD rotaları | Destekleniyor | `GET`/`POST /api/{pluralName}`, `GET`/`PUT`/`DELETE /api/{pluralName}/{documentId}`, tekil tipler `/api/{singularName}` adresinde. Yanıtlar `data` ve `meta`, hatalar Strapi’nin `error` nesnesini taşır. |
| `filters` | Destekleniyor | Her Strapi operatörü: `$eq`, `$eqi`, `$ne`, `$nei`, `$lt`, `$lte`, `$gt`, `$gte`, `$in`, `$notIn`, `$contains`, `$notContains`, `$containsi`, `$notContainsi`, `$null`, `$notNull`, `$between`, `$startsWith(i)`, `$endsWith(i)`, `$and`, `$or`, `$not`; ilişkiler, bileşenler, tekrarlanabilir bileşenler ve dinamik bölgeler (`__component`) üzerinden. |
| `sort` | Destekleniyor | Birden fazla alan, `:asc`/`:desc` ve tekli bir ilişkinin alanı (`author.name:asc`). |
| `pagination` | Destekleniyor | `page`/`pageSize` veya `start`/`limit`, `withCount`. `pageSize` `[api].max_page_size` (100) ile sınırlıdır. |
| `fields` | Destekleniyor | |
| `populate` | Destekleniyor | `*`, listeler, iç içe nesneler, dinamik bölgeler için `on`, `count`. 5’e kadar derinlik; ilişki başına en fazla 1.000 populate edilmiş kayıt. |
| `status` | Destekleniyor | `published` (varsayılan) veya `draft`; taslak okumak `readDrafts` izni gerektirir. |
| `locale` | Destekleniyor | Aşağıdaki i18n’e bakın. |
| `hasPublishedVersion` | Destekleniyor | |
| `_q` tam metin araması | Destekleniyor | Strapi gibi metin alanları üzerinde `$containsi`; `[search]` ile sıralı arama. |
| İlişki yazmaları | Destekleniyor | Kimlikler, `position` (`before`, `after`, `start`, `end`) ile `connect` / `disconnect` / `set`. |
| Yayınlama, yayından kaldırma, taslağı atma | Destekleniyor | Strapi v5’teki gibi yazmalar `?status=draft` olmadıkça yayınlar. Verdin `POST /api/{pluralName}/{documentId}/actions/{publish,unpublish,discard-draft}` ekler. |
| Strapi v4 yanıt biçimi ve `publicationState` | Desteklenmiyor | Verdin yalnızca v5 konuşur: düz nitelikler, `documentId`, `status`. |
| OpenAPI belgesi | Kısmi | Dokümantasyon eklentisinin `/documentation`’ı yerine `/api/_openapi.json` adresinde (varsayılan olarak yalnızca token ile) ve `/api/docs` adresinde etkileşimli bir başvuru. |

## GraphQL

| Özellik | Durum | Notlar |
| --- | --- | --- |
| Sorgular | Destekleniyor | `articles`, `pageInfo` ile `articles_connection`, `article(documentId)`, tekil tipler; `filters`, `sort`, `pagination`, `status`, `locale`. **Ayarlar → Özellikler → GraphQL**’i açana kadar kapalıdır. |
| Mutation’lar | Destekleniyor | `status` ve `locale` ile `create…`, `update…`, `delete…`. |
| Bileşenler, dinamik bölgeler, medya | Destekleniyor | Union olarak dinamik bölgeler, `UploadFile` olarak medya. |
| Polimorfik ilişkiler | Kısmi | Tipli union’lar olarak değil, JSON olarak döndürülür. |
| Shadow CRUD (tip başına işlemleri devre dışı bırakma) | Destekleniyor | Özelliğin `disabled` ayarı. |
| Özel resolver’lar ve şema uzantıları | Kısmi | Eklentilerin çözümlediği kök alanlar (`plugin.toml` içinde `[[graphql]]`); `extensionService` yok. |
| Users & Permissions mutation’ları (`login`, `register`, `me`…) | Desteklenmiyor | REST rotalarını kullanın. |
| Upload ve i18n sorguları/mutation’ları (`uploadFiles`, `i18NLocales`…) | Desteklenmiyor | REST rotalarını (`GET /api/i18n/locales`) ve yönetim panelini kullanın. Yerelleştirilmiş tiplerde `localizations` desteklenir. |
| Sınırlar, GraphiQL | Destekleniyor | `maxDepth`, `maxComplexity`, introspection ve oyun alanı anahtarları. |

## Users & Permissions (son kullanıcılar)

**Ayarlar → Özellikler → Kullanıcılar ve izinler**’i açın. Bkz. [Son kullanıcılar](/tr/guides/auth/end-users/).

| Özellik | Durum | Notlar |
| --- | --- | --- |
| `POST /api/auth/local`, `/auth/local/register` | Destekleniyor | Aynı istek ve yanıt biçimleri. |
| E-posta onayı, parola unutma/sıfırlama/değiştirme | Destekleniyor | `/auth/email-confirmation`, `/auth/send-email-confirmation`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/change-password`. |
| Yenileme token’ları | Destekleniyor | `jwtManagement: "refresh"`, `/auth/refresh`, `/auth/logout`. |
| `/api/users`, `/users/me`, `/users/count` | Destekleniyor | Düz JSON, `plugin::users-permissions.user` üzerinde izinler. |
| OAuth sağlayıcıları | Kısmi | GitHub, Google, Microsoft, Discord, Facebook, GitLab, LinkedIn ve herhangi bir OAuth 2 sağlayıcısı; her Strapi ön ayarı değil. |
| Rol ve izin rotaları (`/api/users-permissions/roles`, `/permissions`) | Desteklenmiyor | Rolleri **Ayarlar → Son kullanıcılar** bölümünde yönetin. |
| İçe aktarılan kullanıcılar | Destekleniyor | Bcrypt hash’leri çalışmaya devam eder; oturum açmada Argon2id ile yeniden hash’lenirler. |

## Medya kütüphanesi ve upload API

| Özellik | Durum | Notlar |
| --- | --- | --- |
| `POST /api/upload` | Destekleniyor | Multipart `files` ve `fileInfo`; `?id=` bir dosyanın bilgilerini günceller ya da bir dosya gönderildiğinde dosyayı değiştirir. |
| Yüklemede bağlama (`ref`, `refId`, `field`) | Desteklenmiyor | Yükleyin, ardından medya alanını dosya kimliğiyle ayarlayın. |
| `GET /api/upload/files`, `/files/{id}`, `DELETE /files/{id}` | Kısmi | Listeleme yalnızca `pagination[page]`, `pagination[pageSize]`, `sort` ve `filters[name][$containsi]` alır. |
| Duyarlı formatlar, breakpoint’ler | Destekleniyor | `thumbnail` artı `[upload].breakpoints`. |
| Klasörler, odak noktaları, alternatif metin, açıklamalar | Destekleniyor | |
| Upload sağlayıcıları | Kısmi | Yerel disk ve S3 uyumlu depolama (AWS, R2, B2, MinIO, Tigris…). Cloudinary veya diğer sağlayıcı paketleri yok. |
| Görsel dönüştürmeleri | Yalnızca Verdin | `/uploads/<file>?preset=…` ve imzalı URL’ler (yerel sağlayıcı). |

## Uluslararasılaştırma

| Özellik | Durum | Notlar |
| --- | --- | --- |
| Yerelleştirilmiş tipler ve yerelleştirilmemiş alanlar | Destekleniyor | `pluginOptions.i18n.localized`, nitelik başına da. |
| REST’te `?locale=`, GraphQL’de `locale` | Destekleniyor | Bilinmeyen bir dil `400`’dür. |
| Yanıtlarda `localizations` | Destekleniyor | Yalnızca populate edildiğinde (`populate=localizations`, `populate=*`), bir ilişkiyle aynı seçeneklerle. Aynı zamanda bir GraphQL alanı. Admin API onu dışarıda bırakır. |
| `GET /api/i18n/locales` | Destekleniyor | Strapi’nin biçiminde düz bir dizi. Strapi’nin `listLocales`’i gibi `plugin::i18n.locale` üzerinde `find` gerektirir (izin ızgarasının **Diller** satırı). `documentId` dil kodundan türetilir. Diller admin’de yönetilir (**Ayarlar → Uluslararasılaştırma**). |

## Taslak ve yayınlama

| Özellik | Durum | Notlar |
| --- | --- | --- |
| Belge başına taslak ve yayınlanmış sürümler | Destekleniyor | Dil başına. Bkz. [Taslak ve yayınlama](/tr/concepts/draft-and-publish/). |
| Taslağı atma | Destekleniyor | |
| Zamanlanmış yayınlama | Destekleniyor | [Sürümler](/tr/guides/content/releases/) aracılığıyla. |

## Sunucu özelleştirmesi

Bunların her birinin nasıl taşınacağı için bkz. [Özel kodu taşıma](/tr/migrate/porting-custom-code/).

| Strapi | Durum | Verdin |
| --- | --- | --- |
| Lifecycle hook’ları, Document Service middleware’leri | Kısmi | Bir yazmayı değiştirebilen veya reddedebilen WebAssembly eklentilerinde before/after hook’ları. JavaScript yok. |
| Özel controller’lar, servisler, rotalar | Kısmi | `/api/plugins/<name>/` altında eklenti rotaları. |
| Policy’ler ve middleware’ler | Desteklenmiyor | İzinler ve hız sınırları yerleşiktir. |
| `register` / `bootstrap` | Kısmi | Eklenti başladığında, açıldığında veya ayarları değiştiğinde çalışan bir eklentinin başlangıç fonksiyonu; içerik ekleyebilir ve herkese açık rolün izinlerini değiştirebilir. |
| Cron görevleri | Kısmi | Eklenti görevleri. |
| JavaScript’te Document Service / Entity Service | Desteklenmiyor | JavaScript çalışma zamanı yok. |
| Strapi marketplace’inden npm eklentileri | Desteklenmiyor | |
| Webhook’lar | Destekleniyor | İmzalı, yeniden denenen ve günlüğe yazılan; `entry.draft-discard`, `entry.discard-draft`’tır. Bkz. [Webhook’lar](/tr/guides/integrations/webhooks/). |
| API token’ları (salt okunur, tam erişim, özel) | Destekleniyor | Aynı türler, isteğe bağlı sona erme, yeniden oluşturma. |
| Transfer token’ları, `strapi transfer` | Desteklenmiyor | `verdin export` ve `verdin import verdin` kullanın. |
| `strapi export` dosyaları | Destekleniyor (içe aktarma) | `verdin import strapi`; şifrelenmiş dışa aktarmalar okunmaz. |
| `config/*.js`, `.env` | Kısmi | `verdin.toml` ve ortam değişkenleri. |
| TypeScript tipleri | Destekleniyor | `verdin types`. |
| E-posta sağlayıcıları | Kısmi | SMTP, Resend ve Postmark. |

## Yönetim paneli

| Özellik | Durum | Notlar |
| --- | --- | --- |
| İçerik yöneticisi, medya kütüphanesi, içerik tipi oluşturucusu | Destekleniyor | Strapi’nin React admin’i değil, kendine ait bir Angular paneli. |
| Admin kullanıcılar, roller, özel roller | Destekleniyor | Yerleşik Super Admin, Editor ve Author, artı özel roller. |
| Alan düzeyinde ve dil izinleri | Destekleniyor | |
| RBAC koşulları | Kısmi | Yalnızca yerleşik `is-creator` koşulu; özel koşul yok. |
| Admin özelleştirmesi (`src/admin/app`) | Kısmi | `[admin.branding]` içinde logo, favicon, başlık, vurgu rengi ve metinler; eklentilerden widget’lar ve özel alanlar. Özel sayfalar, injection zone’lar veya React uzantıları yok. |
| Admin API (`/admin/…`) | Desteklenmiyor | Verdin’in admin API’si kendine aittir; Strapi’ninkinin üzerine kurmayın. |
| Düzenleme görünümü ve liste görünümü yapılandırması | Destekleniyor | |

## Enterprise özellikleri

Verdin’deki her şey açık kaynaktır; bunlar Strapi’de Enterprise veya ücretli özelliklerdir.

| Strapi özelliği | Durum | Notlar |
| --- | --- | --- |
| SSO | Kısmi | Gruptan role eşlemeli OpenID Connect sağlayıcıları. SAML veya diğer passport stratejileri yok. Bkz. [Çoklu oturum açma](/tr/guides/auth/sso/). |
| Denetim kayıtları | Destekleniyor | Bkz. [Denetim kayıtları](/tr/guides/content/audit-logs/). |
| İnceleme iş akışları | Destekleniyor | Aşama başına roller, kayıtları bir aşamanın *içine* kimin taşıyabileceğini sınırlar ve gerekli yayınlama aşaması her API’ye uygulanır. Bkz. [İnceleme iş akışları](/tr/guides/content/review-workflows/). |
| Sürümler (Releases) | Destekleniyor | Zamanlanmış veya anında. |
| İçerik geçmişi | Destekleniyor | Belge başına `[history].max_versions` sürüm. |
| Önizleme ve canlı önizleme | Destekleniyor | Kısa ömürlü token’larla önizleme URL’leri, yan yana önizleme ve [görsel düzenleme](/tr/guides/frontend/visual-editing/). |
| Özel admin rolleri | Destekleniyor | Sayılarında sınır yok. |
