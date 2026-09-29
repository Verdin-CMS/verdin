---
title: "관계"
description: "관계 종류, Verdin이 documentId로 문서를 연결하는 방식, 순서, 다형성 관계, 그리고 컴포넌트 안에서 oneWay와 manyWay가 뜻하는 것."
sidebar:
  order: 3
---

관계는 글과 그 카테고리처럼 두 콘텐츠 타입의 문서를 연결합니다. 이 페이지에서는 관계 종류, 링크가
저장되고 해석되는 방식, 그리고 관계를 쓰고, 정렬하고, 읽는 규칙을 설명합니다. 요청 문법은
[REST API](/ko/api/rest/#쓰기)를 참고하세요.

## 종류

관계는 `relation` 종류와 `target` 콘텐츠 타입을 가진 `type: "relation"` 속성입니다.

| 종류 | 문서가 연결하는 대상 | 대상을 연결하는 문서 | 역방향 쪽 |
| --- | --- | --- | --- |
| `oneWay` | 대상 하나 | 여러 문서 | 없음 |
| `manyWay` | 여러 대상 | 여러 문서 | 없음 |
| `manyToOne` | 대상 하나 | 여러 문서 | `oneToMany` |
| `oneToMany` | 여러 대상 | 문서 하나 | `manyToOne` |
| `oneToOne` | 대상 하나 | 문서 하나 | `oneToOne` |
| `manyToMany` | 여러 대상 | 여러 문서 | `manyToMany` |

blog 예제는 글을 카테고리(역방향 쪽 있음)와 태그(역방향 쪽 없음)에 연결합니다.

```json title="schema/content-types/article.json (excerpt)"
"category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
"tags": { "type": "relation", "relation": "manyToMany", "target": "tag" }
```

```json title="schema/content-types/category.json (excerpt)"
"articles": { "type": "relation", "relation": "oneToMany", "target": "article", "mappedBy": "category" }
```

- `inversedBy`가 있는(또는 두 키가 모두 없는) 쪽이 **소유** 쪽입니다. 링크를 저장하며, 쓰기는 이쪽에
  합니다.
- `mappedBy`가 있는 쪽이 **역방향** 쪽입니다. 소유 쪽의 링크를 거꾸로 읽으며 읽기 전용입니다. 이쪽에 쓰면
  소유 속성을 명시한 검증 오류가 납니다.
- 양쪽은 서로 맞아야 합니다. `mappedBy`는 `inversedBy`로 되가리키는 대상의 속성을 지정하며, 종류는 표의
  역방향 종류와 일치해야 합니다.
- `oneWay`와 `manyWay`에는 역방향 쪽이 없습니다.

콘텐츠 타입 빌더는 대상에 역방향 속성을 자동으로 만들어 줍니다.

## 행이 아니라 문서로 연결

문서에는 여러 행이 있습니다. 초안과 게시 버전, 그리고 로케일마다 각각 하나씩입니다. Verdin은 관계를
원본 **행**에서 대상 **문서**(`documentId`)로 가는 링크로, `{table}_{field}_lnk`라는 링크 테이블에
저장합니다. 대상 행은 관계를 읽을 때 정해집니다.

- 게시된 글은 카테고리의 게시된 버전을 보고, 글의 초안은 카테고리의 초안을 봅니다. 초안과 게시를 쓰지
  않는 타입에는 버전이 하나이며 모든 독자가 그 버전을 봅니다.
- 대상도 로컬라이즈되어 있으면 같은 로케일로 해석합니다. 로컬라이즈되지 않은 대상 타입은 모든 로케일이
  공유합니다.
- 카테고리를 게시 취소하면 링크를 건드리지 않고 게시된 글에서 숨겨지며, 다시 게시하면 돌아옵니다.
- 글을 게시하면 그 글 자신의 링크만 게시된 버전으로 복사됩니다.

Strapi는 대신 행 id를 연결하므로 초안을 게시할 때마다 링크를 다시 써야 합니다. Verdin은 그럴 필요가
없어서, 게시는 초안 행을 한 번 복사하는 것으로 끝납니다.

무결성은 외래 키가 아니라 Verdin이 유지합니다. 존재하지 않는 문서를 연결하면 검증 오류이고, 문서를
삭제하면 같은 트랜잭션에서 그 문서를 가리키는 링크가 삭제됩니다.

### 대상마다 문서 하나

`oneToOne`과 `oneToMany`에서 대상은 최대 한 원본 문서에만 속합니다. 다른 문서가 가진 대상을 연결하면
대상이 **옮겨집니다**. 같은 쓰기에서 다른 문서의 링크가 제거됩니다. Strapi와 같은 동작입니다. 이 규칙은
버전별로 적용되므로, 초안과 그 게시 버전은 같은 대상을 가질 수 있습니다.

## 쓰기

소유 쪽에서 `data`는 `documentId`, 그 리스트, 또는 변경을 기술하는 객체를 받습니다.

| 입력 | 효과 |
| --- | --- |
| `"k2m…"` 또는 `{ "documentId": "k2m…" }` | 대상 하나를 연결(대일 관계). |
| `["k2m…", "p9x…"]` | 모든 링크를 이 순서로 대체. |
| `null` 또는 `[]` | 모든 링크를 제거. |
| `{ "set": ["k2m…"] }` | 모든 링크를 대체. |
| `{ "connect": [...], "disconnect": [...] }` | 나머지는 유지하고 링크를 추가·제거. |

대일 관계에 새 대상을 연결하면 이전 대상을 대체합니다. `set`은 `connect`나 `disconnect`와 함께 쓸 수
없습니다.

관리자 패널에서 관계 필드는 연결된 항목을 나열합니다. **항목 연결**(대다 관계에서도 **항목 연결**)은 대상
타입의 항목을 텍스트 필드 전체에서, 대상이 로컬라이즈된 경우 항목의 로케일에서 검색하는 대화 상자를
엽니다. 항목 하나를 고르거나 여러 개를 체크해서 추가합니다. 이미 연결된 항목은 표시됩니다.

## 순서

대다 관계는 링크 순서를 유지합니다. 리스트나 `set`은 보낸 순서를 저장합니다. `connect` 항목은 들어갈
위치를 지정할 수 있습니다.

```json
{
  "data": {
    "tags": {
      "connect": [
        { "documentId": "k2m…", "position": { "before": "p9x…" } },
        { "documentId": "a7c…", "position": { "end": true } }
      ]
    }
  }
}
```

`position`은 `{ "before": documentId }`, `{ "after": documentId }`, `{ "start": true }`,
`{ "end": true }` 중 하나입니다. 위치는 쓸 때마다 다시 매겨집니다. 읽기는 populate가 `sort`를 요청하지
않으면 관련 문서를 링크 순서대로 반환합니다.

## 읽기

관계는 populate했을 때만 반환됩니다.

```http
GET /api/articles?populate[category][fields][0]=name&populate[tags][sort]=label:asc
```

대일 관계는 객체 또는 `null`이고, 대다 관계는 배열입니다. populate한 각 관계는 자체 `fields`, `filters`,
`sort`, `populate`, `count`를 최대 다섯 단계까지 받을 수 있습니다. 각 단계는 조인이 아니라 관계마다 배치
쿼리 하나(`WHERE … IN (…)`)이므로 깊은 populate에서도 행이 불어나지 않습니다. 문서와 관계당 관련 문서는
최대 1,000개까지 반환되며, `count`가 정확한 개수를 알려 줍니다.

관계를 통해 양쪽 어디서든 필터링할 수 있고(`filters[category][name][$eq]=News`), 대일 관계의 필드로
정렬할 수 있습니다(`sort=category.name:asc`). 호출자가 읽을 수 없는 타입으로 가는 관계를 통해 populate,
필터링, 정렬하면 거부되므로(`populate=*`는 건너뜀), 관계가 호출자의 [권한](/ko/concepts/permissions/)이
숨기는 콘텐츠를 드러내는 일은 없습니다.

## 컴포넌트 안의 관계

[컴포넌트](/ko/concepts/components-and-dynamic-zones/)는 관계를 담을 수 있지만 `oneWay`와 `manyWay`만
가능합니다.

```json title="schema/components/shared/related.json"
{
  "displayName": "Related",
  "attributes": {
    "label": { "type": "string" },
    "articles": { "type": "relation", "relation": "manyWay", "target": "article" }
  }
}
```

컴포넌트의 JSON은 `documentId` 자체를 저장합니다. `oneWay`는 문자열, `manyWay`는 배열입니다. 다른 종류를
허용하지 않는 이유는 다음과 같습니다.

- 역방향 쪽은 누가 자신을 연결하는지 찾기 위해 모든 문서의 JSON을 검색해야 합니다.
- "대상마다 문서 하나"(`oneToOne`, `oneToMany`)도 그런 검색 없이는 강제할 수 없습니다.

컴포넌트 안에서 `manyWay` 리스트의 순서는 배열의 순서입니다. 참조는 쓸 때 확인하고, 컴포넌트를 populate할
때 문서의 상태와 로케일로 해석하며, 더 이상 존재하지 않는 대상은 빠집니다. 이 관계로는 필터링할 수 없습니다.

## 다형성 관계

`morphToOne`과 `morphToMany`는 어떤 콘텐츠 타입의 문서든 연결합니다. 링크는 대상의 `documentId`와 함께
대상의 타입을 저장하며, 쓸 때 둘 다 지정합니다.

```json
{ "data": { "related": [{ "__type": "api::article", "documentId": "k2m…" }, { "__type": "api::page", "documentId": "p9x…" }] } }
```

populate한 항목은 `__type`을 가진 대상 문서이며, 요청의 상태와 로케일로 읽습니다. 역방향 쪽인
`morphOne`과 `morphMany`는 소유 타입(`target`)과 그 속성(`morphBy`)을 지정하며 읽기 전용입니다. 다형성
관계로는 필터링하거나 정렬할 수 없고, 컴포넌트 안에 둘 수 없습니다.
