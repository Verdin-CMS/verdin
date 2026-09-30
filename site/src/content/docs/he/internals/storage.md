---
title: אחסון
description: איך Verdin פורס את התוכן במסד הנתונים, משמות טבלאות ועמודות מערכת ועד שורות טיוטה ופרסום, קישורי קשרים, JSON של רכיבים וטבלאות הפלטפורמה.
sidebar:
  order: 2
---

העמוד הזה מתאר את הטבלאות ש-Verdin גוזר מהסכמה שלכם ואיך כל סוג של מאפיין נשמר. קראו אותו לפני שאתם משנים משהו ב-`crates/verdin-migrate/src/derive.rs` או ב-Document Service, או כשאתם צריכים לשאול את מסד הנתונים ישירות. למה שכל טיפוס מאפיין מקבל, ראו [טיפוסי מאפיינים](/he/reference/attribute-types/).

אף פעם לא כותבים לטבלאות האלה ידנית: [מנוע ההגירות](/he/internals/migrations/) יוצר ומפתח אותן מהסכמה.

## מוסכמות שמות

| אובייקט | שם |
|---|---|
| טבלת סוג תוכן | `collectionName`, שברירת המחדל שלו היא `pluralName` עם מקפים שהופכים לקווים תחתונים (`blog-posts` → `blog_posts`) |
| עמודה | שם המאפיין ב-snake case (`metaTitle` → `meta_title`) |
| קישורי קשרים | `{table}_{column}_lnk` |
| קישורי קשרים פולימורפיים | `{table}_{column}_mph` |
| קישורי מדיה | `{table}_{column}_mda` |
| אינדקס | `{table}_{part}_uq` לאינדקסים ייחודיים, `{table}_{part}_idx` לאחרים |
| טבלת פלטפורמה | הקידומת `vd_` (`vd_admin_users`, `vd_schema_snapshots`…) |

כללים שמאמת הסכמה אוכף (`crates/verdin-schema/src/naming.rs` ו-`validate.rs`):

- `collectionName` תואם ל-`^[a-z][a-z0-9_]*$`, באורך של עד 50 תווים, ולא יכול להתחיל ב-`vd_`.
- `singularName` ו-`pluralName` הם ב-kebab case (`^[a-z][a-z0-9-]*$`, בלי מקפים בהתחלה, בסוף או כפולים). `upload`, `uploads`, `auth`, `users` ו-`connect` שמורים כי API התוכן משתמש בנתיבים האלה.
- שמות מאפיינים מתחילים באות וממשיכים באותיות, ספרות או קווים תחתונים (הכלל של Strapi), ובאורך של עד 50 תווים.
- בסוגי תוכן, `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`, `updatedAt`, `createdBy` ו-`updatedBy` שמורים, וכך גם כל שם שה-snake case שלו מתנגש בהם. ברכיבים, `id` שמור.
- מזהים שנוצרים מוגבלים ל-60 תווים (PostgreSQL מתיר 63, MySQL ‏64). שם ארוך יותר נחתך ומקבל hash של 8 תווים של השם המלא, כך ששמות ארוכים שונים נשארים שונים והתוצאה דטרמיניסטית.

כל מזהה מוקף במירכאות ב-SQL שנוצר, כך שמילים שמורות של SQL הן שמות מאפיינים תקינים.

## עמודות מערכת

כל טבלת סוג תוכן מתחילה בעמודות האלה:

```sql
id                 BIGINT       primary key, auto-increment
document_id        CHAR(26)     NOT NULL           -- ULID, shared by every version of a document
locale             VARCHAR(16)  NOT NULL DEFAULT '' -- '' for types that are not localized
publication_state  SMALLINT     NOT NULL           -- 0 = draft, 1 = published
published_at       <datetime>   NULL
created_at         <datetime>   NOT NULL
updated_at         <datetime>   NOT NULL
created_by_id      BIGINT       NULL               -- vd_admin_users.id
updated_by_id      BIGINT       NULL
UNIQUE (document_id, locale, publication_state)
INDEX  (publication_state, locale)
```

