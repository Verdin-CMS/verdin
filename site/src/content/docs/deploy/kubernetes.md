---
title: Kubernetes
description: Run Verdin on Kubernetes — a Deployment with probes, a Secret and a Service for PostgreSQL and S3, and a single-replica setup with a PersistentVolumeClaim for SQLite.
sidebar:
  order: 7
---

This page runs a Verdin project on Kubernetes. The main setup is stateless: PostgreSQL
(or MySQL/MariaDB) outside the pods, media on S3-compatible storage, and as many
replicas as you need. A single-replica setup with a volume for SQLite follows.

The manifests use stable APIs (`apps/v1`, `v1`) and were validated against the
Kubernetes schemas with `kubeconform -strict` on 2026-09-29, not run on a live cluster. Replace every value in
angle brackets.

## 1. Build your image

Bake your configuration and schema into an image based on the official one, so that
each release ships the schema it was migrated with (see
[Your own image](/deploy/docker/)):

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

Push it to your registry as `<registry>/verdin-site:<version>`.

## 2. Secrets

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

Or create it from the output of `verdin secrets` with
`kubectl create secret generic verdin --from-env-file=…`, and add the others.

## 3. Deployment and Service

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

Expose the Service through your Ingress or Gateway with TLS, as for any HTTP service.
The resource numbers are a starting point, not a measurement.

Notes on the manifest:

- **Migrations.** Every replica runs `start --migrate`. Migrations take a lock in the
  database (an advisory lock on PostgreSQL, `GET_LOCK` on MySQL/MariaDB), so replicas
  that start together apply them once. Risky or destructive steps are never applied on
  start: run `verdin migrate apply --allow …` as a one-off Job with the same image
  before you roll out.
- **Read-only root filesystem.** Uploads are streamed through `/tmp`, so it needs a
  writable `emptyDir`. The image-transformation cache and the search index also need
  writable directories if you use them (`/tmp/transforms` above; set
  `VERDIN_SEARCH__DIR` too).
- **Shutdown.** Verdin stops on `SIGTERM`.
- **Plugin jobs.** Scheduled plugin jobs run on every replica where
  `[plugins].run_jobs` is true. Run one extra Deployment with `replicas: 1` and
  `VERDIN_PLUGINS__RUN_JOBS=true` (same labels, so it also serves traffic), or accept
  that jobs run on each replica. Webhooks, scheduled releases and the daily digest are
  claimed in the database and run once. See [Running several instances](/deploy/scaling/).
- **Realtime, presence, caches and search.** `[cluster].bus = "database"` brings every
  pod the others' events (see [the shared event bus](/deploy/scaling/#shared-event-bus)).
  Without it, event streams (`/api/_events`) stay on the pod they connect to: use
  session affinity on the Ingress if you use [realtime](/guides/frontend/realtime/).

## Single replica with SQLite

SQLite and local uploads need one pod and a persistent volume:

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

Here `verdin.toml` uses `provider = { name = "local", dir = "/data/uploads" }`, and the
`VERDIN_DATABASE_URL` in the Secret is not needed (the `env` entry wins over
`envFrom`). A `StatefulSet` with one replica and a `volumeClaimTemplates` entry works
the same way. `Recreate` means a short downtime on each rollout.

## Admin commands

Run CLI commands in a running pod; the image has no shell, so call the binary:

```sh frame="terminal"
kubectl exec -it deploy/verdin -- verdin admin create --email you@example.com
kubectl exec deploy/verdin -- verdin migrate plan
```
