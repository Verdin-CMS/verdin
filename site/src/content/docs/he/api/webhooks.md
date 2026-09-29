---
title: "Webhooks"
description: "אירועי webhook, מבנה ה-payload, כותרות, אימות חתימות, ניסיונות חוזרים ויומן השליחות."
sidebar:
  order: 6
---

Webhook שולח `POST` של HTTP לכתובת ה-URL שלכם כשתוכן או מדיה משתנים. העמוד הזה הוא
התיעוד עבור הצד המקבל: אירועים, payloads, כותרות, חתימות ושליחה. כדי ליצור ולנהל
webhooks בפאנל הניהול, ראו [Webhooks](/he/guides/integrations/webhooks/).

## אירועים

| אירוע | נשלח כאשר |
| --- | --- |
| `entry.create` | מסמך נוצר, מכל API: REST, GraphQL, פאנל הניהול או תוסף. |
| `entry.update` | מסמך נשמר. |
| `entry.publish` | מסמך פורסם. יצירה או עדכון של מסמך דרך REST או GraphQL בלי `status=draft` מפרסמים אותו. |
| `entry.unpublish` | פרסום של מסמך בוטל. |
| `entry.discard-draft` | הטיוטה של מסמך נמחקה. |
| `entry.delete` | מסמך נמחק. |
| `media.create`, `media.update`, `media.delete` | קובץ הועלה, נערך או נמחק. מחיקת תיקייה שולחת `media.delete` לכל קובץ שבה. |
| `releases.publish` | [מהדורה](/he/guides/content/releases/) רצה, מיד או במועד שלה. |
| `review-workflows.updateEntryStage` | רשומה עברה ל[שלב בקרה](/he/guides/content/review-workflows/) אחר. |

Webhook נרשם לחלק מהאירועים ואפשר להגביל אותו לחלק מסוגי התוכן. אירועי מדיה אינם קשורים
לסוג תוכן.

## Payloads

לכל payload יש `event` ו-`createdAt` (מתי האירוע נכנס לתור). אירועי רשומה מוסיפים את סוג
התוכן ואת המסמך:

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

- `model` הוא ה-`singularName` של הסוג, `uid` ה-UID שלו, ו-`locale` השפה של הגרסה
  שהשתנתה (`null` בסוגים שאינם מתורגמים).
- `entry` הוא המסמך כפי שה-REST API מחזיר אותו, בלי קשרים, מדיה, רכיבים או שדות
  `private`.
- `entry.publish` נושא את הגרסה המפורסמת. שאר אירועי הרשומה נושאים את הטיוטה, או את
  הגרסה היחידה בסוגים בלי טיוטה ופרסום.
- `entry.delete` נושא רק `{ "documentId": … }`.

אירועי מדיה שולחים את אובייקט הקובץ ב-`media`, בלי `model`, `uid` או `entry`:

```json
{
  "event": "media.create",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "media": { "id": 5, "documentId": "v3k9…", "name": "harbour.jpg", "mime": "image/jpeg", "url": "/uploads/harbour_4f1c.jpg" }
}
```

`releases.publish` שולח את ה-`release` עם התוצאה של כל אחת מהפעולות שלה.
`review-workflows.updateEntryStage` שולח:

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

כמו באירועי רשומה, `model` הוא השם ביחיד ו-`uid` הוא ה-UID של סוג התוכן (לפני 0.10,
`model` הכיל כאן את ה-UID).

הכפתור **שליחת אירוע בדיקה** שולח `{ "event": "trigger-test", "createdAt": … }`.

## כותרות

| כותרת | ערך |
| --- | --- |
| `content-type` | `application/json` |
| `x-verdin-event` | שם האירוע. |
| `x-verdin-delivery` | מזהה השליחה. הוא נשאר זהה בין ניסיונות חוזרים: השתמשו בו כדי להתעלם מכפילויות. |
| `x-verdin-signature` | `t=<unix seconds>,v1=<hex>`, כשה-webhook חתום. |

Webhooks יכולים להוסיף כותרות משלהם, כמו אסימון `authorization` עבור נקודת הקצה שלכם. את
הכותרות שלמעלה אי אפשר לדרוס.

## אימות חתימות

