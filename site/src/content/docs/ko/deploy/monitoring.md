---
title: 모니터링
description: 실행 중인 Verdin 인스턴스 관찰하기 — /_health와 /_ready 검사, /_metrics의 Prometheus 메트릭과 Grafana 대시보드, OpenTelemetry 트레이스, Sentry 오류 보고, 로그 형식, 레벨, 요청 id.
sidebar:
  order: 10
---

Verdin 인스턴스는 헬스 엔드포인트 두 개, 선택 사항인 Prometheus 메트릭, 선택 사항인 OpenTelemetry 트레이스와
Sentry 오류 보고, 구조화된 로그로 자기 상태를 알립니다. 이 페이지에서는 각각이 무엇을 반환하는지, 어떻게
켜는지 설명합니다.

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
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`, `kind`, `function` | [플러그인](/ko/extending/plugins/) 함수가 걸린 시간. 버킷은 같습니다. |
| `verdin_plugin_call_errors_total` | counter | `plugin`, `kind`, `function` | 실패한 플러그인 호출: 트랩, 시간 초과, JSON이 아닌 출력, 또는 시작 함수의 `{ error }`. |
| `verdin_webhook_deliveries_pending` | gauge | | 전송 대기 중인 웹훅 전송 수. |
| `verdin_realtime_subscribers` | gauge | | 열려 있는 실시간 이벤트 스트림 수. |
| `verdin_cluster_events_total` | counter | `direction` | `[cluster].bus`를 설정했을 때 [공유 이벤트 버스](/ko/deploy/scaling/#공유-이벤트-버스)의 이벤트: 다른 인스턴스로 `sent`, 다른 인스턴스에서 `received`, `dropped`(가득 찬 큐 또는 실패한 쓰기). |
| `verdin_uptime_seconds` | gauge | | 프로세스 시작 후 경과한 초. |
| `verdin_build_info` | gauge | `version` | 항상 1. 실행 중인 버전. |

`area`는 서버의 영역입니다: `api`(콘텐츠 API), `admin_api`, `admin`(패널 파일), `graphql`, `mcp`,
`uploads`, `internal`(`/_`로 시작하는 경로), `other`. `status`는 상태 클래스입니다: `2xx`, `3xx`, `4xx`,
`5xx`.
플러그인 호출의 `kind`는 `hook`, `route`, `job`, `startup`, `graphql`입니다. 플러그인 시리즈는 첫 호출 후에
나타납니다([플러그인 레퍼런스](/ko/extending/plugin-reference/#메트릭) 참고).

유용한 알림: `/_ready` 실패, `5xx` 비율 증가, 계속 늘어나는 `verdin_webhook_deliveries_pending`(웹훅 대상이
다운됨), 늘어나는 `verdin_plugin_call_errors_total`이나 느린 플러그인 훅(훅이 실행되는 쓰기를 지연시킵니다),
`verdin_uptime_seconds` 초기화(재시작).

### Grafana 대시보드

[`docker/grafana/verdin.json`](https://github.com/Verdin-CMS/verdin/blob/main/docker/grafana/verdin.json)은 이
메트릭을 위한 대시보드입니다. 요청 속도, `5xx` 비율, 영역·메서드·상태 클래스별 지연 시간 분위수, 대기 중인 웹훅
전송, 실시간 구독자, 이벤트 버스 트래픽, 플러그인 함수별 호출 속도·p95·오류를 보여 줍니다. Grafana에서
가져오고(**Dashboards → New → Import**) Prometheus 데이터 소스를 고르세요. 맨 위의 `instance`와 `area` 변수가
모든 패널을 필터링합니다.

## 트레이스 (OpenTelemetry)

Verdin은 모든 요청의 트레이스를 OTLP/HTTP로 OpenTelemetry 컬렉터(OpenTelemetry Collector, Grafana Alloy나
Tempo, Jaeger, Honeycomb, Datadog…)로 내보낼 수 있습니다. 기본적으로 꺼져 있습니다.

```toml title="verdin.toml"
[telemetry]
enabled = true
endpoint = "http://otel-collector:4318"
```

표준 변수도 동작하며 파일보다 우선합니다.

```sh
VERDIN_TELEMETRY__ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<key>
OTEL_SERVICE_NAME=cms-production
```

각 트레이스에는 다음이 들어 있습니다.

- **요청 스팬**(kind `server`). 메서드와, id를 `{id}`로 바꾼 경로로 이름이 붙으며(`PUT /api/articles/{id}`),
  `http.response.status_code`가 있고 `5xx`에서는 오류 상태가 됩니다. W3C `traceparent` 헤더가 있는 요청은 호출자의
  트레이스에 합류합니다.
- 그 아래에 **데이터베이스 문장마다 스팬**(kind `client`): `db.system.name`(`postgresql`, `mysql`, `mariadb`,
  `sqlite`)과 `db.query.text`, 즉 `?` 플레이스홀더가 있는 SQL입니다. 바인딩된 값은 절대 기록되지 않으므로 콘텐츠,
  비밀번호, 토큰이 트레이스에 들어가지 않습니다. `COMMIT`과 `ROLLBACK`은 자체 스팬을 가지며, SQLite에서는
  `write lock` 스팬이 쓰기가 앞선 쓰기를 얼마나 기다렸는지 보여 줍니다.
- 요청을 처리하는 동안 기록된 로그 이벤트가 스팬 이벤트로 들어갑니다.

요청 밖에서 실행되는 문장(시작, 마이그레이션, 백그라운드 작업)은 트레이스되지 않습니다. `[telemetry].sample_ratio`는
트레이스의 일부만 유지하며(`0.1`은 열 개 중 하나), 스팬은 배치로 전송되고 서버가 멈출 때 플러시됩니다. 로그
레벨은 트레이스를 필터링하지 않습니다. `[log].level = "warn"`이어도 모든 요청을 내보냅니다.

## 오류 보고 (Sentry)

DSN을 설정하면 패닉과 `5xx` 응답을 [Sentry](https://sentry.io)(또는 GlitchTip 같은 Sentry 호환 서비스)로 보냅니다.

```sh
SENTRY_DSN=https://<key>@o0.ingest.sentry.io/<project>
```

`[telemetry].sentry_dsn`도 동작하며, 변수가 우선합니다. `5xx`는 `POST /api/articles answered 500` 같은 오류
이벤트로 도착하며, `http.method`, `http.status_code`, `request_id` 태그가 붙습니다. `request_id`는
`X-Request-Id` 헤더와 그 요청의 로그 줄과 일치합니다. 이벤트에는 Verdin 버전이 릴리스로, `production`(`verdin start`)
또는 `development`(`verdin dev`)가 환경으로 들어갑니다. `SENTRY_ENVIRONMENT`나 `[telemetry].sentry_environment`가
다른 값을 지정하면 그 값을 씁니다. URL은 로그처럼 비밀처럼 보이는 쿼리 값을 가려서 보고되며, 요청 본문과
헤더는 절대 전송되지 않습니다.

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
