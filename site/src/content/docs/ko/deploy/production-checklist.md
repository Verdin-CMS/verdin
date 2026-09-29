---
title: 프로덕션 체크리스트
description: Verdin 프로젝트가 실제 트래픽을 받기 전에 설정할 것 — 시크릿, 데이터베이스, 마이그레이션, URL, 프록시, 쿠키, CORS, 미디어 스토리지, 이메일, 백업, 모니터링.
sidebar:
  order: 1
---

Verdin 프로젝트를 실제 사용자 앞에 내놓기 전에 이 목록을 확인하세요. 각 항목은 자세히 설명하는 페이지로
연결됩니다. 플랫폼 페이지([Docker](/ko/deploy/docker/), [Fly.io](/ko/deploy/fly/),
[Render](/ko/deploy/render/), [Railway](/ko/deploy/railway/), [Kubernetes](/ko/deploy/kubernetes/))는
가능한 곳에서 이 설정을 대신 적용합니다.

## 프로덕션 서버 실행

- [ ] **`verdin dev`가 아니라 `verdin start`를 쓰세요.** `dev`는 콘텐츠 타입 빌더가 스키마 파일을 다시 쓰게
      하고, 변경할 때마다 마이그레이션을 적용하며, 로컬 작업을 위해 쿠키와 웹훅 규칙을 느슨하게 합니다.
      스키마는 개발 환경에서 바꾸고, 파일을 커밋하고, 배포하세요.
- [ ] **배포할 때 마이그레이션을 적용하세요.** `verdin start`는 데이터베이스가 스키마보다 뒤처져 있으면
      실행을 거부합니다. `verdin start --migrate`는 대기 중인 *safe* 단계를 먼저 적용합니다(Docker 이미지의
      기본 명령). risky나 destructive 단계(타입 변경, 새 고유 제약 조건, 컬럼 삭제)는
      `verdin migrate apply --allow risky|destructive`가 필요하며 직접 한 번 실행합니다.
      [스키마 마이그레이션](/ko/concepts/schema-migrations/)을 참고하세요.
- [ ] **스키마를 서버와 함께 배포하세요.** `schema/` 디렉터리를 읽기 전용으로 마운트하거나 이미지에 넣어서,
      커밋한 것이 그대로 실행되게 하세요.

## 시크릿

- [ ] **필수 시크릿 두 개를 한 번만 생성하세요.** `verdin secrets`로 만들어 플랫폼의 시크릿 저장소에
      보관합니다. `VERDIN_ADMIN_JWT_SECRET`은 세션 토큰에 서명하고, `VERDIN_TOKEN_PEPPER`는 API 토큰과
      그 밖의 저장된 시크릿 해시의 키입니다. 둘 중 하나라도 없거나 32바이트보다 짧으면 `verdin start`가
      실패합니다. 시크릿은 `verdin.toml`이 아니라 환경 변수에서만 읽습니다.
- [ ] **값을 바꾸지 마세요.** `VERDIN_TOKEN_PEPPER`를 바꾸면 모든 API 토큰이 동작하지 않고, 관리자의 인증
      앱 코드와 복구 코드도 마찬가지입니다. `VERDIN_ADMIN_JWT_SECRET`을 바꾸면 관리자와 최종 사용자의 수명이
      짧은 액세스 토큰, 열린 미리 보기 링크, 진행 중인 OAuth 로그인이 무효가 됩니다(관리자 패널과 리프레시
      토큰을 쓰는 클라이언트는 스스로 갱신합니다). 한 프로젝트의 모든 인스턴스는 같은 값을 써야 합니다.
- [ ] 사용하는 다른 시크릿도 환경 변수에 두세요: `VERDIN_EMAIL_SMTP_PASSWORD` 또는
      `VERDIN_EMAIL_API_KEY`, `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, `VERDIN_METRICS_TOKEN`,
      `VERDIN_SSO_<ID>_SECRET`, `VERDIN_IMAGE_SECRET`. 전체 목록은
      [설정 레퍼런스](/ko/reference/configuration/)에 있습니다.

## 데이터베이스

- [ ] **엔진을 고르세요.** 보통은 PostgreSQL(14 이상)이며, [여러 인스턴스](/ko/deploy/scaling/)를 실행할
      계획이면 PostgreSQL을 고르세요. MySQL 8.4+와 MariaDB 10.11+도 같은 방식으로 동작합니다. SQLite는
      영구 디스크를 가진 단일 인스턴스에 적합합니다.
- [ ] **`VERDIN_DATABASE_URL`을 설정하세요**: `postgres://…`, `mysql://…`(MySQL과 MariaDB), 또는
      `sqlite:///data/verdin.db`. TLS가 필요한 PostgreSQL 서버에는 `?sslmode=require`를 추가하세요.
