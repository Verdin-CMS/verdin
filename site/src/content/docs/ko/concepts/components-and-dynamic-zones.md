---
title: "컴포넌트와 다이나믹 존"
description: "재사용 가능한 필드 그룹과 여러 블록을 섞는 리스트, Verdin이 이를 문서에 JSON으로 저장하는 이유, 그리고 그것이 관계, 미디어, 필터링, populate에 주는 영향."
sidebar:
  order: 2
---

컴포넌트는 여러 콘텐츠 타입에서 필드 그룹을 재사용하게 해 주고, 다이나믹 존은 편집자가 블록 리스트로
페이지를 구성하게 해 줍니다. 이 페이지에서는 둘을 어떻게 모델링하고 저장하는지, 그리고 그것이 읽기,
쓰기, 필터링에 어떤 영향을 주는지 설명합니다. 스키마 형식 자체는 [콘텐츠 모델](/ko/concepts/content-model/)에
있습니다.

## 컴포넌트

컴포넌트는 `schema/components/<category>/` 아래에 자체 파일을 가진 필드 그룹입니다. blog 예제의
`shared.seo`는 메타 제목과 설명을 담습니다.

```json title="schema/components/shared/seo.json"
{
  "displayName": "SEO",
  "attributes": {
    "metaTitle": { "type": "string", "maxLength": 60 },
    "metaDescription": { "type": "text", "maxLength": 160 }
  }
}
```

콘텐츠 타입은 `component` 속성으로 컴포넌트를 씁니다. `repeatable: true`는 리스트로 만들며,
`min`과 `max`로 항목 수를 제한할 수 있습니다.

```json
"seo": { "type": "component", "component": "shared.seo" },
"links": { "type": "component", "component": "shared.link", "repeatable": true, "max": 10 }
```

컴포넌트는 다른 컴포넌트를 포함할 수 있습니다. 직접이든 다른 컴포넌트를 거쳐서든 자기 자신은 포함할 수
없으며, 스키마 검사가 이런 순환을 거부합니다.

## 다이나믹 존

다이나믹 존은 지정한 컴포넌트 중 어느 것이든 항목으로 가질 수 있는 리스트입니다. blog의 글 본문은
히어로와 인용을 섞어 씁니다.

```json
"blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"], "max": 20 }
```

각 항목은 `__component`에 자신이 어떤 컴포넌트인지 적습니다. `min`과 `max`는 항목 수를 제한합니다.
다이나믹 존은 콘텐츠 타입에만 둘 수 있으며, 컴포넌트는 다이나믹 존을 포함할 수 없습니다.

## JSON으로 저장

Verdin은 컴포넌트나 다이나믹 존 값을 문서 행의 JSON 컬럼 하나에 저장합니다(PostgreSQL은 `jsonb`,
MySQL과 MariaDB는 `json`, SQLite는 text).

```json
// the "seo" column
{ "id": 1, "metaTitle": "Rust for CMS authors", "metaDescription": "…" }

// the "blocks" column
[
  { "__component": "blocks.hero", "id": 1, "title": "Hello", "subtitle": "…" },
  { "__component": "blocks.quote", "id": 2, "text": "…", "author": "Ferris" }
]
```

Strapi는 각 컴포넌트를 자체 테이블에 두고 다형성 링크 테이블로 조인합니다. 대신 값을 문서와 함께
저장하면 다음과 같습니다.

