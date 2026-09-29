---
title: Render
description: Blueprint로 Verdin을 Render에 배포합니다 — 저장소로 빌드한 Docker 웹 서비스, Render PostgreSQL 데이터베이스, S3 호환 스토리지나 디스크의 미디어.
sidebar:
  order: 5
---

이 페이지에서는 Blueprint(`render.yaml`)로 Verdin 프로젝트를 [Render](https://render.com)에 배포합니다.
저장소의 작은 Dockerfile로 빌드한 웹 서비스와 Render PostgreSQL 데이터베이스로 구성합니다. Render의 파일
시스템은 휘발성이므로 미디어는 S3 호환 스토리지로 보내거나, 인스턴스가 하나라면 영구 디스크에 둡니다.

:::note
Blueprint 형식은 2026-09-29에 [Render의 Blueprint 레퍼런스](https://render.com/docs/blueprint-spec)와
대조해 확인했지만, 실제 Render 계정에 배포해 보지는 않았습니다. `# yours` 표시가 있는 값은 직접 채우세요.
:::

준비물: Render가 읽을 수 있는 Git 저장소에 있는 Verdin 프로젝트(`schema/` 포함).

## 1. Dockerfile과 설정 추가

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337

[schema]
path = "schema"

[log]
format = "json"

[upload]
# Cloudflare R2 as an example; any S3-compatible service works.
provider = { name = "s3", bucket = "media", region = "auto",             # yours
             endpoint = "https://<account>.r2.cloudflarestorage.com",    # yours
             public_url = "https://media.example.com" }                  # yours
```

`.env`는 저장소와 이미지(`.dockerignore`)에 넣지 마세요.

## 2. `render.yaml` 작성

```yaml title="render.yaml"
services:
  - type: web
    name: verdin
    runtime: docker
    repo: https://github.com/<you>/<your-project>   # yours
    branch: main
    dockerfilePath: ./Dockerfile
    region: frankfurt                               # yours
    healthCheckPath: /_ready
    envVars:
      - key: VERDIN_DATABASE_URL
        fromDatabase:
          name: verdin-db
          property: connectionString
      - key: VERDIN_ADMIN_JWT_SECRET
        generateValue: true
      - key: VERDIN_TOKEN_PEPPER
        generateValue: true
      - key: VERDIN_SERVER__PUBLIC_URL
        value: https://verdin.onrender.com          # yours: the service URL or your domain
      - key: AWS_ACCESS_KEY_ID
        sync: false                                 # asked for when you create the Blueprint
      - key: AWS_SECRET_ACCESS_KEY
        sync: false

databases:
  - name: verdin-db
    databaseName: verdin
    user: verdin
    region: frankfurt                               # yours: the same region
    postgresMajorVersion: "17"
```

인스턴스 타입을 고르려면 서비스와 데이터베이스에 `plan`을 추가하세요(Render의 요금 페이지 참고). 지정하지
않으면 Render의 기본값을 씁니다.

`generateValue: true`는 Blueprint를 처음 적용할 때 각 시크릿을 한 번 만들고 그 뒤로 유지합니다. 다시 생성하지
마세요. `VERDIN_TOKEN_PEPPER`가 새로 바뀌면 모든 API 토큰이 동작하지 않습니다.

## 3. 배포

1. Render 대시보드에서 저장소로 **Blueprint**를 만들고 `sync: false` 변수의 값을 입력합니다.
2. 첫 배포를 기다립니다. 이미지의 기본 명령인 `start --migrate`가 첫 시작에서 테이블을 만들고, 이후 배포에서
   safe 마이그레이션을 적용합니다.
3. `https://<service>.onrender.com/admin/`을 열고 첫 관리자를 등록합니다.

Render는 인스턴스를 멈추기 전에 `SIGTERM`을 보내며, Verdin은 이를 받으면 작업을 마치고 종료합니다.

## 변형: 디스크에 미디어 두기

단일 인스턴스라면 S3 대신 Render 영구 디스크에 업로드를 저장할 수 있습니다. `verdin.toml`에서 로컬
프로바이더를 설정합니다.

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

그리고 서비스에 디스크를 추가합니다.

```yaml title="render.yaml"
    disk:
      name: verdin-data
      mountPath: /data
      sizeGB: 5
```

디스크가 있으면 Render에서 서비스를 여러 인스턴스로 확장할 수 없고, 배포할 때 새 인스턴스가 시작되기 전에
이전 인스턴스를 멈추므로 배포마다 짧은 다운타임이 있습니다. Render 데이터베이스를 쓰지 않으려면 같은 디스크에
SQLite 데이터베이스(`sqlite:///data/verdin.db`)를 둘 수 있습니다. 이미지의 사용자(uid `65532`)가 디스크에 쓸 수
있는지 확인하세요. `/data`에서 권한 오류로 시작에 실패하면 `Dockerfile`에 `USER root`를 추가하세요.

## 클라이언트 주소

Render의 프록시가 서비스 앞에 있습니다. 이 가이드에서는 프록시의 주소 대역을 검증하지 않았으므로
`[server].trusted_proxies`는 비워 둡니다. 그러면 모든 방문자가 요청 한도에서 같은 주소로 계산되므로,
프록시 대역을 찾아 신뢰하도록 설정하기 전까지 `[api].public_rate_limit`은 `0`으로 두세요.
