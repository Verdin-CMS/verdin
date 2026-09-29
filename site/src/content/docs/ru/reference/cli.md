---
title: Справочник по командной строке
description: Все команды, подкоманды и флаги бинарника verdin — что они читают, записывают и выводят.
sidebar:
  order: 2
  label: Командная строка
---

<!-- Written from crates/verdin/src/cli.rs and crates/verdin/src/new.rs. `npm run check-cli`
(site/scripts/check-cli.mjs) fails when a subcommand or flag in cli.rs is missing here. -->

`verdin` — единственный бинарник: он создаёт проекты, запускает сервер, применяет миграции,
управляет администраторами и переносит контент внутрь и наружу. На этой странице перечислены
все команды и флаги.

```text title="Terminal"
verdin [OPTIONS] <COMMAND>
```

| Команда | Что делает |
| --- | --- |
| [`verdin new`](#verdin-new) | Создаёт каталог проекта. |
| [`verdin dev`](#verdin-dev) | Запускает сервер в режиме разработки. |
| [`verdin start`](#verdin-start) | Запускает сервер в продакшен-режиме. |
| [`verdin schema check`](#verdin-schema-check) | Проверяет файлы схемы. |
| [`verdin migrate plan`](#verdin-migrate-plan) | Показывает шаги миграции и их SQL. |
| [`verdin migrate apply`](#verdin-migrate-apply) | Применяет шаги миграции. |
| [`verdin admin create`](#verdin-admin-create) | Создаёт Super Admin. |
| [`verdin admin reset-password`](#verdin-admin-reset-password) | Задаёт пароль администратора. |
| [`verdin types`](#verdin-types) | Генерирует TypeScript-определения content API. |
| [`verdin import strapi`](#verdin-import-strapi) | Импортирует экспорт Strapi. |
| [`verdin import verdin`](#verdin-import-verdin) | Импортирует экспорт Verdin. |
| [`verdin export`](#verdin-export) | Записывает проект в архив `.tar.gz`. |
| [`verdin healthcheck`](#verdin-healthcheck) | Проверяет, что локальный сервер отвечает. |
| [`verdin secrets`](#verdin-secrets) | Выводит новые секреты. |
| [`verdin version`](#verdin-version) | Выводит версию. |

## Глобальные параметры

| Параметр | По умолчанию | Описание |
| --- | --- | --- |
| `-c, --config <CONFIG>` | `verdin.toml` | Файл конфигурации проекта. Также читается из `VERDIN_CONFIG`. Корень проекта — каталог этого файла: схема, плагины, загрузки и относительные пути SQLite разрешаются относительно него. |
| `-h, --help` | | Выводит справку по команде. |
| `-V, --version` | | Выводит версию. |

`verdin help <COMMAND>` выводит ту же справку, что и `--help`.

Все команды, кроме `new`, `secrets` и `version`, сначала загружают проект:

1. Читают файл `.env` рядом с файлом конфигурации, если он есть. Переменные, уже заданные в
   окружении, имеют приоритет.
2. Загружают `verdin.toml` (необязательный) и переопределения `VERDIN_*`. См.
   [справочник по конфигурации](/ru/reference/configuration/).
3. Начинают писать лог в стандартный поток ошибок с учётом `[log]` и `RUST_LOG`.

Командам, которые открывают базу данных, нужен `VERDIN_DATABASE_URL` или `[database].url`.
Командам, которые работают с учётными записями администраторов или запускают сервер, нужны
также `VERDIN_ADMIN_JWT_SECRET` и `VERDIN_TOKEN_PEPPER`.

## `verdin new`

```text title="Terminal"
verdin new <DIR> [--database <DATABASE>]
```

Создаёт проект в `DIR`, который не должен существовать или должен быть пуст:

| Файл | Содержимое |
| --- | --- |
| `verdin.toml` | `[server]`, `[api]` и `[admin]` со значениями по умолчанию. |
| `.env` | `VERDIN_DATABASE_URL` и новые `VERDIN_ADMIN_JWT_SECRET` и `VERDIN_TOKEN_PEPPER`. Доступен для чтения только вам (режим `0600` в Unix). |
| `.gitignore` | `.env`, `data/`, файлы SQLite и `.cache/`. |
| `schema/content-types/`, `schema/components/` | Пустые каталоги схемы. |
| `data/` | Для базы данных SQLite (только SQLite). |

| Аргумент или параметр | По умолчанию | Описание |
| --- | --- | --- |
| `<DIR>` | | Создаваемый каталог. |
| `--database <DATABASE>` | `sqlite` | База данных, на которую указывает `.env`: `sqlite`, `postgres`, `mysql` или `mariadb`. |

С `sqlite` URL — `sqlite://data/verdin.db`. С остальными это URL локального сервера с
пользователем `verdin`, паролем `change-me` и базой данных, названной по каталогу (строчные
буквы, цифры и `_`): отредактируйте его перед запуском.

```text title="Terminal"
$ verdin new blog --database postgres
created blog

  cd blog
  verdin dev

then open http://localhost:1337/admin/ to register the first admin
```

## `verdin dev`

```text title="Terminal"
verdin dev
```

Запускает сервер в режиме разработки. По сравнению с `verdin start`:

- Ожидающие миграции с уровнем риска `safe` применяются при запуске. Более рискованные шаги
  останавливают сервер; проверьте их через [`verdin migrate plan`](#verdin-migrate-plan).
- **Конструктор типов содержимого** в админ-панели редактирует файлы схемы, и сервер
  перезагружает схему.
- Refresh-cookie не помечается `Secure` (если `[admin].secure_cookies` не говорит иначе),
  поэтому можно входить по обычному HTTP.
- Вебхуки и цели деплоя могут обращаться к loopback и частным адресам (если
  `[webhooks].allow_private_networks` не говорит иначе).

Останавливается по Ctrl+C или `SIGTERM`.

## `verdin start`

```text title="Terminal"
verdin start [--migrate]
```

Запускает сервер в продакшен-режиме. Не запускается, если база данных отстаёт от схемы,
поэтому деплой никогда не меняет таблицы, которые вы не проверили.

| Параметр | Описание |
| --- | --- |
| `--migrate` | Применить ожидающие шаги миграции `safe` перед запуском. Рискованные и разрушительные шаги по-прежнему требуют `verdin migrate apply`. |

Перед тем как начать слушать порт, команда проверяет конфигурацию (`[api].prefix` и
`[admin].path` выглядят как `/api`, размеры страниц согласованы, `[server].trusted_proxies`
и `[api].cors_origins` разбираются) и создаёт встроенные роли. Она пишет предупреждение,
если `[admin].secure_cookies` равно `false` или `[email].provider` равно `log`. Если
администратора ещё нет, она пишет в лог адрес админ-панели, где первый посетитель
регистрирует первого Super Admin.

Останавливается по Ctrl+C или `SIGTERM`.

## `verdin schema check`

```text title="Terminal"
verdin schema check
```

Проверяет файлы схемы (`[schema].path`), не трогая базу данных. Выводит сводку или
завершается с ошибками, у каждой из которых указаны файл и путь атрибута:

```text title="Terminal"
$ verdin schema check
schema ok: 4 content types, 3 components
```

Используйте её в CI перед деплоем. Что принимает каждый атрибут, см. в разделе
[Типы атрибутов](/ru/reference/attribute-types/).

## `verdin migrate plan`

```text title="Terminal"
verdin migrate plan [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Сравнивает базу данных со схемой и выводит, что сделал бы `verdin migrate apply`, ничего не
меняя: пронумерованные шаги, у каждого — уровень риска и SQL. Если делать нечего, выводит
`database is up to date`.

| Параметр | Описание |
| --- | --- |
| `--rename-table <OLD=NEW>` | Считать таблицу `OLD` переименованной в `NEW` (с сохранением строк), а не удалять одну и создавать другую. Можно повторять. |
| `--rename-column <TABLE.OLD=NEW>` | Считать колонку `OLD` таблицы `TABLE` переименованной в `NEW` (с сохранением значений). `TABLE` — новое имя таблицы. Можно повторять. |

Уровни риска:

| Уровень | Значение |
| --- | --- |
| `safe` | Не может потерять данные или упасть на существующих строках: новые таблицы, новые колонки, допускающие NULL или со значением по умолчанию, переименования, неуникальные индексы. |
| `risky` | Может упасть на существующих строках или преобразовать значения: изменения типа колонок, новые колонки без NULL и без значения по умолчанию, уникальные индексы на существующих таблицах. |
| `destructive` | Удаляет колонки или таблицы. |

Если шаг выше `safe`, план заканчивается нужным флагом
(`requires: verdin migrate apply --allow risky`). Если удалённая колонка или таблица похожа
на переименованную, план перечисляет флаги переименования, которые нужно передать. Если
предыдущая миграция была прервана, он показывает, сколько шагов было применено, и последнюю
ошибку.

```text title="Terminal"
verdin migrate plan --rename-column articles.summary=excerpt
```

См. [Миграции схемы](/ru/concepts/schema-migrations/).

## `verdin migrate apply`

```text title="Terminal"
verdin migrate apply [--allow <ALLOW>] [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Применяет план. Принимает те же параметры переименования, что и `verdin migrate plan`;
передавайте те же, что вы проверили.

| Параметр | По умолчанию | Описание |
| --- | --- | --- |
| `--allow <ALLOW>` | `safe` | Максимальный применяемый уровень риска: `safe`, `risky` или `destructive`. План с шагом выше него отклоняется до выполнения. |
| `--rename-table <OLD=NEW>` | | Как в `verdin migrate plan`. |
| `--rename-column <TABLE.OLD=NEW>` | | Как в `verdin migrate plan`. |

Выводит `applied N steps` или `database is up to date`. После прерывания (потеря соединения,
упавший шаг) устраните причину и запустите команду снова: она продолжит с незавершённого
шага.

## `verdin admin create`

```text title="Terminal"
verdin admin create --email <EMAIL>
```

Создаёт Super Admin. Пароль читается из `VERDIN_ADMIN_PASSWORD` или, если она не задана, из
стандартного ввода. База данных должна соответствовать схеме.

| Параметр | Описание |
| --- | --- |
| `--email <EMAIL>` | Адрес email нового администратора. |

```text title="Terminal"
$ VERDIN_ADMIN_PASSWORD='a long passphrase' verdin admin create --email ada@example.com
created Super Admin ada@example.com (id 1)
```

Используйте её, чтобы создать первого администратора сервера, который ещё недоступен из
браузера; иначе его регистрирует первый посетитель админ-панели.

## `verdin admin reset-password`

```text title="Terminal"
verdin admin reset-password --email <EMAIL>
```

Задаёт пароль администратора, разблокирует учётную запись после неудачных попыток входа и
завершает все её сессии. Пароль читается так же, как для `verdin admin create`.

| Параметр | Описание |
| --- | --- |
| `--email <EMAIL>` | Адрес email администратора. |

Вторые факторы она не удаляет; их может сбросить администратор с правом **Управление
пользователями** в **Настройки → Пользователи**.

## `verdin types`

```text title="Terminal"
verdin types [-o <OUT>]
```

Генерирует по схеме TypeScript-определения content API (по одному интерфейсу на тип
содержимого и компонент) и выводит их в стандартный вывод. База данных не нужна.

| Параметр | Описание |
| --- | --- |
| `-o, --out <OUT>` | Записать в этот файл. |

```text title="Terminal"
verdin types --out ../web/src/verdin.d.ts
```

См. [Типизированный клиент](/ru/guides/frontend/typed-client/).

## `verdin import strapi`

```text title="Terminal"
verdin import strapi <PATH> [--schema-only] [--force]
```

Импортирует проект Strapi v4 или v5 из экспорта, сделанного через
`strapi export --no-encrypt`: `.tar.gz`, `.tar` или распакованный каталог. Записывает типы
содержимого и компоненты в виде файлов схемы, затем импортирует записи, локали, медиа, связи
и папки.

| Аргумент или параметр | Описание |
| --- | --- |
| `<PATH>` | Файл или каталог экспорта. |
| `--schema-only` | Только записать файлы схемы. |
| `--force` | Перезаписать существующие файлы схемы и импортировать в типы содержимого, в которых уже есть записи. |

Команда выводит, что записала и импортировала, с предупреждениями о том, что не удалось
перенести, и записывает в корень проекта `strapi-id-map.json`: id из Strapi и их новые
`documentId` и id файлов в Verdin — чтобы исправить ссылки во фронтенде.

См. [Миграция со Strapi](/ru/migrate/from-strapi/).

## `verdin import verdin`

```text title="Terminal"
verdin import verdin <PATH> [--force]
```

Импортирует архив, записанный `verdin export`: файлы схемы, локали, медиа и записи.

| Аргумент или параметр | Описание |
| --- | --- |
| `<PATH>` | Файл `.tar.gz`. |
| `--force` | Перезаписать отличающиеся файлы схемы и импортировать в типы содержимого, в которых уже есть записи. |

## `verdin export`

```text title="Terminal"
verdin export <OUTPUT> [--no-media]
```

Записывает схему, контент и медиа проекта в архив `.tar.gz` — как резервную копию или чтобы
перенести проект на другой экземпляр через `verdin import verdin`. Архив содержит все версии
всех записей (черновики, опубликованные версии, локали) со связями. Учётные записи
администраторов, API-токены и настройки не включаются.

| Аргумент или параметр | Описание |
| --- | --- |
| `<OUTPUT>` | Записываемый архив. |
| `--no-media` | Не включать медиатеку: файлы, папки и ссылки записей на них. |

```text title="Terminal"
$ verdin export backup.tar.gz
exported to backup.tar.gz: 42 documents (57 versions), 18 files, 3 folders, 2 locales
```

См. [Резервные копии](/ru/deploy/backups/).

## `verdin healthcheck`

```text title="Terminal"
verdin healthcheck [--port <PORT>]
```

Запрашивает `GET /_health` у сервера на этой машине (`127.0.0.1`, `[server].port` из
конфигурации) и завершается со статусом 0, если он отвечает `200`, иначе 1, с объяснением
причины. Ей не нужны оболочка, `curl` или HTTP-клиент, поэтому образ Docker использует её как
`HEALTHCHECK`; так же её можно использовать в Compose или любом супервизоре, который
запускает команду.

| Параметр | Описание |
| --- | --- |
| `--port <PORT>` | Проверить этот порт вместо `[server].port`. |

```text title="Terminal"
$ verdin healthcheck
ok
```

См. [Мониторинг](/ru/deploy/monitoring/).

## `verdin secrets`

```text title="Terminal"
verdin secrets
```

Выводит новые `VERDIN_ADMIN_JWT_SECRET` и `VERDIN_TOKEN_PEPPER`, готовые для файла `.env`
или хранилища секретов вашей платформы. Проект не читает.

Смена `VERDIN_ADMIN_JWT_SECRET` аннулирует короткоживущие токены доступа администраторов и
конечных пользователей, открытые ссылки предпросмотра и незавершённые входы через OAuth;
админ-панель и клиенты, использующие refresh-токены, получают новые токены сами. Смена
`VERDIN_TOKEN_PEPPER` делает недействительными сохранённые токены (в том числе API-токены),
поэтому не меняйте его после начала использования.

## `verdin version`

```text title="Terminal"
verdin version
```

Выводит `verdin` и версию, как `verdin --version`.
