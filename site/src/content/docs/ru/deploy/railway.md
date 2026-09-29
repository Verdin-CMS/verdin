---
title: Railway
description: Развёртывание Verdin на Railway из Dockerfile вашего репозитория, с Railway PostgreSQL и медиа в S3-совместимом хранилище или на томе.
sidebar:
  order: 6
---

На этой странице проект Verdin развёртывается на [Railway](https://railway.com): сервис,
собранный из небольшого Dockerfile в вашем репозитории, база данных Railway PostgreSQL и
медиа в S3-совместимом хранилище (или на томе для одного экземпляра).

:::note
Настройки Railway сверены с [документацией Railway](https://docs.railway.com/reference/config-as-code)
2026-09-29; на реальной учётной записи Railway эта конфигурация не развёртывалась. Значения,
помеченные `# yours` или в угловых скобках, нужно заполнить своими.
:::

## 1. Добавьте Dockerfile, конфигурацию и `railway.json`

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

Команда запуска не нужна: образ выполняет `start --migrate`, который применяет безопасные
миграции перед обслуживанием запросов. Не добавляйте `.env` в репозиторий.

## 2. Создайте проект

1. В Railway создайте проект из своего репозитория GitHub. Railway найдёт `railway.json` и
   соберёт Dockerfile.
2. Добавьте в проект базу данных **PostgreSQL**.
3. В разделе **Variables** сервиса Verdin добавьте:

   | Переменная | Значение |
   | --- | --- |
   | `VERDIN_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (приватный URL сервиса базы данных; подставьте имя своего сервиса базы данных) |
   | `VERDIN_ADMIN_JWT_SECRET` | из `verdin secrets` |
   | `VERDIN_TOKEN_PEPPER` | из `verdin secrets` |
   | `VERDIN_SERVER__PUBLIC_URL` | `https://<your-domain>` |
   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | ваши учётные данные S3 |

   Сгенерируйте два секрета локально:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets
   ```

4. В сетевых настройках сервиса нажмите **Generate Domain** и укажите целевой порт `1337`.
   Verdin слушает `[server].port` и не читает переменную Railway `PORT`.
5. Выполните деплой, откройте `https://<your-domain>/admin/` и зарегистрируйте первого
   администратора.

## Вариант: медиа или SQLite на томе

Для одного экземпляра загрузки и даже базу данных можно хранить на томе Railway,
смонтированном в `/data`:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

с `VERDIN_DATABASE_URL=sqlite:///data/verdin.db`, если вы обходитесь без PostgreSQL. Имейте
в виду:

- У сервиса с томом не может быть реплик, и каждый повторный деплой сопровождается коротким
  простоем.
- Railway монтирует тома, принадлежащие root, а образ работает под uid `65532`. Задайте
  переменную сервиса `RAILWAY_RUN_UID=0`, чтобы сервер мог писать на том.

## Адреса клиентов

Перед сервисом стоит edge-прокси Railway. Его диапазон адресов для этого руководства не
проверялся, поэтому `[server].trusted_proxies` остаётся пустым: тогда все посетители
считаются одним адресом для ограничений частоты, поэтому держите `[api].public_rate_limit`
равным `0`, пока не найдёте диапазон прокси и не добавите его в доверенные.
