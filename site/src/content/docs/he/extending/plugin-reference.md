---
title: תיעוד התוספים
description: המניפסט plugin.toml, יכולות, hooks וה-payloads שלהם, פונקציות מארח, נתיבים, משימות, פונקציית ההפעלה, שדות GraphQL, נקודות הרחבה בפאנל הניהול, מגבלות ומדדים.
sidebar:
  order: 3
---

<!-- Written from crates/verdin-plugins (lib.rs, manifest.rs), crates/verdin-api/src/plugins.rs,
plugins_admin.rs, crates/verdin-graphql/src/lib.rs, crates/verdin/src/metrics.rs and
admin/src/app/core/plugin-extensions.ts. -->

העמוד הזה הוא החוזה המלא בין Verdin לבין תוסף: המניפסט, מה Verdin שולח לכל פונקציה מיוצאת
ומה הוא מצפה לקבל בחזרה, ופונקציות המארח שמודול יכול לקרוא להן. למבוא, ראו
[תוספים](/he/extending/plugins/); לדוגמה מלאה, את [מדריך התוספים](/he/extending/plugin-tutorial/).

## תיקיית התוסף

כל תוסף הוא תיקייה תחת `[plugins].path` (ברירת המחדל `plugins/`, ליד `verdin.toml`):

| קובץ | חובה | תוכן |
| --- | --- | --- |
| `plugin.toml` | כן | המניפסט. |
| `plugin.wasm` | כן | המודול (נתיב אחר עם `wasm`). |
| `admin/` | לא | קבצים שפאנל הניהול טוען: המודול `admin.script` והנכסים שלו. |

בהפעלה Verdin טוען כל תיקייה שיש בה `plugin.toml`, לפי סדר השמות. תיקייה מדולגת, ומופיעה
עם הסיבה ב-**הגדרות ← תוספים**, כשהמניפסט שלה לא תקין, המודול שלה חסר, או שלתוסף אחר כבר
יש את ה-`name` שלה.

## מניפסט

```toml title="plugins/slugs/plugin.toml"
name = "slugs"
version = "1.0.0"
description = "Slugs from titles, and a color field"

[capabilities]
read = ["api::article"]
write = ["api::tag"]
http = ["api.example.com"]
kv = true
public_permissions = true

[limits]
timeout_ms = 5000
memory_mb = 64

[[hooks]]
on = "beforeCreate"
uid = "api::article"
function = "before_write"

[routes]
function = "handle"

[[jobs]]
schedule = "*/15 * * * *"
function = "refresh"

[startup]
function = "seed"
timeout_ms = 30000

[[graphql]]
name = "slugStats"
function = "stats"

[admin]
script = "index.js"

[[admin.widgets]]
id = "stats"
title = "Slug stats"
element = "slugs-stats"

[[admin.fields]]
id = "color"
title = "Color"
element = "slugs-color"
type = "string"

[[settings]]
key = "separator"
label = "Separator"
type = "select"
options = ["-", "_"]
default = "-"
```

מפתחות לא מוכרים הם שגיאות, בכל טבלה.

### מפתחות ברמה העליונה

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `name` | חובה | המזהה של התוסף בכתובות URL, בהגדרות ובשדות מותאמים: אותיות קטנות, ספרות ו-`-`, מתחיל באות, עד 64 תווים. |
| `version` | חובה | מוצג בפאנל הניהול וביומן. |
| `description` | לא מוגדר | מוצג ב-**הגדרות ← תוספים**. |
| `wasm` | `"plugin.wasm"` | המודול, יחסית לתיקיית התוסף (בלי `..`, לא מוחלט). |
| `wasi` | `false` | נותן למודול WASI: שעון ומספרים אקראיים. בכל מקרה בלי קבצים או sockets. |

### `[capabilities]`

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `read` | `[]` | סוגי התוכן ש-`verdin_content` רשאי לקרוא (`findMany`, `findOne`): UIDs כמו `api::article`, או `"*"` לכולם. |
| `write` | `[]` | סוגי התוכן שהוא רשאי לבצע עליהם `create`, `update`, `delete`, `publish` ו-`unpublish`. כולל `read`. |
| `http` | `[]` | המארחים שהמודול רשאי לשלוח אליהם בקשות HTTP: `api.example.com`, או `*.example.com`. |
| `kv` | `false` | אחסון key-value משלו של התוסף (`verdin_kv_get`, `verdin_kv_set`). |
| `public_permissions` | `false` | קריאה והחלפה של הרשאות ה-API של התפקיד הציבורי (`verdin_public_permissions`). |

