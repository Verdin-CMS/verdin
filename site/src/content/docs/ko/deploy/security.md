---
title: 보안
description: Verdin이 관리자 패널, 콘텐츠 API, 서버를 보호하는 방법, 프로덕션 인스턴스를 강화하는 설정, 취약점을 제보하는 방법.
sidebar:
  order: 2
---

이 페이지에서는 Verdin이 프로젝트를 보호하기 위해 하는 일과 직접 제어하는 설정을 설명합니다. 실제 트래픽을
받을 인스턴스를 준비할 때 [프로덕션 체크리스트](/ko/deploy/production-checklist/)와 함께 보세요.

## 기본적으로 닫혀 있는 것

- **콘텐츠 API.** 익명 요청은 **설정 → 공개 접근**에서 공개 권한을 허용하기 전까지 아무것도 받지 못합니다.
  알 수 없거나, 만료되었거나, 형식이 잘못된 토큰은 `401`이며, 공개 역할로 대체되지 않습니다.
  [권한](/ko/concepts/permissions/)을 참고하세요.
- **OpenAPI 문서**(`/api/_openapi.json`)는 **설정 → 기능 → API 문서**에서 공개하기 전까지 유효한 API 토큰이
  필요합니다.
- GraphQL, 최종 사용자, SSO, MCP 서버 같은 **선택 기능**은 `features.manage` 권한을 가진 관리자가
  **설정 → 기능**에서 켜기 전까지 꺼져 있습니다.
- **플러그인**은 관리자가 **설정 → 플러그인**에서 하나씩 켜기 전까지 꺼져 있습니다.
- **교차 출처 브라우저 호출.** `[api].cors_origins`에 나열하기 전까지 어떤 출처도 브라우저에서 API를 호출할
  수 없습니다.

## 관리자 로그인

| 보호 수단 | 세부 사항 |
| --- | --- |
| 비밀번호 해싱 | OWASP 파라미터를 쓰는 Argon2id. 파라미터가 바뀌면 다시 해싱합니다. |
| 세션 | 페이지 메모리에 보관하는(절대 `localStorage`가 아님) 15분짜리 액세스 토큰, 그리고 `/admin/api/auth`로 제한된 `HttpOnly`, `SameSite=Strict` 쿠키에 담긴 30일짜리 리프레시 토큰. 리프레시 토큰은 사용할 때마다 교체되며, 이전 토큰을 제시하면 세션 전체가 끝납니다. |
| Secure 쿠키 | `verdin start`에서 리프레시 쿠키는 `Secure`입니다. `[admin].secure_cookies = false`는 이를 끄고 경고를 남깁니다. |
| CSRF | 토큰 갱신과 로그아웃에는 `X-Verdin-CSRF` 헤더가 필요하며, 교차 사이트 폼은 이 헤더를 보낼 수 없습니다. |
| 계정 잠금 | 다섯 번 실패하면 계정이 15분 동안 잠깁니다. 실패는 비밀번호 단계와 두 번째 인증 단계를 합쳐 셉니다. 존재하지 않는 이메일과 잘못된 비밀번호는 같은 시간에 같은 응답을 받습니다. |
| 요청 한도 | 로그인, 가입, 토큰 갱신: 클라이언트 주소당 분당 `[admin].auth_rate_limit`회(20). |
| 두 번째 인증 수단 | 인증 앱(TOTP)과 패스키, 복구 코드 포함. 역할에서 요구할 수 있습니다(`requireTwoFactor`). [2단계 인증](/ko/guides/auth/two-factor/)을 참고하세요. |
| Super Admin | Super Admin만 Super Admin을 생성, 편집, 삭제, 재설정하거나 그 역할을 부여할 수 있습니다. 활성 상태인 마지막 Super Admin은 제거할 수 없습니다. |

첫 관리자는 관리자가 없는 동안 패널에서 등록합니다. 첫 시작 직후 등록하거나, 서버를 노출하기 전에
`verdin admin create --email …`로 만드세요.

## 관리자 패널과 admin API

