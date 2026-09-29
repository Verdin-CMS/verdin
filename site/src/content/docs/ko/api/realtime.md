---
title: "Realtime API"
description: "Verdin 실시간 스트림의 Server-Sent Events 프로토콜: 엔드포인트, 인증, 이벤트 이름과 메시지 형식, 관리자 프레즌스 프로토콜."
sidebar:
  order: 5
  label: "실시간"
---

Verdin은 콘텐츠와 미디어 변경 사항을 커밋되는 즉시
[Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events)(SSE)로 스트리밍합니다.
각 구독자는 자신이 읽을 수 있는 대상에 대한 이벤트만 받습니다. 이 페이지는 프로토콜을 설명합니다.
프런트엔드에서 사용하는 방법은 [실시간 업데이트](/ko/guides/frontend/realtime/)를 참고하세요.

## 활성화

실시간 기능은 기본적으로 꺼져 있습니다. **설정 → 기능 → 실시간**에서 켭니다(권한
`features.manage`). 꺼져 있는 동안 엔드포인트는 `404`로 응답합니다.

## 콘텐츠 스트림

```
GET /api/_events
GET /api/_events?types=api::article,api::category
```

| 파라미터 | 설명 |
| --- | --- |
| `types` | 선택 사항. 쉼표로 구분한 콘텐츠 타입 UID이며, `plugin::upload`는 미디어 라이브러리입니다. Strapi 형식 `api::article.article`도 동작합니다. 지정하지 않으면 읽을 수 있는 모든 타입의 이벤트를 받습니다. |

REST API와 똑같이 인증합니다. `Authorization: Bearer …`에 API 토큰이나 최종 사용자의 JWT를 넣거나,
공개 접근이면 헤더를 넣지 않습니다. 잘못된 토큰은 스트림이 열리기 전에 `401`로 응답합니다.

```sh title="Terminal"
curl -N -H "Authorization: Bearer $VERDIN_TOKEN" \
  'https://cms.example.com/api/_events?types=api::article'
```

```text
event: ready
data: {}

event: entry.publish
data: {"event":"entry.publish","uid":"api::article","documentId":"k2m7q4dx8n5t1v3b9c0e6a2wfr","locale":"en"}

event: media.create
data: {"event":"media.create","uid":"plugin::upload","documentId":"v3k9…","fileId":5}
```

## 메시지

첫 이벤트는 항상 `ready`입니다. 그다음부터 각 변경은 그 이름을 가진 SSE 이벤트이며,
`data`는 JSON 객체입니다.

| 필드 | 포함 조건 | 설명 |
| --- | --- | --- |
| `event` | 항상 | SSE `event:` 줄과 같은 이벤트 이름. |
| `uid` | 항상 | 콘텐츠 타입 UID, 미디어는 `plugin::upload`. |
| `documentId` | 항상 | 변경된 문서나 파일. |
| `locale` | 로컬라이즈된 타입 | 변경된 버전의 로케일. |
| `fileId` | 미디어 이벤트 | 미디어 필드에서 쓰는 파일의 숫자 id. |
| `actorId` | 관리자 스트림 | 관리자가 변경한 경우 그 관리자. |

| 이벤트 | 전송 시점 | 수신 대상 |
| --- | --- | --- |
| `entry.create`, `entry.update`, `entry.discard-draft` | 문서가 생성·저장되거나 초안이 폐기될 때 | 초안과 게시를 쓰는 타입에서는 `readDrafts`가 있는 호출자(이 이벤트는 초안만 바꿈). 그 밖의 타입에서는 `find` 또는 `findOne`이 있는 호출자. |
| `entry.publish`, `entry.unpublish`, `entry.delete` | 문서가 게시·게시 취소·삭제될 때 | 해당 타입에 `find` 또는 `findOne`이 있는 호출자 |
| `media.create`, `media.update`, `media.delete` | 파일이 업로드·수정·삭제될 때 | 미디어 라이브러리에 `find` 또는 `findOne`이 있는 호출자 |

