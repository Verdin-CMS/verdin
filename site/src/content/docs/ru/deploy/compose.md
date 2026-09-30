---
title: Docker Compose в продакшене
description: Продакшен-рецепт Compose для одного сервера — Verdin, PostgreSQL и Caddy с автоматическим HTTPS, а также необязательный RustFS для S3-совместимого хранилища медиа.
sidebar:
  order: 3
---

[`deploy/compose/`](https://github.com/verdin-cms/verdin/tree/main/deploy/compose) — готовая
конфигурация для одного сервера: Verdin и PostgreSQL в закрытой сети, а перед ними Caddy с
сертификатом, который он получает и продлевает сам. Файл переопределения добавляет RustFS —
S3-совместимое хранилище на том же хосте — для медиа. Образ, который используют эти файлы,
описан в разделе [Docker](/ru/deploy/docker/).

Файлы проверены командами `docker compose config` и `caddy validate` 2026-09-30.

## Файлы

| Файл | Что это |
| --- | --- |
| `compose.yaml` | `verdin`, `db` (PostgreSQL 17) и `caddy`. Порты публикует только Caddy (80, 443 и 443/udp для HTTP/3). |
| `compose.s3.yaml` | Добавляет `rustfs` и одноразовое задание, которое создаёт бакет `media` с публичным чтением, и переключает провайдера загрузок Verdin на него. |
| `Caddyfile` | TLS для `$VERDIN_DOMAIN`, сжатие, `/media/*` в RustFS и всё остальное в Verdin. |
| `.env.example` | Переменные, которые читает Compose: домен, email для ACME, тег образа, пароли. |

## Настройка

Что нужно заранее: сервер с Docker, DNS-запись вашего домена, указывающая на него, и
открытые порты 80 и 443.

1. Скопируйте каталог на сервер и заполните `.env`:

   ```sh frame="terminal"
   cp .env.example .env                                  # VERDIN_DOMAIN, ACME_EMAIL
   echo "DB_PASSWORD=$(openssl rand -hex 24)" >> .env
   docker run --rm ghcr.io/verdin-cms/verdin:0.11 secrets > verdin.env
   ```

2. Положите закоммиченную схему в `schema/` (`content-types/` и `components/`). Она
   монтируется только для чтения в `/app/schema`.
3. Запустите:

   ```sh frame="terminal"
   docker compose up -d
   docker compose logs -f verdin
   ```

4. Откройте `https://<your domain>/admin/` и зарегистрируйте первого администратора.

Не добавляйте `.env` и `verdin.env` в систему контроля версий и делайте их резервные копии:
новый `VERDIN_TOKEN_PEPPER` делает недействительными все API-токены.

## Медиа в S3

По умолчанию загрузки попадают в том `verdin-data`. Чтобы хранить их в RustFS:

```sh frame="terminal"
echo "S3_SECRET_KEY=$(openssl rand -hex 24)" >> .env
docker compose -f compose.yaml -f compose.s3.yaml up -d
```

Файлы после этого отдаёт Caddy по адресу `https://<your domain>/media/<key>`. Для AWS S3,
Cloudflare R2 или другого провайдера не подключайте сервисы RustFS и задайте переменные
`VERDIN_UPLOAD__PROVIDER__*` и учётные данные `AWS_*` со значениями этого провайдера (см.
[Хранение](/ru/internals/storage/)). Переключение существующего сайта не переносит файлы:
новые загрузки попадают к новому провайдеру.

## Заметки

- **Адреса клиентов.** Verdin доверяет `X-Forwarded-For` из сети Compose (`172.30.0.0/24`,
  зафиксирована в `compose.yaml`), где Caddy — единственный прокси. Измените оба значения,
  если этот диапазон пересекается с одной из ваших сетей.
- **Реальное время.** Caddy передаёт ответы `text/event-stream` без буферизации, поэтому
  [события реального времени](/ru/guides/frontend/realtime/) работают за ним без изменений.
- **Обновления.** Измените `VERDIN_VERSION` в `.env`, затем выполните
  `docker compose pull && docker compose up -d`. Сначала прочитайте
  [Обновление](/ru/migrate/upgrading/).
- **Резервные копии.** Делайте дамп PostgreSQL и сохраняйте том `verdin-data` (или бакет); см.
  [Резервные копии](/ru/deploy/backups/).
- **Команды администратора.** В образе нет оболочки:
  `docker compose exec verdin verdin admin create --email you@example.com`.
