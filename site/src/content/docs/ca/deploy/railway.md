---
title: Railway
description: Desplega Verdin a Railway a partir del Dockerfile del teu repositori, amb PostgreSQL de Railway i la multimèdia en un emmagatzematge compatible amb S3 o en un volum.
sidebar:
  order: 6
---

Aquesta pàgina desplega un projecte Verdin a [Railway](https://railway.com): un servei construït
a partir d'un Dockerfile petit del teu repositori, una base de dades PostgreSQL de Railway i la
multimèdia en un emmagatzematge compatible amb S3 (o en un volum per a una sola instància).

:::note
Les opcions de Railway s'han comprovat amb la [documentació de Railway](https://docs.railway.com/reference/config-as-code)
el 29-09-2026; la configuració no s'ha desplegat en un compte real de Railway. Els valors marcats
amb `# yours` o entre angles els has d'omplir tu.
:::

## 1. Afegeix un Dockerfile, una configuració i `railway.json`

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
provider = { name = "s3", bucket = "media", region = "auto",             # yours
             endpoint = "https://<account>.r2.cloudflarestorage.com",    # yours
             public_url = "https://media.example.com" }                  # yours
```

```json title="railway.json"
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "healthcheckPath": "/_ready",
    "healthcheckTimeout": 120,
    "restartPolicyType": "ON_FAILURE"
  }
}
```

No cal cap ordre d'inici: la imatge executa `start --migrate`, que aplica les migracions segures
abans de servir. Mantén `.env` fora del repositori.

## 2. Crea el projecte

1. A Railway, crea un projecte a partir del teu repositori de GitHub. Railway troba
   `railway.json` i construeix el Dockerfile.
2. Afegeix una base de dades **PostgreSQL** al projecte.
3. A les **Variables** del servei Verdin, afegeix:

   | Variable | Valor |
   | --- | --- |
   | `VERDIN_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (la URL privada del servei de base de dades; fes servir el nom del teu servei de base de dades) |
   | `VERDIN_ADMIN_JWT_SECRET` | de `verdin secrets` |
   | `VERDIN_TOKEN_PEPPER` | de `verdin secrets` |
   | `VERDIN_SERVER__PUBLIC_URL` | `https://<your-domain>` |
   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | les teves credencials d'S3 |

   Genera els dos secrets en local:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets
   ```

4. A la configuració de xarxa del servei, fes clic a **Generate Domain** i defineix-ne el port
   de destinació a `1337`. Verdin escolta a `[server].port` i no llegeix la variable `PORT` de
   Railway.
5. Desplega, obre `https://<your-domain>/admin/` i registra el primer administrador.

## Variant: multimèdia o SQLite en un volum

Per a una sola instància, pots guardar les pujades, i fins i tot la base de dades, en un volum de
Railway muntat a `/data`:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

amb `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` si prescindeixes de PostgreSQL. Tingues en
compte que:

- Un servei amb volum no pot tenir rèpliques, i cada redesplegament té una breu interrupció.
- Railway munta els volums amb root com a propietari, i la imatge s'executa amb l'uid `65532`.
  Defineix la variable del servei `RAILWAY_RUN_UID=0` perquè el servidor pugui escriure al volum.

## Adreces dels clients

El proxy d'edge de Railway és davant del servei. El seu rang d'adreces no s'ha verificat per a
aquesta guia, així que `[server].trusted_proxies` es queda buit: aleshores tots els visitants
compten com la mateixa adreça per als límits de freqüència, de manera que has de mantenir
`[api].public_rate_limit` a `0` tret que trobis el rang del proxy i hi confiïs.
