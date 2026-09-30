---
title: Gràfic de Helm
description: Instal·la Verdin a Kubernetes amb el gràfic de Helm de deploy/helm/verdin — SQLite en un volum per a un sol pod, o diverses rèpliques amb una base de dades externa, S3 i el bus d'esdeveniments compartit.
sidebar:
  order: 7
---

El gràfic de [`deploy/helm/verdin`](https://github.com/verdin-cms/verdin/tree/main/deploy/helm/verdin)
empaqueta els manifests de [Kubernetes](/ca/deploy/kubernetes/): un Deployment amb sondes, un
Service, un Ingress opcional, un PersistentVolumeClaim per a `/data` i un Secret amb els secrets
del servidor. Encara no es publica en cap repositori de gràfics; instal·la'l des d'un clon del
repositori.

El gràfic es va comprovar amb `helm lint --strict` i `helm template` (Helm 3) el
2026-09-30, sense instal·lar-lo en un clúster real.

## Un pod amb SQLite

Els valors per defecte executen una rèplica amb SQLite, les pujades, la memòria cau d'imatges i
l'índex de cerca en un volum de 5 GiB muntat a `/data`:

```sh frame="terminal"
git clone --depth 1 https://github.com/verdin-cms/verdin
helm install cms verdin/deploy/helm/verdin \
  --set publicUrl=https://cms.example.com \
  --set ingress.enabled=true --set ingress.hosts[0].host=cms.example.com \
  --set ingress.hosts[0].paths[0].path=/
```

El Deployment fa servir l'estratègia `Recreate`, de manera que dos pods mai obren el mateix
fitxer de base de dades; cada actualització té una breu interrupció.

## Diverses rèpliques

Més d'una rèplica necessita tres coses, i el gràfic es nega a renderitzar-se sense elles:

- una base de dades externa (`database.url` o `database.existingSecret`: PostgreSQL, MySQL
  o MariaDB);
- `cluster.bus: database`, perquè els esdeveniments en temps real, la presència, la invalidació de
  la memòria cau i les actualitzacions de cerca arribin a tots els pods (consulta
  [el bus d'esdeveniments compartit](/ca/deploy/scaling/#bus-desdeveniments-compartit));
- cap volum ReadWriteOnce a `/data`: multimèdia a S3 amb `persistence.enabled: false`
  (cada pod guarda aleshores la seva memòria cau d'imatges i l'índex de cerca en un `emptyDir`), o
  una classe d'emmagatzematge ReadWriteMany.

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

Cada pod executa `start --migrate`; les migracions agafen un bloqueig a la base de dades, de
manera que s'executen un sol cop. Els passos arriscats o destructius mai s'executen en iniciar:
aplica'ls amb `kubectl exec deploy/cms-verdin -- verdin migrate apply --allow …` abans de
desplegar. Les tasques programades dels connectors s'executen a cada pod on `plugins.runJobs` és
true; consulta [Executar diverses instàncies](/ca/deploy/scaling/).

## L'esquema

Els servidors de producció no editen l'esquema, de manera que els pods necessiten el teu esquema
confirmat:

- **La teva pròpia imatge (recomanat).** `FROM ghcr.io/verdin-cms/verdin:0.11` més
  `COPY schema /app/schema`, i `schema.path: /app/schema`. Cada imatge porta així
  l'esquema amb el qual es va migrar.
- **`schema.files`.** Camins relatius al directori de l'esquema i el seu JSON, renderitzats
  en un ConfigMap i muntats a `/etc/verdin/schema`:

  ```yaml
  schema:
    files:
      content-types/article.json: |
        { "kind": "collectionType", "singularName": "article", … }
  ```

  `helm upgrade … --set-file 'schema.files.content-types/article\.json=schema/content-types/article.json'`
  llegeix un fitxer del disc.

Sense cap dels dos, els pods llegeixen `/data/schema` al volum.

## Secrets

Amb `secrets.existingSecret` buit, el gràfic crea un Secret amb
`VERDIN_ADMIN_JWT_SECRET` i `VERDIN_TOKEN_PEPPER` (aleatoris en instal·lar, rellegits i
conservats en les actualitzacions), a més de la URL de la base de dades, les credencials de S3 i el
token de mètriques que passis als valors. El Secret i el volum tenen
`helm.sh/resource-policy: keep`: `helm uninstall` els deixa, de manera que una reinstal·lació
troba les seves dades i els tokens d'API continuen funcionant. Fes una còpia de seguretat del
Secret amb la teva base de dades.

Per gestionar tu mateix els secrets (Sealed Secrets, External Secrets, Vault), crea un Secret
amb aquestes claus i defineix `secrets.existingSecret`.

## Valors

| Valor | Per defecte | Què |
| --- | --- | --- |
| `image.repository`, `image.tag` | `ghcr.io/verdin-cms/verdin`, l'`appVersion` del gràfic | La imatge. |
| `replicaCount` | `1` | Consulta [Diverses rèpliques](#diverses-rèpliques). |
| `args` | `["start", "--migrate"]` | L'ordre del servidor. |
| `publicUrl` | | `VERDIN_SERVER__PUBLIC_URL`. |
| `trustedProxies` | `[]` | `VERDIN_SERVER__TRUSTED_PROXIES`. |
| `secrets.adminJwtSecret`, `secrets.tokenPepper`, `secrets.existingSecret` | generats | Consulta [Secrets](#secrets). |
| `database.url`, `database.existingSecret`, `database.existingSecretKey` | SQLite a `/data` | La base de dades. |
| `cluster.bus`, `cluster.pollIntervalMs` | `none`, `1000` | `[cluster]`. El nom de cada pod és el seu `instance_id`. |
| `s3.*` | desactivat | El proveïdor de pujades S3: `bucket`, `region`, `endpoint`, `publicUrl`, `prefix`, `pathStyle`, credencials o `existingSecret`. |
| `schema.path`, `schema.files` | | Consulta [L'esquema](#lesquema). |
| `configToml` | | Un `verdin.toml` sencer, muntat a `/app/verdin.toml`. Les variables d'entorn del gràfic continuen tenint prioritat. |
| `metrics.enabled`, `metrics.token` | desactivat | Mètriques de Prometheus a `/_metrics`. |
| `plugins.runJobs` | `true` | `[plugins].run_jobs`. |
| `extraEnv`, `extraEnvFrom` | `[]` | Més variables, p. ex. `VERDIN_TELEMETRY__ENABLED`. |
| `persistence.*` | activat, 5Gi, ReadWriteOnce | El volum `/data` (`existingClaim`, `storageClass`, `accessModes`, `size`). |
| `service.*`, `ingress.*` | ClusterIP al port 80, sense Ingress | Xarxa. |
| `probes.*` | | Inici i preparació a `/_ready`, disponibilitat a `/_health`. |
| `resources`, `nodeSelector`, `tolerations`, `affinity`, `podAnnotations`, `podLabels` | | Planificació. |
| `podSecurityContext`, `securityContext` | uid 65532, arrel de només lectura, sense capacitats | Seguretat. `/tmp` és un `emptyDir`. |

El `values.yaml` del gràfic documenta cada clau.
