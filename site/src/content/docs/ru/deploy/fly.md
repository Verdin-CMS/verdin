---
title: Fly.io
description: Развёртывание Verdin на Fly.io с собственным образом, PostgreSQL и объектным хранилищем Tigris или на одной Machine с SQLite на томе.
sidebar:
  order: 4
---

На этой странице проект Verdin развёртывается на [Fly.io](https://fly.io) в виде небольшого
образа, собранного на основе официального. Рекомендуемая конфигурация не хранит состояния на
Machine: PostgreSQL для базы данных и Tigris (S3-совместимое хранилище Fly) для медиа. Ниже
описан вариант с SQLite на томе.

:::note
Форматы Fly сверены с [документацией Fly](https://docs.fly.io/reference/configuration/)
2026-09-29; на реальной учётной записи Fly эта конфигурация не запускалась. Значения в
угловых скобках и помеченные `# yours` нужно заполнить своими.
:::

Что нужно заранее: [`flyctl`](https://docs.fly.io/flyctl/install/) с выполненным входом и
проект Verdin с закоммиченным каталогом `schema/`.

## 1. Добавьте Dockerfile и конфигурацию

В каталоге проекта добавьте `Dockerfile`, который копирует вашу конфигурацию и схему в
официальный образ (см. [Собственный образ](/ru/deploy/docker/)):

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

и `verdin.toml` для Fly:

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337
public_url = "https://my-verdin.fly.dev"       # yours: the app's URL or your domain

[schema]
path = "schema"

[log]
format = "json"

[upload]
provider = { name = "s3", bucket = "my-verdin-media",   # yours: the bucket name
             region = "auto", endpoint = "https://t3.storage.dev",
             public_url = "https://my-verdin-media.t3.tigrisfiles.io" }
```

Убедитесь, что `.env` не попадает в контекст сборки: добавьте его в `.dockerignore`.

## 2. Напишите `fly.toml`

```toml title="fly.toml"
app = "my-verdin"                # yours
primary_region = "fra"           # yours

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 1337
  force_https = true
  # Keep a Machine running: webhooks, scheduled releases, plugin jobs and the
  # daily digest run inside the server process.
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "30s"
    interval = "15s"
    method = "GET"
    timeout = "5s"
    path = "/_ready"

[[vm]]
  memory = "512mb"               # adjust to your content and traffic
```

Команда образа по умолчанию, `start --migrate`, применяет безопасные миграции при запуске
каждой Machine, поэтому `release_command` не нужен. (Fly выполняет `release_command` на
временной Machine без томов, что для SQLite всё равно бы не сработало.)

## 3. Создайте приложение, базу данных и бакет

1. Создайте приложение, не развёртывая его. `--ha=false` запускает одну Machine; прежде чем
   добавлять ещё, прочитайте [Запуск нескольких экземпляров](/ru/deploy/scaling/).

   ```sh frame="terminal"
   fly launch --no-deploy --copy-config --ha=false
   ```

2. Создайте базу данных PostgreSQL, например в
   [Fly Managed Postgres](https://docs.fly.io/mpg/) или у любого провайдера PostgreSQL, и
   запишите её URL подключения.

3. Создайте публичный бакет Tigris. Команда задаёт `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3` и `BUCKET_NAME` как секреты приложения;
   Verdin читает первые два. Укажите имя бакета в `verdin.toml`.

   ```sh frame="terminal"
   fly storage create --public
   ```

4. Задайте секреты Verdin и URL базы данных:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets | fly secrets import
   fly secrets set VERDIN_DATABASE_URL='postgres://<user>:<password>@<host>:5432/<db>?sslmode=require'
   ```

5. Выполните деплой, затем откройте `https://<app>.fly.dev/admin/` и зарегистрируйте первого
   администратора:

   ```sh frame="terminal"
   fly deploy
   ```

## Адреса клиентов и ограничения частоты

Прокси Fly добавляет клиента в `X-Forwarded-For`, и, согласно
[документации Fly о заголовках запросов](https://docs.fly.io/networking/request-headers/),
крайний правый адрес — это собственный IP вашего приложения. Чтобы Verdin нашёл клиента,
доверьтесь диапазону прокси и адресам вашего приложения (`fly ips list`):

```toml title="verdin.toml"
[server]
trusted_proxies = ["172.16.0.0/12", "<app IPv4>", "<app IPv6>"]
```

На работающем приложении это не проверялось. Пока вы сами это не проверите, оставьте
`[api].public_rate_limit` равным `0`: без правильных прокси все посетители считаются одним
адресом.

## Вариант: одна Machine с SQLite

Для небольшого проекта базу данных и загрузки можно хранить на томе Fly.

- В `verdin.toml` задайте `provider = { name = "local", dir = "/data/uploads" }` в разделе
  `[upload]` (каталог по умолчанию указан относительно `/app`, куда сервер не может писать) и
  задайте `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` как секрет.
- Смонтируйте том в `/data`:

  ```toml title="fly.toml"
  [mounts]
    source = "verdin_data"
    destination = "/data"
    initial_size = "1gb"
  ```

- Запускайте ровно одну Machine (`fly scale count 1`). Том подключается к одной Machine, а
  SQLite нельзя использовать совместно.
- Fly создаёт тома, принадлежащие root, а образ работает под uid `65532`. Если запуск падает
  с ошибкой доступа к `/data`, добавьте `USER root` в свой `Dockerfile`.

Делайте резервные копии тома: Fly хранит ежедневные снимки томов, а `verdin export` даёт
переносимый архив (см. [Резервные копии](/ru/deploy/backups/)).
