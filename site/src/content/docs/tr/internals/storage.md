---
title: Depolama
description: Verdin’in içeriği veritabanında nasıl yerleştirdiği; tablo adları ve sistem sütunlarından taslak ve yayınlanmış satırlara, ilişki bağlantılarına, bileşen JSON’una ve platform tablolarına kadar.
sidebar:
  order: 2
---

Bu sayfa Verdin’in şemanızdan türettiği tabloları ve her nitelik türünün nasıl saklandığını açıklar. `crates/verdin-migrate/src/derive.rs` veya Document Service içinde bir şey değiştirmeden önce ya da veritabanını doğrudan sorgulamanız gerektiğinde okuyun. Her nitelik tipinin neyi kabul ettiği için bkz. [nitelik tipleri](/tr/reference/attribute-types/).

Bu tabloları asla elle yazmazsınız: [migrasyon motoru](/tr/internals/migrations/) onları şemadan oluşturur ve geliştirir.

## Adlandırma kuralları

| Nesne | Ad |
|---|---|
| İçerik tipi tablosu | `collectionName`; varsayılanı tireleri alt çizgiye çevrilmiş `pluralName`’dir (`blog-posts` → `blog_posts`) |
| Sütun | Snake case nitelik adı (`metaTitle` → `meta_title`) |
| İlişki bağlantıları | `{table}_{column}_lnk` |
| Polimorfik ilişki bağlantıları | `{table}_{column}_mph` |
| Medya bağlantıları | `{table}_{column}_mda` |
| İndeks | Benzersiz indeksler için `{table}_{part}_uq`, diğerleri için `{table}_{part}_idx` |
| Platform tablosu | `vd_` öneki (`vd_admin_users`, `vd_schema_snapshots`…) |

Şema doğrulayıcısının uyguladığı kurallar (`crates/verdin-schema/src/naming.rs` ve `validate.rs`):

- Bir `collectionName` `^[a-z][a-z0-9_]*$` ile eşleşir, en fazla 50 karakterdir ve `vd_` ile başlayamaz.
- `singularName` ve `pluralName` kebab case’tir (`^[a-z][a-z0-9-]*$`, başta, sonda veya çift tire yok). `upload`, `uploads`, `auth`, `users` ve `connect` ayrılmıştır, çünkü içerik API’si bu rotaları kullanır.
- Nitelik adları bir harfle başlar ve harfler, rakamlar veya alt çizgilerle devam eder (Strapi’nin kuralı) ve en fazla 50 karakterdir.
- İçerik tiplerinde `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`, `updatedAt`, `createdBy` ve `updatedBy` ile snake case hâli bunlarla çakışan her ad ayrılmıştır. Bileşenlerde `id` ayrılmıştır.
- Üretilen tanımlayıcılar 60 karakterle sınırlıdır (PostgreSQL 63’e, MySQL 64’e izin verir). Daha uzun bir ad kesilir ve tam adın 8 karakterlik bir hash’i eklenir; böylece farklı uzun adlar farklı kalır ve sonuç deterministiktir.

Üretilen SQL’de her tanımlayıcı tırnaklanır; bu yüzden SQL ayrılmış kelimeleri geçerli nitelik adlarıdır.

## Sistem sütunları

Her içerik tipi tablosu şu sütunlarla başlar:

```sql
id                 BIGINT       primary key, auto-increment
document_id        CHAR(26)     NOT NULL           -- ULID, shared by every version of a document
locale             VARCHAR(16)  NOT NULL DEFAULT '' -- '' for types that are not localized
publication_state  SMALLINT     NOT NULL           -- 0 = draft, 1 = published
published_at       <datetime>   NULL
created_at         <datetime>   NOT NULL
updated_at         <datetime>   NOT NULL
created_by_id      BIGINT       NULL               -- vd_admin_users.id
updated_by_id      BIGINT       NULL
UNIQUE (document_id, locale, publication_state)
INDEX  (publication_state, locale)
```

