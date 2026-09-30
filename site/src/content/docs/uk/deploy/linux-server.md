---
title: Linux-сервер
description: Запуск Verdin на сервері Debian чи Ubuntu з пакета .deb — служба systemd, системний користувач verdin, стан у /var/lib/verdin — за зворотним проксі.
sidebar:
  order: 3
---

На цій сторінці Verdin запускається безпосередньо на сервері Debian чи Ubuntu, без
контейнерів, з пакета `.deb`, що додається до кожного релізу. Та сама структура працює в інших
дистрибутивах з бінарником зі [скрипта установлення](/uk/start/installation/) і файлами з
[`deploy/deb/`](https://github.com/verdin-cms/verdin/tree/main/deploy/deb), скопійованими
вручну.

Пакет зібрано й перевірено через `cargo deb` 2026-09-30; для цього посібника його не
встановлювали на реальний сервер.

## Що встановлює пакет

| Шлях | Що |
| --- | --- |
| `/usr/bin/verdin` | Бінарник (статичний, адмін-панель вбудовано). |
| `/etc/verdin/verdin.toml` | Конфігурація (conffile: оновлення зберігають ваші правки). |
| `/etc/verdin/verdin.env` | Створюється під час першого встановлення, режим `0640`: свіжі `VERDIN_ADMIN_JWT_SECRET` і `VERDIN_TOKEN_PEPPER`, а також `VERDIN_DATABASE_URL` (типово SQLite). |
| `/var/lib/verdin/` | Домашній каталог системного користувача `verdin`: база даних SQLite, `schema/`, `uploads/`, пошуковий індекс і кеш зображень. |
| `/usr/lib/systemd/system/verdin.service` | Служба, встановлена, але не ввімкнена. |

Служба запускає `verdin -c /etc/verdin/verdin.toml start --migrate` від імені користувача
`verdin`, з пісочницею systemd (система лише для читання, приватний `/tmp`, без нових
привілеїв) і доступом на запис лише до `/var/lib/verdin`. Вона слухає `127.0.0.1:1337`.

## 1. Установлення

```sh frame="terminal"
curl -fsSLO https://github.com/verdin-cms/verdin/releases/download/v0.11.0/verdin_0.11.0-1_amd64.deb
sudo apt install ./verdin_0.11.0-1_amd64.deb
```

На серверах ARM використовуйте `arm64` в імені файлу.

## 2. Налаштування

1. Скопіюйте свою закомічену схему в `/var/lib/verdin/schema/` (`content-types/` і
   `components/`), власник — `verdin`:

   ```sh frame="terminal"
   sudo rsync -a --chown=verdin:verdin schema/ /var/lib/verdin/schema/
   ```

2. Для PostgreSQL, MySQL чи MariaDB відредагуйте `VERDIN_DATABASE_URL` у
   `/etc/verdin/verdin.env`. Залиште обидва секрети: новий `VERDIN_TOKEN_PEPPER` робить
   недійсними всі API-токени.
3. У `/etc/verdin/verdin.toml` задайте `[server].public_url` як адресу, яку використовують
   браузери, і `trusted_proxies = ["127.0.0.1"]`, коли зворотний проксі працює на тій самій
   машині. Усі інші ключі описано в [довіднику конфігурації](/uk/reference/configuration/).

## 3. Запуск

```sh frame="terminal"
sudo systemctl enable --now verdin
journalctl -u verdin -f
```

Перший запуск створює таблиці. Створіть першого адміністратора з командного рядка (файл
середовища служби містить URL бази даних):

```sh frame="terminal"
sudo -u verdin sh -c 'set -a; . /etc/verdin/verdin.env; verdin -c /etc/verdin/verdin.toml admin create --email you@example.com'
```

або відкрийте адмін-панель через свій проксі й зареєструйтеся там.

## 4. Поставте зворотний проксі

Verdin віддає звичайний HTTP на інтерфейсі loopback. З Caddy, який сам отримує й поновлює
сертифікат:

```text title="/etc/caddy/Caddyfile"
cms.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:1337
}
```

nginx теж працює; вимкніть буферизацію для `/api/_events`, щоб події реального часу не
затримувалися (`proxy_buffering off;`).

## Оновлення та видалення

- **Оновлення:** установіть `.deb` наступного релізу через `apt install ./verdin_….deb`. Служба
  перезапускається, якщо працювала, а `start --migrate` застосовує безпечні міграції. Спершу
  прочитайте [Оновлення Verdin](/uk/migrate/upgrading/).
- **Видалення:** `apt remove verdin` зупиняє службу й зберігає дані та конфігурацію;
  `apt purge verdin` також видаляє `/etc/verdin/verdin.env` (секрети). Користувача `verdin` і
  `/var/lib/verdin` пакет ніколи не видаляє: видаліть їх самі, коли матимете
  [резервну копію](/uk/deploy/backups/).
