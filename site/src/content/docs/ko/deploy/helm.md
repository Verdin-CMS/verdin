---
title: Helm 차트
description: deploy/helm/verdin의 Helm 차트로 Kubernetes에 Verdin을 설치합니다. 파드 하나에는 볼륨의 SQLite, 여러 레플리카에는 외부 데이터베이스, S3, 공유 이벤트 버스를 씁니다.
sidebar:
  order: 7
---

[`deploy/helm/verdin`](https://github.com/verdin-cms/verdin/tree/main/deploy/helm/verdin)의 차트는
[Kubernetes](/ko/deploy/kubernetes/)의 매니페스트를 묶은 것입니다. 프로브가 있는 Deployment, Service,
선택 사항인 Ingress, `/data`용 PersistentVolumeClaim, 서버 시크릿이 담긴 Secret이 들어 있습니다. 아직
차트 저장소에 게시되지 않았으므로 저장소 클론에서 설치하세요.

차트는 2026-09-30에 `helm lint --strict`와 `helm template`(Helm 3)으로 확인했으며, 실제 클러스터에는
설치하지 않았습니다.

## SQLite를 쓰는 파드 하나

기본값은 SQLite, 업로드, 이미지 캐시, 검색 인덱스를 `/data`에 마운트한 5 GiB 볼륨에 두는 레플리카 하나를
실행합니다.

```sh frame="terminal"
git clone --depth 1 https://github.com/verdin-cms/verdin
helm install cms verdin/deploy/helm/verdin \
  --set publicUrl=https://cms.example.com \
  --set ingress.enabled=true --set ingress.hosts[0].host=cms.example.com \
  --set ingress.hosts[0].paths[0].path=/
```

Deployment는 `Recreate` 전략을 쓰므로 파드 두 개가 같은 데이터베이스 파일을 여는 일이 없습니다. 업그레이드마다
짧은 다운타임이 있습니다.

## 여러 레플리카

레플리카를 하나보다 많이 쓰려면 세 가지가 필요하며, 없으면 차트가 렌더링을 거부합니다.

- 외부 데이터베이스(`database.url` 또는 `database.existingSecret`: PostgreSQL, MySQL, MariaDB).
- `cluster.bus: database`. 그래야 실시간 이벤트, 프레즌스, 캐시 무효화, 검색 업데이트가 모든 파드에
  도달합니다([공유 이벤트 버스](/ko/deploy/scaling/#공유-이벤트-버스) 참고).
- `/data`에 ReadWriteOnce 볼륨 없음: 미디어는 S3에 두고 `persistence.enabled: false`로 설정하거나(그러면 각
  파드가 이미지 캐시와 검색 인덱스를 `emptyDir`에 둡니다), ReadWriteMany 스토리지 클래스를 쓰세요.

```yaml title="values-production.yaml"
replicaCount: 3
image:
  repository: registry.example.com/verdin-site   # your image, schema baked in
  tag: "2026-09-30"
schema:
  path: /app/schema
publicUrl: https://cms.example.com
trustedProxies: ["10.0.0.0/8"]                    # the pod CIDR of your ingress controller
database:
  existingSecret: verdin-database                  # key VERDIN_DATABASE_URL
cluster:
  bus: database
persistence:
  enabled: false
s3:
  enabled: true
  bucket: media
  region: auto
  endpoint: https://<account>.r2.cloudflarestorage.com
  publicUrl: https://media.example.com
  existingSecret: verdin-s3                        # AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
metrics:
  enabled: true
  token: "<random token>"
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: cms.example.com
      paths: [{ path: /, pathType: Prefix }]
  tls:
    - secretName: cms-example-com-tls
      hosts: [cms.example.com]
```

```sh frame="terminal"
helm upgrade --install cms verdin/deploy/helm/verdin -f values-production.yaml
```

모든 파드가 `start --migrate`를 실행합니다. 마이그레이션은 데이터베이스에서 잠금을 잡으므로 한 번만
실행됩니다. 위험하거나 파괴적인 단계는 시작할 때 절대 실행되지 않습니다. 롤아웃하기 전에
`kubectl exec deploy/cms-verdin -- verdin migrate apply --allow …`로 적용하세요. 예약된 플러그인 작업은
`plugins.runJobs`가 true인 모든 파드에서 실행됩니다. [여러 인스턴스 실행](/ko/deploy/scaling/)을 참고하세요.

## 스키마

프로덕션 서버는 스키마를 편집하지 않으므로, 파드에는 커밋한 스키마가 필요합니다.

- **자체 이미지(권장).** `FROM ghcr.io/verdin-cms/verdin:0.11`에 `COPY schema /app/schema`를 더하고
  `schema.path: /app/schema`로 설정합니다. 그러면 각 이미지가 마이그레이션에 쓴 스키마를 함께 담습니다.
- **`schema.files`.** 스키마 디렉터리 기준 경로와 그 JSON으로, ConfigMap으로 렌더링되어 `/etc/verdin/schema`에
  마운트됩니다.

  ```yaml
  schema:
    files:
      content-types/article.json: |
        { "kind": "collectionType", "singularName": "article", … }
  ```

  `helm upgrade … --set-file 'schema.files.content-types/article\.json=schema/content-types/article.json'`은
  디스크의 파일을 읽습니다.

둘 다 없으면 파드는 볼륨의 `/data/schema`를 읽습니다.

## 시크릿

`secrets.existingSecret`이 비어 있으면 차트가 `VERDIN_ADMIN_JWT_SECRET`과 `VERDIN_TOKEN_PEPPER`(설치할 때
무작위로 만들고, 업그레이드에서는 다시 읽어 유지), 그리고 values로 넘긴 데이터베이스 URL, S3 자격 증명,
메트릭 토큰이 담긴 Secret을 만듭니다. Secret과 볼륨에는 `helm.sh/resource-policy: keep`이 있습니다.
`helm uninstall`이 이들을 남기므로 재설치하면 데이터를 찾고 API 토큰도 계속 동작합니다. Secret도
데이터베이스와 함께 백업하세요.

시크릿을 직접 관리하려면(Sealed Secrets, External Secrets, Vault) 해당 키를 가진 Secret을 만들고
`secrets.existingSecret`을 설정하세요.

## 값

| 값 | 기본값 | 설명 |
| --- | --- | --- |
| `image.repository`, `image.tag` | `ghcr.io/verdin-cms/verdin`, 차트의 `appVersion` | 이미지. |
| `replicaCount` | `1` | [여러 레플리카](#여러-레플리카)를 참고하세요. |
| `args` | `["start", "--migrate"]` | 서버의 명령. |
| `publicUrl` | | `VERDIN_SERVER__PUBLIC_URL`. |
| `trustedProxies` | `[]` | `VERDIN_SERVER__TRUSTED_PROXIES`. |
| `secrets.adminJwtSecret`, `secrets.tokenPepper`, `secrets.existingSecret` | 생성됨 | [시크릿](#시크릿)을 참고하세요. |
| `database.url`, `database.existingSecret`, `database.existingSecretKey` | `/data`의 SQLite | 데이터베이스. |
| `cluster.bus`, `cluster.pollIntervalMs` | `none`, `1000` | `[cluster]`. 각 파드의 이름이 `instance_id`입니다. |
| `s3.*` | 비활성화 | S3 업로드 프로바이더: `bucket`, `region`, `endpoint`, `publicUrl`, `prefix`, `pathStyle`, 자격 증명 또는 `existingSecret`. |
| `schema.path`, `schema.files` | | [스키마](#스키마)를 참고하세요. |
| `configToml` | | `verdin.toml` 전체. `/app/verdin.toml`에 마운트됩니다. 차트의 환경 변수가 여전히 우선합니다. |
| `metrics.enabled`, `metrics.token` | 비활성화 | `/_metrics`의 Prometheus 메트릭. |
| `plugins.runJobs` | `true` | `[plugins].run_jobs`. |
| `extraEnv`, `extraEnvFrom` | `[]` | 추가 변수. 예: `VERDIN_TELEMETRY__ENABLED`. |
| `persistence.*` | 활성화, 5Gi, ReadWriteOnce | `/data` 볼륨(`existingClaim`, `storageClass`, `accessModes`, `size`). |
| `service.*`, `ingress.*` | 80 포트의 ClusterIP, Ingress 없음 | 네트워킹. |
| `probes.*` | | `/_ready`의 startup과 readiness, `/_health`의 liveness. |
| `resources`, `nodeSelector`, `tolerations`, `affinity`, `podAnnotations`, `podLabels` | | 스케줄링. |
| `podSecurityContext`, `securityContext` | uid 65532, 읽기 전용 루트, capability 없음 | 보안. `/tmp`는 `emptyDir`입니다. |

차트의 `values.yaml`에 각 키가 문서화되어 있습니다.
