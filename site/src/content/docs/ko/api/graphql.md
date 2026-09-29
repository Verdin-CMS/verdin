---
title: "GraphQL API"
description: "Verdin GraphQL 엔드포인트 활성화, 콘텐츠 타입에서 생성되는 스키마, 쿼리, 뮤테이션, 커넥션, 오류와 한도."
sidebar:
  order: 2
  label: "GraphQL"
---

Verdin은 콘텐츠 타입에서 생성한 GraphQL API를 Strapi v5 GraphQL 플러그인과 같은 형태로 제공할 수
있습니다. REST API와 권한, 필터, 페이지네이션, 검증을 공유합니다. GraphQL 인자는 REST 요청이 만드는 것과
같은 쿼리로 변환됩니다. 이 페이지는 레퍼런스이며, 예제는
[blog 예제](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog)를 사용합니다.

## 활성화

GraphQL은 기본적으로 꺼져 있습니다. **설정 → 기능 → GraphQL**에서 켭니다(권한
`features.manage`). 변경은 재시작 없이 바로 적용되며, 엔드포인트는 다음과 같습니다.

```
POST /graphql
```

REST 접두사 아래가 아니라 서버 루트에서 제공됩니다.
`{ "query", "variables", "operationName" }`를 JSON으로 보냅니다. `GET /graphql?query=…`로도 쿼리를
실행할 수 있습니다(뮤테이션은 `POST` 필요).

```sh title="Terminal"
curl -X POST 'https://cms.example.com/graphql' \
  -H "Authorization: Bearer $VERDIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ articles(sort: [\"publishedAt:desc\"]) { documentId title } }"}'
```

호출자는 REST API와 똑같이 인증합니다. 공개 접근은 헤더 없이, 또는 API 토큰이나 최종 사용자의 JWT를
씁니다. 형식이 잘못된 `Authorization` 헤더나 알 수 없는 토큰은 `401`로 응답합니다.
[권한](/ko/concepts/permissions/)을 참고하세요. 다른 출처의 브라우저에는 `[api].cors_origins`가 필요합니다.

### 설정

| 설정 | 기본값 | 위치 | 효과 |
| --- | --- | --- | --- |
| **GraphiQL 플레이그라운드** | `verdin dev`에서 켜짐, `verdin start`에서 꺼짐 | 기능 설정 | 브라우저가 `GET /graphql`을 열면 GraphiQL을 제공합니다. unpkg.com에서 로드됩니다. |
| **인트로스펙션** | 켜짐 | 기능 설정 | 클라이언트와 도구가 스키마를 읽을 수 있게 합니다. 공개적으로 스키마를 숨기려면 끄세요. |
| **비활성화된 작업** | 없음 | 기능 설정 | 콘텐츠 타입별로 `find`, `findOne`, `create`, `update`, `delete`(또는 모든 쿼리, 모든 뮤테이션, 전부)를 스키마에서 뺍니다. Strapi의 shadow CRUD 스위치와 같습니다. REST에는 영향이 없습니다. |
| `maxDepth` | `10` | Admin API | 허용되는 최대 선택 깊이. |
| `maxComplexity` | `1000` | Admin API | 허용되는 최대 쿼리 복잡도(대략 선택한 필드 수). |

`maxDepth`와 `maxComplexity`는 아직 패널에 입력란이 없습니다.
[admin API](/ko/api/admin/)로 설정하세요. `GET /admin/api/features`는 현재 설정을 반환하고,
`PUT /admin/api/features/graphql`은 설정을 통째로 바꾸므로 유지할 값도 함께 보내야 합니다.

```json
{ "enabled": true, "settings": { "playground": false, "introspection": true, "maxDepth": 8, "maxComplexity": 500 } }
```

## 스키마

각 콘텐츠 타입마다 스키마에는 `singularName`을 PascalCase로 바꾼 이름의 객체 타입이 있습니다
(`article` → `Article`, `blog-post` → `BlogPost`). 포함되는 필드는 다음과 같습니다.

- `documentId: ID!`
- `private`가 아닌 모든 속성
- `DateTime` 타입의 `createdAt`, `updatedAt`, `publishedAt`
- 로컬라이즈된 타입에서는 `locale: String`

