---
title: "국제화"
description: "Verdin이 로케일마다 문서의 버전 하나를 유지하는 방법, 어떤 필드가 로컬라이즈되거나 공유되는지, API가 로케일을 고르는 방법."
sidebar:
  order: 5
---

국제화(i18n)는 문서의 콘텐츠를 여러 언어로 유지합니다. 이 페이지에서는 모델을 설명합니다. 로케일,
로컬라이즈된 필드와 공유 필드, 그리고 읽기와 쓰기가 로케일을 고르는 방식입니다. 편집자의 작업 흐름은
[콘텐츠 현지화](/ko/guides/content/localizing-content/)를 참고하세요.

## 로케일

프로젝트의 로케일은 **설정 → 국제화**(권한 `locales.manage`)에 나열됩니다. 처음 시작하면 영어(`en`)가
기본 로케일로 추가됩니다.

- 로케일 하나는 항상 기본 로케일입니다. 로케일을 지정하지 않은 요청은 기본 로케일을 쓰며, 기본 로케일은
  삭제할 수 없습니다.
- 코드는 소문자 두세 글자의 언어 코드이며, 뒤에 하위 태그가 붙을 수 있습니다: `en`, `fr`, `pt-BR`,
  `zh-Hans`.

:::caution
로케일을 삭제하면 그 로케일로 작성된 모든 버전도 삭제됩니다.
:::

## 로컬라이즈된 콘텐츠 타입

스키마에 지정하면 콘텐츠 타입이 로컬라이즈됩니다. 그러면 각 문서는 로케일마다 버전 하나를 가지며, 모두
같은 `documentId`를 공유합니다.

```json title="schema/content-types/article.json (excerpt)"
{
  "kind": "collectionType",
  "singularName": "article",
  "pluralName": "articles",
  "displayName": "Article",
  "options": { "draftAndPublish": true },
  "pluginOptions": { "i18n": { "localized": true } },
  "attributes": {
    "title": { "type": "string", "required": true },
    "readingTime": { "type": "integer", "pluginOptions": { "i18n": { "localized": false } } }
  }
}
```

[초안과 게시](/ko/concepts/draft-and-publish/)를 쓰면 로케일마다 자체 초안과 게시 버전이 있으므로, 프랑스어
번역을 영어 원문보다 먼저 또는 나중에 게시할 수 있습니다. `pluginOptions.i18n.localized`가 없는 타입은
로컬라이즈되지 않으며 `locale` 파라미터를 무시합니다.

## 로컬라이즈되는 것

로컬라이즈된 타입에서는 `"pluginOptions": { "i18n": { "localized": false } }`라고 지정하지 않은 모든
속성이 로컬라이즈됩니다. 이렇게 지정한 **공유** 필드는 문서 전체에서 값이 하나입니다.

- 한 로케일에서 공유 필드를 저장하면 모든 로케일의 초안에 기록됩니다.
- 한 로케일을 게시하면 그 공유 필드가 다른 로케일의 게시된 버전으로 복사됩니다.
- 관계와 미디어에도 적용됩니다. 공유 관계는 모든 로케일에서 같은 문서를 연결합니다.

시스템 필드는 버전을 따릅니다. 로케일마다 자체 `createdAt`, `updatedAt`, `publishedAt`을 가집니다.
`unique`와 `uid` 값은 로케일별로 고유하므로 두 번역이 같은 slug를 가질 수 있습니다.

## 로컬라이즈된 타입 사이의 관계

관계는 버전이 아니라 문서를 연결하므로([관계](/ko/concepts/relations/#행이-아니라-문서로-연결)
참고), 로케일은 읽을 때 정해집니다.

- 두 타입이 모두 로컬라이즈되어 있으면, 프랑스어 글은 카테고리의 프랑스어 버전을 보여 줍니다. 관계를 통한
  필터도 같은 로케일에서 일치합니다.
- 대상 타입이 로컬라이즈되지 않았으면 모든 로케일이 같은 대상을 봅니다.

## API에서 로케일 고르기

REST와 admin API는 Strapi v5 형식으로 `locale`을 쿼리 파라미터로 받고, GraphQL은 `locale` 인자를
받습니다.

```http
GET /api/articles?locale=fr
PUT /api/articles/{documentId}?locale=fr
DELETE /api/articles/{documentId}?locale=fr
```

```graphql
query {
  articles(locale: "fr") {
    documentId
    title
  }
}
```

- `locale`이 없으면 요청은 기본 로케일을 읽고 씁니다.
- 문서에 아직 없는 로케일로 `PUT`하면 그 버전이 만들어집니다.
- `DELETE`는 요청한 로케일의 버전만 삭제합니다. 문서를 가리키는 링크는 로케일이 하나도 남지 않으면
  삭제됩니다.
- 로컬라이즈된 타입의 REST 응답에는 `locale`이 포함됩니다. 알 수 없는 로케일은 `400` 오류입니다.
- 웹훅 페이로드, 실시간 이벤트, 콘텐츠 기록은 변경된 버전의 로케일을 기록합니다.

## 로케일별 권한

관리자 역할은 콘텐츠 권한을 일부 로케일로 제한할 수 있으므로, 프랑스어 편집자가 프랑스어 버전만 읽거나
바꾸게 할 수 있습니다. [권한](/ko/concepts/permissions/#필드와-로케일-권한)을 참고하세요.
콘텐츠 API의 권한(공개 접근, API 토큰, 최종 사용자 역할)은 모든 로케일에 적용됩니다.

## Strapi와 비교

모델과 파라미터는 Strapi v5의 i18n과 같습니다. 로컬라이즈된 타입, `localized: false` 필드,
`?locale=`, 기본 로케일입니다. Verdin에서 i18n은 코어의 일부이며 항상 켜져 있습니다. 콘텐츠 타입마다
스키마에서 켭니다.
