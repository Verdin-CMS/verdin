---
title: Kubernetes
description: Uruchamiaj Verdin na Kubernetes — Deployment z sondami, Secret i Service dla PostgreSQL i S3 oraz konfiguracja z jedną repliką i PersistentVolumeClaim dla SQLite.
sidebar:
  order: 7
---

Ta strona uruchamia projekt Verdin na Kubernetes. Główna konfiguracja jest bezstanowa:
PostgreSQL (lub MySQL/MariaDB) poza podami, multimedia w magazynie zgodnym z S3 i tyle
replik, ile potrzebujesz. Dalej opisana jest konfiguracja z jedną repliką i wolumenem dla
SQLite. [Chart Helm](/pl/deploy/helm/) pakuje te manifesty z wartościami dla każdego
ustawienia.

Manifesty używają stabilnych API (`apps/v1`, `v1`) i zostały zwalidowane względem schematów
Kubernetes przez `kubeconform -strict` 2026-09-29, bez uruchamiania na prawdziwym klastrze.
Zastąp każdą wartość w nawiasach ostrych.

## 1. Zbuduj obraz

Wbuduj konfigurację i schemat w obraz oparty na oficjalnym, aby każde wydanie dostarczało
schemat, z którym zostało zmigrowane (zobacz [Własny obraz](/pl/deploy/docker/)):

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

Wypchnij go do swojego rejestru jako `<registry>/verdin-site:<version>`.

## 2. Sekrety

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

Albo utwórz go z wyniku `verdin secrets` przez
`kubectl create secret generic verdin --from-env-file=…` i dodaj pozostałe.

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

Wystaw Service przez swój Ingress lub Gateway z TLS, jak każdą usługę HTTP. Wartości zasobów
to punkt wyjścia, a nie wynik pomiaru.

Uwagi do manifestu:

- **Migracje.** Każda replika uruchamia `start --migrate`. Migracje zakładają blokadę
  w bazie danych (advisory lock w PostgreSQL, `GET_LOCK` w MySQL/MariaDB), więc repliki
  startujące jednocześnie stosują je raz. Ryzykowne lub destrukcyjne kroki nigdy nie są
  stosowane przy starcie: przed wdrożeniem uruchom `verdin migrate apply --allow …` jako
  jednorazowy Job z tym samym obrazem.
- **System plików root tylko do odczytu.** Przesyłane pliki są strumieniowane przez `/tmp`,
  więc potrzebuje on zapisywalnego `emptyDir`. Cache transformacji obrazów i indeks
  wyszukiwania też wymagają zapisywalnych katalogów, jeśli ich używasz (`/tmp/transforms`
  powyżej; ustaw też `VERDIN_SEARCH__DIR`).
- **Zamykanie.** Verdin zatrzymuje się po `SIGTERM`.
- **Zadania wtyczek.** Zaplanowane zadania wtyczek działają na każdej replice, na której
  `[plugins].run_jobs` ma wartość true. Uruchom jeden dodatkowy Deployment z `replicas: 1`
  i `VERDIN_PLUGINS__RUN_JOBS=true` (z tymi samymi etykietami, więc też obsługuje ruch) albo
  zaakceptuj, że zadania działają na każdej replice. Webhooki, zaplanowane wydania
  i codzienne podsumowanie są przejmowane w bazie danych i wykonują się raz. Zobacz
  [Uruchamianie kilku instancji](/pl/deploy/scaling/).
- **Czas rzeczywisty, obecność, cache i wyszukiwanie.** `[cluster].bus = "database"` dostarcza
  każdemu podowi zdarzenia pozostałych (zobacz
  [wspólną szynę zdarzeń](/pl/deploy/scaling/#wspólna-szyna-zdarzeń)). Bez niej strumienie
  zdarzeń (`/api/_events`) zostają na podzie, z którym się połączyły: jeśli używasz
  [czasu rzeczywistego](/pl/guides/frontend/realtime/), włącz session affinity na Ingressie.

## Jedna replika z SQLite

SQLite i lokalne przesłane pliki wymagają jednego poda i trwałego wolumenu:

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

Tutaj `verdin.toml` używa `provider = { name = "local", dir = "/data/uploads" }`,
a `VERDIN_DATABASE_URL` w Secret nie jest potrzebny (wpis `env` ma pierwszeństwo przed
`envFrom`). `StatefulSet` z jedną repliką i wpisem `volumeClaimTemplates` działa tak samo.
`Recreate` oznacza krótką przerwę przy każdym wdrożeniu.

## Polecenia administracyjne

Uruchamiaj polecenia CLI w działającym podzie; obraz nie ma powłoki, więc wywołuj binarkę:

```sh frame="terminal"
kubectl exec -it deploy/verdin -- verdin admin create --email you@example.com
kubectl exec deploy/verdin -- verdin migrate plan
```
