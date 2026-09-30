---
title: 데이터베이스 계층
description: Verdin이 연결 타입 하나, Flavor enum, 자체 SQL 빌더로 PostgreSQL, MySQL, MariaDB, SQLite와 통신하는 방법과 각 방언의 차이를 처리하는 방법.
sidebar:
  order: 3
---

이 페이지에서는 Verdin이 코드 경로 하나로 네 가지 데이터베이스 엔진을 지원하는 방법을 설명합니다. 연결하고 실행하는 `verdin-db` 크레이트, 엔진에 따라 분기하는 SQL 빌더, 그리고 이들이 처리하는 방언 차이입니다. 서버 어디서든 SQL을 쓰기 전에 읽으세요. 테이블 구조는 [스토리지](/ko/internals/storage/)에 있습니다.

## 최소 버전

`Database::connect`는 엔진과 버전을 감지하고, 다음 최소 버전보다 낮으면 시작을 거부합니다(`crates/verdin-db/src/lib.rs`의 `Flavor::minimum_version`).

| 엔진 | 최소 버전 | 이유 |
|---|---|---|
| PostgreSQL | 14 | 업스트림에서 아직 지원하는 가장 오래된 버전 |
| MySQL | 8.4 LTS | 8.0은 2026년 4월에 지원 종료 |
| MariaDB | 10.11 LTS | 현재 가장 오래된 장기 지원 릴리스. `utf8mb4_uca1400_ai_ci` collation, 쓸 만한 JSON |
| SQLite | 3.35 | `ALTER TABLE … DROP COLUMN`. 라이브러리는 바이너리에 컴파일되어 들어감 |

CI는 모든 테스트를 PostgreSQL 14와 17, MySQL 8.4, MariaDB 10.11과 11.4, SQLite에서 실행합니다. [테스트](/ko/internals/testing/)를 참고하세요.

## 연결

`verdin-db`는 백엔드마다 `sqlx` 풀 하나를 감쌉니다.

```rust
pub enum Pool { Postgres(PgPool), MySql(MySqlPool), Sqlite(SqlitePool) }

pub enum Flavor { Postgres, MySql, MariaDb, Sqlite }

pub struct Database { pool: Pool, flavor: Flavor, version: Version }
```

- URL 스킴: `postgres://` 또는 `postgresql://`, `mysql://`, `mariadb://`(`mysql://`의 별칭), `sqlite:`. MySQL과 MariaDB는 `sqlx` MySQL 드라이버를 공유하며, flavor는 `SELECT VERSION()`에서 알아냅니다. MariaDB에서는 결과에 `MariaDB`가 들어 있습니다.
- MySQL과 MariaDB 연결은 `utf8mb4`를 쓰고 세션 시간대를 `+00:00`으로 설정하므로 모든 타임스탬프가 UTC로 저장됩니다.
- SQLite 연결은 외래 키를 켜고, WAL 저널링과 5초 busy timeout을 쓰며, 데이터베이스 파일(과 그 폴더)이 없으면 만듭니다. 인메모리 데이터베이스는 연결을 하나만 가집니다. `:memory:`에 대한 연결마다 다른 데이터베이스가 열리기 때문입니다.
- `ConnectOptions`는 풀 크기(`[database].pool_max`, 기본 10)와 빈 연결을 기다리는 시간(10초)을 설정합니다.

`Flavor`는 나머지 코드가 분기하는 몇 가지 사실을 담습니다: `transactional_ddl()`(PostgreSQL과 SQLite), `is_mysql_family()`, `quote(identifier)`(MySQL과 MariaDB는 백틱, 나머지는 큰따옴표), `minimum_version()`.

방언 trait는 없습니다. SQL을 만드는 코드가 엔진이 다른 곳에서 `Flavor`를 확인합니다.

## 구문 실행

세 가지 실행기가 같은 메서드(`execute`, `fetch_all`, `has_rows`, `insert_returning_id`)를 공유합니다.

