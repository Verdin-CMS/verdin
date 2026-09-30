---
title: Linux-сервер
description: Запуск Verdin на сервере Debian или Ubuntu из пакета .deb — служба systemd, системный пользователь verdin, состояние в /var/lib/verdin — за обратным прокси.
sidebar:
  order: 3
---

На этой странице Verdin запускается прямо на сервере Debian или Ubuntu, без контейнеров, из
пакета `.deb`, который прикладывается к каждому релизу. Та же раскладка подходит для других
дистрибутивов: возьмите бинарник из [скрипта установки](/ru/start/installation/) и вручную
скопируйте файлы из
[`deploy/deb/`](https://github.com/verdin-cms/verdin/tree/main/deploy/deb).

Пакет собран и проверен командой `cargo deb` 2026-09-30; для этого руководства на реальный
сервер он не устанавливался.

## Что устанавливает пакет

| Путь | Что это |
| --- | --- |
| `/usr/bin/verdin` | Бинарник (статический, админ-панель встроена). |
| `/etc/verdin/verdin.toml` | Конфигурация (conffile: при обновлениях ваши правки сохраняются). |
| `/etc/verdin/verdin.env` | Создаётся при первой установке, режим `0640`: новые `VERDIN_ADMIN_JWT_SECRET` и `VERDIN_TOKEN_PEPPER`, а также `VERDIN_DATABASE_URL` (по умолчанию SQLite). |
| `/var/lib/verdin/` | Домашний каталог системного пользователя `verdin`: база данных SQLite, `schema/`, `uploads/`, поисковый индекс и кеш изображений. |
| `/usr/lib/systemd/system/verdin.service` | Служба: установлена, но не включена. |

Служба запускает `verdin -c /etc/verdin/verdin.toml start --migrate` от пользователя
`verdin` с песочницей systemd (система только для чтения, приватный `/tmp`, без новых
привилегий) и правом записи только в `/var/lib/verdin`. Она слушает `127.0.0.1:1337`.

## 1. Установите

```sh frame="terminal"
curl -fsSLO https://github.com/verdin-cms/verdin/releases/download/v0.11.0/verdin_0.11.0-1_amd64.deb
sudo apt install ./verdin_0.11.0-1_amd64.deb
```

На серверах ARM используйте в имени файла `arm64`.

## 2. Настройте

1. Скопируйте закоммиченную схему в `/var/lib/verdin/schema/` (`content-types/` и
   `components/`), владелец — `verdin`:

   ```sh frame="terminal"
   sudo rsync -a --chown=verdin:verdin schema/ /var/lib/verdin/schema/
   ```

2. Для PostgreSQL, MySQL или MariaDB измените `VERDIN_DATABASE_URL` в
   `/etc/verdin/verdin.env`. Оставьте оба секрета: новый `VERDIN_TOKEN_PEPPER` делает
   недействительными все API-токены.
3. В `/etc/verdin/verdin.toml` задайте `[server].public_url` — адрес, который используют
   браузеры, — и `trusted_proxies = ["127.0.0.1"]`, если обратный прокси работает на той же
   машине. Все остальные ключи описаны в [справочнике по конфигурации](/ru/reference/configuration/).

## 3. Запустите

```sh frame="terminal"
sudo systemctl enable --now verdin
journalctl -u verdin -f
```

Первый запуск создаёт таблицы. Создайте первого администратора из командной строки (файл
окружения службы содержит URL базы данных):

```sh frame="terminal"
sudo -u verdin sh -c 'set -a; . /etc/verdin/verdin.env; verdin -c /etc/verdin/verdin.toml admin create --email you@example.com'
```

или откройте админ-панель через свой прокси и зарегистрируйтесь там.

## 4. Поставьте обратный прокси

Verdin отдаёт обычный HTTP на интерфейсе loopback. С Caddy, который сам получает и продлевает
сертификат:

```text title="/etc/caddy/Caddyfile"
cms.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:1337
}
```

nginx тоже подходит; отключите буферизацию для `/api/_events`, чтобы события реального
времени не задерживались (`proxy_buffering off;`).

## Обновления и удаление

- **Обновление:** установите `.deb` следующего релиза командой `apt install ./verdin_….deb`.
  Служба перезапускается, если была запущена, а `start --migrate` применяет безопасные
  миграции. Сначала прочитайте [Обновление](/ru/migrate/upgrading/).
- **Удаление:** `apt remove verdin` останавливает службу и сохраняет данные и конфигурацию;
  `apt purge verdin` также удаляет `/etc/verdin/verdin.env` (секреты). Пользователя `verdin` и
  `/var/lib/verdin` пакет не удаляет никогда: удалите их сами, когда у вас будет
  [резервная копия](/ru/deploy/backups/).