- 컴포넌트가 아무리 깊게 중첩되어도 문서와 컴포넌트를 읽을 때 조인이 필요 없습니다.
- 게시, 초안 폐기, [콘텐츠 기록](/ko/guides/content/content-history/)은 값을 그대로 복사합니다.
- 컴포넌트에 필드를 추가해도 테이블이 바뀌지 않습니다. 마이그레이션이 비어 있습니다.
- 컴포넌트 필드로 필터링할 때는 각 데이터베이스의 JSON 함수를 쓰며, 일부 필터는 쓸 수 없습니다
  ([필터링](#필터링) 참고).

모든 항목에는 속성 값 안에서 고유한 양의 정수 `id`가 있습니다. 새 항목에는 Verdin이 id를 부여합니다.
리스트를 업데이트할 때 `id`를 다시 보내면 항목이 안정적으로 유지됩니다.

## 컴포넌트 안의 관계와 미디어

컴포넌트는 관계와 미디어를 담을 수 있으며, JSON 자체에 저장됩니다. 관계는 `documentId`로, 미디어는 파일
id로 저장됩니다.

- 컴포넌트 안의 관계는 `oneWay` 또는 `manyWay`여야 합니다. 대상을 가리킬 뿐 역방향 쪽이 없습니다.
  [관계](/ko/concepts/relations/#컴포넌트-안의-관계)를 참고하세요.
- 모든 참조는 쓰기 시점에 확인합니다. 대상 문서나 파일이 존재해야 하고, 파일은 필드의 `allowedTypes`와
  맞아야 합니다.
- 컴포넌트를 populate하면 참조는 문서와 같은 상태와 로케일에서 배치 쿼리로 해석됩니다. 삭제되었거나
  읽고 있는 버전이 없는 대상은 빠집니다.
- 다형성 관계(`morphToOne`, `morphToMany`)와 `password` 필드는 컴포넌트 안에 둘 수 없습니다.

## 읽기

컴포넌트와 다이나믹 존은 Strapi처럼 populate했을 때만 반환됩니다.

```http
GET /api/articles?populate[0]=seo&populate[1]=blocks
GET /api/articles?populate=*
```

populate한 컴포넌트는 중첩 컴포넌트와 해석된 관계, 미디어를 포함해 통째로 반환됩니다. Strapi는 중첩
컴포넌트마다 `populate` 단계가 필요하지만, Verdin은 호환성을 위해 그런 중첩 옵션을 받아들이고 무시합니다.
다이나믹 존 항목은 저장된 순서대로, 각각 `__component`와 함께 반환됩니다.

GraphQL에서 컴포넌트는 UID로 이름 붙인 객체 타입(`ComponentSharedSeo`)이고, 다이나믹 존은 프래그먼트로
쿼리하는 유니온(`ArticleBlocksDynamicZone`)입니다. [GraphQL API](/ko/api/graphql/)를 참고하세요.

## 쓰기

속성의 값 전체를 보냅니다. 저장된 값을 대체합니다.

```json
{
  "data": {
    "seo": { "metaTitle": "Rust for CMS authors" },
    "blocks": [
      { "__component": "blocks.hero", "title": "Hello" },
      { "__component": "blocks.quote", "text": "Fast and small.", "author": "Ferris" }
    ]
  }
}
```

값은 쓸 때마다 컴포넌트 스키마로 검증됩니다. 알 수 없는 키, 잘못된 타입, 다이나믹 존이 허용하지 않는
`__component`는 `["blocks", 1, "text"]` 같은 경로를 가진 오류입니다. 컴포넌트 안의 `required` 필드는
최상위 필드와 마찬가지로 문서를 게시할 때 확인합니다.

## 필터링

| 대상 | 예 | 참고 |
| --- | --- | --- |
| 컴포넌트의 필드 | `filters[seo][metaTitle][$containsi]=rust` | 스칼라 필드, 중첩 컴포넌트 포함. |
| 반복 가능한 컴포넌트의 필드 | `filters[links][url][$contains]=github` | 항목 중 하나라도 일치하면 일치. |
| 다이나믹 존 | `filters[blocks][__component][$eq]=blocks.quote` | `__component`로만 가능. 컴포넌트마다 필드가 다르기 때문입니다. |

컴포넌트 필드로는 정렬할 수 없고, 컴포넌트 안의 `json` 필드로는 필터링할 수 없습니다. 연산자는
[REST API](/ko/api/rest/#필터)를 참고하세요.
