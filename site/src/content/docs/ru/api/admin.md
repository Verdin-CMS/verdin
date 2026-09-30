---
title: "Admin API"
description: "API, на котором работает админ-панель Verdin, для автоматизации: вход, сессии, соглашения и основные группы маршрутов."
sidebar:
  order: 4
  label: "Админка"
---

Админ-панель — это клиент admin API, который доступен по адресу `{admin.path}/api`
(по умолчанию `/admin/api`). Всё, что делает панель, может сделать и скрипт: создавать
администраторов и API-токены, настраивать вебхуки и функции, управлять локалями, работать с
черновиками и релизами. На этой странице описано, как пройти аутентификацию, и перечислены
группы маршрутов.

:::caution[Стабильность]
До Verdin 1.0 admin API не даёт гарантий стабильности: маршруты и тела запросов могут
меняться в минорных релизах, и changelog перечисляет не все изменения. Для чтения и записи
контента лучше используйте [REST](/ru/api/rest/) или [GraphQL](/ru/api/graphql/) API с
[API-токеном](/ru/guides/auth/api-tokens/). Контракт стабильности для всех API запланирован
на версию 1.0.
:::

## Вход

У admin API пока нет API-токенов: скрипт входит как пользователь-администратор, в идеале с
ролью, которая разрешает только то, что скрипту нужно.

```sh title="Terminal"
curl -s -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"bot@example.com","password":"…"}'
```

```json
{
  "data": {
    "user": { "id": 3, "email": "bot@example.com", "…": "…" },
    "accessToken": "eyJhbGciOiJIUzI1NiIs…",
    "accessTokenExpiresAt": "2026-09-29T10:15:00.000Z"
  }
}
```

Передавайте токен доступа во всех остальных запросах:

```sh title="Terminal"
curl -H "Authorization: Bearer $ACCESS_TOKEN" 'https://cms.example.com/admin/api/system/info'
```

| Учётные данные | Срок действия | Где |
| --- | --- | --- |
| Токен доступа (JWT) | 15 минут | Тело ответа. Передавайте его как `Authorization: Bearer …`. |
| Refresh-токен | 30 дней | Cookie `verdin_refresh` (`HttpOnly`, `SameSite=Strict`, путь `/admin/api/auth`, `Secure` при `verdin start`). |

Чтобы получить новый токен доступа, вызовите `POST /admin/api/auth/refresh` с cookie и
заголовком `X-Verdin-CSRF` (любое значение). Ответ такой же, как при входе, а refresh-токен
ротируется: сохраните новую cookie, потому что повторное предъявление уже использованного
refresh-токена завершает всю сессию. `POST /admin/api/auth/logout` с тем же заголовком
завершает сессию.

```sh title="Terminal"
curl -s -b cookies.txt -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/refresh' \
  -H 'X-Verdin-CSRF: 1'
```

- **Двухфакторная аутентификация.** Для учётной записи со вторым фактором вход отвечает
  `{ "data": { "twoFactorRequired": true, "twoFactorToken": "…", "methods": ["totp"] } }`.
  Завершите вход через `POST /admin/api/auth/login/two-factor` с
  `{ "twoFactorToken": "…", "code": "123456" }` (код TOTP или резервный код). См.
  [Двухфакторная аутентификация](/ru/guides/auth/two-factor/).
- **Ограничения частоты.** Вход и регистрация ограничены для каждого IP клиента параметром
  `[admin].auth_rate_limit` (по умолчанию 20 в минуту); у обновлений токена лимит больше.
- **Ошибки.** Неверные учётные данные, неизвестные и заблокированные учётные записи
  отвечают одинаково: `400 Invalid credentials`. Пять неверных паролей блокируют учётную
  запись на 15 минут.
- **Первый администратор.** На новом экземпляре `POST /admin/api/auth/register-first-admin`
  создаёт Super Admin; это работает, только пока нет ни одного администратора.
  `verdin admin create` делает то же самое из командной строки.

## Соглашения

- Тела запросов и ответы — в JSON. Ответы оборачивают результат в `data`
  (`{ "data": … }`); маршруты контента также возвращают `meta`, как REST API.
- Маршруты контента принимают тела вида `{ "data": { … } }`, как REST API. Маршруты
  настроек принимают обычные JSON-объекты.
