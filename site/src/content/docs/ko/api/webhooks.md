---
title: "웹훅"
description: "웹훅 이벤트, 페이로드 형식, 헤더, 서명 검증, 재시도, 전송 로그."
sidebar:
  order: 6
---

웹훅은 콘텐츠나 미디어가 바뀌면 지정한 URL로 HTTP `POST`를 보냅니다. 이 페이지는 수신 측을 위한
레퍼런스입니다. 이벤트, 페이로드, 헤더, 서명, 전송을 다룹니다. 관리자 패널에서 웹훅을 만들고
관리하는 방법은 [웹훅](/ko/guides/integrations/webhooks/)을 참고하세요.

## 이벤트

| 이벤트 | 전송 시점 |
| --- | --- |
| `entry.create` | 어떤 API에서든 문서가 생성될 때: REST, GraphQL, 관리자 패널, 플러그인. |
| `entry.update` | 문서가 저장될 때. |
| `entry.publish` | 문서가 게시될 때. REST나 GraphQL에서 `status=draft` 없이 생성·수정하면 게시됩니다. |
| `entry.unpublish` | 문서가 게시 취소될 때. |
| `entry.discard-draft` | 문서의 초안이 폐기될 때. |
| `entry.delete` | 문서가 삭제될 때. |
| `media.create`, `media.update`, `media.delete` | 파일이 업로드·수정·삭제될 때. 폴더를 삭제하면 그 안의 파일마다 `media.delete`를 보냅니다. |
| `releases.publish` | [릴리스](/ko/guides/content/releases/)가 즉시 또는 예정된 날짜에 실행되었을 때. |
| `review-workflows.updateEntryStage` | 항목이 다른 [검토 단계](/ko/guides/content/review-workflows/)로 이동했을 때. |

웹훅은 일부 이벤트를 구독하며, 일부 콘텐츠 타입으로 제한할 수 있습니다. 미디어 이벤트는 콘텐츠
타입에 묶이지 않습니다.

## 페이로드

모든 페이로드에는 `event`와 `createdAt`(이벤트가 큐에 들어간 시각)이 있습니다. 항목 이벤트에는
콘텐츠 타입과 문서가 추가됩니다.

```json
{
  "event": "entry.publish",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "model": "article",
  "uid": "api::article",
  "locale": null,
  "entry": {
    "id": 3,
    "documentId": "k2m7q4dx8n5t1v3b9c0e6a2wfr",
    "title": "Hello, Verdin",
    "slug": "hello-verdin",
    "createdAt": "2026-09-25T08:55:00.000Z",
    "updatedAt": "2026-09-25T09:00:00.000Z",
    "publishedAt": "2026-09-25T09:00:00.000Z"
  }
}
```

- `model`은 타입의 `singularName`, `uid`는 UID, `locale`은 변경된 버전의 로케일입니다
  (로컬라이즈되지 않은 타입에서는 `null`).
- `entry`는 REST API가 반환하는 형태의 문서이며, 관계, 미디어, 컴포넌트, `private` 필드는 빠집니다.
- `entry.publish`는 게시된 버전을 담습니다. 다른 항목 이벤트는 초안을 담으며, 초안과 게시를 쓰지 않는
  타입에서는 유일한 버전을 담습니다.
- `entry.delete`는 `{ "documentId": … }`만 담습니다.

미디어 이벤트는 `model`, `uid`, `entry` 없이 `media`에 파일 객체를 보냅니다.

```json
{
  "event": "media.create",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "media": { "id": 5, "documentId": "v3k9…", "name": "harbour.jpg", "mime": "image/jpeg", "url": "/uploads/harbour_4f1c.jpg" }
}
```

`releases.publish`는 각 액션의 결과와 함께 `release`를 보냅니다.
`review-workflows.updateEntryStage`는 다음을 보냅니다.

```json
{
  "event": "review-workflows.updateEntryStage",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "model": "article",
  "uid": "api::article",
  "entry": { "documentId": "k2m7q4…", "locale": "en" },
  "workflow": { "id": 1, "name": "Editorial" },
  "stages": { "from": { "id": 1, "name": "To do" }, "to": { "id": 2, "name": "In review" } }
}
```

항목 이벤트와 마찬가지로 `model`은 단수 이름이고 `uid`는 콘텐츠 타입의 UID입니다(0.10 이전에는
여기서 `model`에 UID가 들어 있었습니다).

**테스트 이벤트 보내기** 버튼은 `{ "event": "trigger-test", "createdAt": … }`를 보냅니다.

## 헤더

| 헤더 | 값 |
| --- | --- |
| `content-type` | `application/json` |
| `x-verdin-event` | 이벤트 이름. |
| `x-verdin-delivery` | 전송 id. 재시도해도 바뀌지 않으므로 중복을 무시하는 데 쓰세요. |
| `x-verdin-signature` | 웹훅이 서명된 경우 `t=<unix seconds>,v1=<hex>`. |

웹훅은 엔드포인트용 `authorization` 토큰 같은 자체 헤더를 추가할 수 있습니다. 위의 헤더는 덮어쓸 수
없습니다.

## 서명 검증

