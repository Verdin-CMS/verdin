---
title: תאימות ל-Strapi
description: אילו תכונות ו-APIs של Strapi v5 נתמכים ב-Verdin, נתמכים חלקית או אינם נתמכים — REST, GraphQL, משתמשים והרשאות, העלאות, i18n, טיוטה ופרסום, הרחבות קוד, פאנל הניהול ותכונות Enterprise.
sidebar:
  order: 3
---

Verdin שומר על מודל התוכן ועל APIs התוכן של Strapi v5 כדי שפרונטאנדים ותוכן יוכלו לעבור
(ראו [מעבר מ-Strapi](/he/migrate/from-strapi/)). הוא אינו תחליף ישיר ל*בסיס קוד* של Strapi:
אין runtime של JavaScript, ולכן קוד מותאם נבנה מחדש כתוספי WebAssembly. העמוד הזה מפרט כל
תחום עם הסטטוס שלו, נכון ל-Verdin 0.10.0.

**נתמך** עובד כמו ב-Strapi v5 (ההבדלים מצוינים). **חלקי** מכסה את המקרים הנפוצים; ההערה
אומרת מה חסר. **לא נתמך** אין לו מקבילה.

## מודל התוכן

| תכונה | סטטוס | הערות |
| --- | --- | --- |
| סוגי אוסף וסוגים יחידים | נתמך | קובצי סכמה ב-JSON קרובים לאלה של Strapi (`schema/content-types/*.json`). ראו [מודל התוכן](/he/concepts/content-model/). |
| טיפוסי מאפיינים סקלריים | נתמך | `string`, `text`, `richtext` (Markdown), `blocks`, `email`, `uid`, `integer`, `biginteger`, `float`, `decimal`, `boolean`, `date`, `time`, `datetime`, `enumeration`, `json`, `password`. ה-`timestamp` של Strapi מיובא כ-`datetime`. |
| רכיבים ואזורים דינמיים | נתמך | כולל מדיה וקשרי `oneWay`/`manyWay` בתוך רכיבים. |
| קשרים | נתמך | One/many-to-one/many, one-way ו-many-way, והקשרים הפולימורפיים `morphToOne`, `morphToMany`, `morphOne`, `morphMany`. |
| שדות מדיה | נתמך | יחיד או מרובה, `allowedTypes`. |
| `unique` | חלקי | לא על מאפייני `text`, `richtext`, `blocks` ו-`json`. |
| שדות מותנים (`conditions`) | נתמך | תנאי ה-JSON Logic של Strapi 5.17; שדות מוסתרים אינם חובה. |
| שדות מותאמים | חלקי | מאפייני `customField` עובדים; הקלט בפאנל הניהול מגיע מ[תוסף](/he/extending/plugins/) של Verdin, לא מתוספי ה-React של Strapi. |
| בונה סוגי התוכן | נתמך | רק במצב פיתוח (`verdin dev`), כמו ב-Strapi. |

## REST API

