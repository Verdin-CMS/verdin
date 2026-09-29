---
title: Kubernetes
description: Draai Verdin op Kubernetes — een Deployment met probes, een Secret en een Service voor PostgreSQL en S3, en een opstelling met één replica en een PersistentVolumeClaim voor SQLite.
sidebar:
  order: 7
---

Deze pagina draait een Verdin-project op Kubernetes. De hoofdopstelling is stateless: PostgreSQL
(of MySQL/MariaDB) buiten de pods, media op S3-compatibele opslag, en zoveel replica's als je
nodig hebt. Daarna volgt een opstelling met één replica en een volume voor SQLite.

De manifesten gebruiken stabiele API's (`apps/v1`, `v1`) en zijn op 2026-09-29 met
`kubeconform -strict` gevalideerd tegen de Kubernetes-schema's, niet op een echt cluster gedraaid.
Vervang elke waarde tussen punthaken.

## 1. Bouw je image

Bak je configuratie en schema in een image op basis van het officiële, zodat elke release het
schema meelevert waarmee hij is gemigreerd (zie [Je eigen image](/nl/deploy/docker/)):

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

Push het naar je registry als `<registry>/verdin-site:<version>`.

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

Of maak hem aan uit de uitvoer van `verdin secrets` met
`kubectl create secret generic verdin --from-env-file=…`, en voeg de andere toe.

## 3. Deployment en Service

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

Stel de Service beschikbaar via je Ingress of Gateway met TLS, zoals bij elke HTTP-service. De
resourcewaarden zijn een startpunt, geen meting.

Opmerkingen bij het manifest:

- **Migraties.** Elke replica draait `start --migrate`. Migraties nemen een lock in de database
  (een advisory lock op PostgreSQL, `GET_LOCK` op MySQL/MariaDB), dus replica's die tegelijk
  starten, passen ze één keer toe. Riskante of destructieve stappen worden bij het starten nooit
  toegepast: draai `verdin migrate apply --allow …` als eenmalige Job met hetzelfde image voordat
  je uitrolt.
- **Alleen-lezen root-bestandssysteem.** Uploads worden via `/tmp` gestreamd, dus die heeft een
  schrijfbare `emptyDir` nodig. De cache voor afbeeldingstransformaties en de zoekindex hebben
  ook schrijfbare mappen nodig als je ze gebruikt (`/tmp/transforms` hierboven; stel ook
  `VERDIN_SEARCH__DIR` in).
- **Afsluiten.** Verdin stopt bij `SIGTERM`.
- **Pluginjobs.** Geplande pluginjobs draaien op elke replica waar `[plugins].run_jobs` true is.
  Draai één extra Deployment met `replicas: 1` en `VERDIN_PLUGINS__RUN_JOBS=true` (dezelfde
  labels, zodat hij ook verkeer bedient), of accepteer dat jobs op elke replica draaien.
  Webhooks, geplande releases en de dagelijkse samenvatting worden in de database geclaimd en
  draaien één keer. Zie [Meerdere instanties draaien](/nl/deploy/scaling/).
- **Realtime.** Eventstreams (`/api/_events`) blijven op de pod waarmee ze verbinden. Gebruik
  session affinity op de Ingress als je [realtime](/nl/guides/frontend/realtime/) gebruikt.

## Eén replica met SQLite

SQLite en lokale uploads hebben één pod en een persistent volume nodig:

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

Hier gebruikt `verdin.toml` `provider = { name = "local", dir = "/data/uploads" }`, en is de
`VERDIN_DATABASE_URL` in het Secret niet nodig (de `env`-regel wint van `envFrom`). Een
`StatefulSet` met één replica en een `volumeClaimTemplates`-regel werkt op dezelfde manier.
`Recreate` betekent een korte downtime bij elke uitrol.

## Beheercommando's

Draai CLI-commando's in een draaiende pod; het image heeft geen shell, dus roep de binary aan:

```sh frame="terminal"
kubectl exec -it deploy/verdin -- verdin admin create --email you@example.com
kubectl exec deploy/verdin -- verdin migrate plan
```
