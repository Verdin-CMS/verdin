---
title: Kubernetes
description: Ejecuta Verdin en Kubernetes — un Deployment con probes, un Secret y un Service para PostgreSQL y S3, y una configuración de una sola réplica con un PersistentVolumeClaim para SQLite.
sidebar:
  order: 7
---

Esta página ejecuta un proyecto de Verdin en Kubernetes. La configuración principal no tiene
estado: PostgreSQL (o MySQL/MariaDB) fuera de los pods, los medios en un almacenamiento
compatible con S3 y tantas réplicas como necesites. Después viene una configuración de una sola
réplica con un volumen para SQLite.

Los manifiestos usan APIs estables (`apps/v1`, `v1`) y se validaron contra los esquemas de
Kubernetes con `kubeconform -strict` el 2026-09-29, pero no se han ejecutado en un clúster
real. Sustituye todos los valores entre signos de menor y mayor.

## 1. Construye tu imagen

Incluye tu configuración y tu esquema en una imagen basada en la oficial, para que cada versión
lleve el esquema con el que se migró (consulta [Tu propia imagen](/es/deploy/docker/)):

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

Súbela a tu registro como `<registry>/verdin-site:<version>`.

## 2. Secretos

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

O créalo a partir de la salida de `verdin secrets` con
`kubectl create secret generic verdin --from-env-file=…`, y añade los demás.

## 3. Deployment y Service

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

Expón el Service a través de tu Ingress o Gateway con TLS, como cualquier servicio HTTP. Las
cifras de recursos son un punto de partida, no una medición.

Notas sobre el manifiesto:

- **Migraciones.** Cada réplica ejecuta `start --migrate`. Las migraciones toman un bloqueo en
  la base de datos (un advisory lock en PostgreSQL, `GET_LOCK` en MySQL/MariaDB), así que las
  réplicas que arrancan a la vez las aplican una sola vez. Los pasos arriesgados o destructivos
  nunca se aplican al arrancar: ejecuta `verdin migrate apply --allow …` como un Job puntual
  con la misma imagen antes del despliegue.
- **Sistema de archivos raíz de solo lectura.** Las subidas pasan en streaming por `/tmp`, así
  que necesita un `emptyDir` con escritura. La caché de transformación de imágenes y el índice
  de búsqueda también necesitan directorios con escritura si los usas (`/tmp/transforms` arriba;
  define también `VERDIN_SEARCH__DIR`).
- **Parada.** Verdin se detiene con `SIGTERM`.
- **Tareas de plugins.** Las tareas programadas de los plugins se ejecutan en todas las réplicas
  donde `[plugins].run_jobs` es true. Ejecuta un Deployment adicional con `replicas: 1` y
  `VERDIN_PLUGINS__RUN_JOBS=true` (con las mismas etiquetas, para que también sirva tráfico), o
  acepta que las tareas se ejecuten en cada réplica. Los webhooks, los lanzamientos programados
  y el resumen diario se reclaman en la base de datos y se ejecutan una sola vez. Consulta
  [Ejecutar varias instancias](/es/deploy/scaling/).
- **Tiempo real.** Los flujos de eventos (`/api/_events`) se quedan en el pod al que se
  conectan. Usa afinidad de sesión en el Ingress si usas el
  [tiempo real](/es/guides/frontend/realtime/).

## Una sola réplica con SQLite

SQLite y las subidas locales necesitan un solo pod y un volumen persistente:

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

Aquí `verdin.toml` usa `provider = { name = "local", dir = "/data/uploads" }`, y el
`VERDIN_DATABASE_URL` del Secret no hace falta (la entrada de `env` tiene prioridad sobre
`envFrom`). Un `StatefulSet` con una réplica y una entrada `volumeClaimTemplates` funciona igual.
`Recreate` implica una breve interrupción del servicio en cada despliegue.

## Comandos de administración

Ejecuta los comandos de la CLI en un pod en marcha; la imagen no tiene shell, así que llama al
binario:

```sh frame="terminal"
kubectl exec -it deploy/verdin -- verdin admin create --email you@example.com
kubectl exec deploy/verdin -- verdin migrate plan
```