| תכונה | סטטוס | הערות |
| --- | --- | --- |
| נתיבי CRUD | נתמך | `GET`/`POST /api/{pluralName}`, `GET`/`PUT`/`DELETE /api/{pluralName}/{documentId}`, סוגים יחידים ב-`/api/{singularName}`. התגובות נושאות `data` ו-`meta`, והשגיאות את אובייקט ה-`error` של Strapi. |
| `filters` | נתמך | כל אופרטור של Strapi: `$eq`, `$eqi`, `$ne`, `$nei`, `$lt`, `$lte`, `$gt`, `$gte`, `$in`, `$notIn`, `$contains`, `$notContains`, `$containsi`, `$notContainsi`, `$null`, `$notNull`, `$between`, `$startsWith(i)`, `$endsWith(i)`, `$and`, `$or`, `$not`; דרך קשרים, רכיבים, רכיבים חוזרים ואזורים דינמיים (`__component`). |
| `sort` | נתמך | כמה שדות, `:asc`/`:desc`, ושדה של קשר to-one (`author.name:asc`). |
| `pagination` | נתמך | `page`/`pageSize` או `start`/`limit`, `withCount`. `pageSize` מוגבל ל-`[api].max_page_size` (100). |
| `fields` | נתמך | |
| `populate` | נתמך | `*`, רשימות, אובייקטים מקוננים, `on` לאזורים דינמיים, `count`. עומק עד 5; לכל היותר 1,000 רשומות שעוברות populate לכל קשר. |
| `status` | נתמך | `published` (ברירת מחדל) או `draft`; קריאת טיוטות דורשת את ההרשאה `readDrafts`. |
| `locale` | נתמך | ראו i18n בהמשך. |
| `hasPublishedVersion` | נתמך | |
| חיפוש טקסט מלא `_q` | נתמך | `$containsi` על שדות טקסט, כמו Strapi; חיפוש מדורג עם `[search]`. |
| כתיבות של קשרים | נתמך | מזהים, `connect` / `disconnect` / `set`, עם `position` (`before`, `after`, `start`, `end`). |
| פרסום, ביטול פרסום, מחיקת טיוטה | נתמך | כתיבות מפרסמות אלא אם `?status=draft`, כמו ב-Strapi v5. Verdin מוסיף `POST /api/{pluralName}/{documentId}/actions/{publish,unpublish,discard-draft}`. |
| פורמט התגובה של Strapi v4 ו-`publicationState` | לא נתמך | Verdin מדבר רק v5: מאפיינים שטוחים, `documentId`, `status`. |
| מסמך OpenAPI | חלקי | ב-`/api/_openapi.json` (לאסימונים בלבד כברירת מחדל) ותיעוד אינטראקטיבי ב-`/api/docs`, במקום ה-`/documentation` של תוסף התיעוד. |

## GraphQL

| תכונה | סטטוס | הערות |
| --- | --- | --- |
| שאילתות | נתמך | `articles`, `articles_connection` עם `pageInfo`, `article(documentId)`, סוגים יחידים; `filters`, `sort`, `pagination`, `status`, `locale`. כבוי עד שתפעילו את **הגדרות ← תכונות ← GraphQL**. |
| מוטציות | נתמך | `create…`, `update…`, `delete…` עם `status` ו-`locale`. |
| רכיבים, אזורים דינמיים, מדיה | נתמך | אזורים דינמיים כ-unions, מדיה כ-`UploadFile`. |
| קשרים פולימורפיים | חלקי | מוחזרים כ-JSON, לא כ-unions עם טיפוסים. |
| Shadow CRUD (השבתת פעולות לכל סוג) | נתמך | ההגדרה `disabled` של התכונה. |
| resolvers מותאמים והרחבות סכמה | חלקי | שדות שורש שנפתרים על ידי תוספים (`[[graphql]]` ב-`plugin.toml`); אין `extensionService`. |
| מוטציות של Users & Permissions (`login`, `register`, `me`…) | לא נתמך | השתמשו בנתיבי ה-REST. |
| שאילתות/מוטציות של העלאות ו-i18n (`uploadFiles`, `i18NLocales`…) | לא נתמך | השתמשו בנתיבי ה-REST (`GET /api/i18n/locales`) ובפאנל הניהול. `localizations` בסוגים מתורגמים נתמך. |
| מגבלות, GraphiQL | נתמך | `maxDepth`, `maxComplexity`, מתגי אינטרוספקציה וסביבת ניסוי. |

## Users & Permissions (משתמשי קצה)

הפעילו את **הגדרות ← תכונות ← משתמשים והרשאות**. ראו [משתמשי קצה](/he/guides/auth/end-users/).

