---
title: Render
description: Розгортання Verdin на Render через Blueprint — вебсервіс Docker, зібраний з вашого репозиторію, база даних Render PostgreSQL і медіа в S3-сумісному сховищі або на диску.
sidebar:
  order: 5
---

На цій сторінці проєкт Verdin розгортається на [Render](https://render.com) через Blueprint
(`render.yaml`): вебсервіс, зібраний із невеликого Dockerfile у вашому репозиторії, і база
даних Render PostgreSQL. Файлова система Render ефемерна, тож медіа йдуть у S3-сумісне
сховище або на постійний диск, якщо ви запускаєте один екземпляр.

:::note
Формат Blueprint звірено з [довідником Blueprint Render](https://render.com/docs/blueprint-spec)
2026-09-29; його не розгортали на реальному обліковому записі Render. Значення, позначені
`# yours`, заповнюєте ви.
:::

Передумови: ваш проєкт Verdin (із `schema/`) у Git-репозиторії, який може читати Render.

## 1. Додайте Dockerfile і конфігурацію

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

Не додавайте `.env` ні до репозиторію, ні до образу (`.dockerignore`).

## 2. Напишіть `render.yaml`

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

Додайте `plan` до сервісу й бази даних, щоб вибрати тип інстансу (див. сторінку цін Render);
без нього Render використовує свій типовий.

`generateValue: true` створює кожен секрет один раз, під час першого застосування Blueprint, і
зберігає його надалі. Не генеруйте їх заново: новий `VERDIN_TOKEN_PEPPER` робить недійсними
всі API-токени.

## 3. Розгортання

1. На панелі Render створіть **Blueprint** з репозиторію й введіть значення для змінних із
   `sync: false`.
2. Дочекайтеся першого розгортання. Типова команда образу, `start --migrate`, створює таблиці
   під час першого запуску й застосовує безпечні міграції під час наступних розгортань.
3. Відкрийте `https://<service>.onrender.com/admin/` і зареєструйте першого адміністратора.

Render надсилає `SIGTERM`, перш ніж зупинити екземпляр; Verdin після цього завершує роботу й
виходить.

## Варіант: медіа на диску

Для одного екземпляра можна зберігати завантаження на постійному диску Render замість S3.
Задайте локального провайдера у `verdin.toml`:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

і додайте диск до сервісу:

```yaml title="render.yaml"
    disk:
      name: verdin-data
      mountPath: /data
      sizeGB: 5
```

З диском Render не дозволяє масштабувати сервіс до кількох екземплярів, а розгортання зупиняє
старий екземпляр до запуску нового, тож кожне розгортання має короткий простій. Той самий диск
може містити базу даних SQLite (`sqlite:///data/verdin.db`), якщо вам не потрібна база даних
Render. Перевірте, що користувач образу (uid `65532`) може писати на диск; якщо запуск падає з
помилкою доступу до `/data`, додайте `USER root` до свого `Dockerfile`.

## Адреси клієнтів

Перед сервісом стоїть проксі Render. Його діапазон адрес для цього посібника не перевірено,
тож `[server].trusted_proxies` залишено порожнім: тоді кожен відвідувач рахується як та сама
адреса для обмежень частоти, тож залишайте `[api].public_rate_limit` рівним `0`, доки не
знайдете діапазон проксі й не довіритеся йому.
