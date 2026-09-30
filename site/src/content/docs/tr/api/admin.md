---
title: "Admin API"
description: "Verdin yönetim panelinin arkasındaki, otomasyon için kullanılabilen API: oturum açma, oturumlar, kurallar ve ana rota grupları."
sidebar:
  order: 4
  label: "Admin"
---

Yönetim paneli, `{admin.path}/api` altında (varsayılan olarak `/admin/api`) sunulan admin
API’nin bir istemcisidir. Panelin yaptığı her şeyi bir betik de yapabilir: admin ve API
token’ları oluşturmak, webhook’ları ve özellikleri yapılandırmak, dilleri yönetmek ya da
taslaklar ve sürümlerle çalışmak. Bu sayfa kimlik doğrulamanın nasıl yapılacağını açıklar ve
rota gruplarını listeler.

:::caution[Kararlılık]
Admin API’nin Verdin 1.0’dan önce bir kararlılık garantisi yoktur: rotalar ve gövdeler minor
sürümlerde değişebilir ve changelog her değişikliği listelemez. İçerik okumak ve yazmak için
bir [API token’ı](/tr/guides/auth/api-tokens/) ile [REST](/tr/api/rest/) veya
[GraphQL](/tr/api/graphql/) API’yi tercih edin. Tüm API’ler için bir kararlılık sözleşmesi
1.0 için planlanıyor.
:::

## Oturum açma

Admin API’nin henüz API token’ı yoktur: bir betik, admin kullanıcısı olarak oturum açar;
tercihen rolü yalnızca betiğin ihtiyaç duyduğu şeylere izin veren bir kullanıcıyla.

```sh title="Terminal"
curl -s -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"bot@example.com","password":"…"}'
```

```json
{
  "data": {
    "user": { "id": 3, "email": "bot@example.com", "…": "…" },
    "accessToken": "eyJhbGciOiJIUzI1NiIs…",
    "accessTokenExpiresAt": "2026-09-29T10:15:00.000Z"
  }
}
```

Erişim token’ını diğer tüm isteklerde gönderin:

```sh title="Terminal"
curl -H "Authorization: Bearer $ACCESS_TOKEN" 'https://cms.example.com/admin/api/system/info'
```

| Kimlik bilgisi | Ömür | Nerede |
| --- | --- | --- |
| Erişim token’ı (JWT) | 15 dakika | Yanıt gövdesi. `Authorization: Bearer …` olarak gönderin. |
| Yenileme token’ı | 30 gün | `verdin_refresh` çerezi (`HttpOnly`, `SameSite=Strict`, yol `/admin/api/auth`, `verdin start` altında `Secure`). |

Yeni bir erişim token’ı almak için çerezle ve bir `X-Verdin-CSRF` başlığıyla (herhangi bir
değer) `POST /admin/api/auth/refresh` çağırın. Bir oturum açma gibi yanıt verir ve yenileme
token’ını döndürür (rotate eder): yeni çerezi saklayın, çünkü kullanılmış bir yenileme
token’ını yeniden sunmak tüm oturumu sonlandırır. Aynı başlıkla
`POST /admin/api/auth/logout` oturumu sonlandırır.

```sh title="Terminal"
curl -s -b cookies.txt -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/refresh' \
  -H 'X-Verdin-CSRF: 1'
```

- **İki adımlı doğrulama.** İkinci faktörü olan bir hesap için oturum açma şu yanıtı verir:
  `{ "data": { "twoFactorRequired": true, "twoFactorToken": "…", "methods": ["totp"] } }`.
  İşlemi `POST /admin/api/auth/login/two-factor` ve
  `{ "twoFactorToken": "…", "code": "123456" }` (bir TOTP veya kurtarma kodu) ile tamamlayın.
  Bkz. [İki adımlı doğrulama](/tr/guides/auth/two-factor/).
- **Hız sınırları.** Oturum açma ve kayıt, istemci IP’si başına
  `[admin].auth_rate_limit` ile sınırlanır (varsayılan olarak dakikada 20); yenilemelerin
  bütçesi daha büyüktür.
- **Hatalar.** Yanlış kimlik bilgileri, bilinmeyen hesaplar ve kilitli hesapların tümü
  `400 Invalid credentials` yanıtını verir. Beş yanlış parola hesabı 15 dakika kilitler.
- **İlk admin.** Yeni bir kurulumda `POST /admin/api/auth/register-first-admin` Super Admin’i
  oluşturur; yalnızca hiç admin yokken çalışır. `verdin admin create` aynı işi komut
  satırından yapar.

## Kurallar

- Gövdeler ve yanıtlar JSON’dur. Yanıtlar sonuçlarını `data` içine sarar
  (`{ "data": … }`); içerik rotaları REST API gibi `meta` de döndürür.
- İçerik rotaları REST API gibi `{ "data": { … } }` gövdeleri alır. Ayar rotaları düz JSON
  nesneleri alır.
