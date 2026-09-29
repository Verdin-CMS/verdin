---
title: 테스트
description: Rust 단위 테스트부터 여섯 데이터베이스에서 실행되는 적합성 스위트, 관리자 패널의 단위 테스트와 Playwright 테스트, 모든 변경을 통제하는 CI 작업까지 Verdin을 테스트하는 방법.
sidebar:
  order: 7
---

이 페이지에서는 테스트 스위트, 각각을 로컬에서 실행하는 방법, CI가 모든 pull request에서 확인하는 것을 설명합니다. 그 바탕에 있는 규칙은 하나입니다. 지원하는 모든 데이터베이스에서 통과하기 전까지 기능은 끝난 것이 아닙니다.

## Rust 테스트

전부 실행하려면 다음을 씁니다.

```sh title="Terminal"
cargo test --workspace
```

설정이 없으면 테스트는 SQLite를 씁니다. 세 가지 종류가 있습니다.

| 종류 | 위치 | 대상 |
|---|---|---|
| 단위 테스트 | 각 크레이트의 `#[cfg(test)]` 모듈 | 스키마 파싱과 검증, 이름 규칙, diff와 플랜, 쿼리 파싱, 방언별 SQL 생성, 값 인코딩, 입력 검증 |
| 크레이트 통합 테스트 | `crates/*/tests/` | 연결과 flavor 감지(`verdin-db`), 마이그레이션 적용(`verdin-migrate`), 인증 흐름(`verdin-auth`), GraphQL, 플러그인, S3 스토리지 |
| API 테스트 | `crates/verdin-api/tests/api/` | 적합성 스위트를 포함한, 콘텐츠 API와 admin API에 대한 HTTP 요청 |

