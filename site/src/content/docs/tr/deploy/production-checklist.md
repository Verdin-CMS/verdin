---
title: Üretim kontrol listesi
description: Bir Verdin projesi gerçek trafik almadan önce ayarlanması gerekenler — secret’lar, veritabanı, migrasyonlar, URL’ler, proxy’ler, çerezler, CORS, medya depolama, e-posta, yedekler ve izleme.
sidebar:
  order: 1
---

Bir Verdin projesini gerçek kullanıcıların önüne koymadan önce bu listeyi gözden geçirin. Her
madde onu açıklayan sayfaya bağlanır. Platform sayfaları ([Docker](/tr/deploy/docker/),
[Fly.io](/tr/deploy/fly/), [Render](/tr/deploy/render/), [Railway](/tr/deploy/railway/),
[Kubernetes](/tr/deploy/kubernetes/)) bu ayarları mümkün olduğunca sizin için uygular.

## Üretim sunucusunu çalıştırın

- [ ] **`verdin dev` değil, `verdin start` kullanın.** `dev`, içerik tipi oluşturucusunun şema
      dosyalarını yeniden yazmasına izin verir, her değişiklikte migrasyon uygular ve yerel
      çalışma için çerez ve webhook kurallarını gevşetir. Şemayı geliştirmede değiştirin,
      dosyaları commit edin ve dağıtın.
- [ ] **Migrasyonları dağıtım sırasında uygulayın.** `verdin start`, veritabanı şemanın
      gerisindeyken çalışmayı reddeder. `verdin start --migrate` önce bekleyen *güvenli*
      adımları uygular (Docker imajının varsayılan komutu budur). Riskli veya yıkıcı adımlar
      (tip değişiklikleri, yeni benzersiz kısıtlar, kaldırılan sütunlar), sizin bir kez
      çalıştıracağınız `verdin migrate apply --allow risky|destructive` gerektirir. Bkz.
      [Şema migrasyonları](/tr/concepts/schema-migrations/).
- [ ] **Şemayı sunucuyla birlikte gönderin.** `schema/` dizinini salt okunur bağlayın ya da
      imajınıza yerleştirin; böylece çalışan şey commit ettiğiniz şey olur.

## Secret’lar

- [ ] **Zorunlu iki secret’ı `verdin secrets` ile bir kez oluşturun** ve platformunuzun secret
      deposunda saklayın: `VERDIN_ADMIN_JWT_SECRET` oturum token’larını imzalar,
      `VERDIN_TOKEN_PEPPER` ise API token’larının ve saklanan diğer secret’ların hash’lerini
      anahtarlar. Bunlardan biri eksikse veya 32 bayttan kısaysa `verdin start` başarısız olur.
      Secret’lar yalnızca ortamdan okunur, asla `verdin.toml`’dan okunmaz.
- [ ] **Onları sabit tutun.** `VERDIN_TOKEN_PEPPER`’ı değiştirmek tüm API token’larının,
      ayrıca admin’lerin kimlik doğrulayıcı uygulama kodlarının ve kurtarma kodlarının
      çalışmamasına yol açar. `VERDIN_ADMIN_JWT_SECRET`’ı değiştirmek admin’lerin ve son
      kullanıcıların kısa ömürlü erişim token’larını, açık önizleme bağlantılarını ve devam
      eden OAuth oturum açmalarını geçersiz kılar (yönetim paneli ve yenileme token’ı olan
      istemciler bunları kendiliğinden yeniler). Bir projenin her örneğinin aynı değerlere
      ihtiyacı vardır.
- [ ] Kullandığınız diğer secret’ları da ortama koyun: `VERDIN_EMAIL_SMTP_PASSWORD` veya
      `VERDIN_EMAIL_API_KEY`, `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`,
      `VERDIN_METRICS_TOKEN`, `VERDIN_SSO_<ID>_SECRET`, `VERDIN_IMAGE_SECRET`. Tam liste
      [yapılandırma başvurusundadır](/tr/reference/configuration/).

## Veritabanı

- [ ] **Motoru seçin.** PostgreSQL (14 veya sonrası) olağan seçimdir ve
      [birden fazla örnek](/tr/deploy/scaling/) çalıştıracaksanız seçilmesi gerekendir. MySQL
      8.4+ ve MariaDB 10.11+ aynı şekilde çalışır. SQLite, kalıcı disk üzerinde tek bir örneğe
      uygundur.
- [ ] **`VERDIN_DATABASE_URL`’i ayarlayın**: `postgres://…`, `mysql://…` (MySQL ve MariaDB)
      veya `sqlite:///data/verdin.db`. TLS gerektiren PostgreSQL sunucuları için
      `?sslmode=require` ekleyin.
