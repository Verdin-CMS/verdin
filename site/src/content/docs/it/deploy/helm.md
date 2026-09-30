---
title: Chart Helm
description: Installa Verdin su Kubernetes con il chart Helm in deploy/helm/verdin — SQLite su un volume per un pod, o più repliche con un database esterno, S3 e il bus di eventi condiviso.
sidebar:
  order: 7
---

Il chart in [`deploy/helm/verdin`](https://github.com/verdin-cms/verdin/tree/main/deploy/helm/verdin)
impacchetta i manifest di [Kubernetes](/it/deploy/kubernetes/): un Deployment con probe, un
Service, un Ingress opzionale, un PersistentVolumeClaim per `/data` e un Secret con i segreti
del server. Non è ancora pubblicato in un repository di chart; installalo da un clone del
repository.

Il chart è stato verificato con `helm lint --strict` e `helm template` (Helm 3) il
2026-09-30, non installato su un cluster reale.

## Un pod con SQLite

I default eseguono una replica con SQLite, upload, cache delle immagini e indice di ricerca
su un volume da 5 GiB montato su `/data`:

```sh frame="terminal"
git clone --depth 1 https://github.com/verdin-cms/verdin
helm install cms verdin/deploy/helm/verdin \
  --set publicUrl=https://cms.example.com \
  --set ingress.enabled=true --set ingress.hosts[0].host=cms.example.com \
  --set ingress.hosts[0].paths[0].path=/
```

Il Deployment usa la strategia `Recreate`, così due pod non aprono mai lo stesso file di
database; ogni aggiornamento ha un breve downtime.

## Più repliche

Più di una replica richiede tre cose, e il chart si rifiuta di generare l'output senza di
esse:

- un database esterno (`database.url` o `database.existingSecret`: PostgreSQL, MySQL o
  MariaDB);
- `cluster.bus: database`, così che eventi realtime, presenza, invalidazione della cache e
  aggiornamenti della ricerca raggiungano ogni pod (vedi
  [il bus di eventi condiviso](/it/deploy/scaling/#bus-di-eventi-condiviso));
- nessun volume ReadWriteOnce su `/data`: media su S3 con `persistence.enabled: false`
  (ogni pod tiene allora la sua cache delle immagini e il suo indice di ricerca in un
  `emptyDir`), o una storage class ReadWriteMany.

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

Ogni pod esegue `start --migrate`; le migrazioni prendono un lock nel database, quindi girano
una sola volta. I passaggi rischiosi o distruttivi non girano mai all'avvio: applicali con
`kubectl exec deploy/cms-verdin -- verdin migrate apply --allow …` prima del rollout.
I job pianificati dei plugin girano su ogni pod dove `plugins.runJobs` è true; vedi
[Eseguire più istanze](/it/deploy/scaling/).

## Lo schema

I server di produzione non modificano lo schema, quindi i pod hanno bisogno dello schema di
cui hai fatto commit:

- **La tua immagine (consigliato).** `FROM ghcr.io/verdin-cms/verdin:0.11` più
  `COPY schema /app/schema`, e `schema.path: /app/schema`. Ogni immagine porta allora lo
  schema con cui è stata migrata.
- **`schema.files`.** I path relativi alla directory dello schema e il loro JSON, resi in un
  ConfigMap e montati su `/etc/verdin/schema`:

  ```yaml
  schema:
    files:
      content-types/article.json: |
        { "kind": "collectionType", "singularName": "article", … }
  ```

  `helm upgrade … --set-file 'schema.files.content-types/article\.json=schema/content-types/article.json'`
  legge un file dal disco.

Senza nessuno dei due, i pod leggono `/data/schema` sul volume.

## Segreti

Con `secrets.existingSecret` vuoto, il chart crea un Secret con `VERDIN_ADMIN_JWT_SECRET` e
`VERDIN_TOKEN_PEPPER` (casuali all'installazione, riletti e mantenuti negli aggiornamenti),
più l'URL del database, le credenziali S3 e il token delle metriche che passi nei values. Il
Secret e il volume hanno `helm.sh/resource-policy: keep`: `helm uninstall` li lascia, così una
reinstallazione ritrova i suoi dati e i token API continuano a funzionare. Fai il backup del
Secret insieme al database.

Per gestire tu i segreti (Sealed Secrets, External Secrets, Vault), crea un Secret con quelle
chiavi e imposta `secrets.existingSecret`.

## Values

| Value | Default | Cosa |
| --- | --- | --- |
| `image.repository`, `image.tag` | `ghcr.io/verdin-cms/verdin`, l'`appVersion` del chart | L'immagine. |
| `replicaCount` | `1` | Vedi [Più repliche](#più-repliche). |
| `args` | `["start", "--migrate"]` | Il comando del server. |
| `publicUrl` | | `VERDIN_SERVER__PUBLIC_URL`. |
| `trustedProxies` | `[]` | `VERDIN_SERVER__TRUSTED_PROXIES`. |
| `secrets.adminJwtSecret`, `secrets.tokenPepper`, `secrets.existingSecret` | generati | Vedi [Segreti](#segreti). |
| `database.url`, `database.existingSecret`, `database.existingSecretKey` | SQLite su `/data` | Il database. |
| `cluster.bus`, `cluster.pollIntervalMs` | `none`, `1000` | `[cluster]`. Il nome di ogni pod è il suo `instance_id`. |
| `s3.*` | disattivato | Il provider di upload S3: `bucket`, `region`, `endpoint`, `publicUrl`, `prefix`, `pathStyle`, credenziali o `existingSecret`. |
| `schema.path`, `schema.files` | | Vedi [Lo schema](#lo-schema). |
| `configToml` | | Un intero `verdin.toml`, montato su `/app/verdin.toml`. Le variabili d'ambiente del chart prevalgono comunque. |
| `metrics.enabled`, `metrics.token` | disattivato | Metriche Prometheus su `/_metrics`. |
| `plugins.runJobs` | `true` | `[plugins].run_jobs`. |
| `extraEnv`, `extraEnvFrom` | `[]` | Altre variabili, per esempio `VERDIN_TELEMETRY__ENABLED`. |
| `persistence.*` | attivata, 5Gi, ReadWriteOnce | Il volume `/data` (`existingClaim`, `storageClass`, `accessModes`, `size`). |
| `service.*`, `ingress.*` | ClusterIP sulla porta 80, nessun Ingress | Rete. |
| `probes.*` | | Startup e readiness su `/_ready`, liveness su `/_health`. |
| `resources`, `nodeSelector`, `tolerations`, `affinity`, `podAnnotations`, `podLabels` | | Scheduling. |
| `podSecurityContext`, `securityContext` | uid 65532, root in sola lettura, nessuna capability | Sicurezza. `/tmp` è un `emptyDir`. |

`values.yaml` nel chart documenta ogni chiave.
