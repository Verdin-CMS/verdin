---
title: Chart Helm
description: Installez Verdin sur Kubernetes avec le chart Helm de deploy/helm/verdin — SQLite sur un volume pour un pod, ou plusieurs réplicas avec une base de données externe, S3 et le bus d’événements partagé.
sidebar:
  order: 7
---

Le chart de [`deploy/helm/verdin`](https://github.com/verdin-cms/verdin/tree/main/deploy/helm/verdin)
regroupe les manifestes de [Kubernetes](/fr/deploy/kubernetes/) : un Deployment avec des sondes,
un Service, un Ingress facultatif, un PersistentVolumeClaim pour `/data` et un Secret avec les
secrets du serveur. Il n’est pas encore publié dans un dépôt de charts ; installez-le depuis un
clone du dépôt.

Le chart a été vérifié avec `helm lint --strict` et `helm template` (Helm 3) le 2026-09-30, sans
être installé sur un cluster en production.

## Un pod avec SQLite

Les valeurs par défaut exécutent un réplica avec SQLite, les téléversements, le cache d’images et
l’index de recherche sur un volume de 5 Gio monté sur `/data` :

```sh frame="terminal"
git clone --depth 1 https://github.com/verdin-cms/verdin
helm install cms verdin/deploy/helm/verdin \
  --set publicUrl=https://cms.example.com \
  --set ingress.enabled=true --set ingress.hosts[0].host=cms.example.com \
  --set ingress.hosts[0].paths[0].path=/
```

Le Deployment utilise la stratégie `Recreate` : deux pods n’ouvrent donc jamais le même fichier de
base de données ; chaque mise à niveau a une courte interruption.

## Plusieurs réplicas

Plus d’un réplica demande trois choses, et le chart refuse de se rendre sans elles :

- une base de données externe (`database.url` ou `database.existingSecret` : PostgreSQL, MySQL
  ou MariaDB) ;
- `cluster.bus: database`, pour que les événements temps réel, la présence, l’invalidation des
  caches et les mises à jour de la recherche atteignent chaque pod (voir
  [le bus d’événements partagé](/fr/deploy/scaling/#bus-dévénements-partagé)) ;
- aucun volume ReadWriteOnce sur `/data` : les médias sur S3 avec `persistence.enabled: false`
  (chaque pod garde alors son cache d’images et son index de recherche dans un `emptyDir`), ou une
  classe de stockage ReadWriteMany.

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

Chaque pod exécute `start --migrate` ; les migrations prennent un verrou dans la base de
données, et s’exécutent donc une seule fois. Les étapes risquées ou destructrices ne s’exécutent
jamais au démarrage : appliquez-les avec
`kubectl exec deploy/cms-verdin -- verdin migrate apply --allow …` avant de déployer. Les tâches
planifiées des plugins s’exécutent sur chaque pod où `plugins.runJobs` vaut true ; voir
[Exécuter plusieurs instances](/fr/deploy/scaling/).

## Le schéma

Les serveurs de production ne modifient pas le schéma : les pods ont donc besoin de votre schéma
commité :

- **Votre propre image (recommandé).** `FROM ghcr.io/verdin-cms/verdin:0.11` plus
  `COPY schema /app/schema`, et `schema.path: /app/schema`. Chaque image porte alors le schéma
  avec lequel elle a été migrée.
- **`schema.files`.** Des chemins relatifs au répertoire du schéma et leur JSON, rendus dans un
  ConfigMap et montés sur `/etc/verdin/schema` :

  ```yaml
  schema:
    files:
      content-types/article.json: |
        { "kind": "collectionType", "singularName": "article", … }
  ```

  `helm upgrade … --set-file 'schema.files.content-types/article\.json=schema/content-types/article.json'`
  lit un fichier depuis le disque.

Sans l’un ou l’autre, les pods lisent `/data/schema` sur le volume.

## Secrets

Avec `secrets.existingSecret` vide, le chart crée un Secret avec `VERDIN_ADMIN_JWT_SECRET` et
`VERDIN_TOKEN_PEPPER` (aléatoires à l’installation, relus et conservés lors des mises à niveau),
plus l’URL de la base de données, les identifiants S3 et le jeton de métriques que vous passez
dans les valeurs. Le Secret et le volume portent `helm.sh/resource-policy: keep` :
`helm uninstall` les laisse, si bien qu’une réinstallation retrouve ses données et que les jetons
d’API fonctionnent toujours. Sauvegardez le Secret avec votre base de données.

Pour gérer vous-même les secrets (Sealed Secrets, External Secrets, Vault), créez un Secret avec
ces clés et définissez `secrets.existingSecret`.

## Valeurs

| Valeur | Par défaut | Quoi |
| --- | --- | --- |
| `image.repository`, `image.tag` | `ghcr.io/verdin-cms/verdin`, l’`appVersion` du chart | L’image. |
| `replicaCount` | `1` | Voir [Plusieurs réplicas](#plusieurs-réplicas). |
| `args` | `["start", "--migrate"]` | La commande du serveur. |
| `publicUrl` | | `VERDIN_SERVER__PUBLIC_URL`. |
| `trustedProxies` | `[]` | `VERDIN_SERVER__TRUSTED_PROXIES`. |
| `secrets.adminJwtSecret`, `secrets.tokenPepper`, `secrets.existingSecret` | générés | Voir [Secrets](#secrets). |
| `database.url`, `database.existingSecret`, `database.existingSecretKey` | SQLite sur `/data` | La base de données. |
| `cluster.bus`, `cluster.pollIntervalMs` | `none`, `1000` | `[cluster]`. Le nom de chaque pod est son `instance_id`. |
| `s3.*` | désactivé | Le fournisseur de téléversement S3 : `bucket`, `region`, `endpoint`, `publicUrl`, `prefix`, `pathStyle`, identifiants ou `existingSecret`. |
| `schema.path`, `schema.files` | | Voir [Le schéma](#le-schéma). |
| `configToml` | | Un `verdin.toml` entier, monté sur `/app/verdin.toml`. Les variables d’environnement du chart l’emportent toujours. |
| `metrics.enabled`, `metrics.token` | désactivé | Métriques Prometheus sur `/_metrics`. |
| `plugins.runJobs` | `true` | `[plugins].run_jobs`. |
| `extraEnv`, `extraEnvFrom` | `[]` | D’autres variables, par ex. `VERDIN_TELEMETRY__ENABLED`. |
| `persistence.*` | activé, 5Gi, ReadWriteOnce | Le volume `/data` (`existingClaim`, `storageClass`, `accessModes`, `size`). |
| `service.*`, `ingress.*` | ClusterIP sur le port 80, pas d’Ingress | Réseau. |
| `probes.*` | | Démarrage et disponibilité sur `/_ready`, liveness sur `/_health`. |
| `resources`, `nodeSelector`, `tolerations`, `affinity`, `podAnnotations`, `podLabels` | | Ordonnancement. |
| `podSecurityContext`, `securityContext` | uid 65532, racine en lecture seule, aucune capacité | Sécurité. `/tmp` est un `emptyDir`. |

Le `values.yaml` du chart documente chaque clé.
