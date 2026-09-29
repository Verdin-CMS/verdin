---
title: פאנל הניהול
description: איך פאנל הניהול של Verdin, שנכתב ב-Angular, בנוי, איך הוא בונה טפסים ורשימות מהסכמה, ואיך הוא נבנה, מוטמע בקובץ הבינארי ומתורגם.
sidebar:
  order: 6
  label: פאנל הניהול
---

העמוד הזה מיועד לתורמים לפאנל הניהול שב-`admin/`: איך אפליקציית ה-Angular מאורגנת, איך היא הופכת את סכמת התוכן לטפסים ולרשימות, ואיך היא מגיעה לתוך הקובץ הבינארי `verdin`. השימוש בפאנל מכוסה במדריכים; איך הצד של השרת ב-API הניהול עובד מופיע ב[תיעוד API הניהול](/he/api/admin/).

הפאנל הוא אפליקציית single-page ב-Angular 22: standalone components, zoneless change detection, signals, נתיבים שנטענים בעצלות (lazy), ורכיבי spartan/ui על Tailwind CSS v4.

## מבנה

```text
admin/
├── src/app/
│   ├── app.config.ts     # providers: router, HttpClient interceptors, Transloco, icons
│   ├── app.routes.ts     # lazy routes, guards (auth, permissions, unsaved changes)
│   ├── core/             # services and pure models: api, auth, schema, i18n, permissions…
│   ├── layout/           # the shell (sidebar, header), home, deploy button
│   ├── features/
│   │   ├── auth/         # login, first admin, invitations, password reset
│   │   ├── dashboard/    # home widgets
│   │   ├── content/      # lists, the entry editor, history, releases, review, import
│   │   │   ├── fields/   # schema-driven form controls and the form model
│   │   │   └── collab/   # comments and tasks
│   │   ├── builder/      # content-type builder (verdin dev only)
│   │   ├── media/        # media library
│   │   ├── releases/
│   │   ├── profile/      # own account, two-factor, passkeys, sessions
│   │   └── settings/     # users, roles, tokens, webhooks, locales, plugins, site features…
│   └── shared/
│       ├── ui/           # spartan helm components, owned by the project
│       └── components/   # app-level shared components (confirm dialog, page header…)
├── public/i18n/          # translation catalogs, one JSON file per language
├── scripts/check-i18n.mjs
└── e2e/                  # Playwright tests and the server they run against
```

**מצב** נמצא ב-signals בתוך שירותים הניתנים להזרקה ב-`core/` (`Auth`, `Schema`, `I18n`, `Theme`…). אין ספריית store.

**גישה ל-API** עוברת דרך `core/api.ts`, עטיפה קטנה מבוססת promises מעל ה-`HttpClient` של Angular, עם טיפוסים שנכתבו ידנית ב-`core/types.ts`. תצורת זמן הריצה (נתיב הניהול, קידומת ה-API, המצב, המיתוג) מגיעה מתגית `<meta name="verdin-config">` שהשרת מזריק.

**סשן.** אסימון הגישה נמצא רק בזיכרון; אסימון הרענון הוא עוגיית `HttpOnly` שמוגבלת לנתיבי האימות. HTTP interceptor מוסיף את ה-bearer token, ועל `401` הוא מרענן פעם אחת ומנסה שוב; אם הרענון נכשל הוא שולח את המשתמש לדף ההתחברות. בקשות רענון והתנתקות נושאות את הכותרת `X-Verdin-CSRF` שהשרת דורש. Guards משחזרים את הסשן מהעוגייה בטעינת הדף. `403` שאומר שהתפקיד מחייב אימות דו-שלבי שולח את המשתמש להגדיר אותו.

## טפסים מונחי סכמה

לעורך הרשומות (`features/content/edit.ts`) אין קוד לכל סוג. הוא קורא את סוגי התוכן והרכיבים מ-`GET /admin/api/content-types` ומ-`GET /admin/api/components`, ואת פריסת העורך מהגדרות תצוגת העריכה, ובונה את הטופס בזמן ריצה עם **Signal Forms** (`@angular/forms/signals`):

