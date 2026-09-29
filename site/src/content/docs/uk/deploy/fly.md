---
title: Fly.io
description: Розгортання Verdin на Fly.io з власним образом, PostgreSQL і об'єктним сховищем Tigris або на одній Machine із SQLite на томі.
sidebar:
  order: 4
---

На цій сторінці проєкт Verdin розгортається на [Fly.io](https://fly.io) як невеликий образ,
зібраний поверх офіційного. Рекомендована конфігурація не зберігає стан на Machine:
PostgreSQL для бази даних і Tigris (S3-сумісне сховище Fly) для медіа. Далі наведено варіант
із SQLite на томі.

:::note
Формати Fly звірено з [документацією Fly](https://docs.fly.io/reference/configuration/)
2026-09-29; конфігурацію не запускали на реальному обліковому записі Fly. Значення в кутових
дужках і позначені `# yours` заповнюєте ви.
:::

Передумови: [`flyctl`](https://docs.fly.io/flyctl/install/) з виконаним входом і проєкт Verdin
із закоміченим каталогом `schema/`.

## 1. Додайте Dockerfile і конфігурацію

У каталозі проєкту додайте `Dockerfile`, що копіює вашу конфігурацію та схему в офіційний
образ (див. [Власний образ](/uk/deploy/docker/)):

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

і `verdin.toml` для Fly:

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

Переконайтеся, що `.env` не потрапляє в контекст збірки: додайте його до `.dockerignore`.

## 2. Напишіть `fly.toml`

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

Типова команда образу, `start --migrate`, застосовує безпечні міграції під час запуску кожної
Machine, тож `release_command` не потрібна. (Fly запускає `release_command` у тимчасовій
Machine без томів, що однаково не працювало б для SQLite.)

## 3. Створіть застосунок, базу даних і бакет

1. Створіть застосунок без розгортання. `--ha=false` починає з однієї Machine; перш ніж додавати
   інші, прочитайте [Кілька екземплярів](/uk/deploy/scaling/).

   ```sh frame="terminal"
   fly launch --no-deploy --copy-config --ha=false
   ```

2. Створіть базу даних PostgreSQL, наприклад через
   [Fly Managed Postgres](https://docs.fly.io/mpg/) або в будь-якого провайдера PostgreSQL, і
   запишіть її URL підключення.

3. Створіть публічний бакет Tigris. Команда задає `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3` і `BUCKET_NAME` як секрети застосунку;
   Verdin читає перші два. Впишіть назву бакета у `verdin.toml`.

   ```sh frame="terminal"
   fly storage create --public
   ```

4. Задайте секрети Verdin і URL бази даних:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets | fly secrets import
   fly secrets set VERDIN_DATABASE_URL='postgres://<user>:<password>@<host>:5432/<db>?sslmode=require'
   ```

5. Розгорніть, потім відкрийте `https://<app>.fly.dev/admin/` і зареєструйте першого
   адміністратора:

   ```sh frame="terminal"
   fly deploy
   ```

## Адреси клієнтів і обмеження частоти

Проксі Fly додає клієнта до `X-Forwarded-For`, і, згідно з
[документацією Fly про заголовки запитів](https://docs.fly.io/networking/request-headers/),
крайня права адреса — це власна IP-адреса вашого застосунку. Щоб Verdin знаходив клієнта,
довіртеся діапазону проксі та адресам вашого застосунку (`fly ips list`):

```toml title="verdin.toml"
[server]
trusted_proxies = ["172.16.0.0/12", "<app IPv4>", "<app IPv6>"]
```

Це не перевірено на запущеному застосунку. Доки ви не перевірите, залишайте
`[api].public_rate_limit` рівним `0`: без правильних проксі кожен відвідувач рахується як та
сама адреса.

## Варіант: одна Machine із SQLite

Для невеликого проєкту можна натомість тримати базу даних і завантаження на томі Fly.

- У `verdin.toml` задайте `provider = { name = "local", dir = "/data/uploads" }` у розділі
  `[upload]` (типовий каталог відносний до `/app`, куди сервер не може писати) і задайте
  `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` як секрет.
- Змонтуйте том у `/data`:

  ```toml title="fly.toml"
  [mounts]
    source = "verdin_data"
    destination = "/data"
    initial_size = "1gb"
  ```

- Запускайте рівно одну Machine (`fly scale count 1`). Том під'єднується до однієї Machine, а
  SQLite не можна спільно використовувати.
- Fly створює томи, що належать root, а образ працює від uid `65532`. Якщо запуск падає з
  помилкою доступу до `/data`, додайте `USER root` до свого `Dockerfile`.

Робіть резервні копії тому: Fly зберігає щоденні знімки томів, а `verdin export` дає переносний
архів (див. [Резервні копії](/uk/deploy/backups/)).
