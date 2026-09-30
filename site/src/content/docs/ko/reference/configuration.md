---
title: 설정 레퍼런스
description: verdin.toml의 모든 섹션과 키, 기본값, 그리고 Verdin이 읽는 환경 변수.
sidebar:
  order: 1
  label: 설정
---

<!-- Written from crates/verdin/src/config.rs, crates/verdin-upload/src/config.rs and
crates/verdin-email/src/lib.rs, crates/verdin-upload/src/transform.rs,
crates/verdin-search/src/lib.rs, crates/verdin-api/src/cdn.rs, crates/verdin-api/src/ai.rs
and crates/verdin/src/telemetry.rs.
Keep it in step when keys change. -->

설정은 계층으로 이루어집니다: **기본값 ← `verdin.toml` ← 환경 변수**. 파일은 선택 사항이며 모든 키에 기본값이 있습니다.
알 수 없는 키는 거부하므로, 오타는 무시되지 않고 시작할 때 실패합니다.

- 모든 키는 `VERDIN_<SECTION>__<KEY>`(밑줄 두 개)로 재정의할 수 있습니다. 예: `VERDIN_SERVER__PORT=8080`,
  `VERDIN_ADMIN__SECURE_COOKIES=false`. 중첩 테이블은 `__`를 하나 더 씁니다: `VERDIN_ADMIN__BRANDING__TITLE=ACME`. 여기서도
  알 수 없는 키는 거부하므로, `VERDIN_`으로 시작하고 `__`를 포함하는 변수는 실제 키를 가리켜야 합니다.
- `VERDIN_DATABASE_URL`은 `database.url`의 줄임입니다.
- 파일은 작업 디렉터리의 `verdin.toml`이거나, `-c, --config` 또는 `VERDIN_CONFIG`로 지정한 경로입니다. 그 안의 상대 경로
  (스키마, 플러그인, 업로드, SQLite 파일)는 파일의 디렉터리를 기준으로 해석합니다.
- 설정 파일 옆의 `.env` 파일을 먼저 로드합니다. 이미 환경에 설정된 변수가 우선합니다.

