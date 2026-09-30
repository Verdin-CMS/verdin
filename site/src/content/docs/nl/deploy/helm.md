---
title: Helm-chart
description: Installeer Verdin op Kubernetes met de Helm-chart in deploy/helm/verdin — SQLite op een volume voor één pod, of meerdere replica's met een externe database, S3 en de gedeelde eventbus.
sidebar:
  order: 7
---

De chart in [`deploy/helm/verdin`](https://github.com/verdin-cms/verdin/tree/main/deploy/helm/verdin)
verpakt de manifesten van [Kubernetes](/nl/deploy/kubernetes/): een Deployment met probes, een
Service, een optionele Ingress, een PersistentVolumeClaim voor `/data` en een Secret met de
servergeheimen. Ze is nog niet gepubliceerd in een chart-repository; installeer haar vanuit een
kloon van de repository.

De chart is op 2026-09-30 gecontroleerd met `helm lint --strict` en `helm template` (Helm 3), niet
geïnstalleerd op een live cluster.

## Eén pod met SQLite

De standaardwaarden draaien één replica met SQLite, uploads, de afbeeldingscache en de zoekindex
op een volume van 5 GiB gemount op `/data`:

```sh frame="terminal"
git clone --depth 1 https://github.com/verdin-cms/verdin
helm install cms verdin/deploy/helm/verdin \
  --set publicUrl=https://cms.example.com \
  --set ingress.enabled=true --set ingress.hosts[0].host=cms.example.com \
  --set ingress.hosts[0].paths[0].path=/
```

De Deployment gebruikt de strategie `Recreate`, zodat twee pods nooit hetzelfde databasebestand
openen; elke upgrade heeft een korte downtime.

## Meerdere replica's

Meer dan één replica heeft drie dingen nodig, en de chart weigert te renderen zonder:

- een externe database (`database.url` of `database.existingSecret`: PostgreSQL, MySQL
  of MariaDB);
- `cluster.bus: database`, zodat realtime events, presence, cache-invalidatie en zoekupdates
  elke pod bereiken (zie [de gedeelde eventbus](/nl/deploy/scaling/#gedeelde-eventbus));
- geen ReadWriteOnce-volume op `/data`: media op S3 met `persistence.enabled: false`
  (elke pod houdt dan zijn afbeeldingscache en zoekindex in een `emptyDir`), of een
  ReadWriteMany-storageclass.

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

Elke pod draait `start --migrate`; migraties nemen een lock in de database, dus ze draaien één
keer. Riskante of destructieve stappen draaien nooit bij het starten: pas ze toe met
`kubectl exec deploy/cms-verdin -- verdin migrate apply --allow …` voordat je uitrolt.
Geplande pluginjobs draaien op elke pod waar `plugins.runJobs` true is; zie
[Meerdere instanties draaien](/nl/deploy/scaling/).

## Het schema

Productieservers bewerken het schema niet, dus de pods hebben je gecommitte schema nodig:

- **Je eigen image (aanbevolen).** `FROM ghcr.io/verdin-cms/verdin:0.11` plus
  `COPY schema /app/schema`, en `schema.path: /app/schema`. Elk image draagt dan het
  schema waarmee het is gemigreerd.
- **`schema.files`.** Paden relatief ten opzichte van de schemamap en hun JSON, gerenderd
  in een ConfigMap en gemount op `/etc/verdin/schema`:

  ```yaml
  schema:
    files:
      content-types/article.json: |
        { "kind": "collectionType", "singularName": "article", … }
  ```

  `helm upgrade … --set-file 'schema.files.content-types/article\.json=schema/content-types/article.json'`
  leest een bestand van schijf.

Zonder beide lezen de pods `/data/schema` op het volume.

## Geheimen

Als `secrets.existingSecret` leeg is, maakt de chart een Secret aan met
`VERDIN_ADMIN_JWT_SECRET` en `VERDIN_TOKEN_PEPPER` (willekeurig bij installatie, teruggelezen en
bewaard bij upgrades), plus de database-URL, S3-inloggegevens en het metrics-token die je in de
values meegeeft. De Secret en het volume hebben `helm.sh/resource-policy: keep`: `helm uninstall`
laat ze staan, zodat een herinstallatie haar gegevens vindt en API-tokens blijven werken. Maak een
back-up van de Secret samen met je database.

Om geheimen zelf te beheren (Sealed Secrets, External Secrets, Vault), maak je een Secret
met die sleutels en stel je `secrets.existingSecret` in.

## Values

| Value | Standaard | Wat |
| --- | --- | --- |
| `image.repository`, `image.tag` | `ghcr.io/verdin-cms/verdin`, de `appVersion` van de chart | Het image. |
| `replicaCount` | `1` | Zie [Meerdere replica's](#meerdere-replicas). |
| `args` | `["start", "--migrate"]` | Het commando van de server. |
| `publicUrl` | | `VERDIN_SERVER__PUBLIC_URL`. |
| `trustedProxies` | `[]` | `VERDIN_SERVER__TRUSTED_PROXIES`. |
| `secrets.adminJwtSecret`, `secrets.tokenPepper`, `secrets.existingSecret` | gegenereerd | Zie [Geheimen](#geheimen). |
| `database.url`, `database.existingSecret`, `database.existingSecretKey` | SQLite op `/data` | De database. |
| `cluster.bus`, `cluster.pollIntervalMs` | `none`, `1000` | `[cluster]`. De naam van elke pod is zijn `instance_id`. |
| `s3.*` | uitgeschakeld | De S3-uploadprovider: `bucket`, `region`, `endpoint`, `publicUrl`, `prefix`, `pathStyle`, inloggegevens of `existingSecret`. |
| `schema.path`, `schema.files` | | Zie [Het schema](#het-schema). |
| `configToml` | | Een volledige `verdin.toml`, gemount op `/app/verdin.toml`. De omgevingsvariabelen van de chart winnen nog steeds. |
| `metrics.enabled`, `metrics.token` | uitgeschakeld | Prometheus-metrics op `/_metrics`. |
| `plugins.runJobs` | `true` | `[plugins].run_jobs`. |
| `extraEnv`, `extraEnvFrom` | `[]` | Meer variabelen, bijvoorbeeld `VERDIN_TELEMETRY__ENABLED`. |
| `persistence.*` | ingeschakeld, 5Gi, ReadWriteOnce | Het volume `/data` (`existingClaim`, `storageClass`, `accessModes`, `size`). |
| `service.*`, `ingress.*` | ClusterIP op poort 80, geen Ingress | Netwerk. |
| `probes.*` | | Startup en readiness op `/_ready`, liveness op `/_health`. |
| `resources`, `nodeSelector`, `tolerations`, `affinity`, `podAnnotations`, `podLabels` | | Scheduling. |
| `podSecurityContext`, `securityContext` | uid 65532, alleen-lezen root, geen capabilities | Beveiliging. `/tmp` is een `emptyDir`. |

`values.yaml` in de chart documenteert elke sleutel.