| 실행기 | 용도 |
|---|---|
| `db.queries()` | 풀의 아무 연결에서 구문 하나 |
| `db.acquire()` → `Conn` | 연결 하나에서 여러 구문. 예: 잠금을 잡고 있는 마이그레이션 실행 |
| `db.begin()` → `Tx` | 트랜잭션. `commit()` 없이 drop되면 롤백됩니다 |

구문은 `?` 자리 표시자로 작성하며, PostgreSQL에서는 `$1, $2…`로 다시 씁니다. 값은 `SqlValue`이며 항상 파라미터로 바인딩합니다. SQL 텍스트 자체에는 검증된 스키마에서 온 식별자만 들어갈 수 있으며, 그래서 `sqlx`에 `AssertSqlSafe`로 넘깁니다.

**스키마 기반 디코딩.** 읽기는 선택한 각 컬럼의 `ColumnKind`를 넘기며, 값은 드라이버가 보고하는 타입이 아니라 그 kind로 디코딩합니다. 이 덕분에 MariaDB의 `JSON`(실제로는 `LONGTEXT`), MySQL의 `TINYINT(1)` 불리언, SQLite의 텍스트 날짜와 decimal이 모든 엔진에서 똑같이 돌아옵니다. `crates/verdin-db/src/value.rs`를 참고하세요.

**삽입된 id.** `insert_returning_id`는 PostgreSQL에서 `RETURNING id`를 붙이고, MySQL, MariaDB(`LAST_INSERT_ID`), SQLite(`last_insert_rowid`)에서는 삽입 후 드라이버가 보고하는 id를 읽습니다.

**고유성 위반.** `DbError::unique_violation()`은 드라이버 오류에서 인덱스 이름(PostgreSQL, MySQL, MariaDB)이나 컬럼 목록(SQLite)을 추출하므로, Document Service가 올바른 속성에 대해 `ValidationError`를 보고할 수 있습니다.

## SQL 빌더

Verdin은 ORM이나 `sea-query` 대신 자체의 작은 빌더로 SQL을 만듭니다. 테이블이 런타임에만(스키마에서) 존재하고, 방언별 세부 사항이 대부분을 차지하기 때문입니다: 타입 있는 NULL, collation, JSON 함수, SQLite의 텍스트 형식.

| 크레이트 | 만드는 것 |
|---|---|
| `verdin-migrate` (`sql.rs`, `Dialect`) | DDL: 컬럼 타입, `CREATE TABLE`, `ALTER TABLE`, 인덱스, SQLite 테이블 재구성 |
| `verdin-query` (`sql.rs`, `SqlBuilder`) | 필터용 `WHERE` 절(관계 `EXISTS` 서브쿼리와 JSON 경로 포함)과 `ORDER BY` |
| `verdin-content` (`service.rs`) | 읽기, 삽입, 수정, 삭제, 링크 테이블 쓰기, 배치 populate 쿼리 |

빌더는 SQL 텍스트와 `ident()` 이름(flavor에 맞게 인용)을 넣고 `param()`으로 파라미터를 모으므로, SQL 작성과 값 바인딩이 한곳에서 일어납니다.

### 방언별 컬럼 타입

| 모델 타입 | PostgreSQL | MySQL / MariaDB | SQLite |
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

SQLite는 날짜와 시간을 고정 형식 텍스트로 저장하므로 텍스트 순서가 시간 순서와 일치합니다. decimal도 텍스트로 저장하므로 저장할 때 반올림되는 것이 없습니다. 하지만 decimal은 텍스트 순서가 숫자 순서가 아니므로, SQLite에서 decimal에 대한 필터와 정렬은 컬럼을 `REAL`로 캐스팅합니다. 이 비교는 유효숫자 약 15자리까지 정확하며, 반환되는 값은 여전히 정확합니다. 어떤 속성이 어떤 모델 타입에 대응하는지는 [속성 타입](/ko/reference/attribute-types/)에 있습니다.