| 속성 | GraphQL 타입 |
| --- | --- |
| `string`, `text`, `richtext`, `email`, `uid`, `enumeration` | `String` |
| `integer` | `Int` |
| `biginteger` | `Long` (REST처럼 문자열) |
| `float`, `decimal` | `Float` |
| `boolean` | `Boolean` |
| `date`, `time`, `datetime` | `Date`, `Time`, `DateTime` |
| `json`, `blocks` | `JSON` |
| 대일(to-one) 관계 | 대상의 타입, 예: `Category` |
| 대다(to-many) 관계 | `[Tag!]!`, `filters`, `pagination`, `sort` 인자 포함 |
| `media` | `UploadFile`, `multiple`이면 `[UploadFile!]!` |
| `component` | `ComponentSharedSeo` (UID `shared.seo`에서), 반복 가능하면 리스트 |
| `dynamiczone` | `[ArticleBlocksDynamicZone!]!`, 해당 컴포넌트들의 유니온 |
| 다형성 관계 | `JSON` (`__type`을 포함한 문서) |

루트 `Query`에는 서버 버전인 `verdin: String!`도 있습니다.

## 쿼리

| 컬렉션 타입 `article` | 반환값 |
| --- | --- |
| `articles(filters, pagination, sort, status, locale)` | `[Article!]!` |
| `articles_connection(filters, pagination, sort, status, locale)` | `nodes`와 `pageInfo`를 가진 `ArticleEntityResponseCollection` |
| `article(documentId: ID!, status, locale)` | `Article` 또는 `null` |

| 싱글 타입 `homepage` | 반환값 |
| --- | --- |
| `homepage(status, locale)` | `Homepage` 또는 `null` |

쿼리와 필드 이름은 `pluralName`과 `singularName`을 camelCase로 바꾼 것입니다
(`blog-posts` → `blogPosts`).

```graphql
query LatestArticles($page: Int) {
  articles_connection(
    filters: { category: { name: { eq: "News" } }, title: { containsi: "rust" } }
    sort: ["publishedAt:desc"]
    pagination: { page: $page, pageSize: 10 }
  ) {
    nodes {
      documentId
      title
      slug
      category { name }
      tags(sort: ["label:asc"]) { label }
      seo { metaTitle metaDescription }
      blocks {
        __typename
        ... on ComponentBlocksHero { title subtitle }
        ... on ComponentBlocksQuote { text author }
      }
    }
    pageInfo { page pageSize pageCount total }
  }
}
```

같은 요청을 REST로 보내면 다음과 같습니다.

```http
GET /api/articles?filters[category][name][$eq]=News&filters[title][$containsi]=rust
  &sort=publishedAt:desc&pagination[page]=1&pagination[pageSize]=10
  &populate[category][fields][0]=name&populate[tags][sort]=label:asc&populate[0]=seo&populate[1]=blocks
```

### 인자

