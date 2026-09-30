---
title: "Admin API"
description: "자동화를 위한 Verdin 관리자 패널의 API: 로그인, 세션, 규칙, 주요 라우트 그룹."
sidebar:
  order: 4
  label: "관리자"
---

관리자 패널은 admin API의 클라이언트이며, admin API는 `{admin.path}/api`
(기본값 `/admin/api`) 아래에서 제공됩니다. 패널이 하는 모든 일은 스크립트로도 할 수 있습니다. 관리자와
API 토큰 생성, 웹훅과 기능 설정, 로케일 관리, 초안과 릴리스 작업 등입니다.
이 페이지에서는 인증 방법을 설명하고 라우트 그룹을 나열합니다.

:::caution[안정성]
admin API는 Verdin 1.0 이전에는 안정성을 보장하지 않습니다. 라우트와 본문은 마이너 릴리스에서 바뀔 수
있으며, changelog에 모든 변경 사항이 실리지는 않습니다. 콘텐츠를 읽고 쓸 때는
[API 토큰](/ko/guides/auth/api-tokens/)과 함께 [REST](/ko/api/rest/) 또는 [GraphQL](/ko/api/graphql/) API를
사용하세요. 모든 API에 대한 안정성 계약은 1.0에서 제공할 계획입니다.
:::

## 로그인

admin API에는 아직 API 토큰이 없습니다. 스크립트는 관리자 사용자로 로그인하며, 가능하면 스크립트에
필요한 권한만 허용하는 역할을 가진 사용자를 씁니다.

```sh title="Terminal"
curl -s -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"bot@example.com","password":"…"}'
```

```json
{
  "data": {
    "user": { "id": 3, "email": "bot@example.com", "…": "…" },
    "accessToken": "eyJhbGciOiJIUzI1NiIs…",
    "accessTokenExpiresAt": "2026-09-29T10:15:00.000Z"
  }
}
```

이후의 모든 요청에 액세스 토큰을 보냅니다.

```sh title="Terminal"
curl -H "Authorization: Bearer $ACCESS_TOKEN" 'https://cms.example.com/admin/api/system/info'
```

| 자격 증명 | 유효 기간 | 위치 |
| --- | --- | --- |
| 액세스 토큰 (JWT) | 15분 | 응답 본문. `Authorization: Bearer …`로 보냅니다. |
| 리프레시 토큰 | 30일 | `verdin_refresh` 쿠키 (`HttpOnly`, `SameSite=Strict`, 경로 `/admin/api/auth`, `verdin start`에서는 `Secure`). |

새 액세스 토큰을 받으려면 쿠키와 `X-Verdin-CSRF` 헤더(값은 무엇이든 됨)를 담아
`POST /admin/api/auth/refresh`를 호출합니다. 응답은 로그인과 같으며 리프레시 토큰이 교체됩니다.
이미 사용한 리프레시 토큰을 다시 보내면 세션 전체가 끝나므로 새 쿠키를 저장하세요.
같은 헤더로 `POST /admin/api/auth/logout`을 호출하면 세션이 끝납니다.

```sh title="Terminal"
curl -s -b cookies.txt -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/refresh' \
  -H 'X-Verdin-CSRF: 1'
```

- **2단계 인증.** 두 번째 인증 수단이 설정된 계정이면 로그인 응답은
  `{ "data": { "twoFactorRequired": true, "twoFactorToken": "…", "methods": ["totp"] } }`입니다.
  `POST /admin/api/auth/login/two-factor`에 `{ "twoFactorToken": "…", "code": "123456" }`
  (TOTP 또는 복구 코드)를 보내 로그인을 마칩니다.
  [2단계 인증](/ko/guides/auth/two-factor/)을 참고하세요.
- **요청 한도.** 로그인과 가입은 클라이언트 IP별로 `[admin].auth_rate_limit`(기본 분당 20회)으로
  제한됩니다. 토큰 갱신에는 더 넉넉한 한도가 적용됩니다.
- **실패.** 잘못된 자격 증명, 존재하지 않는 계정, 잠긴 계정은 모두
  `400 Invalid credentials`로 응답합니다. 비밀번호를 다섯 번 틀리면 계정이 15분 동안 잠깁니다.
- **첫 관리자.** 새 인스턴스에서 `POST /admin/api/auth/register-first-admin`은 Super Admin을
  만듭니다. 관리자가 한 명도 없을 때만 동작합니다. `verdin admin create`는 명령줄에서 같은 일을 합니다.

## 규칙

- 본문과 응답은 JSON입니다. 응답은 결과를 `data`로 감쌉니다
  (`{ "data": … }`). 콘텐츠 라우트는 REST API처럼 `meta`도 반환합니다.
- 콘텐츠 라우트는 REST API처럼 `{ "data": { … } }` 본문을 받습니다. 설정 라우트는
  일반 JSON 객체를 받습니다.
