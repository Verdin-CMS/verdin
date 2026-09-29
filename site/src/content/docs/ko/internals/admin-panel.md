---
title: 관리자 패널
description: Verdin의 Angular 관리자 패널이 어떻게 구성되어 있는지, 스키마로 폼과 목록을 만드는 방법, 그리고 빌드되어 바이너리에 포함되고 번역되는 방식.
sidebar:
  order: 6
  label: 관리자 패널
---

이 페이지는 `admin/`의 관리자 패널 기여자를 위한 것입니다. Angular 앱이 어떻게 구성되어 있는지, 콘텐츠 스키마를 폼과 목록으로 바꾸는 방법, 그리고 `verdin` 바이너리 안에 들어가는 과정을 다룹니다. 패널 사용법은 가이드에서, admin API의 서버 쪽 동작은 [admin API 레퍼런스](/ko/api/admin/)에서 다룹니다.

패널은 Angular 22 단일 페이지 앱입니다. standalone 컴포넌트, zoneless 변경 감지, signals, 지연 로딩 라우트, Tailwind CSS v4 기반의 spartan/ui 컴포넌트를 씁니다.

## 구조

```text
admin/
├── src/app/
│   ├── app.config.ts     # providers: router, HttpClient interceptors, Transloco, icons
│   ├── app.routes.ts     # lazy routes, guards (auth, permissions, unsaved changes)
│   ├── core/             # services and pure models: api, auth, schema, i18n, permissions…
│   ├── layout/           # the shell (sidebar, header), home, deploy button
│   ├── features/
│   │   ├── auth/         # login, first admin, invitations, password reset
│   │   ├── dashboard/    # home widgets
│   │   ├── content/      # lists, the entry editor, history, releases, review, import
│   │   │   ├── fields/   # schema-driven form controls and the form model
│   │   │   └── collab/   # comments and tasks
│   │   ├── builder/      # content-type builder (verdin dev only)
│   │   ├── media/        # media library
│   │   ├── releases/
│   │   ├── profile/      # own account, two-factor, passkeys, sessions
│   │   └── settings/     # users, roles, tokens, webhooks, locales, plugins, site features…
│   └── shared/
│       ├── ui/           # spartan helm components, owned by the project
│       └── components/   # app-level shared components (confirm dialog, page header…)
├── public/i18n/          # translation catalogs, one JSON file per language
├── scripts/check-i18n.mjs
└── e2e/                  # Playwright tests and the server they run against
```

**상태**는 `core/`의 주입 가능한 서비스(`Auth`, `Schema`, `I18n`, `Theme`…) 안의 signal에 있습니다. 스토어 라이브러리는 없습니다.

**API 접근**은 Angular `HttpClient`를 감싼 작은 promise 기반 래퍼인 `core/api.ts`를 거치며, 타입은 `core/types.ts`에 직접 작성되어 있습니다. 런타임 설정(관리자 경로, API 접두사, 모드, 브랜딩)은 서버가 주입하는 `<meta name="verdin-config">` 태그에서 옵니다.

**세션.** 액세스 토큰은 메모리에만 있고, 리프레시 토큰은 인증 라우트로 범위가 제한된 `HttpOnly` 쿠키입니다. HTTP 인터셉터가 bearer 토큰을 추가하며, `401`을 받으면 한 번 갱신하고 다시 시도합니다. 갱신에 실패하면 사용자를 로그인 페이지로 보냅니다. 갱신과 로그아웃 요청은 서버가 요구하는 `X-Verdin-CSRF` 헤더를 담습니다. 가드는 페이지를 로드할 때 쿠키에서 세션을 복원합니다. 역할이 2단계 인증을 요구한다는 `403`을 받으면 사용자를 설정 화면으로 보냅니다.

## 스키마 기반 폼