- Hatalar [REST hata biçimindedir](/tr/api/rest/#hatalar). Kapalı bir özelliğin rotası `404`
  yanıtını verir. Rolü iki adımlı doğrulama gerektiren bir admin, bunu kurana kadar
  `403 TwoFactorRequiredError` alır.
- Her rota admin’in [izinlerini](/tr/concepts/permissions/) denetler: içerik rotaları tip
  üzerindeki içerik eylemlerini, ayar rotaları ilgili ayar eylemini.
- Admin API çapraz origin isteklere asla yanıt vermez: onu başka bir sitenin sayfalarından
  değil, bir sunucudan veya betikten çağırın.
- Başarılı değişiklikler [denetim kaydına](/tr/guides/content/audit-logs/) yazılır.

## Listeler

Ayar listeleri `page` (1’den başlar) ve `pageSize` ile sayfalanır. Sayfanın satırlarını ve
sayıları yanıtlarlar:

```json
{ "data": [ … ], "meta": { "pagination": { "page": 2, "pageSize": 25, "total": 60, "pageCount": 3 } } }
```

| Liste | Varsayılan sayfa boyutu (en fazla) | Sıra | Diğer parametreler |
| --- | --- | --- | --- |
| `GET /users`, `GET /roles`, `GET /api-tokens` | 25 (100) | En eski önce | |
| `GET /webhooks` | 25 (100) | En eski önce | `meta.events`, bir webhook’un abone olabileceği olayları listeler |
| `GET /webhooks/{id}/deliveries` | 25 (100) | En yeni önce | |
| `GET /releases` | 25 (100) | En yeni önce | `status` (`pending`, `running`, `done`, `failed`) |
| `GET /site/redirects` | 25 (100) | Kaynağa göre | `search`, kaynağı veya hedefi eşleştirir |
| `GET /site/menus`, `GET /site/forms` | 25 (100) | Ada göre | |
| `GET /site/forms/{id}/submissions` | 25 (100) | En yeni önce | |
| `GET /deploy/targets` | 25 (100) | En eski önce | |
| `GET /deploy/deployments` | 25 (100) | En yeni önce | `targetId`; `limit`, `pageSize`’ın kullanımdan kaldırılmış takma adıdır |
| `GET /end-users` | 25 (100) | En yeni önce | `search`, kullanıcı adını veya e-postayı eşleştirir |
| `GET /audit-logs` | 50 (200) | En yeni önce | Bkz. [Denetim kayıtları](/tr/guides/content/audit-logs/) |

Daha büyük bir `pageSize` en yüksek değere indirilir. Bir listenin tamamını okumak için
`page`, `pageCount` değerine ulaşana kadar sayfaları isteyin:

```sh title="Terminal"
curl 'https://cms.example.com/admin/api/site/redirects?page=1&pageSize=100' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

İçerik rotaları REST API gibi, `pagination[page]` ve `pagination[pageSize]` ile sayfalanır.

## Rota grupları

Yollar `/admin/api`’ye görelidir. Router’lar
[`crates/verdin-api/src/admin.rs`](https://github.com/Verdin-CMS/verdin/blob/main/crates/verdin-api/src/admin.rs)
dosyasında ve yanındaki `*_admin.rs` modüllerindedir.

| Grup | Rotalar | İzin |
| --- | --- | --- |
| Oturum açma ve hesap | `GET /auth/status`, `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `GET\|PUT /users/me`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, `/auth/*` altında davetler ve parola sıfırlama | Oturum açmış (oturum açma rotaları herkese açıktır) |
| İki adımlı doğrulama | `/auth/two-factor/*`, `POST /auth/login/two-factor`, `POST /auth/login/passkey/options`, `DELETE /users/{id}/two-factor` | Oturum açmış; başka bir admin’i sıfırlamak için `users.manage` |
| SSO | `GET /auth/sso`, `GET /auth/sso/{id}`, `GET /auth/sso/{id}/callback` | Herkese açık |
| Admin kullanıcılar | `GET\|POST /users`, `GET\|PUT\|DELETE /users/{id}`, `POST /users/{id}/invite` | `users.manage` |
| Roller ve herkese açık erişim | `GET\|POST /roles`, `GET\|PUT\|DELETE /roles/{id}`, `GET\|PUT /public-permissions` | `roles.manage` |
| API token’ları | `GET\|POST /api-tokens`, `GET\|PUT\|DELETE /api-tokens/{id}`, `POST /api-tokens/{id}/regenerate` | `tokens.manage` |
| Şema | `GET /content-types`, `GET /components`, `GET\|PUT\|DELETE /content-types/{uid}/edit-view`; yalnızca `verdin dev` içinde `GET /schema`, `POST /schema/plan`, `POST /schema/apply` | Oturum açmış; düzenleme görünümleri için `views.manage`; oluşturucu için `schema.manage` |
| İçerik | `GET\|POST /content/{uid}`, `GET\|PUT\|DELETE /content/{uid}/{documentId}`, `POST /content/{uid}/{documentId}/actions/{publish\|unpublish\|discard-draft}`, `POST …/clone`, `GET …/locales`, `GET …/usage`, `GET /content/{uid}/uid-available`, `GET /content/{uid}/stats` | `{uid}` üzerindeki içerik eylemleri |
| İçe ve dışa aktarma | `GET /content/{uid}/export`, `POST /content/{uid}/import` | `{uid}` üzerindeki içerik eylemleri |
| Geçmiş | `GET /history/{uid}/{documentId}`, `GET /history/versions/{id}`, `POST /history/versions/{id}/restore` | Tip üzerindeki içerik eylemleri |
| Sürümler | `GET\|POST /releases`, `GET\|PUT\|DELETE /releases/{id}`, `POST /releases/{id}/actions`, `DELETE /releases/{id}/actions/{actionId}`, `POST /releases/{id}/publish` | `releases.manage` |
| İnceleme iş akışları | `GET\|POST /review-workflows`, `GET\|PUT\|DELETE /review-workflows/{id}`, `GET\|PUT /content/{uid}/{documentId}/review`, `GET /review/*` | Yapılandırmak için `workflows.manage` |
| Medya | `POST /upload`, `POST /upload/from-url`, `GET /upload/files`, `GET\|PUT\|DELETE /upload/files/{id}`, `POST /upload/files/{id}/replace`, `GET /upload/files/{id}/usage`, `/upload/folders…` | `media.*` |
| Diller | `GET\|POST /i18n/locales`, `PUT\|DELETE /i18n/locales/{code}` | Değiştirmek için `locales.manage` |
| Webhook’lar | `GET\|POST /webhooks`, `GET\|PUT\|DELETE /webhooks/{id}`, `POST\|DELETE /webhooks/{id}/secret`, `POST /webhooks/{id}/trigger`, `GET /webhooks/{id}/deliveries`, `POST /webhooks/deliveries/{id}/retry` | `webhooks.manage` |
| Son kullanıcılar | `GET\|POST /end-users`, `GET\|PUT\|DELETE /end-users/{id}`, `GET\|POST /end-user-roles`, `PUT\|DELETE /end-user-roles/{id}` | `endusers.manage` |
| Özellikler | `GET /features`, `PUT /features/{id}`, `POST /email/test` | Değiştirmek için `features.manage` |
| Eklentiler | `GET /plugins`, `GET /plugins/extensions`, `PUT /plugins/{name}`, `GET /plugins/{name}/logs` | `plugins.manage` |
| Dağıtımlar ve CDN | `/deploy/targets…`, `GET /deploy/deployments`, `GET /deploy/cdn`, `POST /deploy/cdn/purge` | `deploy.manage`; tetiklemek için `deploy.trigger` |
| Site | `/site/redirects…`, `/site/menus…`, `/site/forms…` ve form gönderimleri | `site.manage` |
| İş birliği | `/comments…`, `/tasks…`, `/engagement/*`, `/polls…` | Kaydın tipine okuma erişimi |
| Gerçek zamanlı | `GET /events`, `GET\|POST /presence` | Bkz. [Gerçek zamanlı API](/tr/api/realtime/#admin-akışı) |
| AI | `GET /ai`, `POST /ai/translate`, `/ai/alt-text`, `/ai/summarize`, `/ai/seo` | Bkz. [AI eylemleri](/tr/guides/integrations/ai-actions/) |
| Denetim kayıtları | `GET /audit-logs` | `audit.read` |
| Sistem | `GET /system/info` (sürüm, veritabanı ve mod) | Oturum açmış |

## İçerik rotaları

İçerik rotaları, REST API ile aynı Document Service’i admin kurallarıyla çalıştırır:

- `{uid}`, içerik tipinin UID’sidir, örneğin `api::article`.
- Okumalar, `status=published` geçmediğiniz sürece **taslakları** döndürür. REST
  [sorgu parametrelerini](/tr/api/rest/#sorgu-parametreleri) alırlar; ayrıca admin’in son
  değişiklikten beri açmadığı belgeler için `unseen=true` alırlar.
- Yazmalar yalnızca taslağı kaydeder. Yayınlama her zaman açık bir eylemdir.
- Yazmalar admin’i oluşturan veya son düzenleyen olarak kaydeder. Admin’in rollerindeki alan,
  dil ve `is-creator` kısıtlamaları okumalara ve yazmalara uygulanır.

```sh title="Terminal"
curl -X PUT 'https://cms.example.com/admin/api/content/api::article/k2m7q4…?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"data":{"title":"Bonjour, Verdin"}}'
curl -X POST 'https://cms.example.com/admin/api/content/api::article/k2m7q4…/actions/publish?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```
