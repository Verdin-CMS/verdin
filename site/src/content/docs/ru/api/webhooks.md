---
title: "Вебхуки"
description: "События вебхуков, формат полезной нагрузки, заголовки, проверка подписи, повторные попытки и журнал доставок."
sidebar:
  order: 6
---

Вебхук отправляет HTTP-запрос `POST` на ваш URL, когда меняется контент или медиа. Эта
страница — справочник для получателей: события, полезная нагрузка, заголовки, подписи и
доставка. Как создавать вебхуки и управлять ими в админ-панели, см. в разделе
[Вебхуки](/ru/guides/integrations/webhooks/).

## События

| Событие | Отправляется, когда |
| --- | --- |
| `entry.create` | Документ создан через любой API: REST, GraphQL, админ-панель или плагин. |
| `entry.update` | Документ сохранён. |
| `entry.publish` | Документ опубликован. Создание или обновление документа через REST или GraphQL без `status=draft` публикует его. |
| `entry.unpublish` | Документ снят с публикации. |
| `entry.discard-draft` | Черновик документа отменён. |
| `entry.delete` | Документ удалён. |
| `media.create`, `media.update`, `media.delete` | Файл загружен, изменён или удалён. Удаление папки отправляет `media.delete` для каждого файла в ней. |
| `releases.publish` | [Релиз](/ru/guides/content/releases/) выполнен — сразу или в назначенную дату. |
| `review-workflows.updateEntryStage` | Запись перешла на другой [этап проверки](/ru/guides/content/review-workflows/). |

Вебхук подписывается на часть событий и может быть ограничен частью типов содержимого.
События медиа не привязаны к типу содержимого.

## Полезная нагрузка

В каждой нагрузке есть `event` и `createdAt` (когда событие было поставлено в очередь).
События записей добавляют тип содержимого и документ:

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

- `model` — это `singularName` типа, `uid` — его UID, а `locale` — локаль изменённой версии
  (`null` для нелокализованных типов).
- `entry` — документ в том виде, в каком его возвращает REST API, без связей, медиа,
  компонентов и полей `private`.
- `entry.publish` содержит опубликованную версию. Остальные события записей содержат
  черновик или единственную версию для типов без черновиков и публикации.
- `entry.delete` содержит только `{ "documentId": … }`.

События медиа передают объект файла в `media`, без `model`, `uid` и `entry`:

```json
{
  "event": "media.create",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "media": { "id": 5, "documentId": "v3k9…", "name": "harbour.jpg", "mime": "image/jpeg", "url": "/uploads/harbour_4f1c.jpg" }
}
```

`releases.publish` передаёт `release` с результатом каждого из его действий.
`review-workflows.updateEntryStage` передаёт:

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

Как и в событиях записей, `model` — единственное число имени, а `uid` — UID типа содержимого
(до версии 0.10 здесь в `model` был UID).

Кнопка **Отправить тестовое событие** отправляет `{ "event": "trigger-test", "createdAt": … }`.

## Заголовки

| Заголовок | Значение |
| --- | --- |
| `content-type` | `application/json` |
| `x-verdin-event` | Имя события. |
| `x-verdin-delivery` | Id доставки. Он не меняется при повторных попытках: используйте его, чтобы отбрасывать дубликаты. |
| `x-verdin-signature` | `t=<unix seconds>,v1=<hex>`, если вебхук подписан. |

Вебхуки могут добавлять собственные заголовки, например токен `authorization` для вашего
эндпоинта. Перечисленные выше заголовки переопределить нельзя.

## Проверка подписи

По умолчанию вебхуки подписываются. `v1` — это HMAC-SHA256 в hex от `<t>.<raw body>` с
секретом вебхука (`whsec_…`) в качестве ключа. Секрет показывается один раз — при создании
вебхука или при ротации секрета.

Чтобы проверить доставку:

1. Разбейте заголовок на `t` и `v1`.
2. Отклоните запрос, если `t` отличается от ваших часов больше чем на несколько минут.
3. Вычислите HMAC от `t`, точки и **сырого** тела запроса. Не разбирайте и не сериализуйте
   JSON заново: байты будут отличаться.
4. Сравните результат с `v1` за постоянное время.

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

В Express прочитайте сырое тело и проверьте его до разбора:

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

## Доставка и повторные попытки

Доставки ставятся в очередь в базе данных при фиксации изменения, а отправляет их фоновый
обработчик. Медленный или неисправный эндпоинт никогда не замедляет редакторов и запись через
API, а доставки переживают перезапуск.

- **Успех**: любой ответ `2xx`.
- **Неудача**: любой другой статус, включая редиректы (по ним не переходят), ошибку соединения
  или тайм-аут (`[webhooks].timeout_secs`, по умолчанию 10 секунд).
- **Повторные попытки**: неудачная доставка повторяется через 30 секунд, 2 минуты, 10 минут,
  1 час и 6 часов — всего шесть попыток. После этого она помечается как неудачная.
- Отключение или удаление вебхука останавливает его ожидающие повторы.
- Несколько экземпляров используют общую очередь; каждую доставку забирает один из них.

Отвечайте быстро кодом `2xx`, а медленную работу делайте потом. Доставки могут приходить
больше одного раза (например, повтор после тайм-аута) и не по порядку: используйте
`x-verdin-delivery`, чтобы пропускать дубликаты, и заново запрашивайте документ, если важен
порядок.

## Журнал доставок

На странице каждого вебхука в **Настройки → Вебхуки** есть **Журнал доставок**, новые записи
сверху. Для каждой доставки он показывает статус (**Ожидание**, **Отправка**, **Успех**,
**Ошибка**), HTTP-статус, первые 2 КБ тела ответа, ошибку, число попыток, время следующей
попытки, длительность и отправленную полезную нагрузку. Неудачную доставку можно повторить
прямо из журнала.

Завершённые доставки удаляются через `[webhooks].retention_days` (по умолчанию 30 дней).

Те же данные доступны через [admin API](/ru/api/admin/):
`GET /admin/api/webhooks/{id}/deliveries` и `POST /admin/api/webhooks/deliveries/{id}/retry`.

## Ограничения URL

При `verdin start` URL вебхуков не могут указывать на loopback, частные, link-local и другие
зарезервированные адреса — ни в виде IP-адресов, ни в виде имён хостов, которые в них
разрешаются. Администратор не может использовать вебхуки, чтобы достучаться до внутренних
сервисов. `verdin dev` такие адреса разрешает, чтобы можно было тестировать на `localhost`;
`[webhooks].allow_private_networks` переопределяет поведение по умолчанию. URL с учётными
данными (`https://user:pass@…`) отклоняются: передавайте их в заголовке.

## Сравнение со Strapi

Полезная нагрузка повторяет Strapi (`event`, `createdAt`, `model`, `uid`, `entry`). Verdin
добавляет подписи, повторные попытки, журнал доставок и фильтры по типам содержимого. Событие
Strapi `entry.draft-discard` называется `entry.discard-draft`.
