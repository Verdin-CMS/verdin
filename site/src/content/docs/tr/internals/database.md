---
title: Veritabanı katmanı
description: Verdin’in PostgreSQL, MySQL, MariaDB ve SQLite ile tek bir bağlantı tipi, bir Flavor enum’u ve kendi SQL oluşturucuları üzerinden nasıl konuştuğu ve her dialect’in farklılıklarını nasıl ele aldığı.
sidebar:
  order: 3
---

Bu sayfa Verdin’in dört veritabanı motorunu tek bir kod yoluyla nasıl desteklediğini açıklar: bağlanan ve çalıştıran `verdin-db` crate’i, motora göre dallanan SQL oluşturucuları ve bunların ele aldığı dialect farklılıkları. Sunucunun herhangi bir yerinde SQL yazmadan önce okuyun. Tabloların nasıl yerleştirildiği [depolama](/tr/internals/storage/) sayfasındadır.

## En düşük sürümler

`Database::connect` motoru ve sürümünü algılar ve bu en düşük sürümlerin altında başlamayı reddeder (`crates/verdin-db/src/lib.rs` içindeki `Flavor::minimum_version`):

| Motor | En düşük | Neden |
|---|---|---|
| PostgreSQL | 14 | Upstream’de hâlâ desteklenen en eski sürüm |
| MySQL | 8.4 LTS | 8.0’ın ömrü Nisan 2026’da sona erdi |
| MariaDB | 10.11 LTS | Mevcut en eski uzun vadeli sürüm; `utf8mb4_uca1400_ai_ci` collation’ı, kullanılabilir JSON |
| SQLite | 3.35 | `ALTER TABLE … DROP COLUMN`; kütüphane ikili dosyanın içine derlenir |

CI her testi PostgreSQL 14 ve 17, MySQL 8.4, MariaDB 10.11 ve 11.4 ve SQLite’a karşı çalıştırır. Bkz. [test](/tr/internals/testing/).

## Bağlanma

`verdin-db` her backend için bir `sqlx` havuzunu sarar:

```rust
pub enum Pool { Postgres(PgPool), MySql(MySqlPool), Sqlite(SqlitePool) }

pub enum Flavor { Postgres, MySql, MariaDb, Sqlite }

pub struct Database { pool: Pool, flavor: Flavor, version: Version }
```

- URL şemaları: `postgres://` veya `postgresql://`, `mysql://`, `mariadb://` (`mysql://`’in bir takma adı) ve `sqlite:`. MySQL ve MariaDB `sqlx` MySQL sürücüsünü paylaşır; flavor, MariaDB’de `MariaDB` içeren `SELECT VERSION()` sonucundan gelir.
- MySQL ve MariaDB bağlantıları `utf8mb4` kullanır ve oturum saat dilimini `+00:00` olarak ayarlar; böylece her zaman damgası UTC’de saklanır.
- SQLite bağlantıları yabancı anahtarları açar, WAL günlüklemesi ve 5 saniyelik bir busy timeout kullanır ve eksikse veritabanı dosyasını (ve klasörünü) oluşturur. Bellek içi veritabanları tek bir bağlantı alır, çünkü `:memory:`’ye yapılan her bağlantı farklı bir veritabanı açardı.
- `ConnectOptions` havuz boyutunu (`[database].pool_max`, varsayılan 10) ve boş bir bağlantı için bekleme süresini (10 saniye) ayarlar.

`Flavor`, kodun geri kalanının dallandığı birkaç bilgiyi taşır: `transactional_ddl()` (PostgreSQL ve SQLite), `is_mysql_family()`, `quote(identifier)` (MySQL ve MariaDB’de backtick, diğerlerinde çift tırnak) ve `minimum_version()`.

Bir dialect trait’i yoktur. SQL oluşturan kod, motorların farklılaştığı yerlerde `Flavor`’ı denetler.

## İfadeleri çalıştırma

Üç executor aynı metotları paylaşır (`execute`, `fetch_all`, `has_rows`, `insert_returning_id`):

| Executor | Kullanım |
|---|---|
| `db.queries()` | Havuzdaki herhangi bir bağlantıda tek bir ifade |
| `db.acquire()` → `Conn` | Tek bir bağlantıda birkaç ifade; örneğin bir kilit tutan migrasyon çalıştırması |
| `db.begin()` → `Tx` | Bir transaction; `commit()` olmadan bırakılırsa geri alınır |

