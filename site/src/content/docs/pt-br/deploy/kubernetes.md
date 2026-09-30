---
title: Kubernetes
description: Rode o Verdin no Kubernetes — um Deployment com probes, um Secret e um Service para PostgreSQL e S3, e uma configuração de réplica única com um PersistentVolumeClaim para SQLite.
sidebar:
  order: 7
---

Esta página roda um projeto Verdin no Kubernetes. A configuração principal é stateless:
PostgreSQL (ou MySQL/MariaDB) fora dos pods, mídia em um armazenamento compatível com S3 e
quantas réplicas você precisar. Em seguida vem uma configuração de réplica única com um volume
para SQLite. O [chart Helm](/pt-br/deploy/helm/) empacota estes manifestos com valores para cada
configuração.

Os manifestos usam APIs estáveis (`apps/v1`, `v1`) e foram validados contra os schemas do
Kubernetes com `kubeconform -strict` em 2026-09-29, sem rodar em um cluster real. Substitua todos
os valores entre sinais de menor e maior.

## 1. Construa a sua imagem

Inclua a sua configuração e o seu schema em uma imagem baseada na oficial, para que cada versão
leve o schema com o qual foi migrada (veja [A sua própria imagem](/pt-br/deploy/docker/)):

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

Envie-a para o seu registry como `<registry>/verdin-site:<version>`.

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

Ou crie-o a partir da saída do `verdin secrets` com
`kubectl create secret generic verdin --from-env-file=…` e adicione os outros.

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

Exponha o Service pelo seu Ingress ou Gateway com TLS, como qualquer serviço HTTP. Os números de
recursos são um ponto de partida, não uma medição.

Observações sobre o manifesto:

- **Migrações.** Cada réplica roda `start --migrate`. As migrações obtêm um lock no banco de
  dados (um advisory lock no PostgreSQL, `GET_LOCK` no MySQL/MariaDB), então as réplicas que
  iniciam juntas as aplicam uma única vez. Passos arriscados ou destrutivos nunca são aplicados
  na inicialização: rode `verdin migrate apply --allow …` como um Job avulso com a mesma imagem
  antes do rollout.
- **Sistema de arquivos raiz somente leitura.** Os uploads passam por `/tmp`, então ele precisa
  de um `emptyDir` gravável. O cache de transformação de imagens e o índice de busca também
  precisam de diretórios graváveis se você os usar (`/tmp/transforms` acima; defina também
  `VERDIN_SEARCH__DIR`).
- **Desligamento.** O Verdin para com `SIGTERM`.
- **Jobs de plugins.** Os jobs agendados de plugins rodam em todas as réplicas onde
  `[plugins].run_jobs` é true. Rode um Deployment extra com `replicas: 1` e
  `VERDIN_PLUGINS__RUN_JOBS=true` (com os mesmos labels, para que também sirva tráfego), ou
  aceite que os jobs rodem em cada réplica. Os webhooks, os lançamentos agendados e o resumo
  diário são reservados no banco de dados e rodam uma única vez. Veja
  [Como rodar várias instâncias](/pt-br/deploy/scaling/).
- **Tempo real, presença, caches e busca.** `[cluster].bus = "database"` leva a cada pod os
  eventos dos outros (veja [o barramento de eventos compartilhado](/pt-br/deploy/scaling/#barramento-de-eventos-compartilhado)).
  Sem ele, os streams de eventos (`/api/_events`) ficam no pod ao qual se conectam: use
  session affinity no Ingress se você usar [tempo real](/pt-br/guides/frontend/realtime/).

## Réplica única com SQLite

O SQLite e os uploads locais precisam de um pod e de um volume persistente:

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

Aqui o `verdin.toml` usa `provider = { name = "local", dir = "/data/uploads" }`, e o
`VERDIN_DATABASE_URL` no Secret não é necessário (a entrada `env` prevalece sobre `envFrom`). Um
`StatefulSet` com uma réplica e uma entrada `volumeClaimTemplates` funciona da mesma forma.
`Recreate` significa uma breve indisponibilidade a cada rollout.

## Comandos de administração

Rode os comandos da CLI em um pod em execução; a imagem não tem shell, então chame o binário:

```sh frame="terminal"
kubectl exec -it deploy/verdin -- verdin admin create --email you@example.com
kubectl exec deploy/verdin -- verdin migrate plan
```
