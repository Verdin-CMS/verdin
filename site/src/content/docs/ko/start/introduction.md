---
title: Verdin이란
description: Verdin은 Rust로 작성한 오픈 소스 헤드리스 CMS로, Strapi v5 호환 콘텐츠 API와 관리자 패널을 바이너리 하나에 담았습니다.
sidebar:
  order: 1
  label: 소개
---

Verdin은 Rust로 작성한 오픈 소스 헤드리스 CMS입니다. 콘텐츠 타입을 모델링하면, 편집자는 관리자 패널에서 글을 쓰고 게시하며,
사이트와 앱은 REST나 GraphQL API로 콘텐츠를 읽습니다. Verdin은 페이지를 렌더링하지 않습니다. 렌더링은 프런트엔드가 합니다.

Verdin은 [Strapi v5](https://strapi.io)를 다시 작성한 것입니다. 스키마 형식과 콘텐츠 API의 형태가 같으므로, Strapi 프로젝트와
그 프런트엔드를 약간의 변경만으로 옮겨 올 수 있습니다.

## 누구를 위한 것인가

- 프로세스 하나로 실행할 수 있고, 콘텐츠 모델을 git에 두고, Astro, Next.js, 모바일 앱 등 어떤 프런트엔드에서든 읽을 수 있는
  CMS를 원하는 **사이트나 앱을 만드는 개발자**.
- 같은 API를 더 가볍게 쓰고 싶거나, Strapi가 유료 플랜에만 제공하는 기능이 필요한 **Strapi를 쓰는 팀**. Verdin에는
  엔터프라이즈 에디션이 없습니다. SSO, 감사 로그, 검토 워크플로, 릴리스가 오픈 소스 프로젝트의 일부입니다.
- 18개 언어로 제공되는 관리자 패널에서 초안, 게시, 기록, 미리 보기를 쓰는 **편집자**.

## 들어 있는 것

실행 파일 하나 `verdin`이 서버, 명령줄 도구, 관리자 패널입니다. 프로덕션에는 Node.js 런타임도 `node_modules`도 없습니다.

| 영역 | 제공하는 것 |
| --- | --- |
| 데이터베이스 | PostgreSQL 14+, MySQL 8.4+, MariaDB 10.11+, SQLite. 모두 같은 테스트 스위트로 검증합니다. |
| 콘텐츠 모델 | 컬렉션 타입, 싱글 타입, 컴포넌트, 다이나믹 존, 관계, 미디어, Markdown이나 Strapi의 blocks 형식 리치 텍스트. 스키마는 프로젝트 안의 JSON 파일입니다. |
| 스키마 변경 | 모든 변경은 위험 수준과 정확한 SQL이 담긴 마이그레이션 플랜이 됩니다. 파괴적인 단계는 허용할 때만 실행됩니다. |
| API | Strapi v5 파라미터(`filters`, `populate`, `sort`, `pagination`)를 쓰는 `/api` 아래의 REST, 선택 사항인 GraphQL 엔드포인트, OpenAPI 문서, 타입 TypeScript 클라이언트. |
| 편집 | 초안과 게시, 현지화된 콘텐츠, 콘텐츠 기록, 릴리스, 검토 워크플로, 댓글과 작업, 실시간 프레즌스, 여러분의 사이트에서 하는 미리 보기와 비주얼 에디팅. |
| 접근 | 필드와 로케일까지 내려가는 관리자 역할, API 토큰, 공개 접근 권한, OpenID Connect를 쓰는 SSO, 패스키를 쓰는 2단계 로그인, 감사 로그. |
| 사이트 기능 | 전문 검색, 사이트맵, 리디렉션, 메뉴와 폼, 웹훅, 실시간 업데이트. |
| 확장 | 쓰기에 훅을 걸고, 라우트와 작업을 추가하고, 관리자 위젯과 사용자 정의 필드를 가져오는 WebAssembly 플러그인. 선언한 기능으로만 제한됩니다. |

## Strapi v5와의 관계

**같은 점:**

- 스키마 파일은 Strapi의 형식을 씁니다: `schema/content-types/<singularName>.json`과
  `schema/components/<category>/<name>.json`.
- REST 콘텐츠 API: 라우트, `documentId`를 가진 평평한 응답 형식, 쿼리 파라미터와 연산자, 쓰기 의미(`POST`나 `PUT`은
  `?status=draft`를 넘기지 않으면 게시), 오류 본문.
- GraphQL 스키마는 Strapi v5 GraphQL 플러그인과 같은 형태입니다.
- 최종 사용자(가입, 로그인, OAuth, 역할)는 `users-permissions` API를 따릅니다.

**다른 점:**

- **스키마 변경은 계획된 마이그레이션입니다.** Verdin은 스키마 파일을 데이터베이스와 비교하고, 실행하기 전에 단계를
  보여 줍니다. `verdin start`는 데이터베이스가 스키마보다 뒤처져 있으면 실행을 거부합니다.
- **콘텐츠 타입 빌더는 개발 모드에서만 실행됩니다.** 프로덕션에서 스키마는 저장소에서 옵니다.
- **플러그인은 JavaScript가 아니라 WebAssembly입니다.** Strapi 플러그인과 `src/`의 사용자 정의 컨트롤러, 서비스,
  라이프사이클 파일은 Verdin에서 실행되지 않습니다.
- **데이터베이스를 Strapi와 공유하지 않습니다.** Strapi 프로젝트는 `verdin import strapi`로 가져오며, 모든 문서가 새 id를
  받습니다.
- **REST에 몇 가지가 더 있습니다**: 게시와 게시 취소 액션(`POST /api/<route>/<documentId>/actions/publish`), 그리고
  populate한 컴포넌트는 중첩 컴포넌트를 포함해 통째로 반환됩니다.

[Strapi 호환성](/ko/migrate/compatibility/)에 차이점이 자세히 나와 있습니다.

## 쓰지 말아야 할 때

- **Strapi 플러그인이나 JavaScript로 작성한 사용자 정의 서버 코드에 의존합니다.** Verdin은 이를 실행할 수 없습니다.
  WebAssembly 플러그인으로 다시 작성하거나 로직을 다른 곳으로 옮겨야 합니다.
- **안정적인 1.0이 필요합니다.** Verdin은 0.10이며, 마이너 릴리스가 여전히 설정과 동작을 바꿀 수 있습니다. 매번
  [업그레이드](/ko/migrate/upgrading/)를 읽으세요.
- **CMS가 페이지를 렌더링하기를 원합니다.** Verdin은 헤드리스입니다. 프런트엔드 프레임워크나 정적 사이트 생성기와 함께 쓰세요.
- **관리형 서비스를 원합니다.** Verdin은 자체 호스팅입니다. 여러분의 인프라에서 바이너리나 Docker 이미지를 실행합니다.

## 다음 단계

- [빠른 시작](/ko/start/quickstart/): Verdin을 실행하고 API에서 첫 항목을 읽습니다.
- [튜토리얼: Astro로 블로그 만들기](/ko/start/tutorial-astro/) 또는 [Next.js로](/ko/start/tutorial-nextjs/): 예제 블로그를
  대상으로 프런트엔드를 만듭니다.
- [콘텐츠 모델](/ko/concepts/content-model/): 콘텐츠 타입, 필드, 저장 방식.
- [Strapi 프로젝트 가져오기](/ko/migrate/from-strapi/): 기존 프로젝트를 옮겨 옵니다.
