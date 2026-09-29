---
title: Render
description: Wdróż Verdin na Render za pomocą Blueprintu — usługa webowa Docker zbudowana z twojego repozytorium, baza danych Render PostgreSQL i multimedia w magazynie zgodnym z S3 lub na dysku.
sidebar:
  order: 5
---

Ta strona wdraża projekt Verdin na [Render](https://render.com) za pomocą Blueprintu
(`render.yaml`): usługa webowa zbudowana z małego Dockerfile w twoim repozytorium i baza
danych Render PostgreSQL. System plików Render jest ulotny, więc multimedia trafiają do
magazynu zgodnego z S3 albo na trwały dysk, jeśli uruchamiasz jedną instancję.

:::note
Format Blueprintu sprawdzono z [dokumentacją Blueprintów Render](https://render.com/docs/blueprint-spec)
2026-09-29; nie wdrożono go na prawdziwym koncie Render. Wartości oznaczone `# yours`
uzupełniasz sam.
:::

Wymagania: twój projekt Verdin (z `schema/`) w repozytorium Git, które Render może odczytać.

## 1. Dodaj Dockerfile i konfigurację

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

Trzymaj `.env` poza repozytorium i poza obrazem (`.dockerignore`).

## 2. Napisz `render.yaml`

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

Dodaj `plan` do usługi i bazy danych, aby wybrać typ instancji (zobacz cennik Render); bez
niego Render używa swojego domyślnego.

`generateValue: true` tworzy każdy sekret raz, przy pierwszym zastosowaniu Blueprintu,
i potem go zachowuje. Nie generuj ich ponownie: nowy `VERDIN_TOKEN_PEPPER` sprawia, że
przestaje działać każdy token API.

## 3. Wdróż

1. W panelu Render utwórz **Blueprint** z repozytorium i podaj wartości zmiennych
   `sync: false`.
2. Poczekaj na pierwsze wdrożenie. Domyślne polecenie obrazu, `start --migrate`, tworzy
   tabele przy pierwszym starcie i stosuje bezpieczne migracje przy kolejnych wdrożeniach.
3. Otwórz `https://<service>.onrender.com/admin/` i zarejestruj pierwszego administratora.

Render wysyła `SIGTERM` przed zatrzymaniem instancji; Verdin kończy pracę i wychodzi.

## Wariant: multimedia na dysku

W przypadku jednej instancji możesz przechowywać przesłane pliki na trwałym dysku Render
zamiast w S3. Ustaw dostawcę lokalnego w `verdin.toml`:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

i dodaj dysk do usługi:

```yaml title="render.yaml"
    disk:
      name: verdin-data
      mountPath: /data
      sizeGB: 5
```

Z dyskiem Render nie pozwala skalować usługi do kilku instancji, a wdrożenia zatrzymują
starą instancję przed startem nowej, więc każde wdrożenie oznacza krótką przerwę. Ten sam
dysk może zawierać bazę SQLite (`sqlite:///data/verdin.db`), jeśli nie chcesz bazy danych
Render. Sprawdź, czy użytkownik obrazu (uid `65532`) może pisać na dysk; jeśli start kończy
się błędem uprawnień do `/data`, dodaj `USER root` do swojego `Dockerfile`.

## Adresy klientów

Przed usługą stoi proxy Render. Jego zakresu adresów nie zweryfikowano na potrzeby tego
przewodnika, więc `[server].trusted_proxies` pozostaje puste: każdy odwiedzający liczy się
wtedy jako ten sam adres w limitach żądań, więc zostaw `[api].public_rate_limit` na `0`,
chyba że znajdziesz zakres proxy i mu zaufasz.