- `document_id`, oluşturmada üretilen küçük harfli bir ULID’dir. Taslak, yayınlanmış sürüm ve her dil boyunca aynı kalır.
- Yerelleştirilmemiş tipler `NULL` yerine `locale = ''` kullanır; çünkü NULL’lar hiçbir motorda benzersiz indekslerde çakışmaz, bu da `(document_id, locale, publication_state)` kısıtını bozardı.
- Durum sütunu `state` değil `publication_state`’tir, çünkü `state` yaygın bir nitelik adıdır.

Ardından skaler nitelik başına bir tane olmak üzere nitelik sütunları gelir. **Her nitelik sütunu nullable’dır.** Strapi v5’teki gibi taslaklar eksik olabilir; bu yüzden `required` veritabanı tarafından değil, bir sürüm yayınlandığında (veya taslak ve yayınlama kullanmayan tiplere yapılan her yazmada) denetlenir. Bu, zorunlu bir nitelik eklemeyi de güvenli bir migrasyon yapar.

`unique` nitelikler ve her `uid`, `(column, locale, publication_state)` üzerinde benzersiz bir indeks alır. Bir taslak ve yayınlanmış sürümü bir değeri paylaşabilir, iki yayınlanmış belge paylaşamaz ve veritabanı bunu yarış koşulu olmadan uygular. Bir ihlal o alanda bir `ValidationError` olarak bildirilir.

## Taslak ve yayınlama

Verdin Strapi v5’in modelini izler. Kullanıcı görünümü için bkz. [taslak ve yayınlama](/tr/concepts/draft-and-publish/); tabloda olan budur.

- Bir belgenin dil başına en fazla bir taslak satırı (`publication_state = 0`) ve bir yayınlanmış satırı (`publication_state = 1`) vardır.
- Yönetim panelinden gelen yazmalar taslak satırını hedefler.
- **Yayınla**, taslakta `required` nitelikleri ve doğrulama kurallarını denetler, ardından taslağın nitelik değerlerini tek bir transaction içinde yayınlanmış satırın üzerine kopyalar (onu günceller ya da ilk seferde ekler). Taslağın ilişki ve medya bağlantıları da onunla birlikte kopyalanır.
- **Yayından kaldır** yayınlanmış satırı siler. Bağlantıları `ON DELETE CASCADE` ile onunla birlikte gider.
- **Taslağı at**, taslağın üzerine yayınlanmış satırın değerlerini ve bağlantılarını yazar.
- Taslak ve yayınlama kullanmayan içerik tiplerinin yalnızca yayınlanmış bir satırı vardır.
- Yerelleştirilmiş tiplerde yerelleştirilmemiş nitelikler paylaşılır: bir dili yayınlamak onları diğer dillerin yayınlanmış satırlarına kopyalar.

## İlişkiler: belge kimliğiyle bağlı

**Strapi’nin depolamasından temel fark budur.** Strapi satırları satır kimliğiyle bağlar ve yayınladığınızda bağlantıları yeniden yazmak zorundadır. Verdin bir ilişkiyi *kaynak satır → hedef belge* olarak saklar:

```sql
-- articles_category_lnk
id                  BIGINT   primary key, auto-increment
source_id           BIGINT   NOT NULL REFERENCES articles(id) ON DELETE CASCADE
target_document_id  CHAR(26) NOT NULL
position            DOUBLE   NOT NULL   -- 1..n, rewritten on every write
UNIQUE (source_id, target_document_id)
UNIQUE (source_id)                      -- to-one kinds only
INDEX  (target_document_id)
```