항목 편집기(`features/content/edit.ts`)에는 타입별 코드가 없습니다. `GET /admin/api/content-types`와 `GET /admin/api/components`에서 콘텐츠 타입과 컴포넌트를, 편집 보기 설정에서 편집기 레이아웃을 읽고, 런타임에 **Signal Forms**(`@angular/forms/signals`)로 폼을 만듭니다.

- 문서 모델은 일반 객체의 signal(`fields/model.ts`의 `FormModel`)이며, 필드 트리와 검증기는 스키마에서 도출합니다.
- 재귀 컴포넌트 `vd-fields`(`fields/fields.ts`)가 필드 트리에 대해 어떤 속성 맵이든 렌더링합니다. 텍스트, 날짜, 시간은 `[formField]`로 바인딩한 네이티브 입력을 씁니다. 사용자 정의 `FormValueControl`이 숫자(nullable, 큰 정수는 문자열 유지), 스위치, enumeration, 날짜시간(입력에서는 로컬 시각, 모델에서는 UTC), JSON, Markdown, `blocks`(TipTap), 미디어, 관계(순서 지정이 되는 입력 중 검색 선택기), 다형성 관계를 처리합니다.
- 컴포넌트는 중첩된 fieldset이고, 반복 가능한 컴포넌트와 다이나믹 존은 순서를 바꿀 수 있는 리스트입니다. 플러그인은 사용자 정의 요소로 렌더링되는 사용자 정의 필드 타입을 등록할 수 있습니다.
- `toModel`은 populate된 문서를 폼 모델로 바꾸고(관계는 `documentId`, 파일은 id가 됨), `toPayload`는 다시 `data` 페이로드로 바꿉니다. 빈 문자열은 `null`이 되고, 렌더링 키(`__key`)와 읽기 전용 쪽(`mappedBy`, `morphOne`, `morphMany`)은 빠집니다. 둘 다 `fields/model.spec.ts`에서 단위 테스트합니다.
- 스키마에서 도출한 검증이 즉각적인 피드백을 줍니다. 조건부 필드(`conditions.visible`)는 서버 JSON Logic 평가기를 이식한 코드(`core/logic.ts`)로 브라우저에서 평가합니다. 필드 간 검증 규칙은 서버만 검사합니다. 최종 권한은 서버에 있으며, 서버의 `details.errors[].path` 항목은 해당 필드에 다시 매핑됩니다.
- 저장은 명시적이며, 변경 추적과 페이지 이탈 경고(라우트 가드와 `beforeunload`)가 있습니다. 문서 상태에 따라 **게시**, **게시 취소**, **Discard** 버튼이 나타납니다. 관리자 패널은 초안만 저장하며, 게시는 항상 별도의 작업입니다.

편집기의 레이아웃(필드 순서, 너비, 라벨, 설명, 읽기 전용 필드, 관련 항목의 이름이 되는 필드)은 모든 관리자가 공유하며, 서버의 `vd_settings`에 저장되고, `views.manage` 권한으로 **보기 설정** 페이지에서 바꿉니다.

## 목록

콘텐츠 목록(`features/content/list.ts`)은 서버 측 페이지네이션, 정렬, 필터를 갖춘 spartan helm 테이블을 씁니다. 필터, 검색(`_q`), 페이지는 URL에 반영되므로 필터링한 목록을 링크로 공유할 수 있습니다. 각 관리자는 타입별로 보이는 열, 기본 정렬, 페이지 크기를 고르며(`list-view.ts`), 이 선택은 서버의 개인 환경설정에 저장되어 브라우저를 옮겨도 따라갑니다. 목록은 관리자 이벤트 스트림으로 실시간 업데이트도 됩니다.

## 콘텐츠 타입 빌더

**콘텐츠 타입 빌더**는 서버가 개발 모드(`verdin dev`)로 실행되고 관리자에게 `schema.manage`가 있을 때만 보입니다. 콘텐츠 타입과 컴포넌트를 파일 형식 그대로 편집합니다. 필드, 관계 종류와 대상(대상에 역방향 속성 생성), 컴포넌트, 다이나믹 존, 길이, 범위, 그리고 `required`, `unique`, `private` 플래그입니다.

