---
title: Yedekler
description: Bir Verdin projesini veritabanı dökümleri ve medya depolama kopyalarıyla yedekleyin ya da verdin export ve verdin import verdin ile taşıyın.
sidebar:
  order: 9
---

Bir Verdin projesinin verileri iki yerde bulunur: **veritabanı** (içerik, admin’ler, roller,
token’lar, ayarlar, geçmiş, denetim kayıtları) ve **medya depolama** (medya kütüphanesinin
diskteki veya bir bucket’taki dosyaları). Şema dosyaları deponuzdadır. Her iki depoyu da
yedekleyin; `verdin export` içeriğin taşınabilir bir arşivini ekler.

| Yöntem | İçerdiği | Kullanım amacı |
| --- | --- | --- |
| Veritabanı dökümü + medya kopyası | Her şey | Aynı projenin felaket kurtarması |
| `verdin export` | Şema, diller, medya, her kaydın her sürümü | İçeriği başka bir örneğe veya veritabanı motoruna taşıma; ek, taşınabilir bir kopya |

## Veritabanı dökümleri

Veritabanınızın kendi araçlarını ya da sağlayıcınızın otomatik yedeklerini kullanın:

```sh frame="terminal"
# PostgreSQL
pg_dump --format=custom --file=verdin-$(date +%F).dump "$VERDIN_DATABASE_URL"

# MySQL / MariaDB
mysqldump --single-transaction --routines -h <host> -u <user> -p <database> > verdin-$(date +%F).sql

# SQLite: sunucu çalışırken tutarlı bir kopya
sqlite3 /data/verdin.db ".backup '/backups/verdin-$(date +%F).db'"
```

Canlı bir SQLite dosyasını `cp` ile kopyalamayın: `.backup` kullanın (veya önce sunucuyu
durdurun).

Bir döküm parola hash’lerini, API token hash’lerini ve private alanları içerir. Onu şifreleyin
ve koruduğu sunuculardan uzak tutun. Geri yüklemek için aynı `VERDIN_TOKEN_PEPPER` ve
`VERDIN_ADMIN_JWT_SECRET` değerlerine de ihtiyacınız vardır: pepper olmadan API token’ları ve
admin’lerin kimlik doğrulayıcı uygulama kodları çalışmaz.

## Medya depolama

- **Yerel sağlayıcı**: yükleme dizinini (`[upload].provider.dir`, Docker imajında
  `/data/uploads`) olağan dosya yedeğinizle, dökümün referans verdiği hiçbir dosya eksik
  kalmasın diye veritabanı dökümünden sonra kopyalayın.
- **S3 sağlayıcısı**: bucket’ta sürümlemeyi veya replikasyonu açın ya da sağlayıcınızın
  araçlarıyla kopyalayın.

Görsel dönüştürme önbelleği ve arama dizini yeniden oluşturulabilir ve yedek gerektirmez.

## `verdin export`

`verdin export` bir projenin şemasını, içeriğini ve medyasını tek bir `.tar.gz` dosyasına
yazar; `verdin import verdin` ise onu herhangi bir veritabanı motorunda, aynı projeye veya başka
bir örneğe geri yükler.

```sh frame="terminal"
verdin export backup-2026-09-28.tar.gz            # şema, diller, medya ve kayıtlar
verdin export content-only.tar.gz --no-media      # medya dosyaları olmadan
verdin import verdin backup-2026-09-28.tar.gz     # bu projeye
```

Bunları projenin yapılandırmasıyla (sunucuyla aynı `verdin.toml` ve ortam) çalıştırın. Bir
container’da: `docker compose exec verdin verdin export /data/backup.tar.gz`.

### Neler dâhildir

- **Şema dosyaları**, oldukları gibi.
- **Diller.** Boş bir proje, varsayılan dâhil hepsini alır. Zaten dilleri olan bir proje
  yalnızca eksik olanları alır.
- **Medya klasörleri ve dosyaları**, duyarlı (responsive) formatlarıyla. Dosyalar
  `documentId`’lerini korur; sayısal kimlikleri değişir.
- **Her kaydın her sürümü**: taslaklar, yayınlanmış sürümler ve tüm diller; tarihleri,
  ilişkileri (`documentId` ile) ve medyasıyla, bileşenlerin ve dinamik bölgelerin içindeki
  ilişkiler ve medya dâhil. Private alanlar ve parola hash’leri dâhildir.

**Dâhil olmayanlar**: admin kullanıcılar, roller, API token’ları, webhook’lar, özellik ayarları,
inceleme iş akışları ve sürümler. Bunları hedefte yeniden oluşturun ya da bunun yerine bir
veritabanı dökümünü geri yükleyin.

:::caution
Bir dışa aktarma private alanları ve parola hash’lerini içerir. Onu bir veritabanı dökümü gibi
saklayın.
:::

### İçe aktarma

1. İçe aktarma şema dosyalarını yazar ve veritabanını yalnızca güvenli adımlarla migre eder.
2. Zaten var olan ve farklı olan şema dosyaları, `--force` vermediğiniz sürece onu durdurur.
3. Zaten kayıtları olan içerik tipleri de `--force` vermediğiniz sürece onu durdurur; bu
   durumda kayıtlar mevcut olanların yanına eklenir.
4. İçe aktarılan belgeler `documentId`’lerini korur; bu yüzden aynı belgelere zaten sahip olan
   bir projeye içe aktarma başarısız olur.

İçe aktarma webhook’ları veya eklenti hook’larını tetiklemez ve geçmiş yazmaz.

### Arşiv biçimi

Gzip ile sıkıştırılmış bir tar arşivi:

| Yol | İçerik |
| --- | --- |
| `manifest.json` | `format: "verdin-export"`, biçim sürümü, Verdin sürümü, içerik tipi başına sürümler |
| `schema/…` | Şema dosyaları |
| `locales.json` | `{ default, locales: [{ code, name }] }` |
| `folders.json`, `files.jsonl` | Medya klasörleri ve dosyaları, satır başına bir JSON nesnesi |
| `assets/{hash}{ext}` | Dosyaların ve formatlarının saklanan nesneleri |
| `entries/{uid}.jsonl` | Satır başına bir sürüm: `documentId`, `locale`, `published`, tarihler, `data`, `relations`, `media` |

Bunun yerine bir Strapi projesini getirmek için bkz.
[Strapi’den geçiş](/tr/migrate/from-strapi/).

## Geri yüklemelerinizi test edin

Ara sıra geçici bir veritabanına geri yükleyin, Verdin’i onun üzerinde `verdin start` ile
başlatın ve oturum açıp kayıtları ve medyayı okuyabildiğinizi denetleyin.
