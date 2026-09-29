---
title: Railway
description: Розгортання Verdin на Railway з Dockerfile вашого репозиторію, з Railway PostgreSQL і медіа в S3-сумісному сховищі або на томі.
sidebar:
  order: 6
---

На цій сторінці проєкт Verdin розгортається на [Railway](https://railway.com): сервіс, зібраний
із невеликого Dockerfile у вашому репозиторії, база даних Railway PostgreSQL і медіа в
S3-сумісному сховищі (або на томі для одного екземпляра).

:::note
Налаштування Railway звірено з [документацією Railway](https://docs.railway.com/reference/config-as-code)
2026-09-29; конфігурацію не розгортали на реальному обліковому записі Railway. Значення,
позначені `# yours` або в кутових дужках, заповнюєте ви.
:::

## 1. Додайте Dockerfile, конфігурацію та `railway.json`

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

Команда запуску не потрібна: образ запускає `start --migrate`, що застосовує безпечні міграції
перед обслуговуванням. Не додавайте `.env` до репозиторію.

## 2. Створіть проєкт

1. У Railway створіть проєкт зі свого репозиторію GitHub. Railway знаходить `railway.json` і
   збирає Dockerfile.
2. Додайте до проєкту базу даних **PostgreSQL**.
3. У **Variables** сервісу Verdin додайте:

   | Змінна | Значення |
   | --- | --- |
   | `VERDIN_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (приватний URL сервісу бази даних; використайте назву свого сервісу бази даних) |
   | `VERDIN_ADMIN_JWT_SECRET` | з `verdin secrets` |
   | `VERDIN_TOKEN_PEPPER` | з `verdin secrets` |
   | `VERDIN_SERVER__PUBLIC_URL` | `https://<your-domain>` |
   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | ваші облікові дані S3 |

   Згенеруйте два секрети локально:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets
   ```

4. У мережевих налаштуваннях сервісу натисніть **Generate Domain** і задайте цільовий порт
   `1337`. Verdin слухає `[server].port` і не читає змінну Railway `PORT`.
5. Розгорніть, відкрийте `https://<your-domain>/admin/` і зареєструйте першого адміністратора.

## Варіант: медіа або SQLite на томі

Для одного екземпляра можна тримати завантаження, і навіть базу даних, на томі Railway,
змонтованому в `/data`:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

з `VERDIN_DATABASE_URL=sqlite:///data/verdin.db`, якщо обходитеся без PostgreSQL. Майте на
увазі:

- Сервіс із томом не може мати реплік, і кожне повторне розгортання має короткий простій.
- Railway монтує томи, що належать root, а образ працює від uid `65532`. Задайте змінну сервісу
  `RAILWAY_RUN_UID=0`, щоб сервер міг писати на том.

## Адреси клієнтів

Перед сервісом стоїть edge-проксі Railway. Його діапазон адрес для цього посібника не
перевірено, тож `[server].trusted_proxies` залишається порожнім: тоді кожен відвідувач
рахується як та сама адреса для обмежень частоти, тож залишайте `[api].public_rate_limit`
рівним `0`, доки не знайдете діапазон проксі й не довіритеся йому.
