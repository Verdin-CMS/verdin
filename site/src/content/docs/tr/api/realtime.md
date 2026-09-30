---
title: "Gerçek zamanlı API"
description: "Verdin’in gerçek zamanlı akışının Server-Sent Events protokolü: uç nokta, kimlik doğrulama, olay adları ve mesaj biçimleri ile admin’in presence protokolü."
sidebar:
  order: 5
  label: "Gerçek zamanlı"
---

Verdin, içerik ve medya değişikliklerini commit edildikleri anda
[Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events) (SSE)
üzerinden akış olarak gönderir. Her abone yalnızca okuyabileceği şeylerle ilgili olayları
alır. Bu sayfa protokolü açıklar; bir frontend’de kullanımı için bkz.
[Gerçek zamanlı güncellemeler](/tr/guides/frontend/realtime/).

## Etkinleştirme

Gerçek zamanlı özellik varsayılan olarak kapalıdır. **Ayarlar → Özellikler → Gerçek zamanlı**
bölümünden açın (`features.manage` izni). Kapalıyken uç noktalar `404` yanıtını verir.

## İçerik akışı

```
GET /api/_events
GET /api/_events?types=api::article,api::category
```

| Parametre | Açıklama |
| --- | --- |
| `types` | İsteğe bağlı, virgülle ayrılmış içerik tipi UID’leri; `plugin::upload` medya kütüphanesidir. Strapi biçimi `api::article.article` de çalışır. Belirtilmezse okuyabildiğiniz her tipi alırsınız. |

REST API’deki gibi kimlik doğrulayın: `Authorization: Bearer …` içinde bir API token’ı veya
bir son kullanıcının JWT’si ya da herkese açık erişim için başlık olmadan. Geçersiz bir token,
akış açılmadan önce `401` yanıtını verir.

```sh title="Terminal"
curl -N -H "Authorization: Bearer $VERDIN_TOKEN" \
  'https://cms.example.com/api/_events?types=api::article'
```

```text
event: ready
data: {}

event: entry.publish
data: {"event":"entry.publish","uid":"api::article","documentId":"k2m7q4dx8n5t1v3b9c0e6a2wfr","locale":"en"}

event: media.create
data: {"event":"media.create","uid":"plugin::upload","documentId":"v3k9…","fileId":5}
```

## Mesajlar

İlk olay her zaman `ready`’dir. Ardından her değişiklik, kendi adını taşıyan bir SSE olayıdır;
`data` alanı bir JSON nesnesidir:

| Alan | Bulunduğu yer | Açıklama |
| --- | --- | --- |
| `event` | her zaman | SSE `event:` satırındaki gibi olay adı. |
| `uid` | her zaman | İçerik tipi UID’si veya medya için `plugin::upload`. |
| `documentId` | her zaman | Değişen belge veya dosya. |
| `locale` | yerelleştirilmiş tipler | Değişen sürümün dili. |
| `fileId` | medya olayları | Medya alanlarında kullanıldığı şekliyle dosyanın sayısal kimliği. |
| `actorId` | admin akışı | Değişikliği bir admin yaptıysa, değişikliği yapan admin. |

| Olaylar | Ne zaman gönderilir | Kimler alır |
| --- | --- | --- |
| `entry.create`, `entry.update`, `entry.discard-draft` | Bir belge oluşturulduğunda, kaydedildiğinde veya taslağı atıldığında | Taslak ve yayınlama kullanan tiplerde `readDrafts` yetkisi olan çağıranlar (bu olaylar yalnızca taslakları değiştirir). Diğer tiplerde `find` veya `findOne` yetkisi olanlar. |
| `entry.publish`, `entry.unpublish`, `entry.delete` | Bir belge yayınlandığında, yayından kaldırıldığında veya silindiğinde | Tip üzerinde `find` veya `findOne` yetkisi olan çağıranlar |
| `media.create`, `media.update`, `media.delete` | Bir dosya yüklendiğinde, düzenlendiğinde veya silindiğinde | Medya kütüphanesi üzerinde `find` veya `findOne` yetkisi olan çağıranlar |

