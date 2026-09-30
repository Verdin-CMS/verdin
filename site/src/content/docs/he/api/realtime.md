---
title: "API זמן אמת"
description: "פרוטוקול ה-Server-Sent Events של זרם הזמן האמת של Verdin: נקודת קצה, אימות, שמות אירועים ומבנה ההודעות, ופרוטוקול הנוכחות של פאנל הניהול."
sidebar:
  order: 5
  label: "זמן אמת"
---

Verdin משדר שינויים בתוכן ובמדיה ברגע שהם נשמרים, באמצעות
[Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events) (SSE).
כל מנוי מקבל רק אירועים על מה שמותר לו לקרוא. העמוד הזה מתאר את הפרוטוקול; לשימוש בו
בפרונטאנד, ראו [עדכונים בזמן אמת](/he/guides/frontend/realtime/).

## הפעלה

זמן אמת כבוי כברירת מחדל. הפעילו אותו ב-**הגדרות ← תכונות ← זמן אמת** (הרשאה
`features.manage`). כל עוד הוא כבוי, נקודות הקצה עונות `404`.

## זרם התוכן

```
GET /api/_events
GET /api/_events?types=api::article,api::category
```

| פרמטר | תיאור |
| --- | --- |
| `types` | אופציונלי, UIDs של סוגי תוכן מופרדים בפסיקים; `plugin::upload` הוא ספריית המדיה. גם צורת Strapi `api::article.article` עובדת. בלעדיו, מקבלים כל סוג שמותר לכם לקרוא. |

אמתו כמו ב-REST API: אסימון API או JWT של משתמש קצה ב-
`Authorization: Bearer …`, או בלי כותרת לגישה ציבורית. אסימון לא תקין עונה `401`
לפני שהזרם נפתח.

```sh title="Terminal"
curl -N -H "Authorization: Bearer $VERDIN_TOKEN" \
  'https://cms.example.com/api/_events?types=api::article'
```

```text
event: ready
data: {}

event: entry.publish
data: {"event":"entry.publish","uid":"api::article","documentId":"k2m7q4dx8n5t1v3b9c0e6a2wfr","locale":"en"}

event: media.create
data: {"event":"media.create","uid":"plugin::upload","documentId":"v3k9…","fileId":5}
```

## הודעות

האירוע הראשון הוא תמיד `ready`. אחריו כל שינוי הוא אירוע SSE שנקרא על שמו, וה-`data`
שלו הוא אובייקט JSON:

| שדה | מופיע | תיאור |
| --- | --- | --- |
| `event` | תמיד | שם האירוע, כמו בשורת ה-`event:` של SSE. |
| `uid` | תמיד | ה-UID של סוג התוכן, או `plugin::upload` למדיה. |
| `documentId` | תמיד | המסמך או הקובץ שהשתנה. |
| `locale` | סוגים מתורגמים | השפה של הגרסה שהשתנתה. |
| `fileId` | אירועי מדיה | המזהה המספרי של הקובץ, כפי שמשמש בשדות מדיה. |
| `actorId` | זרם הניהול | המנהל שביצע את השינוי, כשמנהל ביצע אותו. |

| אירועים | נשלחים כאשר | מי מקבל אותם |
| --- | --- | --- |
| `entry.create`, `entry.update`, `entry.discard-draft` | מסמך נוצר, נשמר, או שהטיוטה שלו נמחקה | בסוגים עם טיוטה ופרסום, מבקשים עם `readDrafts` (האירועים האלה משנים רק טיוטות). בסוגים אחרים, מבקשים עם `find` או `findOne`. |
| `entry.publish`, `entry.unpublish`, `entry.delete` | מסמך פורסם, פרסומו בוטל או שנמחק | מבקשים עם `find` או `findOne` על הסוג |
| `media.create`, `media.update`, `media.delete` | קובץ הועלה, נערך או נמחק | מבקשים עם `find` או `findOne` על ספריית המדיה |