| תכונה | סטטוס | הערות |
| --- | --- | --- |
| `POST /api/auth/local`, `/auth/local/register` | נתמך | אותו מבנה בקשה ותגובה. |
| אימות דוא"ל, שכחתי/איפוס/שינוי סיסמה | נתמך | `/auth/email-confirmation`, `/auth/send-email-confirmation`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/change-password`. |
| אסימוני רענון | נתמך | `jwtManagement: "refresh"`, `/auth/refresh`, `/auth/logout`. |
| `/api/users`, `/users/me`, `/users/count` | נתמך | JSON פשוט, הרשאות על `plugin::users-permissions.user`. |
| ספקי OAuth | חלקי | GitHub, Google, Microsoft, Discord, Facebook, GitLab, LinkedIn וכל ספק OAuth 2; לא כל הגדרה מוכנה של Strapi. |
| נתיבי תפקידים והרשאות (`/api/users-permissions/roles`, `/permissions`) | לא נתמך | נהלו תפקידים ב-**הגדרות ← משתמשי קצה**. |
| משתמשים מיובאים | נתמך | hashes של bcrypt ממשיכים לעבוד; הם מגובבים מחדש עם Argon2id בהתחברות. |

## ספריית המדיה ו-API ההעלאות

| תכונה | סטטוס | הערות |
| --- | --- | --- |
| `POST /api/upload` | נתמך | `files` ו-`fileInfo` ב-multipart; `?id=` מעדכן את המידע של קובץ, או מחליף את הקובץ כשנשלח קובץ. |
| קישור בזמן ההעלאה (`ref`, `refId`, `field`) | לא נתמך | העלו, ואז הגדירו את שדה המדיה עם מזהה הקובץ. |
| `GET /api/upload/files`, `/files/{id}`, `DELETE /files/{id}` | חלקי | הרשימה מקבלת רק `pagination[page]`, `pagination[pageSize]`, `sort` ו-`filters[name][$containsi]`. |
| פורמטים רספונסיביים, breakpoints | נתמך | `thumbnail` ועוד `[upload].breakpoints`. |
| תיקיות, נקודות מוקד, טקסט חלופי, כיתובים | נתמך | |
| ספקי העלאות | חלקי | דיסק מקומי ואחסון תואם S3 (AWS, R2, B2, MinIO, Tigris…). אין Cloudinary או חבילות ספקים אחרות. |
| המרות תמונות | רק ב-Verdin | `/uploads/<file>?preset=…` וכתובות חתומות (ספק מקומי). |

## בינאום

| תכונה | סטטוס | הערות |
| --- | --- | --- |
| סוגים מתורגמים ושדות שאינם מתורגמים | נתמך | `pluginOptions.i18n.localized`, גם לכל מאפיין. |
| `?locale=` ב-REST, `locale` ב-GraphQL | נתמך | שפה לא מוכרת היא `400`. |
| `localizations` בתגובות | נתמך | רק כשממלאים אותו (`populate=localizations`, `populate=*`), עם אותן אפשרויות כמו של קשר. גם שדה GraphQL. API הניהול משמיט אותו. |
| `GET /api/i18n/locales` | נתמך | מערך פשוט במבנה של Strapi. דורש `find` על `plugin::i18n.locale` (שורת **שפות** בטבלת ההרשאות), כמו `listLocales` ב-Strapi. `documentId` נגזר מקוד השפה. השפות מנוהלות בפאנל הניהול (**הגדרות ← בינאום**). |

## טיוטה ופרסום

| תכונה | סטטוס | הערות |
| --- | --- | --- |
| גרסת טיוטה וגרסה מפורסמת לכל מסמך | נתמך | לכל שפה. ראו [טיוטה ופרסום](/he/concepts/draft-and-publish/). |
| מחיקת טיוטה | נתמך | |
| פרסום מתוזמן | נתמך | דרך [מהדורות](/he/guides/content/releases/). |

## התאמה אישית של השרת

ראו [העברת קוד מותאם](/he/migrate/porting-custom-code/) לאופן שבו מעבירים כל אחד מאלה.

