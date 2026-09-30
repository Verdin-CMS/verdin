---
title: Chart de Helm
description: Instala Verdin en Kubernetes con el chart de Helm de deploy/helm/verdin — SQLite en un volumen para un solo pod, o varias réplicas con una base de datos externa, S3 y el bus de eventos compartido.
sidebar:
  order: 7
---

El chart de [`deploy/helm/verdin`](https://github.com/verdin-cms/verdin/tree/main/deploy/helm/verdin)
empaqueta los manifiestos de [Kubernetes](/es/deploy/kubernetes/): un Deployment con probes, un
Service, un Ingress opcional, un PersistentVolumeClaim para `/data` y un Secret con los secretos
del servidor. Todavía no está publicado en un repositorio de charts; instálalo desde un clon del
repositorio.

El chart se comprobó con `helm lint --strict` y `helm template` (Helm 3) el 2026-09-30, y no se
instaló en un clúster real.

## Un pod con SQLite

Los valores por defecto ejecutan una réplica con SQLite, las subidas, la caché de imágenes y el
índice de búsqueda en un volumen de 5 GiB montado en `/data`:

```sh frame="terminal"
git clone --depth 1 https://github.com/verdin-cms/verdin
helm install cms verdin/deploy/helm/verdin \
  --set publicUrl=https://cms.example.com \
  --set ingress.enabled=true --set ingress.hosts[0].host=cms.example.com \
  --set ingress.hosts[0].paths[0].path=/
```

El Deployment usa la estrategia `Recreate`, así que dos pods nunca abren el mismo archivo de
base de datos; cada actualización tiene una breve interrupción.

## Varias réplicas

Más de una réplica necesita tres cosas, y el chart se niega a renderizar sin ellas:

- una base de datos externa (`database.url` o `database.existingSecret`: PostgreSQL, MySQL o
  MariaDB);
- `cluster.bus: database`, para que los eventos en tiempo real, la presencia, la invalidación de
  cachés y las actualizaciones de búsqueda lleguen a todos los pods (consulta
  [el bus de eventos compartido](/es/deploy/scaling/#bus-de-eventos-compartido));
- ningún volumen ReadWriteOnce en `/data`: medios en S3 con `persistence.enabled: false` (cada
  pod guarda entonces su caché de imágenes y su índice de búsqueda en un `emptyDir`), o una clase
  de almacenamiento ReadWriteMany.

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

Cada pod ejecuta `start --migrate`; las migraciones toman un bloqueo en la base de datos, así que
se ejecutan una sola vez. Los pasos arriesgados o destructivos nunca se ejecutan al arrancar:
aplícalos con `kubectl exec deploy/cms-verdin -- verdin migrate apply --allow …` antes de
desplegar. Las tareas programadas de los plugins se ejecutan en cada pod donde `plugins.runJobs`
es true; consulta [Ejecutar varias instancias](/es/deploy/scaling/).

## El esquema

Los servidores de producción no editan el esquema, así que los pods necesitan tu esquema
confirmado:

- **Tu propia imagen (recomendado).** `FROM ghcr.io/verdin-cms/verdin:0.11` más
  `COPY schema /app/schema`, y `schema.path: /app/schema`. Cada imagen lleva entonces el esquema
  con el que se migró.
- **`schema.files`.** Rutas relativas al directorio del esquema y su JSON, renderizados en un
  ConfigMap y montados en `/etc/verdin/schema`:

  ```yaml
  schema:
    files:
      content-types/article.json: |
        { "kind": "collectionType", "singularName": "article", … }
  ```

  `helm upgrade … --set-file 'schema.files.content-types/article\.json=schema/content-types/article.json'`
  lee un archivo del disco.

Sin ninguna de las dos, los pods leen `/data/schema` en el volumen.

## Secretos

Con `secrets.existingSecret` vacío, el chart crea un Secret con `VERDIN_ADMIN_JWT_SECRET` y
`VERDIN_TOKEN_PEPPER` (aleatorios al instalar, leídos de vuelta y conservados en las
actualizaciones), además de la URL de la base de datos, las credenciales de S3 y el token de
métricas que pases en los valores. El Secret y el volumen tienen
`helm.sh/resource-policy: keep`: `helm uninstall` los deja, así que una reinstalación encuentra
sus datos y los tokens de API siguen funcionando. Haz una copia de seguridad del Secret junto con
tu base de datos.

Para gestionar los secretos tú mismo (Sealed Secrets, External Secrets, Vault), crea un Secret
con esas claves y define `secrets.existingSecret`.

## Valores

| Valor | Por defecto | Qué es |
| --- | --- | --- |
| `image.repository`, `image.tag` | `ghcr.io/verdin-cms/verdin`, el `appVersion` del chart | La imagen. |
| `replicaCount` | `1` | Consulta [Varias réplicas](#varias-réplicas). |
| `args` | `["start", "--migrate"]` | El comando del servidor. |
| `publicUrl` | | `VERDIN_SERVER__PUBLIC_URL`. |
| `trustedProxies` | `[]` | `VERDIN_SERVER__TRUSTED_PROXIES`. |
| `secrets.adminJwtSecret`, `secrets.tokenPepper`, `secrets.existingSecret` | generados | Consulta [Secretos](#secretos). |
| `database.url`, `database.existingSecret`, `database.existingSecretKey` | SQLite en `/data` | La base de datos. |
| `cluster.bus`, `cluster.pollIntervalMs` | `none`, `1000` | `[cluster]`. El nombre de cada pod es su `instance_id`. |
| `s3.*` | desactivado | El proveedor de subidas S3: `bucket`, `region`, `endpoint`, `publicUrl`, `prefix`, `pathStyle`, credenciales o `existingSecret`. |
| `schema.path`, `schema.files` | | Consulta [El esquema](#el-esquema). |
| `configToml` | | Un `verdin.toml` completo, montado en `/app/verdin.toml`. Las variables de entorno del chart siguen teniendo prioridad. |
| `metrics.enabled`, `metrics.token` | desactivado | Métricas de Prometheus en `/_metrics`. |
| `plugins.runJobs` | `true` | `[plugins].run_jobs`. |
| `extraEnv`, `extraEnvFrom` | `[]` | Más variables, p. ej. `VERDIN_TELEMETRY__ENABLED`. |
| `persistence.*` | activado, 5Gi, ReadWriteOnce | El volumen `/data` (`existingClaim`, `storageClass`, `accessModes`, `size`). |
| `service.*`, `ingress.*` | ClusterIP en el puerto 80, sin Ingress | Red. |
| `probes.*` | | Startup y readiness en `/_ready`, liveness en `/_health`. |
| `resources`, `nodeSelector`, `tolerations`, `affinity`, `podAnnotations`, `podLabels` | | Planificación. |
| `podSecurityContext`, `securityContext` | uid 65532, raíz de solo lectura, sin capabilities | Seguridad. `/tmp` es un `emptyDir`. |

El `values.yaml` del chart documenta cada clave.
