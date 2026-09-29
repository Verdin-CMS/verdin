---
title: "Вебхуки"
description: "Події вебхуків, формат payload, заголовки, перевірка підпису, повторні спроби та журнал доставок."
sidebar:
  order: 6
---

Вебхук надсилає HTTP `POST` на вашу URL-адресу, коли змінюється вміст або медіа. Ця сторінка —
довідник для отримувачів: події, payload, заголовки, підписи й доставка. Про створення й
керування вебхуками в адмін-панелі див. [Вебхуки](/uk/guides/integrations/webhooks/).

## Події

| Подія | Коли надсилається |
| --- | --- |
| `entry.create` | Документ створено з будь-якого API: REST, GraphQL, адмін-панелі чи плагіна. |
| `entry.update` | Документ збережено. |
| `entry.publish` | Документ опубліковано. Створення або оновлення через REST чи GraphQL без `status=draft` публікує його. |
| `entry.unpublish` | Документ знято з публікації. |
| `entry.discard-draft` | Чернетку документа відкинуто. |
| `entry.delete` | Документ видалено. |
| `media.create`, `media.update`, `media.delete` | Файл завантажено, відредаговано або видалено. Видалення папки надсилає `media.delete` для кожного файлу в ній. |
| `releases.publish` | [Реліз](/uk/guides/content/releases/) виконано — одразу або в призначений час. |
| `review-workflows.updateEntryStage` | Запис перейшов на інший [етап перевірки](/uk/guides/content/review-workflows/). |

Вебхук підписується на певні події й може бути обмежений певними типами вмісту. Медіаподії не
прив'язані до типу вмісту.

## Payload

Кожен payload має `event` і `createdAt` (коли подію поставлено в чергу). Події записів
додають тип вмісту й документ:

```json
{
  "event": "entry.publish",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "model": "article",
  "uid": "api::article",
  "locale": null,
  "entry": {
    "id": 3,
    "documentId": "k2m7q4dx8n5t1v3b9c0e6a2wfr",
    "title": "Hello, Verdin",
    "slug": "hello-verdin",
    "createdAt": "2026-09-25T08:55:00.000Z",
    "updatedAt": "2026-09-25T09:00:00.000Z",
    "publishedAt": "2026-09-25T09:00:00.000Z"
  }
}
```

- `model` — це `singularName` типу, `uid` — його UID, а `locale` — локаль версії, яка
  змінилася (`null` у нелокалізованих типах).
- `entry` — це документ у тому вигляді, як його повертає REST API, без зв'язків, медіа,
  компонентів і полів `private`.
- `entry.publish` містить опубліковану версію. Інші події записів містять чернетку або єдину
  версію в типах без чернеток і публікації.
- `entry.delete` містить лише `{ "documentId": … }`.

Медіаподії надсилають об'єкт файлу в `media`, без `model`, `uid` чи `entry`:

```json
{
  "event": "media.create",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "media": { "id": 5, "documentId": "v3k9…", "name": "harbour.jpg", "mime": "image/jpeg", "url": "/uploads/harbour_4f1c.jpg" }
}
```

`releases.publish` надсилає `release` з результатом кожної з його дій.
`review-workflows.updateEntryStage` надсилає:

```json
{
  "event": "review-workflows.updateEntryStage",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "model": "article",
  "uid": "api::article",
  "entry": { "documentId": "k2m7q4…", "locale": "en" },
  "workflow": { "id": 1, "name": "Editorial" },
  "stages": { "from": { "id": 1, "name": "To do" }, "to": { "id": 2, "name": "In review" } }
}
```

Як і в подіях записів, `model` — це назва в однині, а `uid` — UID типу вмісту (до 0.10 тут у
`model` був UID).

Кнопка **Надіслати тестову подію** надсилає `{ "event": "trigger-test", "createdAt": … }`.

## Заголовки

| Заголовок | Значення |
| --- | --- |
| `content-type` | `application/json` |
| `x-verdin-event` | Назва події. |
| `x-verdin-delivery` | Id доставки. Він не змінюється між повторними спробами: використовуйте його, щоб ігнорувати дублікати. |
| `x-verdin-signature` | `t=<unix seconds>,v1=<hex>`, коли вебхук підписано. |

Вебхуки можуть додавати власні заголовки, наприклад токен `authorization` для вашого
ендпоінта. Наведені вище заголовки перевизначити не можна.

## Перевірка підписів