- 오류는 [REST 오류 형식](/ko/api/rest/#오류)을 따릅니다. 꺼져 있는 기능의 라우트는
  `404`로 응답합니다. 역할에서 2단계 인증을 요구하는 관리자는 설정을 마칠 때까지
  `403 TwoFactorRequiredError`를 받습니다.
- 각 라우트는 관리자의 [권한](/ko/concepts/permissions/)을 확인합니다. 콘텐츠 라우트는 해당 타입의
  콘텐츠 작업을, 설정 라우트는 해당 설정 작업을 확인합니다.
- admin API는 교차 출처(cross-origin) 요청에 절대 응답하지 않습니다. 다른 사이트의 페이지가 아니라
  서버나 스크립트에서 호출하세요.
- 성공한 변경은 [감사 로그](/ko/guides/content/audit-logs/)에 기록됩니다.

## 목록

설정 목록은 `page`(1부터)와 `pageSize`로 페이지를 나눕니다. 응답에는 해당 페이지의 행과 개수가 들어 있습니다.

```json
{ "data": [ … ], "meta": { "pagination": { "page": 2, "pageSize": 25, "total": 60, "pageCount": 3 } } }
```

| 목록 | 기본 페이지 크기(최대) | 순서 | 기타 파라미터 |
| --- | --- | --- | --- |
| `GET /users`, `GET /roles`, `GET /api-tokens` | 25 (100) | 오래된 순 | |
| `GET /webhooks` | 25 (100) | 오래된 순 | `meta.events`는 웹훅이 구독할 수 있는 이벤트를 나열합니다 |
| `GET /webhooks/{id}/deliveries` | 25 (100) | 최신순 | |
| `GET /releases` | 25 (100) | 최신순 | `status`(`pending`, `running`, `done`, `failed`) |
| `GET /site/redirects` | 25 (100) | 소스순 | `search`는 소스나 대상과 일치합니다 |
| `GET /site/menus`, `GET /site/forms` | 25 (100) | 이름순 | |
| `GET /site/forms/{id}/submissions` | 25 (100) | 최신순 | |
| `GET /deploy/targets` | 25 (100) | 오래된 순 | |
| `GET /deploy/deployments` | 25 (100) | 최신순 | `targetId`. `limit`은 `pageSize`의 지원 중단된 별칭입니다 |
| `GET /end-users` | 25 (100) | 최신순 | `search`는 사용자 이름이나 이메일과 일치합니다 |
| `GET /audit-logs` | 50 (200) | 최신순 | [감사 로그](/ko/guides/content/audit-logs/) 참고 |

`pageSize`가 최대값보다 크면 최대값으로 낮춰집니다. 목록 전체를 읽으려면 `page`가 `pageCount`에 이를 때까지
페이지를 요청하세요.

```sh title="Terminal"
curl 'https://cms.example.com/admin/api/site/redirects?page=1&pageSize=100' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

콘텐츠 라우트는 REST API처럼 `pagination[page]`와 `pagination[pageSize]`로 페이지를 나눕니다.

## 라우트 그룹

경로는 `/admin/api` 기준 상대 경로입니다. 라우터는
[`crates/verdin-api/src/admin.rs`](https://github.com/Verdin-CMS/verdin/blob/main/crates/verdin-api/src/admin.rs)
와 그 옆의 `*_admin.rs` 모듈에 있습니다.

| 그룹 | 라우트 | 권한 |
| --- | --- | --- |
| 로그인과 계정 | `GET /auth/status`, `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `GET\|PUT /users/me`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, `/auth/*` 아래의 초대와 비밀번호 재설정 | 로그인 필요 (로그인 라우트는 공개) |
| 2단계 인증 | `/auth/two-factor/*`, `POST /auth/login/two-factor`, `POST /auth/login/passkey/options`, `DELETE /users/{id}/two-factor` | 로그인 필요. 다른 관리자를 재설정하려면 `users.manage` |
| SSO | `GET /auth/sso`, `GET /auth/sso/{id}`, `GET /auth/sso/{id}/callback` | 공개 |
| 관리자 사용자 | `GET\|POST /users`, `GET\|PUT\|DELETE /users/{id}`, `POST /users/{id}/invite` | `users.manage` |
| 역할과 공개 접근 | `GET\|POST /roles`, `GET\|PUT\|DELETE /roles/{id}`, `GET\|PUT /public-permissions` | `roles.manage` |
| API 토큰 | `GET\|POST /api-tokens`, `GET\|PUT\|DELETE /api-tokens/{id}`, `POST /api-tokens/{id}/regenerate` | `tokens.manage` |
| 스키마 | `GET /content-types`, `GET /components`, `GET\|PUT\|DELETE /content-types/{uid}/edit-view`; `verdin dev`에서만 `GET /schema`, `POST /schema/plan`, `POST /schema/apply` | 로그인 필요. 편집 보기는 `views.manage`, 빌더는 `schema.manage` |
| 콘텐츠 | `GET\|POST /content/{uid}`, `GET\|PUT\|DELETE /content/{uid}/{documentId}`, `POST /content/{uid}/{documentId}/actions/{publish\|unpublish\|discard-draft}`, `POST …/clone`, `GET …/locales`, `GET …/usage`, `GET /content/{uid}/uid-available`, `GET /content/{uid}/stats` | `{uid}`에 대한 콘텐츠 작업 |
| 가져오기와 내보내기 | `GET /content/{uid}/export`, `POST /content/{uid}/import` | `{uid}`에 대한 콘텐츠 작업 |
| 기록 | `GET /history/{uid}/{documentId}`, `GET /history/versions/{id}`, `POST /history/versions/{id}/restore` | 해당 타입에 대한 콘텐츠 작업 |
| 릴리스 | `GET\|POST /releases`, `GET\|PUT\|DELETE /releases/{id}`, `POST /releases/{id}/actions`, `DELETE /releases/{id}/actions/{actionId}`, `POST /releases/{id}/publish` | `releases.manage` |
| 검토 워크플로 | `GET\|POST /review-workflows`, `GET\|PUT\|DELETE /review-workflows/{id}`, `GET\|PUT /content/{uid}/{documentId}/review`, `GET /review/*` | 설정하려면 `workflows.manage` |
| 미디어 | `POST /upload`, `POST /upload/from-url`, `GET /upload/files`, `GET\|PUT\|DELETE /upload/files/{id}`, `POST /upload/files/{id}/replace`, `GET /upload/files/{id}/usage`, `/upload/folders…` | `media.*` |
| 로케일 | `GET\|POST /i18n/locales`, `PUT\|DELETE /i18n/locales/{code}` | 변경하려면 `locales.manage` |
| 웹훅 | `GET\|POST /webhooks`, `GET\|PUT\|DELETE /webhooks/{id}`, `POST\|DELETE /webhooks/{id}/secret`, `POST /webhooks/{id}/trigger`, `GET /webhooks/{id}/deliveries`, `POST /webhooks/deliveries/{id}/retry` | `webhooks.manage` |
| 최종 사용자 | `GET\|POST /end-users`, `GET\|PUT\|DELETE /end-users/{id}`, `GET\|POST /end-user-roles`, `PUT\|DELETE /end-user-roles/{id}` | `endusers.manage` |
| 기능 | `GET /features`, `PUT /features/{id}`, `POST /email/test` | 변경하려면 `features.manage` |
| 플러그인 | `GET /plugins`, `GET /plugins/extensions`, `PUT /plugins/{name}`, `GET /plugins/{name}/logs` | `plugins.manage` |
| 배포와 CDN | `/deploy/targets…`, `GET /deploy/deployments`, `GET /deploy/cdn`, `POST /deploy/cdn/purge` | `deploy.manage`. 배포를 실행하려면 `deploy.trigger` |
| 사이트 | `/site/redirects…`, `/site/menus…`, `/site/forms…`와 폼 제출 | `site.manage` |
| 협업 | `/comments…`, `/tasks…`, `/engagement/*`, `/polls…` | 항목 타입에 대한 읽기 권한 |
| 실시간 | `GET /events`, `GET\|POST /presence` | [Realtime API](/ko/api/realtime/#관리자-스트림) 참고 |
| AI | `GET /ai`, `POST /ai/translate`, `/ai/alt-text`, `/ai/summarize`, `/ai/seo` | [AI 기능](/ko/guides/integrations/ai-actions/) 참고 |
| 감사 로그 | `GET /audit-logs` | `audit.read` |
| 시스템 | `GET /system/info` (버전, 데이터베이스, 모드) | 로그인 필요 |

## 콘텐츠 라우트

콘텐츠 라우트는 REST API와 같은 Document Service를 관리자 규칙으로 실행합니다.

- `{uid}`는 `api::article` 같은 콘텐츠 타입의 UID입니다.
- 읽기는 `status=published`를 넘기지 않으면 **초안**을 반환합니다. REST
  [쿼리 파라미터](/ko/api/rest/#쿼리-파라미터)를 받으며, 마지막 변경 이후 관리자가 열어 보지 않은
  문서를 위한 `unseen=true`도 받습니다.
- 쓰기는 초안만 저장합니다. 게시는 항상 명시적인 작업입니다.
- 쓰기는 관리자를 작성자 또는 마지막 편집자로 기록합니다. 관리자 역할의 필드, 로케일,
  `is-creator` 제한이 읽기와 쓰기에 적용됩니다.

```sh title="Terminal"
curl -X PUT 'https://cms.example.com/admin/api/content/api::article/k2m7q4…?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"data":{"title":"Bonjour, Verdin"}}'
curl -X POST 'https://cms.example.com/admin/api/content/api::article/k2m7q4…/actions/publish?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```