Webhooks חתומים כברירת מחדל. `v1` הוא ה-HMAC-SHA256 בהקסדצימלי של `<t>.<raw body>`, עם
הסוד של ה-webhook (`whsec_…`) כמפתח. הסוד מוצג פעם אחת, כשה-webhook נוצר או כשהסוד שלו
מוחלף.

כדי לבדוק שליחה:

1. פצלו את הכותרת ל-`t` ול-`v1`.
2. דחו אותה אם `t` רחוק ביותר מכמה דקות מהשעון שלכם.
3. חשבו את ה-HMAC על `t`, נקודה וגוף הבקשה ה**גולמי**. אל תנתחו ותסדרו מחדש את ה-JSON
   קודם: הבייטים יהיו שונים.
4. השוו אותו ל-`v1` בזמן קבוע.

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

עם Express, קראו את הגוף הגולמי ואמתו אותו לפני הניתוח:

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

ב-Python:

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

## שליחה וניסיונות חוזרים

השליחות נכנסות לתור במסד הנתונים כשהשינוי נשמר, ו-worker ברקע שולח אותן. נקודת קצה
איטית או כושלת אף פעם לא מאטה עורכים או כתיבות ל-API, והשליחות שורדות הפעלה מחדש.

- **הצלחה**: כל תשובת `2xx`.
- **כישלון**: כל סטטוס אחר, כולל הפניות (שלא עוקבים אחריהן), שגיאת חיבור או חריגה
  מזמן ההמתנה (`[webhooks].timeout_secs`, 10 שניות כברירת מחדל).
- **ניסיונות חוזרים**: שליחה שנכשלה מנוסה שוב אחרי 30 שניות, 2 דקות, 10 דקות, שעה ו-6
  שעות, שישה ניסיונות בסך הכול. אחר כך היא מסומנת ככושלת.
- השבתה או מחיקה של webhook עוצרת את הניסיונות החוזרים הממתינים שלו.
- כמה מופעים חולקים את התור; כל שליחה נלקחת על ידי אחד מהם.

ענו מהר עם `2xx` ועשו עבודה איטית אחר כך. שליחות עשויות להגיע יותר מפעם אחת (ניסיון חוזר
אחרי חריגת זמן, למשל) ולא לפי הסדר: השתמשו ב-`x-verdin-delivery` כדי לדלג על כפילויות,
ושלפו מחדש את המסמך כשהסדר חשוב.

## יומן שליחות

לדף של כל webhook ב-**הגדרות ← Webhooks** יש **יומן שליחות**, מהחדש לישן. לכל שליחה הוא
מציג את הסטטוס (**ממתין**, **בשליחה**, **הצליח**, **נכשל**), סטטוס ה-HTTP, 2 ה-KB
הראשונים של גוף התגובה, השגיאה, מספר הניסיונות, מועד הניסיון הבא, משך הזמן וה-payload
שנשלח. אפשר לנסות שוב שליחה שנכשלה מתוך היומן.

שליחות שהסתיימו מוסרות אחרי `[webhooks].retention_days` (30 כברירת מחדל).

אותם נתונים זמינים ב-[API הניהול](/he/api/admin/):
`GET /admin/api/webhooks/{id}/deliveries` ו-`POST /admin/api/webhooks/deliveries/{id}/retry`.

## הגבלות על כתובות URL

תחת `verdin start`, כתובות webhook לא יכולות להפנות לכתובות loopback, פרטיות, link-local
או לכתובות שמורות אחרות, בין אם נכתבו ככתובות IP ובין אם כשמות מארח שמתורגמים אליהן. מנהל
לא יכול להשתמש ב-webhooks כדי להגיע לשירותים פנימיים. `verdin dev` מתיר אותן, כדי שתוכלו
לבדוק מול `localhost`; `[webhooks].allow_private_networks` דורס את ברירת המחדל. כתובות URL
עם פרטי התחברות (`https://user:pass@…`) נדחות: שימו אותם בכותרת.

## בהשוואה ל-Strapi

ה-payloads עוקבים אחרי אלה של Strapi (`event`, `createdAt`, `model`, `uid`, `entry`). Verdin
מוסיף חתימות, ניסיונות חוזרים, יומן שליחות ומסננים לפי סוג תוכן. האירוע
`entry.draft-discard` של Strapi נקרא `entry.discard-draft`.
