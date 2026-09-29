---
title: Test
description: Verdin’in nasıl test edildiği; Rust birim testlerinden altı veritabanında çalışan uyumluluk paketine, yönetim panelinin birim ve Playwright testlerine ve her değişikliği denetleyen CI işlerine kadar.
sidebar:
  order: 7
---

Bu sayfa test paketlerini, her birinin yerelde nasıl çalıştırılacağını ve CI’ın her pull request’te neleri denetlediğini açıklar. Hepsinin arkasındaki kural: bir özellik, desteklenen her veritabanında geçmeden bitmiş sayılmaz.

## Rust testleri

Her şeyi şununla çalıştırın:

```sh title="Terminal"
cargo test --workspace
```

Yapılandırma olmadan testler SQLite kullanır. Üç türü vardır:

| Tür | Nerede | Ne |
|---|---|---|
| Birim testleri | Her crate’teki `#[cfg(test)]` modülleri | Şema ayrıştırma ve doğrulama, adlandırma, fark ve plan, sorgu ayrıştırma, dialect başına SQL üretimi, değer kodlama, girdi doğrulama |
| Crate entegrasyon testleri | `crates/*/tests/` | Bağlanma ve flavor algılama (`verdin-db`), migrasyon uygulama (`verdin-migrate`), kimlik doğrulama akışları (`verdin-auth`), GraphQL, eklentiler, S3 depolama |
| API testleri | `crates/verdin-api/tests/api/` | Uyumluluk paketi dâhil, içerik API’sine ve admin API’ye karşı HTTP istekleri |

