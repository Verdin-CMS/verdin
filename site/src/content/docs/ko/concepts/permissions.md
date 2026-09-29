---
title: "권한"
description: "Verdin 접근 제어의 전체 그림: 필드·로케일 권한을 갖춘 관리자 역할과 RBAC, 공개 역할, API 토큰, 최종 사용자 역할."
sidebar:
  order: 6
---

Verdin은 두 대상을 따로 제어합니다. 관리자 패널에 로그인하는 **관리자**와, 사이트와 앱에서 콘텐츠를
읽고 쓰는 **콘텐츠 API 호출자**입니다. 이 페이지에서는 각각이 어떻게 인가되는지, 구성 요소가 어떻게
맞물리는지 설명합니다. 작업 전체 목록은 [권한 레퍼런스](/ko/reference/permissions/)에 있습니다.

| 누구 | 인증 수단 | 권한의 출처 | 적용 대상 |
| --- | --- | --- | --- |
| 관리자 | 이메일과 비밀번호(여기에 두 번째 인증 수단이나 SSO) | 해당 관리자의 [역할](#관리자-역할) | 관리자 패널과 [admin API](/ko/api/admin/) |
| 익명 호출자 | `Authorization` 헤더 없음 | [공개 접근](#공개-접근) | REST, GraphQL, 실시간 |
| 서버나 빌드 | `Authorization: Bearer vd_…` | [API 토큰](#api-토큰)의 타입 | REST, GraphQL, 실시간 |
| 로그인한 최종 사용자 | `Authorization: Bearer <JWT>` | 해당 사용자의 [최종 사용자 역할](#최종-사용자) | REST, GraphQL, 실시간 |

기본적으로 모든 것이 닫혀 있습니다. 접근을 허용하기 전까지 콘텐츠 API는 `403`으로 응답하고, 관리자는
역할이 허용하는 일만 할 수 있습니다.

## 관리자 역할

관리자는 역할을 하나 이상 가지며, 권한은 합산됩니다. 기본 제공 역할은 세 가지입니다.

| 역할 | 할 수 있는 일 |
| --- | --- |
| **Super Admin** | 사용자, 역할, API 토큰을 포함한 모든 것. 편집할 수 없습니다. |
| **Editor** | 모든 콘텐츠를 읽기, 생성, 수정, 삭제, 게시. 미디어 라이브러리 사용. 배포 실행. SEO, 리디렉션, 메뉴, 폼 관리. |
| **Author** | 콘텐츠를 만들고, 자신이 만든 항목만 읽기, 수정, 삭제. 게시할 수 없습니다. 파일을 업로드하고 자신의 파일만 편집하거나 삭제합니다. |

다른 역할은 **설정 → 역할**(권한 `roles.manage`)에서 만듭니다. 활성 상태인 마지막 Super Admin은
비활성화, 삭제, 강등할 수 없으므로 인스턴스가 스스로 잠기는 일이 없습니다. 역할은 구성원에게
[2단계 인증](/ko/guides/auth/two-factor/) 설정을 요구할 수도 있습니다. 설정하기 전까지는 자기 프로필에만
접근할 수 있습니다.

### 권한이란

권한은 **작업**, 콘텐츠 작업의 경우 **대상**, 그리고 선택 사항인 **조건**으로 이루어집니다.

- **콘텐츠 작업**: 콘텐츠 타입 하나(`api::article`) 또는 전체(`*`)에 대한 `content.read`,
  `content.create`, `content.update`, `content.delete`, `content.publish`.
- **미디어 작업**: 미디어 라이브러리에 대한 `media.read`, `media.create`, `media.update`,
  `media.delete`.
- **설정 작업**: `users.manage`, `tokens.manage`, `webhooks.manage`, `features.manage` 등이며,
  **설정**의 해당 페이지를 엽니다.
- **조건**: `is-creator`는 콘텐츠나 미디어 권한을 관리자가 만든 것으로 제한합니다. Author 역할은 이렇게
  동작합니다.

조건은 데이터베이스 쿼리의 일부가 됩니다. `is-creator`로 필터링한 목록은 나중에 행을 숨기는 대신
개수와 페이지를 정확하게 계산합니다.

### 필드와 로케일 권한

콘텐츠 권한은 더 좁힐 수 있습니다.

- **필드.** `content.read`, `content.create`, `content.update`는 적용할 속성을 나열할 수 있습니다. 목록에
  없는 필드는 읽기(검색, 필터, 정렬, 관련 항목 포함)에서 숨겨지고 쓰기에서 거부됩니다.
- **언어.** [로컬라이즈된 타입](/ko/concepts/internationalization/)에서 콘텐츠 권한은 적용할 로케일을
  나열할 수 있습니다. 다른 로케일의 버전은 읽거나 바꿀 수 없습니다.

둘 다 역할 편집기에서 콘텐츠 타입마다 **필드**와 **언어** 아래에 설정합니다.

## 콘텐츠 API

콘텐츠 API 호출자는 권한으로 확인합니다. 권한은 **대상**에 대한 **작업**입니다.

| 작업 | 허용하는 것 |
| --- | --- |
| `find` | 문서 나열(`GET /api/articles`) 또는 싱글 타입 읽기. |
| `findOne` | 문서 하나 읽기(`GET /api/articles/{documentId}`). |
| `create` | `POST` |
| `update` | `PUT` |
| `delete` | `DELETE` |
| `publish` | `actions/publish`, `actions/unpublish`, `actions/discard-draft` 라우트. |
| `readDrafts` | `status=draft`로 읽기. |

대상은 콘텐츠 타입, 미디어 라이브러리(`plugin::upload`), 그리고 [최종 사용자](/ko/guides/auth/end-users/)
기능이 켜져 있으면 최종 사용자 계정(`plugin::users-permissions.user`)입니다.

모든 호출자에게 적용되는 규칙이 몇 가지 있습니다.

- 초안을 읽으려면 `find` 또는 `findOne` 외에 `readDrafts`가 필요합니다. 사이트 콘텐츠를 읽는 권한이
  실수로 게시되지 않은 작업을 읽을 수 없습니다.
- 관계를 통해 populate, 필터링, 정렬하려면 대상 타입에 대한 읽기 권한이 필요합니다.
- `private` 필드는 권한과 상관없이 절대 반환되지 않습니다.
- 쓰기는 Strapi처럼 `find`가 없어도 쓴 문서를 반환합니다.
- 같은 권한이 [GraphQL](/ko/api/graphql/)과 [실시간 스트림](/ko/api/realtime/)에도 적용됩니다.

### 공개 접근

`Authorization` 헤더가 없는 요청은 **설정 → 공개 접근**의 권한을 받습니다. 기본으로는 아무것도
허용되지 않습니다. 보통 사이트에 보여 주는 타입에 `find`와 `findOne`을 허용합니다.

### API 토큰

API 토큰은 서버, 빌드 단계, 스크립트용입니다. **설정 → API 토큰**(권한 `tokens.manage`)에서
만듭니다.

| 타입 | 권한 |
| --- | --- |
| **읽기 전용** | 모든 타입에 대한 `find`와 `findOne`. 초안은 절대 읽지 않습니다. |
| **전체 접근** | 초안을 포함해 모든 타입에 대한 모든 작업. |
| **사용자 지정** | 공개 접근처럼 직접 고른 권한. |

- 토큰은 `vd_`로 시작합니다. 시크릿은 토큰을 만들거나 재생성할 때 한 번만 표시되며, Verdin은 그 키 해시만
  저장합니다.
- 토큰에는 만료 기한을 둘 수 있습니다. 알 수 없거나, 만료되었거나, 형식이 잘못된 토큰은 `401`이며, 공개
  접근으로 대체되지 않습니다.
- 문서를 공개하지 않는 한, 유효한 토큰이면 누구나 `/api/_openapi.json`의 OpenAPI 문서를 읽을 수 있습니다.

토큰을 만들고 교체하는 방법은 [API 토큰](/ko/guides/auth/api-tokens/)을 참고하세요.

### 최종 사용자

최종 사용자는 Strapi의 users-permissions 플러그인처럼 사이트나 앱에 로그인하는 사람들입니다. 이 기능은
기본적으로 꺼져 있습니다. 각 계정은 역할 하나를 가집니다.

- **Public**은 토큰 없는 요청의 역할이며, 그 권한은 **설정 → 공개 접근**의 권한입니다.
- **Authenticated**는 기본적으로 새 계정에 주어집니다.
- 사용자 지정 역할은 위와 같은 작업으로 원하는 권한 조합을 가집니다.

최종 사용자는 로그인 시 받은 JWT를 `Authorization: Bearer <jwt>`로 보냅니다. Verdin은 `vd_` 접두사로 API
토큰과 구분합니다. [최종 사용자](/ko/guides/auth/end-users/)를 참고하세요.

## Strapi와 비교

모델은 Strapi v5를 따릅니다. `is-creator` 조건을 갖춘 관리자 RBAC, 그리고 공개 접근, API 토큰,
users-permissions 역할을 갖춘 콘텐츠 API입니다. 차이점은 다음과 같습니다.

- 모든 기능을 모든 프로젝트에서 쓸 수 있습니다. 사용자 지정 역할, 필드·로케일 권한,
  [SSO](/ko/guides/auth/sso/), [감사 로그](/ko/guides/content/audit-logs/)입니다.
- 콘텐츠 API로 초안을 읽는 것은 별도 권한인 `readDrafts`입니다.
- REST로 게시하는 것은 별도 권한인 `publish`와 별도 라우트를 가집니다.
