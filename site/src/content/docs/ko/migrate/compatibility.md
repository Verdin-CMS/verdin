---
title: Strapi 호환성
description: Verdin이 지원하거나, 일부 지원하거나, 지원하지 않는 Strapi v5 기능과 API — REST, GraphQL, 사용자와 권한, 업로드, i18n, 초안과 게시, 코드 확장, 관리자 패널, Enterprise 기능.
sidebar:
  order: 3
---

Verdin은 프런트엔드와 콘텐츠를 옮겨 올 수 있도록 Strapi v5의 콘텐츠 모델과 콘텐츠 API를 유지합니다
([Strapi에서 마이그레이션](/ko/migrate/from-strapi/) 참고). Strapi *코드베이스*를 그대로 대체하지는 않습니다.
JavaScript 런타임이 없으므로 사용자 정의 코드는 WebAssembly 플러그인으로 다시 만들어야 합니다. 이 페이지에서는 Verdin
0.10.0 기준으로 영역별 지원 상태를 나열합니다.

**지원**은 Strapi v5처럼 동작합니다(차이는 참고에 적음). **일부 지원**은 흔한 경우를 다루며, 참고에 빠진 것을 적습니다.
**지원 안 함**은 대응하는 기능이 없습니다.

## 콘텐츠 모델

| 기능 | 상태 | 참고 |
| --- | --- | --- |
| 컬렉션 타입과 싱글 타입 | 지원 | Strapi와 비슷한 JSON 스키마 파일(`schema/content-types/*.json`). [콘텐츠 모델](/ko/concepts/content-model/)을 참고하세요. |
| 스칼라 속성 타입 | 지원 | `string`, `text`, `richtext` (Markdown), `blocks`, `email`, `uid`, `integer`, `biginteger`, `float`, `decimal`, `boolean`, `date`, `time`, `datetime`, `enumeration`, `json`, `password`. Strapi의 `timestamp`는 `datetime`으로 가져옵니다. |
| 컴포넌트와 다이나믹 존 | 지원 | 컴포넌트 안의 미디어와 `oneWay`/`manyWay` 관계 포함. |
| 관계 | 지원 | 일대일/일대다/다대일/다대다, 단방향과 다방향, 다형성 `morphToOne`, `morphToMany`, `morphOne`, `morphMany`. |
| 미디어 필드 | 지원 | 단일 또는 여러 개, `allowedTypes`. |
| `unique` | 일부 지원 | `text`, `richtext`, `blocks`, `json` 속성에서는 불가. |
| 조건부 필드(`conditions`) | 지원 | Strapi 5.17의 JSON Logic 조건. 숨겨진 필드는 필수가 아닙니다. |
| 사용자 정의 필드 | 일부 지원 | `customField` 속성은 동작합니다. 관리자 입력은 Strapi의 React 플러그인이 아니라 Verdin [플러그인](/ko/extending/plugins/)이 제공합니다. |
| 콘텐츠 타입 빌더 | 지원 | Strapi처럼 개발 모드(`verdin dev`)에서만. |

## REST API

