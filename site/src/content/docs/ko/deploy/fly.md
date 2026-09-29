---
title: Fly.io
description: 자체 이미지, PostgreSQL, Tigris 오브젝트 스토리지로 Verdin을 Fly.io에 배포하거나, 볼륨에 SQLite를 둔 Machine 하나로 배포합니다.
sidebar:
  order: 4
---

이 페이지에서는 공식 이미지 위에 빌드한 작은 이미지로 Verdin 프로젝트를 [Fly.io](https://fly.io)에
배포합니다. 권장 구성은 Machine에 상태를 두지 않습니다. 데이터베이스는 PostgreSQL, 미디어는 Tigris(Fly의
S3 호환 스토리지)입니다. 볼륨에 SQLite를 두는 변형은 뒤에 나옵니다.

:::note
Fly의 형식은 2026-09-29에 [Fly 문서](https://docs.fly.io/reference/configuration/)와 대조해 확인했지만,
실제 Fly 계정에서 이 구성을 실행해 보지는 않았습니다. 꺾쇠괄호 안의 값과 `# yours` 표시가 있는 값은 직접
채우세요.
:::

준비물: 로그인한 [`flyctl`](https://docs.fly.io/flyctl/install/)과, `schema/` 디렉터리를 커밋한 Verdin
프로젝트.

## 1. Dockerfile과 설정 추가

프로젝트 디렉터리에 설정과 스키마를 공식 이미지에 복사하는 `Dockerfile`을 추가합니다
([자체 이미지](/ko/deploy/docker/) 참고).

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

그리고 Fly용 `verdin.toml`을 추가합니다.

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337
public_url = "https://my-verdin.fly.dev"       # yours: the app's URL or your domain

[schema]
path = "schema"

[log]
format = "json"

[upload]
provider = { name = "s3", bucket = "my-verdin-media",   # yours: the bucket name
             region = "auto", endpoint = "https://t3.storage.dev",
             public_url = "https://my-verdin-media.t3.tigrisfiles.io" }
```

`.env`가 빌드 컨텍스트에 들어가지 않도록 `.dockerignore`에 추가하세요.

## 2. `fly.toml` 작성

```toml title="fly.toml"
app = "my-verdin"                # yours
primary_region = "fra"           # yours

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 1337
  force_https = true
  # Keep a Machine running: webhooks, scheduled releases, plugin jobs and the
  # daily digest run inside the server process.
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "30s"
    interval = "15s"
    method = "GET"
    timeout = "5s"
    path = "/_ready"

[[vm]]
  memory = "512mb"               # adjust to your content and traffic
```

이미지의 기본 명령인 `start --migrate`가 각 Machine이 시작될 때 safe 마이그레이션을 적용하므로
`release_command`는 필요 없습니다. (Fly는 `release_command`를 볼륨 없는 임시 Machine에서 실행하므로, 어차피
SQLite에서는 동작하지 않습니다.)

## 3. 앱, 데이터베이스, 버킷 만들기

1. 배포하지 않고 앱을 만듭니다. `--ha=false`는 Machine 하나로 시작합니다. 더 추가하기 전에
   [여러 인스턴스 실행](/ko/deploy/scaling/)을 읽으세요.

   ```sh frame="terminal"
   fly launch --no-deploy --copy-config --ha=false
   ```

2. [Fly Managed Postgres](https://docs.fly.io/mpg/)나 다른 PostgreSQL 프로바이더로 PostgreSQL
   데이터베이스를 만들고 연결 URL을 적어 두세요.

3. 공개 Tigris 버킷을 만듭니다. 이 명령은 `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
   `AWS_ENDPOINT_URL_S3`, `BUCKET_NAME`을 앱의 시크릿으로 설정하며, Verdin은 앞의 두 개를 읽습니다. 버킷
   이름은 `verdin.toml`에 넣으세요.

   ```sh frame="terminal"
   fly storage create --public
   ```

4. Verdin의 시크릿과 데이터베이스 URL을 설정합니다.

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets | fly secrets import
   fly secrets set VERDIN_DATABASE_URL='postgres://<user>:<password>@<host>:5432/<db>?sslmode=require'
   ```

5. 배포한 뒤 `https://<app>.fly.dev/admin/`을 열고 첫 관리자를 등록합니다.

   ```sh frame="terminal"
   fly deploy
   ```

## 클라이언트 주소와 요청 한도

Fly의 프록시는 클라이언트를 `X-Forwarded-For`에 추가하며,
[Fly의 요청 헤더 문서](https://docs.fly.io/networking/request-headers/)에 따르면 가장 오른쪽 주소는 앱 자체의
IP입니다. Verdin이 클라이언트를 찾으려면 프록시 대역과 앱의 주소(`fly ips list`)를 신뢰하도록 설정하세요.

```toml title="verdin.toml"
[server]
trusted_proxies = ["172.16.0.0/12", "<app IPv4>", "<app IPv6>"]
```

이 설정은 실행 중인 앱에서 검증하지 않았습니다. 직접 확인하기 전까지는 `[api].public_rate_limit`을 `0`으로
두세요. 프록시 설정이 맞지 않으면 모든 방문자가 같은 주소로 계산됩니다.

## 변형: SQLite를 쓰는 Machine 하나

작은 프로젝트라면 데이터베이스와 업로드를 Fly 볼륨에 둘 수도 있습니다.

- `verdin.toml`의 `[upload]` 아래에 `provider = { name = "local", dir = "/data/uploads" }`를
  설정하고(기본 디렉터리는 서버가 쓸 수 없는 `/app` 기준 상대 경로), `VERDIN_DATABASE_URL=sqlite:///data/verdin.db`를
  시크릿으로 설정합니다.
- `/data`에 볼륨을 마운트합니다.

  ```toml title="fly.toml"
  [mounts]
    source = "verdin_data"
    destination = "/data"
    initial_size = "1gb"
  ```

- Machine을 정확히 하나만 실행하세요(`fly scale count 1`). 볼륨은 Machine 하나에만 붙으며 SQLite는 공유할
  수 없습니다.
- Fly는 root 소유의 볼륨을 만들고, 이미지는 uid `65532`로 실행됩니다. `/data`에서 권한 오류로 시작에
  실패하면 `Dockerfile`에 `USER root`를 추가하세요.

볼륨을 백업하세요. Fly는 매일 볼륨 스냅샷을 보관하며, `verdin export`로 이식 가능한 아카이브를 만들 수
있습니다([백업](/ko/deploy/backups/) 참고).