- מודל המסמך הוא signal של אובייקט פשוט (`FormModel` ב-`fields/model.ts`); עץ השדות והמאמתים שלו נגזרים מהסכמה.
- רכיב רקורסיבי `vd-fields` (`fields/fields.ts`) מציג כל מפת מאפיינים מול עץ שדות. טקסט, תאריכים ושעות משתמשים בקלטים מקוריים שקשורים עם `[formField]`. רכיבי `FormValueControl` מותאמים מטפלים במספרים (ניתנים ל-null; מספרים שלמים גדולים נשארים מחרוזות), מתגים, enumerations, תאריך-שעה (שעה מקומית בקלט, UTC במודל), JSON, Markdown, `blocks` (TipTap), מדיה, קשרים (בורר עם חיפוש תוך כדי הקלדה וסידור) וקשרים פולימורפיים.
- רכיבים הם fieldsets מקוננים; רכיבים חוזרים ואזורים דינמיים הם רשימות שאפשר לסדר מחדש. תוספים יכולים לרשום טיפוסי שדות מותאמים, שמוצגים כ-custom elements.
- `toModel` ממיר מסמך שעבר populate למודל הטופס (קשרים הופכים לערכי `documentId`, קבצים הופכים למזהים), ו-`toPayload` ממיר בחזרה ל-payload של `data`: מחרוזות ריקות הופכות ל-`null`, מפתחות רינדור (`__key`) וצדדים לקריאה בלבד (`mappedBy`, `morphOne`, `morphMany`) מושמטים. שניהם נבדקים בבדיקות יחידה ב-`fields/model.spec.ts`.
- אימות שנגזר מהסכמה נותן משוב מיידי. שדות מותנים (`conditions.visible`) מחושבים בדפדפן על ידי העתק של מחשב ה-JSON Logic של השרת (`core/logic.ts`). כללי אימות בין שדות נבדקים רק על ידי השרת. השרת נשאר הסמכות: רשומות ה-`details.errors[].path` שלו ממופות בחזרה לשדה המתאים.
- השמירה מפורשת, עם מעקב אחרי שינויים ואזהרה ביציאה מהדף (route guard ועוד `beforeunload`). הכפתורים **פרסום**, **ביטול פרסום** ו**ביטול השינויים** מופיעים לפי מצב המסמך. פאנל הניהול שומר טיוטות בלבד; פרסום הוא תמיד פעולה נפרדת.

פריסת העורך (סדר השדות, רוחבים, תוויות, תיאורים, שדות לקריאה בלבד, השדה שנותן שם לרשומות קשורות) משותפת לכל המנהלים ונשמרת בשרת ב-`vd_settings`, ומשתנה מהדף **הגדרת התצוגה** עם ההרשאה `views.manage`.

## רשימות

רשימות התוכן (`features/content/list.ts`) משתמשות בטבלת ה-helm של spartan עם עימוד, מיון ומסננים בצד השרת. המסננים, החיפוש (`_q`) והעמוד משתקפים ב-URL, כך שרשימה מסוננת היא קישור שאפשר לשתף. כל מנהל בוחר את העמודות הגלויות, מיון ברירת המחדל וגודל העמוד לכל סוג (`list-view.ts`); הבחירות האלה נשמרות בהעדפות שלו בשרת, כך שהן עוקבות אחריו בין דפדפנים. הרשימות מתעדכנות גם בזמן אמת מזרם האירועים של הניהול.

## בונה סוגי התוכן

**בונה סוגי התוכן** גלוי רק כשהשרת רץ במצב פיתוח (`verdin dev`) ולמנהל יש `schema.manage`. הוא עורך סוגי תוכן ורכיבים בפורמט הקבצים שלהם: שדות, סוגי קשרים ויעדים (כולל יצירת המאפיין ההפוך ביעד), רכיבים, אזורים דינמיים, אורכים, טווחים, והדגלים `required`, `unique` ו-`private`.

