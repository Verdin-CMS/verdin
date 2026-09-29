---
title: "콘텐츠 모델"
description: "Verdin이 콘텐츠를 기술하는 방법: 컬렉션 타입과 싱글 타입, 속성, Strapi 형식의 스키마 파일, 검증 규칙."
sidebar:
  order: 1
---

콘텐츠 모델은 프로젝트가 정의하는 콘텐츠 타입과 컴포넌트의 집합입니다. Verdin은 나머지를 모두 여기서
만들어 냅니다. 데이터베이스 테이블, REST와 GraphQL API, OpenAPI 문서, 검증, 관리자 패널의 폼입니다.
이 페이지에서는 각 구성 요소와 거기에 적용되는 규칙을 설명합니다.

## 콘텐츠 타입

콘텐츠 타입은 글이나 홈페이지처럼 한 종류의 문서를 기술합니다. `kind`를 가집니다.

| 종류 | 담는 것 | REST 라우트 (blog 예제) |
| --- | --- | --- |
| `collectionType` | 여러 개의 문서 | `/api/articles`, `/api/articles/{documentId}` |
| `singleType` | 최대 한 개의 문서 | `/api/homepage` |

컬렉션 타입은 `pluralName`으로, 싱글 타입은 `singularName`으로 제공됩니다. 싱글 타입에 대한 첫 `PUT`이
문서를 만듭니다. 모든 라우트는 [REST API](/ko/api/rest/)를 참고하세요.

각 콘텐츠 타입에는 `api::<singularName>`(`api::article`) 형식의 UID가 있습니다. Strapi는 같은 UID를
`api::article.article`로 씁니다. Verdin은 스키마 파일과 임포터에서 이 형식을 받아들이고 `api::article`로
정규화합니다.

모든 문서에는 선언하지 않아도 되는 시스템 필드가 있습니다. `id`, `documentId`(26자의 소문자 ULID로,
초안, 게시 버전, 로케일 사이에서 변하지 않음), `createdAt`, `updatedAt`, `publishedAt`, 그리고
[로컬라이즈된 타입](/ko/concepts/internationalization/)에서는 `locale`입니다.

## 스키마 파일

콘텐츠 타입과 컴포넌트는 프로젝트의 `schema/` 디렉터리(`verdin.toml`의 `[schema].path`)에 있는 JSON
파일입니다. 코드처럼 git으로 버전 관리합니다.

```
schema/
├── content-types/
│   ├── article.json
│   ├── category.json
│   ├── tag.json
│   └── homepage.json
└── components/
    ├── blocks/
    │   ├── hero.json
    │   └── quote.json
    └── shared/
        └── seo.json
```

형식은 Strapi의 `schema.json`이므로 대부분의 Strapi 스키마가 그대로 로드됩니다. 다음은
[blog 예제](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog)의 article 타입입니다.

```json title="schema/content-types/article.json"
{
  "kind": "collectionType",
  "singularName": "article",
  "pluralName": "articles",
  "displayName": "Article",
  "options": { "draftAndPublish": true },
  "attributes": {
    "title": { "type": "string", "required": true, "maxLength": 200 },
    "slug": { "type": "uid", "targetField": "title", "required": true },
    "excerpt": { "type": "text", "maxLength": 500 },
    "body": { "type": "richtext" },
    "readingTime": { "type": "integer", "min": 0 },
    "featured": { "type": "boolean", "default": false },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "tags": { "type": "relation", "relation": "manyToMany", "target": "tag" },
    "seo": { "type": "component", "component": "shared.seo" },
    "blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"] }
  }
}
```

