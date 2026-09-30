---
title: Chart Helm
description: Zainstaluj Verdin na Kubernetes chartem Helm z deploy/helm/verdin — SQLite na wolumenie dla jednego poda albo kilka replik z zewnętrzną bazą danych, S3 i wspólną szyną zdarzeń.
sidebar:
  order: 7
---

Chart w [`deploy/helm/verdin`](https://github.com/verdin-cms/verdin/tree/main/deploy/helm/verdin)
pakuje manifesty z [Kubernetes](/pl/deploy/kubernetes/): Deployment z sondami, Service,
opcjonalny Ingress, PersistentVolumeClaim dla `/data` i Secret z sekretami serwera. Nie jest
jeszcze publikowany w repozytorium chartów; zainstaluj go ze sklonowanego repozytorium.

Chart sprawdzono przez `helm lint --strict` i `helm template` (Helm 3) 2026-09-30, bez
instalacji na działającym klastrze.

## Jeden pod z SQLite

Wartości domyślne uruchamiają jedną replikę z SQLite, przesłanymi plikami, cache obrazów
i indeksem wyszukiwania na wolumenie 5 GiB zamontowanym w `/data`:

```sh frame="terminal"
git clone --depth 1 https://github.com/verdin-cms/verdin
helm install cms verdin/deploy/helm/verdin \
  --set publicUrl=https://cms.example.com \
  --set ingress.enabled=true --set ingress.hosts[0].host=cms.example.com \
  --set ingress.hosts[0].paths[0].path=/
```

Deployment używa strategii `Recreate`, więc dwa pody nigdy nie otwierają tego samego pliku
bazy danych; każda aktualizacja oznacza krótką niedostępność.

## Kilka replik

Więcej niż jedna replika wymaga trzech rzeczy, a chart odmawia wygenerowania manifestów bez
nich:

- zewnętrznej bazy danych (`database.url` lub `database.existingSecret`: PostgreSQL, MySQL
  lub MariaDB);
- `cluster.bus: database`, aby zdarzenia czasu rzeczywistego, obecność, unieważnianie cache
  i aktualizacje wyszukiwania docierały do każdego poda (zobacz
  [wspólną szynę zdarzeń](/pl/deploy/scaling/#wspólna-szyna-zdarzeń));
- braku wolumenu ReadWriteOnce w `/data`: multimedia w S3 z `persistence.enabled: false`
  (każdy pod trzyma wtedy cache obrazów i indeks wyszukiwania w `emptyDir`) albo klasa
  magazynu ReadWriteMany.

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

Każdy pod uruchamia `start --migrate`; migracje zakładają blokadę w bazie danych, więc
wykonują się raz. Ryzykowne lub destrukcyjne kroki nigdy nie uruchamiają się przy starcie:
zastosuj je przez `kubectl exec deploy/cms-verdin -- verdin migrate apply --allow …` przed
wdrożeniem. Zaplanowane zadania wtyczek działają na każdym podzie, na którym `plugins.runJobs`
ma wartość true; zobacz [Uruchamianie kilku instancji](/pl/deploy/scaling/).

## Schemat

Serwery produkcyjne nie edytują schematu, więc pody potrzebują Twojego zatwierdzonego
schematu:

- **Własny obraz (zalecane).** `FROM ghcr.io/verdin-cms/verdin:0.11` plus
  `COPY schema /app/schema` i `schema.path: /app/schema`. Każdy obraz niesie wtedy schemat,
  z którym został zmigrowany.
- **`schema.files`.** Ścieżki względem katalogu schematu i ich JSON, renderowane do
  ConfigMap i montowane w `/etc/verdin/schema`:

  ```yaml
  schema:
    files:
      content-types/article.json: |
        { "kind": "collectionType", "singularName": "article", … }
  ```

  `helm upgrade … --set-file 'schema.files.content-types/article\.json=schema/content-types/article.json'`
  wczytuje plik z dysku.

Bez żadnego z nich pody czytają `/data/schema` na wolumenie.

## Sekrety

Gdy `secrets.existingSecret` jest puste, chart tworzy Secret z `VERDIN_ADMIN_JWT_SECRET`
i `VERDIN_TOKEN_PEPPER` (losowe przy instalacji, odczytywane i zachowywane przy
aktualizacjach), a także z adresem URL bazy danych, poświadczeniami S3 i tokenem metryk,
które podasz w wartościach. Secret i wolumen mają `helm.sh/resource-policy: keep`:
`helm uninstall` je zostawia, więc ponowna instalacja znajduje swoje dane, a tokeny API nadal
działają. Rób kopię zapasową Secretu razem z bazą danych.

Aby zarządzać sekretami samodzielnie (Sealed Secrets, External Secrets, Vault), utwórz Secret
z tymi kluczami i ustaw `secrets.existingSecret`.

## Wartości

| Wartość | Domyślnie | Co |
| --- | --- | --- |
| `image.repository`, `image.tag` | `ghcr.io/verdin-cms/verdin`, `appVersion` chartu | Obraz. |
| `replicaCount` | `1` | Zobacz [Kilka replik](#kilka-replik). |
| `args` | `["start", "--migrate"]` | Polecenie serwera. |
| `publicUrl` | | `VERDIN_SERVER__PUBLIC_URL`. |
| `trustedProxies` | `[]` | `VERDIN_SERVER__TRUSTED_PROXIES`. |
| `secrets.adminJwtSecret`, `secrets.tokenPepper`, `secrets.existingSecret` | generowane | Zobacz [Sekrety](#sekrety). |
| `database.url`, `database.existingSecret`, `database.existingSecretKey` | SQLite w `/data` | Baza danych. |
| `cluster.bus`, `cluster.pollIntervalMs` | `none`, `1000` | `[cluster]`. Nazwa każdego poda to jego `instance_id`. |
| `s3.*` | wyłączone | Dostawca przesyłania S3: `bucket`, `region`, `endpoint`, `publicUrl`, `prefix`, `pathStyle`, poświadczenia lub `existingSecret`. |
| `schema.path`, `schema.files` | | Zobacz [Schemat](#schemat). |
| `configToml` | | Cały `verdin.toml`, montowany w `/app/verdin.toml`. Zmienne środowiskowe chartu nadal mają pierwszeństwo. |
| `metrics.enabled`, `metrics.token` | wyłączone | Metryki Prometheus pod `/_metrics`. |
| `plugins.runJobs` | `true` | `[plugins].run_jobs`. |
| `extraEnv`, `extraEnvFrom` | `[]` | Dodatkowe zmienne, np. `VERDIN_TELEMETRY__ENABLED`. |
| `persistence.*` | włączone, 5Gi, ReadWriteOnce | Wolumen `/data` (`existingClaim`, `storageClass`, `accessModes`, `size`). |
| `service.*`, `ingress.*` | ClusterIP na porcie 80, bez Ingress | Sieć. |
| `probes.*` | | Sondy startup i readiness na `/_ready`, liveness na `/_health`. |
| `resources`, `nodeSelector`, `tolerations`, `affinity`, `podAnnotations`, `podLabels` | | Harmonogramowanie. |
| `podSecurityContext`, `securityContext` | uid 65532, główny system plików tylko do odczytu, bez capabilities | Bezpieczeństwo. `/tmp` to `emptyDir`. |

`values.yaml` w chartcie dokumentuje każdy klucz.