**DDL anlık görüntüleri.** `crates/verdin-migrate/tests/sql_snapshots.rs`, örnek bir şemanın DDL’ini her dialect için oluşturur ve `crates/verdin-migrate/tests/snapshots/` içindeki [`insta`](https://insta.rs) anlık görüntüleriyle karşılaştırır. DDL’i bilerek değiştirdiğinizde yeni anlık görüntüleri `cargo insta review` (`cargo-insta`’dan) ile gözden geçirip kabul edin ve commit edin.

**API testleri**, bağlama sürelerini ve `target/` boyutunu düşük tutmak için tek bir test ikilisinde bulunur (`tests/api/main.rs`, alan başına bir modül). `tests/api/common/mod.rs` içindeki düzenek, test başına yeni, migre edilmiş bir veritabanı üzerinde `/api` adresinde içerik API’sini ve `/admin/api` adresinde admin API’yi oluşturur. Test başka birini ya da hiçbirini vermedikçe istekler tam erişimli bir API token’ı taşır.

## Altı veritabanlı matris

Veritabanına dokunan her test `VERDIN_TEST_DATABASE_URL` değerini okur ve varsayılan olarak bellek içi SQLite kullanır. `verdin-testkit` her teste kendine ait bir veritabanı verir: geçici bir SQLite dosyası veya sunucuda oluşturulup sonra kaldırılan yeni bir `vd_test_…` veritabanı.

CI tüm workspace’i motor başına bir kez çalıştırır:

| Motor | İmaj |
|---|---|
| SQLite | paketle gelir |
| PostgreSQL 14 | `postgres:14-alpine` |
| PostgreSQL 17 | `postgres:17-alpine` |
| MySQL 8.4 | `mysql:8.4` |
| MariaDB 10.11 | `mariadb:10.11` |
| MariaDB 11.4 | `mariadb:11.4` |

Bunlar [en düşük sürümler](/tr/internals/database/#en-düşük-sürümler) ile Verdin’in test edildiği en yeni sürümlerdir. CI ayrıca `crates/verdin-db/tests/connect.rs`’in motorun doğru algılandığını doğrulaması için `VERDIN_TEST_EXPECT_FLAVOR` ayarlar (MariaDB’ye bir `mysql://` URL’siyle ulaşılır ve yine de MariaDB olarak algılanmalıdır).

Matrisi yerelde çalıştırmak için veritabanlarını Docker ile başlatın:

```sh title="Terminal"
docker compose -f docker/compose.dev.yml up -d
```

Ardından testleri her motora karşı çalıştırın. Testler test başına bir veritabanı oluşturur; bu yüzden MySQL ve MariaDB’de `root` olarak bağlanırlar:

```sh title="Terminal"
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5414/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5417/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3384/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3311/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3314/verdin cargo test --workspace
```

Portlar PostgreSQL 14 ve 17, MySQL 8.4 ve MariaDB 10.11 ve 11.4’e karşılık gelir. Aynı compose dosyası medya ve e-posta çalışmaları için RustFS’i (9000 portunda S3 uyumlu depolama) ve Mailpit’i (1025 portunda SMTP, 8025 portunda gelen kutusu) başlatır.

## Uyumluluk paketi

`crates/verdin-api/tests/api/conformance.rs`, her motorda içerik API’sine aynı HTTP isteklerini gönderir ve yanıtları denetler: oluşturma, okuma, güncelleme ve silme gidiş-dönüşleri, girdi doğrulama, taslak ve yayınlama, filtreler ve metin eşleştirme kuralları, sıralama ve sayfalama, alan tipleri ve populate, benzersiz değerler, tekil tipler, içerik API’si erişim kuralları, OpenAPI belgesi ve bileşen alanları üzerindeki filtreler. `tests/api/` içindeki diğer modüller (`filters.rs`, `populate.rs`, `relations.rs`, `components.rs`, `morph.rs`, `i18n.rs`…) kendi alanlarını aynı şekilde kapsar; bu yüzden tüm `verdin-api` test ikilisi fiilen uyumluluk paketidir.

Bir dialect farkını düzelttiğinizde durumu buraya ekleyin: PostgreSQL’de geçip MySQL’de başarısız olan test, tam olarak paketin yakalamak için var olduğu testtir.

## Yönetim paneli testleri

**Birim testleri**, `admin/src/app` içinde kodun yanındaki `*.spec.ts` dosyalarıdır ve jsdom’da Angular’ın unit-test builder’ı üzerinden Vitest ile çalıştırılır. Saf modelleri kapsarlar: form modeli dönüşümü, alan kuralları, liste filtreleri ve görünümleri, izinler, ICU transpiler’ı, haftanın başlangıcı ve daha fazlası.

```sh title="Terminal"
cd admin
npx ng test --watch=false
```

**Uçtan uca testler**, `admin/e2e/` içindeki Playwright spec’leridir. `e2e/serve.sh` (örnek bir WebAssembly eklentisiyle) geçici bir proje oluşturur ve admin’i `admin/dist/admin/browser`’dan sunarak SQLite üzerinde 1393 portunda `verdin dev` başlatır. Testler Chromium’da İngilizce arayüzle birer birer çalışır.

```sh title="Terminal"
cd admin
npx ng build
cargo build -p verdin
npx playwright install chromium
npx playwright test
```

Spec’ler oturum açma ve iki adımlı doğrulama, kayıt düzenleyicisi, polimorfik ilişkiler, inceleme iş akışları, ekip ve yönetişim özellikleri, bahsetmeler, içe ve dışa aktarma, düzenleme görünümleri ve kaydedilmemiş değişiklik guard’larını kapsar.

## CI

`.github/workflows/ci.yml`, `main`’e yapılan her push’ta ve her pull request’te çalışır. Tüm Rust işleri `RUSTFLAGS=-D warnings` ile derlenir.

| İş | Denetimler |
|---|---|
| `lint` | `cargo fmt --all --check`, `cargo clippy --workspace --all-targets`, `cargo deny` (lisanslar ve güvenlik bildirimleri) |
| `test (sqlite)` | Bellek içi SQLite üzerinde `cargo test --workspace` |
| `test (…)` | Docker servisleri olarak, her biri bir iş olmak üzere PostgreSQL 14 ve 17, MySQL 8.4, MariaDB 10.11 ve 11.4 üzerinde `cargo test --workspace` |
| `test (s3 storage, RustFS)` | Bir RustFS container’ına karşı `cargo test -p verdin-upload --test s3` |
| `admin` | Prettier denetimi, `npm run i18n:check`, `npm audit --audit-level=high`, birim testleri, `ng build`, `cargo build -p verdin --features embed-admin`, Playwright |
| `client` | `packages/client`’ın workspace ile aynı sürüme sahip olması, ardından tip denetimi, testler ve derleme |
| `site` | `npm audit` ve herhangi bir kırık iç bağlantıda başarısız olan dokümantasyon derlemesi |

Başarısız Playwright çalıştırmaları izlerini (trace) yedi gün tutulan bir artifact olarak yükler.
