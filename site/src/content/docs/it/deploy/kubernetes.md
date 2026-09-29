---
title: Kubernetes
description: Esegui Verdin su Kubernetes — un Deployment con probe, un Secret e un Service per PostgreSQL e S3, e una configurazione a replica singola con un PersistentVolumeClaim per SQLite.
sidebar:
  order: 7
---

Questa pagina esegue un progetto Verdin su Kubernetes. La configurazione principale è
stateless: PostgreSQL (o MySQL/MariaDB) fuori dai pod, i media su uno storage compatibile S3,
e tutte le repliche che ti servono. Segue una configurazione a replica singola con un volume
per SQLite.

I manifest usano API stabili (`apps/v1`, `v1`) e sono stati validati rispetto agli schemi di
Kubernetes con `kubeconform -strict` il 2026-09-29, non eseguiti su un cluster reale.
Sostituisci ogni valore tra parentesi angolari.

## 1. Costruisci la tua immagine

Includi configurazione e schema in un'immagine basata su quella ufficiale, così ogni release
porta lo schema con cui è stata migrata (vedi [La tua immagine](/it/deploy/docker/)):

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
cache_ttl_secs = 5         # short: each replica keeps its own cache

[metrics]
enabled = true             # token from VERDIN_METRICS_TOKEN

[upload]
provider = { name = "s3", bucket = "<bucket>", region = "<region>",
             public_url = "https://<bucket public URL or CDN>" }

[upload.transforms]
cache_dir = "/tmp/transforms"
```

Pubblicala nel tuo registry come `<registry>/verdin-site:<version>`.

## 2. Secret

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

Oppure crealo dall'output di `verdin secrets` con
`kubectl create secret generic verdin --from-env-file=…`, e aggiungi gli altri.

## 3. Deployment e Service

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

Esponi il Service tramite il tuo Ingress o Gateway con TLS, come per qualsiasi servizio
HTTP. I valori delle risorse sono un punto di partenza, non una misurazione.

Note sul manifest:

- **Migrazioni.** Ogni replica esegue `start --migrate`. Le migrazioni prendono un lock nel
  database (un advisory lock su PostgreSQL, `GET_LOCK` su MySQL/MariaDB), quindi le repliche
  che partono insieme le applicano una volta sola. I passaggi rischiosi o distruttivi non
  vengono mai applicati all'avvio: esegui `verdin migrate apply --allow …` come Job una
  tantum con la stessa immagine prima del rollout.
- **Root filesystem in sola lettura.** Gli upload passano da `/tmp`, quindi serve un
  `emptyDir` scrivibile. Anche la cache delle trasformazioni delle immagini e l'indice di
  ricerca richiedono directory scrivibili se li usi (`/tmp/transforms` qui sopra; imposta
  anche `VERDIN_SEARCH__DIR`).
- **Arresto.** Verdin si ferma su `SIGTERM`.
- **Job dei plugin.** I job pianificati dei plugin girano su ogni replica in cui
  `[plugins].run_jobs` è true. Esegui un Deployment in più con `replicas: 1` e
  `VERDIN_PLUGINS__RUN_JOBS=true` (stesse label, così serve anche traffico), oppure accetta
  che i job girino su ogni replica. Webhook, rilasci pianificati e digest giornaliero vengono
  presi in carico nel database ed eseguiti una sola volta. Vedi
  [Eseguire più istanze](/it/deploy/scaling/).
- **Tempo reale.** Gli stream di eventi (`/api/_events`) restano sul pod a cui si
  connettono. Usa la session affinity sull'Ingress se usi il
  [tempo reale](/it/guides/frontend/realtime/).

## Replica singola con SQLite

SQLite e gli upload locali richiedono un solo pod e un volume persistente:

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

Qui `verdin.toml` usa `provider = { name = "local", dir = "/data/uploads" }`, e il
`VERDIN_DATABASE_URL` nel Secret non serve (la voce `env` prevale su `envFrom`). Uno
`StatefulSet` con una replica e una voce `volumeClaimTemplates` funziona allo stesso modo.
`Recreate` significa un breve downtime a ogni rollout.

## Comandi di amministrazione

Esegui i comandi della CLI in un pod in esecuzione; l'immagine non ha shell, quindi chiama
il binario:

```sh frame="terminal"
kubectl exec -it deploy/verdin -- verdin admin create --email you@example.com
kubectl exec deploy/verdin -- verdin migrate plan
```
