---
title: Yönetim paneli
description: Verdin’in Angular yönetim panelinin nasıl yapılandırıldığı, formları ve listeleri şemadan nasıl oluşturduğu ve nasıl derlendiği, ikili dosyaya gömüldüğü ve çevrildiği.
sidebar:
  order: 6
  label: Yönetim paneli
---

Bu sayfa `admin/` içindeki yönetim paneline katkıda bulunanlar içindir: Angular uygulamasının nasıl düzenlendiği, içerik şemasını formlara ve listelere nasıl dönüştürdüğü ve `verdin` ikili dosyasının içine nasıl girdiği. Panelin nasıl kullanılacağı kılavuzlarda anlatılır; admin API’nin sunucu tarafının nasıl çalıştığı [admin API başvurusundadır](/tr/api/admin/).

Panel bir Angular 22 tek sayfalık uygulamasıdır: standalone bileşenler, zoneless değişiklik algılama, signal’lar, lazy-loaded rotalar ve Tailwind CSS v4 üzerinde spartan/ui bileşenleri.

## Yapı

```text
admin/
├── src/app/
│   ├── app.config.ts     # providers: router, HttpClient interceptors, Transloco, icons
│   ├── app.routes.ts     # lazy routes, guards (auth, permissions, unsaved changes)
│   ├── core/             # services and pure models: api, auth, schema, i18n, permissions…
│   ├── layout/           # the shell (sidebar, header), home, deploy button
│   ├── features/
│   │   ├── auth/         # login, first admin, invitations, password reset
│   │   ├── dashboard/    # home widgets
│   │   ├── content/      # lists, the entry editor, history, releases, review, import
│   │   │   ├── fields/   # schema-driven form controls and the form model
│   │   │   └── collab/   # comments and tasks
│   │   ├── builder/      # content-type builder (verdin dev only)
│   │   ├── media/        # media library
│   │   ├── releases/
│   │   ├── profile/      # own account, two-factor, passkeys, sessions
│   │   └── settings/     # users, roles, tokens, webhooks, locales, plugins, site features…
│   └── shared/
│       ├── ui/           # spartan helm components, owned by the project
│       └── components/   # app-level shared components (confirm dialog, page header…)
├── public/i18n/          # translation catalogs, one JSON file per language
├── scripts/check-i18n.mjs
└── e2e/                  # Playwright tests and the server they run against
```

**Durum**, `core/` içindeki enjekte edilebilir servislerin (`Auth`, `Schema`, `I18n`, `Theme`…) içindeki signal’larda bulunur. Bir store kütüphanesi yoktur.

**API erişimi**, Angular’ın `HttpClient`’ı üzerinde küçük, promise tabanlı bir sarmalayıcı olan `core/api.ts` üzerinden geçer; tipler `core/types.ts` içinde elle yazılmıştır. Çalışma zamanı yapılandırması (admin yolu, API öneki, mod, markalama) sunucunun enjekte ettiği bir `<meta name="verdin-config">` etiketinden gelir.

**Oturum.** Erişim token’ı yalnızca bellekte bulunur; yenileme token’ı auth rotalarıyla sınırlı bir `HttpOnly` çerezidir. Bir HTTP interceptor bearer token’ı ekler ve bir `401` alındığında bir kez yeniler ve yeniden dener; yenileme başarısız olursa kullanıcıyı oturum açma sayfasına gönderir. Yenileme ve oturum kapatma istekleri sunucunun gerektirdiği `X-Verdin-CSRF` başlığını taşır. Guard’lar sayfa yüklenirken oturumu çerezden geri yükler. Rolün iki adımlı doğrulama gerektirdiğini söyleyen bir `403`, kullanıcıyı bunu kurmaya gönderir.

## Şema güdümlü formlar

Kayıt düzenleyicisinin (`features/content/edit.ts`) tipe özgü kodu yoktur. İçerik tiplerini ve bileşenleri `GET /admin/api/content-types` ve `GET /admin/api/components` adreslerinden, düzenleyici yerleşimini ise düzenleme görünümü ayarlarından okur ve formu çalışma zamanında **Signal Forms** (`@angular/forms/signals`) ile oluşturur:

- Belge modeli düz bir nesnenin signal’ıdır (`fields/model.ts` içindeki `FormModel`); alan ağacı ve doğrulayıcıları şemadan türetilir.
- Özyinelemeli bir `vd-fields` bileşeni (`fields/fields.ts`) herhangi bir nitelik haritasını bir alan ağacına karşı gösterir. Metin, tarihler ve saatler `[formField]` ile bağlanan yerel girdileri kullanır. Özel `FormValueControl`’lar sayıları (nullable; büyük tam sayılar string kalır), anahtarları, enumeration’ları, tarih-saatleri (girdide yerel saat, modelde UTC), JSON’u, Markdown’u, `blocks`’u (TipTap), medyayı, ilişkileri (sıralamalı, yazarken arayan seçici) ve polimorfik ilişkileri işler.
- Bileşenler iç içe fieldset’lerdir; tekrarlanabilir bileşenler ve dinamik bölgeler yeniden sıralanabilir listelerdir. Eklentiler, özel elemanlar olarak gösterilen özel alan tipleri kaydedebilir.
- `toModel`, populate edilmiş bir belgeyi form modeline dönüştürür (ilişkiler `documentId`’lere, dosyalar kimliklere dönüşür) ve `toPayload` onu geri `data` payload’ına dönüştürür: boş string’ler `null` olur, görüntüleme anahtarları (`__key`) ve salt okunur taraflar (`mappedBy`, `morphOne`, `morphMany`) atılır. Her ikisinin birim testleri `fields/model.spec.ts` içindedir.
- Şemadan türetilen doğrulama anında geri bildirim verir. Koşullu alanlar (`conditions.visible`), sunucunun JSON Logic değerlendiricisinin bir port’u (`core/logic.ts`) tarafından tarayıcıda değerlendirilir. Alanlar arası doğrulama kurallarını yalnızca sunucu denetler. Yetki sunucuda kalır: onun `details.errors[].path` girdileri eşleşen alana geri eşlenir.
- Kaydetme açıktır; kirli (dirty) izleme ve sayfadan ayrılma uyarısıyla (bir rota guard’ı artı `beforeunload`). **Yayınla**, **Yayından kaldır** ve **Discard** düğmeleri belgenin durumuna göre görünür. Admin yalnızca taslakları kaydeder; yayınlama her zaman ayrı bir eylemdir.

Düzenleyicinin yerleşimi (alan sırası, genişlikler, etiketler, açıklamalar, salt okunur alanlar, ilişkili kayıtları adlandıran alan) tüm admin’ler tarafından paylaşılır ve sunucuda `vd_settings` içinde saklanır; `views.manage` izniyle **Görünümü yapılandır** sayfasından değiştirilir.

## Listeler

İçerik listeleri (`features/content/list.ts`), sunucu taraflı sayfalama, sıralama ve filtrelerle spartan helm tablosunu kullanır. Filtreler, arama (`_q`) ve sayfa URL’ye yansıtılır; böylece filtrelenmiş bir liste paylaşılabilir bir bağlantıdır. Her admin tip başına görünür sütunları, varsayılan sıralamayı ve sayfa boyutunu seçer (`list-view.ts`); bu seçimler sunucuda kendi tercihlerine kaydedilir, bu yüzden tarayıcılar arasında onları izler. Listeler ayrıca admin olay akışından canlı olarak güncellenir.

## İçerik tipi oluşturucusu

**İçerik Tipi Oluşturucu**, yalnızca sunucu geliştirme modunda (`verdin dev`) çalışırken ve admin’in `schema.manage` yetkisi olduğunda görünür. İçerik tiplerini ve bileşenleri dosya biçimlerinde düzenler: alanlar, ilişki türleri ve hedefleri (hedefte ters niteliği oluşturarak), bileşenler, dinamik bölgeler, uzunluklar, aralıklar ve `required`, `unique` ve `private` bayrakları.

