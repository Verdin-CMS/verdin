---
title: 속성 타입 레퍼런스
description: Verdin 스키마 파일의 모든 속성 타입과 그 옵션, 검증, 데이터베이스 저장 방식, API 표현.
sidebar:
  order: 4
  label: 속성 타입
---

<!-- Written from crates/verdin-schema (convert.rs, validate.rs, model.rs),
crates/verdin-migrate/src/derive.rs and sql.rs (storage), and crates/verdin-content
(input.rs, output.rs, blocks.rs) (API). -->

속성은 콘텐츠 타입이나 컴포넌트의 필드이며, 스키마 파일의 `attributes` 아래에 선언합니다. 이 페이지에서는 모든 `type`,
받는 옵션, Verdin이 검증하고 저장하는 방식, API에서의 모습을 나열합니다. 형식은 Strapi v5와 같으며, 차이점은
[마지막](#strapi와의-차이)에 있습니다.

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
    "readingTime": { "type": "integer", "min": 0 },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "seo": { "type": "component", "component": "shared.seo" }
  }
}
```

스키마 파일은 엄격합니다. 알 수 없는 키나 타입이 받지 않는 옵션은 오류이며, `verdin schema check`가 경로
(`attributes.title.maxLength`)와 함께 보고합니다.

## 모든 속성이 받는 옵션

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `type` | 필수 | 아래 타입 중 하나. |
| `required` | `false` | 값이 있어야 합니다. 항목을 게시할 때(초안은 불완전해도 됨), 그리고 초안과 게시를 쓰지 않는 타입에서는 매번 쓸 때 검사합니다. 컴포넌트와 다이나믹 존 안에도 적용됩니다. |
| `private` | `false` | 콘텐츠 API가 절대 반환하지 않으며, `filters`나 `sort`에 쓸 수 없습니다. `password` 속성은 항상 private입니다. |
| `configurable` | `true` | 관리자 빌더용 Strapi 플래그. 쓴 그대로 유지합니다. |
| `pluginOptions.i18n.localized` | `true` | 로컬라이즈된 콘텐츠 타입에서 `false`면 로케일마다 값을 두지 않고 로케일 간에 공유합니다. |
| `customField` | 설정 안 됨 | `plugin::<plugin>.<field>`(또는 `global::<field>`): 관리자 패널이 플러그인의 사용자 정의 필드로 속성을 편집합니다. `type`은 값을 저장하는 방식입니다. [플러그인](/ko/extending/plugins/)을 참고하세요. |
| `conditions` | 설정 안 됨 | Strapi의 조건부 필드(`{ "visible": <JSON Logic> }`). 규칙이 거짓인 동안 편집기는 필드를 숨기며, 서버는 숨겨진 필드를 필수로 요구하지 않습니다. |
| `default` | 설정 안 됨 | 쓰기에서 속성을 생략했을 때 새 항목의 값. 타입에 맞아야 합니다. 모든 타입이 받지는 않습니다(타입별 설명 참고). |

속성 이름은 문자로 시작하고 그 뒤에 문자, 숫자, `_`가 오며 최대 50자입니다. 콘텐츠 타입에서는 `id`, `documentId`, `locale`,
`publicationState`, `publishedAt`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`가 예약되어 있고, 컴포넌트에서는
`id`가 예약되어 있습니다. 같은 컬럼에 대응하는 두 이름(`metaTitle`과 `meta_title`)은 오류입니다.

### 값이 저장되는 곳

콘텐츠 타입의 각 속성은 타입 테이블(`collectionName`, 또는 복수 이름)의 컬럼이며, `snake_case`로 이름이 붙습니다. 관계와
미디어는 대신 링크 테이블에 있습니다. 초안과 그 게시 버전은 두 행이며, 로컬라이즈된 타입에서는 로케일마다 하나씩입니다.

데이터베이스별 컬럼 타입:

