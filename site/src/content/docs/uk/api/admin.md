---
title: "Admin API"
description: "API, на якому працює адмін-панель Verdin, для автоматизації: вхід, сесії, домовленості та основні групи маршрутів."
sidebar:
  order: 4
  label: "Адмін"
---

Адмін-панель — це клієнт admin API, який доступний за адресою `{admin.path}/api`
(типово `/admin/api`). Усе, що робить панель, може зробити й скрипт: створювати
адміністраторів і API-токени, налаштовувати вебхуки та функції, керувати локалями, працювати
з чернетками й релізами. На цій сторінці пояснено, як автентифікуватися, і наведено групи
маршрутів.

:::caution[Стабільність]
До Verdin 1.0 admin API не має гарантій стабільності: маршрути й тіла запитів можуть
змінюватися в мінорних релізах, а changelog не перелічує кожну зміну. Для читання й запису
вмісту краще використовуйте [REST](/uk/api/rest/) або [GraphQL](/uk/api/graphql/) API з
[API-токеном](/uk/guides/auth/api-tokens/). Контракт стабільності для всіх API заплановано на 1.0.
:::

## Вхід

В admin API поки немає API-токенів: скрипт входить як адміністратор, бажано з роллю, яка
дозволяє лише те, що потрібно скрипту.

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

Надсилайте access token у кожному наступному запиті:

```sh title="Terminal"
curl -H "Authorization: Bearer $ACCESS_TOKEN" 'https://cms.example.com/admin/api/system/info'
```

| Облікові дані | Термін дії | Де |
| --- | --- | --- |
| Access token (JWT) | 15 хвилин | Тіло відповіді. Надсилайте його як `Authorization: Bearer …`. |
| Refresh token | 30 днів | Cookie `verdin_refresh` (`HttpOnly`, `SameSite=Strict`, шлях `/admin/api/auth`, `Secure` під `verdin start`). |

Щоб отримати новий access token, викличте `POST /admin/api/auth/refresh` із cookie та
заголовком `X-Verdin-CSRF` (будь-яке значення). Відповідь така сама, як при вході, а refresh
token ротується: збережіть нову cookie, бо повторне пред'явлення вже використаного refresh
token завершує всю сесію. `POST /admin/api/auth/logout` з тим самим заголовком завершує сесію.

```sh title="Terminal"
curl -s -b cookies.txt -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/refresh' \
  -H 'X-Verdin-CSRF: 1'
```

- **Двофакторна автентифікація.** Для облікового запису з другим фактором вхід повертає
  `{ "data": { "twoFactorRequired": true, "twoFactorToken": "…", "methods": ["totp"] } }`.
  Завершіть його через `POST /admin/api/auth/login/two-factor` і
  `{ "twoFactorToken": "…", "code": "123456" }` (код TOTP або код відновлення). Див.
  [Двофакторна автентифікація](/uk/guides/auth/two-factor/).
- **Обмеження частоти.** Вхід і реєстрацію обмежено для кожної IP-адреси клієнта параметром
  `[admin].auth_rate_limit` (типово 20 на хвилину); для оновлень токена ліміт більший.
- **Помилки.** Неправильні облікові дані, невідомі й заблоковані облікові записи однаково
  отримують `400 Invalid credentials`. П'ять неправильних паролів блокують обліковий запис на
  15 хвилин.
- **Перший адміністратор.** На новому екземплярі `POST /admin/api/auth/register-first-admin`
  створює Super Admin; це працює, лише поки немає жодного адміністратора. `verdin admin create`
  робить те саме з командного рядка.

## Домовленості

- Тіла запитів і відповіді — JSON. Відповіді загортають результат у `data`
  (`{ "data": … }`); маршрути вмісту також повертають `meta`, як REST API.
- Маршрути вмісту приймають тіла `{ "data": { … } }`, як REST API. Маршрути налаштувань
  приймають звичайні JSON-об'єкти.
