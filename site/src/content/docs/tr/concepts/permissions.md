---
title: "İzinler"
description: "Verdin’de erişim denetiminin genel resmi: alan ve dil izinleriyle admin rolleri ve RBAC, public rolü, API token’ları ve son kullanıcı rolleri."
sidebar:
  order: 6
---

Verdin iki kitleyi ayrı ayrı denetler: yönetim paneline oturum açan **admin’ler** ve
sitelerinizden ve uygulamalarınızdan içerik okuyup yazan **içerik API’si çağıranları**. Bu
sayfa her birinin nasıl yetkilendirildiğini ve parçaların nasıl bir araya geldiğini açıklar.
Eylemlerin tam listesi [izin başvurusundadır](/tr/reference/permissions/).

| Kim | Kimlik doğrulama yöntemi | İzinlerin kaynağı | Uygulandığı yer |
| --- | --- | --- | --- |
| Admin | E-posta ve parola (ayrıca ikinci faktör veya SSO) | [Rolleri](#admin-rolleri) | Yönetim paneli ve [admin API](/tr/api/admin/) |
| Anonim çağıran | `Authorization` başlığı yok | [Herkese açık erişim](#herkese-açık-erişim) | REST, GraphQL, gerçek zamanlı |
| Sunucu veya build | `Authorization: Bearer vd_…` | [API token’ının](#api-tokenları) tipi | REST, GraphQL, gerçek zamanlı |
| Oturum açmış son kullanıcı | `Authorization: Bearer <JWT>` | [Son kullanıcı rolü](#son-kullanıcılar) | REST, GraphQL, gerçek zamanlı |

Varsayılan olarak her şey kapalıdır: siz erişim verene kadar içerik API’si `403` yanıtını
verir ve bir admin yalnızca rollerinin izin verdiğini yapabilir.

## Admin rolleri

Bir admin’in bir veya daha fazla rolü vardır; izinleri toplanır. Üç rol yerleşiktir:

| Rol | Yapabildikleri |
| --- | --- |
| **Super Admin** | Kullanıcılar, roller ve API token’ları dâhil her şey. Düzenlenemez. |
| **Editor** | Tüm içeriği okuma, oluşturma, güncelleme, silme ve yayınlama; medya kütüphanesini kullanma; dağıtımları tetikleme; SEO, yönlendirmeler, menüler ve formları yönetme. |
| **Author** | İçerik oluşturma ve yalnızca kendi oluşturduğu kayıtları okuma, güncelleme ve silme. Yayınlayamaz. Dosya yükler ve yalnızca kendi dosyalarını düzenler veya siler. |

Diğer rolleri **Ayarlar → Roller** bölümünde oluşturursunuz (`roles.manage` izni). Son aktif
Super Admin devre dışı bırakılamaz, silinemez veya rütbesi düşürülemez; böylece kurulum asla
kendini dışarıda bırakmaz. Bir rol, üyelerinin
[iki adımlı doğrulamayı](/tr/guides/auth/two-factor/) kurmasını da zorunlu kılabilir: bunu
yapana kadar yalnızca profillerine erişebilirler.

### İzin nedir

Bir izin bir **eylem**, içerik eylemleri için bir **hedef** ve isteğe bağlı **koşullardan**
oluşur:

- **İçerik eylemleri**: tek bir içerik tipi (`api::article`) veya hepsi (`*`) üzerinde
  `content.read`, `content.create`, `content.update`, `content.delete` ve `content.publish`.
- **Medya eylemleri**: medya kütüphanesi için `media.read`, `media.create`, `media.update` ve
  `media.delete`.
- **Ayar eylemleri**: **Ayarlar**’ın ilgili sayfalarını açan `users.manage`, `tokens.manage`,
  `webhooks.manage` veya `features.manage` gibi eylemler.
- **Koşullar**: `is-creator`, bir içerik veya medya iznini admin’in oluşturduklarıyla
  sınırlar. Author rolü bu şekilde çalışır.

Koşullar veritabanı sorgusunun parçası olur: `is-creator` ile filtrelenen bir liste, satırları
sonradan gizlemek yerine doğru sayar ve sayfalar.

### Alan ve dil izinleri

İçerik izinleri daha da daraltılabilir:

- **Alanlar.** `content.read`, `content.create` ve `content.update`, kapsadıkları nitelikleri
  listeleyebilir. Liste dışındaki alanlar okumalardan (arama, filtreler, sıralama ve ilişkili
  kayıtlar dâhil) gizlenir ve yazmalarda reddedilir.
- **Diller.** [Yerelleştirilmiş tiplerde](/tr/concepts/internationalization/) içerik izinleri
  kapsadıkları dilleri listeleyebilir. Diğer dillerdeki sürümler okunamaz veya değiştirilemez.

Her ikisi de rolün düzenleyicisinde içerik tipi başına, **Alanlar** ve **Diller** altında
ayarlanır.

## İçerik API’si

İçerik API’si çağıranları yetkilere karşı denetlenir: bir **hedef** üzerinde bir **eylem**.

| Eylem | İzin verdiği |
| --- | --- |
| `find` | Belgeleri listeleme (`GET /api/articles`) veya tekil bir tipi okuma. |
| `findOne` | Tek bir belgeyi okuma (`GET /api/articles/{documentId}`). |
| `create` | `POST` |
| `update` | `PUT` |
| `delete` | `DELETE` |
| `publish` | `actions/publish`, `actions/unpublish` ve `actions/discard-draft` rotaları. |
| `readDrafts` | `status=draft` ile okuma. |

Hedefler içerik tipleri, medya kütüphanesi (`plugin::upload`) ve
[son kullanıcılar](/tr/guides/auth/end-users/) açıkken son kullanıcı hesaplarıdır
(`plugin::users-permissions.user`).

Birkaç kural her çağıran için geçerlidir:

- Taslakları okumak, `find` veya `findOne`’a ek olarak `readDrafts` gerektirir. Sitenizin
  içeriğini okuyan bir yetki, yayınlanmamış çalışmaları yanlışlıkla okuyamaz.
- Bir ilişki üzerinden populate etmek, filtrelemek veya sıralamak, hedef tipine okuma erişimi
  gerektirir.
- `private` alanlar, yetkiler ne olursa olsun asla döndürülmez.
- Bir yazma, Strapi’deki gibi `find` olmadan da yazılan belgeyi döndürür.
- Aynı yetkiler [GraphQL](/tr/api/graphql/) ve [gerçek zamanlı akış](/tr/api/realtime/) için de
  geçerlidir.

### Herkese açık erişim

`Authorization` başlığı olmayan istekler **Ayarlar → Herkese açık erişim** içindeki yetkileri
alır. Varsayılan olarak hiçbir şey verilmez. Tipik seçimler, sitenizin gösterdiği tipler
üzerinde `find` ve `findOne`’dır.

### API token’ları

API token’ları sunucular, build adımları ve betikler içindir. Bunları **Ayarlar → API
token’ları** bölümünde oluşturun (`tokens.manage` izni):

| Tip | Yetkiler |
| --- | --- |
| **Salt okunur** | Her tip üzerinde `find` ve `findOne`. Asla taslak yok. |
| **Tam erişim** | Taslaklar dâhil, her tip üzerinde her eylem. |
| **Özel** | Herkese açık erişimdeki gibi seçtiğiniz yetkiler. |

- Bir token `vd_` ile başlar. Secret’ı oluşturulduğunda veya yeniden oluşturulduğunda bir kez
  gösterilir; Verdin yalnızca onun anahtarlı bir hash’ini saklar.
- Token’ların süresi dolabilir. Bilinmeyen, süresi dolmuş veya hatalı biçimlendirilmiş bir
  token `401` döndürür: asla herkese açık erişime geri düşmez.
- Dokümantasyonu herkese açık yapmadığınız sürece, geçerli herhangi bir token
  `/api/_openapi.json` adresindeki OpenAPI belgesini okuyabilir.

Oluşturmak ve yenilemek için bkz. [API token’ları](/tr/guides/auth/api-tokens/).

### Son kullanıcılar

Son kullanıcılar, Strapi’nin users-permissions eklentisindeki gibi sitenize veya
uygulamanıza oturum açan kişilerdir. Özellik varsayılan olarak kapalıdır. Her hesabın bir rolü
vardır:

- **Public**, token’sız isteklerin rolüdür: yetkileri **Ayarlar → Herkese açık erişim**
  içindekilerdir.
- **Authenticated**, varsayılan olarak yeni hesaplara verilir.
- Özel roller, yukarıdakiyle aynı eylemlerle herhangi bir yetki kümesini tutar.

Bir son kullanıcı, oturum açarken aldığı JWT’yi `Authorization: Bearer <jwt>` olarak gönderir.
Verdin onu API token’larından `vd_` önekiyle ayırt eder. Bkz.
[Son kullanıcılar](/tr/guides/auth/end-users/).

## Strapi ile karşılaştırma

Model Strapi v5’i izler: `is-creator` koşullarıyla admin RBAC ve herkese açık erişim, API
token’ları ve users-permissions rolleri olan bir içerik API’si. Farklar:

- Her özellik her projede kullanılabilir: özel roller, alan ve dil izinleri,
  [SSO](/tr/guides/auth/sso/) ve [denetim kayıtları](/tr/guides/content/audit-logs/).
- İçerik API’si üzerinden taslak okumak kendi yetkisidir: `readDrafts`.
- REST üzerinden yayınlamanın kendi yetkisi (`publish`) ve kendi rotaları vardır.
