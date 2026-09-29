---
title: Verdin nedir
description: Verdin, Rust ile yazılmış, Strapi v5 uyumlu içerik API’leri ve bir yönetim paneli tek bir ikili dosyada sunan açık kaynak bir headless CMS’tir.
sidebar:
  order: 1
  label: Giriş
---

Verdin, Rust ile yazılmış açık kaynak bir headless CMS’tir. İçerik tiplerini modellersiniz,
editörleriniz bir yönetim panelinde yazar ve yayınlar, siteleriniz ve uygulamalarınız içeriği bir
REST veya GraphQL API üzerinden okur. Verdin sayfa oluşturmaz: bunu frontend’iniz yapar.

[Strapi v5](https://strapi.io)’in yeniden yazımıdır: şema biçimi ve içerik API’si aynı yapıdadır;
böylece bir Strapi projesi ve frontend’i az değişiklikle taşınabilir.

## Kimler için

- Tek bir süreç olarak çalıştırabilecekleri, içerik modelini git’te tutabilecekleri ve herhangi bir
  frontend’den (Astro, Next.js, bir mobil uygulama) okuyabilecekleri bir CMS isteyen, **site veya
  uygulama geliştiren geliştiriciler**.
- Aynı API’yi daha küçük bir ayak iziyle isteyen ya da Strapi’nin ücretli planlara ayırdığı
  özelliklere ihtiyaç duyan **Strapi kullanan ekipler**. Verdin’in enterprise sürümü yoktur: SSO,
  denetim kayıtları, inceleme iş akışları ve sürümler açık kaynak projenin parçasıdır.
- 18 dilde kullanılabilen bir yönetim panelinde taslaklar, yayınlama, geçmiş ve önizlemeler elde
  eden **editörler**.

## Kutuda neler var

Tek bir çalıştırılabilir dosya, `verdin`, sunucu, komut satırı aracı ve yönetim panelidir. Üretimde
Node.js çalışma zamanı ve `node_modules` yoktur.

| Alan | Elde ettikleriniz |
| --- | --- |
| Veritabanları | Aynı test paketiyle kapsanan PostgreSQL 14+, MySQL 8.4+, MariaDB 10.11+ ve SQLite. |
| İçerik modeli | Koleksiyon tipleri, tekil tipler, bileşenler, dinamik bölgeler, ilişkiler, medya, Markdown veya Strapi’nin blocks biçiminde zengin metin. Şema projenizdeki JSON dosyalarıdır. |
| Şema değişiklikleri | Her değişiklik bir risk düzeyi ve tam SQL ile bir migrasyon planına dönüşür. Yıkıcı adımlar yalnızca siz izin verdiğinizde çalışır. |
| API’ler | Strapi v5 parametreleriyle (`filters`, `populate`, `sort`, `pagination`) `/api` altında REST, isteğe bağlı bir GraphQL uç noktası, bir OpenAPI belgesi ve tipli bir TypeScript istemcisi. |
| Düzenleme | Taslak ve yayınlama, yerelleştirilmiş içerik, içerik geçmişi, sürümler, inceleme iş akışları, yorumlar ve görevler, canlı presence, kendi sitenizde önizleme ve görsel düzenleme. |
| Erişim | Alanlara ve dillere kadar inen admin rolleri, API token’ları, herkese açık erişim yetkileri, OpenID Connect ile SSO, geçiş anahtarlarıyla iki adımlı oturum açma, denetim kayıtları. |
| Site özellikleri | Tam metin araması, site haritası, yönlendirmeler, menüler ve formlar, webhook’lar, gerçek zamanlı güncellemeler. |
| Genişletme | Yazmalara bağlanan, rotalar ve görevler ekleyen, admin widget’ları ve özel alanlar getiren, bildirdikleri yeteneklerle sınırlı WebAssembly eklentileri. |

## Strapi v5 ile ilişkisi

**Aynı olanlar:**

- Şema dosyaları Strapi’nin biçimini kullanır: `schema/content-types/<singularName>.json` ve
  `schema/components/<category>/<name>.json`.
- REST içerik API’si: rotalar, `documentId` ile düz yanıt biçimi, sorgu parametreleri ve
  operatörler, yazma semantiği (bir `POST` veya `PUT`, `?status=draft` geçmediğiniz sürece
  yayınlar), hata gövdeleri.
- GraphQL şeması Strapi v5’in GraphQL eklentisi gibi şekillenir.
- Son kullanıcılar (kayıt, oturum açma, OAuth, roller) `users-permissions` API’sini izler.

**Farklı olanlar:**

- **Şema değişiklikleri planlanmış migrasyonlardır.** Verdin şema dosyalarını veritabanıyla
  karşılaştırır ve adımları çalıştırmadan önce size gösterir. `verdin start`, veritabanı şemanın
  gerisindeyken çalışmayı reddeder.
- **İçerik tipi oluşturucusu yalnızca geliştirme modunda çalışır.** Üretimde şema deponuzdan gelir.
- **Eklentiler JavaScript değil, WebAssembly’dir.** Strapi eklentileri ve `src/` içindeki özel
  controller’lar, servisler veya lifecycle dosyaları Verdin’de çalışmaz.
- **Veritabanı Strapi ile paylaşılmaz.** Bir Strapi projesini, her belgeye yeni bir kimlik veren
  `verdin import strapi` ile getirirsiniz.
- **REST üzerinde birkaç ek**: yayınlama ve yayından kaldırma eylemleri
  (`POST /api/<route>/<documentId>/actions/publish`) ve populate edilen bir bileşen, iç içe
  bileşenler dâhil bütün olarak döner.

[Strapi ile uyumluluk](/tr/migrate/compatibility/) farkları ayrıntılı olarak listeler.

## Ne zaman kullanılmamalı

- **Strapi eklentilerine veya JavaScript’teki özel sunucu koduna bağımlısanız.** Verdin bunları
  çalıştıramaz; onları WebAssembly eklentileri olarak yeniden yazmanız veya mantığı başka bir yere
  taşımanız gerekir.
- **Kararlı bir 1.0’a ihtiyacınız varsa.** Verdin 0.10’dadır: minor sürümler hâlâ yapılandırmayı ve
  davranışı değiştirebilir. Her birinden önce [Yükseltme](/tr/migrate/upgrading/) sayfasını okuyun.
- **CMS’in sayfalarınızı oluşturmasını istiyorsanız.** Verdin headless’tır; onu bir frontend
  framework’ü veya bir statik site üreteciyle eşleştirin.
- **Yönetilen bir servis istiyorsanız.** Verdin kendi sunucunuzda barındırılır: ikili dosyayı veya
  Docker imajını kendi altyapınızda çalıştırırsınız.

## Sonraki adımlar

- [Hızlı başlangıç](/tr/start/quickstart/): Verdin’i çalıştırın ve ilk kaydınızı API’den okuyun.
- [Eğitim: Astro ile bir blog](/tr/start/tutorial-astro/) veya
  [Next.js ile](/tr/start/tutorial-nextjs/): örnek bloga karşı bir frontend geliştirin.
- [İçerik modeli](/tr/concepts/content-model/): içerik tipleri, alanlar ve nasıl saklandıkları.
- [Bir Strapi projesini içe aktarma](/tr/migrate/from-strapi/): mevcut bir projeyi getirin.