İfadeler `?` yer tutucularıyla yazılır ve PostgreSQL için `$1, $2…` olarak yeniden yazılır. Değerler her zaman parametre olarak bağlanan `SqlValue`’lardır. SQL metninin kendisi yalnızca doğrulanmış şemadan gelen tanımlayıcıları içerebilir; bu yüzden `sqlx`’e `AssertSqlSafe` olarak geçirilir.

**Şema güdümlü çözme.** Bir okuma, seçilen her sütunun `ColumnKind` değerini geçirir ve değerler sürücünün bildirdiği tipe göre değil bu türe göre çözülür. MariaDB’nin `JSON`’unun (aslında `LONGTEXT`), MySQL’in `TINYINT(1)` boolean’larının ve SQLite’ın metin tarihlerinin ve ondalıklarının her motorda aynı şekilde dönmesini sağlayan budur. Bkz. `crates/verdin-db/src/value.rs`.

**Eklenen kimlikler.** `insert_returning_id`, PostgreSQL’de `RETURNING id` ekler; MySQL, MariaDB (`LAST_INSERT_ID`) ve SQLite’ta (`last_insert_rowid`) ise eklemeden sonra sürücünün bildirdiği kimliği okur.

**Benzersizlik ihlalleri.** `DbError::unique_violation()`, sürücü hatasından indeks adını (PostgreSQL, MySQL, MariaDB) veya sütun listesini (SQLite) çıkarır; böylece Document Service doğru nitelikte bir `ValidationError` bildirebilir.

## SQL oluşturucuları

Verdin SQL’i bir ORM veya `sea-query` yerine kendi küçük oluşturucularıyla üretir; çünkü tablolar yalnızca çalışma zamanında vardır (şemadan gelirler) ve dialect başına ayrıntılar baskındır: tipli NULL’lar, collation’lar, JSON fonksiyonları ve SQLite’ın metin biçimleri.

| Crate | Oluşturduğu |
|---|---|
| `verdin-migrate` (`sql.rs`, `Dialect`) | DDL: sütun tipleri, `CREATE TABLE`, `ALTER TABLE`, indeksler, SQLite tablo yeniden oluşturmaları |
| `verdin-query` (`sql.rs`, `SqlBuilder`) | Filtreler için `WHERE` ifadeleri (ilişki `EXISTS` alt sorguları ve JSON yolları dâhil) ve `ORDER BY` |
| `verdin-content` (`service.rs`) | Okumalar, eklemeler, güncellemeler, silmeler, bağlantı tablosu yazmaları ve toplu populate sorguları |

Bir oluşturucu SQL metni ve (flavor için tırnaklanmış) `ident()` adları ekler ve parametreleri `param()` ile toplar; böylece SQL oluşturma ve değer bağlama tek bir yerde olur.

### Dialect başına sütun tipleri

| Model tipi | PostgreSQL | MySQL / MariaDB | SQLite |
|---|---|---|---|
| id | `bigint` identity | `bigint AUTO_INCREMENT` | `integer PRIMARY KEY AUTOINCREMENT` |
| integer, bigint, smallint | `integer`, `bigint`, `smallint` | `int`, `bigint`, `smallint` | `integer` |
| double | `double precision` | `double` | `real` |
| decimal | `numeric(p,s)` | `decimal(p,s)` | `text` |
| boolean | `boolean` | `tinyint(1)` | `integer` |
| char, varchar | `char(n)`, `varchar(n)` | `char(n)`, `varchar(n)` | `text` |
| text | `text` | `longtext` | `text` |
| date, time, datetime | `date`, `time(3)`, `timestamptz(3)` | `date`, `time(3)`, `datetime(3)` | `text` |
| json | `jsonb` | `json` | `text` |

SQLite tarihleri ve saatleri sabit biçimli metin olarak saklar; böylece metin sırası kronolojik sırayla eşleşir. Ondalıkları da metin olarak saklar; böylece kaydedilirken hiçbir şey yuvarlanmaz. Ondalıklarda metin sırası sayısal sıra değildir; bu yüzden SQLite’ta bir ondalık üzerindeki filtreler ve sıralamalar sütunu `REAL`’e çevirir. Bu karşılaştırmalar yaklaşık 15 anlamlı basamağa kadar kesindir ve döndürülen değerler hâlâ kesindir. Hangi niteliğin hangi model tipine eşlendiği [nitelik tipleri](/tr/reference/attribute-types/) sayfasındadır.