| 키 | 필수 | 설명 |
| --- | --- | --- |
| `kind` | 예 | `collectionType` 또는 `singleType`. |
| `singularName` | 예 | kebab-case. 파일 이름(`article.json`)과 같아야 합니다. |
| `pluralName` | 예 | kebab-case. `singularName`과 달라야 합니다. |
| `displayName` | 예 | 관리자 패널에 표시되는 이름. |
| `description` | 아니요 | 관리자 패널에 표시됩니다. |
| `collectionName` | 아니요 | 테이블 이름. 기본값은 `pluralName`의 snake_case. |
| `options.draftAndPublish` | 아니요 | 각 문서의 초안과 게시 버전을 따로 유지합니다. 기본값 `false`. [초안과 게시](/ko/concepts/draft-and-publish/)를 참고하세요. |
| `pluginOptions.i18n.localized` | 아니요 | 로케일마다 버전 하나. 기본값 `false`. [국제화](/ko/concepts/internationalization/)를 참고하세요. |
| `attributes` | 아니요 | 필드. API가 반환하는 순서대로 씁니다. |
| `validations` | 아니요 | 필드 간 규칙. [아래](#필드-간-검증)를 참고하세요. |

스키마는 엄격합니다. 알 수 없는 키, 타입이 지원하지 않는 옵션, 존재하지 않는 타입이나 컴포넌트에 대한
참조는 파일과 경로를 명시한 오류이며, 서버가 시작되지 않습니다. 서버를 시작하지 않고 파일을 검증하려면
`verdin schema check`를 실행하세요.

일부 이름은 이미 쓰이고 있습니다.

- 속성 이름은 문자로 시작하고 그 뒤에 문자, 숫자, 밑줄이 오며 최대 50자입니다. snake_case 컬럼이
  됩니다(`metaTitle` → `meta_title`).
- `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`, `updatedAt`,
  `createdBy`, `updatedBy`는 콘텐츠 타입에서 예약되어 있고, 컴포넌트 안에서는 `id`가 예약되어 있습니다.
- `upload`, `uploads`, `auth`, `users`, `connect`는 `singularName`이나 `pluralName`으로 쓸 수 없습니다.
  이 라우트는 API가 사용합니다.
- 콘텐츠 타입에는 `string`, `email`, `uid`, `enumeration` 속성을 최대 60개까지 둘 수 있습니다. MySQL의
  행 크기 한도를 넘지 않기 위해서입니다. 일부는 `text`를 쓰세요.

파일은 서버를 `verdin dev`로 실행하는 동안 쓸 수 있는 관리자 패널의 **콘텐츠 타입 빌더**에서
편집하거나 직접 편집합니다. 어느 쪽이든 변경은 [스키마 마이그레이션](/ko/concepts/schema-migrations/)이
됩니다. 편집기의 레이아웃(필드 순서, 너비, 라벨)은 스키마에 포함되지 않습니다. 관리자가 패널에서
설정하며 데이터베이스에 저장됩니다.

## 컴포넌트

컴포넌트는 `shared.seo`(메타 제목과 메타 설명)처럼 재사용 가능한 필드 그룹입니다. UID는 경로에서
가져온 `<category>.<name>`이며, `schema/components/shared/seo.json`은 `shared.seo`입니다. 컴포넌트
파일에는 `displayName`, 선택 사항인 `description`과 `icon`, 그리고 `attributes`가 있습니다.

다이나믹 존은 히어로 블록과 인용 블록으로 이루어진 글 본문처럼 여러 컴포넌트를 섞는 리스트입니다.
둘 다 문서 안에 JSON으로 저장됩니다.
[컴포넌트와 다이나믹 존](/ko/concepts/components-and-dynamic-zones/)을 참고하세요.

## 속성

각 속성에는 `type`과 타입에 따라 달라지는 옵션이 있습니다. 타입 전체 목록, 옵션, 데이터베이스별
컬럼 타입은 [속성 타입 레퍼런스](/ko/reference/attribute-types/)에 있습니다.

| 분류 | 타입 |
| --- | --- |
| 텍스트 | `string`, `text`, `richtext` (Markdown), `blocks` (Strapi의 구조화된 리치 텍스트), `email`, `uid`, `password`, `enumeration` |
| 숫자 | `integer`, `biginteger`, `float`, `decimal` |
| 날짜 | `date`, `time`, `datetime` |
| 기타 스칼라 | `boolean`, `json` |
| 연결 | `relation` ([관계](/ko/concepts/relations/) 참고), `media` ([미디어](/ko/concepts/media/) 참고) |
| 구조 | `component`, `dynamiczone` |

공통 옵션:

| 옵션 | 효과 |
| --- | --- |
| `required` | 버전을 게시할 때(초안과 게시를 쓰지 않는 타입은 매번 쓸 때) 값이 있어야 합니다. 초안은 불완전해도 됩니다. |
| `private` | 콘텐츠 API가 절대 반환, 필터링, 정렬, populate하지 않습니다. `password` 속성은 항상 private입니다. |
| `default` | 새 문서에서 필드를 생략했을 때 쓰는 값. 속성 자체의 규칙으로 검사합니다. |
| `unique` | 로케일과 버전별로 두 문서가 같은 값을 가질 수 없습니다. `string`, `email`, 숫자, 날짜, 시간 타입에서 쓸 수 있으며, `uid`는 항상 고유합니다. |
| `configurable` | `false`면 콘텐츠 타입 빌더에서 속성이 잠깁니다. 거기서 편집, 이름 변경, 삭제를 할 수 없습니다. |
| `pluginOptions.i18n.localized` | `false`면 로케일 간에 값을 공유합니다. |

데이터베이스의 모든 속성 컬럼은 nullable입니다. Strapi v5처럼 `required`는 `NOT NULL` 제약이 아니라
게시할 때 Verdin이 강제하므로, 이미 행이 있는 타입에 필수 속성을 추가해도 안전합니다.

## 검증

모든 쓰기는 데이터베이스에 도달하기 전에 스키마로 검사합니다.

- **타입과 제약 조건**은 매번 쓸 때 검사합니다. 값 타입, `minLength`/`maxLength`, `min`/`max`, `regex`,
  `enum` 값, 반복 가능한 컴포넌트와 다이나믹 존의 항목 수, 다이나믹 존이 허용하는 컴포넌트 타입,
  미디어 필드가 받는 파일 타입입니다. 입력의 알 수 없는 키와 시스템 필드는 오류입니다.
- **필수 필드와 필드 간 규칙**은 버전을 게시할 때, 그리고 초안과 게시를 쓰지 않는 타입에서는 매번 쓸 때
  검사합니다. 컴포넌트와 다이나믹 존 안에도 적용됩니다.
- **고유성**은 데이터베이스의 고유 인덱스로 보장하므로, 동시에 일어난 두 쓰기가 모두 성공할 수 없습니다.

검사에 실패하면 `400`과 `ValidationError`로 응답하며, `details.errors`에 `["seo", "metaTitle"]`이나
`["blocks", 2, "text"]` 같은 경로와 함께 각 문제가 나열됩니다. [오류](/ko/api/rest/#오류)를 참고하세요.

### 필드 간 검증

콘텐츠 타입은 자기 필드끼리 비교하는 규칙을 [JSON Logic](https://jsonlogic.com)으로 선언할 수
있습니다. 다음 event 타입은 종료일이 시작일 이후여야 하고, 판매된 티켓이 좌석 수를 넘지 않아야 합니다.

```json title="schema/content-types/event.json"
{
  "kind": "collectionType",
  "singularName": "event",
  "pluralName": "events",
  "displayName": "Event",
  "attributes": {
    "startDate": { "type": "date", "required": true },
    "endDate": { "type": "date" },
    "seats": { "type": "integer", "min": 0 },
    "sold": { "type": "integer", "min": 0 }
  },
  "validations": [
    {
      "rule": { "or": [{ "!": { "var": "endDate" } }, { "<=": [{ "var": "startDate" }, { "var": "endDate" }] }] },
      "message": "must be after the start date",
      "field": "endDate"
    },
    { "rule": { "<=": [{ "var": "sold" }, { "var": "seats" }] }, "message": "more tickets sold than seats" }
  ]
}
```

- 성립하지 않는 규칙은 `message`를 가진 검증 오류이며, `field`가 있으면 그 필드에, 없으면 문서
  (`path: []`)에 붙습니다.
- 규칙은 `required`와 같은 시점에 실행됩니다. 게시할 때, 그리고 초안과 게시를 쓰지 않는 타입에서는 매번
  쓸 때입니다. 초안은 규칙을 어겨도 됩니다.
- `var`는 문서 자신의 필드를 읽으며, 점으로 구분한 경로로 컴포넌트 안까지 읽습니다. 관계와 미디어는
  규칙에서 쓸 수 없습니다.
- 양쪽이 모두 숫자면 숫자로, 모두 문자열이면 텍스트로 비교하므로 ISO 날짜, 시간, 날짜시간이 올바르게
  비교됩니다. 빈 필드는 `null`입니다. 첫 번째 규칙처럼 선택 필드는 미리 확인하세요.
- 허용되는 연산자: `var`, `==`, `!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`, `and`, `or`,
  `in`, `if`, `?:`, `+`, `-`, `*`, `/`, `%`, `min`, `max`, `cat`. 알 수 없는 연산자, 알 수 없는
  `field`, 빈 `message`는 스키마 오류입니다.

규칙은 서버가 검사하며, 게시에 실패하면 관리자 패널이 규칙이 지정한 필드에 메시지를 보여 줍니다.
Strapi에는 이에 해당하는 기능이 없습니다. Strapi의 조건부 필드(`conditions`)는 스키마 파일에서
받아들여 유지하지만, 아직 적용하지는 않습니다.
