---
title: Kubernetes
description: Exécutez Verdin sur Kubernetes — un Deployment avec des sondes, un Secret et un Service pour PostgreSQL et S3, et une configuration à un seul réplica avec un PersistentVolumeClaim pour SQLite.
sidebar:
  order: 7
---

Cette page exécute un projet Verdin sur Kubernetes. La configuration principale est sans
état : PostgreSQL (ou MySQL/MariaDB) hors des pods, les médias sur un stockage compatible S3,
et autant de réplicas que nécessaire. Une configuration à un seul réplica avec un volume pour
SQLite suit. Le [chart Helm](/fr/deploy/helm/) regroupe ces manifestes avec des valeurs pour
chaque paramètre.

Les manifestes utilisent des API stables (`apps/v1`, `v1`) et ont été validés par rapport aux
schémas Kubernetes avec `kubeconform -strict` le 2026-09-29, sans être exécutés sur un cluster
réel. Remplacez toutes les valeurs entre chevrons.

## 1. Construire votre image

Intégrez votre configuration et votre schéma dans une image basée sur l’image officielle, pour
que chaque version livre le schéma avec lequel elle a été migrée (voir
[Votre propre image](/fr/deploy/docker/)) :

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

Poussez-la dans votre registre sous le nom `<registry>/verdin-site:<version>`.

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

Ou créez-le à partir de la sortie de `verdin secrets` avec
`kubectl create secret generic verdin --from-env-file=…`, et ajoutez les autres.

## 3. Deployment et Service

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

Exposez le Service via votre Ingress ou votre Gateway avec TLS, comme pour tout service HTTP.
Les valeurs de ressources sont un point de départ, pas une mesure.

Remarques sur le manifeste :

- **Migrations.** Chaque réplica exécute `start --migrate`. Les migrations prennent un verrou
  dans la base de données (un advisory lock sur PostgreSQL, `GET_LOCK` sur MySQL/MariaDB) : des
  réplicas qui démarrent ensemble ne les appliquent donc qu’une fois. Les étapes risquées ou
  destructives ne sont jamais appliquées au démarrage : exécutez
  `verdin migrate apply --allow …` dans un Job ponctuel avec la même image avant le déploiement.
- **Système de fichiers racine en lecture seule.** Les téléversements transitent en streaming
  par `/tmp`, qui a donc besoin d’un `emptyDir` accessible en écriture. Le cache de
  transformation d’images et l’index de recherche ont aussi besoin de répertoires accessibles
  en écriture si vous les utilisez (`/tmp/transforms` ci-dessus ; définissez aussi
  `VERDIN_SEARCH__DIR`).
- **Arrêt.** Verdin s’arrête sur `SIGTERM`.
- **Tâches de plugins.** Les tâches planifiées des plugins s’exécutent sur chaque réplica où
  `[plugins].run_jobs` vaut true. Exécutez un Deployment supplémentaire avec `replicas: 1` et
  `VERDIN_PLUGINS__RUN_JOBS=true` (mêmes labels, pour qu’il serve aussi du trafic), ou acceptez
  que les tâches s’exécutent sur chaque réplica. Les webhooks, les releases planifiées et le
  résumé quotidien sont réservés dans la base de données et ne s’exécutent qu’une fois. Voir
  [Exécuter plusieurs instances](/fr/deploy/scaling/).
- **Temps réel, présence, caches et recherche.** `[cluster].bus = "database"` apporte à chaque
  pod les événements des autres (voir [le bus d’événements partagé](/fr/deploy/scaling/#bus-dévénements-partagé)).
  Sans lui, les flux d’événements (`/api/_events`) restent sur le pod auquel ils se
  connectent : utilisez l’affinité de session sur l’Ingress si vous utilisez le
  [temps réel](/fr/guides/frontend/realtime/).

## Un seul réplica avec SQLite

SQLite et les téléversements locaux nécessitent un seul pod et un volume persistant :

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

Ici, `verdin.toml` utilise `provider = { name = "local", dir = "/data/uploads" }`, et la
`VERDIN_DATABASE_URL` du Secret n’est pas nécessaire (l’entrée `env` l’emporte sur
`envFrom`). Un `StatefulSet` avec un réplica et une entrée `volumeClaimTemplates` fonctionne de
la même façon. `Recreate` implique une courte interruption à chaque déploiement.

## Commandes d’administration

Exécutez les commandes CLI dans un pod en cours d’exécution ; l’image n’a pas de shell,
appelez donc le binaire :

```sh frame="terminal"
kubectl exec -it deploy/verdin -- verdin admin create --email you@example.com
kubectl exec deploy/verdin -- verdin migrate plan
```
