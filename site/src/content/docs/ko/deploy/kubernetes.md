---
title: Kubernetes
description: Kubernetes에서 Verdin 실행하기 — PostgreSQL과 S3를 쓰는 프로브, Secret, Service를 갖춘 Deployment, 그리고 SQLite용 PersistentVolumeClaim을 쓰는 단일 레플리카 구성.
sidebar:
  order: 7
---

이 페이지에서는 Kubernetes에서 Verdin 프로젝트를 실행합니다. 주 구성은 상태가 없습니다. PostgreSQL(또는
MySQL/MariaDB)은 파드 밖에, 미디어는 S3 호환 스토리지에 두며, 레플리카는 필요한 만큼 둡니다. SQLite용
볼륨을 쓰는 단일 레플리카 구성은 뒤에 나옵니다. [Helm 차트](/ko/deploy/helm/)는 이 매니페스트를 묶고 각 설정을
값으로 제공합니다.

매니페스트는 안정 API(`apps/v1`, `v1`)를 쓰며, 2026-09-29에 `kubeconform -strict`로 Kubernetes 스키마와
대조해 검증했지만 실제 클러스터에서 실행해 보지는 않았습니다. 꺾쇠괄호 안의 값은 모두 바꾸세요.

## 1. 이미지 빌드

설정과 스키마를 공식 이미지 기반 이미지에 넣어, 릴리스마다 마이그레이션한 스키마가 함께 배포되게 합니다
([자체 이미지](/ko/deploy/docker/) 참고).

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337
public_url = "https://cms.example.com"
trusted_proxies = ["<pod CIDR of your ingress controller, e.g. 10.0.0.0/8>"]

[schema]
path = "schema"

[log]
format = "json"

[api]
cache_ttl_secs = 60        # emptied on every replica by the event bus

[cluster]
bus = "database"           # realtime, presence, caches and search across replicas

[metrics]
enabled = true             # token from VERDIN_METRICS_TOKEN

[upload]
provider = { name = "s3", bucket = "<bucket>", region = "<region>",
             public_url = "https://<bucket public URL or CDN>" }

[upload.transforms]
cache_dir = "/tmp/transforms"
```

레지스트리에 `<registry>/verdin-site:<version>`으로 푸시하세요.

## 2. 시크릿

```yaml title="secret.yaml"
apiVersion: v1
kind: Secret
metadata:
  name: verdin
type: Opaque
stringData:
  VERDIN_ADMIN_JWT_SECRET: "<from verdin secrets>"
  VERDIN_TOKEN_PEPPER: "<from verdin secrets>"
  VERDIN_DATABASE_URL: "postgres://<user>:<password>@<host>:5432/<db>"
  VERDIN_METRICS_TOKEN: "<random token>"
  AWS_ACCESS_KEY_ID: "<key>"
  AWS_SECRET_ACCESS_KEY: "<secret>"
```

또는 `verdin secrets`의 출력으로 `kubectl create secret generic verdin --from-env-file=…`를 실행해 만들고
나머지를 추가하세요.

## 3. Deployment와 Service

```yaml title="verdin.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: verdin
spec:
  replicas: 2
  selector:
    matchLabels: { app: verdin }
  template:
    metadata:
      labels: { app: verdin }
    spec:
      terminationGracePeriodSeconds: 30
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
      containers:
        - name: verdin
          image: <registry>/verdin-site:<version>
          args: ["start", "--migrate"]
          ports:
            - { name: http, containerPort: 1337 }
          envFrom:
            - secretRef: { name: verdin }
          env:
            # Scheduled plugin jobs on one replica only (see below).
            - { name: VERDIN_PLUGINS__RUN_JOBS, value: "false" }
          startupProbe:
            httpGet: { path: /_ready, port: http }
            periodSeconds: 5
            failureThreshold: 60        # up to 5 minutes for migrations
          readinessProbe:
            httpGet: { path: /_ready, port: http }
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /_health, port: http }
            periodSeconds: 20
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits: { memory: 1Gi }
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          volumeMounts:
            - { name: tmp, mountPath: /tmp }
      volumes:
        - name: tmp
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: verdin
spec:
  selector: { app: verdin }
  ports:
    - { name: http, port: 80, targetPort: http }
