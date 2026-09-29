---
title: Railway
description: Wdróż Verdin na Railway z Dockerfile z twojego repozytorium, z bazą Railway PostgreSQL i multimediami w magazynie zgodnym z S3 lub na wolumenie.
sidebar:
  order: 6
---

Ta strona wdraża projekt Verdin na [Railway](https://railway.com): usługę zbudowaną z małego
Dockerfile w twoim repozytorium, bazę danych Railway PostgreSQL i multimedia w magazynie
zgodnym z S3 (albo na wolumenie w przypadku jednej instancji).

:::note
Ustawienia Railway sprawdzono z [dokumentacją Railway](https://docs.railway.com/reference/config-as-code)
2026-09-29; konfiguracji nie wdrożono na prawdziwym koncie Railway. Wartości oznaczone
`# yours` lub w nawiasach ostrych uzupełniasz sam.
:::

## 1. Dodaj Dockerfile, konfigurację i `railway.json`

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

Polecenie startowe nie jest potrzebne: obraz uruchamia `start --migrate`, które stosuje
bezpieczne migracje przed rozpoczęciem serwowania. Trzymaj `.env` poza repozytorium.

## 2. Utwórz projekt

1. W Railway utwórz projekt ze swojego repozytorium GitHub. Railway znajdzie `railway.json`
   i zbuduje Dockerfile.
2. Dodaj do projektu bazę danych **PostgreSQL**.
3. W **Variables** usługi Verdin dodaj:

   | Zmienna | Wartość |
   | --- | --- |
   | `VERDIN_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (prywatny URL usługi bazy danych; użyj nazwy swojej usługi bazy danych) |
   | `VERDIN_ADMIN_JWT_SECRET` | z `verdin secrets` |
   | `VERDIN_TOKEN_PEPPER` | z `verdin secrets` |
   | `VERDIN_SERVER__PUBLIC_URL` | `https://<your-domain>` |
   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | twoje poświadczenia S3 |

   Wygeneruj oba sekrety lokalnie:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets
   ```

4. W ustawieniach sieciowych usługi kliknij **Generate Domain** i ustaw port docelowy na
   `1337`. Verdin nasłuchuje na `[server].port` i nie odczytuje zmiennej `PORT` z Railway.
5. Wdróż, otwórz `https://<your-domain>/admin/` i zarejestruj pierwszego administratora.

## Wariant: multimedia lub SQLite na wolumenie

W przypadku jednej instancji możesz trzymać przesłane pliki, a nawet bazę danych, na
wolumenie Railway zamontowanym w `/data`:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

z `VERDIN_DATABASE_URL=sqlite:///data/verdin.db`, jeśli rezygnujesz z PostgreSQL. Pamiętaj:

- Usługa z wolumenem nie może mieć replik, a każde ponowne wdrożenie oznacza krótką
  przerwę.
- Railway montuje wolumeny należące do roota, a obraz działa jako uid `65532`. Ustaw zmienną
  usługi `RAILWAY_RUN_UID=0`, aby serwer mógł pisać na wolumen.

## Adresy klientów

Przed usługą stoi brzegowe proxy Railway. Jego zakresu adresów nie zweryfikowano na potrzeby
tego przewodnika, więc `[server].trusted_proxies` pozostaje puste: każdy odwiedzający liczy
się wtedy jako ten sam adres w limitach żądań, więc zostaw `[api].public_rate_limit` na `0`,
chyba że znajdziesz zakres proxy i mu zaufasz.
