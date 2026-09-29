---
title: Render
description: Deploye Verdin mit einem Blueprint auf Render – ein Docker-Webservice aus deinem Repository, eine Render-PostgreSQL-Datenbank und Medien auf S3-kompatiblem Speicher oder einer Disk.
sidebar:
  order: 5
---

Diese Seite deployt ein Verdin-Projekt mit einem Blueprint (`render.yaml`) auf
[Render](https://render.com): ein Webservice, der aus einem kleinen Dockerfile in deinem
Repository gebaut wird, und eine Render-PostgreSQL-Datenbank. Das Dateisystem von Render ist
flüchtig, Medien kommen also auf S3-kompatiblen Speicher oder, wenn du eine einzige Instanz
betreibst, auf eine persistente Disk.

:::note
Das Blueprint-Format wurde am 29.09.2026 mit der
[Blueprint-Referenz von Render](https://render.com/docs/blueprint-spec) abgeglichen; es wurde
nicht auf einem echten Render-Konto deployt. Mit `# yours` markierte Werte füllst du selbst
aus.
:::

Voraussetzungen: dein Verdin-Projekt (mit `schema/`) in einem Git-Repository, das Render lesen
kann.

## 1. Ein Dockerfile und eine Konfiguration hinzufügen

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

Halte `.env` aus dem Repository und aus dem Image heraus (`.dockerignore`).

## 2. `render.yaml` schreiben

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

Füge Service und Datenbank einen `plan` hinzu, um einen Instanztyp zu wählen (siehe die
Preisseite von Render); ohne Angabe nimmt Render seinen Standard.

`generateValue: true` erzeugt jedes Secret einmal, wenn der Blueprint zum ersten Mal angewendet
wird, und behält es danach. Erzeuge sie nicht neu: Ein neuer `VERDIN_TOKEN_PEPPER` macht jedes
API-Token unbrauchbar.

## 3. Deployen

1. Leg im Render-Dashboard einen **Blueprint** aus dem Repository an und gib die Werte für die
   Variablen mit `sync: false` ein.
2. Warte auf das erste Deploy. Der Standardbefehl des Images, `start --migrate`, legt beim
   ersten Start die Tabellen an und wendet bei späteren Deploys sichere Migrationen an.
3. Öffne `https://<service>.onrender.com/admin/` und registriere den ersten Admin.

Render schickt `SIGTERM`, bevor es eine Instanz stoppt; Verdin schließt daraufhin ab und
beendet sich.

## Variante: Medien auf einer Disk

Für eine einzelne Instanz kannst du Uploads statt in S3 auf einer persistenten Disk von Render
speichern. Setze in `verdin.toml` den lokalen Provider:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

und füge dem Service eine Disk hinzu:

```yaml title="render.yaml"
    disk:
      name: verdin-data
      mountPath: /data
      sizeGB: 5
```

Mit einer Disk lässt Render den Service nicht auf mehrere Instanzen skalieren, und Deploys
stoppen die alte Instanz, bevor die neue startet, jedes Deploy bringt also eine kurze
Ausfallzeit. Dieselbe Disk kann eine SQLite-Datenbank aufnehmen (`sqlite:///data/verdin.db`),
wenn du keine Render-Datenbank willst. Prüfe, ob der Benutzer des Images (UID `65532`) auf die
Disk schreiben kann; scheitert der Start mit einem Berechtigungsfehler auf `/data`, füge
`USER root` zu deinem `Dockerfile` hinzu.

## Client-Adressen

Der Proxy von Render sitzt vor dem Service. Sein Adressbereich wurde für diese Anleitung nicht
überprüft, deshalb bleibt `[server].trusted_proxies` leer: Jeder Besucher zählt dann für Rate
Limits als dieselbe Adresse. Lass `[api].public_rate_limit` also auf `0`, außer du findest den
Bereich des Proxys heraus und vertraust ihm.
