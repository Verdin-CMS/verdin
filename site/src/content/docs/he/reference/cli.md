---
title: תיעוד שורת הפקודה
description: כל פקודה, תת-פקודה ודגל של הקובץ הבינארי verdin, עם מה שהם קוראים, כותבים ומדפיסים.
sidebar:
  order: 2
  label: שורת הפקודה
---

<!-- Written from crates/verdin/src/cli.rs and crates/verdin/src/new.rs. `npm run check-cli`
(site/scripts/check-cli.mjs) fails when a subcommand or flag in cli.rs is missing here. -->

`verdin` הוא הקובץ הבינארי היחיד: הוא יוצר פרויקטים, מריץ את השרת, מחיל הגירות, מנהל משתמשי
ניהול ומכניס ומוציא תוכן. העמוד הזה מפרט כל פקודה ודגל.

```text title="Terminal"
verdin [OPTIONS] <COMMAND>
```

| פקודה | מה היא עושה |
| --- | --- |
| [`verdin new`](#verdin-new) | יצירת תיקיית פרויקט. |
| [`verdin dev`](#verdin-dev) | הרצת השרת במצב פיתוח. |
| [`verdin start`](#verdin-start) | הרצת השרת במצב ייצור. |
| [`verdin schema check`](#verdin-schema-check) | אימות קובצי הסכמה. |
| [`verdin migrate plan`](#verdin-migrate-plan) | הצגת שלבי ההגירה וה-SQL שלהם. |
| [`verdin migrate apply`](#verdin-migrate-apply) | החלת שלבי ההגירה. |
| [`verdin admin create`](#verdin-admin-create) | יצירת Super Admin. |
| [`verdin admin reset-password`](#verdin-admin-reset-password) | קביעת הסיסמה של מנהל. |
| [`verdin types`](#verdin-types) | יצירת הגדרות TypeScript של API התוכן. |
| [`verdin import strapi`](#verdin-import-strapi) | ייבוא ייצוא של Strapi. |
| [`verdin import verdin`](#verdin-import-verdin) | ייבוא ייצוא של Verdin. |
| [`verdin export`](#verdin-export) | כתיבת הפרויקט לארכיון `.tar.gz`. |
| [`verdin healthcheck`](#verdin-healthcheck) | בדיקה שהשרת המקומי עונה. |
| [`verdin secrets`](#verdin-secrets) | הדפסת סודות חדשים. |
| [`verdin version`](#verdin-version) | הדפסת הגרסה. |

## אפשרויות גלובליות

| אפשרות | ברירת מחדל | תיאור |
| --- | --- | --- |
| `-c, --config <CONFIG>` | `verdin.toml` | קובץ התצורה של הפרויקט. נקרא גם מ-`VERDIN_CONFIG`. שורש הפרויקט הוא התיקייה של הקובץ: הסכמה, התוספים, ההעלאות ונתיבי SQLite יחסיים נפתרים מולה. |
| `-h, --help` | | הדפסת עזרה לפקודה. |
| `-V, --version` | | הדפסת הגרסה. |

`verdin help <COMMAND>` מדפיס את אותה עזרה כמו `--help`.

כל פקודה חוץ מ-`new`, `secrets` ו-`version` טוענת קודם את הפרויקט:

1. היא קוראת את קובץ ה-`.env` שליד קובץ התצורה, אם יש כזה. משתנים שכבר מוגדרים בסביבה
   גוברים.
2. היא טוענת את `verdin.toml` (אופציונלי) ואת דריסות ה-`VERDIN_*`. ראו את
   [תיעוד התצורה](/he/reference/configuration/).
3. היא מתחילה לכתוב יומן ל-standard error, עם `[log]` ו-`RUST_LOG`.

פקודות שפותחות את מסד הנתונים צריכות `VERDIN_DATABASE_URL` או `[database].url`. פקודות שנוגעות
בחשבונות ניהול או מריצות את השרת צריכות גם `VERDIN_ADMIN_JWT_SECRET` ו-`VERDIN_TOKEN_PEPPER`.

## `verdin new`

```text title="Terminal"
verdin new <DIR> [--database <DATABASE>]
```

יוצרת פרויקט ב-`DIR`, שחייבת לא להתקיים או להיות ריקה:

| קובץ | תוכן |
| --- | --- |
| `verdin.toml` | `[server]`, `[api]` ו-`[admin]` עם ברירות המחדל שלהם. |
| `.env` | `VERDIN_DATABASE_URL`, ו-`VERDIN_ADMIN_JWT_SECRET` ו-`VERDIN_TOKEN_PEPPER` חדשים. קריא רק לכם (מצב `0600` ב-Unix). |
| `.gitignore` | `.env`, `data/`, קובצי SQLite ו-`.cache/`. |
| `schema/content-types/`, `schema/components/` | תיקיות סכמה ריקות. |
| `data/` | עבור מסד הנתונים של SQLite (SQLite בלבד). |

| ארגומנט או אפשרות | ברירת מחדל | תיאור |
| --- | --- | --- |
| `<DIR>` | | התיקייה ליצירה. |
| `--database <DATABASE>` | `sqlite` | מסד הנתונים שה-`.env` מצביע אליו: `sqlite`, `postgres`, `mysql` או `mariadb`. |

עם `sqlite`, הכתובת היא `sqlite://data/verdin.db`. עם האחרים זו כתובת של שרת מקומי עם המשתמש
`verdin`, הסיסמה `change-me` ומסד נתונים ששמו כשם התיקייה (אותיות קטנות, ספרות ו-`_`): ערכו
אותה לפני ההפעלה.

```text title="Terminal"
$ verdin new blog --database postgres
created blog

  cd blog
  verdin dev

then open http://localhost:1337/admin/ to register the first admin
```

## `verdin dev`

```text title="Terminal"
verdin dev
```

מריצה את השרת במצב פיתוח. בהשוואה ל-`verdin start`:

- הגירות ממתינות עם רמת הסיכון `safe` מוחלות בהפעלה. שלבים מסוכנים יותר עוצרים את השרת; עברו
  עליהם עם [`verdin migrate plan`](#verdin-migrate-plan).
- **בונה סוגי התוכן** בפאנל הניהול עורך את קובצי הסכמה והשרת טוען מחדש את הסכמה.
- עוגיית הרענון לא מסומנת `Secure` (אלא אם `[admin].secure_cookies` אומר כך), כך שאפשר
  להתחבר מעל HTTP רגיל.
- Webhooks ויעדי פריסה רשאים לקרוא לכתובות loopback ופרטיות (אלא אם
  `[webhooks].allow_private_networks` אומר אחרת).

היא נעצרת ב-Ctrl+C או ב-`SIGTERM`.

## `verdin start`

```text title="Terminal"
verdin start [--migrate]
```

מריצה את השרת במצב ייצור. היא מסרבת לעלות כשמסד הנתונים מפגר אחרי הסכמה, כך שפריסה אף פעם
לא משנה טבלאות שלא עברתם עליהן.

| אפשרות | תיאור |
| --- | --- |
| `--migrate` | החלת שלבי הגירה `safe` ממתינים לפני ההפעלה. שלבים מסוכנים והרסניים עדיין דורשים `verdin migrate apply`. |

לפני שהיא מאזינה, היא בודקת את התצורה (`[api].prefix` ו-`[admin].path` נראים כמו `/api`, גודלי
העמודים עקביים, `[server].trusted_proxies` ו-`[api].cors_origins` מתפענחים) ויוצרת את
התפקידים המובנים. היא רושמת אזהרה כש-`[admin].secure_cookies` הוא `false` או כש-`[email].provider`
הוא `log`. כשעדיין אין מנהל, היא רושמת ביומן את הכתובת של פאנל הניהול, שבה המבקר הראשון רושם
את ה-Super Admin הראשון.

היא נעצרת ב-Ctrl+C או ב-`SIGTERM`.

## `verdin schema check`

```text title="Terminal"
verdin schema check
```

מאמתת את קובצי הסכמה (`[schema].path`) בלי לגעת במסד הנתונים. היא מדפיסה סיכום, או נכשלת עם
השגיאות, כל אחת עם הקובץ ונתיב המאפיין שלה:

```text title="Terminal"
$ verdin schema check
schema ok: 4 content types, 3 components
```

השתמשו בה ב-CI לפני פריסה. ראו [טיפוסי מאפיינים](/he/reference/attribute-types/) למה שכל
מאפיין מקבל.

## `verdin migrate plan`

```text title="Terminal"
verdin migrate plan [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

משווה את מסד הנתונים לסכמה ומדפיסה מה `verdin migrate apply` היה עושה, בלי לשנות כלום: שלבים
ממוספרים, כל אחד עם רמת הסיכון וה-SQL שלו. היא מדפיסה `database is up to date` כשאין מה לעשות.

| אפשרות | תיאור |
| --- | --- |
| `--rename-table <OLD=NEW>` | להתייחס לטבלה `OLD` כאילו שמה שונה ל-`NEW` (שומר על השורות שלה) במקום להסיר אחת וליצור את השנייה. ניתן לחזור עליה. |
| `--rename-column <TABLE.OLD=NEW>` | להתייחס לעמודה `OLD` של `TABLE` כאילו שמה שונה ל-`NEW` (שומר על הערכים שלה). `TABLE` הוא השם החדש של הטבלה. ניתן לחזור עליה. |

רמות סיכון:

| רמה | משמעות |
| --- | --- |
| `safe` | לא יכול לאבד נתונים או להיכשל על שורות קיימות: טבלאות חדשות, עמודות חדשות שניתנות ל-null או שיש להן ברירת מחדל, שינויי שם, אינדקסים שאינם ייחודיים. |
| `risky` | עלול להיכשל על שורות קיימות או להמיר ערכים: שינויי טיפוס של עמודות, עמודות חדשות שאינן ניתנות ל-null ואין להן ברירת מחדל, אינדקסים ייחודיים בטבלאות קיימות. |
| `destructive` | מסיר עמודות או טבלאות. |

כששלב מעל `safe`, התוכנית מסתיימת בדגל שהיא צריכה (`requires: verdin migrate apply --allow risky`).
כשעמודה או טבלה שהוסרו נראות כמו שינוי שם, היא מפרטת את דגלי שינוי השם להעביר. כשהגירה קודמת
נקטעה, היא מציגה כמה שלבים הוחלו ומה השגיאה האחרונה.

```text title="Terminal"
verdin migrate plan --rename-column articles.summary=excerpt
```

ראו [הגירות סכמה](/he/concepts/schema-migrations/).

## `verdin migrate apply`

```text title="Terminal"
verdin migrate apply [--allow <ALLOW>] [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

מחילה את התוכנית. היא מקבלת את אותן אפשרויות שינוי שם כמו `verdin migrate plan`; העבירו את
אותן אלה שעברתם עליהן.

| אפשרות | ברירת מחדל | תיאור |
| --- | --- | --- |
| `--allow <ALLOW>` | `safe` | רמת הסיכון הגבוהה ביותר להחלה: `safe`, `risky` או `destructive`. תוכנית עם שלב מעליה נדחית לפני שמשהו רץ. |
| `--rename-table <OLD=NEW>` | | כמו ב-`verdin migrate plan`. |
| `--rename-column <TABLE.OLD=NEW>` | | כמו ב-`verdin migrate plan`. |

היא מדפיסה `applied N steps`, או `database is up to date`. אחרי קטיעה (חיבור שאבד, שלב שנכשל),
תקנו את הסיבה והריצו אותה שוב: היא ממשיכה מהשלב שלא הושלם.

## `verdin admin create`

```text title="Terminal"
verdin admin create --email <EMAIL>
```

יוצרת Super Admin. הסיסמה נקראת מ-`VERDIN_ADMIN_PASSWORD`, או מ-standard input כשהוא לא
מוגדר. מסד הנתונים חייב להיות מעודכן מול הסכמה.

| אפשרות | תיאור |
| --- | --- |
| `--email <EMAIL>` | כתובת הדוא"ל של המנהל החדש. |

```text title="Terminal"
$ VERDIN_ADMIN_PASSWORD='a long passphrase' verdin admin create --email ada@example.com
created Super Admin ada@example.com (id 1)
```

השתמשו בה כדי ליצור את המנהל הראשון של שרת שעדיין לא נגיש בדפדפן; אחרת המבקר הראשון של פאנל
הניהול רושם אותו.

## `verdin admin reset-password`

```text title="Terminal"
verdin admin reset-password --email <EMAIL>
```

קובעת את הסיסמה של מנהל, משחררת את נעילת החשבון אחרי התחברויות כושלות ומסיימת את כל הסשנים
שלו. הסיסמה נקראת כמו ב-`verdin admin create`.

| אפשרות | תיאור |
| --- | --- |
| `--email <EMAIL>` | כתובת הדוא"ל של המנהל. |

היא לא מסירה גורמים שניים; מנהל עם **ניהול משתמשים** יכול לאפס אותם ב-**הגדרות ← משתמשים**.

## `verdin types`

```text title="Terminal"
verdin types [-o <OUT>]
```

יוצרת הגדרות TypeScript של API התוכן (ממשק אחד לכל סוג תוכן ורכיב) מהסכמה, ומדפיסה אותן
ל-standard output. היא לא צריכה את מסד הנתונים.

| אפשרות | תיאור |
| --- | --- |
| `-o, --out <OUT>` | כתיבה לקובץ הזה במקום זאת. |

```text title="Terminal"
verdin types --out ../web/src/verdin.d.ts
```

ראו [לקוח עם טיפוסים](/he/guides/frontend/typed-client/).

## `verdin import strapi`

```text title="Terminal"
verdin import strapi <PATH> [--schema-only] [--force]
```

מייבאת פרויקט Strapi v4 או v5 מייצוא שנעשה עם `strapi export --no-encrypt`: קובץ `.tar.gz`,
קובץ `.tar` או תיקייה פרוסה. היא כותבת את סוגי התוכן והרכיבים כקובצי סכמה, ואז מייבאת רשומות,
שפות, מדיה, קשרים ותיקיות.

| ארגומנט או אפשרות | תיאור |
| --- | --- |
| `<PATH>` | קובץ הייצוא או התיקייה. |
| `--schema-only` | כתיבת קובצי הסכמה בלבד. |
| `--force` | דריסת קובצי סכמה קיימים, וייבוא לסוגי תוכן שכבר יש להם רשומות. |

היא מדפיסה מה היא כתבה וייבאה, עם אזהרות על מה שלא יכלה להעביר, וכותבת את `strapi-id-map.json`
בשורש הפרויקט: מזהי ה-Strapi וערכי ה-`documentId` ומזהי הקבצים החדשים שלהם ב-Verdin, לתיקון
קישורים בפרונטאנד.

ראו [מעבר מ-Strapi](/he/migrate/from-strapi/).

## `verdin import verdin`

```text title="Terminal"
verdin import verdin <PATH> [--force]
```

מייבאת ארכיון שנכתב על ידי `verdin export`: קובצי סכמה, שפות, מדיה ורשומות.

| ארגומנט או אפשרות | תיאור |
| --- | --- |
| `<PATH>` | קובץ ה-`.tar.gz`. |
| `--force` | דריסת קובצי סכמה שונים, וייבוא לסוגי תוכן שכבר יש להם רשומות. |

## `verdin export`

```text title="Terminal"
verdin export <OUTPUT> [--no-media]
```

כותבת את הסכמה, התוכן והמדיה של הפרויקט לארכיון `.tar.gz`: גיבוי, או דרך להעביר פרויקט למופע
אחר עם `verdin import verdin`. הארכיון מחזיק כל גרסה של כל רשומה (טיוטות, גרסאות מפורסמות,
שפות) עם הקשרים שלה. חשבונות ניהול, אסימוני API והגדרות אינם כלולים.

| ארגומנט או אפשרות | תיאור |
| --- | --- |
| `<OUTPUT>` | הארכיון לכתיבה. |
| `--no-media` | השמטת ספריית המדיה: קבצים, תיקיות והקישורים של הרשומות אליהם. |

```text title="Terminal"
$ verdin export backup.tar.gz
exported to backup.tar.gz: 42 documents (57 versions), 18 files, 3 folders, 2 locales
```

ראו [גיבויים](/he/deploy/backups/).

## `verdin healthcheck`

```text title="Terminal"
verdin healthcheck [--port <PORT>]
```

שואלת את `GET /_health` של השרת במכונה הזו (`127.0.0.1`, ה-`[server].port` של התצורה) ויוצאת
עם סטטוס 0 כשהוא עונה `200`, ו-1 אחרת, תוך הדפסת הסיבה. היא לא צריכה shell, `curl` או לקוח
HTTP, ולכן האימג' של Docker משתמש בה כ-`HEALTHCHECK` שלו; השתמשו בה באותה דרך ב-Compose או בכל
supervisor שמריץ פקודה.

| אפשרות | תיאור |
| --- | --- |
| `--port <PORT>` | בדיקת הפורט הזה במקום `[server].port`. |

```text title="Terminal"
$ verdin healthcheck
ok
```

ראו [ניטור](/he/deploy/monitoring/).

## `verdin secrets`

```text title="Terminal"
verdin secrets
```

מדפיסה `VERDIN_ADMIN_JWT_SECRET` ו-`VERDIN_TOKEN_PEPPER` חדשים, מוכנים לקובץ `.env` או למאגר
הסודות של הפלטפורמה שלכם. היא לא קוראת אף פרויקט.

שינוי `VERDIN_ADMIN_JWT_SECRET` מבטל את אסימוני הגישה קצרי המועד של מנהלים ושל משתמשי קצה,
קישורי תצוגה מקדימה פתוחים והתחברויות OAuth שבתהליך; פאנל הניהול ולקוחות שמשתמשים באסימוני
רענון מקבלים חדשים בעצמם. שינוי `VERDIN_TOKEN_PEPPER` פוסל אסימונים שמורים (ביניהם אסימוני
API), לכן שמרו עליו ברגע שהוא בשימוש.

## `verdin version`

```text title="Terminal"
verdin version
```

מדפיסה `verdin` ואת הגרסה, כמו `verdin --version`.
