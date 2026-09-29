---
title: 백업
description: 데이터베이스 덤프와 미디어 스토리지 사본으로 Verdin 프로젝트를 백업하거나, verdin export와 verdin import verdin으로 옮깁니다.
sidebar:
  order: 9
---

Verdin 프로젝트의 데이터는 두 곳에 있습니다. **데이터베이스**(콘텐츠, 관리자, 역할, 토큰, 설정, 기록,
감사 로그)와 **미디어 스토리지**(디스크나 버킷에 있는 미디어 라이브러리의 파일)입니다. 스키마 파일은
저장소에 있습니다. 두 저장소를 모두 백업하세요. `verdin export`는 콘텐츠의 이식 가능한 아카이브를 더해
줍니다.

| 방법 | 포함하는 것 | 용도 |
| --- | --- | --- |
| 데이터베이스 덤프 + 미디어 사본 | 전부 | 같은 프로젝트의 재해 복구 |
| `verdin export` | 스키마, 로케일, 미디어, 모든 항목의 모든 버전 | 다른 인스턴스나 데이터베이스 엔진으로 콘텐츠 이동, 추가로 두는 이식 가능한 사본 |

## 데이터베이스 덤프

데이터베이스 자체 도구나 프로바이더의 자동 백업을 쓰세요.

```sh frame="terminal"
# PostgreSQL
pg_dump --format=custom --file=verdin-$(date +%F).dump "$VERDIN_DATABASE_URL"

# MySQL / MariaDB
mysqldump --single-transaction --routines -h <host> -u <user> -p <database> > verdin-$(date +%F).sql

# SQLite: 서버가 실행 중일 때 일관된 사본 만들기
sqlite3 /data/verdin.db ".backup '/backups/verdin-$(date +%F).db'"
```

실행 중인 SQLite 파일을 `cp`로 복사하지 마세요. `.backup`을 쓰거나 서버를 먼저 멈추세요.

덤프에는 비밀번호 해시, API 토큰 해시, private 필드가 들어 있습니다. 암호화하고, 보호 대상인 서버와 떨어진
곳에 보관하세요. 덤프를 복원하려면 같은 `VERDIN_TOKEN_PEPPER`와 `VERDIN_ADMIN_JWT_SECRET`도 필요합니다.
pepper가 없으면 API 토큰과 관리자의 인증 앱 코드가 동작하지 않습니다.

## 미디어 스토리지

- **로컬 프로바이더**: 업로드 디렉터리(`[upload].provider.dir`, Docker 이미지에서는 `/data/uploads`)를
  평소 쓰는 파일 백업으로 복사하세요. 덤프가 참조하는 파일이 빠지지 않도록 데이터베이스 덤프 뒤에
  복사합니다.
- **S3 프로바이더**: 버킷의 버전 관리나 복제를 켜거나, 프로바이더의 도구로 버킷을 복사하세요.

이미지 변환 캐시와 검색 인덱스는 다시 만들 수 있으므로 백업할 필요가 없습니다.

## `verdin export`

`verdin export`는 프로젝트의 스키마, 콘텐츠, 미디어를 `.tar.gz` 하나로 쓰고, `verdin import verdin`은
이를 같은 프로젝트나 다른 인스턴스에, 어떤 데이터베이스 엔진이든 복원합니다.

```sh frame="terminal"
verdin export backup-2026-09-28.tar.gz            # 스키마, 로케일, 미디어, 항목
verdin export content-only.tar.gz --no-media      # 미디어 파일 제외
verdin import verdin backup-2026-09-28.tar.gz     # 이 프로젝트로
```

프로젝트 설정(서버와 같은 `verdin.toml`과 환경)으로 실행하세요. 컨테이너에서는
`docker compose exec verdin verdin export /data/backup.tar.gz`입니다.

### 포함되는 것

- **스키마 파일**, 있는 그대로.
- **로케일.** 빈 프로젝트는 기본 로케일을 포함해 전부 받습니다. 이미 로케일이 있는 프로젝트는 없는
  로케일만 받습니다.
- **미디어 폴더와 파일**, 반응형 포맷 포함. 파일은 `documentId`를 유지하며 숫자 id는 바뀝니다.
- **모든 항목의 모든 버전**: 초안, 게시 버전, 모든 로케일. 날짜, 관계(`documentId`로), 미디어를 포함하며,
  컴포넌트와 다이나믹 존 안의 관계와 미디어도 포함합니다. private 필드와 비밀번호 해시도 포함됩니다.

**포함되지 않는 것**: 관리자 사용자, 역할, API 토큰, 웹훅, 기능 설정, 검토 워크플로, 릴리스. 대상에서 다시
만들거나, 대신 데이터베이스 덤프를 복원하세요.

:::caution
내보내기에는 private 필드와 비밀번호 해시가 들어 있습니다. 데이터베이스 덤프처럼 보관하세요.
:::

### 가져오기

1. 가져오기는 스키마 파일을 쓰고 safe 단계만으로 데이터베이스를 마이그레이션합니다.
2. 이미 존재하면서 내용이 다른 스키마 파일이 있으면 `--force`를 넘기지 않는 한 멈춥니다.
3. 이미 항목이 있는 콘텐츠 타입이 있어도 `--force`를 넘기지 않는 한 멈춥니다. `--force`를 넘기면 항목이
   기존 항목 옆에 추가됩니다.
4. 가져온 문서는 `documentId`를 유지하므로, 같은 문서가 이미 있는 프로젝트로 가져오면 실패합니다.

가져오기는 웹훅이나 플러그인 훅을 실행하지 않으며 기록도 남기지 않습니다.

### 아카이브 형식

gzip으로 압축한 tar 아카이브입니다.

| 경로 | 내용 |
| --- | --- |
| `manifest.json` | `format: "verdin-export"`, 형식 버전, Verdin 버전, 콘텐츠 타입별 버전 수 |
| `schema/…` | 스키마 파일 |
| `locales.json` | `{ default, locales: [{ code, name }] }` |
| `folders.json`, `files.jsonl` | 미디어 폴더와 파일, 한 줄에 JSON 객체 하나 |
| `assets/{hash}{ext}` | 파일과 그 포맷의 저장된 객체 |
| `entries/{uid}.jsonl` | 한 줄에 버전 하나: `documentId`, `locale`, `published`, 날짜, `data`, `relations`, `media` |

대신 Strapi 프로젝트를 가져오려면 [Strapi에서 마이그레이션](/ko/migrate/from-strapi/)을 참고하세요.

## 복원 테스트

가끔씩 임시 데이터베이스에 복원하고, 그 위에서 `verdin start`로 Verdin을 시작한 뒤, 로그인하고 항목과
미디어를 읽을 수 있는지 확인하세요.