- Hedef satır okuma sırasında, okunan sürümde seçilir: yayınlanmış bir makale yayınlanmış kategorileri, bir taslak taslakları görür. Bir kategori yayından kaldırılırsa, hiçbir bağlantıya dokunulmadan yayınlanmış makalelerden kaybolur.
- Yayınlama yalnızca kaynak satırın kendi bağlantılarını kopyalar.
- Yalnızca **sahip** tarafın (`inversedBy` içeren nitelik veya tek yönlü bir ilişki) bir bağlantı tablosu vardır. Ters taraf (`mappedBy`) aynı tabloyu tersinden okur ve salt okunurdur: ona yazmak, sahip niteliği belirten bir doğrulama hatasıdır.
- "En fazla bir hedef" (`oneToOne`, `manyToOne`, `oneWay`), `source_id` üzerindeki benzersiz indekstir. "Bir hedef tek bir kaynak belgeye aittir" (`oneToOne`, `oneToMany`) bir indeks olamaz, çünkü bir taslak ve yayınlanmış sürümü meşru olarak hedefleri paylaşır. Document Service bunu hedefi *taşıyarak* uygular: onu bağlamak, diğer belgelerin aynı durumda ona tuttuğu bağlantıları kaldırır; bu Strapi’nin davranışıdır.
- `target_document_id` üzerinde yabancı anahtar yoktur, çünkü `document_id` hedef tabloda benzersiz değildir. Document Service var olmayan belgelere bağlantıları reddeder ve bir belgenin son sürümü silindiğinde ona işaret eden bağlantıları aynı transaction içinde kaldırır.
- Bağlantı satırları bir `id` birincil anahtarı tutar; böylece bağlantı tabloları migrasyon motoruna ve SQLite tablo yeniden oluşturmalarına diğer tüm tablolar gibi görünür.
- Bir tabloyu yeniden adlandırmak bağlantı tablolarını da onunla birlikte yeniden adlandırır. Migrasyonlar SQLite’ın `foreign_keys`’i kapalıyken çalışır; böylece bir tabloyu yeniden oluşturmak bağlantı tablolarına cascade olmaz.

**Polimorfik ilişkiler** (`morphToOne`, `morphToMany`) herhangi bir içerik tipinin belgelerini bağlar. Bağlantıları `source_id`, `target_type` (hedefin uid’si), `target_document_id` ve `position` ile `{table}_{column}_mph` içinde, benzersiz bir `(source_id, target_type, target_document_id)` ve `morphToOne` için benzersiz bir `source_id` ile bulunur. Ters tarafların (`morphOne`, `morphMany`) tablosu yoktur: sahibin onlara işaret eden bağlantılarını okurlar ve salt okunurdurlar. Bir belgeyi silmek ona olan polimorfik bağlantıları kaldırır. Onlarla neler yapıp yapamayacağınız için bkz. [ilişkiler](/tr/concepts/relations/).

## Bileşenler ve dinamik bölgeler: bir JSON sütunu

Bir bileşen niteliği veya dinamik bölge, belge satırında **tek bir JSON sütunudur** (PostgreSQL’de `jsonb`, MySQL ve MariaDB’de `json`, SQLite’ta `text`). Strapi her bileşeni polimorfik join tablolarıyla kendi tablosunda saklar; bir sütun bu join’lerden kaçınır ve yayınlamayı ve geçmişi düz bir kopya yapar.

```json
// "seo" column (a single component)
{ "id": 1, "metaTitle": "…", "metaDescription": "…" }

// "blocks" column (a dynamic zone)
[
  { "id": 1, "__component": "blocks.hero", "title": "…" },
  { "id": 2, "__component": "blocks.quote", "text": "…", "author": "…" }
]
```

- Her bileşen öğesinin, niteliği içinde benzersiz bir tam sayı `id`’si vardır. Yeni öğeler bir sonraki boş numarayı alır.
- Veri her yazmada bileşen şemasına karşı doğrulanır.
- Yayınlama ve atma JSON’u olduğu gibi kopyalar.
- **Bileşenler içindeki ilişkiler ve medya** JSON’un kendisinde saklanır: ilişkiler için `documentId`’ler (orada yalnızca `oneWay` ve `manyWay`’e izin verilir) ve medya için dosya kimlikleri. Yazmada denetlenir ve bileşen populate edildiğinde toplu sorgularla çözümlenirler. Polimorfik ilişkiler ve `password` nitelikleri bileşenlerin içinde olamaz.
- **Filtreleme**, dialect’e özgü JSON fonksiyonları gerektirir. Tekil bileşenlerin skaler alanları bir JSON yolu üzerinden okunur (PostgreSQL’de `#>>`, MySQL ve MariaDB’de `JSON_VALUE`, SQLite’ta `json_extract`). Tekrarlanabilir bileşenler dizi öğeleri üzerinde `EXISTS` kullanır (`jsonb_array_elements`, `JSON_TABLE`, `json_each`). Dinamik bölgeler yalnızca `__component` ile filtrelenebilir, çünkü öğelerinin farklı alanları vardır.