- [ ] **Havuzu boyutlandırın.** Her örnek en fazla `[database].pool_max` (10) bağlantı açar.
      `örnekler × pool_max` değerini sunucunun bağlantı sınırının altında tutun.

## URL’ler, proxy’ler ve çerezler

- [ ] **HTTPS üzerinden sunun.** Verdin düz HTTP konuşur; TLS’i bir reverse proxy’de, yük
      dengeleyicide veya platformunuzun edge’inde sonlandırın.
- [ ] **`[server].public_url`’i** (`VERDIN_SERVER__PUBLIC_URL`) tarayıcıların kullandığı
      adrese ayarlayın; örneğin `https://cms.example.com`. E-postalardaki bağlantılar, SSO
      callback’leri, günlük özet ve geçiş anahtarları buna bağlıdır; geçiş anahtarları onun
      host’una bağlanır.
- [ ] **`[server].trusted_proxies`’i** reverse proxy’lerinizin adreslerine (IP’ler veya CIDR
      aralıkları) ayarlayın. Verdin istemci adresini ancak o zaman `X-Forwarded-For`’dan
      okur; bu olmadan proxy arkasındaki her istemci, hız sınırları ve denetim kayıtları için
      tek bir adresi paylaşır.
- [ ] **Güvenli çerezleri açık tutun.** `verdin start` içinde admin yenileme çerezi varsayılan
      olarak `Secure`’dur. `[admin].secure_cookies`’i ayarlamadan bırakın; üretimde `false`
      yapmak başlangıçta bir uyarı yazar.

## API’ler

- [ ] **Yalnızca herkesin ihtiyaç duyduğunu verin.** İçerik API’si, herkese açık izinler
      verene (**Ayarlar → Herkese açık erişim**) veya API token’ları oluşturana kadar
      kapalıdır. Bkz. [İzinler](/tr/concepts/permissions/).
- [ ] Başka bir origin’deki bir tarayıcı içerik API’sini veya GraphQL’i çağırıyorsa
      **`[api].cors_origins`’i ayarlayın**; örneğin `["https://www.example.com"]`. Bu olmadan
      onları tarayıcıdan yalnızca aynı origin’deki sayfalar çağırabilir. Admin API asla
      çapraz origin isteklere yanıt vermez.
- [ ] Anonim trafik için **hız sınırlarını değerlendirin**: `[api].public_rate_limit` ve
      `[api].token_rate_limit` (dakika başına istek; varsayılan `0` sınırsızdır).

## Medya

- [ ] **Yüklemeleri yeniden dağıtımdan etkilenmeyecekleri bir yerde saklayın.** Varsayılan
      yerel sağlayıcı diske yazar: ona kalıcı bir volume verin ya da S3 sağlayıcısını (AWS S3,
      Cloudflare R2, Backblaze B2, MinIO, Tigris…) kullanın. Geçici diskleri olan
      platformlarda ve birden fazla örnekle S3 kullanın. Bkz. [Medya](/tr/concepts/media/).

## E-posta

- [ ] **Gerçek bir sağlayıcı yapılandırın.** Varsayılan `[email].provider = "log"`
      e-postaları günlüğe yazar ve `verdin start` bu konuda uyarır. Davetler, parola
      sıfırlamaları, son kullanıcı onayları, yorum bahsetmeleri ve özet, `smtp`, `resend` veya
      `postmark` ile sağlayıcınızın kabul ettiği bir adrese ayarlanmış `[email].from`
      gerektirir.

## Yedekler ve izleme

- [ ] **Veritabanını ve medya depolamayı** bir takvime göre **yedekleyin** ve bir geri
      yükleme deneyin. Bkz. [Yedekler](/tr/deploy/backups/).
- [ ] **Sağlık denetimlerini `/_ready`’ye**, canlılık denetimlerini `/_health`’e yönlendirin.
- [ ] **JSON olarak günlüğe yazın** (`[log].format = "json"`, Docker imajının varsayılanı) ve
      standart hatayı toplayın.
- [ ] Prometheus kullanıyorsanız bir `VERDIN_METRICS_TOKEN` ile **`/_metrics`’i scrape edin**.
      Bkz. [İzleme](/tr/deploy/monitoring/).

## Canlıya almadan önce

- [ ] İlk başlatmadan hemen sonra ilk admin’i kendiniz kaydedin: bir admin var olana kadar
      `/admin/`’e ulaşan herkes Super Admin olarak kaydolabilir. Onu komut satırından
      `verdin admin create --email …` ile de oluşturabilirsiniz.
- [ ] [Güvenlik modelini](/tr/deploy/security/) gözden geçirin ve Super Admin’ler için
      [iki adımlı doğrulamayı](/tr/guides/auth/two-factor/) açın.