- Помилки мають [формат помилок REST](/uk/api/rest/#помилки). Маршрут вимкненої функції
  відповідає `404`. Адміністратор, чия роль вимагає двофакторної автентифікації, отримує
  `403 TwoFactorRequiredError`, доки не налаштує її.
- Кожен маршрут перевіряє [дозволи](/uk/concepts/permissions/) адміністратора: маршрути вмісту —
  дії з вмістом для типу, маршрути налаштувань — відповідну дію налаштувань.
- Admin API ніколи не відповідає на cross-origin запити: викликайте його із сервера або
  скрипту, а не зі сторінок іншого сайту.
- Успішні зміни записуються в [журнал аудиту](/uk/guides/content/audit-logs/).

## Списки

Списки налаштувань розбиваються на сторінки за `page` (від 1) і `pageSize`. Вони відповідають
рядками сторінки та лічильниками:

```json
{ "data": [ … ], "meta": { "pagination": { "page": 2, "pageSize": 25, "total": 60, "pageCount": 3 } } }
```

| Список | Типовий розмір сторінки (максимум) | Порядок | Інші параметри |
| --- | --- | --- | --- |
| `GET /users`, `GET /roles`, `GET /api-tokens` | 25 (100) | Спочатку найстаріші | |
| `GET /webhooks` | 25 (100) | Спочатку найстаріші | `meta.events` перелічує події, на які можна підписати вебхук |
| `GET /webhooks/{id}/deliveries` | 25 (100) | Спочатку найновіші | |
| `GET /releases` | 25 (100) | Спочатку найновіші | `status` (`pending`, `running`, `done`, `failed`) |
| `GET /site/redirects` | 25 (100) | За джерелом | `search` збігається з джерелом або призначенням |
| `GET /site/menus`, `GET /site/forms` | 25 (100) | За назвою | |
| `GET /site/forms/{id}/submissions` | 25 (100) | Спочатку найновіші | |
| `GET /deploy/targets` | 25 (100) | Спочатку найстаріші | |
| `GET /deploy/deployments` | 25 (100) | Спочатку найновіші | `targetId`; `limit` — застарілий псевдонім `pageSize` |
| `GET /end-users` | 25 (100) | Спочатку найновіші | `search` збігається з іменем користувача або email |
| `GET /audit-logs` | 50 (200) | Спочатку найновіші | Див. [Журнали аудиту](/uk/guides/content/audit-logs/) |

Більший `pageSize` знижується до максимуму. Щоб прочитати весь список, запитуйте сторінки,
доки `page` не досягне `pageCount`:

```sh title="Terminal"
curl 'https://cms.example.com/admin/api/site/redirects?page=1&pageSize=100' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Маршрути вмісту розбиваються на сторінки так само, як REST API, через `pagination[page]` і
`pagination[pageSize]`.

## Групи маршрутів

Шляхи вказано відносно `/admin/api`. Маршрутизатори містяться в
[`crates/verdin-api/src/admin.rs`](https://github.com/Verdin-CMS/verdin/blob/main/crates/verdin-api/src/admin.rs)
і модулях `*_admin.rs` поруч із ним.

| Група | Маршрути | Дозвіл |
| --- | --- | --- |
| Вхід і обліковий запис | `GET /auth/status`, `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `GET\|PUT /users/me`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, запрошення та скидання пароля в `/auth/*` | Виконано вхід (маршрути входу публічні) |
| Двофакторна автентифікація | `/auth/two-factor/*`, `POST /auth/login/two-factor`, `POST /auth/login/passkey/options`, `DELETE /users/{id}/two-factor` | Виконано вхід; `users.manage`, щоб скинути її іншому адміністратору |
| SSO | `GET /auth/sso`, `GET /auth/sso/{id}`, `GET /auth/sso/{id}/callback` | Публічні |
| Адміністратори | `GET\|POST /users`, `GET\|PUT\|DELETE /users/{id}`, `POST /users/{id}/invite` | `users.manage` |
| Ролі та публічний доступ | `GET\|POST /roles`, `GET\|PUT\|DELETE /roles/{id}`, `GET\|PUT /public-permissions` | `roles.manage` |
| API-токени | `GET\|POST /api-tokens`, `GET\|PUT\|DELETE /api-tokens/{id}`, `POST /api-tokens/{id}/regenerate` | `tokens.manage` |
| Схема | `GET /content-types`, `GET /components`, `GET\|PUT\|DELETE /content-types/{uid}/edit-view`; `GET /schema`, `POST /schema/plan`, `POST /schema/apply` лише у `verdin dev` | Виконано вхід; `views.manage` для видів редагування; `schema.manage` для конструктора |
| Вміст | `GET\|POST /content/{uid}`, `GET\|PUT\|DELETE /content/{uid}/{documentId}`, `POST /content/{uid}/{documentId}/actions/{publish\|unpublish\|discard-draft}`, `POST …/clone`, `GET …/locales`, `GET …/usage`, `GET /content/{uid}/uid-available`, `GET /content/{uid}/stats` | Дії з вмістом для `{uid}` |
| Імпорт і експорт | `GET /content/{uid}/export`, `POST /content/{uid}/import` | Дії з вмістом для `{uid}` |
| Історія | `GET /history/{uid}/{documentId}`, `GET /history/versions/{id}`, `POST /history/versions/{id}/restore` | Дії з вмістом для типу |
| Релізи | `GET\|POST /releases`, `GET\|PUT\|DELETE /releases/{id}`, `POST /releases/{id}/actions`, `DELETE /releases/{id}/actions/{actionId}`, `POST /releases/{id}/publish` | `releases.manage` |
| Процеси перевірки | `GET\|POST /review-workflows`, `GET\|PUT\|DELETE /review-workflows/{id}`, `GET\|PUT /content/{uid}/{documentId}/review`, `GET /review/*` | `workflows.manage` для налаштування |
| Медіа | `POST /upload`, `POST /upload/from-url`, `GET /upload/files`, `GET\|PUT\|DELETE /upload/files/{id}`, `POST /upload/files/{id}/replace`, `GET /upload/files/{id}/usage`, `/upload/folders…` | `media.*` |
| Локалі | `GET\|POST /i18n/locales`, `PUT\|DELETE /i18n/locales/{code}` | `locales.manage` для змін |
| Вебхуки | `GET\|POST /webhooks`, `GET\|PUT\|DELETE /webhooks/{id}`, `POST\|DELETE /webhooks/{id}/secret`, `POST /webhooks/{id}/trigger`, `GET /webhooks/{id}/deliveries`, `POST /webhooks/deliveries/{id}/retry` | `webhooks.manage` |
| Кінцеві користувачі | `GET\|POST /end-users`, `GET\|PUT\|DELETE /end-users/{id}`, `GET\|POST /end-user-roles`, `PUT\|DELETE /end-user-roles/{id}` | `endusers.manage` |
| Функції | `GET /features`, `PUT /features/{id}`, `POST /email/test` | `features.manage` для змін |
| Плагіни | `GET /plugins`, `GET /plugins/extensions`, `PUT /plugins/{name}`, `GET /plugins/{name}/logs` | `plugins.manage` |
| Розгортання і CDN | `/deploy/targets…`, `GET /deploy/deployments`, `GET /deploy/cdn`, `POST /deploy/cdn/purge` | `deploy.manage`; `deploy.trigger` для запуску |
| Сайт | `/site/redirects…`, `/site/menus…`, `/site/forms…` і надіслані форми | `site.manage` |
| Співпраця | `/comments…`, `/tasks…`, `/engagement/*`, `/polls…` | Доступ на читання до типу запису |
| Реальний час | `GET /events`, `GET\|POST /presence` | Див. [Realtime API](/uk/api/realtime/#потік-адмін-панелі) |
| ШІ | `GET /ai`, `POST /ai/translate`, `/ai/alt-text`, `/ai/summarize`, `/ai/seo` | Див. [Дії ШІ](/uk/guides/integrations/ai-actions/) |
| Журнали аудиту | `GET /audit-logs` | `audit.read` |
| Система | `GET /system/info` (версія, база даних і режим) | Виконано вхід |

## Маршрути вмісту

Маршрути вмісту використовують той самий Document Service, що й REST API, але з правилами
адмінки:

- `{uid}` — UID типу вмісту, наприклад `api::article`.
- Читання повертає **чернетки**, якщо не передати `status=published`. Воно приймає
  [параметри запиту](/uk/api/rest/#параметри-запиту) REST, а також `unseen=true` для документів,
  які адміністратор не відкривав після останньої зміни.
- Запис зберігає лише чернетку. Публікація — це завжди окрема явна дія.
- Запис фіксує адміністратора як автора або останнього редактора. Обмеження ролей
  адміністратора за полями, локалями та `is-creator` застосовуються до читання й запису.

```sh title="Terminal"
curl -X PUT 'https://cms.example.com/admin/api/content/api::article/k2m7q4…?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"data":{"title":"Bonjour, Verdin"}}'
curl -X POST 'https://cms.example.com/admin/api/content/api::article/k2m7q4…/actions/publish?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```