- Ошибки имеют [формат ошибок REST](/ru/api/rest/#ошибки). Маршрут выключенной функции
  отвечает `404`. Администратор, чья роль требует двухфакторной аутентификации, получает
  `403 TwoFactorRequiredError`, пока не настроит её.
- Каждый маршрут проверяет [разрешения](/ru/concepts/permissions/) администратора: маршруты
  контента — действия с контентом для типа, маршруты настроек — своё действие настроек.
- Admin API никогда не отвечает на кросс-доменные запросы: вызывайте его с сервера или из
  скрипта, а не со страниц другого сайта.
- Успешные изменения записываются в [журнал аудита](/ru/guides/content/audit-logs/).

## Списки

Списки настроек разбиваются на страницы параметрами `page` (с 1) и `pageSize`. В ответе —
строки страницы и счётчики:

```json
{ "data": [ … ], "meta": { "pagination": { "page": 2, "pageSize": 25, "total": 60, "pageCount": 3 } } }
```

| Список | Размер страницы по умолчанию (максимум) | Порядок | Другие параметры |
| --- | --- | --- | --- |
| `GET /users`, `GET /roles`, `GET /api-tokens` | 25 (100) | Сначала старые | |
| `GET /webhooks` | 25 (100) | Сначала старые | `meta.events` перечисляет события, на которые можно подписать вебхук |
| `GET /webhooks/{id}/deliveries` | 25 (100) | Сначала новые | |
| `GET /releases` | 25 (100) | Сначала новые | `status` (`pending`, `running`, `done`, `failed`) |
| `GET /site/redirects` | 25 (100) | По источнику | `search` ищет в источнике или в назначении |
| `GET /site/menus`, `GET /site/forms` | 25 (100) | По названию | |
| `GET /site/forms/{id}/submissions` | 25 (100) | Сначала новые | |
| `GET /deploy/targets` | 25 (100) | Сначала старые | |
| `GET /deploy/deployments` | 25 (100) | Сначала новые | `targetId`; `limit` — устаревший псевдоним `pageSize` |
| `GET /end-users` | 25 (100) | Сначала новые | `search` ищет в имени пользователя или в email |
| `GET /audit-logs` | 50 (200) | Сначала новые | См. [Журналы аудита](/ru/guides/content/audit-logs/) |

Слишком большой `pageSize` снижается до максимума. Чтобы прочитать список целиком,
запрашивайте страницы, пока `page` не достигнет `pageCount`:

```sh title="Terminal"
curl 'https://cms.example.com/admin/api/site/redirects?page=1&pageSize=100' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Маршруты контента разбиваются на страницы так же, как REST API, параметрами
`pagination[page]` и `pagination[pageSize]`.

## Группы маршрутов

Пути указаны относительно `/admin/api`. Роутеры находятся в
[`crates/verdin-api/src/admin.rs`](https://github.com/Verdin-CMS/verdin/blob/main/crates/verdin-api/src/admin.rs)
и в модулях `*_admin.rs` рядом с ним.

| Группа | Маршруты | Разрешение |
| --- | --- | --- |
| Вход и учётная запись | `GET /auth/status`, `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `GET\|PUT /users/me`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, приглашения и сброс пароля в `/auth/*` | Выполнен вход (маршруты входа публичные) |
| Двухфакторная аутентификация | `/auth/two-factor/*`, `POST /auth/login/two-factor`, `POST /auth/login/passkey/options`, `DELETE /users/{id}/two-factor` | Выполнен вход; `users.manage`, чтобы сбросить её другому администратору |
| SSO | `GET /auth/sso`, `GET /auth/sso/{id}`, `GET /auth/sso/{id}/callback` | Публичные |
| Администраторы | `GET\|POST /users`, `GET\|PUT\|DELETE /users/{id}`, `POST /users/{id}/invite` | `users.manage` |
| Роли и публичный доступ | `GET\|POST /roles`, `GET\|PUT\|DELETE /roles/{id}`, `GET\|PUT /public-permissions` | `roles.manage` |
| API-токены | `GET\|POST /api-tokens`, `GET\|PUT\|DELETE /api-tokens/{id}`, `POST /api-tokens/{id}/regenerate` | `tokens.manage` |
| Схема | `GET /content-types`, `GET /components`, `GET\|PUT\|DELETE /content-types/{uid}/edit-view`; `GET /schema`, `POST /schema/plan`, `POST /schema/apply` только в `verdin dev` | Выполнен вход; `views.manage` для представлений редактирования; `schema.manage` для конструктора |
| Контент | `GET\|POST /content/{uid}`, `GET\|PUT\|DELETE /content/{uid}/{documentId}`, `POST /content/{uid}/{documentId}/actions/{publish\|unpublish\|discard-draft}`, `POST …/clone`, `GET …/locales`, `GET …/usage`, `GET /content/{uid}/uid-available`, `GET /content/{uid}/stats` | Действия с контентом для `{uid}` |
| Импорт и экспорт | `GET /content/{uid}/export`, `POST /content/{uid}/import` | Действия с контентом для `{uid}` |
| История | `GET /history/{uid}/{documentId}`, `GET /history/versions/{id}`, `POST /history/versions/{id}/restore` | Действия с контентом для типа |
| Релизы | `GET\|POST /releases`, `GET\|PUT\|DELETE /releases/{id}`, `POST /releases/{id}/actions`, `DELETE /releases/{id}/actions/{actionId}`, `POST /releases/{id}/publish` | `releases.manage` |
| Процессы проверки | `GET\|POST /review-workflows`, `GET\|PUT\|DELETE /review-workflows/{id}`, `GET\|PUT /content/{uid}/{documentId}/review`, `GET /review/*` | `workflows.manage` для настройки |
| Медиа | `POST /upload`, `POST /upload/from-url`, `GET /upload/files`, `GET\|PUT\|DELETE /upload/files/{id}`, `POST /upload/files/{id}/replace`, `GET /upload/files/{id}/usage`, `/upload/folders…` | `media.*` |
| Локали | `GET\|POST /i18n/locales`, `PUT\|DELETE /i18n/locales/{code}` | `locales.manage` для изменений |
| Вебхуки | `GET\|POST /webhooks`, `GET\|PUT\|DELETE /webhooks/{id}`, `POST\|DELETE /webhooks/{id}/secret`, `POST /webhooks/{id}/trigger`, `GET /webhooks/{id}/deliveries`, `POST /webhooks/deliveries/{id}/retry` | `webhooks.manage` |
| Конечные пользователи | `GET\|POST /end-users`, `GET\|PUT\|DELETE /end-users/{id}`, `GET\|POST /end-user-roles`, `PUT\|DELETE /end-user-roles/{id}` | `endusers.manage` |
| Функции | `GET /features`, `PUT /features/{id}`, `POST /email/test` | `features.manage` для изменений |
| Плагины | `GET /plugins`, `GET /plugins/extensions`, `PUT /plugins/{name}`, `GET /plugins/{name}/logs` | `plugins.manage` |
| Деплои и CDN | `/deploy/targets…`, `GET /deploy/deployments`, `GET /deploy/cdn`, `POST /deploy/cdn/purge` | `deploy.manage`; `deploy.trigger` для запуска |
| Сайт | `/site/redirects…`, `/site/menus…`, `/site/forms…` и отправки форм | `site.manage` |
| Совместная работа | `/comments…`, `/tasks…`, `/engagement/*`, `/polls…` | Доступ на чтение к типу записи |
| Realtime | `GET /events`, `GET\|POST /presence` | См. [Realtime API](/ru/api/realtime/#поток-админки) |
| ИИ | `GET /ai`, `POST /ai/translate`, `/ai/alt-text`, `/ai/summarize`, `/ai/seo` | См. [Действия ИИ](/ru/guides/integrations/ai-actions/) |
| Журналы аудита | `GET /audit-logs` | `audit.read` |
| Система | `GET /system/info` (версия, база данных и режим) | Выполнен вход |

## Маршруты контента

Маршруты контента работают через тот же Document Service, что и REST API, но с правилами
админки:

- `{uid}` — это UID типа содержимого, например `api::article`.
- Чтение возвращает **черновики**, если не передать `status=published`. Принимаются
  [параметры запроса](/ru/api/rest/#параметры-запроса) REST, а также `unseen=true` — для
  документов, которые администратор не открывал с момента их последнего изменения.
- Запись сохраняет только черновик. Публикация — всегда отдельное явное действие.
- Запись сохраняет администратора как создателя или последнего редактора. Ограничения ролей
  администратора на поля, локали и `is-creator` действуют и при чтении, и при записи.

```sh title="Terminal"
curl -X PUT 'https://cms.example.com/admin/api/content/api::article/k2m7q4…?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"data":{"title":"Bonjour, Verdin"}}'
curl -X POST 'https://cms.example.com/admin/api/content/api::article/k2m7q4…/actions/publish?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```