| 컬럼 | PostgreSQL | MySQL과 MariaDB | SQLite |
| --- | --- | --- | --- |
| varchar | `varchar(255)` | `varchar(255)` | `text` |
| text | `text` | `longtext` | `text` |
| integer | `integer` | `int` | `integer` |
| bigint | `bigint` | `bigint` | `integer` |
| double | `double precision` | `double` | `real` |
| decimal | `numeric(p,s)` | `decimal(p,s)` | `text` (정확한 값) |
| boolean | `boolean` | `tinyint(1)` | `integer` |
| date | `date` | `date` | `text` |
| time | `time(3)` | `time(3)` | `text` |
| datetime | `timestamptz(3)` | `datetime(3)` | `text` |
| json | `jsonb` | `json` | `text` |

콘텐츠 타입에는 `string`, `email`, `uid`, `enumeration` 속성을 최대 60개까지 둘 수 있습니다(MySQL의 행 크기 한도). 더
필요하면 `text`를 쓰세요.

### `unique`

`unique: true`를 받는 타입에는 `(column, locale, publication_state)`에 대한 고유 인덱스가 생깁니다. 같은 로케일에서 게시된
두 항목이나 두 초안은 값을 공유할 수 없지만, 초안과 그 자신의 게시 버전은 공유할 수 있습니다. 이를 어기는 쓰기는 속성에
대한 검증 오류로 실패합니다. 컴포넌트 안에서 `unique`는 받아들이지만 강제하지 않습니다(컴포넌트 값은 JSON으로 저장됨).

## 텍스트

### `string`

한 줄 텍스트.