MySQL과 MariaDB 테이블은 `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`와 악센트·대소문자를 구분하지 않는 collation으로 만듭니다: MySQL은 `utf8mb4_0900_ai_ci`, MariaDB는 `utf8mb4_uca1400_ai_ci`.

## 방언 차이

| 주제 | PostgreSQL | MySQL 8.4 | MariaDB | SQLite | Verdin의 처리 방식 |
|---|---|---|---|---|---|
| 삽입된 id | `RETURNING` | `RETURNING` 없음 | 드라이버 id | 드라이버 id | `insert_returning_id()` |
| 트랜잭션 DDL | 예 | 아니요(암묵적 커밋) | 아니요 | 예 | MySQL과 MariaDB에서는 단계 저널([마이그레이션](/ko/internals/migrations/) 참고) |
| JSON | `jsonb` | `json` | `LONGTEXT`의 별칭 | text | 스키마 기반 디코딩 |
| 불리언 | `boolean` | `tinyint(1)` | `tinyint(1)` | integer | 스키마 기반 디코딩 |
| 날짜시간 | `timestamptz` | `datetime(3)` | `datetime(3)` | ISO 텍스트 | 항상 UTC. MySQL 계열 세션은 시간대 `+00:00` 사용 |
| 문자 집합과 collation | UTF-8 | `utf8mb4`, `utf8mb4_0900_ai_ci` | `utf8mb4`, `utf8mb4_uca1400_ai_ci` | UTF-8, binary | 테이블마다 명시적으로 설정 |
| 정확한 텍스트 일치(`$eq`, `$in`…) | `=` | `COLLATE utf8mb4_bin` | 동일 | `=` | 모든 엔진에서 같은 결과 |
| `$contains`, `$startsWith`, `$endsWith` | `LIKE` | `LIKE … COLLATE utf8mb4_bin` | 동일 | `instr()` / `substr()` | SQLite의 `LIKE`는 ASCII 대소문자를 무시하므로 대소문자 구분 일치에는 쓰지 않음 |
| `$containsi` 등 `…i` 연산자 | `ILIKE` | `LIKE`(대소문자 무시 collation) | 동일 | `LIKE` | SQLite는 ASCII만 대소문자 구분 안 함 |
| JSON 경로 필터 | `#>>` | `JSON_VALUE` | 동일 | `json_extract` | 방언별 피연산자 |
| JSON 배열 필터 | `jsonb_array_elements` | `JSON_TABLE` | 동일 | `json_each` | 항목에 대한 `EXISTS` |
| `ALTER COLUMN` | 전체 지원 | `MODIFY COLUMN` | 동일 | 지원 안 함 | SQLite: 테이블 재구성(생성, 복사, 삭제, 이름 변경) |
| 행 잠금 | `FOR UPDATE` | `FOR UPDATE` | `FOR UPDATE` | 없음 | SQLite에서는 생략. 쓰기 트랜잭션이 데이터베이스를 잠금 |
| 고유 텍스트 인덱스 길이 | — | 3,072바이트 | 동일 | — | `utf8mb4`의 `varchar(255)`는 1,020바이트. `text`는 고유할 수 없음 |
| 행 크기 | — | 65,535바이트 | 동일 | — | 타입당 `string`, `email`, `uid`, `enumeration` 속성 최대 60개 |

`LIKE` 패턴은 사용자 입력의 `%`, `_`, 그리고 이스케이프 문자 자체(`!`)를 이스케이프합니다. MySQL과 MariaDB의 기본 collation은 대소문자와 악센트를 무시하므로, 정확한 연산자는 binary collation을 추가합니다. 그래서 `$eq`가 MySQL에서도 PostgreSQL과 같은 뜻이 됩니다. JSON 경로에서 `JSON_VALUE`는 binary collation 문자열을 반환하므로, 대소문자 무시 연산자는 양쪽에 `LOWER()`를 적용해 비교합니다.

`ORDER BY`는 양방향 모두 NULL을 마지막에 두고 항상 `id`로 끝나므로, 모든 엔진에서 페이지네이션이 안정적입니다.