היכולות מגבילות רק קריאות למארח. hooks רצים על הסוגים שהם מציינים בלי קשר למה ש-`read`
אומר, ונתיבים נגישים לכל אחד.

### `[limits]`

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `timeout_ms` | `5000` | מגבלת הזמן של קריאה אחת, במילישניות. |
| `memory_mb` | `64` | הזיכרון המרבי של המודול, במגה-בייטים. |

שניהם חייבים להיות חיוביים.

### `[[hooks]]`

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `on` | חובה | האירוע, ראו בהמשך. |
| `uid` | `"*"` | סוג התוכן (`api::article`), או `"*"` לכולם. |
| `function` | חובה | הפונקציה המיוצאת שנקראת. |

אירועים:

| לפני הכתיבה | אחרי הכתיבה |
| --- | --- |
| `beforeCreate` | `afterCreate` |
| `beforeUpdate` | `afterUpdate` |
| `beforeDelete` | `afterDelete` |
| `beforePublish` | `afterPublish` |
| `beforeUnpublish` | `afterUnpublish` |
| `beforeDiscardDraft` | `afterDiscardDraft` |

השמות הם שמות ה-lifecycle של Strapi. hooks רצים על כתיבות מפאנל הניהול, מה-REST וה-GraphQL
APIs וממהדורות, אבל לא על כתיבות שמבוצעות על ידי פקודות `verdin import`. כתיבות שמבוצעות
על ידי תוספים מריצות את ה-hooks מסוג after אבל לא את מסוג before (ראו
[כתיבות שמבוצעות על ידי תוספים](#כתיבות-שמבוצעות-על-ידי-תוספים)).

### `[routes]`

| מפתח | תיאור |
| --- | --- |
| `function` | הפונקציה המיוצאת שמגישה כל בקשה ל-`/api/plugins/<name>` ול-`/api/plugins/<name>/…`, בכל שיטה. |

הנתיב עוקב אחרי `[api].prefix`.

### `[[jobs]]`

| מפתח | תיאור |
| --- | --- |
| `schedule` | ביטוי cron, ב-UTC, עם שניות אופציונליות: `*/15 * * * *`, `0 0 3 * * *`. |
| `function` | הפונקציה המיוצאת שנקראת. |

### `[startup]`

פונקציה שרצה כשהתוסף עולה: מה שפרויקט Strapi עושה ב-`bootstrap` (זריעת תוכן, הגדרת התפקיד
הציבורי).

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `function` | חובה | הפונקציה המיוצאת שנקראת. |
| `timeout_ms` | `30000` | מגבלת הזמן שלה, במילישניות (זריעה יכולה לקחת יותר זמן מ-hook). חייב להיות חיובי. |

ראו [פונקציית ההפעלה](#פונקציית-ההפעלה) לגבי מתי היא רצה.

### `[[graphql]]`

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `name` | חובה | שם השדה: מתחיל באות קטנה, ואחריה אותיות, ספרות ו-`_`. |
| `function` | חובה | הפונקציה המיוצאת שפותרת אותו. |
| `mutation` | `false` | מוסיף את השדה ל-`Mutation` במקום ל-`Query`. |
| `description` | לא מוגדר | התיאור של השדה בסכמה. |

כל רשומה מוסיפה `name(args: JSON): JSON`. שם שסוג תוכן כבר משתמש בו, או שתוסף אחר לקח קודם,
מדולג עם אזהרה ביומן.

### `[admin]`

| מפתח | תיאור |
| --- | --- |
| `script` | מודול ES תחת `admin/` שמגדיר את ה-custom elements (בלי `..`, לא מוחלט). |
| `[[admin.widgets]]` | סוגי ווידג'טים ללוח הבקרה: `id`, `title`, `element`, ו-`description` אופציונלי. |
| `[[admin.fields]]` | שדות מותאמים: `id`, `title`, `element`, `type` (טיפוס המאפיין שבו הערך נשמר, כמו `string` או `json`), ו-`description` אופציונלי. |

`element` הוא שם של custom element: אותיות קטנות, ספרות ו-`-`, עם `-` אחד לפחות
(`slugs-color`).

### `[[settings]]`

מצהיר על הטופס של **הגדרות ← תוספים ← הגדרות**. בלי אף רשומה, ההגדרות הן אובייקט JSON
חופשי.

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `key` | חובה | המפתח באובייקט ההגדרות: אותיות, ספרות ו-`_`, לא מתחיל בספרה, ייחודי. |
| `label` | חובה | התווית בטופס. |
| `type` | `"string"` | `string`, `text`, `url`, `number`, `integer`, `boolean` או `select`. |
| `description` | לא מוגדר | טקסט עזרה מתחת לשדה. |
| `required` | `false` | נדרש ערך (לא ריק בטקסט), אלא אם יש `default`. |
| `options` | `[]` | האפשרויות של `select` (חובה עבורו). |
| `default` | לא מוגדר | משמש כשהמפתח חסר או `null`. חייב להתאים לשדה. |
| `min`, `max` | לא מוגדר | גבולות של ערכי `number` ו-`integer`; גבולות אורך של `string` ו-`text`. |

ערכי `url` הם ריקים או כתובות `http(s)://`. עם טופס, השרת דוחה הגדרות עם מפתחות לא מוכרים,
טיפוסים שגויים, ערכים מחוץ לגבולות או ערכי חובה חסרים (400).

## פונקציות מיוצאות

כל פונקציה מיוצאת מקבלת מסמך JSON אחד ומחזירה אחד (או כלום). פלט ריק נחשב `null`; פלט שאינו
JSON נחשב כישלון.

### Before hooks

קלט:

```json
{
  "event": "beforeUpdate",
  "uid": "api::article",
  "documentId": "01m3p88ry359w82nsx496mep5t",
  "locale": "en",
  "data": { "title": "Hello" }
}
```

| שדה | תיאור |
| --- | --- |
| `event` | האירוע של ה-hook. |
| `uid` | סוג התוכן. |
| `documentId` | המסמך, או `null` ב-`beforeCreate`. |
| `locale` | בסוגים מתורגמים, השפה שנכתבת (שפת ברירת המחדל כשהבקשה לא ציינה שפה); `null` בסוגים אחרים. |
| `data` | הנתונים שנכתבים, כפי שהבקשה שלחה אותם: ביצירה ובעדכון. `null` לאירועים האחרים. בעדכון, רק השדות שנשלחו. |

פלט:

| פלט | השפעה |
| --- | --- |
| `{ "data": { … } }` | מחליף את הנתונים שנכתבים. הם מאומתים כמו המקוריים. |
| `{ "error": "message" }` | דוחה את הכתיבה: המבקש מקבל 400 עם ההודעה. |
| `{}` או כל דבר אחר | הכתיבה ממשיכה ללא שינוי. |

כשכמה hooks מתאימים, הם רצים לפי סדר התוספים (שמות התיקיות), ואז לפי סדר המניפסט; כל אחד
רואה את הנתונים שהקודם החזיר. hook שנכשל (trap, חריגת זמן, פלט לא תקין) נרשם ביומן ומדולג:
הכתיבה ממשיכה.

### After hooks

קלט: `{ "event", "uid", "documentId", "locale" }`, שנשלח אחרי שהכתיבה בוצעה (commit). הפלט
נזנח; כישלונות נרשמים ביומן. קראו את הרשומה עם `verdin_content` אם אתם צריכים את השדות שלה
(עם היכולת `read`).

### נתיבים

קלט:

```json
{
  "method": "GET",
  "path": "/stats",
  "query": "page=2&sort=title",
  "headers": { "accept": "application/json", "user-agent": "curl/8.7.1" },
  "body": "",
  "actor": { "kind": "public" }
}
```

| שדה | תיאור |
| --- | --- |
| `method` | שיטת ה-HTTP. |
| `path` | הנתיב שאחרי `/api/plugins/<name>`, מתחיל ב-`/` (`/` לשורש של התוסף). |
| `query` | מחרוזת השאילתה הגולמית, בלי `?` (ריקה כשאין). |
| `headers` | רק `content-type`, `accept`, `user-agent` ו-`accept-language`, כשהם קיימים. |
| `body` | גוף הבקשה כמחרוזת (UTF-8 לא תקין מוחלף). |
| `actor` | מי קורא: `{ "kind": "public" }`, `{ "kind": "token", "id": 3 }` (אסימון API) או `{ "kind": "user", "id": 12 }` (משתמש קצה מחובר). |

כותרת `Authorization` עם אסימון לא תקין נדחית עם 401 לפני שהתוסף נקרא. הרשאות הגישה
הציבורית ואסימוני ה-API לא מוחלות: בדקו את `actor` בעצמכם.

פלט:

| שדה | ברירת מחדל | תיאור |
| --- | --- | --- |
| `status` | `200` | סטטוס ה-HTTP. |
| `headers` | אין | כותרות התגובה. נשמרות רק `content-type`, `cache-control`, `location`, `etag`, `last-modified` ו-`content-disposition`. |
| `body` | ריק | מחרוזת נשלחת כמו שהיא (`text/plain` אלא אם הגדרתם `content-type`); כל ערך JSON אחר נשלח כ-`application/json`. |

תוסף מושבת או לא מוכר, או תוסף בלי `[routes]`, עונה 404. קריאה שנכשלה עונה 502 עם
`{ "data": null, "error": { "status": 502, "name": "PluginError", … } }`. הנתיבים חולקים עם
API התוכן את `[server].body_limit` ואת `[server].request_timeout_secs`.

### משימות

קלט: `{ "scheduledAt": "2026-09-29T03:00:00+00:00" }`, הזמן שאליו ההרצה תוזמנה. הפלט נזנח;
כישלונות נרשמים ביומן. משימות רצות רק כשהתוסף פעיל, ורק במופעים עם
`[plugins].run_jobs = true`. הרצה שהוחמצה בזמן שהשרת היה למטה לא מושלמת.

### פונקציית ההפעלה

קלט: `{ "reason": "start" | "enabled" | "settings" }`:

| `reason` | מתי |
| --- | --- |
| `start` | השרת עלה כשהתוסף פעיל. |
| `enabled` | התוסף הופעל (כאן, או במופע אחר והשינוי נקלט כאן). |
| `settings` | ההגדרות שלו השתנו בזמן שהיה פעיל (נשמרו כאן, או נקלטו ממופע אחר). |

פלט: `{ "error": "message" }` נחשב כישלון; כל דבר אחר (`{}`, ריק) נחשב הצלחה. כישלון (trap,
חריגת זמן, `{ error }`) נרשם ביומן התוסף וביומן השרת; התוסף נשאר פעיל, והפונקציה רצה שוב
בהפעלה, בהדלקה או בשינוי ההגדרות הבא.

הפונקציה רצה ברקע, אחרי שהשרת עלה, כך שבקשות מוגשות בינתיים. היא רצה על מופע מודול משלה עם
`[startup].timeout_ms`, כך שזריעה איטית לא עוצרת את ה-hooks והנתיבים של התוסף. hooks מסוג
after שהכתיבות שלה מפעילות רצים אחרי שהיא חוזרת (ראו
[כתיבות שמבוצעות על ידי תוספים](#כתיבות-שמבוצעות-על-ידי-תוספים)). הזיכרון של המודול לא
משותף עם המופע הרגיל של התוסף: שמרו מצב ב-`verdin_kv_set` או בתוכן.

עם כמה מופעים, רק אלה עם `[plugins].run_jobs = true` מריצים פונקציות הפעלה (מופע אחד, אם
אתם פועלים לפי [עצת ההרצה במספר מופעים](/he/deploy/scaling/)): הן פועלות על מסד הנתונים
המשותף, כך שפעם אחת מספיקה. כתבו את הפונקציה כך שהרצה חוזרת שלה לא תזיק: חפשו את מה
שאתם זורעים לפני שאתם יוצרים אותו.

### שדות GraphQL

קלט: `{ "args": …, "actor": … }`, כאשר `args` הוא הארגומנט `args` של השדה (כל JSON, או
`null`) ו-`actor` כמו בנתיבים. הפלט הוא הערך של השדה. כישלון, או תוסף מושבת, עונים בשגיאת
GraphQL עם הקוד `PLUGIN_ERROR`. כמו בנתיבים, התוסף בודק את הגישה.

## פונקציות מארח

ייבאו אותן ממרחב השמות `extism:host/user` (`extern "ExtismHost"` ב-Rust). הן מקבלות ומחזירות
JSON כמחרוזות; `Json<Value>` ב-`extism-pdk` מטפל בהמרה.

| פונקציה | קלט | פלט |
| --- | --- | --- |
| `verdin_log` | `{ "level": "info" \| "warn" \| "error", "message": "…" }` | אין |
| `verdin_content` | בקשת תוכן (ראו בהמשך) | התוצאה, או `{ "error": "…" }` |
| `verdin_kv_get` | המפתח, כמחרוזת פשוטה | ערך ה-JSON השמור, או `null` |
| `verdin_kv_set` | `{ "key": "…", "value": … }` | אין |
| `verdin_config` | אין | אובייקט ההגדרות, עם ברירות המחדל שהוצהרו |
| `verdin_public_permissions` | `{ "op": "get" }` או `{ "op": "set", "permissions": [...] }` | `{ "permissions": [...] }`, או `{ "error": "…" }` |

מודול שמייבא פונקציית מארח שאין לשרת (Verdin ישן יותר) לא ניתן לטעינה: כל קריאה אליו
נכשלת עם `unknown import` ביומן השרת.

### `verdin_log`

כותב ליומן השרת (עם שם התוסף) וליומן של התוסף ב-**הגדרות ← תוספים ← יומנים**. רמות אחרות
נחשבות `info`. היומן של התוסף שומר בזיכרון את 200 ההודעות האחרונות, כל אחת חתוכה ב-2,000
תווים.

### `verdin_content`

```json
{ "op": "findMany", "uid": "api::article", "query": { "filters": { "title": { "$eq": "x" } }, "sort": ["title"] } }
```

| שדה | בשימוש ב | תיאור |
| --- | --- | --- |
| `op` | כולם | `findMany`, `findOne`, `create`, `update`, `delete`, `publish` או `unpublish`. |
| `uid` | כולם | סוג התוכן. חייב להופיע ביכולות. |
| `documentId` | `findOne`, `update`, `delete`, `publish`, `unpublish` | המסמך. |
| `query` | `findMany`, `findOne` | הפרמטרים של ה-REST API כאובייקט JSON: `filters`, `sort`, `fields`, `populate`, `pagination`, `status`. |
| `data` | `create`, `update` | השדות לכתיבה, כמו ב-`data` של בקשת REST. |
| `status` | `create`, `update` | `"draft"` שומר טיוטה. אחרת הכתיבה מתפרסמת, כמו כתיבת REST בלי `?status=draft`. |
| `locale` | כולם | השפה לקריאה או לכתיבה. |

תוצאות:

| `op` | תוצאה |
| --- | --- |
| `findMany` | `{ "documents": [...], "meta": { "pagination": {…} } }` |
| `findOne` | `{ "document": {…} }` (`null` כשלא נמצא) |
| `create`, `update` | `{ "documentId": "…" }` |
| `delete` | `{ "deleted": true }` |
| `publish` | `{ "published": true }` |
| `unpublish` | `{ "unpublished": true }` |

קריאה מחוץ ליכולות, פעולה לא מוכרת, שגיאת אימות או מסמך חסר עונים במקום זאת
`{ "error": "…" }`. קריאות מחזירות גרסאות מפורסמות אלא אם השאילתה מבקשת `"status": "draft"`.

#### כתיבות שמבוצעות על ידי תוספים

כתיבות דרך `verdin_content` מדלגות על ה-hooks מסוג **before** של כל התוספים, כך שתוסף לא
יכול להיכנס שם ללולאה על השינויים של עצמו, וכללים שהצבתם ב-before hooks (ברירות מחדל,
בדיקות) לא חלים עליהן. כל השאר חל: אימות, שלבי בקרה, webhooks, היסטוריה, יומן הביקורת,
וה-hooks מסוג **after** של כל התוספים, כולל התוסף שכותב.

hooks מסוג after שכתיבות של תוסף מפעילות לא רצים בתוך הכתיבה: הם נכנסים לתור ורצים אחרי
שהקריאה של התוסף (נתיב, משימה, resolver של GraphQL, hook או פונקציית הפעלה) חזרה ושחררה את
המופע של התוסף, לפני שתגובת הנתיב נשלחת. כך תוסף יכול לכתוב סוג שיש לו after hooks, ושרשראות
דרך כמה תוספים עובדות.

- hooks שכותבים מפעילים hooks נוספים, **לכל היותר `4` רמות עומק** (כתיבה מ-REST או
  GraphQL היא רמה 1). hooks עמוקים יותר מדולגים עם אזהרה ביומן התוסף, מה שמונע מ-hook
  שכותב לסוג שהוא מאזין לו להיכנס ללולאה אינסופית.
- פונקציות מארח (`verdin_content`, `verdin_public_permissions`, מאגר ה-key-value) נעצרות
  במגבלת הזמן של הקריאה ומחזירות שגיאה למודול, וקורא ממתין לכל היותר את מגבלת הזמן ועוד 10
  שניות לתוסף עסוק. קריאה תקועה לא יכולה להחזיק את התוסף, או עצירה מסודרת, לנצח.

### `verdin_kv_get` ו-`verdin_kv_set`

מאגר key-value לכל תוסף, במסד הנתונים של Verdin, שמשותף לכל המופעים. המפתחות באורך 1 עד 255
בייטים; הערכים הם כל JSON. הגדרת `null` מוחקת את המפתח. בלי היכולת `kv`, קריאות מחזירות
`null` וכתיבות נזנחות.

### `verdin_config`

מחזיר את ההגדרות שנשמרו ב-**הגדרות ← תוספים**, עם ה-`default` של כל הגדרה מוצהרת עבור
מפתחות חסרים. `{}` כששום דבר לא נשמר.

### `verdin_public_permissions`

קורא או מחליף את הרשאות ה-API של התפקיד הציבורי, מה ש-**הגדרות ← גישה ציבורית** עורך.
דורש את היכולת `public_permissions`; בלעדיה, כל קריאה עונה `{ "error": "…" }`.

```json
{ "op": "set", "permissions": [
  { "subject": "api::article", "action": "find" },
  { "subject": "api::article", "action": "findOne" },
  { "subject": "api::comment", "action": "create" }
] }
```

| `op` | השפעה |
| --- | --- |
| `get` | כלום; מחזיר את ההרשאות הנוכחיות. |
| `set` | מחליף את **כל** ההרשאות הציבוריות ב-`permissions` (רשימה ריקה מסירה את כולן). |

שניהם עונים `{ "permissions": [{ "subject", "action" }, …] }`, ממוין. `subject` הוא uid של
סוג תוכן, `plugin::upload` (ספריית המדיה), `plugin::users-permissions.user` (משתמשי קצה דרך
API התוכן) או `plugin::i18n.locale` (`find` בלבד). `action` הוא `find`, `findOne`, `create`,
`update`, `delete`, `publish` או `readDrafts` (השניים האחרונים לא חלים על העלאות ומשתמשי קצה).
הם נבדקים כמו טבלת ההענקות של הניהול: subject או action לא מוכרים, או כאלה שלא חלים, עונים
`{ "error": "…" }` ולא משנים דבר. כל `set` נרשם ביומן השרת.

### HTTP

עם מארחים שמפורטים ב-`http`, השתמשו בתמיכת ה-HTTP של Extism (`extism_pdk::http::request`
ב-Rust). בקשות למארחים אחרים נכשלות.

## נקודות הרחבה בפאנל הניהול

פאנל הניהול מבקש מהשרת את ההרחבות של התוספים הפעילים ומייבא כל `admin.script` פעם אחת,
כמודול ES, מ-`/admin/plugins/<name>/<script>` (תחת `[admin].path`). קבצים תחת תיקיית
`admin/` של התוסף מוגשים שם כל עוד התוסף פעיל, עם `X-Content-Type-Options: nosniff`
ו-`Cache-Control: no-cache`. המודול חייב להגדיר את ה-custom elements שהמניפסט מציין; element
שלא הוגדר תוך 3 שניות מושמט.

### ווידג'טים

כל רשומת `[[admin.widgets]]` היא סוג ווידג'ט שמנהלים יכולים להוסיף ללוח הבקרה. ה-element
מקבל מאפיין `context`:

| מאפיין | תיאור |
| --- | --- |
| `apiBase` | הבסיס של API התוכן, כמו `/api`. |
| `adminApiBase` | הבסיס של API הניהול, כמו `/admin/api`. |
| `fetch(path, init)` | `fetch` עם פרטי ההתחברות של המנהל המחובר. נתיבים יחסיים נפתרים מול `adminApiBase`; נתיבים תחת אחד הבסיסים וכתובות URL מוחלטות נשמרים. |

```js title="plugins/slugs/admin/index.js"
class SlugStats extends HTMLElement {
  set context(context) {
    // Admin API, with the admin's session.
    context.fetch('auth/me').then((response) => response.json())
      .then(({ data }) => { this.textContent = `Hello ${data.firstname ?? data.email}`; });
    // The plugin's own route, on the content API: sent without the admin's session.
    context.fetch(`${context.apiBase}/plugins/slugs/stats`).then((response) => response.json())
      .then((stats) => { this.title = JSON.stringify(stats); });
  }
}
customElements.define('slugs-stats', SlugStats);
```

`context.fetch` שולח את הסשן של המנהל רק עם בקשות ל-API הניהול. נתיבים תחת
`context.apiBase` (API התוכן, כולל הנתיבים של התוסף שלכם) נשלחים בלעדיו, כי API התוכן לא
מקבל סשנים של ניהול; הם נענים עם ההרשאות של התפקיד הציבורי. לפני 0.10 הוא שלח את הסשן גם
לשם והבקשות האלה נכשלו; ווידג'טים שנכתבו עבור 0.9 וקוראים ל-`fetch` רגיל ממשיכים לעבוד.

### שדות מותאמים

כל רשומת `[[admin.fields]]` היא שדה שמאפיינים יכולים להשתמש בו עם
`"customField": "plugin::<name>.<id>"`; ה-`type` של המאפיין חייב להתאים לאופן שבו השדה שומר
את הערך שלו. **בונה סוגי התוכן** מציע אותו. ה-element מקבל:

| מאפיין | תיאור |
| --- | --- |
| `value` | הערך הנוכחי. |
| `disabled` | האם העריכה כבויה. |
| `attribute` | ההגדרה של המאפיין מהסכמה. |
| `locale` | השפה שנערכת. |

הוא מדווח על ערך חדש עם אירוע `change` שה-`detail` שלו הוא הערך (או, בלי `detail`, דרך
המאפיין `value` שלו עצמו). כשהתוסף כבוי או שה-element שלו חסר, העורך מציג את הקלט הרגיל של
טיפוס האחסון. ראו [טיפוסי מאפיינים](/he/reference/attribute-types/).

## זמן ריצה ומגבלות

| מגבלה | ערך |
| --- | --- |
| זמן לקריאה | `[limits].timeout_ms`, ברירת מחדל 5,000 ms (`[startup].timeout_ms`, ברירת מחדל 30,000 ms, לפונקציית ההפעלה) |
| זיכרון | `[limits].memory_mb`, ברירת מחדל 64 MB |
| מקביליות | קריאה אחת בכל פעם לכל תוסף; הקריאות מחכות זו לזו (פונקציית ההפעלה רצה לצידן) |
| מופע מודול | אחד לכל תוסף, נבנה בשימוש הראשון; נבנה מחדש אחרי שקריאה נכשלת (הזיכרון שלו אובד). פונקציית ההפעלה מקבלת חדש בכל הרצה |
| יומן | 200 הודעות לכל תוסף, 2,000 תווים כל אחת, בזיכרון |
| מפתחות KV | 1 עד 255 בייטים |
| כותרות בקשה בנתיבים | `content-type`, `accept`, `user-agent`, `accept-language` |
| כותרות תגובה בנתיבים | `content-type`, `cache-control`, `location`, `etag`, `last-modified`, `content-disposition` |

שינויים במניפסט או במודול חלים אחרי הפעלה מחדש; מתגים והגדרות חלים מיד. ניהול תוספים דורש
`plugins.manage` (ראו את [תיעוד ההרשאות](/he/reference/permissions/)).

## מדדים

כש-[`[metrics]`](/he/deploy/monitoring/) פעיל, `/_metrics` מדווח על כל קריאה שהגיעה לפונקציה
מיוצאת:

| מדד | סוג | תוויות | משמעות |
| --- | --- | --- | --- |
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`, `kind`, `function` | זמן שפונקציות תוסף לקחו. דליים מ-5 ms עד 10 s. |
| `verdin_plugin_call_errors_total` | counter | `plugin`, `kind`, `function` | קריאות שנכשלו: trap, חריגת זמן, פלט שאינו JSON, או `{ error }` של פונקציית הפעלה. |

`kind` הוא `hook`, `route`, `job`, `startup` או `graphql`. before hook שדוחה כתיבה עם
`{ error }` נתן תשובה, ולכן לא נספר ככישלון. קריאות לפונקציה שהמודול לא מייצא לא נרשמות,
כך שהתוויות מוגבלות לפי התוספים המותקנים. הסדרות מופיעות אחרי הקריאה הראשונה של תוסף; כל
מופע סופר את הקריאות שלו.
