---
title: Chart Helm
description: Instale o Verdin no Kubernetes com o chart Helm em deploy/helm/verdin — SQLite em um volume para um pod, ou várias réplicas com banco de dados externo, S3 e o barramento de eventos compartilhado.
sidebar:
  order: 7
---

O chart em [`deploy/helm/verdin`](https://github.com/verdin-cms/verdin/tree/main/deploy/helm/verdin)
empacota os manifestos de [Kubernetes](/pt-br/deploy/kubernetes/): um Deployment com probes, um
Service, um Ingress opcional, um PersistentVolumeClaim para `/data` e um Secret com os segredos
do servidor. Ele ainda não é publicado em um repositório de charts; instale-o a partir de um
clone do repositório.

O chart foi verificado com `helm lint --strict` e `helm template` (Helm 3) em 2026-09-30, sem
ser instalado em um cluster real.

## Um pod com SQLite

Os padrões rodam uma réplica com SQLite, uploads, o cache de imagens e o índice de busca em um
volume de 5 GiB montado em `/data`:

```sh frame="terminal"
git clone --depth 1 https://github.com/verdin-cms/verdin
helm install cms verdin/deploy/helm/verdin \
  --set publicUrl=https://cms.example.com \
  --set ingress.enabled=true --set ingress.hosts[0].host=cms.example.com \
  --set ingress.hosts[0].paths[0].path=/
```

O Deployment usa a estratégia `Recreate`, então dois pods nunca abrem o mesmo arquivo de banco
de dados; cada atualização tem uma breve indisponibilidade.

## Várias réplicas

Mais de uma réplica exige três coisas, e o chart se recusa a renderizar sem elas:

- um banco de dados externo (`database.url` ou `database.existingSecret`: PostgreSQL, MySQL
  ou MariaDB);
- `cluster.bus: database`, para que eventos de tempo real, presença, invalidação de cache e
  atualizações da busca cheguem a todos os pods (veja [o barramento de eventos compartilhado](/pt-br/deploy/scaling/#barramento-de-eventos-compartilhado));
- nenhum volume ReadWriteOnce em `/data`: mídia no S3 com `persistence.enabled: false`
  (cada pod então guarda o seu cache de imagens e o seu índice de busca em um `emptyDir`), ou
  uma storage class ReadWriteMany.

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

Cada pod roda `start --migrate`; as migrações tomam um lock no banco de dados, então rodam uma
única vez. Os passos arriscados ou destrutivos nunca rodam na inicialização: aplique-os com
`kubectl exec deploy/cms-verdin -- verdin migrate apply --allow …` antes do rollout.
Os jobs agendados de plugins rodam em todo pod em que `plugins.runJobs` é true; veja
[Como rodar várias instâncias](/pt-br/deploy/scaling/).

## O schema

Os servidores de produção não editam o schema, então os pods precisam do seu schema commitado:

- **A sua própria imagem (recomendado).** `FROM ghcr.io/verdin-cms/verdin:0.11` mais
  `COPY schema /app/schema`, e `schema.path: /app/schema`. Cada imagem então carrega o schema
  com o qual foi migrada.
- **`schema.files`.** Caminhos relativos ao diretório do schema e o seu JSON, renderizados em um
  ConfigMap e montados em `/etc/verdin/schema`:

  ```yaml
  schema:
    files:
      content-types/article.json: |
        { "kind": "collectionType", "singularName": "article", … }
  ```

  `helm upgrade … --set-file 'schema.files.content-types/article\.json=schema/content-types/article.json'`
  lê um arquivo do disco.

Sem nenhum dos dois, os pods leem `/data/schema` no volume.

## Segredos

Com `secrets.existingSecret` vazio, o chart cria um Secret com `VERDIN_ADMIN_JWT_SECRET` e
`VERDIN_TOKEN_PEPPER` (aleatórios na instalação, relidos e mantidos nas atualizações), mais a
URL do banco de dados, as credenciais do S3 e o token de métricas que você passar nos valores.
O Secret e o volume têm `helm.sh/resource-policy: keep`: `helm uninstall` os deixa, então uma
reinstalação encontra os seus dados e os tokens de API continuam funcionando. Faça backup do
Secret junto com o seu banco de dados.

Para gerenciar os segredos por conta própria (Sealed Secrets, External Secrets, Vault), crie um
Secret com essas chaves e defina `secrets.existingSecret`.

## Valores

| Valor | Padrão | O quê |
| --- | --- | --- |
| `image.repository`, `image.tag` | `ghcr.io/verdin-cms/verdin`, o `appVersion` do chart | A imagem. |
| `replicaCount` | `1` | Veja [Várias réplicas](#várias-réplicas). |
| `args` | `["start", "--migrate"]` | O comando do servidor. |
| `publicUrl` | | `VERDIN_SERVER__PUBLIC_URL`. |
| `trustedProxies` | `[]` | `VERDIN_SERVER__TRUSTED_PROXIES`. |
| `secrets.adminJwtSecret`, `secrets.tokenPepper`, `secrets.existingSecret` | gerados | Veja [Segredos](#segredos). |
| `database.url`, `database.existingSecret`, `database.existingSecretKey` | SQLite em `/data` | O banco de dados. |
| `cluster.bus`, `cluster.pollIntervalMs` | `none`, `1000` | `[cluster]`. O nome de cada pod é o seu `instance_id`. |
| `s3.*` | desativado | O provedor de upload S3: `bucket`, `region`, `endpoint`, `publicUrl`, `prefix`, `pathStyle`, credenciais ou `existingSecret`. |
| `schema.path`, `schema.files` | | Veja [O schema](#o-schema). |
| `configToml` | | Um `verdin.toml` inteiro, montado em `/app/verdin.toml`. As variáveis de ambiente do chart ainda prevalecem. |
| `metrics.enabled`, `metrics.token` | desativado | Métricas Prometheus em `/_metrics`. |
| `plugins.runJobs` | `true` | `[plugins].run_jobs`. |
| `extraEnv`, `extraEnvFrom` | `[]` | Mais variáveis, por exemplo `VERDIN_TELEMETRY__ENABLED`. |
| `persistence.*` | ativado, 5Gi, ReadWriteOnce | O volume `/data` (`existingClaim`, `storageClass`, `accessModes`, `size`). |
| `service.*`, `ingress.*` | ClusterIP na porta 80, sem Ingress | Rede. |
| `probes.*` | | Startup e readiness em `/_ready`, liveness em `/_health`. |
| `resources`, `nodeSelector`, `tolerations`, `affinity`, `podAnnotations`, `podLabels` | | Agendamento. |
| `podSecurityContext`, `securityContext` | uid 65532, raiz somente leitura, sem capabilities | Segurança. `/tmp` é um `emptyDir`. |

O `values.yaml` do chart documenta cada chave.