- `document_id` הוא ULID באותיות קטנות שנוצר ביצירה. הוא נשאר זהה בין הטיוטה, הגרסה המפורסמת וכל השפות.
- סוגים שאינם מתורגמים משתמשים ב-`locale = ''` ולא ב-`NULL`, כי ערכי NULL אף פעם לא מתנגשים באינדקסים ייחודיים באף מנוע, מה שהיה שובר את האילוץ `(document_id, locale, publication_state)`.
- עמודת המצב היא `publication_state`, לא `state`, כי `state` הוא שם מאפיין נפוץ.

אחריהן באות עמודות המאפיינים, אחת לכל מאפיין סקלרי. **כל עמודת מאפיין ניתנת ל-null.** כמו ב-Strapi v5, טיוטות יכולות להיות חלקיות, ולכן `required` נבדק כשגרסה מתפרסמת (או בכל כתיבה לסוגים בלי טיוטה ופרסום), לא על ידי מסד הנתונים. זה גם הופך הוספת מאפיין חובה להגירה בטוחה.

מאפייני `unique`, וכל `uid`, מקבלים אינדקס ייחודי על `(column, locale, publication_state)`. טיוטה והגרסה המפורסמת שלה יכולות לחלוק ערך, שני מסמכים מפורסמים לא, ומסד הנתונים אוכף זאת בלי race conditions. הפרה מדווחת כ-`ValidationError` על השדה הזה.

## טיוטה ופרסום

Verdin עוקב אחרי המודל של Strapi v5. ראו [טיוטה ופרסום](/he/concepts/draft-and-publish/) לנקודת המבט של המשתמש; זה מה שקורה בטבלה.

- למסמך יש לכל היותר שורת טיוטה אחת (`publication_state = 0`) ושורה מפורסמת אחת (`publication_state = 1`) לכל שפה.
- כתיבות מפאנל הניהול מכוונות לשורת הטיוטה.
- **פרסום** בודק את מאפייני ה-`required` ואת כללי האימות על הטיוטה, ואז מעתיק את ערכי המאפיינים של הטיוטה לשורה המפורסמת (מעדכן אותה, או מכניס אותה בפעם הראשונה), בטרנזקציה אחת. קישורי הקשרים והמדיה של הטיוטה מועתקים יחד איתה.
- **ביטול פרסום** מוחק את השורה המפורסמת. הקישורים שלה נמחקים איתה דרך `ON DELETE CASCADE`.
- **מחיקת טיוטה** דורסת את הטיוטה בערכים ובקישורים של השורה המפורסמת.
- לסוגי תוכן בלי טיוטה ופרסום יש רק שורה מפורסמת.
- בסוגים מתורגמים, מאפיינים שאינם מתורגמים משותפים: פרסום של שפה אחת מעתיק אותם לשורות המפורסמות של השפות האחרות.

## קשרים: מקושרים לפי מזהה מסמך

**זה ההבדל העיקרי מהאחסון של Strapi.** Strapi מקשר שורות לפי מזהה שורה וצריך לכתוב מחדש קישורים כשמפרסמים. Verdin שומר קשר כ*שורת מקור ← מסמך יעד*:

```sql
-- articles_category_lnk
id                  BIGINT   primary key, auto-increment
source_id           BIGINT   NOT NULL REFERENCES articles(id) ON DELETE CASCADE
target_document_id  CHAR(26) NOT NULL
position            DOUBLE   NOT NULL   -- 1..n, rewritten on every write
UNIQUE (source_id, target_document_id)
UNIQUE (source_id)                      -- to-one kinds only
INDEX  (target_document_id)
```