Modelleme tarafı için bkz. [bileşenler ve dinamik bölgeler](/tr/concepts/components-and-dynamic-zones/).

## Platform tabloları

Platform tabloları türetilen her modelin parçasıdır; bu yüzden migrasyon motoru onları içerik tabloları gibi tam olarak oluşturur ve geliştirir; `verdin migrate plan` içinde güvenli adımlar olarak görünürler. `crates/verdin-migrate/src/system.rs` içinde tanımlanırlar.

| Alan | Tablolar |
|---|---|
| Migrasyonlar | `vd_schema_snapshots`, `vd_migrations_journal` (migrasyon motoruna ait, ilk kullanımda oluşturulur) |
| Admin’ler | `vd_admin_users`, `vd_admin_roles`, `vd_admin_user_roles`, `vd_admin_permissions`, `vd_sessions` (yenileme token’ları), `vd_admin_tokens` (davet ve sıfırlama bağlantıları), `vd_admin_two_factor`, `vd_admin_passkeys`, `vd_spent_challenges` |
| İçerik API’si erişimi | `vd_api_tokens`, `vd_api_token_permissions`, `vd_public_permissions` |
| Son kullanıcılar | `vd_users`, `vd_user_roles`, `vd_user_role_permissions`, `vd_end_user_sessions` |
| Kurulum | `vd_settings` (özellik anahtarları, düzenleme görünümü yerleşimleri, tek seferlik yükseltme işaretçileri), `vd_locales`, `vd_cluster_events` (paylaşılan olay veriyolu, bkz. [Birden fazla örnek](/tr/deploy/scaling/)) |
| Medya | `vd_files`, `vd_folders` |
| İçerik iş akışı | `vd_history_versions`, `vd_releases`, `vd_release_actions`, `vd_workflows`, `vd_workflow_stages`, `vd_document_stages` |
| İş birliği | `vd_comments`, `vd_tasks`, `vd_document_views`, `vd_document_votes`, `vd_polls`, `vd_poll_votes` |
| Entegrasyonlar | `vd_webhooks`, `vd_webhook_deliveries`, `vd_deploy_targets`, `vd_deployments`, `vd_plugin_kv`, `vd_audit_logs` |
| Site özellikleri | `vd_redirects`, `vd_menus`, `vd_forms`, `vd_form_submissions` |

## Medya tabloları

Dosyalar, Strapi biçiminde (`name`, `alternative_text`, `caption`, `width`, `height`, `formats`, `hash`, `ext`, `mime`, `size`, `url`, `provider`…), ayrıca `focal_point`, `folder_id` ve `folder_path` ile `vd_files` satırlarıdır. Klasörler (`vd_folders`), Strapi’nin `/1/4` gibi `path_id`’lerden oluşan `path` değerini korur.

Bir medya niteliği `source_id` (içerik satırı), `file_id` (bir `vd_files` satırı) ve `position` içeren bir `{table}_{column}_mda` bağlantı tablosudur. Benzersiz bir `(source_id, file_id)` ve nitelik `multiple` değilse benzersiz bir `source_id` içerir. Her iki sütun da `ON DELETE CASCADE` ile yabancı anahtardır; böylece bir dosyayı veya satırı silmek bağlantılarını kaldırır. Medya bağlantıları ilişki bağlantılarıyla aynı taslak ve yayınlama kurallarını izler: her sürüm kendi bağlantılarına sahiptir ve yayınlama onları kopyalar.

Yüklemelerin, formatların ve depolama sağlayıcılarının nasıl çalıştığı [medya](/tr/concepts/media/) sayfasındadır.
