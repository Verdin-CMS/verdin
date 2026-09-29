---
title: Karar günlüğü
description: Verdin’in arkasındaki tasarım kararları, alındıkları sırayla numaralandırılmış, her birinin sonucu ve nedeniyle.
sidebar:
  order: 8
---

Bu günlük Verdin’i şekillendiren tasarım seçimlerini alındıkları sırayla kaydeder; böylece kodu değiştirmeyi önermeden önce neden öyle olduğunu görebilirsiniz. Girdiler, kilometre taşı adları dâhil yazıldıkları gibi tutulur (M2–M4, ilk sürümlerden önceki kilometre taşlarıdır); 28’in 1 için yaptığı gibi sonraki bir girdi öncekini inceltebilir. Aksi hâlde birinin koddan tersine mühendislikle çıkarması gerekecek bir karar verdiğinizde yeni bir satır ekleyin.

| # | Karar | Sonuç | Gerekçe |
|---|---|---|---|
| 1 | Bileşenler: JSON mu tablolar mı | **JSON sütunu** ([depolama](/tr/internals/storage/#bileşenler-ve-dinamik-bölgeler-bir-json-sütunu)) | Daha az join, basit yayınlama/sürümleme, daha basit migrasyonlar. Tekrarlanabilir bileşenler üzerinde filtreleme nadirdir; daha sonra JSON fonksiyonlarıyla eklenebilir |
| 2 | `decimal` JSON kodlaması | Varsayılan olarak **sayı**, isteğe bağlı `api.decimal_as_string` | Strapi uyumluluğu benimsemeyi en üst düzeye çıkarır; gerektiğinde kesin değerler kullanılabilir |
| 3 | Admin formları | **Signal Forms** | Önce signal’lara dayalı, zoneless bir admin’e uyar; şemadan türetilen dinamik form ağaçları |
| 4 | Dil | Kod, dokümantasyon ve commit’ler için **İngilizce** | Açık kaynak erişimi |
| 5 | Strapi REST uyumluluğu | **Aynı parametreler ve yanıt biçimi**; yalnızca Verdin’e özgü uzantılar `actions/` altında | Frontend’ler en az değişiklikle geçer |
| 6 | Admin JWT algoritması | HS256 | Tek secret, basit; harici doğrulayıcılar ortaya çıkarsa EdDSA |
| 7 | Belge kimlikleri | ULID (26 karakter) | Sıralanabilir ve taşınabilir; Strapi’nin kendi kimlikleri opak 24 karakterlik string’lerdir, istemciler onları asla ayrıştırmaz |
| 8 | Anlık görüntü içeriği | Şema değil, fiziksel model | Sonraki sürümler değişmemiş bir şemadan yeni tablolar türetebilir |
| 9 | Nitelik nullable’lığı | Her zaman nullable; `required` yayınlamada denetlenir | Taslaklar eksik olabilir (Strapi v5 davranışı); zorunlu alan eklemek güvenlidir |
| 10 | `unique` uygulaması | `(column, locale, publication_state)` üzerinde benzersiz indeks | Yarış koşulu yok; taslaklar ve yayınlanmış sürümleri değerleri paylaşır |
| 11 | Durum sütunu adı | `publication_state` | `state` yaygın bir nitelik adıdır |
| 12 | Ayrılmış SQL kelimeleri | Tanımlayıcıları her zaman tırnakla | Nitelik adları için keyfi bir engel listesi yok |
| 13 | DML oluşturma | `sea-query` yerine kendi oluşturucu | Dialect başına ayrıntılar baskındır (tipli NULL’lar, collation’lar, SQLite biçimleri); bir soyutlama eksik |
| 14 | `?status=draft` olmadan yazmalar | Yayınla (Strapi v5 REST davranışı) | Mevcut istemciler için doğrudan uyumluluk |
| 15 | Metin karşılaştırması | Her motorda varsayılan olarak tam; büyük/küçük harfe duyarsızlık için `…i` operatörleri | MySQL’de PostgreSQL’dekiyle aynı sonuçlar |
| 16 | Geçici erişim denetimi (M2–M3) | M4’te kaldırılan `[api].open_access` anahtarı | İzinler var olana kadar varsayılan olarak güvenli |
| 17 | "Hedef tek bir belgeye aittir" | Durum başına, hedef taşınarak uygulanır | Benzersiz bir indeks, bir taslak ile yayınlanmış sürümünün bir hedefi paylaşmasını yasaklardı |
| 18 | Ters (`mappedBy`) taraflar | Salt okunur | Onlar üzerinden yazmak taslak ve yayınlamayla belirsizdir (hangi sahip sürüm?) |
| 19 | Bağlantı konumları | Her yazmada 1..n olarak yeniden numaralandırılır | Float tükenmesi yok; listeler küçüktür |
| 20 | Bağlantı tablosu satırları | Bir `id` birincil anahtarı tutulur | Migrasyon motoru ve SQLite yeniden oluşturmaları için tek tip tablolar |
| 21 | JWT kütüphanesi | Kendi HS256’sı (HMAC-SHA256, sabit zamanlı doğrulama, `alg` sabitlenmiş) | `jsonwebtoken` 11, RSA’yı çeken bir kripto backend’i gerektirir |
| 22 | Platform tabloları | İçerik modeliyle birlikte türetilir | Her şey için tek bir migrasyon mekanizması |
| 23 | Yenileme token’ının yeniden kullanımı | Tüm aileyi iptal et, tolerans penceresi yok | Basit ve katı; admin yeniden oturum açar |
| 24 | İçerik API’si üzerinden taslaklar | Ayrı `readDrafts` yetkisi | Yayınlanmış içeriği okuyan token’lar taslak sızdırmaz |
| 25 | Oluşturucu uygulama sırası | Migre et, sonra dosyaları yaz, sonra uygulamayı sıcak değiştir | Başarısız bir migrasyon dosyalara ve çalışan uygulamaya dokunmaz |
| 26 | Admin yazmaları | Yalnızca taslakları kaydet; yayınlama açık bir eylemdir | Editörlerin beklentileriyle eşleşir; içerik API’si Strapi’nin varsayılan olarak yayınlamasını korur |
| 27 | Admin çalışma zamanı yapılandırması | Satır içi betik değil, `<meta>` etiketi | CSP’yi `unsafe-inline` betiklerden arındırır |
| 28 | Bileşen alanları üzerinde filtreler | Dialect başına JSON yol operatörleri (`#>>`, `JSON_VALUE`, `json_extract`); tekrarlanabilir bileşenler ve dinamik bölgeler için dizi öğeleri üzerinde `EXISTS` (0.8) | Dinamik bölgeler yalnızca `__component` ile: öğelerinin farklı alanları vardır |
| 29 | Admin i18n | Düz JSON kataloglarıyla (`admin/public/i18n`) Transloco ve FormatJS (özel bir transpiler) aracılığıyla ICU MessageFormat, küçük bir `I18n` cephesinin arkasında; Angular’ın derleme zamanı i18n’i değil | Çalışma zamanında dil değiştirme; Weblate/Crowdin için standart dosyalar; FormatJS mesajları yorumlar, bu yüzden katı CSP `unsafe-eval` gerektirmez (`@messageformat/core` `new Function` ile derler); anahtarlar `en.json`’dan tiplenir, eksiksizlik `npm run i18n:check` ile denetlenir |
| 30 | Haftanın başlangıcı | Tarayıcının bölgesel etiketinin `Intl.Locale#getWeekInfo`’su (en-GB ≠ en-US), bölge tablosu yedeği, kullanıcı geçersiz kılması | Arayüz dili paylaşılsa bile her kullanıcının bölgesini izler |
| 31 | Pano yerleşimi depolaması | `vd_admin_users` üzerinde kullanıcı başına JSON `preferences` sütunu (≤ 64 KiB) | Kullanıcıyı tarayıcılar arasında izler; tema ve dil `localStorage`’da kalır çünkü oturum açmadan önce uygulanırlar |
| 32 | Yenileme çerezi `Secure` varsayılanı | `start`’ta açık, `dev`’de kapalı, geçersiz kılınabilir | Düz HTTP üzerinden `verdin dev` her tarayıcıda çalışır; üretim katı kalır |
| 33 | Release profili | Thin LTO, 1 codegen unit, strip edilmiş; unwinding korunur | Panic’e düşen bir işleyici sunucuyu çökertmemelidir |
| 34 | "Görülmemiş" belgeler | Kullanıcı başına `vd_document_views` satırları; bir belge değiştiğinde editör dışındaki herkes için silinir; SQL’de `NOT EXISTS` ile filtrelenir | Sayfalama ve sayımlar kesin kalır; satır başına karşılaştırılacak zaman damgası yok |
| 35 | Oylar ve anketler | Yalnızca admin’e özel iş birliği tabloları (`vd_document_votes`, `vd_polls`, `vd_poll_votes`), herhangi bir içerik tipi | Her şemada oy alanları modellemeden öneri kutuları ve ekip kararları |
| 36 | Medya depolama | Yerel ve S3 için `object_store` | Tek kod yolu; akışlı multipart yüklemeler; geliştirme yığınında ve CI’da RustFS |
| 37 | Medya bağlantıları | İlişkiler gibi alan başına bağlantı tabloları | İlişkilerle aynı taslak/yayınlama semantiği; cascade’ler bağlantıları tutarlı tutar |
| 38 | Yerleşik izin yükseltmeleri | `vd_settings` sürüm işaretçisi, eklemeler bir kez uygulanır | Mevcut kurulumlar, bir admin’in sonraki düzenlemelerini geri almadan yeni izinler kazanır |
| 39 | Çalışma zamanı özellikleri | `verdin-api` içinde katalog, `vd_settings` içinde anahtarlar (`features`), her modda uygulamanın yerinde yeniden oluşturulması (ArcSwap) | Yeniden başlatmadan Strapi benzeri eklenti anahtarları; kullanılamayan özellikler planlanan sürümleriyle listelenir |
| 40 | API başvurusu arayüzü | `{api}/docs` adresinde Scalar (`scalar_api_reference`, paket gömülü), yalnızca belge herkese açıkken; CSP satır içi başlatmasına hash ile izin verir | Kendi sunucunuzda barındırılır (CDN, font, AI ajanı veya telemetri yok); belge varsayılan olarak yalnızca token ile kalır |
| 41 | GraphQL | Uygulamayla birlikte oluşturulan `async-graphql` dinamik şeması; argümanlar ve seçimler REST parametre ağacına çevrilir ve aynı sorgu ayrıştırıcısıyla ayrıştırılır | REST ve GraphQL genelinde filtreler, sayfalama, populate, doğrulama ve izinler için tek kural kümesi; seçimden türetilen populate toplu yüklemeyi korur |
| 42 | Belge olayları | Document Service üzerinde commit’ten sonra çağrılan dinleyiciler | Yan etkiler (görüldü işaretleri, gelecekteki webhook’lar) işleyici başına hook olmadan her API’ye uygulanır |