MySQL ve MariaDB tabloları `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` ve aksana ve büyük/küçük harfe duyarsız bir collation ile oluşturulur: MySQL’de `utf8mb4_0900_ai_ci`, MariaDB’de `utf8mb4_uca1400_ai_ci`.

## Dialect farklılıkları

| Konu | PostgreSQL | MySQL 8.4 | MariaDB | SQLite | Verdin’in ele alışı |
|---|---|---|---|---|---|
| Eklenen kimlik | `RETURNING` | `RETURNING` yok | sürücü kimliği | sürücü kimliği | `insert_returning_id()` |
| Transactional DDL | evet | hayır (örtük commit) | hayır | evet | MySQL ve MariaDB’de adım günlüğü (bkz. [migrasyonlar](/tr/internals/migrations/)) |
| JSON | `jsonb` | `json` | `LONGTEXT`’in takma adı | metin | Şema güdümlü çözme |
| Boolean’lar | `boolean` | `tinyint(1)` | `tinyint(1)` | integer | Şema güdümlü çözme |
| Tarih-saat | `timestamptz` | `datetime(3)` | `datetime(3)` | ISO metin | Her zaman UTC; MySQL ailesi oturumları `+00:00` saat dilimini kullanır |
| Karakter kümesi ve collation | UTF-8 | `utf8mb4`, `utf8mb4_0900_ai_ci` | `utf8mb4`, `utf8mb4_uca1400_ai_ci` | UTF-8, binary | Tablo başına açıkça ayarlanır |
| Tam metin eşleşmesi (`$eq`, `$in`…) | `=` | `COLLATE utf8mb4_bin` | aynı | `=` | Her motorda aynı sonuçlar |
| `$contains`, `$startsWith`, `$endsWith` | `LIKE` | `LIKE … COLLATE utf8mb4_bin` | aynı | `instr()` / `substr()` | SQLite’ın `LIKE`’ı ASCII büyük/küçük harfini yok sayar, bu yüzden büyük/küçük harfe duyarlı eşleşmelerde kullanılmaz |
| `$containsi` ve diğer `…i` operatörleri | `ILIKE` | `LIKE` (duyarsız collation) | aynı | `LIKE` | SQLite yalnızca ASCII büyük/küçük harfini dönüştürür |
| JSON yol filtreleri | `#>>` | `JSON_VALUE` | aynı | `json_extract` | Dialect başına operand |
| JSON dizi filtreleri | `jsonb_array_elements` | `JSON_TABLE` | aynı | `json_each` | Öğeler üzerinde `EXISTS` |
| `ALTER COLUMN` | tam | `MODIFY COLUMN` | aynı | desteklenmez | SQLite: tabloyu yeniden oluştur (oluştur, kopyala, kaldır, yeniden adlandır) |
| Satır kilitleri | `FOR UPDATE` | `FOR UPDATE` | `FOR UPDATE` | yok | Yazma transaction’ları veritabanını kilitleyen SQLite’ta atlanır |
| Benzersiz metin indeksi uzunluğu | — | 3.072 bayt | aynı | — | `utf8mb4`’te `varchar(255)` 1.020 bayttır; `text` benzersiz olamaz |
| Satır boyutu | — | 65.535 bayt | aynı | — | Tip başına en fazla 60 `string`, `email`, `uid` veya `enumeration` niteliği |

`LIKE` kalıpları kullanıcı girdisindeki `%`, `_` ve kaçış karakterinin kendisini (`!`) kaçışlar. MySQL ve MariaDB’nin varsayılan collation’ları büyük/küçük harfi ve aksanları yok sayar; tam operatörlerin binary bir collation eklemesinin nedeni budur: `$eq`, MySQL’de PostgreSQL’deki ile aynı anlama gelir. JSON yollarında `JSON_VALUE` binary collation’lı bir string döndürür; bu yüzden oradaki büyük/küçük harfe duyarsız operatörler her iki tarafta `LOWER()` karşılaştırır.

`ORDER BY`, NULL’ları her iki yönde de sona koyar ve her zaman `id` ile biter; böylece sayfalama her motorda kararlıdır.