- [ ] **풀 크기를 정하세요.** 각 인스턴스는 최대 `[database].pool_max`개(10)의 연결을 엽니다.
      `인스턴스 수 × pool_max`가 서버의 연결 한도보다 작게 유지하세요.

## URL, 프록시, 쿠키

- [ ] **HTTPS로 제공하세요.** Verdin은 일반 HTTP를 씁니다. TLS는 리버스 프록시, 로드 밸런서, 플랫폼의
      엣지에서 종료하세요.
- [ ] **`[server].public_url`**(`VERDIN_SERVER__PUBLIC_URL`)을 `https://cms.example.com`처럼 브라우저가
      쓰는 주소로 설정하세요. 이메일의 링크, SSO 콜백, 일일 다이제스트, 패스키가 이 값에 의존하며, 패스키는
      이 호스트에 묶입니다.
- [ ] <strong>`[server].trusted_proxies`</strong>를 리버스 프록시의 주소(IP 또는 CIDR 대역)로 설정하세요. 그래야
      Verdin이 `X-Forwarded-For`에서 클라이언트 주소를 읽습니다. 설정하지 않으면 프록시 뒤의 모든
      클라이언트가 요청 한도와 감사 로그에서 주소 하나를 공유합니다.
- [ ] **secure 쿠키를 켜 두세요.** `verdin start`에서 관리자 리프레시 쿠키는 기본적으로 `Secure`입니다.
      `[admin].secure_cookies`는 설정하지 마세요. 프로덕션에서 `false`로 설정하면 시작할 때 경고가 남습니다.

## API

- [ ] **공개적으로 필요한 것만 허용하세요.** 콘텐츠 API는 공개 권한(**설정 → 공개 접근**)을 허용하거나
      API 토큰을 만들기 전까지 닫혀 있습니다. [권한](/ko/concepts/permissions/)을 참고하세요.
- [ ] 다른 출처의 브라우저가 콘텐츠 API나 GraphQL을 호출하면 **`[api].cors_origins`를 설정하세요**. 예:
      `["https://www.example.com"]`. 설정하지 않으면 같은 출처의 페이지만 브라우저에서 호출할 수 있습니다.
      admin API는 교차 출처 요청에 절대 응답하지 않습니다.
- [ ] 익명 트래픽에 대한 **요청 한도를 고려하세요**: `[api].public_rate_limit`과
      `[api].token_rate_limit`(분당 요청 수. 기본값 `0`은 무제한).

## 미디어

- [ ] **재배포 후에도 남는 곳에 업로드를 저장하세요.** 기본 로컬 프로바이더는 디스크에 씁니다. 영구 볼륨을
      주거나 S3 프로바이더(AWS S3, Cloudflare R2, Backblaze B2, MinIO, Tigris…)를 쓰세요. 디스크가
      휘발성인 플랫폼이나 인스턴스가 여러 개인 경우에는 S3를 쓰세요. [미디어](/ko/concepts/media/)를
      참고하세요.

## 이메일

- [ ] **실제 프로바이더를 설정하세요.** 기본값인 `[email].provider = "log"`는 이메일을 로그에 쓰며,
      `verdin start`가 이를 경고합니다. 초대, 비밀번호 재설정, 최종 사용자 확인, 댓글 멘션, 다이제스트에는
      `smtp`, `resend`, `postmark` 중 하나와, 프로바이더가 받아들이는 주소로 설정한 `[email].from`이
      필요합니다.

## 백업과 모니터링

- [ ] **데이터베이스와 미디어 스토리지를** 정기적으로 **백업하고**, 복원을 시험해 보세요.
      [백업](/ko/deploy/backups/)을 참고하세요.
- [ ] **헬스 체크는 `/_ready`로**, liveness 검사는 `/_health`로 설정하세요.
- [ ] **JSON으로 로그를 남기고**(`[log].format = "json"`, Docker 이미지의 기본값) 표준 오류를 수집하세요.
- [ ] Prometheus를 쓴다면 `VERDIN_METRICS_TOKEN`과 함께 **`/_metrics`를 스크레이프하세요**.
      [모니터링](/ko/deploy/monitoring/)을 참고하세요.

## 서비스 시작 전

- [ ] 첫 시작 직후 첫 관리자를 직접 등록하세요. 관리자가 없는 동안에는 `/admin/`에 접근할 수 있는 누구나
      Super Admin으로 등록할 수 있습니다. 명령줄에서 `verdin admin create --email …`로 만들 수도 있습니다.
- [ ] [보안 모델](/ko/deploy/security/)을 검토하고 Super Admin에게
      [2단계 인증](/ko/guides/auth/two-factor/)을 켜세요.
