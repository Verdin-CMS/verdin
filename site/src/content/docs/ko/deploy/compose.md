---
title: 프로덕션의 Docker Compose
description: 서버 한 대를 위한 프로덕션 Compose 레시피 — Verdin, PostgreSQL, 자동 HTTPS를 제공하는 Caddy, 그리고 S3 호환 미디어를 위한 선택 사항 RustFS.
sidebar:
  order: 3
---

[`deploy/compose/`](https://github.com/verdin-cms/verdin/tree/main/deploy/compose)는 서버 한 대를 위한 완성된
구성입니다. Verdin과 PostgreSQL은 사설 네트워크에 두고, 앞에는 인증서를 스스로 받고 갱신하는 Caddy를 둡니다.
오버라이드 파일은 같은 호스트의 S3 호환 스토어인 RustFS를 미디어용으로 추가합니다.
[Docker](/ko/deploy/docker/)에서 이 파일들이 쓰는 이미지를 설명합니다.

파일은 2026-09-30에 `docker compose config`와 `caddy validate`로 확인했습니다.

## 파일

| 파일 | 설명 |
| --- | --- |
| `compose.yaml` | `verdin`, `db`(PostgreSQL 17), `caddy`. 포트를 게시하는 것은 Caddy뿐입니다(80, 443, HTTP/3용 443/udp). |
| `compose.s3.yaml` | `rustfs`와, 공개 읽기 `media` 버킷을 만드는 일회성 작업을 추가하고 Verdin의 업로드 프로바이더를 그쪽으로 바꿉니다. |
| `Caddyfile` | `$VERDIN_DOMAIN`의 TLS, 압축, `/media/*`는 RustFS로, 나머지는 모두 Verdin으로. |
| `.env.example` | Compose가 읽는 변수: 도메인, ACME 이메일, 이미지 태그, 비밀번호. |

## 설정하기

필요한 것: Docker가 있는 서버, 그 서버를 가리키는 도메인의 DNS 레코드, 열려 있는 80과 443 포트.

1. 디렉터리를 서버에 복사하고 `.env`를 채웁니다.

   ```sh frame="terminal"
   cp .env.example .env                                  # VERDIN_DOMAIN, ACME_EMAIL
   echo "DB_PASSWORD=$(openssl rand -hex 24)" >> .env
   docker run --rm ghcr.io/verdin-cms/verdin:0.11 secrets > verdin.env
   ```

2. 커밋한 스키마를 `schema/`(`content-types/`와 `components/`)에 둡니다. `/app/schema`에 읽기 전용으로
   마운트됩니다.
3. 시작합니다.

   ```sh frame="terminal"
   docker compose up -d
   docker compose logs -f verdin
   ```

4. `https://<your domain>/admin/`을 열고 첫 관리자를 등록합니다.

`.env`와 `verdin.env`는 버전 관리에 넣지 말고 백업해 두세요. `VERDIN_TOKEN_PEPPER`가 새로 바뀌면 모든 API
토큰이 무효화됩니다.

## S3의 미디어

기본적으로 업로드는 `verdin-data` 볼륨에 저장됩니다. 대신 RustFS에 저장하려면:

```sh frame="terminal"
echo "S3_SECRET_KEY=$(openssl rand -hex 24)" >> .env
docker compose -f compose.yaml -f compose.s3.yaml up -d
```

그러면 파일은 Caddy가 `https://<your domain>/media/<key>`로 제공합니다. AWS S3, Cloudflare R2, 다른
프로바이더라면 RustFS 서비스를 빼고 `VERDIN_UPLOAD__PROVIDER__*` 변수와 `AWS_*` 자격 증명을 그 프로바이더의
값으로 설정하세요([스토리지](/ko/internals/storage/) 참고). 기존 사이트를 전환해도 파일은 옮겨지지 않습니다.
새 업로드만 새 프로바이더로 갑니다.

## 참고

- **클라이언트 주소.** Verdin은 Compose 네트워크(`172.30.0.0/24`, `compose.yaml`에 고정)의 `X-Forwarded-For`를
  신뢰하며, 그곳에서는 Caddy가 유일한 프록시입니다. 이 범위가 사용 중인 네트워크와 겹치면 둘 다 바꾸세요.
- **실시간.** Caddy는 `text/event-stream` 응답을 버퍼링 없이 스트리밍하므로 [실시간 이벤트](/ko/guides/frontend/realtime/)가
  그 뒤에서도 그대로 동작합니다.
- **업그레이드.** `.env`의 `VERDIN_VERSION`을 바꾼 뒤 `docker compose pull && docker compose up -d`를 실행하세요.
  먼저 [업그레이드](/ko/migrate/upgrading/)를 읽으세요.
- **백업.** PostgreSQL을 덤프하고 `verdin-data` 볼륨(또는 버킷)을 보관하세요. [백업](/ko/deploy/backups/)을
  참고하세요.
- **관리자 명령.** 이미지에는 셸이 없습니다: `docker compose exec verdin verdin admin create --email you@example.com`.