```

다른 HTTP 서비스와 마찬가지로 Ingress나 Gateway를 통해 TLS로 Service를 노출하세요. 리소스 수치는 측정값이
아니라 출발점입니다.

매니페스트에 대한 참고 사항:

- **마이그레이션.** 모든 레플리카가 `start --migrate`를 실행합니다. 마이그레이션은 데이터베이스에서 잠금을
  잡으므로(PostgreSQL은 advisory lock, MySQL/MariaDB는 `GET_LOCK`), 함께 시작한 레플리카도 한 번만
  적용합니다. risky나 destructive 단계는 시작할 때 절대 적용되지 않습니다. 롤아웃 전에 같은 이미지로
  `verdin migrate apply --allow …`를 일회성 Job으로 실행하세요.
- **읽기 전용 루트 파일 시스템.** 업로드는 `/tmp`를 거쳐 스트리밍되므로 쓰기 가능한 `emptyDir`가 필요합니다.
  이미지 변환 캐시와 검색 인덱스를 쓴다면 이들에도 쓰기 가능한 디렉터리가 필요합니다(위의 `/tmp/transforms`.
  `VERDIN_SEARCH__DIR`도 설정하세요).
- **종료.** Verdin은 `SIGTERM`을 받으면 멈춥니다.
- **플러그인 작업.** 예약된 플러그인 작업은 `[plugins].run_jobs`가 true인 모든 레플리카에서 실행됩니다.
  `replicas: 1`과 `VERDIN_PLUGINS__RUN_JOBS=true`를 가진 Deployment를 하나 더 실행하거나(같은 라벨이므로
  트래픽도 처리함), 작업이 레플리카마다 실행되는 것을 받아들이세요. 웹훅, 예약된 릴리스, 일일 다이제스트는
  데이터베이스에서 가져가므로 한 번만 실행됩니다. [여러 인스턴스 실행](/ko/deploy/scaling/)을 참고하세요.
- **실시간, 프레즌스, 캐시, 검색.** `[cluster].bus = "database"`는 모든 파드에 다른 파드의 이벤트를 전달합니다
  ([공유 이벤트 버스](/ko/deploy/scaling/#공유-이벤트-버스) 참고). 이것이 없으면 이벤트 스트림(`/api/_events`)은
  연결된 파드에 머뭅니다. [실시간](/ko/guides/frontend/realtime/)을 쓴다면 Ingress에서 세션 어피니티를 쓰세요.

## SQLite를 쓰는 단일 레플리카

SQLite와 로컬 업로드에는 파드 하나와 영구 볼륨이 필요합니다.

```yaml title="verdin-sqlite.yaml"
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: verdin-data
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests: { storage: 5Gi }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: verdin
spec:
  replicas: 1
  strategy:
    type: Recreate              # never two pods on the same database file
  selector:
    matchLabels: { app: verdin }
  template:
    metadata:
      labels: { app: verdin }
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
        fsGroup: 65532          # lets the server write to the volume
      containers:
        - name: verdin
          image: <registry>/verdin-site:<version>
          ports:
            - { name: http, containerPort: 1337 }
          envFrom:
            - secretRef: { name: verdin }
          env:
            - { name: VERDIN_DATABASE_URL, value: "sqlite:///data/verdin.db" }
          readinessProbe:
            httpGet: { path: /_ready, port: http }
          livenessProbe:
            httpGet: { path: /_health, port: http }
          volumeMounts:
            - { name: data, mountPath: /data }
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: verdin-data }
```

여기서 `verdin.toml`은 `provider = { name = "local", dir = "/data/uploads" }`를 쓰며, Secret의
`VERDIN_DATABASE_URL`은 필요 없습니다(`env` 항목이 `envFrom`보다 우선합니다). 레플리카 하나와
`volumeClaimTemplates` 항목을 가진 `StatefulSet`도 똑같이 동작합니다. `Recreate`는 롤아웃마다 짧은
다운타임이 있다는 뜻입니다.

## 관리 명령

실행 중인 파드에서 CLI 명령을 실행합니다. 이미지에는 셸이 없으므로 바이너리를 호출하세요.

```sh frame="terminal"
kubectl exec -it deploy/verdin -- verdin admin create --email you@example.com
kubectl exec deploy/verdin -- verdin migrate plan
```