Типово вебхуки підписуються. `v1` — це шістнадцятковий HMAC-SHA256 від `<t>.<raw body>` з
ключем — секретом вебхука (`whsec_…`). Секрет показується один раз: коли вебхук створено або
секрет ротовано.

Щоб перевірити доставку:

1. Розділіть заголовок на `t` і `v1`.
2. Відхиліть доставку, якщо `t` відрізняється від вашого годинника більш ніж на кілька хвилин.
3. Обчисліть HMAC від `t`, крапки та **сирого** тіла запиту. Не розбирайте й не серіалізуйте
   JSON заново перед цим: байти відрізнятимуться.
4. Порівняйте результат із `v1` за сталий час.

```js title="verify.mjs"
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, header, rawBody, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=')));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const received = parts.v1 ?? '';
  return (
    received.length === expected.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  );
}
```

З Express прочитайте сире тіло й перевірте його перед розбором:

```js title="server.mjs"
import express from 'express';
import { verify } from './verify.mjs';

const app = express();

app.post('/hooks/verdin', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body.toString('utf8');
  if (!verify(process.env.VERDIN_WEBHOOK_SECRET, req.get('x-verdin-signature') ?? '', rawBody)) {
    return res.sendStatus(401);
  }
  const payload = JSON.parse(rawBody);
  console.log(req.get('x-verdin-delivery'), payload.event, payload.entry?.documentId);
  res.sendStatus(204);
});

app.listen(3000);
```

На Python:

```python title="verify.py"
import hashlib
import hmac
import time


def verify(secret: str, header: str, raw_body: bytes, tolerance: int = 300) -> bool:
    parts = dict(part.split("=", 1) for part in header.split(","))
    if abs(time.time() - int(parts["t"])) > tolerance:
        return False
    signed = parts["t"].encode() + b"." + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))
```

## Доставка й повторні спроби

Доставки ставляться в чергу в базі даних у момент фіксації зміни, а фоновий воркер їх
надсилає. Повільний або несправний ендпоінт ніколи не гальмує редакторів чи запис через API, а
доставки переживають перезапуск.

- **Успіх**: будь-яка відповідь `2xx`.
- **Невдача**: будь-який інший статус, зокрема перенаправлення (за ними не переходять), помилка
  з'єднання або тайм-аут (`[webhooks].timeout_secs`, типово 10 секунд).
- **Повторні спроби**: невдала доставка повторюється через 30 секунд, 2 хвилини, 10 хвилин,
  1 годину й 6 годин — загалом шість спроб. Після цього її позначено як невдалу.
- Вимкнення або видалення вебхука зупиняє його заплановані повторні спроби.
- Кілька екземплярів мають спільну чергу; кожну доставку забирає один із них.

Відповідайте швидко кодом `2xx`, а повільну роботу робіть потім. Доставки можуть надходити
більше одного разу (наприклад, повторна спроба після тайм-ауту) і не за порядком: використовуйте
`x-verdin-delivery`, щоб пропускати дублікати, і отримуйте документ заново, коли порядок має
значення.

## Журнал доставок

Сторінка кожного вебхука в **Налаштування → Вебхуки** має **Журнал доставок**, найновіші
зверху. Для кожної доставки він показує статус (**Очікування**, **Надсилання**, **Успіх**,
**Помилка**), HTTP-статус, перші 2 КБ тіла відповіді, помилку, кількість спроб, час наступної
спроби, тривалість і надісланий payload. Невдалу доставку можна повторити з журналу.

Завершені доставки видаляються через `[webhooks].retention_days` (типово 30).

Ті самі дані доступні через [admin API](/uk/api/admin/):
`GET /admin/api/webhooks/{id}/deliveries` і `POST /admin/api/webhooks/deliveries/{id}/retry`.

## Обмеження URL

Під `verdin start` URL вебхуків не можуть вказувати на loopback, приватні, link-local чи інші
зарезервовані адреси — ні у вигляді IP-адрес, ні як імена хостів, що в них резолвляться.
Адміністратор не може використати вебхуки, щоб дістатися внутрішніх сервісів. `verdin dev`
дозволяє їх, тож можна тестувати з `localhost`; `[webhooks].allow_private_networks`
перевизначає типову поведінку. URL з обліковими даними (`https://user:pass@…`) відхиляються:
передавайте їх у заголовку.

## Порівняно зі Strapi

Payload відповідають Strapi (`event`, `createdAt`, `model`, `uid`, `entry`). Verdin додає
підписи, повторні спроби, журнал доставок і фільтри за типом вмісту. Подія Strapi
`entry.draft-discard` називається `entry.discard-draft`.
