---
title: Render
description: Desplega Verdin a Render amb un Blueprint — un servei web Docker construït a partir del teu repositori, una base de dades PostgreSQL de Render i la multimèdia en un emmagatzematge compatible amb S3 o en un disc.
sidebar:
  order: 5
---

Aquesta pàgina desplega un projecte Verdin a [Render](https://render.com) amb un Blueprint
(`render.yaml`): un servei web construït a partir d'un Dockerfile petit del teu repositori, i una
base de dades PostgreSQL de Render. El sistema de fitxers de Render és efímer, així que la
multimèdia va a un emmagatzematge compatible amb S3, o a un disc persistent si executes una sola
instància.

:::note
El format del Blueprint s'ha comprovat amb la [referència de Blueprint de Render](https://render.com/docs/blueprint-spec)
el 29-09-2026; no s'ha desplegat en un compte real de Render. Els valors marcats amb `# yours`
els has d'omplir tu.
:::

Requisits previs: el teu projecte Verdin (amb `schema/`) en un repositori Git que Render pugui
llegir.

## 1. Afegeix un Dockerfile i una configuració

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337

[schema]
path = "schema"

[log]
format = "json"

[upload]
# Cloudflare R2 as an example; any S3-compatible service works.
provider = { name = "s3", bucket = "media", region = "auto",             # yours
             endpoint = "https://<account>.r2.cloudflarestorage.com",    # yours
             public_url = "https://media.example.com" }                  # yours
```

Mantén `.env` fora del repositori i fora de la imatge (`.dockerignore`).

## 2. Escriu `render.yaml`

```yaml title="render.yaml"
services:
  - type: web
    name: verdin
    runtime: docker
    repo: https://github.com/<you>/<your-project>   # yours
    branch: main
    dockerfilePath: ./Dockerfile
    region: frankfurt                               # yours
    healthCheckPath: /_ready
    envVars:
      - key: VERDIN_DATABASE_URL
        fromDatabase:
          name: verdin-db
          property: connectionString
      - key: VERDIN_ADMIN_JWT_SECRET
        generateValue: true
      - key: VERDIN_TOKEN_PEPPER
        generateValue: true
      - key: VERDIN_SERVER__PUBLIC_URL
        value: https://verdin.onrender.com          # yours: the service URL or your domain
      - key: AWS_ACCESS_KEY_ID
        sync: false                                 # asked for when you create the Blueprint
      - key: AWS_SECRET_ACCESS_KEY
        sync: false

databases:
  - name: verdin-db
    databaseName: verdin
    user: verdin
    region: frankfurt                               # yours: the same region
    postgresMajorVersion: "17"
```

Afegeix un `plan` al servei i a la base de dades per triar un tipus d'instància (consulta la
pàgina de preus de Render); si no n'hi ha cap, Render fa servir el seu per defecte.

`generateValue: true` crea cada secret un sol cop, quan s'aplica el Blueprint per primera vegada,
i el conserva després. No els regeneris: un `VERDIN_TOKEN_PEPPER` nou fa que tots els tokens
d'API deixin de funcionar.

## 3. Desplega

1. Al tauler de Render, crea un **Blueprint** a partir del repositori i introdueix els valors de
   les variables `sync: false`.
2. Espera el primer desplegament. L'ordre per defecte de la imatge, `start --migrate`, crea les
   taules en el primer inici i aplica les migracions segures en els desplegaments posteriors.
3. Obre `https://<service>.onrender.com/admin/` i registra el primer administrador.

Render envia `SIGTERM` abans d'aturar una instància; Verdin acaba la feina i surt quan el rep.

## Variant: multimèdia en un disc

Per a una sola instància, pots desar les pujades en un disc persistent de Render en lloc d'S3.
Defineix el proveïdor local a `verdin.toml`:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

i afegeix un disc al servei:

```yaml title="render.yaml"
    disk:
      name: verdin-data
      mountPath: /data
      sizeGB: 5
```

Amb un disc, Render no et deixa escalar el servei a diverses instàncies, i els desplegaments
aturen la instància antiga abans que s'iniciï la nova, de manera que cada desplegament té una
breu interrupció. El mateix disc pot contenir una base de dades SQLite
(`sqlite:///data/verdin.db`) si no vols una base de dades de Render. Comprova que l'usuari de la
imatge (uid `65532`) pot escriure al disc; si l'inici falla amb un error de permisos a `/data`,
afegeix `USER root` al teu `Dockerfile`.

## Adreces dels clients

El proxy de Render és davant del servei. El seu rang d'adreces no s'ha verificat per a aquesta
guia, així que `[server].trusted_proxies` es deixa buit: aleshores tots els visitants compten com
la mateixa adreça per als límits de freqüència, de manera que has de mantenir
`[api].public_rate_limit` a `0` tret que trobis el rang del proxy i hi confiïs.