Her değişiklik önce, olası şemayı doğrulayan ve migrasyon adımlarını riskleri, SQL’leri ve kullanıcının kabul edebileceği yeniden adlandırma önerileriyle döndüren `POST /admin/api/schema/plan`’a gönderilir. Onaylamak, kabul edilen risk düzeyi ve yeniden adlandırmalarla `POST /admin/api/schema/apply` çağırır. Sunucu migre eder, `schema/*.json` dosyalarını yazar ve çalışan uygulamayı yeniden başlatmadan yeni şemayla değiştirir. Sunucuda neler olduğu için bkz. [migrasyon motoru](/tr/internals/migrations/).

## Derleme ve dağıtım

- `ng build`, üretim derlemesini `<base href="/admin/">` ile `admin/dist/admin/browser` içine yazar.
- Sunucu, sürüm derlemelerinin ve Docker imajının kullandığı `embed-admin` özelliğiyle derlendiğinde bu klasörü `rust-embed` ile gömer. Özellik olmadan ya da `[admin].assets_dir` ayarlandığında dosyaları diskten sunar. `assets_dir` gömülü derlemeye üstün gelir.
- Sunucu `<base href>`’i `[admin].path` olarak yeniden yazar ve çalışma zamanı yapılandırmasını satır içi bir betik olarak değil, bir `<meta>` etiketi olarak enjekte eder. `admin.path`’i değiştirmek asla paneli yeniden derlemeyi gerektirmez.
- Dosya uzantısı olmayan bilinmeyen yollar, istemci taraflı yönlendirme için `index.html`’e geri düşer. Parmak izli paketler (`main-ABC123.js`) bir yıl boyunca `immutable` olarak önbelleğe alınır; diğer her şey `no-cache`’dir.
- Her admin yanıtı katı bir Content Security Policy (`script-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`…), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` ve `Referrer-Policy: strict-origin-when-cross-origin` taşır. Angular’ın kritik CSS satır içi yerleştirmesi, politikanın yasakladığı satır içi olay işleyicilerine dayandığı için `angular.json` içinde kapatılmıştır.

Frontend çalışması için sunucuyu çalıştırın, ardından `admin/` içinde `npm start`: `ng serve`, `/admin/api` ve `/api`’yi `http://localhost:1337`’ye proxy’ler (`admin/proxy.conf.json`).

## Çeviriler

Panel, Angular’ın derleme zamanı i18n’i ile değil, çalışma zamanında Transloco ile çevrilir; böylece tek bir derleme her dili sunar ve kullanıcılar yeniden yüklemeden dil değiştirebilir.

- Kataloglar `admin/public/i18n/` içindeki düz JSON dosyalarıdır (`en.json` kaynaktır) ve istek üzerine yüklenir.
- Mesajlar, özel bir Transloco transpiler’ı aracılığıyla FormatJS (`intl-messageformat`) tarafından yorumlanan ICU MessageFormat kullanır (`{name}`, `{count, plural, one {# entry} other {# entries}}`). FormatJS mesajları fonksiyonlara derlemek yerine yorumlar; böylece CSP `unsafe-eval` gerektirmez.
- Mesaj anahtarları `en.json`’dan tiplenir (`core/i18n/keys.ts`): var olmayan bir anahtarı kullanmak bir derleme hatasıdır.
- `npm run i18n:check` her kataloğu `en.json`’a karşı denetler: aynı anahtarlar, geçerli ICU sözdizimi, aynı argümanlar ve dilin her çoğul kategorisi. CI bunu çalıştırır.
- `I18n` servisi ayrıca, tarayıcının bölgesel ayarlarından alınan ve kullanıcı başına geçersiz kılınabilen, dile duyarlı biçimlendirme ve haftanın ilk gününü sağlar.

Bir dilin nasıl ekleneceği veya güncelleneceği [çeviri](/tr/project/translating/) sayfasındadır.
