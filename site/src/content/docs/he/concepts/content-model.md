---
title: "מודל התוכן"
description: "איך Verdin מתאר את התוכן שלכם: סוגי אוסף וסוגים יחידים, מאפיינים, קובצי סכמה בפורמט של Strapi, וכללי אימות."
sidebar:
  order: 1
---

מודל התוכן הוא אוסף סוגי התוכן והרכיבים שהפרויקט שלכם מגדיר. Verdin גוזר ממנו את כל השאר:
טבלאות מסד הנתונים, ה-REST וה-GraphQL APIs, מסמך ה-OpenAPI, האימות והטפסים של פאנל
הניהול. העמוד הזה מסביר את החלקים ואת הכללים שחלים עליהם.

## סוגי תוכן

סוג תוכן מתאר סוג אחד של מסמך, כמו מאמר או דף בית. יש לו `kind`:

| Kind | מחזיק | נתיבי REST (דוגמת הבלוג) |
| --- | --- | --- |
| `collectionType` | כל מספר של מסמכים | `/api/articles`, `/api/articles/{documentId}` |
| `singleType` | לכל היותר מסמך אחד | `/api/homepage` |

סוגי אוסף מוגשים לפי ה-`pluralName` שלהם, סוגים יחידים לפי ה-`singularName` שלהם.
ה-`PUT` הראשון לסוג יחיד יוצר את המסמך שלו. לכל הנתיבים, ראו את ה-[REST API](/he/api/rest/).

לכל סוג תוכן יש UID, `api::<singularName>` (`api::article`). Strapi כותב את אותו UID
כ-`api::article.article`; Verdin מקבל את הצורה הזו בקובצי סכמה ובמייבא, ומנרמל אותה
ל-`api::article`.

לכל מסמך יש שדות מערכת שלא מצהירים עליהם: `id`, `documentId` (ULID באותיות קטנות באורך 26
תווים, יציב בין טיוטות, גרסאות מפורסמות ושפות), `createdAt`, `updatedAt`, `publishedAt`,
ו-`locale` ב[סוגים מתורגמים](/he/concepts/internationalization/).

## קובצי סכמה

סוגי תוכן ורכיבים הם קובצי JSON בתיקייה `schema/` של הפרויקט שלכם
(`[schema].path` ב-`verdin.toml`). מנהלים להם גרסאות ב-git כמו לקוד.

```
schema/
├── content-types/
│   ├── article.json
│   ├── category.json
│   ├── tag.json
│   └── homepage.json
└── components/
    ├── blocks/
    │   ├── hero.json
    │   └── quote.json
    └── shared/
        └── seo.json
```

הפורמט הוא ה-`schema.json` של Strapi, כך שרוב הסכמות של Strapi נטענות בלי שינוי. זה סוג
המאמר של [דוגמת הבלוג](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog):

```json title="schema/content-types/article.json"
{
  "kind": "collectionType",
  "singularName": "article",
  "pluralName": "articles",
  "displayName": "Article",
  "options": { "draftAndPublish": true },
  "attributes": {
    "title": { "type": "string", "required": true, "maxLength": 200 },
    "slug": { "type": "uid", "targetField": "title", "required": true },
    "excerpt": { "type": "text", "maxLength": 500 },
    "body": { "type": "richtext" },
    "readingTime": { "type": "integer", "min": 0 },
    "featured": { "type": "boolean", "default": false },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "tags": { "type": "relation", "relation": "manyToMany", "target": "tag" },
    "seo": { "type": "component", "component": "shared.seo" },
    "blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"] }
  }
}
```

