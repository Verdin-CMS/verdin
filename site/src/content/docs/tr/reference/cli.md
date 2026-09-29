---
title: Komut satırı başvurusu
description: verdin ikili dosyasının her komutu, alt komutu ve bayrağı; neleri okuduğu, yazdığı ve yazdırdığıyla.
sidebar:
  order: 2
  label: Komut satırı
---

<!-- Written from crates/verdin/src/cli.rs and crates/verdin/src/new.rs. `npm run check-cli`
(site/scripts/check-cli.mjs) fails when a subcommand or flag in cli.rs is missing here. -->

`verdin` tek ikili dosyadır: proje oluşturur, sunucuyu çalıştırır, migrasyonları uygular, admin
kullanıcıları yönetir ve içeriği içeri ve dışarı taşır. Bu sayfa her komutu ve bayrağı listeler.

```text title="Terminal"
verdin [OPTIONS] <COMMAND>
```

| Komut | Yaptığı |
| --- | --- |
| [`verdin new`](#verdin-new) | Bir proje dizini oluşturur. |
| [`verdin dev`](#verdin-dev) | Sunucuyu geliştirme modunda çalıştırır. |
| [`verdin start`](#verdin-start) | Sunucuyu üretim modunda çalıştırır. |
| [`verdin schema check`](#verdin-schema-check) | Şema dosyalarını doğrular. |
| [`verdin migrate plan`](#verdin-migrate-plan) | Migrasyon adımlarını ve SQL’lerini gösterir. |
| [`verdin migrate apply`](#verdin-migrate-apply) | Migrasyon adımlarını uygular. |
| [`verdin admin create`](#verdin-admin-create) | Bir Super Admin oluşturur. |
| [`verdin admin reset-password`](#verdin-admin-reset-password) | Bir admin’in parolasını belirler. |
| [`verdin types`](#verdin-types) | İçerik API’sinin TypeScript tanımlarını üretir. |
| [`verdin import strapi`](#verdin-import-strapi) | Bir Strapi dışa aktarımını içe aktarır. |
| [`verdin import verdin`](#verdin-import-verdin) | Bir Verdin dışa aktarımını içe aktarır. |
| [`verdin export`](#verdin-export) | Projeyi bir `.tar.gz` arşivine yazar. |
| [`verdin healthcheck`](#verdin-healthcheck) | Yerel sunucunun yanıt verdiğini denetler. |
| [`verdin secrets`](#verdin-secrets) | Yeni secret’lar yazdırır. |
| [`verdin version`](#verdin-version) | Sürümü yazdırır. |

## Genel seçenekler

| Seçenek | Varsayılan | Açıklama |
| --- | --- | --- |
| `-c, --config <CONFIG>` | `verdin.toml` | Projenin yapılandırma dosyası. `VERDIN_CONFIG`’ten de okunur. Proje kökü dosyanın dizinidir: şema, eklentiler, yüklemeler ve göreli SQLite yolları ona göre çözümlenir. |
| `-h, --help` | | Komutun yardımını yazdırır. |
| `-V, --version` | | Sürümü yazdırır. |

`verdin help <COMMAND>`, `--help` ile aynı yardımı yazdırır.

`new`, `secrets` ve `version` dışındaki her komut önce projeyi yükler:

1. Varsa yapılandırma dosyasının yanındaki `.env` dosyasını okur. Ortamda zaten ayarlanmış
   değişkenler üstün gelir.
2. `verdin.toml`’u (isteğe bağlı) ve `VERDIN_*` geçersiz kılmalarını yükler. Bkz.
   [yapılandırma başvurusu](/tr/reference/configuration/).
3. `[log]` ve `RUST_LOG` ile standart hataya günlük yazmaya başlar.

Veritabanını açan komutlar `VERDIN_DATABASE_URL` veya `[database].url` gerektirir. Admin
hesaplarına dokunan veya sunucuyu çalıştıran komutlar ayrıca `VERDIN_ADMIN_JWT_SECRET` ve
`VERDIN_TOKEN_PEPPER` gerektirir.

## `verdin new`

```text title="Terminal"
verdin new <DIR> [--database <DATABASE>]
```

Var olmaması veya boş olması gereken `DIR` içinde bir proje oluşturur:

| Dosya | İçerik |
| --- | --- |
| `verdin.toml` | Varsayılanlarıyla `[server]`, `[api]` ve `[admin]`. |
| `.env` | `VERDIN_DATABASE_URL` ile yeni `VERDIN_ADMIN_JWT_SECRET` ve `VERDIN_TOKEN_PEPPER`. Yalnızca sizin okuyabileceğiniz şekilde (Unix’te mod `0600`). |
| `.gitignore` | `.env`, `data/`, SQLite dosyaları ve `.cache/`. |
| `schema/content-types/`, `schema/components/` | Boş şema dizinleri. |
| `data/` | SQLite veritabanı için (yalnızca SQLite). |

| Argüman veya seçenek | Varsayılan | Açıklama |
| --- | --- | --- |
| `<DIR>` | | Oluşturulacak dizin. |
| `--database <DATABASE>` | `sqlite` | `.env`’nin işaret ettiği veritabanı: `sqlite`, `postgres`, `mysql` veya `mariadb`. |

`sqlite` ile URL `sqlite://data/verdin.db`’dir. Diğerleriyle `verdin` kullanıcısı, `change-me`
parolası ve dizinin adını taşıyan bir veritabanı (küçük harfler, rakamlar ve `_`) içeren yerel bir
sunucu URL’sidir: başlatmadan önce düzenleyin.

```text title="Terminal"
$ verdin new blog --database postgres
created blog

  cd blog
  verdin dev

then open http://localhost:1337/admin/ to register the first admin
```

## `verdin dev`

```text title="Terminal"
verdin dev
```

Sunucuyu geliştirme modunda çalıştırır. `verdin start` ile karşılaştırıldığında:

- Risk düzeyi `safe` olan bekleyen migrasyonlar başlangıçta uygulanır. Daha riskli adımlar sunucuyu
  durdurur; onları [`verdin migrate plan`](#verdin-migrate-plan) ile gözden geçirin.
- Yönetim panelinin **İçerik Tipi Oluşturucu**’su şema dosyalarını düzenler ve sunucu şemayı yeniden
  yükler.
- Yenileme çerezi `Secure` olarak işaretlenmez (`[admin].secure_cookies` aksini söylemedikçe);
  böylece düz HTTP üzerinden oturum açabilirsiniz.
- Webhook’lar ve dağıtım hedefleri loopback ve özel adresleri çağırabilir
  (`[webhooks].allow_private_networks` aksini söylemedikçe).

Ctrl+C veya `SIGTERM` ile durur.

## `verdin start`

```text title="Terminal"
verdin start [--migrate]
```

Sunucuyu üretim modunda çalıştırır. Veritabanı şemanın gerisindeyken başlamayı reddeder; böylece
bir dağıtım asla gözden geçirmediğiniz tabloları değiştirmez.

| Seçenek | Açıklama |
| --- | --- |
| `--migrate` | Başlamadan önce bekleyen `safe` migrasyon adımlarını uygular. Riskli ve yıkıcı adımlar yine `verdin migrate apply` gerektirir. |

Dinlemeye başlamadan önce yapılandırmayı denetler (`[api].prefix` ve `[admin].path` `/api` gibi
görünür, sayfa boyutları tutarlıdır, `[server].trusted_proxies` ve `[api].cors_origins`
ayrıştırılır) ve yerleşik rolleri oluşturur. `[admin].secure_cookies` `false` olduğunda veya
`[email].provider` `log` olduğunda bir uyarı yazar. Henüz admin yoksa, ilk ziyaretçinin ilk Super
Admin’i kaydettiği yönetim panelinin adresini yazar.

Ctrl+C veya `SIGTERM` ile durur.

## `verdin schema check`

```text title="Terminal"
verdin schema check
```

Şema dosyalarını (`[schema].path`) veritabanına dokunmadan doğrular. Bir özet yazdırır ya da her
biri dosyası ve nitelik yoluyla hatalarla başarısız olur:

```text title="Terminal"
$ verdin schema check
schema ok: 4 content types, 3 components
```

Bir dağıtımdan önce CI’da kullanın. Her niteliğin neyi kabul ettiği için bkz.
[Nitelik tipleri](/tr/reference/attribute-types/).

## `verdin migrate plan`

```text title="Terminal"
verdin migrate plan [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Veritabanını şemayla karşılaştırır ve hiçbir şeyi değiştirmeden `verdin migrate apply`’ın ne
yapacağını yazdırır: her biri risk düzeyi ve SQL’iyle numaralandırılmış adımlar. Yapılacak bir şey
yoksa `database is up to date` yazdırır.

| Seçenek | Açıklama |
| --- | --- |
| `--rename-table <OLD=NEW>` | `OLD` tablosunu, birini kaldırıp diğerini oluşturmak yerine `NEW` olarak yeniden adlandırılmış sayar (satırlarını korur). Tekrarlanabilir. |
| `--rename-column <TABLE.OLD=NEW>` | `TABLE` tablosunun `OLD` sütununu `NEW` olarak yeniden adlandırılmış sayar (değerlerini korur). `TABLE`, tablonun yeni adıdır. Tekrarlanabilir. |

Risk düzeyleri:

| Düzey | Anlamı |
| --- | --- |
| `safe` | Veri kaybedemez veya mevcut satırlarda başarısız olamaz: yeni tablolar, nullable veya varsayılanı olan yeni sütunlar, yeniden adlandırmalar, benzersiz olmayan indeksler. |
| `risky` | Mevcut satırlarda başarısız olabilir veya değerleri dönüştürebilir: sütun tipi değişiklikleri, nullable olmayan ve varsayılanı olmayan yeni sütunlar, mevcut tablolarda benzersiz indeksler. |
| `destructive` | Sütunları veya tabloları kaldırır. |

Bir adım `safe`’in üzerindeyse plan ihtiyaç duyduğu bayrakla biter
(`requires: verdin migrate apply --allow risky`). Kaldırılan bir sütun veya tablo yeniden
adlandırılmış gibi göründüğünde geçilecek yeniden adlandırma bayraklarını listeler. Önceki bir
migrasyon kesintiye uğradıysa kaç adımın uygulandığını ve son hatayı gösterir.

```text title="Terminal"
verdin migrate plan --rename-column articles.summary=excerpt
```

Bkz. [Şema migrasyonları](/tr/concepts/schema-migrations/).

## `verdin migrate apply`

```text title="Terminal"
verdin migrate apply [--allow <ALLOW>] [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Planı uygular. `verdin migrate plan` ile aynı yeniden adlandırma seçeneklerini alır; gözden
geçirdiklerinizin aynısını geçin.

| Seçenek | Varsayılan | Açıklama |
| --- | --- | --- |
| `--allow <ALLOW>` | `safe` | Uygulanacak en yüksek risk düzeyi: `safe`, `risky` veya `destructive`. Bunun üzerinde bir adımı olan plan hiçbir şey çalışmadan reddedilir. |
| `--rename-table <OLD=NEW>` | | `verdin migrate plan`’daki gibi. |
| `--rename-column <TABLE.OLD=NEW>` | | `verdin migrate plan`’daki gibi. |

`applied N steps` veya `database is up to date` yazdırır. Bir kesintiden sonra (kaybedilen bir
bağlantı, başarısız olan bir adım) nedeni düzeltin ve yeniden çalıştırın: tamamlanmayan adımdan
devam eder.

## `verdin admin create`

```text title="Terminal"
verdin admin create --email <EMAIL>
```

Bir Super Admin oluşturur. Parola `VERDIN_ADMIN_PASSWORD`’dan ya da o ayarlanmamışsa standart
girdiden okunur. Veritabanı şemayla güncel olmalıdır.

| Seçenek | Açıklama |
| --- | --- |
| `--email <EMAIL>` | Yeni admin’in e-posta adresi. |

```text title="Terminal"
$ VERDIN_ADMIN_PASSWORD='a long passphrase' verdin admin create --email ada@example.com
created Super Admin ada@example.com (id 1)
```

Henüz bir tarayıcıdan ulaşılamayan bir sunucunun ilk admin’ini oluşturmak için kullanın; aksi hâlde
yönetim panelinin ilk ziyaretçisi onu kaydeder.

## `verdin admin reset-password`

```text title="Terminal"
verdin admin reset-password --email <EMAIL>
```

Bir admin’in parolasını belirler, başarısız oturum açmalardan sonra hesabın kilidini açar ve tüm
oturumlarını sonlandırır. Parola `verdin admin create`’deki gibi okunur.

| Seçenek | Açıklama |
| --- | --- |
| `--email <EMAIL>` | Admin’in e-posta adresi. |

İkinci faktörleri kaldırmaz; **Kullanıcıları yönet** yetkisi olan bir admin bunları **Ayarlar →
Kullanıcılar** bölümünde sıfırlayabilir.

## `verdin types`

```text title="Terminal"
verdin types [-o <OUT>]
```

Şemadan içerik API’sinin TypeScript tanımlarını (içerik tipi ve bileşen başına bir arayüz) üretir ve
standart çıktıya yazdırır. Veritabanı gerektirmez.

| Seçenek | Açıklama |
| --- | --- |
| `-o, --out <OUT>` | Bunun yerine bu dosyaya yazar. |

```text title="Terminal"
verdin types --out ../web/src/verdin.d.ts
```

Bkz. [Tipli istemci](/tr/guides/frontend/typed-client/).

## `verdin import strapi`

```text title="Terminal"
verdin import strapi <PATH> [--schema-only] [--force]
```

`strapi export --no-encrypt` ile yapılmış bir dışa aktarmadan bir Strapi v4 veya v5 projesini içe
aktarır: bir `.tar.gz`, bir `.tar` veya açılmış bir dizin. İçerik tiplerini ve bileşenleri şema
dosyaları olarak yazar, ardından kayıtları, dilleri, medyayı, ilişkileri ve klasörleri içe aktarır.

| Argüman veya seçenek | Açıklama |
| --- | --- |
| `<PATH>` | Dışa aktarma dosyası veya dizini. |
| `--schema-only` | Yalnızca şema dosyalarını yazar. |
| `--force` | Mevcut şema dosyalarının üzerine yazar ve zaten kayıtları olan içerik tiplerine içe aktarır. |

Yazdıklarını ve içe aktardıklarını, taşıyamadıkları için uyarılarla yazdırır ve proje köküne
`strapi-id-map.json` yazar: frontend’inizdeki bağlantıları düzeltmek için Strapi kimlikleri ile
bunların yeni Verdin `documentId`’leri ve dosya kimlikleri.

Bkz. [Strapi’den geçiş](/tr/migrate/from-strapi/).

## `verdin import verdin`

```text title="Terminal"
verdin import verdin <PATH> [--force]
```

`verdin export` tarafından yazılmış bir arşivi içe aktarır: şema dosyaları, diller, medya ve
kayıtlar.

| Argüman veya seçenek | Açıklama |
| --- | --- |
| `<PATH>` | `.tar.gz` dosyası. |
| `--force` | Farklı olan şema dosyalarının üzerine yazar ve zaten kayıtları olan içerik tiplerine içe aktarır. |

## `verdin export`

```text title="Terminal"
verdin export <OUTPUT> [--no-media]
```

Projenin şemasını, içeriğini ve medyasını bir `.tar.gz` arşivine yazar: bir yedek ya da bir projeyi
`verdin import verdin` ile başka bir örneğe taşımanın bir yolu. Arşiv her kaydın her sürümünü
(taslaklar, yayınlanmış sürümler, diller) ilişkileriyle tutar. Admin hesapları, API token’ları ve
ayarlar dâhil değildir.

| Argüman veya seçenek | Açıklama |
| --- | --- |
| `<OUTPUT>` | Yazılacak arşiv. |
| `--no-media` | Medya kütüphanesini dışarıda bırakır: dosyalar, klasörler ve kayıtların onlara bağlantıları. |

```text title="Terminal"
$ verdin export backup.tar.gz
exported to backup.tar.gz: 42 documents (57 versions), 18 files, 3 folders, 2 locales
```

Bkz. [Yedekler](/tr/deploy/backups/).

## `verdin healthcheck`

```text title="Terminal"
verdin healthcheck [--port <PORT>]
```

Bu makinedeki sunucuya (`127.0.0.1`, yapılandırmanın `[server].port`’u) `GET /_health` sorar ve
`200` yanıtı verdiğinde 0, aksi hâlde nedenini yazdırarak 1 durumuyla çıkar. Shell, `curl` veya HTTP
istemcisi gerektirmez; bu yüzden Docker imajı onu `HEALTHCHECK` olarak kullanır; Compose’da veya
komut çalıştıran herhangi bir süpervizörde de aynı şekilde kullanın.

| Seçenek | Açıklama |
| --- | --- |
| `--port <PORT>` | `[server].port` yerine bu portu denetler. |

```text title="Terminal"
$ verdin healthcheck
ok
```

Bkz. [İzleme](/tr/deploy/monitoring/).

## `verdin secrets`

```text title="Terminal"
verdin secrets
```

Bir `.env` dosyası veya platformunuzun secret deposu için hazır, yeni bir `VERDIN_ADMIN_JWT_SECRET`
ve `VERDIN_TOKEN_PEPPER` yazdırır. Hiçbir proje okumaz.

`VERDIN_ADMIN_JWT_SECRET`’ı değiştirmek admin’lerin ve son kullanıcıların kısa ömürlü erişim
token’larını, açık önizleme bağlantılarını ve devam eden OAuth oturum açmalarını geçersiz kılar;
yönetim paneli ve yenileme token’ı kullanan istemciler kendiliğinden yenilerini alır.
`VERDIN_TOKEN_PEPPER`’ı değiştirmek saklanan token’ları (API token’ları dâhil) geçersiz kılar; bu
yüzden kullanılmaya başlandıktan sonra onu koruyun.

## `verdin version`

```text title="Terminal"
verdin version
```

`verdin --version` gibi `verdin` ve sürümü yazdırır.