모든 변경은 먼저 `POST /admin/api/schema/plan`으로 보내며, 이 라우트는 바뀔 스키마를 검증하고 마이그레이션 단계를 위험, SQL, 사용자가 받아들일 수 있는 이름 변경 제안과 함께 반환합니다. 확인하면 받아들인 위험 수준과 이름 변경으로 `POST /admin/api/schema/apply`를 호출합니다. 서버는 마이그레이션하고, `schema/*.json`을 쓰고, 재시작 없이 실행 중인 앱을 새 스키마로 바꿉니다. 서버에서 일어나는 일은 [마이그레이션 엔진](/ko/internals/migrations/)을 참고하세요.

## 빌드와 배포

- `ng build`는 `<base href="/admin/">`로 `admin/dist/admin/browser`에 프로덕션 빌드를 씁니다.
- 서버는 `embed-admin` 기능으로 컴파일될 때 `rust-embed`로 그 폴더를 내장하며, 릴리스 빌드와 Docker 이미지가 이를 씁니다. 이 기능이 없거나 `[admin].assets_dir`이 설정되어 있으면 디스크에서 파일을 제공합니다. `assets_dir`이 내장 빌드보다 우선합니다.
- 서버는 `<base href>`를 `[admin].path`로 다시 쓰고, 런타임 설정을 인라인 스크립트가 아닌 `<meta>` 태그로 주입합니다. `admin.path`를 바꿔도 패널을 다시 빌드할 필요가 없습니다.
- 파일 확장자가 없는 알 수 없는 경로는 클라이언트 측 라우팅을 위해 `index.html`로 대체됩니다. 지문이 붙은 번들(`main-ABC123.js`)은 1년 동안 `immutable`로 캐시되고, 나머지는 모두 `no-cache`입니다.
- 모든 관리자 응답에는 엄격한 Content Security Policy(`script-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`…), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`이 붙습니다. Angular의 critical CSS 인라이닝은 정책이 금지하는 인라인 이벤트 핸들러에 의존하므로 `angular.json`에서 꺼져 있습니다.

프런트엔드 작업을 할 때는 서버를 실행한 뒤 `admin/`에서 `npm start`를 실행하세요. `ng serve`가 `/admin/api`와 `/api`를 `http://localhost:1337`로 프록시합니다(`admin/proxy.conf.json`).

## 번역

패널은 Angular의 컴파일 타임 i18n이 아니라 Transloco로 런타임에 번역되므로, 빌드 하나로 모든 언어를 제공하고 사용자는 새로 고침 없이 언어를 바꿀 수 있습니다.

- 카탈로그는 `admin/public/i18n/`의 평평한 JSON 파일이며(`en.json`이 원본), 필요할 때 로드됩니다.
- 메시지는 ICU MessageFormat(`{name}`, `{count, plural, one {# entry} other {# entries}}`)을 쓰며, 사용자 정의 Transloco transpiler를 통해 FormatJS(`intl-messageformat`)가 해석합니다. FormatJS는 메시지를 함수로 컴파일하지 않고 해석하므로 CSP에 `unsafe-eval`이 필요 없습니다.
- 메시지 키는 `en.json`에서 타입이 만들어집니다(`core/i18n/keys.ts`). 존재하지 않는 키를 쓰면 컴파일 오류입니다.
- `npm run i18n:check`는 모든 카탈로그를 `en.json`과 대조합니다: 같은 키, 올바른 ICU 문법, 같은 인자, 언어의 모든 복수 범주. CI가 실행합니다.
- `I18n` 서비스는 로케일에 맞는 서식과 주의 첫날도 제공하며, 브라우저의 지역 설정에서 가져오고 사용자별로 재정의할 수 있습니다.

언어를 추가하거나 업데이트하는 방법은 [번역](/ko/project/translating/)에 있습니다.