| 옵션 | 설명 |
| --- | --- |
| `minLength`, `maxLength` | 문자 단위 길이 범위. `maxLength`는 최대 255. |
| `regex` | 값이 일치해야 하는 패턴. look-around와 역참조를 포함한 JavaScript 같은 문법. |
| `unique` | [`unique`](#unique) 참고. |
| `default` | 범위 안에 있고 `regex`와 일치하는 문자열. |

`varchar(255)`로 저장합니다. API: 문자열.

### `text`

더 긴 일반 텍스트(관리자 패널에서는 textarea).

| 옵션 | 설명 |
| --- | --- |
| `minLength`, `maxLength` | 길이 범위, 상한 없음. |
| `default` | 범위 안의 문자열. |

`text`(MySQL은 `longtext`)로 저장합니다. API: 문자열.

### `richtext`

Markdown 텍스트. 옵션, 저장, API는 `text`와 같으며, 관리자 패널은 Markdown 편집기로 편집합니다.

### `blocks`

Strapi의 blocks JSON으로 된 리치 텍스트: `paragraph`, `heading`(`level` 1~6), `list`(`format`은 `ordered` 또는
`unordered`, `list-item` 자식, 최대 8단계 중첩), `quote`, `code`(선택 사항인 `language`), `image` 블록의 리스트입니다.
인라인 자식은 `bold`, `italic`, `underline`, `strikethrough`, `code` 표시를 가진 `text` 노드와 `link` 노드입니다. 최대
블록 10,000개.

옵션도 `default`도 없습니다. JSON으로 저장합니다. API: 쓴 그대로의 블록 리스트.

```json
[
  { "type": "heading", "level": 2, "children": [{ "type": "text", "text": "Hello" }] },
  { "type": "paragraph", "children": [{ "type": "text", "text": "bold", "bold": true }] }
]
```

### `email`

이메일 주소(`name@domain.tld`, 공백 없음).

| 옵션 | 설명 |
| --- | --- |
| `minLength`, `maxLength` | 길이 범위. `maxLength`는 최대 255. |
| `unique` | [`unique`](#unique) 참고. |
| `default` | 이메일 주소. |

`varchar(255)`로 저장합니다. API: 문자열.

### `password`

쓸 때 Argon2id로 해싱하는 비밀 값.

| 옵션 | 설명 |
| --- | --- |
| `minLength`, `maxLength` | 보낸 비밀번호의 길이 범위. |

`default`는 없습니다. 항상 private이며 절대 반환, 필터링, 정렬되지 않습니다. 컴포넌트 안에 둘 수 없습니다.
`varchar(255)`(해시)로 저장합니다. 가져오기는 기존 bcrypt와 Argon2 해시를 그대로 유지하므로 가져온 계정도 계속 로그인할
수 있습니다.

### `uid`

slug 같은 URL용 식별자. 관리자 패널이 `targetField`에서 생성합니다.

| 옵션 | 설명 |
| --- | --- |
| `targetField` | 값을 생성할, 같은 타입의 `string` 또는 `text` 속성. |
| `minLength`, `maxLength` | 길이 범위. `maxLength`는 최대 255. |
| `regex` | 값이 일치해야 하는 패턴. 없으면 `^[A-Za-z0-9\-_.~]*$`. |
| `default` | 올바른 값. |

항상 고유합니다([`unique`](#unique) 참고). `varchar(255)`로 저장합니다. API: 문자열.

### `enumeration`

고정된 목록 중 값 하나.

| 옵션 | 설명 |
| --- | --- |
| `enum` | 값들: 하나 이상, 각각 1~255자, 중복 없음. |
| `default` | 값 중 하나. |

`varchar(255)`로 저장합니다. API: 문자열. 그 밖의 값을 쓰면 실패합니다.

## 숫자

### `integer`

32비트 정수(−2,147,483,648 ~ 2,147,483,647).

| 옵션 | 설명 |
| --- | --- |
| `min`, `max` | 범위(정수). |
| `unique` | [`unique`](#unique) 참고. |
| `default` | 범위 안의 정수. |

`integer`로 저장합니다. API: 숫자. 쓰기는 숫자와 정수 문자열을 받습니다.

### `biginteger`

64비트 정수. 옵션은 `integer`와 같습니다.

`bigint`로 저장합니다. API: Strapi처럼 문자열(`"9007199254740993"`)입니다. JavaScript 숫자는 2⁵³을 넘으면 정밀도를 잃기
때문입니다. 쓰기는 문자열과 숫자를 받습니다.

### `float`

배정밀도 부동소수점 수. 옵션은 `integer`와 같으며 범위는 숫자입니다.

`double precision`(`double`, `real`)으로 저장합니다. API: 숫자.

### `decimal`

정확한 십진수.

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `precision` | `10` | 전체 자릿수, 1~38. |
| `scale` | `2` | 소수점 이하 자릿수, 최대 `precision`. |
| `min`, `max` | | 범위. |
| `unique` | | [`unique`](#unique) 참고. |
| `default` | | 범위 안의 숫자. |

값은 `scale` 자리로 반올림하며(데이터베이스처럼 0에서 먼 쪽으로 반올림), 소수점 앞 자릿수가 `precision - scale`보다 많으면
거부합니다. 쓰기는 숫자와 숫자 문자열을 받습니다. `numeric(precision,scale)`로 저장합니다(SQLite는 반올림되지 않도록
`text`). API: Strapi처럼 숫자. 정수 값은 정수(`25`, `25.0`이 아님)이고, 그 밖의 값은 다시 읽어도 같은 가장 짧은 부동소수점(`12.5`)입니다. [`[api].decimal_as_string`](/ko/reference/configuration/)이면 API는 대신 정확한 문자열을 반환합니다.

## 날짜와 불리언

### `boolean`

`true` 또는 `false`. `default`를 받습니다. `boolean`(`tinyint(1)`, `integer`)으로 저장합니다. API: 불리언.

### `date`

달력 날짜, `YYYY-MM-DD`. `unique`와 `default`를 받습니다. `date`로 저장합니다. API: `"2026-09-29"`.

### `time`

하루 중 시각, `HH:MM`, `HH:MM:SS`, `HH:MM:SS.mmm`. `unique`와 `default`를 받습니다. 밀리초 정밀도로 저장합니다. API:
`"14:30:00.000"`.

### `datetime`

시점: 시간대(`Z` 또는 `+02:00`)가 있는 ISO 8601 타임스탬프. `unique`와 `default`를 받습니다. 밀리초 정밀도의 UTC로
저장합니다. API: `"2026-09-29T12:30:00.000Z"`.

## `json`

아무 JSON 값. `default`(아무 JSON)를 받습니다. `jsonb`(`json`, `text`)로 저장합니다. API: 쓴 그대로의 값. `filters`에서
JSON 속성은 `$null`과 `$notNull`만 지원하며, 정렬할 수 없습니다.

## 미디어

### `media`

미디어 라이브러리의 파일.

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `multiple` | `false` | 파일 하나 대신 파일 리스트를 담습니다. |
| `allowedTypes` | 모두 | 파일 종류: `images`, `videos`, `audios`, `files`(그 밖의 모든 것). |

`default`는 없습니다. 링크 테이블 `{table}_{attribute}_mda`에 순서대로 저장합니다. 쓰기는 파일 id를 받습니다: `12`,
`{ "id": 12 }`, 그 리스트, 또는 `null`. API: `populate`했을 때만, Strapi처럼 파일 객체(`url`, `mime`, `width`,
`formats`…), 그 리스트, 또는 `null`. [미디어](/ko/concepts/media/)를 참고하세요.

## 관계

### `relation`

다른 콘텐츠 타입의 문서로 가는 링크.

| 옵션 | 설명 |
| --- | --- |
| `relation` | `oneToOne`, `oneToMany`, `manyToOne`, `manyToMany`, `oneWay`, `manyWay`, 또는 다형성 종류(아래 참고). |
| `target` | 대상 콘텐츠 타입: `article`, `api::article`, `api::article.article`. |
| `inversedBy` | 양방향 관계의 소유 쪽에서: 이를 반영하는 대상의 속성. |
| `mappedBy` | 반대쪽에서: 대상의 소유 속성. |

양방향 관계의 두 쪽은 서로 맞아야 합니다. `oneToMany`는 `manyToOne`을 반영하고, `oneToOne`과 `manyToMany`는 자기 자신을
반영하며, `mappedBy` 쪽은 `inversedBy`가 되가리키는 속성을 지정합니다. `oneWay`와 `manyWay`에는 반대쪽이 없습니다.

링크는 소유 쪽(`mappedBy`가 없는 쪽)의 `{table}_{attribute}_lnk`에 대상의 `documentId`를 가리키며 순서대로 저장합니다.
쓰기는 `documentId`를 받습니다.

| 쓰기 | 의미 |
| --- | --- |
| `"d8f3…"`, `{ "documentId": "d8f3…" }`, 그 리스트 | 링크를 대체합니다. |
| `null` 또는 `[]` | 모든 링크를 제거합니다. |
| `{ "set": [...] }` | 링크를 대체합니다. |
| `{ "connect": [...], "disconnect": [...] }` | 링크를 추가·제거합니다. `connect` 항목은 `position`을 가질 수 있습니다: `{ "before": id }`, `{ "after": id }`, `{ "start": true }`, `{ "end": true }`. |

API: `populate`했을 때만, 관련 문서로(항목과 관계당 최대 1,000개), 또는 `populate[tags][count]=true`로
`{ "count": n }`. [관계](/ko/concepts/relations/)를 참고하세요.

컴포넌트 안에서는 `oneWay`와 `manyWay`만 허용되며, 컴포넌트가 `documentId`를 저장합니다.

### 다형성 관계

`relation`은 어떤 콘텐츠 타입의 문서든 연결하는 다형성 종류도 받습니다.

| `relation` | 옵션 | 설명 |
| --- | --- | --- |
| `morphToOne` | 없음 | 아무 타입의 문서 하나를 연결합니다. |
| `morphToMany` | 없음 | 여러 타입의 문서를 연결합니다. |
| `morphOne` | `target`, `morphBy` | 역방향 쪽: `target`의 `morphToOne` 또는 `morphToMany` 속성 `morphBy`의 링크를 읽습니다. |
| `morphMany` | `target`, `morphBy` | 위와 같으며 여러 개. |

소유 쪽은 `{table}_{attribute}_mph`에 `(type, documentId)` 쌍을 저장합니다. 쓰기는
`{ "__type": "api::article", "documentId": "…" }` 항목(하나, 리스트, `null`, `{ "set": [...] }`)을 받습니다. populate한
항목은 `__type`에 타입을 담습니다. 컴포넌트 안에 둘 수 없습니다.

## 컴포넌트와 다이나믹 존

### `component`

`schema/components/<category>/<name>.json`에 정의한 필드 그룹.

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `component` | 필수 | 컴포넌트 uid, `category.name`(`shared.seo`). |
| `repeatable` | `false` | 항목 하나 대신 항목 리스트를 담습니다. |
| `min`, `max` | | 항목 수. `repeatable`에서만. |

`default`는 없습니다. 새 항목은 자기 속성의 기본값을 받습니다. 항목 행에 JSON으로 저장하며, 각 항목에 `id`가 있습니다.
쓰기는 항목 객체(또는 리스트)를 받으며, 기존 항목을 유지하려면 `id`를 넣습니다. API: `populate`했을 때만, 항목이나
리스트 전체. `filters`에서 컴포넌트의 필드로 필터링할 수 있습니다(`filters[seo][metaTitle][$eq]=…`).
[컴포넌트와 다이나믹 존](/ko/concepts/components-and-dynamic-zones/)을 참고하세요.

### `dynamiczone`

항목마다 여러 컴포넌트 중 하나인 항목 리스트.

| 옵션 | 설명 |
| --- | --- |
| `components` | 허용하는 컴포넌트 uid: 하나 이상, 중복 없음. |
| `min`, `max` | 항목 수. |

각 항목은 `__component`에 uid를 담습니다. 항목 행에 JSON으로 저장합니다. API: `populate`했을 때만, 리스트 전체.
`filters[blocks][__component][$eq]=blocks.hero`로 컴포넌트별 필터링. 다이나믹 존은 컴포넌트 안에 중첩할 수 없습니다.

## 필드 간 검증

속성별 옵션 외에, 콘텐츠 타입은 `validations`에 여러 필드에 걸친 규칙을 선언할 수 있으며, `required`를 검사할 때마다
검사합니다.

```json
"validations": [
  {
    "rule": { "<=": [{ "var": "startDate" }, { "var": "endDate" }] },
    "message": "The end date must be after the start date",
    "field": "endDate"
  }
]
```

`rule`은 항목에 대해 성립해야 하는 JSON Logic 식입니다. `var`, `==`, `!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`,
`and`, `or`, `in`, `if`, `?:`, `+`, `-`, `*`, `/`, `%`, `min`, `max`, `cat`을 쓸 수 있습니다. `message`는 `field`(타입의
속성)에, 또는 항목에 보고됩니다. Verdin이 추가한 기능이며 Strapi에는 이에 해당하는 기능이 없습니다.

## Strapi와의 차이

- **컴포넌트는 JSON으로 저장합니다.** 조인 테이블이 있는 컴포넌트 테이블이 아니라 항목 행에 저장합니다. 읽기에 조인이
  필요 없으며, 그 결과 `password` 속성, 다형성 관계, 양방향 관계를 컴포넌트 안에 둘 수 없고, 거기서는 `unique`를
  강제하지 않습니다.
- **populate한 컴포넌트는 통째로 옵니다.** 컴포넌트나 다이나믹 존에 대한 `populate`는 모든 필드를 반환하며, Strapi처럼
  중첩 필드를 고를 수 없습니다.
- **엄격한 스키마 파일.** Strapi는 알 수 없는 키와 타입이 받지 않는 옵션을 무시하지만 Verdin에서는 오류입니다.
  `pluginOptions`에서는 `i18n.localized`만 읽고 나머지는 무시합니다.
- **`string`, `email`, `uid`는 최대 255자**(컬럼 크기)로 제한되며, 데이터베이스에서 실패하지 않습니다.
- **`conditions`** (조건부 필드)는 Strapi 5.17과 같이 동작합니다. 숨겨진 필드는 필수가 아닙니다.
- <strong>`validations`</strong>는 Verdin 자체 기능입니다.
- 나머지는 Strapi v5와 같습니다. 타입 이름, 옵션, 문자열로 된 `biginteger` 값, `connect`, `disconnect`, `set`,
  `position`을 쓰는 관계 쓰기, blocks 형식입니다.
