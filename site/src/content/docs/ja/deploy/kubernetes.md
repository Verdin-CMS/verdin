---
title: Kubernetes
description: Kubernetes で Verdin を実行します。PostgreSQL と S3 を使うプローブ付きの Deployment、Secret、Service と、SQLite 用に PersistentVolumeClaim を使う 1 レプリカの構成を紹介します。
sidebar:
  order: 7
---

このページでは、Verdin のプロジェクトを Kubernetes で実行します。主な構成はステートレスです。PostgreSQL（または MySQL/MariaDB）は Pod の外に置き、メディアは S3 互換ストレージに置き、レプリカは必要なだけ増やせます。その後に、SQLite 用のボリュームを使う 1 レプリカの構成を紹介します。[Helm チャート](/ja/deploy/helm/)は、これらのマニフェストを、設定ごとの values とともにパッケージしたものです。

マニフェストは安定版の API（`apps/v1`、`v1`）を使い、2026-09-29 に `kubeconform -strict` で Kubernetes のスキーマと照合しましたが、実際のクラスターでは動かしていません。山かっこ内の値はすべて置き換えてください。

## 1. イメージをビルドする

各リリースが、マイグレーションに使ったスキーマをそのまま届けられるように、設定とスキーマを公式イメージをベースにしたイメージに組み込みます（[独自のイメージ](/ja/deploy/docker/)を参照）。

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

`<registry>/verdin-site:<version>` としてレジストリにプッシュします。

## 2. シークレット

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

または、`verdin secrets` の出力から `kubectl create secret generic verdin --from-env-file=…` で作成し、残りを追加します。

## 3. Deployment と Service

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

他の HTTP サービスと同じように、Ingress または Gateway を通じて TLS 付きで Service を公開してください。リソースの数値は出発点であり、計測した値ではありません。

マニフェストについての補足:

- **マイグレーション。** すべてのレプリカが `start --migrate` を実行します。マイグレーションはデータベースでロック（PostgreSQL ではアドバイザリーロック、MySQL/MariaDB では `GET_LOCK`）を取得するので、同時に起動したレプリカでも適用は 1 回だけです。risky や destructive なステップが起動時に適用されることはありません。ロールアウトの前に、同じイメージを使った一回限りの Job として `verdin migrate apply --allow …` を実行してください。
- **読み取り専用のルートファイルシステム。** アップロードは `/tmp` を通じてストリーミングされるので、書き込み可能な `emptyDir` が必要です。画像変換のキャッシュと検索インデックスを使う場合も、書き込み可能なディレクトリが必要です（上の `/tmp/transforms`。`VERDIN_SEARCH__DIR` も設定してください）。
- **シャットダウン。** Verdin は `SIGTERM` で停止します。
- **プラグインのジョブ。** スケジュールされたプラグインのジョブは、`[plugins].run_jobs` が true のすべてのレプリカで実行されます。`replicas: 1` と `VERDIN_PLUGINS__RUN_JOBS=true` を持つ Deployment をもう 1 つ実行する（同じラベルなのでトラフィックも処理します）か、各レプリカでジョブが実行されることを受け入れてください。Webhook、予約されたリリース、日次ダイジェストはデータベースで担当が決まり、1 回だけ実行されます。[複数のインスタンスの実行](/ja/deploy/scaling/)を参照してください。
- **リアルタイム、プレゼンス、キャッシュ、検索。** `[cluster].bus = "database"` を設定すると、各 Pod に他の Pod のイベントが届きます（[共有イベントバス](/ja/deploy/scaling/#共有イベントバス)を参照）。設定しない場合、イベントストリーム（`/api/_events`）は接続先の Pod にとどまります。[リアルタイム](/ja/guides/frontend/realtime/)を使う場合は、Ingress でセッションアフィニティを使ってください。

## SQLite を使う 1 レプリカの構成

SQLite とローカルのアップロードには、1 つの Pod と永続ボリュームが必要です。

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

この場合、`verdin.toml` では `provider = { name = "local", dir = "/data/uploads" }` を使い、Secret の `VERDIN_DATABASE_URL` は不要です（`env` のエントリーが `envFrom` より優先されます）。レプリカが 1 つで `volumeClaimTemplates` のエントリーを持つ `StatefulSet` でも同じように動きます。`Recreate` では、ロールアウトのたびに短いダウンタイムが発生します。

## 管理用コマンド

CLI のコマンドは実行中の Pod で実行します。イメージにはシェルがないので、バイナリを直接呼び出します。

```sh frame="terminal"
kubectl exec -it deploy/verdin -- verdin admin create --email you@example.com
kubectl exec deploy/verdin -- verdin migrate plan
```
