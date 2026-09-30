---
title: Docker Compose у production
description: Production-рецепт Compose для одного сервера — Verdin, PostgreSQL і Caddy з автоматичним HTTPS, а також необов'язковий RustFS для S3-сумісних медіа.
sidebar:
  order: 3
---

[`deploy/compose/`](https://github.com/verdin-cms/verdin/tree/main/deploy/compose) — це
готове налаштування для одного сервера: Verdin і PostgreSQL у приватній мережі, а спереду
Caddy із сертифікатом, який він сам отримує й поновлює. Файл перевизначення додає RustFS,
S3-сумісне сховище на тому самому хості, для медіа. [Docker](/uk/deploy/docker/) пояснює
образ, який використовують ці файли.

Файли перевірено через `docker compose config` і `caddy validate` 2026-09-30.

## Файли

| Файл | Що |
| --- | --- |
| `compose.yaml` | `verdin`, `db` (PostgreSQL 17) і `caddy`. Порти публікує лише Caddy (80, 443 і 443/udp для HTTP/3). |
| `compose.s3.yaml` | Додає `rustfs` і одноразове завдання, що створює бакет `media` з публічним читанням, та перемикає на нього провайдера завантажень Verdin. |
| `Caddyfile` | TLS для `$VERDIN_DOMAIN`, стиснення, `/media/*` до RustFS, а все інше до Verdin. |
| `.env.example` | Змінні, які читає Compose: домен, email для ACME, тег образу, паролі. |

## Налаштування

Передумови: сервер із Docker, DNS-запис вашого домену, що вказує на нього, та відкриті порти 80
і 443.

1. Скопіюйте каталог на сервер і заповніть `.env`:

   ```sh frame="terminal"
   cp .env.example .env                                  # VERDIN_DOMAIN, ACME_EMAIL
   echo "DB_PASSWORD=$(openssl rand -hex 24)" >> .env
   docker run --rm ghcr.io/verdin-cms/verdin:0.11 secrets > verdin.env
   ```

2. Покладіть свою закомічену схему в `schema/` (`content-types/` і `components/`). Вона
   монтується лише для читання в `/app/schema`.
3. Запустіть:

   ```sh frame="terminal"
   docker compose up -d
   docker compose logs -f verdin
   ```

4. Відкрийте `https://<your domain>/admin/` і зареєструйте першого адміністратора.

Тримайте `.env` і `verdin.env` поза системою контролю версій і робіть їхні резервні копії: новий
`VERDIN_TOKEN_PEPPER` робить недійсними всі API-токени.

## Медіа в S3

Типово завантаження потрапляють у том `verdin-data`. Щоб натомість зберігати їх у RustFS:

```sh frame="terminal"
echo "S3_SECRET_KEY=$(openssl rand -hex 24)" >> .env
docker compose -f compose.yaml -f compose.s3.yaml up -d
```

Тоді файли віддає Caddy за адресою `https://<your domain>/media/<key>`. Для AWS S3,
Cloudflare R2 чи іншого провайдера не додавайте сервіси RustFS і задайте змінні
`VERDIN_UPLOAD__PROVIDER__*` та облікові дані `AWS_*` зі значеннями цього провайдера (див.
[Сховище](/uk/internals/storage/)). Перемикання наявного сайту не переносить файли: нові
завантаження йдуть до нового провайдера.

## Примітки

- **Адреси клієнтів.** Verdin довіряє `X-Forwarded-For` із мережі Compose (`172.30.0.0/24`,
  зафіксовано в `compose.yaml`), де Caddy — єдиний проксі. Змініть обидва, якщо цей діапазон
  збігається з однією з ваших мереж.
- **Реальний час.** Caddy передає відповіді `text/event-stream` без буферизації, тож
  [події реального часу](/uk/guides/frontend/realtime/) працюють за ним без змін.
- **Оновлення.** Змініть `VERDIN_VERSION` у `.env`, потім `docker compose pull && docker compose up -d`.
  Спершу прочитайте [Оновлення Verdin](/uk/migrate/upgrading/).
- **Резервні копії.** Зробіть дамп PostgreSQL і збережіть том `verdin-data` (або бакет); див.
  [Резервні копії](/uk/deploy/backups/).
- **Команди адміністратора.** В образі немає оболонки: `docker compose exec verdin verdin admin create --email you@example.com`.
