---
title: Kubernetes
description: Executa Verdin a Kubernetes — un Deployment amb sondes, un Secret i un Service per a PostgreSQL i S3, i una configuració d'una sola rèplica amb un PersistentVolumeClaim per a SQLite.
sidebar:
  order: 7
---

Aquesta pàgina executa un projecte Verdin a Kubernetes. La configuració principal no té estat:
PostgreSQL (o MySQL/MariaDB) fora dels pods, multimèdia en un emmagatzematge compatible amb S3 i
tantes rèpliques com necessitis. Després hi ha una configuració d'una sola rèplica amb un volum
per a SQLite. El [gràfic de Helm](/ca/deploy/helm/) empaqueta aquests manifests amb valors
per a cada opció.

Els manifests fan servir API estables (`apps/v1`, `v1`) i s'han validat contra els esquemes de
Kubernetes amb `kubeconform -strict` el 29-09-2026, sense executar-los en un clúster real.
Substitueix tots els valors entre angles.

## 1. Construeix la teva imatge

Incorpora la teva configuració i el teu esquema en una imatge basada en l'oficial, perquè cada
versió porti l'esquema amb què s'ha migrat (consulta [La teva pròpia imatge](/ca/deploy/docker/)):

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
cache_ttl_secs = 60        # buidada a cada rèplica pel bus d'esdeveniments

[cluster]
bus = "database"           # temps real, presència, cachés i cerca entre rèpliques

[metrics]
enabled = true             # token from VERDIN_METRICS_TOKEN

[upload]
provider = { name = "s3", bucket = "<bucket>", region = "<region>",
             public_url = "https://<bucket public URL or CDN>" }

[upload.transforms]
cache_dir = "/tmp/transforms"
```

Puja-la al teu registre com a `<registry>/verdin-site:<version>`.

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

O crea'l a partir de la sortida de `verdin secrets` amb
`kubectl create secret generic verdin --from-env-file=…`, i afegeix-hi els altres.

## 3. Deployment i Service

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

Exposa el Service a través del teu Ingress o Gateway amb TLS, com qualsevol servei HTTP. Les
xifres de recursos són un punt de partida, no una mesura.

Notes sobre el manifest:

- **Migracions.** Cada rèplica executa `start --migrate`. Les migracions agafen un bloqueig a la
  base de dades (un advisory lock a PostgreSQL, `GET_LOCK` a MySQL/MariaDB), de manera que les
  rèpliques que s'inicien alhora les apliquen un sol cop. Els passos arriscats o destructius mai
  no s'apliquen en iniciar: executa `verdin migrate apply --allow …` com un Job puntual amb la
  mateixa imatge abans del desplegament.
- **Sistema de fitxers arrel de només lectura.** Les pujades es transmeten a través de `/tmp`,
  que per tant necessita un `emptyDir` escrivible. La memòria cau de transformació d'imatges i
  l'índex de cerca també necessiten directoris escrivibles si els fas servir (`/tmp/transforms`
  a dalt; defineix també `VERDIN_SEARCH__DIR`).
- **Aturada.** Verdin s'atura amb `SIGTERM`.
- **Tasques de connectors.** Les tasques programades dels connectors s'executen a totes les
  rèpliques on `[plugins].run_jobs` és true. Executa un Deployment addicional amb `replicas: 1` i
  `VERDIN_PLUGINS__RUN_JOBS=true` (amb les mateixes etiquetes, perquè també serveixi trànsit), o
  accepta que les tasques s'executin a cada rèplica. Els webhooks, els llançaments programats i el
  resum diari es reclamen a la base de dades i s'executen un sol cop. Consulta
  [Executar diverses instàncies](/ca/deploy/scaling/).
- **Temps real, presència, cachés i cerca.** `[cluster].bus = "database"` porta a cada pod els
  esdeveniments dels altres (consulta [el bus d'esdeveniments compartit](/ca/deploy/scaling/#bus-desdeveniments-compartit)).
  Sense ell, els fluxos d'esdeveniments (`/api/_events`) es queden al pod on es connecten: fes servir afinitat de sessió a l'Ingress si fas servir el [temps real](/ca/guides/frontend/realtime/).

## Una sola rèplica amb SQLite

SQLite i les pujades locals necessiten un sol pod i un volum persistent:

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

Aquí `verdin.toml` fa servir `provider = { name = "local", dir = "/data/uploads" }`, i la
`VERDIN_DATABASE_URL` del Secret no és necessària (l'entrada `env` té prioritat sobre
`envFrom`). Un `StatefulSet` amb una rèplica i una entrada `volumeClaimTemplates` funciona igual.
`Recreate` implica una breu interrupció a cada desplegament.

## Ordres d'administració

Executa les ordres de la CLI en un pod en execució; la imatge no té shell, així que crida el
binari:

```sh frame="terminal"
kubectl exec -it deploy/verdin -- verdin admin create --email you@example.com
kubectl exec deploy/verdin -- verdin migrate plan
```