- שורת היעד נבחרת בזמן הקריאה, בגרסה שנקראת: מאמר מפורסם רואה קטגוריות מפורסמות, טיוטה רואה טיוטות. אם פרסום של קטגוריה מבוטל, היא נעלמת ממאמרים מפורסמים בלי שאף קישור ייגע.
- פרסום מעתיק רק את הקישורים של שורת המקור עצמה.
- רק לצד ה**בעלים** (המאפיין עם `inversedBy`, או קשר חד-כיווני) יש טבלת קישור. הצד ההפוך (`mappedBy`) קורא את אותה טבלה בכיוון ההפוך, והוא לקריאה בלבד: כתיבה אליו היא שגיאת אימות שמציינת את מאפיין הבעלים.
- "לכל היותר יעד אחד" (`oneToOne`, `manyToOne`, `oneWay`) הוא האינדקס הייחודי על `source_id`. "יעד שייך למסמך מקור אחד" (`oneToOne`, `oneToMany`) לא יכול להיות אינדקס, כי טיוטה והגרסה המפורסמת שלה חולקות יעדים באופן לגיטימי. ה-Document Service אוכף זאת על ידי *העברת* היעד: קישור שלו מסיר את הקישורים שמסמכים אחרים מחזיקים אליו באותו מצב, וזו ההתנהגות של Strapi.
- אין מפתח זר על `target_document_id`, כי `document_id` אינו ייחודי בטבלת היעד. ה-Document Service דוחה קישורים למסמכים שאינם קיימים, וכשהגרסה האחרונה של מסמך נמחקת, הוא מסיר באותה טרנזקציה את הקישורים שמצביעים עליו.
- שורות קישור שומרות על מפתח ראשי `id`, כך שטבלאות הקישור נראות כמו כל טבלה אחרת למנוע ההגירות ולבנייה מחדש של טבלאות ב-SQLite.
- שינוי שם של טבלה משנה איתה את שמות טבלאות הקישור שלה. ההגירות רצות עם `foreign_keys` של SQLite כבוי, כך שבנייה מחדש של טבלה לא מתגלגלת לטבלאות הקישור שלה.

**קשרים פולימורפיים** (`morphToOne`, `morphToMany`) מקשרים מסמכים מכל סוג תוכן. הקישורים שלהם נמצאים ב-`{table}_{column}_mph` עם `source_id`, `target_type` (ה-uid של היעד), `target_document_id` ו-`position`, `(source_id, target_type, target_document_id)` ייחודי, ועבור `morphToOne` גם `source_id` ייחודי. לצדדים ההפוכים (`morphOne`, `morphMany`) אין טבלה: הם קוראים את הקישורים של הבעלים שמצביעים עליהם, והם לקריאה בלבד. מחיקת מסמך מסירה את הקישורים הפולימורפיים אליו. ראו [קשרים](/he/concepts/relations/) למה שאפשר ואי אפשר לעשות איתם.

## רכיבים ואזורים דינמיים: עמודת JSON

מאפיין רכיב או אזור דינמי הוא **עמודת JSON אחת** בשורת המסמך (`jsonb` ב-PostgreSQL, `json` ב-MySQL וב-MariaDB, `text` ב-SQLite). Strapi שומר כל רכיב בטבלה משלו עם טבלאות join פולימורפיות; עמודה נמנעת מה-joins האלה והופכת את הפרסום וההיסטוריה להעתקה פשוטה.

```json
// "seo" column (a single component)
{ "id": 1, "metaTitle": "…", "metaDescription": "…" }

// "blocks" column (a dynamic zone)
[
  { "id": 1, "__component": "blocks.hero", "title": "…" },
  { "id": 2, "__component": "blocks.quote", "text": "…", "author": "…" }
]
```

- לכל פריט רכיב יש `id` מספרי, ייחודי בתוך המאפיין שלו. פריטים חדשים מקבלים את המספר הפנוי הבא.
- הנתונים מאומתים מול סכמת הרכיב בכל כתיבה.
- פרסום ומחיקת טיוטה מעתיקים את ה-JSON כמו שהוא.
- **קשרים ומדיה בתוך רכיבים** נשמרים ב-JSON עצמו: ערכי `documentId` לקשרים (רק `oneWay` ו-`manyWay` מותרים שם) ומזהי קבצים למדיה. הם נבדקים בכתיבה ונפתרים עם שאילתות מקובצות כשהרכיב עובר populate. קשרים פולימורפיים ומאפייני `password` לא יכולים להיות בתוך רכיבים.
- **סינון** דורש פונקציות JSON ספציפיות לדיאלקט. שדות סקלריים של רכיבים בודדים נקראים דרך נתיב JSON (`#>>` ב-PostgreSQL, `JSON_VALUE` ב-MySQL וב-MariaDB, `json_extract` ב-SQLite). רכיבים חוזרים משתמשים ב-`EXISTS` על פריטי המערך (`jsonb_array_elements`, `JSON_TABLE`, `json_each`). אפשר לסנן אזורים דינמיים רק לפי `__component`, כי לפריטים שלהם יש שדות שונים.