- **`filters`**: 속성마다 필드 하나와 `documentId`, 타임스탬프, `and`, `or`, `not`을 가진
  `ArticleFiltersInput`입니다. 스칼라 필드는 `StringFilterInput` 같은 연산자 입력을 받으며, 연산자는
  `$`를 뺀 [REST 연산자](/ko/api/rest/#필터)입니다: `eq`, `ne`, `containsi`, `in`, `between`, `null`…
  관계는 대상의 필터 입력을, 반복 불가능한 컴포넌트는 해당 컴포넌트의 필터 입력을 받습니다.
- **`pagination`**: `{ page, pageSize }` 또는 `{ start, limit }`. 기본값과 최댓값은 REST와 같습니다.
- **`sort`**: REST처럼 `"field"` 또는 `"field:asc|desc"` 문자열의 리스트입니다.
- **`status`**: `PUBLISHED`(기본값) 또는 `DRAFT`. `DRAFT`에는 `readDrafts` 권한이 필요합니다.
  관련 문서는 항상 부모의 상태를 따릅니다.
- **`locale`**: 로컬라이즈된 타입의 로케일 코드. 지정하지 않으면 기본 로케일입니다.

선택한 것만 로드됩니다. 선택이 REST `populate`가 되고, 관계의 각 단계는 배치 쿼리 하나로 처리됩니다.
`articles_connection`의 `pageInfo`는 일치하는 전체 수(`total`)와 페이지 수(`pageCount`)를 셉니다.

## 뮤테이션

| 컬렉션 타입 `article` | 반환값 |
| --- | --- |
| `createArticle(data: ArticleInput!, status, locale)` | `Article` |
| `updateArticle(documentId: ID!, data: ArticleInput!, status, locale)` | `Article` |
| `deleteArticle(documentId: ID!, locale)` | `DeleteMutationResponse` (`{ documentId }`) |

| 싱글 타입 `homepage` | 반환값 |
| --- | --- |
| `updateHomepage(data: HomepageInput!, status, locale)` | `Homepage`. 첫 업데이트가 문서를 만듭니다 |
| `deleteHomepage(locale)` | `DeleteMutationResponse` |

```graphql
mutation {
  createArticle(
    data: { title: "Hello, Verdin", slug: "hello-verdin", category: "k2m7q4…", tags: ["a7c1…"] }
    status: DRAFT
  ) {
    documentId
    publishedAt
  }
}
```

- REST와 마찬가지로 `create`와 `update`는 `status: DRAFT`가 아니면 게시합니다. 별도의 게시 뮤테이션은
  없습니다. 게시 취소나 초안 폐기는 REST [액션](/ko/api/rest/#액션)을 사용하세요.
- 입력은 속성을 그대로 따릅니다. 관계는 `ID` 또는 `[ID!]`(`documentId`)를, 미디어는 파일 id를,
  컴포넌트는 해당 `…Input` 타입을 받고, 다이나믹 존 항목은 `__component`를 가진 `JSON` 객체입니다.
  역방향(`mappedBy`) 관계는 입력에 없습니다.
- `delete` 뮤테이션은 `locale`의 버전(지정하지 않으면 기본 로케일)을 삭제합니다.
  `DELETE /api/articles/{documentId}?locale=fr`과 같습니다.
- REST와 같은 검증이 실행됩니다.

## 오류

GraphQL 오류는 `200` 응답의 `errors` 리스트로 오며, 코드는 `extensions.code`에 있습니다.

```json
{
  "data": { "createArticle": null },
  "errors": [
    {
      "message": "title is a required field",
      "path": ["createArticle"],
      "extensions": {
        "code": "BAD_USER_INPUT",
        "details": [{ "path": ["title"], "message": "title is a required field", "name": "ValidationError" }]
      }
    }
  ]
}
```

| 코드 | 발생 조건 |
| --- | --- |
| `FORBIDDEN` | 호출자에게 해당 작업 권한이 없거나, `status: DRAFT`에 필요한 `readDrafts`가 없습니다. |
| `BAD_USER_INPUT` | 인자나 콘텐츠가 잘못되었습니다. `details`에 검증 문제와 경로가 나열됩니다. |
| `NOT_FOUND` | 문서가 존재하지 않습니다(업데이트와 삭제 시). |
| `INTERNAL_SERVER_ERROR` | 예상치 못한 오류이며 서버에 로그가 남습니다. |

`maxDepth`보다 깊거나 `maxComplexity`보다 복잡한 쿼리는 실행 전에 거부됩니다.

## 한도

GraphQL에는 REST API의 한도 외에 자체 한도(`maxDepth`, `maxComplexity`)가 있습니다. 리스트당 최대
`[api].max_page_size`개 문서, 관계 중첩은 최대 5단계, 문서와 관계당 관련 문서 최대 1,000개, 필터 조건
최대 100개입니다. [REST 한도](/ko/api/rest/#한도)를 참고하세요.

## 플러그인

[플러그인](/ko/extending/plugins/)은 `name(args: JSON): JSON` 형태의 루트 쿼리와 뮤테이션을 추가할 수
있습니다. 콘텐츠 타입이 이미 쓰는 이름은 건너뜁니다.

## Strapi와 비교

타입, 쿼리, 뮤테이션 이름, `nodes`와 `pageInfo`를 가진 `_connection` 쿼리, `documentId` 인자,
`status`와 `locale`은 Strapi v5 GraphQL 플러그인을 따르며, 로컬라이즈된 타입에는 `locale` 필드가
있습니다. 타입은 `id`를 노출하지 않고 GraphQL 구독(subscription)은 없습니다. 실시간 업데이트에는
[실시간 API](/ko/api/realtime/)를 사용하세요.