כל שינוי נשלח קודם ל-`POST /admin/api/schema/plan`, שמאמת את הסכמה העתידית ומחזיר את שלבי ההגירה עם הסיכון שלהם, ה-SQL שלהם והצעות לשינויי שם שהמשתמש יכול לקבל. האישור קורא ל-`POST /admin/api/schema/apply` עם רמת הסיכון ושינויי השם שהתקבלו. השרת מבצע את ההגירה, כותב את `schema/*.json`, ומחליף את האפליקציה הרצה באפליקציה עם הסכמה החדשה בלי הפעלה מחדש. ראו [מנוע ההגירות](/he/internals/migrations/) למה שקורה בשרת.

## בנייה והפצה

- `ng build` כותב את בניית הייצור ל-`admin/dist/admin/browser`, עם `<base href="/admin/">`.
- השרת מטמיע את התיקייה הזו עם `rust-embed` כשהוא מהודר עם התכונה `embed-admin`, שבה משתמשים בניות ה-release והאימג' של Docker. בלי התכונה, או כש-`[admin].assets_dir` מוגדר, הוא מגיש את הקבצים מהדיסק. `assets_dir` גובר על הבנייה המוטמעת.
- השרת משכתב את `<base href>` ל-`[admin].path` ומזריק את תצורת זמן הריצה כתגית `<meta>`, לא כסקריפט inline. שינוי `admin.path` אף פעם לא דורש לבנות מחדש את הפאנל.
- נתיבים לא מוכרים בלי סיומת קובץ נופלים חזרה ל-`index.html` לניתוב בצד הלקוח. חבילות עם טביעת אצבע (`main-ABC123.js`) נשמרות במטמון כ-`immutable` לשנה; כל השאר `no-cache`.
- כל תגובה של פאנל הניהול נושאת Content Security Policy קפדנית (`script-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`…), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` ו-`Referrer-Policy: strict-origin-when-cross-origin`. ה-inlining של critical CSS של Angular כבוי ב-`angular.json` כי הוא נשען על event handlers מסוג inline שהמדיניות אוסרת.

לעבודת פרונטאנד, הריצו את השרת, ואז `npm start` ב-`admin/`: `ng serve` מעביר (proxy) את `/admin/api` ואת `/api` ל-`http://localhost:1337` (`admin/proxy.conf.json`).

## תרגומים

הפאנל מתורגם בזמן ריצה עם Transloco, לא עם ה-i18n של Angular בזמן ההידור, כך שבנייה אחת מגישה כל שפה ומשתמשים יכולים להחליף שפה בלי טעינה מחדש.

- הקטלוגים הם קובצי JSON שטוחים ב-`admin/public/i18n/` (`en.json` הוא המקור), שנטענים לפי דרישה.
- ההודעות משתמשות ב-ICU MessageFormat (`{name}`, `{count, plural, one {# entry} other {# entries}}`), שמפורשות על ידי FormatJS (`intl-messageformat`) דרך transpiler מותאם של Transloco. FormatJS מפרש הודעות במקום להדר אותן לפונקציות, כך שה-CSP לא צריך `unsafe-eval`.
- מפתחות ההודעות מקבלים טיפוסים מ-`en.json` (`core/i18n/keys.ts`): שימוש במפתח שלא קיים הוא שגיאת הידור.
- `npm run i18n:check` בודק כל קטלוג מול `en.json`: אותם מפתחות, תחביר ICU תקין, אותם ארגומנטים, וכל קטגוריות הרבים של השפה. ה-CI מריץ אותו.
- השירות `I18n` מספק גם עיצוב לפי locale ואת היום הראשון בשבוע, שנלקחים מההגדרות האזוריות של הדפדפן עם אפשרות דריסה לכל משתמש.

איך להוסיף או לעדכן שפה מוסבר ב[תרגום](/he/project/translating/).