ראו [רכיבים ואזורים דינמיים](/he/concepts/components-and-dynamic-zones/) לצד המידול.

## טבלאות הפלטפורמה

טבלאות הפלטפורמה הן חלק מכל מודל שנגזר, כך שמנוע ההגירות יוצר ומפתח אותן בדיוק כמו טבלאות תוכן; הן מופיעות כשלבים בטוחים ב-`verdin migrate plan`. הן מוגדרות ב-`crates/verdin-migrate/src/system.rs`.

| תחום | טבלאות |
|---|---|
| הגירות | `vd_schema_snapshots`, `vd_migrations_journal` (בבעלות מנוע ההגירות, נוצרות בשימוש הראשון) |
| מנהלים | `vd_admin_users`, `vd_admin_roles`, `vd_admin_user_roles`, `vd_admin_permissions`, `vd_sessions` (אסימוני רענון), `vd_admin_tokens` (קישורי הזמנה ואיפוס), `vd_admin_two_factor`, `vd_admin_passkeys`, `vd_spent_challenges` |
| גישה ל-API התוכן | `vd_api_tokens`, `vd_api_token_permissions`, `vd_public_permissions` |
| משתמשי קצה | `vd_users`, `vd_user_roles`, `vd_user_role_permissions`, `vd_end_user_sessions` |
| מופע | `vd_settings` (מתגי תכונות, פריסות של תצוגות עריכה, סמני שדרוג חד-פעמיים), `vd_locales`, `vd_cluster_events` (אפיק האירועים המשותף, ראו [הרצת כמה מופעים](/he/deploy/scaling/)) |
| מדיה | `vd_files`, `vd_folders` |
| תהליכי עבודה של תוכן | `vd_history_versions`, `vd_releases`, `vd_release_actions`, `vd_workflows`, `vd_workflow_stages`, `vd_document_stages` |
| שיתוף פעולה | `vd_comments`, `vd_tasks`, `vd_document_views`, `vd_document_votes`, `vd_polls`, `vd_poll_votes` |
| אינטגרציות | `vd_webhooks`, `vd_webhook_deliveries`, `vd_deploy_targets`, `vd_deployments`, `vd_plugin_kv`, `vd_audit_logs` |
| תכונות אתר | `vd_redirects`, `vd_menus`, `vd_forms`, `vd_form_submissions` |

## טבלאות מדיה

קבצים הם שורות של `vd_files` במבנה של Strapi (`name`, `alternative_text`, `caption`, `width`, `height`, `formats`, `hash`, `ext`, `mime`, `size`, `url`, `provider`…), ועוד `focal_point`, `folder_id` ו-`folder_path`. תיקיות (`vd_folders`) שומרות על ה-`path` של Strapi שמורכב מערכי `path_id`, כמו `/1/4`.

מאפיין מדיה הוא טבלת קישור `{table}_{column}_mda` עם `source_id` (שורת התוכן), `file_id` (שורה של `vd_files`) ו-`position`. יש לה `(source_id, file_id)` ייחודי, וכשהמאפיין אינו `multiple`, גם `source_id` ייחודי. שתי העמודות הן מפתחות זרים עם `ON DELETE CASCADE`, כך שמחיקת קובץ או שורה מסירה את הקישורים שלהם. קישורי מדיה עוקבים אחרי אותם כללי טיוטה ופרסום כמו קישורי קשרים: כל גרסה מחזיקה בקישורים שלה והפרסום מעתיק אותם.

איך העלאות, פורמטים וספקי אחסון עובדים מוסבר ב[מדיה](/he/concepts/media/).
