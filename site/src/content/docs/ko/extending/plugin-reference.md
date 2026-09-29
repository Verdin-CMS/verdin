---
title: 플러그인 레퍼런스
description: plugin.toml 매니페스트, 기능 선언, 훅과 페이로드, 호스트 함수, 라우트, 작업, GraphQL 필드, 관리자 확장 지점과 한도.
sidebar:
  order: 3
---

<!-- Written from crates/verdin-plugins (lib.rs, manifest.rs), crates/verdin-api/src/plugins.rs,
plugins_admin.rs, crates/verdin-graphql/src/lib.rs and admin/src/app/core/plugin-extensions.ts. -->

이 페이지는 Verdin과 플러그인 사이의 완전한 계약입니다. 매니페스트, Verdin이 각 내보낸 함수에 보내는 것과
돌려받기를 기대하는 것, 모듈이 호출할 수 있는 호스트 함수를 다룹니다. 소개는 [플러그인](/ko/extending/plugins/)을,
실습 예제는 [플러그인 튜토리얼](/ko/extending/plugin-tutorial/)을 참고하세요.

## 플러그인 디렉터리

각 플러그인은 `[plugins].path`(기본값 `plugins/`, `verdin.toml` 옆) 아래의 디렉터리입니다.

| 파일 | 필수 | 내용 |
| --- | --- | --- |
| `plugin.toml` | 예 | 매니페스트. |
| `plugin.wasm` | 예 | 모듈(`wasm`으로 다른 경로 지정 가능). |
| `admin/` | 아니요 | 관리자 패널이 로드하는 파일: `admin.script` 모듈과 그 에셋. |

시작할 때 Verdin은 `plugin.toml`이 있는 모든 디렉터리를 이름순으로 로드합니다. 매니페스트가 잘못되었거나,
모듈이 없거나, 다른 플러그인이 이미 같은 `name`을 쓰고 있으면 그 디렉터리는 건너뛰며, **설정 → 플러그인**에
이유와 함께 표시됩니다.

## 매니페스트

```toml title="plugins/slugs/plugin.toml"
name = "slugs"
version = "1.0.0"
description = "Slugs from titles, and a color field"

[capabilities]
read = ["api::article"]
write = ["api::tag"]
http = ["api.example.com"]
kv = true

[limits]
timeout_ms = 5000
memory_mb = 64

[[hooks]]
on = "beforeCreate"
uid = "api::article"
function = "before_write"

[routes]
function = "handle"

[[jobs]]
schedule = "*/15 * * * *"
function = "refresh"

[[graphql]]
name = "slugStats"
function = "stats"

[admin]
script = "index.js"

[[admin.widgets]]
id = "stats"
title = "Slug stats"
element = "slugs-stats"

[[admin.fields]]
id = "color"
title = "Color"
element = "slugs-color"
type = "string"

[[settings]]
key = "separator"
label = "Separator"
type = "select"
options = ["-", "_"]
default = "-"
```

모든 테이블에서 알 수 없는 키는 오류입니다.

### 최상위 키

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `name` | 필수 | URL, 설정, 사용자 정의 필드에서 쓰는 플러그인 id. 소문자, 숫자, `-`로 이루어지고 문자로 시작하며 최대 64자. |
| `version` | 필수 | 관리자 패널과 로그에 표시됩니다. |
| `description` | 설정 안 됨 | **설정 → 플러그인**에 표시됩니다. |
| `wasm` | `"plugin.wasm"` | 플러그인 디렉터리 기준 모듈 경로(`..` 불가, 절대 경로 불가). |
| `wasi` | `false` | 모듈에 WASI(시계와 난수)를 제공합니다. 어느 쪽이든 파일이나 소켓은 없습니다. |

### `[capabilities]`

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `read` | `[]` | `verdin_content`가 읽을 수 있는(`findMany`, `findOne`) 콘텐츠 타입: `api::article` 같은 uid, 또는 전체를 뜻하는 `"*"`. |
| `write` | `[]` | `create`, `update`, `delete`, `publish`, `unpublish`할 수 있는 콘텐츠 타입. `read`를 포함합니다. |
| `http` | `[]` | 모듈이 HTTP 요청을 보낼 수 있는 호스트: `api.example.com` 또는 `*.example.com`. |
| `kv` | `false` | 플러그인 자체의 키-값 저장소(`verdin_kv_get`, `verdin_kv_set`). |

기능 선언은 호스트 호출만 제한합니다. 훅은 `read`와 상관없이 지정한 타입에서 실행되며, 라우트는 누구나 접근할
수 있습니다.