| מפתח | חובה | תיאור |
| --- | --- | --- |
| `kind` | כן | `collectionType` או `singleType`. |
| `singularName` | כן | Kebab-case. חייב להתאים לשם הקובץ (`article.json`). |
| `pluralName` | כן | Kebab-case, שונה מ-`singularName`. |
| `displayName` | כן | השם שפאנל הניהול מציג. |
| `description` | לא | מוצג בפאנל הניהול. |
| `collectionName` | לא | שם הטבלה. ברירת המחדל היא `pluralName` ב-snake_case. |
| `options.draftAndPublish` | לא | שמירת טיוטה וגרסה מפורסמת לכל מסמך. ברירת המחדל `false`. ראו [טיוטה ופרסום](/he/concepts/draft-and-publish/). |
| `pluginOptions.i18n.localized` | לא | גרסה אחת לכל שפה. ברירת המחדל `false`. ראו [בינאום](/he/concepts/internationalization/). |
| `attributes` | לא | השדות, בסדר שבו ה-API מחזיר אותם. |
| `validations` | לא | כללים בין שדות; ראו [בהמשך](#אימותים-בין-שדות). |

הסכמות קפדניות: מפתח לא מוכר, אפשרות שהסוג לא תומך בה, או הפניה לסוג או לרכיב חסרים הם
שגיאה שמציינת את הקובץ ואת הנתיב, והשרת לא עולה. הריצו `verdin schema check` כדי לאמת את
הקבצים בלי להפעיל אותו.

חלק מהשמות תפוסים:

- שמות מאפיינים מתחילים באות, ואחריה אותיות, ספרות וקווים תחתונים, עד 50 תווים. הם הופכים
  לעמודות ב-snake_case (`metaTitle` → `meta_title`).
- `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`,
  `updatedAt`, `createdBy` ו-`updatedBy` שמורים בסוגי תוכן, ו-`id` בתוך רכיבים.
- `upload`, `uploads`, `auth`, `users` ו-`connect` לא יכולים להיות `singularName` או
  `pluralName`: הנתיבים האלה שייכים ל-API.
- לסוג תוכן יש לכל היותר 60 מאפייני `string`, `email`, `uid` ו-`enumeration`, כדי שהשורות
  יישארו בתוך מגבלת גודל השורה של MySQL. השתמשו ב-`text` עבור חלק מהם.

עורכים את הקבצים ב**בונה סוגי התוכן** של פאנל הניהול, שזמין כשהשרת רץ עם `verdin dev`, או
ידנית. בכל מקרה, שינוי הופך ל[הגירת סכמה](/he/concepts/schema-migrations/). פריסת העורך
(סדר השדות, רוחבים, תוויות) אינה חלק מהסכמה: מנהלים מגדירים אותה בפאנל, והיא נשמרת במסד
הנתונים.

## רכיבים

רכיב הוא קבוצת שדות לשימוש חוזר, כמו `shared.seo` (כותרת meta ותיאור meta). ה-UID שלו
הוא `<category>.<name>`, שנלקח מהנתיב שלו: `schema/components/shared/seo.json` הוא
`shared.seo`. לקובץ רכיב יש `displayName`, `description` ו-`icon` אופציונליים,
ו-`attributes`.

אזור דינמי הוא רשימה שמשלבת כמה רכיבים, כמו גוף מאמר שמורכב מבלוקים של hero ושל ציטוט.
שניהם נשמרים בתוך המסמך כ-JSON; ראו
[רכיבים ואזורים דינמיים](/he/concepts/components-and-dynamic-zones/).

## מאפיינים

לכל מאפיין יש `type` ואפשרויות שתלויות בו. הרשימה המלאה של הטיפוסים, האפשרויות שלהם וסוגי
העמודות שלהם בכל מסד נתונים נמצאת ב[תיעוד טיפוסי המאפיינים](/he/reference/attribute-types/).

| קטגוריה | טיפוסים |
| --- | --- |
| טקסט | `string`, `text`, `richtext` (Markdown), `blocks` (הטקסט העשיר המובנה של Strapi), `email`, `uid`, `password`, `enumeration` |
| מספרים | `integer`, `biginteger`, `float`, `decimal` |
| תאריכים | `date`, `time`, `datetime` |
| סקלריים אחרים | `boolean`, `json` |
| קישורים | `relation` (ראו [קשרים](/he/concepts/relations/)), `media` (ראו [מדיה](/he/concepts/media/)) |
| מבנה | `component`, `dynamiczone` |

אפשרויות נפוצות:

| אפשרות | השפעה |
| --- | --- |
| `required` | הערך חייב להיות מוגדר כשגרסה מתפרסמת (או בכל כתיבה, בסוגים בלי טיוטה ופרסום). טיוטות יכולות להיות חלקיות. |
| `private` | אף פעם לא מוחזר, מסונן, ממוין או עובר populate דרך API התוכן. מאפייני `password` תמיד פרטיים. |
| `default` | הערך שמשמש כשמסמך חדש משמיט את השדה. נבדק מול הכללים של המאפיין עצמו. |
| `unique` | אין שני מסמכים שחולקים את הערך, לכל שפה וגרסה. זמין בטיפוסי `string`, `email`, מספר, תאריך ושעה; `uid` תמיד ייחודי. |
| `configurable` | `false` נועל את המאפיין בבונה סוגי התוכן: אי אפשר לערוך, לשנות שם או למחוק אותו שם. |
| `pluginOptions.i18n.localized` | `false` משתף את הערך בין השפות. |

כל עמודת מאפיין ניתנת ל-null במסד הנתונים. כמו ב-Strapi v5, את `required` אוכף Verdin
בזמן הפרסום, לא אילוץ `NOT NULL`, כך שהוספת מאפיין חובה לסוג שכבר יש לו שורות היא שינוי
בטוח.

## אימות

כל כתיבה נבדקת מול הסכמה לפני שמשהו מגיע למסד הנתונים:

- **טיפוסים ואילוצים**, בכל כתיבה: טיפוסי ערכים, `minLength`/`maxLength`, `min`/`max`,
  `regex`, ערכי `enum`, מספר הפריטים ברכיבים חוזרים ובאזורים דינמיים, סוגי הרכיבים שאזור
  דינמי מתיר, וסוגי הקבצים ששדה מדיה מקבל. מפתחות לא מוכרים ושדות מערכת בקלט הם שגיאות.
- **שדות חובה וכללים בין שדות**, כשגרסה מתפרסמת, ובכל כתיבה לסוגים בלי טיוטה ופרסום. הם
  חלים גם בתוך רכיבים ואזורים דינמיים.
- **ייחודיות**, באמצעות אינדקסים ייחודיים במסד הנתונים, כך ששתי כתיבות מקבילות לא יכולות
  להצליח שתיהן.

בדיקה שנכשלה עונה `400` עם `ValidationError` שה-`details.errors` שלו מפרט כל בעיה עם
הנתיב שלה, כמו `["seo", "metaTitle"]` או `["blocks", 2, "text"]`. ראו
[שגיאות](/he/api/rest/#שגיאות).

### אימותים בין שדות

סוג תוכן יכול להצהיר על כללים שמשווים בין השדות שלו, שנכתבים ב-
[JSON Logic](https://jsonlogic.com). סוג האירוע הזה דורש שתאריך הסיום יבוא אחרי תאריך
ההתחלה, ומגביל את הכרטיסים שנמכרו למספר המושבים:

```json title="schema/content-types/event.json"
{
  "kind": "collectionType",
  "singularName": "event",
  "pluralName": "events",
  "displayName": "Event",
  "attributes": {
    "startDate": { "type": "date", "required": true },
    "endDate": { "type": "date" },
    "seats": { "type": "integer", "min": 0 },
    "sold": { "type": "integer", "min": 0 }
  },
  "validations": [
    {
      "rule": { "or": [{ "!": { "var": "endDate" } }, { "<=": [{ "var": "startDate" }, { "var": "endDate" }] }] },
      "message": "must be after the start date",
      "field": "endDate"
    },
    { "rule": { "<=": [{ "var": "sold" }, { "var": "seats" }] }, "message": "more tickets sold than seats" }
  ]
}
```

- כלל שאינו מתקיים הוא שגיאת אימות עם `message`, ב-`field` אם צוין, או ברמת המסמך
  (`path: []`).
- הכללים רצים כש-`required` רץ: בפרסום, ובכל כתיבה לסוגים בלי טיוטה ופרסום. טיוטות יכולות
  להפר אותם.
- `var` קורא את השדות של המסמך עצמו, עם נתיבים עם נקודות לתוך רכיבים. קשרים ומדיה אינם
  זמינים לכללים.
- ההשוואות מספריות כששני הצדדים מספרים וטקסטואליות כששניהם מחרוזות, כך שתאריכים, שעות
  ותאריך-שעה בפורמט ISO מושווים נכון. שדה ריק הוא `null`: הגנו על שדות אופציונליים, כמו
  שהכלל הראשון עושה.
- אופרטורים מותרים: `var`, `==`, `!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`, `and`,
  `or`, `in`, `if`, `?:`, `+`, `-`, `*`, `/`, `%`, `min`, `max`, `cat`. אופרטור לא מוכר,
  `field` לא מוכר או `message` ריק הם שגיאת סכמה.

השרת בודק את הכללים; פאנל הניהול מציג את ההודעות שלהם על השדות שהם מציינים כשפרסום נכשל.
ל-Strapi אין מקבילה. השדות המותנים של Strapi (`conditions`) מתקבלים בקובצי סכמה ונשמרים,
אבל עדיין לא מופעלים.
