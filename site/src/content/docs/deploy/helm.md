---
title: Helm chart
description: Install Verdin on Kubernetes with the Helm chart in deploy/helm/verdin — SQLite on a volume for one pod, or several replicas with an external database, S3 and the shared event bus.
sidebar:
  order: 7
---

The chart in [`deploy/helm/verdin`](https://github.com/verdin-cms/verdin/tree/main/deploy/helm/verdin)
packages the manifests of [Kubernetes](/deploy/kubernetes/): a Deployment with probes, a
Service, an optional Ingress, a PersistentVolumeClaim for `/data` and a Secret with the
server secrets. It is not published to a chart repository yet; install it from a clone of
the repository.

The chart was checked with `helm lint --strict` and `helm template` (Helm 3) on
2026-09-30, not installed on a live cluster.

## One pod with SQLite

The defaults run one replica with SQLite, uploads, the image cache and the search index
on a 5 GiB volume mounted at `/data`:

```sh frame="terminal"
git clone --depth 1 https://github.com/verdin-cms/verdin
helm install cms verdin/deploy/helm/verdin \
  --set publicUrl=https://cms.example.com \
  --set ingress.enabled=true --set ingress.hosts[0].host=cms.example.com \
  --set ingress.hosts[0].paths[0].path=/
```

The Deployment uses the `Recreate` strategy, so two pods never open the same database
file; each upgrade has a short downtime.

## Several replicas

More than one replica needs three things, and the chart refuses to render without them:

- an external database (`database.url` or `database.existingSecret`: PostgreSQL, MySQL
  or MariaDB);
- `cluster.bus: database`, so realtime events, presence, cache invalidation and search
  updates reach every pod (see [the shared event bus](/deploy/scaling/#shared-event-bus));
- no ReadWriteOnce volume on `/data`: media on S3 with `persistence.enabled: false`
  (each pod then keeps its image cache and search index in an `emptyDir`), or a
  ReadWriteMany storage class.

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

Every pod runs `start --migrate`; migrations take a lock in the database, so they run
once. Risky or destructive steps never run on start: apply them with
`kubectl exec deploy/cms-verdin -- verdin migrate apply --allow …` before you roll out.
Scheduled plugin jobs run on every pod where `plugins.runJobs` is true; see
[Running several instances](/deploy/scaling/).

## The schema

Production servers do not edit the schema, so the pods need your committed schema:

- **Your own image (recommended).** `FROM ghcr.io/verdin-cms/verdin:0.11` plus
  `COPY schema /app/schema`, and `schema.path: /app/schema`. Each image then carries the
  schema it was migrated with.
- **`schema.files`.** Paths relative to the schema directory and their JSON, rendered
  into a ConfigMap and mounted at `/etc/verdin/schema`:

  ```yaml
  schema:
    files:
      content-types/article.json: |
        { "kind": "collectionType", "singularName": "article", … }
  ```

  `helm upgrade … --set-file 'schema.files.content-types/article\.json=schema/content-types/article.json'`
  reads a file from disk.

Without either, the pods read `/data/schema` on the volume.

## Secrets

With `secrets.existingSecret` empty, the chart creates a Secret with
`VERDIN_ADMIN_JWT_SECRET` and `VERDIN_TOKEN_PEPPER` (random on install, read back and
kept on upgrades), plus the database URL, S3 credentials and metrics token you pass in
values. The Secret and the volume have `helm.sh/resource-policy: keep`: `helm uninstall`
leaves them, so a reinstall finds its data and API tokens still work. Back up the Secret
with your database.

To manage secrets yourself (Sealed Secrets, External Secrets, Vault), create a Secret
with those keys and set `secrets.existingSecret`.

## Values

| Value | Default | What |
| --- | --- | --- |
| `image.repository`, `image.tag` | `ghcr.io/verdin-cms/verdin`, the chart's `appVersion` | The image. |
| `replicaCount` | `1` | See [Several replicas](#several-replicas). |
| `args` | `["start", "--migrate"]` | The server's command. |
| `publicUrl` | | `VERDIN_SERVER__PUBLIC_URL`. |
| `trustedProxies` | `[]` | `VERDIN_SERVER__TRUSTED_PROXIES`. |
| `secrets.adminJwtSecret`, `secrets.tokenPepper`, `secrets.existingSecret` | generated | See [Secrets](#secrets). |
| `database.url`, `database.existingSecret`, `database.existingSecretKey` | SQLite on `/data` | The database. |
| `cluster.bus`, `cluster.pollIntervalMs` | `none`, `1000` | `[cluster]`. Each pod's name is its `instance_id`. |
| `s3.*` | disabled | The S3 upload provider: `bucket`, `region`, `endpoint`, `publicUrl`, `prefix`, `pathStyle`, credentials or `existingSecret`. |
| `schema.path`, `schema.files` | | See [The schema](#the-schema). |
| `configToml` | | A whole `verdin.toml`, mounted at `/app/verdin.toml`. The chart's environment variables still win. |
| `metrics.enabled`, `metrics.token` | disabled | Prometheus metrics at `/_metrics`. |
| `plugins.runJobs` | `true` | `[plugins].run_jobs`. |
| `extraEnv`, `extraEnvFrom` | `[]` | More variables, e.g. `VERDIN_TELEMETRY__ENABLED`. |
| `persistence.*` | enabled, 5Gi, ReadWriteOnce | The `/data` volume (`existingClaim`, `storageClass`, `accessModes`, `size`). |
| `service.*`, `ingress.*` | ClusterIP on port 80, no Ingress | Networking. |
| `probes.*` | | Startup and readiness on `/_ready`, liveness on `/_health`. |
| `resources`, `nodeSelector`, `tolerations`, `affinity`, `podAnnotations`, `podLabels` | | Scheduling. |
| `podSecurityContext`, `securityContext` | uid 65532, read-only root, no capabilities | Security. `/tmp` is an `emptyDir`. |

`values.yaml` in the chart documents each key.