| 기능 | 상태 | 참고 |
| --- | --- | --- |
| CRUD 라우트 | 지원 | `GET`/`POST /api/{pluralName}`, `GET`/`PUT`/`DELETE /api/{pluralName}/{documentId}`, 싱글 타입은 `/api/{singularName}`. 응답은 `data`와 `meta`를, 오류는 Strapi의 `error` 객체를 담습니다. |
| `filters` | 지원 | Strapi의 모든 연산자: `$eq`, `$eqi`, `$ne`, `$nei`, `$lt`, `$lte`, `$gt`, `$gte`, `$in`, `$notIn`, `$contains`, `$notContains`, `$containsi`, `$notContainsi`, `$null`, `$notNull`, `$between`, `$startsWith(i)`, `$endsWith(i)`, `$and`, `$or`, `$not`. 관계, 컴포넌트, 반복 가능한 컴포넌트, 다이나믹 존(`__component`)을 통해서도 가능. |
| `sort` | 지원 | 여러 필드, `:asc`/`:desc`, 대일 관계의 필드(`author.name:asc`). |
| `pagination` | 지원 | `page`/`pageSize` 또는 `start`/`limit`, `withCount`. `pageSize`는 `[api].max_page_size`(100)로 제한. |
| `fields` | 지원 | |
| `populate` | 지원 | `*`, 리스트, 중첩 객체, 다이나믹 존용 `on`, `count`. 깊이 최대 5, 관계당 populate 항목 최대 1,000개. |
| `status` | 지원 | `published`(기본값) 또는 `draft`. 초안을 읽으려면 `readDrafts` 권한이 필요합니다. |
| `locale` | 지원 | 아래 i18n을 참고하세요. |
| `hasPublishedVersion` | 지원 | |
| `_q` 전문 검색 | 지원 | Strapi처럼 텍스트 필드에 대한 `$containsi`. `[search]`로 관련도순 검색. |
| 관계 쓰기 | 지원 | ID, `connect` / `disconnect` / `set`, `position`(`before`, `after`, `start`, `end`)과 함께. |
| 게시, 게시 취소, 초안 폐기 | 지원 | Strapi v5처럼 `?status=draft`가 아니면 쓰기가 게시합니다. Verdin은 `POST /api/{pluralName}/{documentId}/actions/{publish,unpublish,discard-draft}`를 추가합니다. |
| Strapi v4 응답 형식과 `publicationState` | 지원 안 함 | Verdin은 v5만 씁니다: 평평한 속성, `documentId`, `status`. |
| OpenAPI 문서 | 일부 지원 | documentation 플러그인의 `/documentation` 대신 `/api/_openapi.json`(기본적으로 토큰 전용)과 `/api/docs`의 대화형 레퍼런스. |

## GraphQL

| 기능 | 상태 | 참고 |
| --- | --- | --- |
| 쿼리 | 지원 | `articles`, `pageInfo`를 가진 `articles_connection`, `article(documentId)`, 싱글 타입. `filters`, `sort`, `pagination`, `status`, `locale`. **설정 → 기능 → GraphQL**을 켜기 전까지 꺼져 있습니다. |
| 뮤테이션 | 지원 | `status`와 `locale`을 받는 `create…`, `update…`, `delete…`. |
| 컴포넌트, 다이나믹 존, 미디어 | 지원 | 다이나믹 존은 유니온, 미디어는 `UploadFile`. |
| 다형성 관계 | 일부 지원 | 타입이 있는 유니온이 아니라 JSON으로 반환. |
| Shadow CRUD(타입별 작업 비활성화) | 지원 | 기능의 `disabled` 설정. |
| 사용자 정의 resolver와 스키마 확장 | 일부 지원 | 플러그인이 해석하는 루트 필드(`plugin.toml`의 `[[graphql]]`). `extensionService`는 없음. |
| Users & Permissions 뮤테이션(`login`, `register`, `me`…) | 지원 안 함 | REST 라우트를 쓰세요. |
| 업로드와 i18n 쿼리·뮤테이션(`uploadFiles`, `i18NLocales`…) | 지원 안 함 | REST 라우트(`GET /api/i18n/locales`)와 관리자 패널을 쓰세요. 로컬라이즈된 타입의 `localizations`는 지원됩니다. |
| 한도, GraphiQL | 지원 | `maxDepth`, `maxComplexity`, 인트로스펙션과 플레이그라운드 스위치. |

## Users & Permissions (최종 사용자)

**설정 → 기능 → 사용자 및 권한**을 켜세요. [최종 사용자](/ko/guides/auth/end-users/)를 참고하세요.

