---
title: 명령줄 레퍼런스
description: verdin 바이너리의 모든 명령, 하위 명령, 플래그와 각각이 읽고, 쓰고, 출력하는 것.
sidebar:
  order: 2
  label: 명령줄
---

<!-- Written from crates/verdin/src/cli.rs and crates/verdin/src/new.rs. `npm run check-cli`
(site/scripts/check-cli.mjs) fails when a subcommand or flag in cli.rs is missing here. -->

`verdin`은 유일한 바이너리입니다. 프로젝트를 만들고, 서버를 실행하고, 마이그레이션을 적용하고, 관리자 사용자를 관리하고,
콘텐츠를 들여오고 내보냅니다. 이 페이지에서는 모든 명령과 플래그를 나열합니다.

```text title="Terminal"
verdin [OPTIONS] <COMMAND>
```

| 명령 | 하는 일 |
| --- | --- |
| [`verdin new`](#verdin-new) | 프로젝트 디렉터리를 만듭니다. |
| [`verdin dev`](#verdin-dev) | 개발 모드로 서버를 실행합니다. |
| [`verdin start`](#verdin-start) | 프로덕션 모드로 서버를 실행합니다. |
| [`verdin schema check`](#verdin-schema-check) | 스키마 파일을 검증합니다. |
| [`verdin migrate plan`](#verdin-migrate-plan) | 마이그레이션 단계와 SQL을 보여 줍니다. |
| [`verdin migrate apply`](#verdin-migrate-apply) | 마이그레이션 단계를 적용합니다. |
| [`verdin admin create`](#verdin-admin-create) | Super Admin을 만듭니다. |
| [`verdin admin reset-password`](#verdin-admin-reset-password) | 관리자의 비밀번호를 설정합니다. |
| [`verdin types`](#verdin-types) | 콘텐츠 API의 TypeScript 정의를 생성합니다. |
| [`verdin import strapi`](#verdin-import-strapi) | Strapi 내보내기를 가져옵니다. |
| [`verdin import verdin`](#verdin-import-verdin) | Verdin 내보내기를 가져옵니다. |
| [`verdin export`](#verdin-export) | 프로젝트를 `.tar.gz` 아카이브로 씁니다. |
| [`verdin healthcheck`](#verdin-healthcheck) | 로컬 서버가 응답하는지 확인합니다. |
| [`verdin secrets`](#verdin-secrets) | 새 시크릿을 출력합니다. |
| [`verdin version`](#verdin-version) | 버전을 출력합니다. |

## 전역 옵션

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `-c, --config <CONFIG>` | `verdin.toml` | 프로젝트의 설정 파일. `VERDIN_CONFIG`에서도 읽습니다. 프로젝트 루트는 이 파일의 디렉터리이며, 스키마, 플러그인, 업로드, 상대 SQLite 경로는 여기를 기준으로 해석합니다. |
| `-h, --help` | | 명령의 도움말을 출력합니다. |
| `-V, --version` | | 버전을 출력합니다. |

`verdin help <COMMAND>`는 `--help`와 같은 도움말을 출력합니다.

`new`, `secrets`, `version`을 제외한 모든 명령은 먼저 프로젝트를 로드합니다.

1. 설정 파일 옆에 `.env` 파일이 있으면 읽습니다. 이미 환경에 설정된 변수가 우선합니다.
2. `verdin.toml`(선택 사항)과 `VERDIN_*` 재정의를 로드합니다. [설정 레퍼런스](/ko/reference/configuration/)를 참고하세요.
3. `[log]`와 `RUST_LOG`에 따라 표준 오류로 로그를 시작합니다.

데이터베이스를 여는 명령에는 `VERDIN_DATABASE_URL` 또는 `[database].url`이 필요합니다. 관리자 계정을 다루거나 서버를
실행하는 명령에는 `VERDIN_ADMIN_JWT_SECRET`과 `VERDIN_TOKEN_PEPPER`도 필요합니다.

## `verdin new`

```text title="Terminal"
verdin new <DIR> [--database <DATABASE>]
```

`DIR`에 프로젝트를 만듭니다. `DIR`은 존재하지 않거나 비어 있어야 합니다.

| 파일 | 내용 |
| --- | --- |
| `verdin.toml` | 기본값을 가진 `[server]`, `[api]`, `[admin]`. |
| `.env` | `VERDIN_DATABASE_URL`, 새로 만든 `VERDIN_ADMIN_JWT_SECRET`과 `VERDIN_TOKEN_PEPPER`. 본인만 읽을 수 있습니다(Unix에서 모드 `0600`). |
| `.gitignore` | `.env`, `data/`, SQLite 파일, `.cache/`. |
| `schema/content-types/`, `schema/components/` | 빈 스키마 디렉터리. |
| `data/` | SQLite 데이터베이스용(SQLite만). |

| 인자 또는 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `<DIR>` | | 만들 디렉터리. |
| `--database <DATABASE>` | `sqlite` | `.env`가 가리키는 데이터베이스: `sqlite`, `postgres`, `mysql`, `mariadb`. |

`sqlite`면 URL은 `sqlite://data/verdin.db`입니다. 나머지는 사용자 `verdin`, 비밀번호 `change-me`, 디렉터리 이름(소문자, 숫자,
`_`)을 딴 데이터베이스를 쓰는 로컬 서버 URL입니다. 시작하기 전에 편집하세요.

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

개발 모드로 서버를 실행합니다. `verdin start`와 비교하면 다음과 같습니다.

- 위험 수준이 `safe`인 대기 중인 마이그레이션은 시작할 때 적용됩니다. 더 위험한 단계는 서버를 멈추게 하니
  [`verdin migrate plan`](#verdin-migrate-plan)으로 검토하세요.
- 관리자 패널의 **콘텐츠 타입 빌더**가 스키마 파일을 편집하고, 서버가 스키마를 다시 로드합니다.
- 리프레시 쿠키에 `Secure`가 붙지 않으므로(`[admin].secure_cookies`가 지정하지 않는 한) 일반 HTTP로 로그인할 수 있습니다.
- 웹훅과 배포 대상이 루프백과 사설 주소를 호출할 수 있습니다(`[webhooks].allow_private_networks`가 달리 지정하지 않는 한).

Ctrl+C나 `SIGTERM`으로 멈춥니다.

## `verdin start`

```text title="Terminal"
verdin start [--migrate]
```

프로덕션 모드로 서버를 실행합니다. 데이터베이스가 스키마보다 뒤처져 있으면 시작을 거부하므로, 배포가 검토하지 않은 테이블을
바꾸는 일은 없습니다.

| 옵션 | 설명 |
| --- | --- |
| `--migrate` | 시작하기 전에 대기 중인 `safe` 마이그레이션 단계를 적용합니다. risky와 destructive 단계는 여전히 `verdin migrate apply`가 필요합니다. |

수신을 시작하기 전에 설정을 확인하고(`[api].prefix`와 `[admin].path`가 `/api` 같은 형태인지, 페이지 크기가 일관적인지,
`[server].trusted_proxies`와 `[api].cors_origins`가 파싱되는지) 기본 제공 역할을 만듭니다. `[admin].secure_cookies`가
`false`이거나 `[email].provider`가 `log`면 경고를 남깁니다. 아직 관리자가 없으면 관리자 패널 주소를 로그에 남기며, 그곳의
첫 방문자가 첫 Super Admin을 등록합니다.

Ctrl+C나 `SIGTERM`으로 멈춥니다.

## `verdin schema check`

```text title="Terminal"
verdin schema check
```

데이터베이스를 건드리지 않고 스키마 파일(`[schema].path`)을 검증합니다. 요약을 출력하거나, 파일과 속성 경로가 붙은 오류와
함께 실패합니다.

```text title="Terminal"
$ verdin schema check
schema ok: 4 content types, 3 components
```

배포 전에 CI에서 쓰세요. 각 속성이 받는 값은 [속성 타입](/ko/reference/attribute-types/)을 참고하세요.

## `verdin migrate plan`

```text title="Terminal"
verdin migrate plan [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

데이터베이스를 스키마와 비교하고, 아무것도 바꾸지 않은 채 `verdin migrate apply`가 할 일을 출력합니다. 번호가 매겨진
단계이며, 각각 위험 수준과 SQL이 있습니다. 할 일이 없으면 `database is up to date`를 출력합니다.

| 옵션 | 설명 |
| --- | --- |
| `--rename-table <OLD=NEW>` | 하나를 삭제하고 다른 하나를 만드는 대신 테이블 `OLD`를 `NEW`로 이름을 바꾼 것으로 취급합니다(행 유지). 반복 가능. |
| `--rename-column <TABLE.OLD=NEW>` | `TABLE`의 컬럼 `OLD`를 `NEW`로 이름을 바꾼 것으로 취급합니다(값 유지). `TABLE`은 테이블의 새 이름입니다. 반복 가능. |

위험 수준:

| 수준 | 의미 |
| --- | --- |
| `safe` | 데이터를 잃거나 기존 행 때문에 실패할 수 없습니다: 새 테이블, nullable이거나 기본값이 있는 새 컬럼, 이름 변경, 고유하지 않은 인덱스. |
| `risky` | 기존 행 때문에 실패하거나 값을 변환할 수 있습니다: 컬럼 타입 변경, nullable이 아니고 기본값이 없는 새 컬럼, 기존 테이블의 고유 인덱스. |
| `destructive` | 컬럼이나 테이블을 삭제합니다. |

단계가 `safe`보다 높으면 플랜은 필요한 플래그로 끝납니다(`requires: verdin migrate apply --allow risky`). 삭제된 컬럼이나
테이블이 이름이 바뀐 것처럼 보이면 넘길 이름 변경 플래그를 나열합니다. 이전 마이그레이션이 중단되었으면 적용된 단계 수와
마지막 오류를 보여 줍니다.

```text title="Terminal"
verdin migrate plan --rename-column articles.summary=excerpt
```

[스키마 마이그레이션](/ko/concepts/schema-migrations/)을 참고하세요.

## `verdin migrate apply`

```text title="Terminal"
verdin migrate apply [--allow <ALLOW>] [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

플랜을 적용합니다. `verdin migrate plan`과 같은 이름 변경 옵션을 받으며, 검토한 것과 같은 옵션을 넘기세요.

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `--allow <ALLOW>` | `safe` | 적용할 최고 위험 수준: `safe`, `risky`, `destructive`. 그보다 높은 단계가 있는 플랜은 아무것도 실행하기 전에 거부됩니다. |
| `--rename-table <OLD=NEW>` | | `verdin migrate plan`과 같음. |
| `--rename-column <TABLE.OLD=NEW>` | | `verdin migrate plan`과 같음. |

`applied N steps` 또는 `database is up to date`를 출력합니다. 중단된 뒤에는(연결이 끊기거나 단계가 실패함) 원인을 고치고
다시 실행하세요. 완료되지 않은 단계부터 재개합니다.

## `verdin admin create`

```text title="Terminal"
verdin admin create --email <EMAIL>
```

Super Admin을 만듭니다. 비밀번호는 `VERDIN_ADMIN_PASSWORD`에서 읽고, 설정되어 있지 않으면 표준 입력에서 읽습니다.
데이터베이스가 스키마와 맞는 최신 상태여야 합니다.

| 옵션 | 설명 |
| --- | --- |
| `--email <EMAIL>` | 새 관리자의 이메일 주소. |

```text title="Terminal"
$ VERDIN_ADMIN_PASSWORD='a long passphrase' verdin admin create --email ada@example.com
created Super Admin ada@example.com (id 1)
```

아직 브라우저로 접근할 수 없는 서버의 첫 관리자를 만들 때 쓰세요. 그렇지 않으면 관리자 패널의 첫 방문자가 등록합니다.

## `verdin admin reset-password`

```text title="Terminal"
verdin admin reset-password --email <EMAIL>
```

관리자의 비밀번호를 설정하고, 로그인 실패 후의 계정 잠금을 풀고, 모든 세션을 끝냅니다. 비밀번호는 `verdin admin create`와
같은 방식으로 읽습니다.

| 옵션 | 설명 |
| --- | --- |
| `--email <EMAIL>` | 관리자의 이메일 주소. |

두 번째 인증 수단은 제거하지 않습니다. **사용자 관리**를 가진 관리자가 **설정 → 사용자**에서 재설정할 수 있습니다.

## `verdin types`

```text title="Terminal"
verdin types [-o <OUT>]
```

스키마로 콘텐츠 API의 TypeScript 정의(콘텐츠 타입과 컴포넌트마다 인터페이스 하나)를 생성해 표준 출력으로 출력합니다.
데이터베이스가 필요 없습니다.

| 옵션 | 설명 |
| --- | --- |
| `-o, --out <OUT>` | 대신 이 파일에 씁니다. |

```text title="Terminal"
verdin types --out ../web/src/verdin.d.ts
```

[타입 클라이언트](/ko/guides/frontend/typed-client/)를 참고하세요.

## `verdin import strapi`

```text title="Terminal"
verdin import strapi <PATH> [--schema-only] [--force]
```

`strapi export --no-encrypt`로 만든 내보내기(`.tar.gz`, `.tar`, 또는 압축을 푼 디렉터리)에서 Strapi v4 또는 v5 프로젝트를
가져옵니다. 콘텐츠 타입과 컴포넌트를 스키마 파일로 쓴 뒤 항목, 로케일, 미디어, 관계, 폴더를 가져옵니다.

| 인자 또는 옵션 | 설명 |
| --- | --- |
| `<PATH>` | 내보내기 파일이나 디렉터리. |
| `--schema-only` | 스키마 파일만 씁니다. |
| `--force` | 기존 스키마 파일을 덮어쓰고, 이미 항목이 있는 콘텐츠 타입으로도 가져옵니다. |

쓰고 가져온 것을 출력하고, 옮기지 못한 것에 대한 경고를 남기며, 프로젝트 루트에 `strapi-id-map.json`을 씁니다. 프런트엔드의
링크를 고칠 수 있도록 Strapi id와 새 Verdin `documentId`, 파일 id를 담습니다.

[Strapi에서 마이그레이션](/ko/migrate/from-strapi/)을 참고하세요.

## `verdin import verdin`

```text title="Terminal"
verdin import verdin <PATH> [--force]
```

`verdin export`가 쓴 아카이브를 가져옵니다: 스키마 파일, 로케일, 미디어, 항목.

| 인자 또는 옵션 | 설명 |
| --- | --- |
| `<PATH>` | `.tar.gz` 파일. |
| `--force` | 내용이 다른 스키마 파일을 덮어쓰고, 이미 항목이 있는 콘텐츠 타입으로도 가져옵니다. |

## `verdin export`

```text title="Terminal"
verdin export <OUTPUT> [--no-media]
```

프로젝트의 스키마, 콘텐츠, 미디어를 `.tar.gz` 아카이브로 씁니다. 백업이나, `verdin import verdin`으로 프로젝트를 다른
인스턴스로 옮기는 데 씁니다. 아카이브에는 모든 항목의 모든 버전(초안, 게시 버전, 로케일)과 관계가 들어 있습니다. 관리자 계정,
API 토큰, 설정은 포함되지 않습니다.

| 인자 또는 옵션 | 설명 |
| --- | --- |
| `<OUTPUT>` | 쓸 아카이브. |
| `--no-media` | 미디어 라이브러리를 뺍니다: 파일, 폴더, 항목에서 그것들로 가는 링크. |

```text title="Terminal"
$ verdin export backup.tar.gz
exported to backup.tar.gz: 42 documents (57 versions), 18 files, 3 folders, 2 locales
```

[백업](/ko/deploy/backups/)을 참고하세요.

## `verdin healthcheck`

```text title="Terminal"
verdin healthcheck [--port <PORT>]
```

이 머신의 서버(`127.0.0.1`, 설정의 `[server].port`)에 `GET /_health`를 요청하고, `200`으로 응답하면 상태 0으로, 아니면
이유를 출력하고 1로 종료합니다. 셸, `curl`, HTTP 클라이언트가 필요 없으므로 Docker 이미지가 `HEALTHCHECK`로 씁니다.
Compose나 명령을 실행하는 어떤 수퍼바이저에서도 같은 방식으로 쓰세요.

| 옵션 | 설명 |
| --- | --- |
| `--port <PORT>` | `[server].port` 대신 이 포트를 확인합니다. |

```text title="Terminal"
$ verdin healthcheck
ok
```

[모니터링](/ko/deploy/monitoring/)을 참고하세요.

## `verdin secrets`

```text title="Terminal"
verdin secrets
```

`.env` 파일이나 플랫폼의 시크릿 저장소에 바로 쓸 수 있는 새 `VERDIN_ADMIN_JWT_SECRET`과 `VERDIN_TOKEN_PEPPER`를 출력합니다.
프로젝트를 읽지 않습니다.

`VERDIN_ADMIN_JWT_SECRET`을 바꾸면 관리자와 최종 사용자의 수명이 짧은 액세스 토큰, 열린 미리 보기 링크, 진행 중인 OAuth
로그인이 무효가 됩니다. 관리자 패널과 리프레시 토큰을 쓰는 클라이언트는 스스로 새 토큰을 받습니다. `VERDIN_TOKEN_PEPPER`를
바꾸면 저장된 토큰(API 토큰 포함)이 무효가 되므로, 한번 쓰기 시작했으면 유지하세요.

## `verdin version`

```text title="Terminal"
verdin version
```

`verdin --version`처럼 `verdin`과 버전을 출력합니다.
