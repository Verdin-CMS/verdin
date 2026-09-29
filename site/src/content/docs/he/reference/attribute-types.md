---
title: תיעוד טיפוסי המאפיינים
description: כל טיפוס מאפיין של קובץ סכמה ב-Verdin, עם האפשרויות, האימותים, האחסון במסד הנתונים והייצוג ב-API שלו.
sidebar:
  order: 4
  label: טיפוסי מאפיינים
---

<!-- Written from crates/verdin-schema (convert.rs, validate.rs, model.rs),
crates/verdin-migrate/src/derive.rs and sql.rs (storage), and crates/verdin-content
(input.rs, output.rs, blocks.rs) (API). -->

מאפיינים הם השדות של סוג תוכן או של רכיב, שמוצהרים תחת `attributes` בקובץ הסכמה שלו. העמוד
הזה מפרט כל `type`, את האפשרויות שהוא מקבל, איך Verdin מאמת ושומר אותו, ואיך הוא נראה ב-API.
הפורמט הוא של Strapi v5; ההבדלים מפורטים [בסוף](#הבדלים-מ-strapi).

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
    "readingTime": { "type": "integer", "min": 0 },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "seo": { "type": "component", "component": "shared.seo" }
  }
}
```

קובצי הסכמה קפדניים: מפתח לא מוכר, או אפשרות שהטיפוס לא מקבל, הם שגיאה ש-`verdin schema check`
מדווח עם הנתיב שלה (`attributes.title.maxLength`).

## אפשרויות שכל מאפיין מקבל

| אפשרות | ברירת מחדל | תיאור |
| --- | --- | --- |
| `type` | חובה | אחד מהטיפוסים שבהמשך. |
| `required` | `false` | חייב להיות ערך. נבדק כשרשומה מתפרסמת (טיוטות יכולות להיות חלקיות), ובכל כתיבה לסוג בלי טיוטה ופרסום. חל גם בתוך רכיבים ואזורים דינמיים. |
| `private` | `false` | אף פעם לא מוחזר על ידי API התוכן, ואי אפשר להשתמש בו ב-`filters` או ב-`sort`. מאפייני `password` תמיד פרטיים. |
| `configurable` | `true` | הדגל של Strapi עבור הבונה של פאנל הניהול; נשמר כפי שנכתב. |
| `pluginOptions.i18n.localized` | `true` | בסוג תוכן מתורגם, `false` משתף את הערך בין השפות במקום ערך אחד לכל שפה. |
| `customField` | לא מוגדר | `plugin::<plugin>.<field>` (או `global::<field>`): פאנל הניהול עורך את המאפיין עם שדה מותאם של תוסף. ה-`type` הוא האופן שבו הערך נשמר. ראו [תוספים](/he/extending/plugins/). |
| `conditions` | לא מוגדר | השדות המותנים של Strapi (`{ "visible": <JSON Logic> }`). העורך מסתיר את השדה כל עוד הכלל שקרי, והשרת אינו מחייב שדה מוסתר. |
| `default` | לא מוגדר | הערך של רשומות חדשות כשהכתיבה משמיטה את המאפיין. חייב להיות תקין עבור הטיפוס. לא כל טיפוס מקבל אותו (ראו כל טיפוס). |

שמות מאפיינים מתחילים באות, ואחריה אותיות, ספרות ו-`_`, עד 50 תווים. בסוגי תוכן, `id`,
`documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`, `updatedAt`,
`createdBy` ו-`updatedBy` שמורים; ברכיבים, `id`. שני שמות שממופים לאותה עמודה (`metaTitle`
ו-`meta_title`) הם שגיאה.

### היכן הערכים נשמרים

כל מאפיין של סוג תוכן הוא עמודה בטבלה של הסוג (`collectionName`, או השם ברבים), ששמה
ב-`snake_case`. קשרים ומדיה נמצאים במקום זאת בטבלאות קישור. טיוטה והגרסה המפורסמת שלה הן שתי
שורות, אחת לכל שפה בסוגים מתורגמים.

סוגי עמודות לפי מסד נתונים:

| עמודה | PostgreSQL | MySQL ו-MariaDB | SQLite |
| --- | --- | --- | --- |
| varchar | `varchar(255)` | `varchar(255)` | `text` |
| text | `text` | `longtext` | `text` |
| integer | `integer` | `int` | `integer` |
| bigint | `bigint` | `bigint` | `integer` |
| double | `double precision` | `double` | `real` |
| decimal | `numeric(p,s)` | `decimal(p,s)` | `text` (מדויק) |
| boolean | `boolean` | `tinyint(1)` | `integer` |
| date | `date` | `date` | `text` |
| time | `time(3)` | `time(3)` | `text` |
| datetime | `timestamptz(3)` | `datetime(3)` | `text` |
| json | `jsonb` | `json` | `text` |

לסוג תוכן יכולים להיות לכל היותר 60 מאפייני `string`, `email`, `uid` ו-`enumeration` (מגבלת
גודל השורה של MySQL); השתמשו ב-`text` ליותר מזה.

### `unique`

טיפוסים שמקבלים `unique: true` מקבלים אינדקס ייחודי על `(column, locale, publication_state)`:
שתי רשומות מפורסמות, או שתי טיוטות, באותה שפה לא יכולות לחלוק ערך, בעוד טיוטה והגרסה המפורסמת
שלה עצמה יכולות. כתיבה שמפרה זאת נכשלת עם שגיאת אימות על המאפיין. בתוך רכיבים, `unique` מתקבל
אבל לא נאכף (ערכי רכיבים נשמרים כ-JSON).

## טקסט

### `string`

שורה אחת של טקסט.

| אפשרות | תיאור |
| --- | --- |
| `minLength`, `maxLength` | גבולות אורך בתווים. `maxLength` הוא לכל היותר 255. |
| `regex` | תבנית שהערך חייב להתאים לה. תחביר בסגנון JavaScript, כולל look-around ו-backreferences. |
| `unique` | ראו [`unique`](#unique). |
| `default` | מחרוזת בתוך הגבולות שמתאימה ל-`regex`. |

נשמר כ-`varchar(255)`. ב-API: מחרוזת.

### `text`

טקסט פשוט ארוך יותר (textarea בפאנל הניהול).

| אפשרות | תיאור |
| --- | --- |
| `minLength`, `maxLength` | גבולות אורך, בלי גבול עליון. |
| `default` | מחרוזת בתוך הגבולות. |

נשמר כ-`text` (`longtext` ב-MySQL). ב-API: מחרוזת.

### `richtext`

טקסט Markdown. אותן אפשרויות, אחסון ו-API כמו `text`; פאנל הניהול עורך אותו עם עורך
ה-Markdown.

### `blocks`

טקסט עשיר כ-JSON של ה-blocks של Strapi: רשימה של בלוקים `paragraph`, `heading` (`level` 1 עד
6), `list` (`format` ‏`ordered` או `unordered`, עם ילדי `list-item`, בקינון של עד 8 רמות),
`quote`, `code` (`language` אופציונלי) ו-`image`. ילדים בתוך השורה הם צמתי `text`, עם הסימונים
`bold`, `italic`, `underline`, `strikethrough` ו-`code`, וצמתי `link`. לכל היותר 10,000 בלוקים.

בלי אפשרויות, בלי `default`. נשמר כ-JSON. ב-API: רשימת הבלוקים, כפי שנכתבה.

```json
[
  { "type": "heading", "level": 2, "children": [{ "type": "text", "text": "Hello" }] },
  { "type": "paragraph", "children": [{ "type": "text", "text": "bold", "bold": true }] }
]
```

### `email`

כתובת דוא"ל (`name@domain.tld`, בלי רווחים).

| אפשרות | תיאור |
| --- | --- |
| `minLength`, `maxLength` | גבולות אורך; `maxLength` לכל היותר 255. |
| `unique` | ראו [`unique`](#unique). |
| `default` | כתובת דוא"ל. |

נשמר כ-`varchar(255)`. ב-API: מחרוזת.

### `password`

סוד, שמגובב בכתיבה עם Argon2id.

| אפשרות | תיאור |
| --- | --- |
| `minLength`, `maxLength` | גבולות האורך של הסיסמה כפי שנשלחה. |

בלי `default`. תמיד פרטי: אף פעם לא מוחזר, מסונן או ממוין. אסור בתוך רכיבים. נשמר
כ-`varchar(255)` (ה-hash). ייבואים שומרים על hashes קיימים של bcrypt ו-Argon2 כמו שהם, כך
שחשבונות מיובאים עדיין יכולים להתחבר.

### `uid`

מזהה לכתובות URL, כמו slug. פאנל הניהול מייצר אותו מ-`targetField`.

| אפשרות | תיאור |
| --- | --- |
| `targetField` | מאפיין `string` או `text` של אותו סוג שממנו מייצרים את הערך. |
| `minLength`, `maxLength` | גבולות אורך; `maxLength` לכל היותר 255. |
| `regex` | התבנית שהערכים חייבים להתאים לה; בלעדיה, `^[A-Za-z0-9\-_.~]*$`. |
| `default` | ערך תקין. |

תמיד ייחודי (ראו [`unique`](#unique)). נשמר כ-`varchar(255)`. ב-API: מחרוזת.

### `enumeration`

ערך אחד מתוך רשימה קבועה.

| אפשרות | תיאור |
| --- | --- |
| `enum` | הערכים: לפחות אחד, כל אחד באורך 1 עד 255 תווים, בלי כפילויות. |
| `default` | אחד מהערכים. |

נשמר כ-`varchar(255)`. ב-API: מחרוזת. כתיבות של כל ערך אחר נכשלות.

## מספרים

### `integer`

מספר שלם של 32 ביט (‎−2,147,483,648 עד 2,147,483,647).

| אפשרות | תיאור |
| --- | --- |
| `min`, `max` | גבולות (מספרים שלמים). |
| `unique` | ראו [`unique`](#unique). |
| `default` | מספר שלם בתוך הגבולות. |

נשמר כ-`integer`. ב-API: מספר. כתיבות מקבלות מספרים ומחרוזות של מספרים שלמים.

### `biginteger`

מספר שלם של 64 ביט. אותן אפשרויות כמו `integer`.

נשמר כ-`bigint`. ב-API: מחרוזת (`"9007199254740993"`), כמו ב-Strapi, כי מספרים של JavaScript
מאבדים דיוק מעבר ל-2⁵³. כתיבות מקבלות מחרוזות ומספרים.

### `float`

מספר נקודה צפה בדיוק כפול. אותן אפשרויות כמו `integer`, עם גבולות מספריים.

נשמר כ-`double precision` (`double`, `real`). ב-API: מספר.

### `decimal`

מספר עשרוני מדויק.

| אפשרות | ברירת מחדל | תיאור |
| --- | --- | --- |
| `precision` | `10` | סך הספרות, 1 עד 38. |
| `scale` | `2` | ספרות אחרי הנקודה העשרונית, לכל היותר `precision`. |
| `min`, `max` | | גבולות. |
| `unique` | | ראו [`unique`](#unique). |
| `default` | | מספר בתוך הגבולות. |

הערכים מעוגלים ל-`scale` ספרות (חצי הרחק מאפס, כמו שמסדי הנתונים עושים), ונדחים כשיש להם יותר
מ-`precision - scale` ספרות לפני הנקודה. כתיבות מקבלות מספרים ומחרוזות מספריות. נשמר
כ-`numeric(precision,scale)` (`text` ב-SQLite, כך ששום דבר לא מעוגל). ב-API: מספר, או מחרוזת
מדויקת עם [`[api].decimal_as_string`](/he/reference/configuration/).

## תאריכים ובוליאניים

### `boolean`

`true` או `false`. מקבל `default`. נשמר כ-`boolean` (`tinyint(1)`, `integer`). ב-API: בוליאני.

### `date`

תאריך בלוח השנה, `YYYY-MM-DD`. מקבל `unique` ו-`default`. נשמר כ-`date`. ב-API: `"2026-09-29"`.

### `time`

שעה ביום, `HH:MM`, `HH:MM:SS` או `HH:MM:SS.mmm`. מקבל `unique` ו-`default`. נשמר בדיוק של
מילישניות. ב-API: `"14:30:00.000"`.

### `datetime`

נקודה בזמן: חותמת זמן ISO 8601 עם אזור (`Z` או `+02:00`). מקבל `unique` ו-`default`. נשמר
ב-UTC בדיוק של מילישניות. ב-API: `"2026-09-29T12:30:00.000Z"`.

## `json`

כל ערך JSON. מקבל `default` (כל JSON). נשמר כ-`jsonb` (`json`, `text`). ב-API: הערך כפי שנכתב.
ב-`filters`, מאפייני JSON תומכים רק ב-`$null` וב-`$notNull`, ואי אפשר למיין לפיהם.

## מדיה

### `media`

קבצים מספריית המדיה.

| אפשרות | ברירת מחדל | תיאור |
| --- | --- | --- |
| `multiple` | `false` | מחזיק רשימה של קבצים במקום אחד. |
| `allowedTypes` | כל סוג | סוגי קבצים: `images`, `videos`, `audios`, `files` (כל השאר). |

בלי `default`. נשמר בטבלת קישור `{table}_{attribute}_mda`, לפי הסדר. כתיבות מקבלות מזהי
קבצים: `12`, `{ "id": 12 }`, רשימה שלהם, או `null`. ב-API: רק עם `populate`; אובייקט קובץ
(`url`, `mime`, `width`, `formats`…, כמו ב-Strapi), רשימה שלהם, או `null`. ראו
[מדיה](/he/concepts/media/).

## קשרים

### `relation`

קישורים למסמכים של סוג תוכן אחר.

| אפשרות | תיאור |
| --- | --- |
| `relation` | `oneToOne`, `oneToMany`, `manyToOne`, `manyToMany`, `oneWay`, `manyWay`, או סוג פולימורפי (בהמשך). |
| `target` | סוג התוכן של היעד: `article`, `api::article` או `api::article.article`. |
| `inversedBy` | בצד הבעלים של קשר דו-כיווני: המאפיין של היעד שמשקף אותו. |
| `mappedBy` | בצד השני: מאפיין הבעלים של היעד. |

שני הצדדים של קשר דו-כיווני חייבים להתאים: `oneToMany` משקף את `manyToOne`, `oneToOne`
ו-`manyToMany` משקפים את עצמם, והצד עם `mappedBy` מציין מאפיין שה-`inversedBy` שלו מצביע בחזרה.
ל-`oneWay` ול-`manyWay` אין צד שני.

הקישורים נשמרים ב-`{table}_{attribute}_lnk` בצד הבעלים (הצד בלי `mappedBy`), ומצביעים
ל-`documentId` של היעד, לפי הסדר. כתיבות מקבלות ערכי `documentId`:

| כתיבה | משמעות |
| --- | --- |
| `"d8f3…"`, `{ "documentId": "d8f3…" }`, רשימה שלהם | החלפת הקישורים. |
| `null` או `[]` | הסרת כל הקישורים. |
| `{ "set": [...] }` | החלפת הקישורים. |
| `{ "connect": [...], "disconnect": [...] }` | הוספה והסרה של קישורים. פריט `connect` יכול לשאת `position`: `{ "before": id }`, `{ "after": id }`, `{ "start": true }` או `{ "end": true }`. |

ב-API: רק עם `populate`, כמסמכים הקשורים (לכל היותר 1,000 לכל רשומה וקשר), או
`{ "count": n }` עם `populate[tags][count]=true`. ראו [קשרים](/he/concepts/relations/).

בתוך רכיבים, מותרים רק `oneWay` ו-`manyWay`; הרכיב שומר את ערכי ה-`documentId`.

### קשרים פולימורפיים

`relation` מקבל גם את הסוגים הפולימורפיים, שמקשרים מסמכים מכל סוג תוכן:

| `relation` | אפשרויות | תיאור |
| --- | --- | --- |
| `morphToOne` | אין | מקשר מסמך אחד מכל סוג. |
| `morphToMany` | אין | מקשר מסמכים מכל הסוגים. |
| `morphOne` | `target`, `morphBy` | צד הפוך: קורא את הקישורים של מאפיין ה-`morphToOne` או ה-`morphToMany` ‏`morphBy` של `target`. |
| `morphMany` | `target`, `morphBy` | אותו דבר, לרבים. |

הבעלים שומרים זוגות `(type, documentId)` ב-`{table}_{attribute}_mph`. כתיבות מקבלות פריטים
`{ "__type": "api::article", "documentId": "…" }` (אחד, רשימה, `null` או `{ "set": [...] }`).
פריטים שעברו populate נושאים את הסוג שלהם ב-`__type`. אסור בתוך רכיבים.

## רכיבים ואזורים דינמיים

### `component`

קבוצת שדות שמוגדרת ב-`schema/components/<category>/<name>.json`.

| אפשרות | ברירת מחדל | תיאור |
| --- | --- | --- |
| `component` | חובה | ה-uid של הרכיב, `category.name` (`shared.seo`). |
| `repeatable` | `false` | מחזיק רשימה של פריטים במקום אחד. |
| `min`, `max` | | מספר הפריטים; רק עם `repeatable`. |

בלי `default`: פריטים חדשים מקבלים את ברירות המחדל של המאפיינים שלהם. נשמר כ-JSON בשורה של
הרשומה, כל פריט עם `id`. כתיבות מקבלות את אובייקט הפריט (או רשימה), עם `id` כדי לשמור פריט
קיים. ב-API: רק עם `populate`, הפריט או הרשימה במלואם. ב-`filters` אפשר לסנן לפי השדות של רכיב
(`filters[seo][metaTitle][$eq]=…`). ראו
[רכיבים ואזורים דינמיים](/he/concepts/components-and-dynamic-zones/).

### `dynamiczone`

רשימה של פריטים, שכל אחד מהם הוא אחד מכמה רכיבים.

| אפשרות | תיאור |
| --- | --- |
| `components` | ה-uids של הרכיבים המותרים: לפחות אחד, בלי כפילויות. |
| `min`, `max` | מספר הפריטים. |

כל פריט נושא `__component` עם ה-uid שלו. נשמר כ-JSON בשורה של הרשומה. ב-API: רק עם `populate`,
הרשימה כולה. סננו לפי רכיב עם `filters[blocks][__component][$eq]=blocks.hero`. אי אפשר לקנן
אזורים דינמיים בתוך רכיבים.

## אימותים בין שדות

מעבר לאפשרויות לכל מאפיין, סוג תוכן יכול להצהיר ב-`validations` על כללים על כמה שדות, שנבדקים
בכל פעם ש-`required` נבדק:

```json
"validations": [
  {
    "rule": { "<=": [{ "var": "startDate" }, { "var": "endDate" }] },
    "message": "The end date must be after the start date",
    "field": "endDate"
  }
]
```

`rule` הוא ביטוי JSON Logic על הרשומה שחייב להתקיים. הוא יכול להשתמש ב-`var`, `==`, `!=`,
`===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`, `and`, `or`, `in`, `if`, `?:`, `+`, `-`, `*`, `/`,
`%`, `min`, `max` ו-`cat`. `message` מדווח ב-`field` (מאפיין של הסוג) או על הרשומה. זו תוספת
של Verdin; ל-Strapi אין מקבילה.

## הבדלים מ-Strapi

- **רכיבים נשמרים כ-JSON** בשורה של הרשומה, לא בטבלאות רכיבים עם טבלאות join. קריאות לא
  צריכות joins; כתוצאה מכך, מאפייני `password`, קשרים פולימורפיים וקשרים דו-כיווניים לא יכולים
  להיות בתוך רכיבים, ו-`unique` לא נאכף שם.
- **רכיבים שעוברים populate חוזרים בשלמותם.** `populate` על רכיב או אזור דינמי מחזיר את כל
  השדות שלו; אי אפשר לבחור שדות מקוננים כמו ב-Strapi.
- **קובצי סכמה קפדניים.** מפתחות לא מוכרים ואפשרויות שהטיפוס לא מקבל הם שגיאות, במקום
  ש-Strapi מתעלם מהם. ב-`pluginOptions`, רק `i18n.localized` נקרא; השאר מתעלמים ממנו.
- **`string`, `email` ו-`uid` מוגבלים ל-255 תווים**, גודל העמודה, במקום להיכשל במסד הנתונים.
- **`conditions`** (שדות מותנים) פועלים כמו ב-Strapi 5.17: שדות מוסתרים אינם חובה.
- **`validations`** הם של Verdin עצמו.
- השאר תואם ל-Strapi v5: שמות הטיפוסים, האפשרויות שלהם, ערכי `biginteger` כמחרוזות, כתיבות
  של קשרים עם `connect`, `disconnect`, `set` ו-`position`, ופורמט ה-blocks.
