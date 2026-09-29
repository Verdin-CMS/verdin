---
title: 모니터링
description: 실행 중인 Verdin 인스턴스 관찰하기 — /_health와 /_ready 검사, /_metrics의 Prometheus 메트릭과 토큰, 로그 형식, 레벨, 요청 id.
sidebar:
  order: 10
---

Verdin 인스턴스는 헬스 엔드포인트 두 개, 선택 사항인 Prometheus 메트릭, 구조화된 로그로 자기 상태를
알립니다. 이 페이지에서는 각각이 무엇을 반환하는지, 어떻게 켜는지 설명합니다.

## 헬스 체크

두 엔드포인트 모두 API 접두사 밖, 서버 루트에서 제공되며 인증이 필요 없습니다.

| 엔드포인트 | 응답 | 용도 |
| --- | --- | --- |
| `GET /_health` | 프로세스가 HTTP를 제공하는 동안 항상 `200 {"status":"ok"}`. | Liveness: 응답이 멈추면 프로세스를 재시작합니다. |
| `GET /_ready` | 데이터베이스가 ping에 응답하면 `200 {"status":"ready","database":"postgres"}`, 응답하지 않으면 `503 {"status":"unavailable"}`. | Readiness와 로드 밸런서 검사: 200으로 응답하는 인스턴스에만 트래픽을 보냅니다. |

`database`는 `postgres`, `mysql`, `mariadb`, `sqlite` 중 하나입니다. `/_ready`는 마이그레이션을 검사하지
않습니다. `verdin start`는 대기 중인 마이그레이션이 있으면 시작을 거부하므로(`--migrate`가 적용하는 경우
제외), 실행 중인 서버에는 대기 중인 마이그레이션이 없습니다.

```sh frame="terminal"
curl -s localhost:1337/_ready
{"status":"ready","database":"sqlite"}
```

## Prometheus 메트릭

메트릭을 켜고 토큰을 설정합니다.

```toml title="verdin.toml"
[metrics]
enabled = true
```

```sh
VERDIN_METRICS_TOKEN=<a long random string>
```

그러면 `GET /_metrics`가 Prometheus 텍스트 형식(버전 0.0.4)으로 제공됩니다. 토큰(`VERDIN_METRICS_TOKEN`,
`[metrics].token`보다 우선)이 있으면 `Authorization: Bearer <token>` 없는 스크레이프는 `401`을 받습니다.
토큰이 없으면 포트에 접근할 수 있는 누구나 메트릭을 읽을 수 있습니다.

```yaml title="prometheus.yml"
scrape_configs:
  - job_name: verdin
    metrics_path: /_metrics
    authorization:
      type: Bearer
      credentials: <the token>
    static_configs:
      - targets: ["verdin:1337"]
```

인스턴스가 여러 개면 각각을 스크레이프하세요. 인스턴스마다 자기 요청만 셉니다.

| 메트릭 | 타입 | 라벨 | 의미 |
| --- | --- | --- | --- |
| `verdin_http_requests_total` | counter | `area`, `method`, `status` | 처리한 HTTP 요청 수. |
| `verdin_http_request_duration_seconds` | histogram | `area`, `method`, `status` | 요청 처리 시간. 버킷은 5 ms부터 10 s까지. |
| `verdin_webhook_deliveries_pending` | gauge | | 전송 대기 중인 웹훅 전송 수. |
| `verdin_realtime_subscribers` | gauge | | 열려 있는 실시간 이벤트 스트림 수. |
| `verdin_uptime_seconds` | gauge | | 프로세스 시작 후 경과한 초. |
| `verdin_build_info` | gauge | `version` | 항상 1. 실행 중인 버전. |

`area`는 서버의 영역입니다: `api`(콘텐츠 API), `admin_api`, `admin`(패널 파일), `graphql`, `mcp`,
`uploads`, `internal`(`/_`로 시작하는 경로), `other`. `status`는 상태 클래스입니다: `2xx`, `3xx`, `4xx`,
`5xx`.

유용한 알림: `/_ready` 실패, `5xx` 비율 증가, 계속 늘어나는 `verdin_webhook_deliveries_pending`(웹훅 대상이
다운됨), `verdin_uptime_seconds` 초기화(재시작).

## 로그

Verdin은 표준 오류로 로그를 씁니다.

| 설정 | 값 | 기본값 |
| --- | --- | --- |
| `[log].format` | `pretty`(터미널용) 또는 `json`(한 줄에 객체 하나) | `pretty`, Docker 이미지에서는 `json` |
| `[log].level` | 레벨 또는 필터: `error`, `warn`, `info`, `debug`, `trace`, 또는 모듈별(`info,verdin_api=debug`) | `info` |
| `RUST_LOG` | 같은 문법. 설정하면 `[log].level`보다 우선 | 설정 안 됨 |

프로덕션에서는 `json`을 쓰고 표준 오류를 로그 시스템으로 보내세요. JSON 한 줄은 다음과 같습니다.

```json
{"timestamp":"2026-09-29T09:27:16.444598Z","level":"INFO","fields":{"message":"verdin listening","address":"0.0.0.0:1337","mode":"production","version":"0.10.0"},"target":"verdin::app"}
```

시작할 때 `WARN` 줄은 `[email].provider is 'log'`나 꺼진 secure 쿠키처럼 프로덕션에서 고쳐야 할 설정을
알려 줍니다.

### 요청

모든 요청에는 요청 id가 붙습니다. 들어온 `X-Request-Id` 헤더가 있으면 그 값, 없으면 새 UUID입니다. 이 id는
`X-Request-Id` 응답 헤더로 돌려보내고, 요청을 처리하는 동안 쓰는 모든 로그 줄에 붙습니다(`request_id`,
`method`, `uri`와 함께). 여러 시스템에 걸쳐 요청을 추적하려면 프록시에서 이 헤더를 넘기세요.

요청은 `info` 레벨에서 하나씩 로그에 남지 않습니다. 각 요청을 상태와 지연 시간과 함께 기록하려면 HTTP
계층의 레벨을 올리세요.

```sh
RUST_LOG=info,tower_http=debug
```

로그에 남는 URL은 이름이 비밀처럼 보이는 쿼리 파라미터(`token`, `code`, `state`, `password`, `key`,
`signature`, `jwt`…)의 값을 숨깁니다. 예: `/api/connect/github/callback?code=[hidden]`.

## 관리자 패널에서

홈 대시보드에 **시스템** 위젯을 추가하면 버전, 데이터베이스, 스키마를 한눈에 볼 수 있습니다.
