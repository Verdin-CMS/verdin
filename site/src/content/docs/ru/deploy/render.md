---
title: Render
description: Развёртывание Verdin на Render через Blueprint — веб-сервис Docker, собранный из вашего репозитория, база данных Render PostgreSQL и медиа в S3-совместимом хранилище или на диске.
sidebar:
  order: 5
---

На этой странице проект Verdin развёртывается на [Render](https://render.com) через Blueprint
(`render.yaml`): веб-сервис, собранный из небольшого Dockerfile в вашем репозитории, и база
данных Render PostgreSQL. Файловая система Render эфемерна, поэтому медиа хранятся в
S3-совместимом хранилище или на постоянном диске, если вы запускаете один экземпляр.

:::note
Формат Blueprint сверен со [справочником Render по Blueprint](https://render.com/docs/blueprint-spec)
2026-09-29; на реальной учётной записи Render эта конфигурация не развёртывалась. Значения,
помеченные `# yours`, нужно заполнить своими.
:::

Что нужно заранее: ваш проект Verdin (с `schema/`) в Git-репозитории, доступном Render.

## 1. Добавьте Dockerfile и конфигурацию

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

Не добавляйте `.env` ни в репозиторий, ни в образ (`.dockerignore`).

## 2. Напишите `render.yaml`

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

Добавьте `plan` к сервису и базе данных, чтобы выбрать тип инстанса (см. страницу цен
Render); без него Render использует значение по умолчанию.

`generateValue: true` создаёт каждый секрет один раз, при первом применении Blueprint, и
дальше сохраняет его. Не генерируйте их заново: новый `VERDIN_TOKEN_PEPPER` ломает все
API-токены.

## 3. Деплой

1. В панели Render создайте **Blueprint** из репозитория и введите значения переменных с
   `sync: false`.
2. Дождитесь первого деплоя. Команда образа по умолчанию, `start --migrate`, создаёт таблицы
   при первом запуске и применяет безопасные миграции при последующих деплоях.
3. Откройте `https://<service>.onrender.com/admin/` и зарегистрируйте первого
   администратора.

Render отправляет `SIGTERM` перед остановкой инстанса; получив его, Verdin завершает работу.

## Вариант: медиа на диске

Для одного экземпляра загрузки можно хранить на постоянном диске Render вместо S3. Задайте
локальный провайдер в `verdin.toml`:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

и добавьте диск к сервису:

```yaml title="render.yaml"
    disk:
      name: verdin-data
      mountPath: /data
      sizeGB: 5
```

С диском Render не позволяет масштабировать сервис на несколько инстансов, а при деплое
старый инстанс останавливается до запуска нового, поэтому каждый деплой сопровождается
коротким простоем. На том же диске можно хранить базу данных SQLite
(`sqlite:///data/verdin.db`), если вам не нужна база данных Render. Проверьте, что
пользователь образа (uid `65532`) может писать на диск; если запуск падает с ошибкой доступа
к `/data`, добавьте `USER root` в свой `Dockerfile`.

## Адреса клиентов

Перед сервисом стоит прокси Render. Его диапазон адресов для этого руководства не
проверялся, поэтому `[server].trusted_proxies` оставлен пустым: тогда все посетители
считаются одним адресом для ограничений частоты, поэтому держите `[api].public_rate_limit`
равным `0`, пока не найдёте диапазон прокси и не добавите его в доверенные.