- admin API(`/admin/api`)는 `[api].cors_origins` 설정과 상관없이 CORS 헤더를 보내지 않습니다. 브라우저는
  패널 자신의 출처만 응답을 읽게 합니다.
- 패널은 엄격한 Content Security Policy(자기 출처의 스크립트만), `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`과 함께 제공됩니다.
- Verdin은 `Strict-Transport-Security`를 보내지 않습니다. TLS를 종료하는 리버스 프록시에서 추가하세요.

## 콘텐츠 API

- **API 토큰**은 한 번만 표시됩니다. Verdin은 `VERDIN_TOKEN_PEPPER`를 키로 한 각 토큰의 HMAC-SHA256을 저장하고,
  표시용으로 10자 접두사를 보관합니다. 토큰은 만료될 수 있고 재생성할 수 있습니다.
- **필드와 로케일 권한**은 역할이 읽고 쓰는 것을 제한하며, `populate`, 관계 필터, 관계 정렬은 호출자가 읽을 수
  있는 타입에만 닿습니다.
- **쿼리 한도**: `pageSize`는 최대 `[api].max_page_size`(100), `populate` 깊이는 최대 5, 필터 조건은 최대 100개,
  쿼리 문자열은 최대 16 KB, 관계당 populate 항목은 최대 1,000개입니다. 쿼리에 알 수 없거나 private인 필드가
  있으면 `400`입니다.
- **GraphQL**에는 자체 깊이와 복잡도 한도(`maxDepth`, `maxComplexity`)가 있고, 기능 설정에 인트로스펙션
  스위치가 있습니다.
- **요청 한도**: 토큰 없는 요청은 클라이언트 주소당 `[api].public_rate_limit`, API 토큰이나 최종 사용자는
  각각 `[api].token_rate_limit`이며, 단위는 분당 요청 수입니다. 둘 다 기본적으로 꺼져 있습니다(`0`). 알 수 없는
  bearer 토큰을 가진 요청은 주소별로 제한됩니다.

### CORS

`[api].cors_origins`는 콘텐츠 API와 GraphQL을 호출할 수 있는 브라우저 출처를 나열합니다.

```toml title="verdin.toml"
[api]
cors_origins = ["https://www.example.com", "https://preview.example.com"]
```

각 항목은 경로나 끝 슬래시 없는 `scheme://host[:port]`입니다. `["*"]`는 모든 출처를 허용하며 다른 항목과 함께
쓸 수 없습니다. 허용되는 메서드는 `GET`, `POST`, `PUT`, `DELETE`이고, 허용되는 요청 헤더는 `Authorization`,
`Content-Type`, `If-None-Match`입니다. 출처가 아닌 항목이 있으면 시작에 실패합니다.

서버 측 프런트엔드(Astro, 서버에서 실행되는 Next.js)는 브라우저 없이 API를 호출하므로 CORS 항목이 필요
없습니다.

## 요청과 업로드

| 설정 | 기본값 | 막는 것 |
| --- | --- | --- |
| `[server].body_limit` | `"1mb"` | 일반 API에 대한 큰 요청 본문. |
| `[server].request_timeout_secs` | `30` | 연결을 붙잡는 느린 요청. |
| `[upload].max_file_size` | 200 MB | 큰 업로드(업로드에는 `body_limit` 대신 자체 한도가 있음). |
| `[upload].max_image_megapixels` | `100` | 압축 폭탄. |

업로드한 파일의 타입은 클라이언트가 보낸 타입이 아니라 파일의 바이트에서 판단합니다. 파일 이름은 대체 수단일
뿐이며, 브라우저가 능동적으로 실행하는 타입에는 절대 쓰지 않습니다(그런 파일은 `application/octet-stream`으로
저장됩니다). 리치 텍스트 `blocks`의 링크는 `http(s)`, `mailto:`, 또는 상대 경로여야 합니다.

## 프록시 뒤의 클라이언트 주소

요청 한도와 감사 로그는 클라이언트 주소를 씁니다. 리버스 프록시 뒤에서는 모든 요청이 프록시에서 오므로
`[server].trusted_proxies`에 프록시를 나열하세요.