이벤트에는 콘텐츠가 아니라 id가 담깁니다. 내용을 읽으려면 호출자의 일반 권한으로 REST나 GraphQL
API에서 문서나 파일을 가져오세요. 이벤트는 모든 API에서 발생합니다. REST, GraphQL, 관리자 패널,
릴리스, 플러그인 모두입니다.

## 연결 수명

- 서버는 15초마다 keep-alive 주석을 보냅니다.
- 콘텐츠 스트림은 1시간 뒤에 끝납니다. 다시 연결하세요(브라우저의 `EventSource`는 자동으로 합니다).
  이때 토큰도 다시 확인됩니다.
- `data: {"missed": 12}`를 가진 `lagged` 이벤트는 클라이언트가 너무 느리게 읽어서 그만큼의 이벤트가
  버려졌다는 뜻입니다. 클라이언트가 표시하는 내용을 다시 가져오세요.
- 재전송은 없습니다. 클라이언트 연결이 끊긴 동안 발생한 이벤트는 나중에 보내지지 않습니다.

브라우저의 `EventSource`는 `Authorization` 헤더를 보낼 수 없습니다. 공개 접근에는 그대로 동작합니다.
토큰을 쓸 때는 스트리밍 본문 리더와 함께 `fetch`를 쓰거나, 헤더를 지원하는 SSE 클라이언트를 쓰세요.

## 관리자 스트림

관리자 패널은 관리자의 액세스 토큰으로 자체 스트림을 엽니다.

```
GET /admin/api/events?types=api::article
```

관리자가 읽을 수 있는 타입(`content.read`, `media.read`)에 대해 초안을 포함한 같은 콘텐츠·미디어
이벤트를 전달하며, 다음이 추가됩니다.

- 관리자가 한 변경에 `actorId`
- `presence` 이벤트(아래 참고)
- 항목의 `uid`, `documentId`, `locale`을 가진 `comment.create`, `comment.update`,
  `comment.delete`, `comment.resolve`, `comment.reopen`, `task.create`, `task.update`,
  `task.delete`

관리자 스트림은 액세스 토큰의 수명인 15분 뒤에 끝납니다. 새 토큰으로 다시 연결하세요.

### 프레즌스

항목 편집기는 누가 항목을 보고 있는지 서버에 알립니다.

```
POST /admin/api/presence
{ "uid": "api::article", "documentId": "k2m7q4…", "locale": "en", "editing": true }
```

- 편집기가 열려 있는 동안 약 20초마다 보냅니다. `editing: true`는 관리자에게 저장하지 않은 변경이
  있다는 뜻입니다. 편집기를 닫을 때는 `"leave": true`를 보냅니다.
- 프레즌스는 마지막 하트비트 후 45초가 지나면 만료됩니다.
- 응답에는 항목을 보고 있는 사람이 나열됩니다: `{ "data": [{ "userId": 3, "name": "Ada Lovelace", "editing": true, "holdsLock": true }] }`.
- `GET /admin/api/presence?uid=&documentId=&locale=`로 같은 목록을 읽을 수 있습니다.
- 목록이 바뀌면 관리자 스트림은 항목의 `uid`, `documentId`, `locale`과 `presence`에 담긴 목록을 가진
  `presence` 이벤트를 받습니다.

아직 편집 중인 첫 관리자가 소프트 잠금(`holdsLock`)을 가집니다. 편집기는 다른 사람에게 이를
보여 주지만, 그들의 저장을 막지는 않습니다. 프레즌스를 읽으려면 해당 타입에 `content.read`가 필요합니다.

## 여러 인스턴스

이벤트와 프레즌스는 클라이언트가 연결된 인스턴스의 것입니다. 로드 밸런서 뒤에서는 `/api/_events`와
`/admin/api/events`를 sticky 세션으로 라우팅하거나, 실시간 클라이언트를 한 인스턴스에만 연결하세요.
[확장](/ko/deploy/scaling/)을 참고하세요.