| Strapi | סטטוס | Verdin |
| --- | --- | --- |
| Lifecycle hooks, middlewares של Document Service | חלקי | before/after hooks בתוספי WebAssembly, שיכולים לשנות או לדחות כתיבה. בלי JavaScript. |
| Controllers, services ונתיבים מותאמים | חלקי | נתיבי תוספים תחת `/api/plugins/<name>/`. |
| Policies ו-middlewares | לא נתמך | הרשאות והגבלות קצב מובנות. |
| `register` / `bootstrap` | חלקי | פונקציית ההפעלה של תוסף, שרצה כשהתוסף עולה, מופעל או כשההגדרות שלו משתנות; היא יכולה לזרוע תוכן ולהחליף את הרשאות התפקיד הציבורי. |
| משימות Cron | חלקי | משימות של תוספים. |
| Document Service / Entity Service ב-JavaScript | לא נתמך | אין runtime של JavaScript. |
| תוספי npm מה-marketplace של Strapi | לא נתמך | |
| Webhooks | נתמך | חתומים, עם ניסיונות חוזרים ויומן; `entry.draft-discard` הוא `entry.discard-draft`. ראו [Webhooks](/he/guides/integrations/webhooks/). |
| אסימוני API (קריאה בלבד, גישה מלאה, מותאם) | נתמך | אותם סוגים, תפוגה אופציונלית, חידוש. |
| Transfer tokens, `strapi transfer` | לא נתמך | השתמשו ב-`verdin export` וב-`verdin import verdin`. |
| קובצי `strapi export` | נתמך (ייבוא) | `verdin import strapi`; ייצואים מוצפנים לא נקראים. |
| `config/*.js`, `.env` | חלקי | `verdin.toml` ומשתני סביבה. |
| טיפוסי TypeScript | נתמך | `verdin types`. |
| ספקי דוא"ל | חלקי | SMTP, Resend ו-Postmark. |

## פאנל הניהול

| תכונה | סטטוס | הערות |
| --- | --- | --- |
| Content manager, ספריית המדיה, בונה סוגי התוכן | נתמך | פאנל Angular משלו, לא ה-admin ב-React של Strapi. |
| משתמשי ניהול, תפקידים, תפקידים מותאמים | נתמך | Super Admin, Editor ו-Author מובנים, ועוד תפקידים מותאמים. |
| הרשאות ברמת שדה ושפה | נתמך | |
| תנאי RBAC | חלקי | רק התנאי המובנה `is-creator`; אין תנאים מותאמים. |
| התאמה אישית של פאנל הניהול (`src/admin/app`) | חלקי | לוגו, favicon, כותרת, צבע הדגשה וטקסטים ב-`[admin.branding]`; ווידג'טים ושדות מותאמים מתוספים. אין דפים מותאמים, injection zones או הרחבות React. |
| API הניהול (`/admin/…`) | לא נתמך | ל-Verdin יש API ניהול משלו; אל תבנו על זה של Strapi. |
| תצורת תצוגת עריכה ותצוגת רשימה | נתמך | |

## תכונות Enterprise

כל מה שב-Verdin הוא קוד פתוח; אלה תכונות Enterprise או בתשלום ב-Strapi.

| תכונה של Strapi | סטטוס | הערות |
| --- | --- | --- |
| SSO | חלקי | ספקי OpenID Connect, עם מיפוי של קבוצות לתפקידים. אין SAML או אסטרטגיות passport אחרות. ראו [כניסה יחידה (SSO)](/he/guides/auth/sso/). |
| יומני ביקורת | נתמך | ראו [יומני ביקורת](/he/guides/content/audit-logs/). |
| תהליכי בקרה | נתמך | תפקידים לכל שלב מגבילים מי מעביר רשומות *לתוך* שלב, ושלב פרסום נדרש חל על כל API. ראו [תהליכי בקרה](/he/guides/content/review-workflows/). |
| מהדורות | נתמך | מתוזמנות או מיידיות. |
| היסטוריית תוכן | נתמך | `[history].max_versions` גרסאות לכל מסמך. |
| תצוגה מקדימה ותצוגה מקדימה חיה | נתמך | כתובות תצוגה מקדימה עם אסימונים קצרי מועד, תצוגה מקדימה זה לצד זה ו[עריכה חזותית](/he/guides/frontend/visual-editing/). |
| תפקידי ניהול מותאמים | נתמך | בלי הגבלה על מספרם. |