### `[limits]`

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `timeout_ms` | `5000` | 호출 한 번의 시간 한도(밀리초). |
| `memory_mb` | `64` | 모듈의 최대 메모리(메가바이트). |

둘 다 양수여야 합니다.

### `[[hooks]]`

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `on` | 필수 | 이벤트(아래 참고). |
| `uid` | `"*"` | 콘텐츠 타입(`api::article`), 또는 전체를 뜻하는 `"*"`. |
| `function` | 필수 | 호출할 내보낸 함수. |

이벤트:

| 쓰기 전 | 쓰기 후 |
| --- | --- |
| `beforeCreate` | `afterCreate` |
| `beforeUpdate` | `afterUpdate` |
| `beforeDelete` | `afterDelete` |
| `beforePublish` | `afterPublish` |
| `beforeUnpublish` | `afterUnpublish` |
| `beforeDiscardDraft` | `afterDiscardDraft` |

이름은 Strapi의 라이프사이클 이름입니다. 훅은 관리자 패널, REST와 GraphQL API, 릴리스에서 온 쓰기에서
실행되지만, 플러그인이 한 쓰기([플러그인이 한 쓰기](#플러그인이-한-쓰기) 참고)나 `verdin import` 명령이 한
쓰기에서는 실행되지 않습니다.

### `[routes]`

| 키 | 설명 |
| --- | --- |
| `function` | `/api/plugins/<name>`과 `/api/plugins/<name>/…`에 대한 모든 메서드의 모든 요청을 처리하는 내보낸 함수. |

경로는 `[api].prefix`를 따릅니다.

### `[[jobs]]`

| 키 | 설명 |
| --- | --- |
| `schedule` | UTC 기준 cron 표현식이며 초는 선택 사항: `*/15 * * * *`, `0 0 3 * * *`. |
| `function` | 호출할 내보낸 함수. |

### `[[graphql]]`

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `name` | 필수 | 필드 이름: 소문자로 시작하고 그 뒤에 문자, 숫자, `_`. |
| `function` | 필수 | 필드를 해석하는 내보낸 함수. |
| `mutation` | `false` | `Query` 대신 `Mutation`에 필드를 추가합니다. |
| `description` | 설정 안 됨 | 스키마에 들어가는 필드 설명. |

항목마다 `name(args: JSON): JSON`이 추가됩니다. 콘텐츠 타입이 이미 쓰거나 다른 플러그인이 먼저 가져간 이름은
로그에 경고를 남기고 건너뜁니다.

### `[admin]`

| 키 | 설명 |
| --- | --- |
| `script` | 사용자 정의 요소를 정의하는 `admin/` 아래의 ES 모듈(`..` 불가, 절대 경로 불가). |
| `[[admin.widgets]]` | 대시보드 위젯 타입: `id`, `title`, `element`, 선택 사항인 `description`. |
| `[[admin.fields]]` | 사용자 정의 필드: `id`, `title`, `element`, `type`(값을 저장할 속성 타입, 예: `string`이나 `json`), 선택 사항인 `description`. |

`element`는 사용자 정의 요소 이름입니다. 소문자, 숫자, `-`로 이루어지며 `-`가 하나 이상 있어야 합니다
(`slugs-color`).

### `[[settings]]`

**설정 → 플러그인 → 설정**의 폼을 선언합니다. 하나도 없으면 설정은 자유로운 JSON 객체입니다.

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `key` | 필수 | 설정 객체의 키: 문자, 숫자, `_`로 이루어지고 숫자로 시작하지 않으며 고유해야 합니다. |
| `label` | 필수 | 폼 라벨. |
| `type` | `"string"` | `string`, `text`, `url`, `number`, `integer`, `boolean`, `select`. |
| `description` | 설정 안 됨 | 필드 아래의 도움말. |
| `required` | `false` | `default`가 없으면 값(텍스트는 비어 있지 않은 값)이 필요합니다. |
| `options` | `[]` | `select`의 선택지(`select`에는 필수). |
| `default` | 설정 안 됨 | 키가 없거나 `null`일 때 씁니다. 필드에 맞아야 합니다. |
| `min`, `max` | 설정 안 됨 | `number`와 `integer` 값의 범위, `string`과 `text`의 길이 범위. |

`url` 값은 비어 있거나 `http(s)://` URL입니다. 폼이 있으면 서버는 알 수 없는 키, 잘못된 타입, 범위를 벗어난
값, 빠진 필수 값이 있는 설정을 거부합니다(400).

## 내보낸 함수

모든 내보낸 함수는 JSON 문서 하나를 받고 하나를 반환합니다(또는 아무것도 반환하지 않음). 빈 출력은 `null`로
취급하고, JSON이 아닌 출력은 실패로 취급합니다.

### before 훅

입력:

```json
{
  "event": "beforeUpdate",
  "uid": "api::article",
  "documentId": "01m3p88ry359w82nsx496mep5t",
  "locale": "en",
  "data": { "title": "Hello" }
}
```

| 필드 | 설명 |
| --- | --- |
| `event` | 훅의 이벤트. |
| `uid` | 콘텐츠 타입. |
| `documentId` | 문서. `beforeCreate`에서는 `null`. |
| `locale` | 로컬라이즈된 타입에서는 쓰는 로케일(요청이 지정하지 않았으면 기본 로케일), 다른 타입에서는 `null`. |
| `data` | 생성과 수정에서 요청이 보낸 그대로의 쓸 데이터. 다른 이벤트에서는 `null`. 수정에서는 보낸 필드만 담깁니다. |

출력:

| 출력 | 효과 |
| --- | --- |
| `{ "data": { … } }` | 쓸 데이터를 대체합니다. 원래 데이터와 같이 검증됩니다. |
| `{ "error": "message" }` | 쓰기를 거부합니다. 호출자는 메시지와 함께 400을 받습니다. |
| `{}` 또는 그 밖의 것 | 쓰기가 그대로 진행됩니다. |

여러 훅이 일치하면 플러그인 순서(디렉터리 이름), 그다음 매니페스트 순서로 실행되며, 각 훅은 이전 훅이 반환한
데이터를 받습니다. 실패한 훅(트랩, 타임아웃, 잘못된 출력)은 로그에 남고 건너뛰며, 쓰기는 진행됩니다.

### after 훅

입력: 쓰기가 커밋된 뒤 보내는 `{ "event", "uid", "documentId", "locale" }`. 출력은 무시하며, 실패는 로그에
남습니다. 항목의 필드가 필요하면 `verdin_content`로 읽으세요(`read` 기능 필요).

### 라우트

입력:

```json
{
  "method": "GET",
  "path": "/stats",
  "query": "page=2&sort=title",
  "headers": { "accept": "application/json", "user-agent": "curl/8.7.1" },
  "body": "",
  "actor": { "kind": "public" }
}
```

| 필드 | 설명 |
| --- | --- |
| `method` | HTTP 메서드. |
| `path` | `/api/plugins/<name>` 뒤의 경로. `/`로 시작합니다(플러그인 루트는 `/`). |
| `query` | `?` 없는 원본 쿼리 문자열(없으면 빈 문자열). |
| `headers` | 있을 때만 `content-type`, `accept`, `user-agent`, `accept-language`. |
| `body` | 문자열로 된 요청 본문(잘못된 UTF-8은 대체됨). |
| `actor` | 호출자: `{ "kind": "public" }`, `{ "kind": "token", "id": 3 }`(API 토큰), `{ "kind": "user", "id": 12 }`(로그인한 최종 사용자). |

잘못된 토큰이 담긴 `Authorization` 헤더는 플러그인을 호출하기 전에 401로 거부됩니다. 공개 접근과 API 토큰 권한은
적용되지 않으므로 `actor`를 직접 확인하세요.

출력:

| 필드 | 기본값 | 설명 |
| --- | --- | --- |
| `status` | `200` | HTTP 상태. |
| `headers` | 없음 | 응답 헤더. `content-type`, `cache-control`, `location`, `etag`, `last-modified`, `content-disposition`만 유지됩니다. |
| `body` | 비어 있음 | 문자열은 그대로 보냅니다(`content-type`을 설정하지 않으면 `text/plain`). 그 밖의 JSON 값은 `application/json`으로 보냅니다. |

비활성화되었거나 알 수 없는 플러그인, 또는 `[routes]`가 없는 플러그인은 404로 응답합니다. 실패한 호출은
`{ "data": null, "error": { "status": 502, "name": "PluginError", … } }`와 함께 502로 응답합니다. 라우트는
콘텐츠 API의 `[server].body_limit`과 `[server].request_timeout_secs`를 공유합니다.

### 작업

입력: `{ "scheduledAt": "2026-09-29T03:00:00+00:00" }`, 실행이 예약된 시각. 출력은 무시하며, 실패는 로그에
남습니다. 작업은 플러그인이 켜져 있는 동안, `[plugins].run_jobs = true`인 인스턴스에서만 실행됩니다. 서버가
다운된 동안 놓친 실행은 나중에 보충하지 않습니다.

### GraphQL 필드

입력: `{ "args": …, "actor": … }`. `args`는 필드의 `args` 인자(아무 JSON이나 `null`)이고, `actor`는 라우트와
같습니다. 출력이 필드의 값입니다. 실패하거나 플러그인이 비활성화되어 있으면 코드 `PLUGIN_ERROR`를 가진 GraphQL
오류로 응답합니다. 라우트와 마찬가지로 접근 확인은 플러그인이 합니다.

## 호스트 함수

`extism:host/user` 네임스페이스에서 가져옵니다(Rust에서는 `extern "ExtismHost"`). 문자열로 된 JSON을 받고
반환하며, `extism-pdk`의 `Json<Value>`가 변환을 처리합니다.

| 함수 | 입력 | 출력 |
| --- | --- | --- |
| `verdin_log` | `{ "level": "info" \| "warn" \| "error", "message": "…" }` | 없음 |
| `verdin_content` | 콘텐츠 요청(아래 참고) | 결과, 또는 `{ "error": "…" }` |
| `verdin_kv_get` | 일반 문자열로 된 키 | 저장된 JSON 값, 또는 `null` |
| `verdin_kv_set` | `{ "key": "…", "value": … }` | 없음 |
| `verdin_config` | 없음 | 선언한 기본값을 채운 설정 객체 |

### `verdin_log`

서버 로그(플러그인 이름과 함께)와 **설정 → 플러그인 → 로그**의 플러그인 로그에 씁니다. 다른 레벨은 `info`로
취급합니다. 플러그인 로그는 최근 메시지 200개를 메모리에 보관하며, 각 메시지는 2,000자에서 잘립니다.

### `verdin_content`

```json
{ "op": "findMany", "uid": "api::article", "query": { "filters": { "title": { "$eq": "x" } }, "sort": ["title"] } }
```

| 필드 | 사용하는 op | 설명 |
| --- | --- | --- |
| `op` | 전부 | `findMany`, `findOne`, `create`, `update`, `delete`, `publish`, `unpublish`. |
| `uid` | 전부 | 콘텐츠 타입. 기능 선언에 있어야 합니다. |
| `documentId` | `findOne`, `update`, `delete`, `publish`, `unpublish` | 문서. |
| `query` | `findMany`, `findOne` | JSON 객체로 된 REST API 파라미터: `filters`, `sort`, `fields`, `populate`, `pagination`, `status`. |
| `data` | `create`, `update` | REST 요청의 `data`처럼 쓸 필드. |
| `status` | `create`, `update` | `"draft"`는 초안을 저장합니다. 그 밖에는 `?status=draft` 없는 REST 쓰기처럼 게시됩니다. |
| `locale` | 전부 | 읽거나 쓸 로케일. |

결과:

| `op` | 결과 |
| --- | --- |
| `findMany` | `{ "documents": [...], "meta": { "pagination": {…} } }` |
| `findOne` | `{ "document": {…} }` (찾지 못하면 `null`) |
| `create`, `update` | `{ "documentId": "…" }` |
| `delete` | `{ "deleted": true }` |
| `publish` | `{ "published": true }` |
| `unpublish` | `{ "unpublished": true }` |

기능 선언 밖의 호출, 알 수 없는 작업, 검증 오류, 없는 문서는 대신 `{ "error": "…" }`로 응답합니다. 읽기는
쿼리가 `"status": "draft"`를 요청하지 않으면 게시된 버전을 반환합니다.

#### 플러그인이 한 쓰기

`verdin_content`를 통한 쓰기는 모든 플러그인의 **before** 훅을 건너뛰므로, 플러그인이 거기서 자기 변경으로
무한 반복할 수 없습니다. 그 밖의 모든 것은 적용됩니다. 검증, 검토 단계, 웹훅, 기록, 감사 로그, 그리고 쓰기를 한
플러그인을 포함한 모든 플러그인의 **after** 훅입니다. 자신이 듣는 타입에 쓰는 after 훅에는 보호 조건을 두세요.

### `verdin_kv_get`과 `verdin_kv_set`

플러그인별 키-값 저장소이며, Verdin의 데이터베이스에 있고 모든 인스턴스가 공유합니다. 키는 1~255바이트이고
값은 아무 JSON이나 됩니다. `null`을 설정하면 키가 삭제됩니다. `kv` 기능이 없으면 읽기는 `null`을 반환하고 쓰기는
무시됩니다.

### `verdin_config`

**설정 → 플러그인**에 저장된 설정을 반환하며, 선언한 각 설정의 `default`로 빠진 키를 채웁니다. 저장된 것이
없으면 `{}`입니다.

### HTTP

`http`에 호스트를 나열했다면 Extism의 HTTP 지원(Rust에서는 `extism_pdk::http::request`)을 쓰세요. 다른
호스트로 가는 요청은 실패합니다.

## 관리자 확장 지점

관리자 패널은 활성화된 플러그인의 확장을 서버에 요청하고, 각 `admin.script`를 `/admin/plugins/<name>/<script>`
(`[admin].path` 아래)에서 ES 모듈로 한 번 가져옵니다. 플러그인의 `admin/` 디렉터리 아래 파일은 플러그인이 켜져
있는 동안 `X-Content-Type-Options: nosniff`, `Cache-Control: no-cache`와 함께 그곳에서 제공됩니다. 모듈은
매니페스트가 지정한 사용자 정의 요소를 정의해야 하며, 3초 안에 정의되지 않은 요소는 빠집니다.

### 위젯

각 `[[admin.widgets]]` 항목은 관리자가 대시보드에 추가할 수 있는 위젯 타입입니다. 요소는 `context` 속성을
받습니다.

| 속성 | 설명 |
| --- | --- |
| `apiBase` | `/api` 같은 콘텐츠 API 기준 경로. |
| `adminApiBase` | `/admin/api` 같은 admin API 기준 경로. |
| `fetch(path, init)` | 로그인한 관리자의 자격 증명을 쓰는 `fetch`. 상대 경로는 `adminApiBase` 기준으로 해석하고, 두 기준 경로 아래의 경로와 절대 URL은 그대로 둡니다. |

```js title="plugins/slugs/admin/index.js"
class SlugStats extends HTMLElement {
  set context(context) {
    // Admin API, with the admin's session.
    context.fetch('auth/me').then((response) => response.json())
      .then(({ data }) => { this.textContent = `Hello ${data.firstname ?? data.email}`; });
    // The plugin's own route, on the content API: sent without the admin's session.
    context.fetch(`${context.apiBase}/plugins/slugs/stats`).then((response) => response.json())
      .then((stats) => { this.title = JSON.stringify(stats); });
  }
}
customElements.define('slugs-stats', SlugStats);
```

`context.fetch`는 admin API 요청에만 관리자 세션을 보냅니다. `context.apiBase` 아래의 경로(플러그인 라우트를
포함한 콘텐츠 API)는 세션 없이 보냅니다. 콘텐츠 API는 관리자 세션을 받지 않기 때문이며, 이 요청은 공개 역할의
권한으로 응답합니다. 0.10 이전에는 여기에도 세션을 보냈고 그 요청은 실패했습니다. 일반 `fetch`를 호출하는
0.9용 위젯은 계속 동작합니다.

### 사용자 정의 필드

각 `[[admin.fields]]` 항목은 속성이 `"customField": "plugin::<name>.<id>"`로 쓸 수 있는 필드입니다. 속성의
`type`은 필드가 값을 저장하는 방식과 맞아야 합니다. **콘텐츠 타입 빌더**가 이 필드를 제공합니다. 요소는 다음을
받습니다.

| 속성 | 설명 |
| --- | --- |
| `value` | 현재 값. |
| `disabled` | 편집이 꺼져 있는지 여부. |
| `attribute` | 스키마의 속성 정의. |
| `locale` | 편집 중인 로케일. |

새 값은 `detail`이 값인 `change` 이벤트로 알립니다(`detail`이 없으면 요소 자신의 `value` 속성으로). 플러그인이
꺼져 있거나 요소가 없으면 편집기는 저장 타입의 일반 입력을 보여 줍니다.
[속성 타입](/ko/reference/attribute-types/)을 참고하세요.

## 런타임과 한도

| 한도 | 값 |
| --- | --- |
| 호출당 시간 | `[limits].timeout_ms`, 기본 5,000 ms |
| 메모리 | `[limits].memory_mb`, 기본 64 MB |
| 동시성 | 플러그인마다 한 번에 호출 하나. 호출은 서로 기다립니다 |
| 모듈 인스턴스 | 플러그인마다 하나, 처음 사용할 때 생성. 호출이 실패하면 다시 생성(메모리는 사라짐) |
| 로그 | 플러그인마다 메시지 200개, 각 2,000자, 메모리에 보관 |
| KV 키 | 1~255바이트 |
| 라우트 요청 헤더 | `content-type`, `accept`, `user-agent`, `accept-language` |
| 라우트 응답 헤더 | `content-type`, `cache-control`, `location`, `etag`, `last-modified`, `content-disposition` |

매니페스트나 모듈의 변경은 재시작 후에 적용되고, 스위치와 설정은 즉시 적용됩니다. 플러그인을 관리하려면
`plugins.manage`가 필요합니다([권한 레퍼런스](/ko/reference/permissions/) 참고).
