---
title: Kubernetes
description: Verdin auf Kubernetes betreiben – ein Deployment mit Probes, ein Secret und ein Service für PostgreSQL und S3 sowie ein Setup mit einer Replica und einem PersistentVolumeClaim für SQLite.
sidebar:
  order: 7
---

Diese Seite betreibt ein Verdin-Projekt auf Kubernetes. Das Haupt-Setup ist zustandslos:
PostgreSQL (oder MySQL/MariaDB) außerhalb der Pods, Medien auf S3-kompatiblem Speicher und so
viele Replicas, wie du brauchst. Danach folgt ein Setup mit einer Replica und einem Volume für
SQLite. Das [Helm-Chart](/de/deploy/helm/) verpackt diese Manifeste mit Werten für jede
Einstellung.

Die Manifeste nutzen stabile APIs (`apps/v1`, `v1`) und wurden am 29.09.2026 mit
`kubeconform -strict` gegen die Kubernetes-Schemas validiert, aber nicht auf einem echten
Cluster ausgeführt. Ersetze jeden Wert in spitzen Klammern.

## 1. Dein Image bauen

Back deine Konfiguration und dein Schema in ein Image auf Basis des offiziellen ein, damit jedes
Release das Schema mitbringt, mit dem migriert wurde (siehe
[Ein eigenes Image](/de/deploy/docker/)):

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

Push es als `<registry>/verdin-site:<version>` in deine Registry.

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

Oder leg es aus der Ausgabe von `verdin secrets` mit
`kubectl create secret generic verdin --from-env-file=…` an und ergänze die übrigen Werte.

## 3. Deployment und Service

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

Stell den Service wie jeden HTTP-Dienst über dein Ingress oder Gateway mit TLS bereit. Die
Ressourcenwerte sind ein Ausgangspunkt, keine Messung.

Hinweise zum Manifest:

- **Migrationen.** Jede Replica führt `start --migrate` aus. Migrationen nehmen eine Sperre in
  der Datenbank (ein Advisory Lock auf PostgreSQL, `GET_LOCK` auf MySQL/MariaDB), sodass
  gleichzeitig startende Replicas sie nur einmal anwenden. Riskante oder destruktive Schritte
  werden beim Start nie angewendet: Führe `verdin migrate apply --allow …` vor dem Rollout als
  einmaligen Job mit demselben Image aus.
- **Schreibgeschütztes Root-Dateisystem.** Uploads werden über `/tmp` gestreamt, das daher ein
  beschreibbares `emptyDir` braucht. Auch der Cache für Bildtransformationen und der Suchindex
  brauchen beschreibbare Verzeichnisse, wenn du sie nutzt (`/tmp/transforms` oben; setze auch
  `VERDIN_SEARCH__DIR`).
- **Herunterfahren.** Verdin beendet sich bei `SIGTERM`.
- **Plugin-Jobs.** Geplante Plugin-Jobs laufen auf jeder Replica, auf der
  `[plugins].run_jobs` true ist. Betreibe ein zusätzliches Deployment mit `replicas: 1` und
  `VERDIN_PLUGINS__RUN_JOBS=true` (mit denselben Labels, damit es auch Traffic bedient), oder
  akzeptiere, dass Jobs auf jeder Replica laufen. Webhooks, geplante Releases und der tägliche
  Digest werden in der Datenbank beansprucht und laufen einmal. Siehe
  [Mehrere Instanzen betreiben](/de/deploy/scaling/).
- **Echtzeit, Präsenz, Caches und Suche.** `[cluster].bus = "database"` bringt jedem Pod die
  Events der anderen (siehe [den gemeinsamen Event-Bus](/de/deploy/scaling/#gemeinsamer-event-bus)).
  Ohne ihn bleiben Event-Streams (`/api/_events`) auf dem Pod, mit dem sie verbunden sind: Nutze
  Session Affinity am Ingress, wenn du [Echtzeit](/de/guides/frontend/realtime/) verwendest.

## Eine Replica mit SQLite

SQLite und lokale Uploads brauchen einen Pod und ein persistentes Volume:

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

Hier verwendet `verdin.toml` `provider = { name = "local", dir = "/data/uploads" }`, und die
`VERDIN_DATABASE_URL` im Secret wird nicht gebraucht (der Eintrag unter `env` hat Vorrang vor
`envFrom`). Ein `StatefulSet` mit einer Replica und einem Eintrag in `volumeClaimTemplates`
funktioniert genauso. `Recreate` bedeutet eine kurze Ausfallzeit bei jedem Rollout.

## Admin-Befehle

Führe CLI-Befehle in einem laufenden Pod aus; das Image hat keine Shell, ruf also die
Binärdatei auf:

```sh frame="terminal"
kubectl exec -it deploy/verdin -- verdin admin create --email you@example.com
kubectl exec deploy/verdin -- verdin migrate plan
```
