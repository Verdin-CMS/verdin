---
title: Railway
description: Deploye Verdin auf Railway aus dem Dockerfile deines Repositorys, mit Railway PostgreSQL und Medien auf S3-kompatiblem Speicher oder einem Volume.
sidebar:
  order: 6
---

Diese Seite deployt ein Verdin-Projekt auf [Railway](https://railway.com): ein Service, der aus
einem kleinen Dockerfile in deinem Repository gebaut wird, eine Railway-PostgreSQL-Datenbank und
Medien auf S3-kompatiblem Speicher (oder einem Volume für eine einzelne Instanz).

:::note
Die Einstellungen von Railway wurden am 29.09.2026 mit der
[Dokumentation von Railway](https://docs.railway.com/reference/config-as-code) abgeglichen; das
Setup wurde nicht auf einem echten Railway-Konto deployt. Mit `# yours` markierte Werte und
Werte in spitzen Klammern füllst du selbst aus.
:::

## 1. Ein Dockerfile, eine Konfiguration und `railway.json` hinzufügen

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

Ein Startbefehl ist nicht nötig: Das Image führt `start --migrate` aus, das vor dem Ausliefern
sichere Migrationen anwendet. Halte `.env` aus dem Repository heraus.

## 2. Das Projekt anlegen

1. Leg in Railway ein Projekt aus deinem GitHub-Repository an. Railway findet `railway.json`
   und baut das Dockerfile.
2. Füge dem Projekt eine **PostgreSQL**-Datenbank hinzu.
3. Füge unter **Variables** des Verdin-Service hinzu:

   | Variable | Wert |
   | --- | --- |
   | `VERDIN_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (die private URL des Datenbank-Service; nimm den Namen deines Datenbank-Service) |
   | `VERDIN_ADMIN_JWT_SECRET` | aus `verdin secrets` |
   | `VERDIN_TOKEN_PEPPER` | aus `verdin secrets` |
   | `VERDIN_SERVER__PUBLIC_URL` | `https://<your-domain>` |
   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | deine S3-Zugangsdaten |

   Erzeuge die beiden Secrets lokal:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets
   ```

4. Klicke in den Netzwerkeinstellungen des Service auf **Generate Domain** und setze den
   Zielport auf `1337`. Verdin lauscht auf `[server].port` und liest die Railway-Variable
   `PORT` nicht.
5. Deploye, öffne `https://<your-domain>/admin/` und registriere den ersten Admin.

## Variante: Medien oder SQLite auf einem Volume

Für eine einzelne Instanz kannst du Uploads und sogar die Datenbank auf einem Railway-Volume
halten, das unter `/data` eingebunden ist:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

mit `VERDIN_DATABASE_URL=sqlite:///data/verdin.db`, wenn du auf PostgreSQL verzichtest. Bedenke:

- Ein Service mit Volume kann keine Replicas haben, und jedes Redeploy bringt eine kurze
  Ausfallzeit.
- Railway bindet Volumes mit root als Eigentümer ein, und das Image läuft als UID `65532`.
  Setze die Service-Variable `RAILWAY_RUN_UID=0`, damit der Server auf das Volume schreiben
  kann.

## Client-Adressen

Der Edge-Proxy von Railway sitzt vor dem Service. Sein Adressbereich wurde für diese Anleitung
nicht überprüft, deshalb bleibt `[server].trusted_proxies` leer: Jeder Besucher zählt dann für
Rate Limits als dieselbe Adresse. Lass `[api].public_rate_limit` also auf `0`, außer du findest
den Bereich des Proxys heraus und vertraust ihm.
