---
title: Довідник командного рядка
description: Кожна команда, підкоманда й прапорець бінарника verdin — що вони читають, записують і виводять.
sidebar:
  order: 2
  label: Командний рядок
---

<!-- Written from crates/verdin/src/cli.rs and crates/verdin/src/new.rs. `npm run check-cli`
(site/scripts/check-cli.mjs) fails when a subcommand or flag in cli.rs is missing here. -->

`verdin` — єдиний бінарник: він створює проєкти, запускає сервер, застосовує міграції, керує
адміністраторами й переносить вміст туди й назад. На цій сторінці перелічено кожну команду й
прапорець.

```text title="Terminal"
verdin [OPTIONS] <COMMAND>
```

| Команда | Що робить |
| --- | --- |
| [`verdin new`](#verdin-new) | Створює каталог проєкту. |
| [`verdin dev`](#verdin-dev) | Запускає сервер у режимі розробки. |
| [`verdin start`](#verdin-start) | Запускає сервер у production-режимі. |
| [`verdin schema check`](#verdin-schema-check) | Перевіряє файли схеми. |
| [`verdin migrate plan`](#verdin-migrate-plan) | Показує кроки міграції та їхній SQL. |
| [`verdin migrate apply`](#verdin-migrate-apply) | Застосовує кроки міграції. |
| [`verdin admin create`](#verdin-admin-create) | Створює Super Admin. |
| [`verdin admin reset-password`](#verdin-admin-reset-password) | Задає пароль адміністратора. |
| [`verdin types`](#verdin-types) | Генерує TypeScript-визначення API вмісту. |
| [`verdin import strapi`](#verdin-import-strapi) | Імпортує експорт Strapi. |
| [`verdin import verdin`](#verdin-import-verdin) | Імпортує експорт Verdin. |
| [`verdin export`](#verdin-export) | Записує проєкт в архів `.tar.gz`. |
| [`verdin healthcheck`](#verdin-healthcheck) | Перевіряє, що локальний сервер відповідає. |
| [`verdin secrets`](#verdin-secrets) | Виводить нові секрети. |
| [`verdin version`](#verdin-version) | Виводить версію. |

## Глобальні параметри

| Параметр | Типово | Опис |
| --- | --- | --- |
| `-c, --config <CONFIG>` | `verdin.toml` | Файл конфігурації проєкту. Також читається з `VERDIN_CONFIG`. Корінь проєкту — каталог файлу: схема, плагіни, завантаження й відносні шляхи SQLite розв'язуються відносно нього. |
| `-h, --help` | | Вивести довідку для команди. |
| `-V, --version` | | Вивести версію. |

`verdin help <COMMAND>` виводить ту саму довідку, що й `--help`.

Кожна команда, крім `new`, `secrets` і `version`, спершу завантажує проєкт:

1. Читає файл `.env` поруч із файлом конфігурації, якщо він є. Змінні, уже задані в
   середовищі, мають пріоритет.
2. Завантажує `verdin.toml` (необов'язковий) і перевизначення `VERDIN_*`. Див.
   [довідник конфігурації](/uk/reference/configuration/).
3. Починає писати журнал у standard error з `[log]` і `RUST_LOG`.

Команди, що відкривають базу даних, потребують `VERDIN_DATABASE_URL` або `[database].url`.
Команди, що працюють з обліковими записами адміністраторів або запускають сервер, також
потребують `VERDIN_ADMIN_JWT_SECRET` і `VERDIN_TOKEN_PEPPER`.

## `verdin new`

```text title="Terminal"
verdin new <DIR> [--database <DATABASE>]
```

Створює проєкт у `DIR`, який не повинен існувати або має бути порожнім:

| Файл | Вміст |
| --- | --- |
| `verdin.toml` | `[server]`, `[api]` і `[admin]` з типовими значеннями. |
| `.env` | `VERDIN_DATABASE_URL`, а також нові `VERDIN_ADMIN_JWT_SECRET` і `VERDIN_TOKEN_PEPPER`. Доступний для читання лише вам (режим `0600` в Unix). |
| `.gitignore` | `.env`, `data/`, файли SQLite і `.cache/`. |
| `schema/content-types/`, `schema/components/` | Порожні каталоги схеми. |
| `data/` | Для бази даних SQLite (лише SQLite). |

| Аргумент або параметр | Типово | Опис |
| --- | --- | --- |
| `<DIR>` | | Каталог, який треба створити. |
| `--database <DATABASE>` | `sqlite` | База даних, на яку вказує `.env`: `sqlite`, `postgres`, `mysql` або `mariadb`. |

Із `sqlite` URL — це `sqlite://data/verdin.db`. З іншими — URL локального сервера з
користувачем `verdin`, паролем `change-me` і базою даних, названою за каталогом (малі літери,
цифри й `_`): відредагуйте його перед запуском.

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

Запускає сервер у режимі розробки. Порівняно з `verdin start`:

- Міграції з рівнем ризику `safe`, що очікують, застосовуються під час запуску. Ризикованіші
  кроки зупиняють сервер; перегляньте їх через [`verdin migrate plan`](#verdin-migrate-plan).
- **Конструктор типів вмісту** в адмін-панелі редагує файли схеми, а сервер перезавантажує
  схему.
- Refresh cookie не позначається як `Secure` (якщо цього не вимагає `[admin].secure_cookies`),
  тож можна входити через звичайний HTTP.
- Вебхуки й цілі розгортання можуть звертатися до loopback і приватних адрес (якщо
  `[webhooks].allow_private_networks` не каже інакше).

Зупиняється за Ctrl+C або `SIGTERM`.

## `verdin start`

```text title="Terminal"
verdin start [--migrate]
```

Запускає сервер у production-режимі. Він відмовляється запускатися, коли база даних відстає
від схеми, тож розгортання ніколи не змінює таблиці, які ви не переглянули.

| Параметр | Опис |
| --- | --- |
| `--migrate` | Застосувати кроки міграції `safe`, що очікують, перед запуском. Ризиковані й деструктивні кроки однаково потребують `verdin migrate apply`. |

Перш ніж почати слухати, він перевіряє конфігурацію (`[api].prefix` і `[admin].path` мають
вигляд `/api`, розміри сторінок узгоджені, `[server].trusted_proxies` і `[api].cors_origins`
розбираються) і створює вбудовані ролі. Він записує попередження, коли
`[admin].secure_cookies` дорівнює `false` або `[email].provider` — `log`. Коли адміністратора
ще немає, він записує в журнал адресу адмін-панелі, де перший відвідувач реєструє першого
Super Admin.

Зупиняється за Ctrl+C або `SIGTERM`.

## `verdin schema check`

```text title="Terminal"
verdin schema check
```

Перевіряє файли схеми (`[schema].path`), не торкаючись бази даних. Виводить підсумок або
завершується з помилками, кожна з файлом і шляхом атрибута:

```text title="Terminal"
$ verdin schema check
schema ok: 4 content types, 3 components
```

Використовуйте в CI перед розгортанням. Що приймає кожен атрибут, див. у
[Типи атрибутів](/uk/reference/attribute-types/).

## `verdin migrate plan`

```text title="Terminal"
verdin migrate plan [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Порівнює базу даних зі схемою й виводить, що зробив би `verdin migrate apply`, нічого не
змінюючи: пронумеровані кроки, кожен із рівнем ризику й SQL. Виводить `database is up to date`,
коли робити нічого.

| Параметр | Опис |
| --- | --- |
| `--rename-table <OLD=NEW>` | Вважати таблицю `OLD` перейменованою на `NEW` (зберігає її рядки) замість видалення однієї й створення іншої. Можна повторювати. |
| `--rename-column <TABLE.OLD=NEW>` | Вважати колонку `OLD` таблиці `TABLE` перейменованою на `NEW` (зберігає її значення). `TABLE` — нова назва таблиці. Можна повторювати. |

Рівні ризику:

| Рівень | Значення |
| --- | --- |
| `safe` | Не може втратити дані чи зламатися на наявних рядках: нові таблиці, нові колонки, що допускають null або мають типове значення, перейменування, неунікальні індекси. |
| `risky` | Може зламатися на наявних рядках або перетворити значення: зміни типів колонок, нові колонки без null і без типового значення, унікальні індекси на наявних таблицях. |
| `destructive` | Видаляє колонки чи таблиці. |

Коли крок вищий за `safe`, план закінчується потрібним прапорцем
(`requires: verdin migrate apply --allow risky`). Коли видалена колонка чи таблиця схожа на
перейменовану, він перелічує прапорці перейменування, які треба передати. Коли попередню
міграцію було перервано, він показує, скільки кроків застосовано, і останню помилку.

```text title="Terminal"
verdin migrate plan --rename-column articles.summary=excerpt
```

Див. [Міграції схеми](/uk/concepts/schema-migrations/).

## `verdin migrate apply`

```text title="Terminal"
verdin migrate apply [--allow <ALLOW>] [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Застосовує план. Приймає ті самі параметри перейменування, що й `verdin migrate plan`;
передавайте ті, які ви переглянули.

| Параметр | Типово | Опис |
| --- | --- | --- |
| `--allow <ALLOW>` | `safe` | Найвищий рівень ризику для застосування: `safe`, `risky` або `destructive`. План із кроком вище за нього відхиляється ще до виконання. |
| `--rename-table <OLD=NEW>` | | Як у `verdin migrate plan`. |
| `--rename-column <TABLE.OLD=NEW>` | | Як у `verdin migrate plan`. |

Виводить `applied N steps` або `database is up to date`. Після переривання (втрачене
з'єднання, невдалий крок) усуньте причину й запустіть знову: він продовжить із кроку, який не
завершився.

## `verdin admin create`

```text title="Terminal"
verdin admin create --email <EMAIL>
```

Створює Super Admin. Пароль читається з `VERDIN_ADMIN_PASSWORD` або зі стандартного вводу,
якщо змінну не задано. База даних має бути актуальною щодо схеми.

| Параметр | Опис |
| --- | --- |
| `--email <EMAIL>` | Адреса ел. пошти нового адміністратора. |

```text title="Terminal"
$ VERDIN_ADMIN_PASSWORD='a long passphrase' verdin admin create --email ada@example.com
created Super Admin ada@example.com (id 1)
```

Використовуйте, щоб створити першого адміністратора сервера, який ще недоступний у браузері;
інакше його реєструє перший відвідувач адмін-панелі.

## `verdin admin reset-password`

```text title="Terminal"
verdin admin reset-password --email <EMAIL>
```

Задає пароль адміністратора, розблоковує обліковий запис після невдалих входів і завершує всі
його сесії. Пароль читається так само, як для `verdin admin create`.

| Параметр | Опис |
| --- | --- |
| `--email <EMAIL>` | Адреса ел. пошти адміністратора. |

Другі фактори він не прибирає; адміністратор із **Керування користувачами** може скинути їх у
**Налаштування → Користувачі**.

## `verdin types`

```text title="Terminal"
verdin types [-o <OUT>]
```

Генерує зі схеми TypeScript-визначення API вмісту (один інтерфейс на тип вмісту й компонент)
і виводить їх у стандартний вивід. База даних не потрібна.

| Параметр | Опис |
| --- | --- |
| `-o, --out <OUT>` | Записати натомість у цей файл. |

```text title="Terminal"
verdin types --out ../web/src/verdin.d.ts
```

Див. [Типізований клієнт](/uk/guides/frontend/typed-client/).

## `verdin import strapi`

```text title="Terminal"
verdin import strapi <PATH> [--schema-only] [--force]
```

Імпортує проєкт Strapi v4 чи v5 з експорту, зробленого через `strapi export --no-encrypt`:
`.tar.gz`, `.tar` або розпакований каталог. Записує типи вмісту й компоненти як файли схеми,
а потім імпортує записи, локалі, медіа, зв'язки й папки.

| Аргумент або параметр | Опис |
| --- | --- |
| `<PATH>` | Файл або каталог експорту. |
| `--schema-only` | Лише записати файли схеми. |
| `--force` | Перезаписати наявні файли схеми й імпортувати в типи вмісту, що вже мають записи. |

Виводить, що записано й імпортовано, з попередженнями про те, що не вдалося перенести, і
записує `strapi-id-map.json` у корінь проєкту: id Strapi та їхні нові `documentId` і id файлів
Verdin, щоб виправити посилання у фронтенді.

Див. [Міграція зі Strapi](/uk/migrate/from-strapi/).

## `verdin import verdin`

```text title="Terminal"
verdin import verdin <PATH> [--force]
```

Імпортує архів, записаний `verdin export`: файли схеми, локалі, медіа й записи.

| Аргумент або параметр | Опис |
| --- | --- |
| `<PATH>` | Файл `.tar.gz`. |
| `--force` | Перезаписати відмінні файли схеми й імпортувати в типи вмісту, що вже мають записи. |

## `verdin export`

```text title="Terminal"
verdin export <OUTPUT> [--no-media]
```

Записує схему, вміст і медіа проєкту в архів `.tar.gz`: резервна копія або спосіб перенести
проєкт на інший екземпляр через `verdin import verdin`. Архів містить кожну версію кожного
запису (чернетки, опубліковані версії, локалі) з її зв'язками. Облікові записи
адміністраторів, API-токени й налаштування не входять.

| Аргумент або параметр | Опис |
| --- | --- |
| `<OUTPUT>` | Архів для запису. |
| `--no-media` | Не включати медіатеку: файли, папки й посилання записів на них. |

```text title="Terminal"
$ verdin export backup.tar.gz
exported to backup.tar.gz: 42 documents (57 versions), 18 files, 3 folders, 2 locales
```

Див. [Резервні копії](/uk/deploy/backups/).

## `verdin healthcheck`

```text title="Terminal"
verdin healthcheck [--port <PORT>]
```

Запитує `GET /_health` у сервера на цій машині (`127.0.0.1`, `[server].port` з конфігурації) і
завершується зі статусом 0, коли він відповідає `200`, інакше — 1, виводячи причину. Йому не
потрібні shell, `curl` чи HTTP-клієнт, тож образ Docker використовує його як свій
`HEALTHCHECK`; використовуйте його так само в Compose чи будь-якому супервізорі, що запускає
команду.

| Параметр | Опис |
| --- | --- |
| `--port <PORT>` | Перевірити цей порт замість `[server].port`. |

```text title="Terminal"
$ verdin healthcheck
ok
```

Див. [Моніторинг](/uk/deploy/monitoring/).

## `verdin secrets`

```text title="Terminal"
verdin secrets
```

Виводить нові `VERDIN_ADMIN_JWT_SECRET` і `VERDIN_TOKEN_PEPPER`, готові для файлу `.env` чи
сховища секретів вашої платформи. Проєкт не читає.

Зміна `VERDIN_ADMIN_JWT_SECRET` анулює короткочасні access tokens адміністраторів і кінцевих
користувачів, відкриті посилання попереднього перегляду та входи через OAuth, що тривають;
адмін-панель і клієнти, що використовують refresh tokens, отримують нові самі. Зміна
`VERDIN_TOKEN_PEPPER` робить недійсними збережені токени (зокрема API-токени), тож не змінюйте
його після початку використання.

## `verdin version`

```text title="Terminal"
verdin version
```

Виводить `verdin` і версію, як `verdin --version`.