```toml title="verdin.toml"
[server]
trusted_proxies = ["10.0.0.0/8"]   # the proxies' IPs or CIDR ranges
```

그러면 Verdin은 `X-Forwarded-For`를 오른쪽에서 왼쪽으로 읽어 신뢰하는 프록시가 아닌 첫 주소를 씁니다. 다른
주소에서 온 요청은 연결 주소를 그대로 쓰므로, 클라이언트가 헤더를 직접 보내 주소를 위조할 수 없습니다.
신뢰할 수 없는 클라이언트가 접속할 수 있는 대역은 나열하지 마세요.

## 외부로 나가는 요청

웹훅, 배포 훅, CDN 퍼지 웹훅, URL에서 업로드는 관리자가 고른 곳으로 요청을 보냅니다. `verdin start`에서는
루프백, 사설, 링크 로컬 주소(사설 IPv4 주소를 담은 IPv6 형식 포함)를 거부하므로, 관리자가 이를 이용해 내부
네트워크의 서비스에 접근할 수 없습니다. `[webhooks].allow_private_networks = true`는 이 제한을 풉니다. 모든
관리자를 내부 네트워크에 대해 신뢰할 수 있을 때만 쓰세요.

## 시크릿

`VERDIN_ADMIN_JWT_SECRET`과 `VERDIN_TOKEN_PEPPER`는 환경 변수에서만 읽으며, 각각 최소 32바이트여야 합니다
(`verdin secrets`가 새 값을 출력합니다). pepper는 관리자의 TOTP 시크릿을 봉인하고, 폼 제출자의 주소를 해싱하는
키를 도출하는 데도 쓰입니다. 둘 다 플랫폼의 시크릿 관리자에 보관하고 `.env`는 절대 커밋하지 마세요.

요청 로그는 이름이 비밀처럼 보이는 쿼리 파라미터(`token`, `code`, `password`, `key`, `signature`…)의 값과
배포 콜백 URL의 비밀 부분을 숨깁니다.

## 메트릭

`/_metrics`는 `[metrics].enabled = true`가 아니면 꺼져 있습니다. 켜져 있고 토큰이 없으면 포트에 접근할 수 있는
누구나 읽을 수 있습니다. `VERDIN_METRICS_TOKEN`(또는 `[metrics].token`)을 설정하고
`Authorization: Bearer <token>`으로 스크레이프하거나, 프록시에서 경로를 막으세요.
[모니터링](/ko/deploy/monitoring/)을 참고하세요.

## 플러그인

플러그인은 Extism이 샌드박스에서 실행하는 WebAssembly 모듈입니다. 모듈에는 자체 파일 시스템, 네트워크,
데이터베이스가 없습니다. 모든 것은 `plugin.toml`의 기능 선언(읽거나 쓰는 콘텐츠 타입, HTTP 호스트, 자체 키-값
저장소)으로 제한된 호스트 함수를 거치며, 호출마다 시간과 메모리 한도가 있습니다(`[limits]`, 예제 매니페스트에서는
5초와 64 MB). 관리자는 플러그인을 켜기 전에 플러그인이 요구하는 것을 봅니다. 플러그인의 관리자 스크립트는 패널
페이지에서 실행되므로 신뢰하는 플러그인만 설치하세요. [플러그인](/ko/extending/plugins/)을 참고하세요.

## 내보내기와 백업

`verdin export` 아카이브에는 private 필드와 비밀번호 해시가 들어 있습니다. 데이터베이스 덤프처럼 보관하세요.
[백업](/ko/deploy/backups/)을 참고하세요.

## 취약점 제보

보안 문제로 공개 이슈를 열지 마세요. 저장소의
[보안 정책](https://github.com/Verdin-CMS/verdin/blob/main/SECURITY.md)에 따라
[저장소](https://github.com/Verdin-CMS/verdin/security)의 **Security** 탭(**Report a vulnerability**)으로
버전, 재현 단계, 확인한 영향을 담아 비공개로 제보하세요. 보안 수정 사항은 [changelog](/ko/project/changelog/)의
**Security** 아래에 나열됩니다.