| 기능 | 상태 | 참고 |
| --- | --- | --- |
| `POST /api/auth/local`, `/auth/local/register` | 지원 | 같은 요청과 응답 형식. |
| 이메일 확인, 비밀번호 찾기/재설정/변경 | 지원 | `/auth/email-confirmation`, `/auth/send-email-confirmation`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/change-password`. |
| 리프레시 토큰 | 지원 | `jwtManagement: "refresh"`, `/auth/refresh`, `/auth/logout`. |
| `/api/users`, `/users/me`, `/users/count` | 지원 | 일반 JSON, `plugin::users-permissions.user`에 대한 권한. |
| OAuth 제공업체 | 일부 지원 | GitHub, Google, Microsoft, Discord, Facebook, GitLab, LinkedIn과 모든 OAuth 2 제공업체. Strapi의 모든 프리셋은 아님. |
| 역할과 권한 라우트(`/api/users-permissions/roles`, `/permissions`) | 지원 안 함 | **설정 → 최종 사용자**에서 역할을 관리하세요. |
| 가져온 사용자 | 지원 | bcrypt 해시가 계속 동작하며, 로그인할 때 Argon2id로 다시 해싱됩니다. |

## 미디어 라이브러리와 업로드 API

| 기능 | 상태 | 참고 |
| --- | --- | --- |
| `POST /api/upload` | 지원 | Multipart `files`와 `fileInfo`. `?id=`는 파일 정보를 수정하거나, 파일을 보내면 파일을 교체합니다. |
| 업로드 시 연결(`ref`, `refId`, `field`) | 지원 안 함 | 업로드한 뒤 파일 id로 미디어 필드를 설정하세요. |
| `GET /api/upload/files`, `/files/{id}`, `DELETE /files/{id}` | 일부 지원 | 목록은 `pagination[page]`, `pagination[pageSize]`, `sort`, `filters[name][$containsi]`만 받습니다. |
| 반응형 포맷, breakpoints | 지원 | `thumbnail`과 `[upload].breakpoints`. |
| 폴더, 초점, 대체 텍스트, 캡션 | 지원 | |
| 업로드 프로바이더 | 일부 지원 | 로컬 디스크와 S3 호환 스토리지(AWS, R2, B2, MinIO, Tigris…). Cloudinary 등 프로바이더 패키지는 없음. |
| 이미지 변환 | Verdin 전용 | `/uploads/<file>?preset=…`와 서명된 URL(로컬 프로바이더). |

## 국제화

| 기능 | 상태 | 참고 |
| --- | --- | --- |
| 로컬라이즈된 타입과 로컬라이즈되지 않는 필드 | 지원 | `pluginOptions.i18n.localized`, 속성별로도 가능. |
| REST의 `?locale=`, GraphQL의 `locale` | 지원 | 알 수 없는 로케일은 `400`. |
| 응답의 `localizations` | 지원 | populate할 때만(`populate=localizations`, `populate=*`), 관계와 같은 옵션으로. GraphQL 필드이기도 합니다. admin API에는 없습니다. |
| `GET /api/i18n/locales` | 지원 | Strapi 형태의 일반 배열. Strapi의 `listLocales`처럼 `plugin::i18n.locale`에 대한 `find`(권한 그리드의 **Locales** 행)가 필요합니다. `documentId`는 로케일 코드에서 파생됩니다. 로케일은 관리자 패널(**설정 → 국제화**)에서 관리합니다. |

## 초안과 게시

| 기능 | 상태 | 참고 |
| --- | --- | --- |
| 문서별 초안과 게시 버전 | 지원 | 로케일별. [초안과 게시](/ko/concepts/draft-and-publish/)를 참고하세요. |
| 초안 폐기 | 지원 | |
| 예약 게시 | 지원 | [릴리스](/ko/guides/content/releases/)로. |

## 서버 사용자 정의

각 항목을 옮기는 방법은 [사용자 정의 코드 이식](/ko/migrate/porting-custom-code/)을 참고하세요.

| Strapi | 상태 | Verdin |
| --- | --- | --- |
| 라이프사이클 훅, Document Service 미들웨어 | 일부 지원 | 쓰기를 바꾸거나 거부할 수 있는 WebAssembly 플러그인의 before/after 훅. JavaScript는 없음. |
| 사용자 정의 컨트롤러, 서비스, 라우트 | 일부 지원 | `/api/plugins/<name>/` 아래의 플러그인 라우트. |
| 정책과 미들웨어 | 지원 안 함 | 권한과 요청 한도는 내장되어 있습니다. |
| `register` / `bootstrap` | 일부 지원 | 플러그인이 시작되거나, 켜지거나, 설정이 바뀔 때 실행되는 플러그인의 시작 함수. 콘텐츠를 시딩하고 공개 역할의 권한을 교체할 수 있습니다. |
| Cron 작업 | 일부 지원 | 플러그인 작업. |
| JavaScript의 Document Service / Entity Service | 지원 안 함 | JavaScript 런타임이 없습니다. |
| Strapi 마켓플레이스의 npm 플러그인 | 지원 안 함 | |
| 웹훅 | 지원 | 서명, 재시도, 기록. `entry.draft-discard`는 `entry.discard-draft`. [웹훅](/ko/guides/integrations/webhooks/)을 참고하세요. |
| API 토큰(읽기 전용, 전체 접근, 사용자 지정) | 지원 | 같은 종류, 선택적 만료, 재생성. |
| Transfer 토큰, `strapi transfer` | 지원 안 함 | `verdin export`와 `verdin import verdin`을 쓰세요. |
| `strapi export` 파일 | 지원(가져오기) | `verdin import strapi`. 암호화된 내보내기는 읽지 않습니다. |
| `config/*.js`, `.env` | 일부 지원 | `verdin.toml`과 환경 변수. |
| TypeScript 타입 | 지원 | `verdin types`. |
| 이메일 프로바이더 | 일부 지원 | SMTP, Resend, Postmark. |

## 관리자 패널

| 기능 | 상태 | 참고 |
| --- | --- | --- |
| 콘텐츠 관리자, 미디어 라이브러리, 콘텐츠 타입 빌더 | 지원 | Strapi의 React 관리자가 아닌 자체 Angular 패널. |
| 관리자 사용자, 역할, 사용자 지정 역할 | 지원 | Super Admin, Editor, Author 기본 제공, 그리고 사용자 지정 역할. |
| 필드 수준과 로케일 권한 | 지원 | |
| RBAC 조건 | 일부 지원 | 기본 제공 `is-creator` 조건만. 사용자 정의 조건은 없음. |
| 관리자 사용자 정의(`src/admin/app`) | 일부 지원 | `[admin.branding]`의 로고, 파비콘, 제목, 강조 색상, 텍스트. 플러그인의 위젯과 사용자 정의 필드. 사용자 정의 페이지, injection zone, React 확장은 없음. |
| Admin API (`/admin/…`) | 지원 안 함 | Verdin의 admin API는 별개입니다. Strapi의 것을 기반으로 만들지 마세요. |
| 편집 보기와 목록 보기 설정 | 지원 | |

## Enterprise 기능

Verdin의 모든 것은 오픈 소스입니다. 다음은 Strapi에서 Enterprise 또는 유료 기능입니다.

| Strapi 기능 | 상태 | 참고 |
| --- | --- | --- |
| SSO | 일부 지원 | 그룹-역할 매핑을 갖춘 OpenID Connect 제공업체. SAML 등 passport 전략은 없음. [싱글 사인온](/ko/guides/auth/sso/)을 참고하세요. |
| 감사 로그 | 지원 | [감사 로그](/ko/guides/content/audit-logs/)를 참고하세요. |
| 검토 워크플로 | 지원 | 단계별 역할은 단계 *안으로* 항목을 옮길 수 있는 사람을 제한하며, 게시에 필요한 단계는 모든 API에 적용됩니다. [검토 워크플로](/ko/guides/content/review-workflows/)를 참고하세요. |
| 릴리스 | 지원 | 예약 또는 즉시. |
| 콘텐츠 기록 | 지원 | 문서당 `[history].max_versions`개의 버전. |
| 미리 보기와 라이브 미리 보기 | 지원 | 수명이 짧은 토큰을 쓰는 미리 보기 URL, 나란히 보기 미리 보기, [비주얼 에디팅](/ko/guides/frontend/visual-editing/). |
| 사용자 지정 관리자 역할 | 지원 | 개수 제한 없음. |
