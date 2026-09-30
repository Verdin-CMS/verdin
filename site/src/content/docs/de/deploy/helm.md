---
title: Helm-Chart
description: Verdin auf Kubernetes mit dem Helm-Chart in deploy/helm/verdin installieren – SQLite auf einem Volume für einen Pod oder mehrere Replicas mit externer Datenbank, S3 und dem gemeinsamen Event-Bus.
sidebar:
  order: 7
---

Das Chart in [`deploy/helm/verdin`](https://github.com/verdin-cms/verdin/tree/main/deploy/helm/verdin)
verpackt die Manifeste von [Kubernetes](/de/deploy/kubernetes/): ein Deployment mit Probes, einen
Service, ein optionales Ingress, einen PersistentVolumeClaim für `/data` und ein Secret mit den
Server-Secrets. Es ist noch nicht in einem Chart-Repository veröffentlicht; installiere es aus
einem Klon des Repositorys.

Das Chart wurde am 30.09.2026 mit `helm lint --strict` und `helm template` (Helm 3) geprüft,
nicht auf einem Live-Cluster installiert.

## Ein Pod mit SQLite

Die Standardwerte betreiben eine Replica mit SQLite, Uploads, Bild-Cache und Suchindex auf einem
5-GiB-Volume, eingebunden unter `/data`:

```sh frame="terminal"
git clone --depth 1 https://github.com/verdin-cms/verdin
helm install cms verdin/deploy/helm/verdin \
  --set publicUrl=https://cms.example.com \
  --set ingress.enabled=true --set ingress.hosts[0].host=cms.example.com \
  --set ingress.hosts[0].paths[0].path=/
```

Das Deployment nutzt die Strategie `Recreate`, sodass nie zwei Pods dieselbe Datenbankdatei
öffnen; jedes Upgrade hat eine kurze Downtime.

## Mehrere Replicas

Mehr als eine Replica braucht drei Dinge, und das Chart weigert sich, ohne sie zu rendern:

- eine externe Datenbank (`database.url` oder `database.existingSecret`: PostgreSQL, MySQL oder
  MariaDB);
- `cluster.bus: database`, damit Echtzeit-Events, Präsenz, Cache-Invalidierung und
  Suchaktualisierungen jeden Pod erreichen (siehe
  [den gemeinsamen Event-Bus](/de/deploy/scaling/#gemeinsamer-event-bus));
- kein ReadWriteOnce-Volume auf `/data`: Medien auf S3 mit `persistence.enabled: false` (jeder
  Pod hält dann seinen Bild-Cache und Suchindex in einem `emptyDir`) oder eine
  ReadWriteMany-Storage-Klasse.

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

Jeder Pod führt `start --migrate` aus; Migrationen nehmen eine Sperre in der Datenbank, laufen
also einmal. Riskante oder destruktive Schritte laufen nie beim Start: Wende sie vor dem Rollout
mit `kubectl exec deploy/cms-verdin -- verdin migrate apply --allow …` an. Geplante Plugin-Jobs
laufen auf jedem Pod, auf dem `plugins.runJobs` true ist; siehe
[Mehrere Instanzen betreiben](/de/deploy/scaling/).

## Das Schema

Produktionsserver bearbeiten das Schema nicht, die Pods brauchen also dein committetes Schema:

- **Dein eigenes Image (empfohlen).** `FROM ghcr.io/verdin-cms/verdin:0.11` plus
  `COPY schema /app/schema` und `schema.path: /app/schema`. Jedes Image trägt dann das Schema,
  mit dem es migriert wurde.
- **`schema.files`.** Pfade relativ zum Schemaverzeichnis und ihr JSON, in eine ConfigMap
  gerendert und unter `/etc/verdin/schema` eingebunden:

  ```yaml
  schema:
    files:
      content-types/article.json: |
        { "kind": "collectionType", "singularName": "article", … }
  ```

  `helm upgrade … --set-file 'schema.files.content-types/article\.json=schema/content-types/article.json'`
  liest eine Datei von der Festplatte.

Ohne beides lesen die Pods `/data/schema` auf dem Volume.

## Secrets

Ist `secrets.existingSecret` leer, legt das Chart ein Secret mit `VERDIN_ADMIN_JWT_SECRET` und
`VERDIN_TOKEN_PEPPER` an (bei der Installation zufällig, bei Upgrades zurückgelesen und
beibehalten), dazu die Datenbank-URL, die S3-Zugangsdaten und das Metrik-Token, die du in den
Values übergibst. Das Secret und das Volume haben `helm.sh/resource-policy: keep`:
`helm uninstall` lässt sie stehen, eine Neuinstallation findet also ihre Daten, und API-Tokens
funktionieren weiter. Sichere das Secret zusammen mit deiner Datenbank.

Um Secrets selbst zu verwalten (Sealed Secrets, External Secrets, Vault), lege ein Secret mit
diesen Schlüsseln an und setze `secrets.existingSecret`.

## Values

| Value | Standard | Was |
| --- | --- | --- |
| `image.repository`, `image.tag` | `ghcr.io/verdin-cms/verdin`, die `appVersion` des Charts | Das Image. |
| `replicaCount` | `1` | Siehe [Mehrere Replicas](#mehrere-replicas). |
| `args` | `["start", "--migrate"]` | Der Befehl des Servers. |
| `publicUrl` | | `VERDIN_SERVER__PUBLIC_URL`. |
| `trustedProxies` | `[]` | `VERDIN_SERVER__TRUSTED_PROXIES`. |
| `secrets.adminJwtSecret`, `secrets.tokenPepper`, `secrets.existingSecret` | generiert | Siehe [Secrets](#secrets). |
| `database.url`, `database.existingSecret`, `database.existingSecretKey` | SQLite auf `/data` | Die Datenbank. |
| `cluster.bus`, `cluster.pollIntervalMs` | `none`, `1000` | `[cluster]`. Der Name jedes Pods ist seine `instance_id`. |
| `s3.*` | aus | Der S3-Upload-Provider: `bucket`, `region`, `endpoint`, `publicUrl`, `prefix`, `pathStyle`, Zugangsdaten oder `existingSecret`. |
| `schema.path`, `schema.files` | | Siehe [Das Schema](#das-schema). |
| `configToml` | | Eine ganze `verdin.toml`, eingebunden unter `/app/verdin.toml`. Die Umgebungsvariablen des Charts haben weiterhin Vorrang. |
| `metrics.enabled`, `metrics.token` | aus | Prometheus-Metriken unter `/_metrics`. |
| `plugins.runJobs` | `true` | `[plugins].run_jobs`. |
| `extraEnv`, `extraEnvFrom` | `[]` | Weitere Variablen, z. B. `VERDIN_TELEMETRY__ENABLED`. |
| `persistence.*` | an, 5Gi, ReadWriteOnce | Das Volume `/data` (`existingClaim`, `storageClass`, `accessModes`, `size`). |
| `service.*`, `ingress.*` | ClusterIP auf Port 80, kein Ingress | Netzwerk. |
| `probes.*` | | Startup und Readiness auf `/_ready`, Liveness auf `/_health`. |
| `resources`, `nodeSelector`, `tolerations`, `affinity`, `podAnnotations`, `podLabels` | | Scheduling. |
| `podSecurityContext`, `securityContext` | uid 65532, schreibgeschütztes Root, keine Capabilities | Sicherheit. `/tmp` ist ein `emptyDir`. |

`values.yaml` im Chart dokumentiert jeden Schlüssel.