시크릿은 절대 `verdin.toml`에서 읽지 않습니다. [환경 변수](#환경-변수)를 참고하세요.

## `[server]`

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `host` | `"0.0.0.0"` | 수신할 주소. |
| `port` | `1337` | 수신할 포트. |
| `public_url` | 설정 안 됨 | 브라우저가 서버에 접속하는 주소, 예: `"https://cms.example.com"`. 이메일의 링크와 SSO 콜백에 씁니다. 기본값은 `http://localhost:{port}`. |
| `body_limit` | `"1mb"` | 일반 API 요청의 최대 본문 크기(업로드는 자체 한도). 바이트 수, 또는 `b`, `kb`, `mb`, `gb`를 붙인 문자열. |
| `request_timeout_secs` | `30` | 일반 API 요청의 시간 한도. |
| `sync_interval_secs` | `10` | 다른 인스턴스가 바꾼 설정(기능, 플러그인 스위치, 로케일, 검토 워크플로)을 가져오는 주기. `0`이면 끕니다(단일 인스턴스). |
| `trusted_proxies` | `[]` | `X-Forwarded-For`로 클라이언트를 알려 주는 리버스 프록시(IP 또는 CIDR 대역, 예: `["10.0.0.0/8"]`). 요청 한도와 감사 로그가 그 주소를 씁니다. 없으면 프록시 뒤의 모든 클라이언트가 주소 하나를 공유합니다. |

## `[database]`

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `url` | 설정 안 됨 | 연결 URL: `postgres://…`, `mysql://…`(MySQL과 MariaDB), `sqlite://…`. 필수. 보통 `VERDIN_DATABASE_URL`로 설정합니다. |
| `pool_max` | `10` | 풀의 최대 연결 수. |

## `[schema]`

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `path` | `"schema"` | 설정 파일 기준 스키마 디렉터리. |

## `[api]`

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `prefix` | `"/api"` | 콘텐츠 API를 제공하는 경로. `/`로 시작하고 `/`로 끝나면 안 됩니다. |
| `default_page_size` | `25` | 요청이 지정하지 않을 때의 페이지 크기. 1과 `max_page_size` 사이. |
| `max_page_size` | `100` | 요청이 요구할 수 있는 최대 페이지 크기. |
| `decimal_as_string` | `false` | decimal을 숫자(Strapi 호환) 대신 문자열(정확한 값)로 직렬화합니다. |
| `public_rate_limit` | `0` | 토큰 없는 요청의 클라이언트 IP당 분당 요청 수(`0`: 무제한). |
| `token_rate_limit` | `0` | API 토큰이나 최종 사용자당 분당 요청 수(`0`: 무제한). |
| `cache_ttl_secs` | `0` | 익명 읽기를 메모리에 보관하는 시간(`0`: 캐시 없음). 변경이 있으면 캐시를 비웁니다. |
| `cache_entries` | `1000` | 캐시하는 응답의 최대 개수. |
| `cors_origins` | `[]` | 다른 사이트에서 콘텐츠 API와 GraphQL을 호출할 수 있는 브라우저 출처(`["https://www.example.com"]`: 스킴, 호스트, 포트, 경로 없음), 또는 모두를 뜻하는 `["*"]`(단독으로: `*`는 출처와 함께 쓸 수 없음). 비어 있으면 같은 출처의 페이지만 브라우저에서 호출할 수 있습니다. admin API는 교차 출처 호출을 절대 받지 않습니다. |

## `[admin]`

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `path` | `"/admin"` | 관리자 패널을 제공하는 경로. API는 `{path}/api`에 있습니다. |
| `secure_cookies` | 설정 안 됨 | 리프레시 쿠키에 `Secure`를 붙입니다. 설정하지 않으면 `verdin start`에서는 예, `verdin dev`에서는 아니요(일반 HTTP 로컬 개발). |
| `auth_rate_limit` | `20` | 클라이언트 IP당 분당 로그인, 가입, 토큰 갱신 시도 횟수. |
| `assets_dir` | 설정 안 됨 | 바이너리에 내장된 사본 대신 이 디렉터리(설정 파일 기준)에서 관리자 패널을 제공합니다. |

### `[admin.branding]`

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `title` | `"Verdin"` | 사이드바, 로그인 페이지, 브라우저 탭에 표시됩니다. |
| `logo` | 설정 안 됨 | 설정 파일 기준 이미지 파일(SVG, PNG, WebP). |
| `favicon` | 설정 안 됨 | 설정 파일 기준 아이콘 파일(ICO, PNG, SVG). |
| `accent` | 설정 안 됨 | 버튼, 링크, 포커스 링의 `#rrggbb` 색상. |
| `translations` | `{}` | 언어별로 바꾸는 관리자 텍스트. 예: `"auth.login.title" = "Welcome to ACME"`를 담은 `[admin.branding.translations.en]`. 키는 `admin/public/i18n/en.json`의 키입니다. |

## `[upload]`

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `provider` | `{ name = "local", dir = "public/uploads" }` | 파일을 저장하는 곳. 아래 참고. |
| `max_file_size` | `209715200` | 받는 최대 파일 크기(바이트, 200 MB). |
| `responsive_formats` | `true` | 래스터 이미지의 반응형 포맷을 생성합니다. |
| `breakpoints` | large 1000, medium 750, small 500 | `{ name, width }` 테이블로 된 반응형 포맷(Strapi의 `breakpoints`). 이미지보다 넓은 포맷은 건너뜁니다. |
| `max_image_megapixels` | `100` | 압축 폭탄을 막는 디코딩 한도(메가픽셀). |
| `max_original_size` | 설정 안 됨 | 어느 한 변이든 이 픽셀 수보다 큰 래스터 원본은 업로드 시 축소되며, 이때 메타데이터(EXIF, GPS)도 제거됩니다. 설정하지 않으면 원본을 보낸 그대로 유지합니다. |

```toml
[upload]
breakpoints = [{ name = "large", width = 1000 }, { name = "small", width = 500 }]
```

### 로컬 프로바이더

`dir`(프로젝트 기준) 아래의 파일이며, Verdin이 `/uploads`에서 제공합니다.

```toml
[upload]
provider = { name = "local", dir = "public/uploads" }
```

### `[upload.transforms]`

로컬 파일의 이미지 변환: `/uploads/<file>?preset=thumb`, 또는 서명과 함께 `?w=&h=&fit=&format=&q=`. 렌더링 결과는 디스크에
캐시하며, 파일이 바뀌면(초점 포함) 삭제합니다. cover 자르기는 파일의 초점을 화면에 유지하며, 이미지는 절대 확대하지 않습니다.
JPEG, PNG, WebP, TIFF, BMP를 변환할 수 있습니다(애니메이션일 수 있는 GIF는 제외).

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `enabled` | `true` | 변환을 제공합니다. |
| `presets` | `{}` | 항상 허용하는 이름 있는 변환: `{ w, h, fit, format, q }`. |
| `allow_arbitrary` | `false` | 서명 없이 모든 파라미터를 받습니다. 서로 다른 URL마다 렌더링하고 캐시하므로, 신뢰할 수 있는 네트워크에서만. |
| `max_size` | `4096` | 최대 `w` 또는 `h`(픽셀). |
| `cache_dir` | `".cache/transforms"` | 렌더링 결과를 보관하는 곳(프로젝트 기준, 삭제해도 안전). |

파라미터: `w`, `h`(픽셀), `fit`(기본값 `cover`는 상자에 맞춰 자름, `inside`는 상자 안에 맞춤, `fill`은 늘림), `format`
(`jpeg`, `png`, `webp`. WebP 출력은 무손실), `q`(JPEG 품질, 1–100, 기본 80).

```toml
[upload.transforms.presets]
thumb = { w = 300, h = 300 }
hero = { w = 1600, h = 600, format = "webp" }
```

**서명된 URL.** `VERDIN_IMAGE_SECRET`이 설정되어 있으면 `s`는 `<file>?<canonical query>`의 HMAC-SHA256 hex 값입니다.
canonical query는 기본값이 아닌 파라미터를 이름순(`fit`, `format`, `h`, `q`, `w`. `fit=cover`는 생략)으로 나열합니다.

```js
import { createHmac } from 'node:crypto';
const s = createHmac('sha256', process.env.VERDIN_IMAGE_SECRET)
  .update('photo_1a2b.jpg?format=webp&w=800')
  .digest('hex');
const url = `/uploads/photo_1a2b.jpg?format=webp&w=800&s=${s}`;
```

### S3 프로바이더

S3 호환 서비스라면 무엇이든(AWS, Cloudflare R2, MinIO, Backblaze B2…). 자격 증명은 표준 `AWS_*` 환경 변수
(`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)에서 옵니다.

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `bucket` | 필수 | 버킷 이름. |
| `region` | 설정 안 됨 | 버킷 리전. |
| `endpoint` | 설정 안 됨 | AWS가 아닌 서비스의 사용자 정의 엔드포인트, 예: `https://<account>.r2.cloudflarestorage.com`. |
| `public_url` | 필수 | 버킷이나 그 CDN의 공개 기본 URL. 파일은 `{public_url}/{key}`로 연결됩니다. |
| `prefix` | `""` | 버킷 안의 키 접두사. |
| `path_style` | `false` | path-style 요청(MinIO와 대부분의 자체 호스팅 서비스). |

```toml
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

## `[webhooks]`

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `allow_private_networks` | 설정 안 됨 | 루프백, 사설, 링크 로컬 주소의 웹훅 URL을 허용합니다. 배포 대상과 `[cdn]` 웹훅에도 적용됩니다. 설정하지 않으면 `verdin start`에서는 아니요(그러지 않으면 관리자가 내부 서비스에 접근할 수 있음), `verdin dev`에서는 예. |
| `timeout_secs` | `10` | 전송 한 번의 시간 한도. |
| `retention_days` | `30` | 전송 로그를 보관하는 일수. |

[웹훅](/ko/guides/integrations/webhooks/)을 참고하세요.

## `[history]`

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `max_versions` | `50` | 문서당 보관하는 버전 수(오래된 것은 삭제). |

## `[email]`

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `provider` | `"log"` | `log`(이메일을 로그에 씀), `smtp`, `resend`, `postmark`. |
| `from` | `"Verdin <no-reply@localhost>"` | 보내는 사람. |
| `reply_to` | 설정 안 됨 | 회신 주소. |

### `[email.smtp]`

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `host` | `"localhost"` | SMTP 서버. |
| `port` | `587` | SMTP 포트. |
| `username` | 설정 안 됨 | SMTP 사용자. 비밀번호는 `VERDIN_EMAIL_SMTP_PASSWORD`에서 옵니다. |
| `security` | `"starttls"` | `starttls`, `tls`(암묵적, 보통 포트 465), `none`(로컬 릴레이). |

## `[plugins]`

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `path` | `"plugins"` | 설정 파일 기준 플러그인 디렉터리(플러그인마다 하위 디렉터리 하나). |
| `run_jobs` | `true` | 이 인스턴스에서 플러그인의 예약 작업을 실행합니다(여러 개면 인스턴스 하나에서). |

[플러그인](/ko/extending/plugins/)을 참고하세요.

## `[audit]`

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `retention_days` | `90` | 감사 로그 항목을 보관하는 일수. |

## `[digest]`

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `enabled` | `true` | 이 인스턴스에서 일일 다이제스트를 보냅니다(여러 개면 인스턴스 하나에서). |
| `hour_utc` | `8` | 확인하지 않은 변경의 일일 다이제스트를 보내는 시각(UTC, 0–23). |

## `[log]`

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `format` | `"pretty"` | `pretty` 또는 `json`. |
| `level` | 설정 안 됨(`info`) | 기본 필터. 설정하면 `RUST_LOG`가 우선합니다. |

## `[metrics]`

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `enabled` | `false` | `/_metrics`에서 Prometheus 메트릭을 제공합니다: 영역(`api`, `admin_api`, `graphql`, `mcp`, `uploads`…), 메서드, 상태 클래스별 HTTP 요청과 지연 시간 히스토그램, 대기 중인 웹훅 전송, 열린 실시간 스트림, 이벤트 버스 트래픽, 가동 시간. |
| `token` | 설정 안 됨 | 스크레이프에 `Authorization: Bearer <token>`이 필요합니다. `VERDIN_METRICS_TOKEN`이 우선합니다. 토큰이 없으면 포트에 접근할 수 있는 누구나 메트릭을 읽을 수 있습니다. |

## `[telemetry]`

트레이스와 오류 보고. 둘 다 기본적으로 꺼져 있으며 `verdin start`와 `verdin dev`에서만 쓰입니다([모니터링](/ko/deploy/monitoring/#트레이스-opentelemetry) 참고).

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `enabled` | `false` | HTTP 요청과 그 데이터베이스 쿼리의 OpenTelemetry 트레이스를 OTLP/HTTP(protobuf)로 내보냅니다. `OTEL_SDK_DISABLED=true`가 끕니다. |
| `endpoint` | 설정 안 됨(`http://localhost:4318`) | 컬렉터 기본 URL. `/v1/traces`가 덧붙습니다. `OTEL_EXPORTER_OTLP_ENDPOINT`(기본 URL)와 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`(전체 URL)가 우선합니다. |
| `service_name` | `"verdin"` | 트레이스의 `service.name`. `OTEL_SERVICE_NAME`이 우선합니다. |
| `sample_ratio` | `1.0` | 유지할 트레이스의 비율, `0.0`부터 `1.0`까지. `traceparent` 헤더가 있는 요청은 호출자의 결정을 따릅니다. |
| `sentry_dsn` | 설정 안 됨 | 패닉과 5xx 응답을 Sentry에 보고합니다. `SENTRY_DSN`이 우선합니다. |
| `sentry_environment` | 설정 안 됨 | Sentry 환경. `SENTRY_ENVIRONMENT`가 우선하며, 설정하지 않으면 `verdin start`에서는 `production`, `verdin dev`에서는 `development`. |

## `[ai]`

관리자 패널의 AI 기능(설정 → 기능에서 **AI** 기능이 켜져 있을 때): 항목을 다른 로케일로 번역, 이미지의 대체 텍스트 작성,
텍스트 요약, SEO 메타데이터 제안. 제안을 반환하며, 편집자 없이 저장되는 것은 없습니다. 키는 `VERDIN_AI_KEY`에서 읽습니다
(로컬 서버에는 필요 없음).

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `provider` | `"none"` | `anthropic`, `openai`, `openai-compatible`(Ollama, LM Studio, vLLM…). |
| `model` | `anthropic`이면 `claude-sonnet-5` | 모델. 다른 제공업체에서는 필수. |
| `base_url` | 제공업체의 기본값 | 다른 엔드포인트, 예: `http://localhost:11434/v1`. |
| `max_tokens` | `2048` | 가장 긴 응답. |

```toml
[ai]
provider = "anthropic"
```

각 관리자는 분당 AI 요청을 30번까지 할 수 있습니다. 콘텐츠와 이미지가 제공업체로 전송되니, 조직이 허용하는 제공업체를
고르세요.

## `[cdn]`

콘텐츠가 공개적으로 바뀌면 CDN 캐시를 퍼지합니다. 콘텐츠 API 응답에는 `vd`와 `vd-<singularName>` 태그가 붙습니다
(`Cache-Tag`와 `Surrogate-Key` 헤더).

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `provider` | `"none"` | `cloudflare`, `fastly`, `webhook`. |
| `zone_id` | 설정 안 됨 | Cloudflare zone(태그로 퍼지). |
| `service_id` | 설정 안 됨 | Fastly 서비스(surrogate key로 퍼지). |
| `url` | 설정 안 됨 | `webhook`: `POST { "tags": [...] }`를 받습니다. |
| `debounce_ms` | `1000` | 퍼지 전에 변경을 모으는 시간. |

API 토큰은 `VERDIN_CDN_TOKEN`에서 읽습니다(웹훅에는 bearer 토큰으로 보냄).

## `[search]`

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `enabled` | `false` | `$containsi` 대신 전문 검색 인덱스(Tantivy)로 `_q`를 정렬합니다. |
| `dir` | `"data/search"` | 프로젝트 기준 인덱스 디렉터리. 삭제하면 다음 시작 때 인덱스를 다시 만듭니다. |
| `memory_mb` | `50` | 인덱싱 메모리 예산. |

인덱스는 인스턴스의 디스크에 있습니다. 인스턴스가 여러 개면 [이벤트 버스](#cluster)를 켜서 각 인덱스가 모든
인스턴스의 쓰기를 따라가게 하세요.

## `[cluster]`

한 프로젝트의 여러 인스턴스를 위한 공유 이벤트 버스입니다([여러 인스턴스 실행](/ko/deploy/scaling/#공유-이벤트-버스) 참고).

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `bus` | `"none"` | `none`: 실시간 이벤트, 프레즌스, 캐시 무효화, 검색 업데이트가 각 인스턴스에 머뭅니다. `database`: 프로젝트의 데이터베이스를 통해 모든 인스턴스에 도달합니다(PostgreSQL은 `LISTEN/NOTIFY`, MySQL, MariaDB, SQLite는 폴링). |
| `poll_interval_ms` | `1000` | MySQL, MariaDB, SQLite가 다른 인스턴스의 이벤트를 읽는 주기. PostgreSQL은 `NOTIFY`로 깨어나며, 리스닝할 수 없는 동안에만 이 간격을 씁니다. |
| `instance_id` | 설정 안 됨(시작할 때마다 무작위) | 버스와 로그에서 이 인스턴스의 이름. |

```toml
[cluster]
bus = "database"
```

모든 인스턴스에 설정하거나, `VERDIN_CLUSTER__BUS=database`로 설정하세요.

## 환경 변수

`VERDIN_<SECTION>__<KEY>` 재정의 외에 Verdin은 다음 변수를 읽습니다.

| 변수 | 설명 |
| --- | --- |
| `VERDIN_CONFIG` | 설정 파일 경로(`--config`와 같음). |
| `VERDIN_DATABASE_URL` | `database.url`의 줄임. |
| `VERDIN_ADMIN_JWT_SECRET` | 관리자 세션 토큰에 서명합니다. 필수, 최소 32바이트. `verdin secrets`로 생성하세요. |
| `VERDIN_TOKEN_PEPPER` | 저장된 토큰의 키 해시용. 필수, 최소 32바이트. `verdin secrets`로 생성하세요. |
| `VERDIN_ADMIN_PASSWORD` | `verdin admin create`와 `verdin admin reset-password`의 비밀번호(없으면 stdin에서 읽음). [명령줄 레퍼런스](/ko/reference/cli/)를 참고하세요. |
| `VERDIN_EMAIL_SMTP_PASSWORD` | SMTP 비밀번호. |
| `VERDIN_EMAIL_API_KEY` | Resend와 Postmark 프로바이더의 API 키. |
| `VERDIN_SSO_<ID>_SECRET` | SSO 제공업체의 클라이언트 시크릿. `<ID>`는 제공업체 id를 대문자로, `-`를 `_`로 바꾼 것입니다([싱글 사인온](/ko/guides/auth/sso/) 참고). |
| `VERDIN_OAUTH_<PROVIDER>_SECRET` | 최종 사용자 OAuth 제공업체의 클라이언트 시크릿. SSO와 같은 방식으로 이름 붙입니다([최종 사용자](/ko/guides/auth/end-users/) 참고). |
| `VERDIN_AI_KEY` | `[ai]` 제공업체의 API 키. |
| `VERDIN_CDN_TOKEN` | `[cdn]` 제공업체의 API 토큰. |
| `VERDIN_IMAGE_SECRET` | 이미지 변환 URL에 서명합니다([`[upload.transforms]`](#uploadtransforms) 참고). |
| `VERDIN_METRICS_TOKEN` | `[metrics].enabled`일 때 `/_metrics` 스크레이프용 bearer 토큰. `[metrics].token`보다 우선합니다. |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | [`[telemetry]`](#telemetry) 트레이스의 컬렉터. `[telemetry].endpoint`보다 우선합니다. 다른 표준 `OTEL_EXPORTER_OTLP_*` 변수(헤더, 타임아웃, 압축)도 적용됩니다. |
| `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` | 내보내는 트레이스의 리소스. `OTEL_SERVICE_NAME`이 `[telemetry].service_name`보다 우선합니다. |
| `OTEL_SDK_DISABLED` | `true`이면 `[telemetry].enabled`여도 트레이스 내보내기를 끕니다. |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | Sentry 오류 보고. `[telemetry].sentry_dsn`과 `sentry_environment`보다 우선합니다. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | S3 업로드 프로바이더의 자격 증명. |
| `RUST_LOG` | 로그 필터. `[log].level`보다 우선합니다. |