웹훅은 기본적으로 서명됩니다. `v1`은 웹훅의 시크릿(`whsec_…`)을 키로 `<t>.<raw body>`를 계산한
HMAC-SHA256의 hex 값입니다. 시크릿은 웹훅을 만들거나 시크릿을 교체할 때 한 번만 표시됩니다.

전송을 확인하는 방법은 다음과 같습니다.

1. 헤더를 `t`와 `v1`로 나눕니다.
2. `t`가 현재 시각과 몇 분 이상 차이 나면 거부합니다.
3. `t`, 점, **원본** 요청 본문으로 HMAC을 계산합니다. JSON을 먼저 파싱하고 다시 직렬화하지 마세요.
   바이트가 달라집니다.
4. 상수 시간 비교로 `v1`과 비교합니다.

```js title="verify.mjs"
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, header, rawBody, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=')));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const received = parts.v1 ?? '';
  return (
    received.length === expected.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  );
}
```

Express에서는 원본 본문을 읽어 파싱하기 전에 검증합니다.

```js title="server.mjs"
import express from 'express';
import { verify } from './verify.mjs';

const app = express();

app.post('/hooks/verdin', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body.toString('utf8');
  if (!verify(process.env.VERDIN_WEBHOOK_SECRET, req.get('x-verdin-signature') ?? '', rawBody)) {
    return res.sendStatus(401);
  }
  const payload = JSON.parse(rawBody);
  console.log(req.get('x-verdin-delivery'), payload.event, payload.entry?.documentId);
  res.sendStatus(204);
});

app.listen(3000);
```

Python에서는 다음과 같습니다.

```python title="verify.py"
import hashlib
import hmac
import time


def verify(secret: str, header: str, raw_body: bytes, tolerance: int = 300) -> bool:
    parts = dict(part.split("=", 1) for part in header.split(","))
    if abs(time.time() - int(parts["t"])) > tolerance:
        return False
    signed = parts["t"].encode() + b"." + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))
```

## 전송과 재시도

전송은 변경이 커밋될 때 데이터베이스의 큐에 들어가고, 백그라운드 워커가 보냅니다. 느리거나 실패하는
엔드포인트가 편집자나 API 쓰기를 느리게 만들지 않으며, 전송은 재시작 후에도 유지됩니다.

- **성공**: 모든 `2xx` 응답.
- **실패**: 그 밖의 모든 상태(리디렉션 포함, 리디렉션은 따라가지 않음), 연결 오류, 타임아웃
  (`[webhooks].timeout_secs`, 기본 10초).
- **재시도**: 실패한 전송은 30초, 2분, 10분, 1시간, 6시간 뒤에 다시 시도하며 모두 여섯 번 시도합니다.
  그 뒤에는 실패로 표시됩니다.
- 웹훅을 비활성화하거나 삭제하면 대기 중인 재시도가 멈춥니다.
- 여러 인스턴스가 큐를 공유하며, 각 전송은 그중 하나가 가져갑니다.

`2xx`로 빠르게 응답하고 오래 걸리는 작업은 그 뒤에 하세요. 전송은 두 번 이상 도착할 수 있고(예:
타임아웃 후 재시도) 순서가 바뀔 수도 있습니다. `x-verdin-delivery`로 중복을 건너뛰고, 순서가
중요하면 문서를 다시 가져오세요.

## 전송 로그

**설정 → 웹훅**의 각 웹훅 페이지에는 최신순으로 정렬된 **전송 로그**가 있습니다. 전송마다 상태
(**대기 중**, **전송 중**, **성공**, **실패**), HTTP 상태, 응답 본문의 처음 2 KB, 오류, 시도 횟수,
다음 시도 시각, 소요 시간, 보낸 페이로드를 보여 줍니다. 실패한 전송은 로그에서 다시 시도할 수 있습니다.

완료된 전송은 `[webhooks].retention_days`(기본 30일)가 지나면 삭제됩니다.

같은 데이터는 [admin API](/ko/api/admin/)에서도 얻을 수 있습니다:
`GET /admin/api/webhooks/{id}/deliveries`와 `POST /admin/api/webhooks/deliveries/{id}/retry`.

## URL 제한

`verdin start`에서는 웹훅 URL이 루프백, 사설, 링크 로컬 등 예약된 주소를 가리킬 수 없습니다. IP 주소로
쓰든, 그런 주소로 해석되는 호스트 이름으로 쓰든 마찬가지입니다. 관리자가 웹훅으로 내부 서비스에 접근할
수 없습니다. `verdin dev`에서는 허용되므로 `localhost`를 대상으로 테스트할 수 있습니다.
`[webhooks].allow_private_networks`로 기본값을 바꿀 수 있습니다. 자격 증명이 들어간 URL
(`https://user:pass@…`)은 거부됩니다. 자격 증명은 헤더에 넣으세요.

## Strapi와 비교

페이로드는 Strapi의 형식(`event`, `createdAt`, `model`, `uid`, `entry`)을 따릅니다. Verdin은 서명,
재시도, 전송 로그, 콘텐츠 타입별 필터를 추가합니다. Strapi의 `entry.draft-discard` 이벤트는
`entry.discard-draft`라고 부릅니다.
