---
title: Kubernetes
description: Verdin’i Kubernetes üzerinde çalıştırın — PostgreSQL ve S3 için probe’lu bir Deployment, bir Secret ve bir Service, SQLite için ise PersistentVolumeClaim içeren tek replikalı bir kurulum.
sidebar:
  order: 7
---

Bu sayfa bir Verdin projesini Kubernetes üzerinde çalıştırır. Ana kurulum durumsuzdur:
pod’ların dışında PostgreSQL (veya MySQL/MariaDB), S3 uyumlu depolamada medya ve ihtiyaç
duyduğunuz kadar replika. Ardından SQLite için volume içeren tek replikalı bir kurulum gelir.
[Helm chart’ı](/tr/deploy/helm/) bu manifest’leri her ayar için değerlerle paketler.

Manifest’ler kararlı API’leri (`apps/v1`, `v1`) kullanır ve 2026-09-29 tarihinde
`kubeconform -strict` ile Kubernetes şemalarına karşı doğrulandı; canlı bir cluster’da
çalıştırılmadı. Köşeli parantez içindeki her değeri değiştirin.

## 1. İmajınızı derleyin

Yapılandırmanızı ve şemanızı resmi imaja dayanan bir imajın içine yerleştirin; böylece her
sürüm migre edildiği şemayı taşır (bkz. [Kendi imajınız](/tr/deploy/docker/)):

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

Onu registry’nize `<registry>/verdin-site:<version>` olarak gönderin.

## 2. Secret’lar

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

Ya da onu `verdin secrets` çıktısından
`kubectl create secret generic verdin --from-env-file=…` ile oluşturun ve diğerlerini ekleyin.

## 3. Deployment ve Service

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

Service’i, herhangi bir HTTP servisinde olduğu gibi Ingress’iniz veya Gateway’iniz üzerinden
TLS ile dışarı açın. Kaynak değerleri bir ölçüm değil, bir başlangıç noktasıdır.

Manifest hakkında notlar:

- **Migrasyonlar.** Her replika `start --migrate` çalıştırır. Migrasyonlar veritabanında bir
  kilit alır (PostgreSQL’de advisory lock, MySQL/MariaDB’de `GET_LOCK`); böylece birlikte
  başlayan replikalar onları bir kez uygular. Riskli veya yıkıcı adımlar başlangıçta asla
  uygulanmaz: rollout’tan önce aynı imajla tek seferlik bir Job olarak
  `verdin migrate apply --allow …` çalıştırın.
- **Salt okunur kök dosya sistemi.** Yüklemeler `/tmp` üzerinden akıtılır, bu yüzden yazılabilir
  bir `emptyDir` gerekir. Kullanıyorsanız görsel dönüştürme önbelleği ve arama dizini de
  yazılabilir dizinler gerektirir (yukarıda `/tmp/transforms`; `VERDIN_SEARCH__DIR`’i de
  ayarlayın).
- **Kapanma.** Verdin `SIGTERM` ile durur.
- **Eklenti görevleri.** Zamanlanmış eklenti görevleri, `[plugins].run_jobs` değerinin true
  olduğu her replikada çalışır. `replicas: 1` ve `VERDIN_PLUGINS__RUN_JOBS=true` ile fazladan
  bir Deployment çalıştırın (aynı etiketlerle, böylece trafik de sunar) ya da görevlerin her
  replikada çalışmasını kabul edin. Webhook’lar, zamanlanmış sürümler ve günlük özet
  veritabanında üstlenilir ve bir kez çalışır. Bkz.
  [Birden fazla örnek çalıştırma](/tr/deploy/scaling/).
- **Gerçek zamanlı, presence, önbellekler ve arama.** `[cluster].bus = "database"` her pod’a
  diğerlerinin olaylarını getirir (bkz. [paylaşılan olay veriyolu](/tr/deploy/scaling/#paylaşılan-olay-veriyolu)).
  Onsuz olay akışları (`/api/_events`) bağlandıkları pod’da kalır:
  [Gerçek zamanlı](/tr/guides/frontend/realtime/) özelliği kullanıyorsanız Ingress’te session
  affinity kullanın.

## SQLite ile tek replika

SQLite ve yerel yüklemeler tek bir pod ve kalıcı bir volume gerektirir:

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

Burada `verdin.toml`, `provider = { name = "local", dir = "/data/uploads" }` kullanır ve
Secret’taki `VERDIN_DATABASE_URL` gerekmez (`env` girdisi `envFrom`’a üstün gelir). Tek replikalı
ve bir `volumeClaimTemplates` girdisi olan bir `StatefulSet` de aynı şekilde çalışır.
`Recreate`, her rollout’ta kısa bir kesinti anlamına gelir.

## Admin komutları

CLI komutlarını çalışan bir pod’da çalıştırın; imajda shell yoktur, bu yüzden ikili dosyayı
çağırın:

```sh frame="terminal"
kubectl exec -it deploy/verdin -- verdin admin create --email you@example.com
kubectl exec deploy/verdin -- verdin migrate plan
```
