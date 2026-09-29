---
title: Railway
description: 저장소의 Dockerfile로 Verdin을 Railway에 배포합니다. Railway PostgreSQL을 쓰고, 미디어는 S3 호환 스토리지나 볼륨에 둡니다.
sidebar:
  order: 6
---

이 페이지에서는 Verdin 프로젝트를 [Railway](https://railway.com)에 배포합니다. 저장소의 작은 Dockerfile로
빌드한 서비스, Railway PostgreSQL 데이터베이스, 그리고 S3 호환 스토리지(단일 인스턴스라면 볼륨)의
미디어로 구성합니다.

:::note
Railway의 설정은 2026-09-29에 [Railway 문서](https://docs.railway.com/reference/config-as-code)와 대조해
확인했지만, 실제 Railway 계정에 배포해 보지는 않았습니다. `# yours` 표시가 있거나 꺾쇠괄호 안에 있는 값은
직접 채우세요.
:::

## 1. Dockerfile, 설정, `railway.json` 추가

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
provider = { name = "s3", bucket = "media", region = "auto",             # yours
             endpoint = "https://<account>.r2.cloudflarestorage.com",    # yours
             public_url = "https://media.example.com" }                  # yours
```

```json title="railway.json"
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "healthcheckPath": "/_ready",
    "healthcheckTimeout": 120,
    "restartPolicyType": "ON_FAILURE"
  }
}
```

시작 명령은 필요 없습니다. 이미지가 `start --migrate`를 실행하며, 서비스하기 전에 safe 마이그레이션을
적용합니다. `.env`는 저장소에 넣지 마세요.

## 2. 프로젝트 만들기

1. Railway에서 GitHub 저장소로 프로젝트를 만듭니다. Railway가 `railway.json`을 찾아 Dockerfile을 빌드합니다.
2. 프로젝트에 **PostgreSQL** 데이터베이스를 추가합니다.
3. Verdin 서비스의 **Variables**에 다음을 추가합니다.

   | 변수 | 값 |
   | --- | --- |
   | `VERDIN_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (데이터베이스 서비스의 사설 URL. 데이터베이스 서비스 이름을 쓰세요) |
   | `VERDIN_ADMIN_JWT_SECRET` | `verdin secrets`에서 |
   | `VERDIN_TOKEN_PEPPER` | `verdin secrets`에서 |
   | `VERDIN_SERVER__PUBLIC_URL` | `https://<your-domain>` |
   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | S3 자격 증명 |

   두 시크릿은 로컬에서 생성합니다.

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets
   ```

4. 서비스의 네트워킹 설정에서 **Generate Domain**을 누르고 대상 포트를 `1337`로 설정합니다. Verdin은
   `[server].port`에서 수신하며 Railway의 `PORT` 변수를 읽지 않습니다.
5. 배포하고 `https://<your-domain>/admin/`을 열어 첫 관리자를 등록합니다.

## 변형: 볼륨에 미디어나 SQLite 두기

단일 인스턴스라면 업로드와 데이터베이스까지 `/data`에 마운트한 Railway 볼륨에 둘 수 있습니다.

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

PostgreSQL을 쓰지 않는다면 `VERDIN_DATABASE_URL=sqlite:///data/verdin.db`도 설정합니다. 다음을 기억하세요.

- 볼륨이 있는 서비스는 레플리카를 가질 수 없으며, 재배포할 때마다 짧은 다운타임이 있습니다.
- Railway는 root 소유의 볼륨을 마운트하고, 이미지는 uid `65532`로 실행됩니다. 서버가 볼륨에 쓸 수 있도록
  서비스 변수 `RAILWAY_RUN_UID=0`을 설정하세요.

## 클라이언트 주소

Railway의 엣지 프록시가 서비스 앞에 있습니다. 이 가이드에서는 프록시의 주소 대역을 검증하지 않았으므로
`[server].trusted_proxies`는 비워 둡니다. 그러면 모든 방문자가 요청 한도에서 같은 주소로 계산되므로,
프록시 대역을 찾아 신뢰하도록 설정하기 전까지 `[api].public_rate_limit`은 `0`으로 두세요.