Olaylar içerik değil kimlik taşır. Okumak için belgeyi veya dosyayı, çağıranın olağan
izinleriyle REST ya da GraphQL API üzerinden getirin. Olaylar her API’den gelir: REST,
GraphQL, yönetim paneli, sürümler ve eklentiler.

## Bağlantı ömrü

- Sunucu her 15 saniyede bir keep-alive yorumu gönderir.
- Bir içerik akışı bir saat sonra sona erer. Yeniden bağlanın (tarayıcıların `EventSource`’u
  bunu kendiliğinden yapar); bu, token’ı da yeniden denetler.
- `data: {"missed": 12}` ile gelen `lagged` adlı bir olay, istemcinin çok yavaş okuduğu ve o
  kadar olayın atıldığı anlamına gelir. İstemcinin gösterdiğini yeniden getirin.
- Tekrar oynatma (replay) yoktur: bir istemci bağlı değilken olan olaylar daha sonra
  gönderilmez.

Tarayıcıların `EventSource`’u bir `Authorization` başlığı gönderemez. Herkese açık erişim için
olduğu gibi çalışır; bir token ile, akış gövdesi okuyuculu `fetch` ya da başlıkları
destekleyen bir SSE istemcisi kullanın.

## Admin akışı

Yönetim paneli, admin’in erişim token’ıyla kendi akışını açar:

```
GET /admin/api/events?types=api::article
```

Admin’in okuyabildiği tipler için (`content.read` ve `media.read` ile) taslaklar dâhil aynı
içerik ve medya olaylarını taşır; ayrıca:

- admin’lerin yaptığı değişikliklerde `actorId`;
- `presence` olayları (aşağıda);
- kaydın `uid`, `documentId` ve `locale` değerleriyle `comment.create`, `comment.update`,
  `comment.delete`, `comment.resolve`, `comment.reopen`, `task.create`, `task.update` ve
  `task.delete`.

Bir admin akışı, bir erişim token’ının ömrü olan 15 dakika sonra sona erer: yeni bir token’la
yeniden bağlanın.

### Presence

Kayıt düzenleyicisi, bir kayıtta kimin olduğunu sunucuya bildirir:

```
POST /admin/api/presence
{ "uid": "api::article", "documentId": "k2m7q4…", "locale": "en", "editing": true }
```

- Düzenleyici açıkken bunu yaklaşık her 20 saniyede bir gönderin. `editing: true`, admin’in
  kaydedilmemiş değişiklikleri olduğu anlamına gelir. Düzenleyici kapandığında
  `"leave": true` gönderin.
- Bir presence, son heartbeat’ten 45 saniye sonra sona erer.
- Yanıt, kayıtta kimlerin olduğunu listeler: `{ "data": [{ "userId": 3, "name": "Ada Lovelace", "editing": true, "holdsLock": true }] }`.
- `GET /admin/api/presence?uid=&documentId=&locale=` aynı listeyi okur.
- Liste değiştiğinde admin akışları; kaydın `uid`, `documentId`, `locale` değerlerini ve
  `presence` içindeki listeyi taşıyan bir `presence` olayı alır.

Hâlâ düzenleme yapan ilk admin yumuşak bir kilit (`holdsLock`) tutar. Düzenleyici bunu
diğerlerine gösterir, ancak onların kaydetmesini engellemez. Presence okumak için tip üzerinde
`content.read` gerekir.

## Birden fazla örnek

Paylaşılan olay veriyolu (`[cluster].bus = "database"`) ile her örneğin akışları hepsinin
olaylarını taşır; presence ve yumuşak kilitler de her örnekte aynıdır. Başka bir örnekten gelen
olaylar `[cluster].poll_interval_ms` içinde (MySQL, MariaDB, SQLite) ya da anında (PostgreSQL,
`LISTEN/NOTIFY`) ulaşır. Veriyolu olmadan olaylar ve presence, istemcinin bağlı olduğu örneğe
(instance) aittir: `/api/_events` ve `/admin/api/events` yollarını sticky session ile
yönlendirin ya da gerçek zamanlı istemcileri tek bir örneğe karşı çalıştırın. Bkz.
[Ölçekleme](/tr/deploy/scaling/#paylaşılan-olay-veriyolu).