**DDL 스냅샷.** `crates/verdin-migrate/tests/sql_snapshots.rs`는 예제 스키마의 DDL을 방언마다 만들어 `crates/verdin-migrate/tests/snapshots/`의 [`insta`](https://insta.rs) 스냅샷과 비교합니다. 의도적으로 DDL을 바꿨다면 `cargo insta review`(`cargo-insta`)로 새 스냅샷을 검토하고 받아들인 뒤 커밋하세요.

**API 테스트**는 링크 시간과 `target/` 크기를 줄이기 위해 테스트 바이너리 하나(`tests/api/main.rs`, 영역마다 모듈 하나)에 있습니다. `tests/api/common/mod.rs`의 하네스는 테스트마다 새로 마이그레이션한 데이터베이스 위에 `/api`의 콘텐츠 API와 `/admin/api`의 admin API를 만듭니다. 테스트가 다른 토큰을 넘기거나 토큰을 넘기지 않는 경우가 아니면, 요청은 전체 접근 API 토큰을 담습니다.

## 여섯 데이터베이스 매트릭스

데이터베이스를 쓰는 모든 테스트는 `VERDIN_TEST_DATABASE_URL`을 읽으며, 기본값은 인메모리 SQLite입니다. `verdin-testkit`은 테스트마다 자체 데이터베이스를 줍니다. 임시 SQLite 파일이거나, 서버에 만들었다가 끝나면 삭제하는 새 `vd_test_…` 데이터베이스입니다.

CI는 엔진마다 워크스페이스 전체를 한 번씩 실행합니다.

| 엔진 | 이미지 |
|---|---|
| SQLite | 번들 |
| PostgreSQL 14 | `postgres:14-alpine` |
| PostgreSQL 17 | `postgres:17-alpine` |
| MySQL 8.4 | `mysql:8.4` |
| MariaDB 10.11 | `mariadb:10.11` |
| MariaDB 11.4 | `mariadb:11.4` |

[최소 버전](/ko/internals/database/#최소-버전)과 Verdin을 테스트하는 가장 최신 버전입니다. CI는 `VERDIN_TEST_EXPECT_FLAVOR`도 설정해 `crates/verdin-db/tests/connect.rs`가 엔진을 올바르게 감지했는지 확인하게 합니다(MariaDB는 `mysql://` URL로 접속하지만 여전히 MariaDB로 감지되어야 함).

매트릭스를 로컬에서 실행하려면 Docker로 데이터베이스를 시작하세요.

```sh title="Terminal"
docker compose -f docker/compose.dev.yml up -d
```

그다음 엔진마다 테스트를 실행합니다. 테스트는 테스트마다 데이터베이스를 만들므로 MySQL과 MariaDB에서는 `root`로 접속합니다.

```sh title="Terminal"
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5414/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5417/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3384/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3311/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3314/verdin cargo test --workspace
```

포트는 PostgreSQL 14와 17, MySQL 8.4, MariaDB 10.11과 11.4에 대응합니다. 같은 compose 파일이 미디어와 이메일 작업을 위해 RustFS(포트 9000의 S3 호환 스토리지)와 Mailpit(포트 1025의 SMTP, 포트 8025의 받은 편지함)도 시작합니다.

## 적합성 스위트

`crates/verdin-api/tests/api/conformance.rs`는 모든 엔진에서 콘텐츠 API에 같은 HTTP 요청을 보내고 응답을 확인합니다. 생성, 읽기, 수정, 삭제 왕복, 입력 검증, 초안과 게시, 필터와 텍스트 일치 규칙, 정렬과 페이지네이션, 필드 타입과 populate, 고유 값, 싱글 타입, 콘텐츠 API 접근 규칙, OpenAPI 문서, 컴포넌트 필드 필터입니다. `tests/api/`의 다른 모듈(`filters.rs`, `populate.rs`, `relations.rs`, `components.rs`, `morph.rs`, `i18n.rs`…)도 같은 방식으로 각 영역을 다루므로, `verdin-api` 테스트 바이너리 전체가 사실상 적합성 스위트입니다.

방언 차이를 고쳤다면 여기에 사례를 추가하세요. PostgreSQL에서 통과하고 MySQL에서 실패하는 테스트야말로 이 스위트가 잡으려는 것입니다.

## 관리자 패널 테스트

**단위 테스트**는 `admin/src/app`의 코드 옆에 있는 `*.spec.ts` 파일이며, jsdom에서 Angular unit-test builder를 통해 Vitest로 실행합니다. 순수 모델을 다룹니다: 폼 모델 변환, 필드 규칙, 목록 필터와 보기, 권한, ICU transpiler, 주의 시작 등.

```sh title="Terminal"
cd admin
npx ng test --watch=false
```

**end-to-end 테스트**는 `admin/e2e/`의 Playwright 스펙입니다. `e2e/serve.sh`가 버릴 프로젝트(예제 WebAssembly 플러그인 포함)를 만들고, SQLite로 포트 1393에서 `verdin dev`를 시작해 `admin/dist/admin/browser`에서 관리자 패널을 제공합니다. 테스트는 영어 UI의 Chromium에서 하나씩 실행합니다.

```sh title="Terminal"
cd admin
npx ng build
cargo build -p verdin
npx playwright install chromium
npx playwright test
```

스펙은 로그인과 2단계 인증, 항목 편집기, 다형성 관계, 검토 워크플로, 팀과 거버넌스 기능, 멘션, 가져오기와 내보내기, 편집 보기, 저장하지 않은 변경 가드를 다룹니다.

## CI

`.github/workflows/ci.yml`은 `main`에 대한 모든 push와 모든 pull request에서 실행됩니다. 모든 Rust 작업은 `RUSTFLAGS=-D warnings`로 빌드합니다.

| 작업 | 확인하는 것 |
|---|---|
| `lint` | `cargo fmt --all --check`, `cargo clippy --workspace --all-targets`, `cargo deny`(라이선스와 보안 권고) |
| `test (sqlite)` | 인메모리 SQLite에서 `cargo test --workspace` |
| `test (…)` | PostgreSQL 14와 17, MySQL 8.4, MariaDB 10.11과 11.4에서 각각 작업 하나씩, Docker 서비스로 `cargo test --workspace` |
| `test (s3 storage, RustFS)` | RustFS 컨테이너를 대상으로 `cargo test -p verdin-upload --test s3` |
| `admin` | Prettier 검사, `npm run i18n:check`, `npm audit --audit-level=high`, 단위 테스트, `ng build`, `cargo build -p verdin --features embed-admin`, Playwright |
| `client` | `packages/client`가 워크스페이스와 같은 버전인지 확인한 뒤 타입 검사, 테스트, 빌드 |
| `site` | `npm audit`, 그리고 깨진 내부 링크가 하나라도 있으면 실패하는 문서 빌드 |

실패한 Playwright 실행은 trace를 아티팩트로 업로드하며, 7일 동안 보관합니다.