אירועים נושאים מזהים, לא תוכן. כדי לקרוא את המסמך או הקובץ, שלפו אותו עם ה-REST או
ה-GraphQL API, עם ההרשאות הרגילות של המבקש. אירועים מגיעים מכל API: REST, GraphQL, פאנל
הניהול, מהדורות ותוספים.

## משך החיבור

- השרת שולח הערת keep-alive כל 15 שניות.
- זרם תוכן מסתיים אחרי שעה. התחברו מחדש (ה-`EventSource` של הדפדפנים עושה זאת
  לבד), וכך גם האסימון נבדק שוב.
- אירוע בשם `lagged`, עם `data: {"missed": 12}`, אומר שהלקוח קרא לאט מדי ושמספר כזה של
  אירועים הושמט. שלפו מחדש את מה שהלקוח מציג.
- אין שידור חוזר: אירועים שקורים בזמן שלקוח מנותק לא נשלחים מאוחר יותר.

ה-`EventSource` של הדפדפנים לא יכול לשלוח כותרת `Authorization`. לגישה ציבורית הוא עובד
כמו שהוא; עם אסימון, השתמשו ב-`fetch` עם קורא גוף בהזרמה, או בלקוח SSE שתומך בכותרות.

## זרם הניהול

פאנל הניהול פותח זרם משלו עם אסימון הגישה של המנהל:

```
GET /admin/api/events?types=api::article
```

הוא נושא את אותם אירועי תוכן ומדיה עבור הסוגים שהמנהל רשאי לקרוא (עם
`content.read` ו-`media.read`), כולל טיוטות, ובנוסף:

- `actorId` בשינויים שבוצעו על ידי מנהלים;
- אירועי `presence` (ראו בהמשך);
- `comment.create`, `comment.update`, `comment.delete`, `comment.resolve`,
  `comment.reopen`, `task.create`, `task.update` ו-`task.delete`, עם `uid`,
  `documentId` ו-`locale` של הרשומה.

זרם ניהול מסתיים אחרי 15 דקות, משך החיים של אסימון גישה: התחברו מחדש עם אסימון חדש.

### נוכחות

עורך הרשומות מודיע לשרת מי נמצא ברשומה:

```
POST /admin/api/presence
{ "uid": "api::article", "documentId": "k2m7q4…", "locale": "en", "editing": true }
```

- שלחו את זה בערך כל 20 שניות כל עוד העורך פתוח. `editing: true` אומר שלמנהל יש שינויים
  שלא נשמרו. שלחו `"leave": true` כשהעורך נסגר.
- נוכחות פגה 45 שניות אחרי פעימת הלב האחרונה.
- התשובה מפרטת מי נמצא ברשומה: `{ "data": [{ "userId": 3, "name": "Ada Lovelace", "editing": true, "holdsLock": true }] }`.
- `GET /admin/api/presence?uid=&documentId=&locale=` קורא את אותה רשימה.
- כשהרשימה משתנה, זרמי הניהול מקבלים אירוע `presence` עם ה-`uid`, ה-`documentId`
  וה-`locale` של הרשומה, והרשימה ב-`presence`.

המנהל הראשון שעדיין עורך מחזיק נעילה רכה (`holdsLock`). העורך מציג אותה לאחרים, אבל היא
לא חוסמת את השמירות שלהם. קריאת נוכחות דורשת `content.read` על הסוג.

## כמה מופעים

עם אפיק האירועים המשותף (`[cluster].bus = "database"`), הזרמים של כל מופע נושאים את
האירועים של כולם, והנוכחות והנעילות הרכות זהות בכל מופע. אירועים ממופע אחר מגיעים בתוך
`[cluster].poll_interval_ms` (MySQL, MariaDB, SQLite) או מיד (PostgreSQL, `LISTEN/NOTIFY`).
בלי האפיק, האירועים והנוכחות הם של המופע שאליו הלקוח מחובר: נתבו את `/api/_events` ואת
`/admin/api/events` עם sticky sessions, או הריצו את לקוחות הזמן האמת מול מופע אחד. ראו
[הרחבה](/he/deploy/scaling/#אפיק-אירועים-משותף).
