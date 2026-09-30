---
title: Helm チャート
description: deploy/helm/verdin の Helm チャートで Verdin を Kubernetes にインストールします。1 つの Pod でボリューム上の SQLite を使う構成と、外部データベース、S3、共有イベントバスを使う複数レプリカの構成を説明します。
sidebar:
  order: 7
---

[`deploy/helm/verdin`](https://github.com/verdin-cms/verdin/tree/main/deploy/helm/verdin) のチャートは、[Kubernetes](/ja/deploy/kubernetes/) のマニフェストをパッケージしたものです。プローブ付きの Deployment、Service、任意の Ingress、`/data` 用の PersistentVolumeClaim、サーバーのシークレットを持つ Secret が含まれます。チャートのリポジトリにはまだ公開されていないので、リポジトリのクローンからインストールしてください。

チャートは 2026-09-30 に `helm lint --strict` と `helm template`（Helm 3）で確認しましたが、実際のクラスターにはインストールしていません。

## SQLite を使う 1 つの Pod

デフォルトでは、1 つのレプリカが、`/data` にマウントした 5 GiB のボリューム上の SQLite、アップロード、画像キャッシュ、検索インデックスを使って動きます。

```sh frame="terminal"
git clone --depth 1 https://github.com/verdin-cms/verdin
helm install cms verdin/deploy/helm/verdin \
  --set publicUrl=https://cms.example.com \
  --set ingress.enabled=true --set ingress.hosts[0].host=cms.example.com \
  --set ingress.hosts[0].paths[0].path=/
```

Deployment は `Recreate` 戦略を使うので、2 つの Pod が同じデータベースファイルを開くことはありません。そのため、アップグレードのたびに短いダウンタイムがあります。

## 複数のレプリカ

レプリカを 1 つより多くするには 3 つのものが必要で、チャートはそれらがないとレンダリングを拒否します。

- 外部データベース（`database.url` または `database.existingSecret`。PostgreSQL、MySQL、MariaDB）。
- `cluster.bus: database`。リアルタイムのイベント、プレゼンス、キャッシュの無効化、検索の更新がすべての Pod に届くようにします（[共有イベントバス](/ja/deploy/scaling/#共有イベントバス)を参照）。
- `/data` に ReadWriteOnce のボリュームを使わないこと。メディアは S3 に置いて `persistence.enabled: false` にするか（各 Pod は画像キャッシュと検索インデックスを `emptyDir` に持ちます）、ReadWriteMany のストレージクラスを使います。

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

すべての Pod が `start --migrate` を実行します。マイグレーションはデータベースでロックを取るので、1 回だけ実行されます。risky や destructive なステップは起動時には実行されません。ロールアウトの前に `kubectl exec deploy/cms-verdin -- verdin migrate apply --allow …` で適用してください。スケジュールされたプラグインのジョブは、`plugins.runJobs` が true のすべての Pod で実行されます。[複数のインスタンスの実行](/ja/deploy/scaling/)を参照してください。

## スキーマ

本番のサーバーはスキーマを編集しないので、Pod にはコミット済みのスキーマが必要です。

- **独自のイメージ（推奨）。** `FROM ghcr.io/verdin-cms/verdin:0.11` に `COPY schema /app/schema` を加え、`schema.path: /app/schema` を設定します。こうすると、各イメージがマイグレーションに使ったスキーマをそのまま持ちます。
- **`schema.files`。** スキーマのディレクトリからの相対パスとその JSON で、ConfigMap にレンダリングされ、`/etc/verdin/schema` にマウントされます。

  ```yaml
  schema:
    files:
      content-types/article.json: |
        { "kind": "collectionType", "singularName": "article", … }
  ```

  `helm upgrade … --set-file 'schema.files.content-types/article\.json=schema/content-types/article.json'` で、ディスクからファイルを読み込めます。

どちらもない場合、Pod はボリューム上の `/data/schema` を読みます。

## シークレット

`secrets.existingSecret` が空の場合、チャートは `VERDIN_ADMIN_JWT_SECRET` と `VERDIN_TOKEN_PEPPER`（インストール時にランダムに生成され、アップグレード時は読み戻されて保持されます）に加え、values で渡したデータベースの URL、S3 の認証情報、メトリクスのトークンを持つ Secret を作成します。Secret とボリュームには `helm.sh/resource-policy: keep` が付いています。`helm uninstall` はそれらを残すので、再インストールするとデータが見つかり、API トークンも引き続き使えます。Secret はデータベースと一緒にバックアップしてください。

シークレットを自分で管理する場合（Sealed Secrets、External Secrets、Vault）は、これらのキーを持つ Secret を作成し、`secrets.existingSecret` を設定してください。

## Values

| Value | デフォルト | 内容 |
| --- | --- | --- |
| `image.repository`、`image.tag` | `ghcr.io/verdin-cms/verdin`、チャートの `appVersion` | イメージ。 |
| `replicaCount` | `1` | [複数のレプリカ](#複数のレプリカ)を参照。 |
| `args` | `["start", "--migrate"]` | サーバーのコマンド。 |
| `publicUrl` | | `VERDIN_SERVER__PUBLIC_URL`。 |
| `trustedProxies` | `[]` | `VERDIN_SERVER__TRUSTED_PROXIES`。 |
| `secrets.adminJwtSecret`、`secrets.tokenPepper`、`secrets.existingSecret` | 生成される | [シークレット](#シークレット)を参照。 |
| `database.url`、`database.existingSecret`、`database.existingSecretKey` | `/data` 上の SQLite | データベース。 |
| `cluster.bus`、`cluster.pollIntervalMs` | `none`、`1000` | `[cluster]`。各 Pod の名前が `instance_id` になります。 |
| `s3.*` | 無効 | S3 のアップロードプロバイダー: `bucket`、`region`、`endpoint`、`publicUrl`、`prefix`、`pathStyle`、認証情報または `existingSecret`。 |
| `schema.path`、`schema.files` | | [スキーマ](#スキーマ)を参照。 |
| `configToml` | | `verdin.toml` 全体。`/app/verdin.toml` にマウントされます。チャートの環境変数が引き続き優先されます。 |
| `metrics.enabled`、`metrics.token` | 無効 | `/_metrics` の Prometheus メトリクス。 |
| `plugins.runJobs` | `true` | `[plugins].run_jobs`。 |
| `extraEnv`、`extraEnvFrom` | `[]` | 追加の変数。たとえば `VERDIN_TELEMETRY__ENABLED`。 |
| `persistence.*` | 有効、5Gi、ReadWriteOnce | `/data` のボリューム（`existingClaim`、`storageClass`、`accessModes`、`size`）。 |
| `service.*`、`ingress.*` | ポート 80 の ClusterIP、Ingress なし | ネットワーク。 |
| `probes.*` | | `/_ready` でのスタートアップとレディネス、`/_health` でのライブネス。 |
| `resources`、`nodeSelector`、`tolerations`、`affinity`、`podAnnotations`、`podLabels` | | スケジューリング。 |
| `podSecurityContext`、`securityContext` | uid 65532、読み取り専用のルート、ケイパビリティなし | セキュリティ。`/tmp` は `emptyDir` です。 |

チャートの `values.yaml` に、各キーの説明があります。
