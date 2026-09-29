---
title: תיעוד התצורה
description: כל קטע ומפתח של verdin.toml, עם ברירות מחדל, ומשתני הסביבה ש-Verdin קורא.
sidebar:
  order: 1
  label: תצורה
---

<!-- Written from crates/verdin/src/config.rs, crates/verdin-upload/src/config.rs and
crates/verdin-email/src/lib.rs, crates/verdin-upload/src/transform.rs,
crates/verdin-search/src/lib.rs, crates/verdin-api/src/cdn.rs and crates/verdin-api/src/ai.rs.
Keep it in step when keys change. -->

התצורה בנויה בשכבות: **ברירות מחדל מובנות ← `verdin.toml` ← סביבה**. הקובץ אופציונלי; לכל
מפתח יש ברירת מחדל. מפתחות לא מוכרים נדחים, כך ששגיאת הקלדה נכשלת בהפעלה במקום שיתעלמו ממנה.

- דרסו כל מפתח עם `VERDIN_<SECTION>__<KEY>` (שני קווים תחתונים), למשל `VERDIN_SERVER__PORT=8080`
  או `VERDIN_ADMIN__SECURE_COOKIES=false`. טבלאות מקוננות מקבלות עוד `__`:
  `VERDIN_ADMIN__BRANDING__TITLE=ACME`. גם כאן מפתחות לא מוכרים נדחים, כך שכל משתנה שמתחיל
  ב-`VERDIN_` ומכיל `__` חייב לציין מפתח אמיתי.
- `VERDIN_DATABASE_URL` הוא קיצור של `database.url`.
- הקובץ הוא `verdin.toml` בתיקיית העבודה, או הנתיב שניתן עם `-c, --config` או `VERDIN_CONFIG`.
  נתיבים יחסיים בו (סכמה, תוספים, העלאות, קובצי SQLite) נפתרים מול התיקייה של הקובץ.
- קובץ `.env` שליד התצורה נטען קודם; משתנים שכבר מוגדרים בסביבה גוברים.

סודות אף פעם לא נקראים מ-`verdin.toml`; ראו [משתני סביבה](#משתני-סביבה).

## `[server]`

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `host` | `"0.0.0.0"` | הכתובת להאזנה. |
| `port` | `1337` | הפורט להאזנה. |
| `public_url` | לא מוגדר | היכן דפדפנים מגיעים לשרת, למשל `"https://cms.example.com"`. משמש לקישורים בהודעות דוא"ל ול-callbacks של SSO; ברירת המחדל `http://localhost:{port}`. |
| `body_limit` | `"1mb"` | גוף הבקשה הגדול ביותר של בקשות API רגילות (להעלאות יש מגבלה משלהן). מספר בייטים או מחרוזת עם `b`, `kb`, `mb` או `gb`. |
| `request_timeout_secs` | `30` | מגבלת הזמן של בקשות API רגילות. |
| `sync_interval_secs` | `10` | באיזו תדירות לקלוט הגדרות שמופעים אחרים שינו (תכונות, מתגי תוספים, שפות, תהליכי בקרה); `0` מכבה את זה (מופע יחיד). |
| `trusted_proxies` | `[]` | Reverse proxies (כתובות IP או טווחי CIDR, למשל `["10.0.0.0/8"]`) שה-`X-Forwarded-For` שלהם מציין את הלקוח. הגבלות הקצב ויומני הביקורת משתמשים בכתובת הזו; בלעדיה, כל הלקוחות מאחורי ה-proxy חולקים כתובת אחת. |

## `[database]`

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `url` | לא מוגדר | כתובת החיבור: `postgres://…`, `mysql://…` (MySQL ו-MariaDB) או `sqlite://…`. חובה; בדרך כלל מוגדרת דרך `VERDIN_DATABASE_URL`. |
| `pool_max` | `10` | מספר החיבורים המרבי ב-pool. |

## `[schema]`

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `path` | `"schema"` | תיקיית הסכמה, יחסית לקובץ התצורה. |

## `[api]`

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `prefix` | `"/api"` | הנתיב שתחתיו מוגש API התוכן. חייב להתחיל ב-`/` ולא להסתיים בו. |
| `default_page_size` | `25` | גודל העמוד כשבקשה לא מציינת. בין 1 ל-`max_page_size`. |
| `max_page_size` | `100` | גודל העמוד הגדול ביותר שבקשה יכולה לבקש. |
| `decimal_as_string` | `false` | סידור מספרים עשרוניים כמחרוזות (מדויק) במקום כמספרים (תואם Strapi). |
| `public_rate_limit` | `0` | בקשות לדקה לכל IP של לקוח בלי אסימון (`0`: ללא הגבלה). |
| `token_rate_limit` | `0` | בקשות לדקה לכל אסימון API או משתמש קצה (`0`: ללא הגבלה). |
| `cache_ttl_secs` | `0` | שמירת קריאות אנונימיות בזיכרון למשך הזמן הזה (`0`: בלי מטמון); שינויים מרוקנים את המטמון. |
| `cache_entries` | `1000` | המספר המרבי של תגובות שמורות. |
| `cors_origins` | `[]` | מקורות הדפדפן שמורשים לקרוא ל-API התוכן ול-GraphQL מאתר אחר (`["https://www.example.com"]`: סכמה, host ופורט, בלי נתיב), או `["*"]` לכל מקור (לבד: אי אפשר לשלב `*` עם מקורות). ריק: רק דפים מאותו מקור יכולים לקרוא להם מדפדפן. API הניהול אף פעם לא מקבל קריאות cross-origin. |

## `[admin]`

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `path` | `"/admin"` | הנתיב שתחתיו מוגש פאנל הניהול; ה-API שלו נמצא ב-`{path}/api`. |
| `secure_cookies` | לא מוגדר | סימון עוגיית הרענון כ-`Secure`. לא מוגדר פירושו כן ב-`verdin start` ולא ב-`verdin dev` (פיתוח מקומי מעל HTTP רגיל). |
| `auth_rate_limit` | `20` | ניסיונות התחברות, הרשמה ורענון לכל IP של לקוח לדקה. |
| `assets_dir` | לא מוגדר | הגשת פאנל הניהול מהתיקייה הזו (יחסית לקובץ התצורה) במקום מהעותק שמוטמע בקובץ הבינארי. |

### `[admin.branding]`

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `title` | `"Verdin"` | מוצג בסרגל הצד, בדף ההתחברות ובלשונית הדפדפן. |
| `logo` | לא מוגדר | קובץ תמונה (SVG, PNG, WebP), יחסית לקובץ התצורה. |
| `favicon` | לא מוגדר | קובץ אייקון (ICO, PNG, SVG), יחסית לקובץ התצורה. |
| `accent` | לא מוגדר | צבע `#rrggbb` של כפתורים, קישורים וטבעות פוקוס. |
| `translations` | `{}` | טקסטים של פאנל הניהול שמוחלפים לכל שפה, למשל `[admin.branding.translations.en]` עם `"auth.login.title" = "Welcome to ACME"`. המפתחות הם אלה של `admin/public/i18n/en.json`. |

## `[upload]`

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `provider` | `{ name = "local", dir = "public/uploads" }` | היכן הקבצים נשמרים; ראו בהמשך. |
| `max_file_size` | `209715200` | הקובץ הגדול ביותר שמתקבל, בבייטים (200 MB). |
| `responsive_formats` | `true` | יצירת פורמטים רספונסיביים לתמונות raster. |
| `breakpoints` | large 1000, medium 750, small 500 | פורמטים רספונסיביים כטבלאות `{ name, width }` (ה-`breakpoints` של Strapi). פורמטים רחבים מהתמונה מדולגים. |
| `max_image_megapixels` | `100` | מגבלת פענוח נגד פצצות דחיסה, במגה-פיקסלים. |
| `max_original_size` | לא מוגדר | מקורות raster גדולים ממספר הפיקסלים הזה (בכל צד) מוקטנים בהעלאה, מה שגם מסיר את המטא-נתונים שלהם (EXIF, GPS). לא מוגדר שומר על המקורות כפי שנשלחו. |

```toml
[upload]
breakpoints = [{ name = "large", width = 1000 }, { name = "small", width = 500 }]
```

### ספק מקומי

קבצים תחת `dir` (יחסית לפרויקט), שמוגשים על ידי Verdin ב-`/uploads`.

```toml
[upload]
provider = { name = "local", dir = "public/uploads" }
```

### `[upload.transforms]`

המרות תמונות של קבצים מקומיים: `/uploads/<file>?preset=thumb`, או `?w=&h=&fit=&format=&q=` עם
חתימה. הגרסאות שמיוצרות נשמרות במטמון בדיסק ומוסרות כשהקובץ משתנה (כולל נקודת המוקד שלו).
חיתוכי cover שומרים על נקודת המוקד של הקובץ בתמונה; תמונות אף פעם לא מוגדלות. אפשר להמיר JPEG,
PNG, WebP, TIFF ו-BMP (לא GIF, שעשויים להיות מונפשים).

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `enabled` | `true` | הגשת המרות. |
| `presets` | `{}` | המרות עם שם, שתמיד מותרות: `{ w, h, fit, format, q }`. |
| `allow_arbitrary` | `false` | קבלת כל פרמטר בלי חתימה. כל כתובת URL שונה מיוצרת ונשמרת במטמון, לכן רק לרשתות מהימנות. |
| `max_size` | `4096` | ה-`w` או ה-`h` הגדול ביותר, בפיקסלים. |
| `cache_dir` | `".cache/transforms"` | היכן הגרסאות נשמרות (יחסית לפרויקט; בטוח למחוק). |

פרמטרים: `w`, `h` (פיקסלים), `fit` (`cover`, ברירת המחדל, חותך לתיבה; `inside` מכניס לתוכה;
`fill` מותח), `format` (`jpeg`, `png`, `webp`; פלט WebP הוא lossless) ו-`q` (איכות JPEG, ‏1–100,
ברירת מחדל 80).

```toml
[upload.transforms.presets]
thumb = { w = 300, h = 300 }
hero = { w = 1600, h = 600, format = "webp" }
```

**כתובות חתומות.** כש-`VERDIN_IMAGE_SECRET` מוגדר, `s` הוא ה-HMAC-SHA256 בהקסדצימלי של
`<file>?<canonical query>`, כאשר השאילתה הקנונית מפרטת את הפרמטרים שאינם ברירת מחדל ממוינים
לפי שם (`fit`, `format`, `h`, `q`, `w`; `fit=cover` מושמט):

```js
import { createHmac } from 'node:crypto';
const s = createHmac('sha256', process.env.VERDIN_IMAGE_SECRET)
  .update('photo_1a2b.jpg?format=webp&w=800')
  .digest('hex');
const url = `/uploads/photo_1a2b.jpg?format=webp&w=800&s=${s}`;
```

### ספק S3

כל שירות תואם S3 (AWS, Cloudflare R2, MinIO, Backblaze B2…). פרטי הגישה מגיעים ממשתני הסביבה
הסטנדרטיים `AWS_*` (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `bucket` | חובה | שם ה-bucket. |
| `region` | לא מוגדר | האזור של ה-bucket. |
| `endpoint` | לא מוגדר | נקודת קצה מותאמת לשירותים שאינם AWS, למשל `https://<account>.r2.cloudflarestorage.com`. |
| `public_url` | חובה | כתובת הבסיס הציבורית של ה-bucket או של ה-CDN שלו; הקבצים מקושרים כ-`{public_url}/{key}`. |
| `prefix` | `""` | קידומת המפתחות בתוך ה-bucket. |
| `path_style` | `false` | בקשות בסגנון נתיב (MinIO ורוב השירותים שמתארחים עצמאית). |

```toml
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

## `[webhooks]`

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `allow_private_networks` | לא מוגדר | התרת כתובות webhook על loopback, כתובות פרטיות ו-link-local; חל גם על יעדי פריסה ועל ה-webhook של `[cdn]`. לא מוגדר פירושו לא ב-`verdin start` (אחרת מנהל היה יכול להגיע לשירותים פנימיים) וכן ב-`verdin dev`. |
| `timeout_secs` | `10` | מגבלת הזמן של כל שליחה. |
| `retention_days` | `30` | ימים שבהם יומן השליחות נשמר. |

ראו [Webhooks](/he/guides/integrations/webhooks/).

## `[history]`

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `max_versions` | `50` | הגרסאות שנשמרות לכל מסמך (ישנות יותר מוסרות). |

## `[email]`

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `provider` | `"log"` | `log` (כתיבת הודעות דוא"ל ליומן), `smtp`, `resend` או `postmark`. |
| `from` | `"Verdin <no-reply@localhost>"` | השולח. |
| `reply_to` | לא מוגדר | כתובת לתשובה. |

### `[email.smtp]`

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `host` | `"localhost"` | שרת SMTP. |
| `port` | `587` | פורט SMTP. |
| `username` | לא מוגדר | משתמש SMTP; הסיסמה מגיעה מ-`VERDIN_EMAIL_SMTP_PASSWORD`. |
| `security` | `"starttls"` | `starttls`, `tls` (מרומז, בדרך כלל פורט 465) או `none` (ממסרים מקומיים). |

## `[plugins]`

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `path` | `"plugins"` | תיקיית התוספים (תת-תיקייה לכל אחד), יחסית לקובץ התצורה. |
| `run_jobs` | `true` | הרצת המשימות המתוזמנות של התוספים במופע הזה (מופע אחד כשיש כמה). |

ראו [תוספים](/he/extending/plugins/).

## `[audit]`

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `retention_days` | `90` | ימים שבהם רשומות יומן הביקורת נשמרות. |

## `[digest]`

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `enabled` | `true` | שליחת התקציר היומי מהמופע הזה (מופע אחד כשיש כמה). |
| `hour_utc` | `8` | השעה (UTC, ‏0–23) שבה יוצא התקציר היומי של שינויים שלא נצפו. |

## `[log]`

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `format` | `"pretty"` | `pretty` או `json`. |
| `level` | לא מוגדר (`info`) | מסנן ברירת המחדל; `RUST_LOG` גובר כשהוא מוגדר. |

## `[metrics]`

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `enabled` | `false` | הגשת מדדי Prometheus ב-`/_metrics`: בקשות HTTP לפי תחום (`api`, `admin_api`, `graphql`, `mcp`, `uploads`…), שיטה ומחלקת סטטוס עם היסטוגרמות של זמני תגובה, שליחות webhook ממתינות, זרמי זמן אמת פתוחים וזמן פעולה. |
| `token` | לא מוגדר | איסוף דורש `Authorization: Bearer <token>`. `VERDIN_METRICS_TOKEN` גובר עליו. בלי אסימון, כל מי שמגיע לפורט יכול לקרוא את המדדים. |

## `[ai]`

פעולות AI בפאנל הניהול (כשהתכונה **AI** פעילה ב-הגדרות ← תכונות): תרגום רשומה לשפה אחרת,
כתיבת טקסט חלופי לתמונות, סיכום טקסט, הצעת מטא-נתונים של SEO. הן מחזירות הצעות; שום דבר לא
נשמר בלי העורך. המפתח נקרא מ-`VERDIN_AI_KEY` (שרתים מקומיים לא צריכים).

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `provider` | `"none"` | `anthropic`, `openai` או `openai-compatible` (Ollama, LM Studio, vLLM…). |
| `model` | `claude-sonnet-5` עבור `anthropic` | המודל; חובה עבור הספקים האחרים. |
| `base_url` | של הספק | נקודת קצה אחרת, למשל `http://localhost:11434/v1`. |
| `max_tokens` | `2048` | התשובה הארוכה ביותר. |

```toml
[ai]
provider = "anthropic"
```

כל מנהל רשאי לבצע 30 בקשות AI בדקה. תוכן ותמונות נשלחים לספק: בחרו ספק שהארגון שלכם מתיר.

## `[cdn]`

מנקה מטמונים של CDN כשתוכן משתנה באופן ציבורי. תגובות של API התוכן מתויגות `vd`
ו-`vd-<singularName>` (כותרות `Cache-Tag` ו-`Surrogate-Key`).

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `provider` | `"none"` | `cloudflare`, `fastly` או `webhook`. |
| `zone_id` | לא מוגדר | ה-zone של Cloudflare (ניקוי לפי תגית). |
| `service_id` | לא מוגדר | השירות של Fastly (ניקוי לפי surrogate key). |
| `url` | לא מוגדר | `webhook`: מקבל `POST { "tags": [...] }`. |
| `debounce_ms` | `1000` | שינויים שמקובצים לפני הניקוי. |

אסימון ה-API נקרא מ-`VERDIN_CDN_TOKEN` (ונשלח כ-bearer token ל-webhooks).

## `[search]`

| מפתח | ברירת מחדל | תיאור |
| --- | --- | --- |
| `enabled` | `false` | דירוג `_q` עם אינדקס טקסט מלא (Tantivy) במקום `$containsi`. |
| `dir` | `"data/search"` | תיקיית האינדקס, יחסית לפרויקט. מחיקה שלה בונה מחדש את האינדקס בהפעלה הבאה. |
| `memory_mb` | `50` | תקציב הזיכרון לאינדוקס. |

האינדקס נמצא בדיסק של המופע ועוקב אחרי הכתיבות של אותו מופע: עם כמה מופעים, השאירו את החיפוש
באחד (או בנו מחדש אחרי פריסה).

## משתני סביבה

מלבד דריסות ה-`VERDIN_<SECTION>__<KEY>`, Verdin קורא את המשתנים האלה:

| משתנה | תיאור |
| --- | --- |
| `VERDIN_CONFIG` | הנתיב של קובץ התצורה (כמו `--config`). |
| `VERDIN_DATABASE_URL` | קיצור של `database.url`. |
| `VERDIN_ADMIN_JWT_SECRET` | חותם על אסימוני סשן של ניהול. חובה, לפחות 32 בייטים; צרו אותו עם `verdin secrets`. |
| `VERDIN_TOKEN_PEPPER` | hash עם מפתח לאסימונים שמורים. חובה, לפחות 32 בייטים; צרו אותו עם `verdin secrets`. |
| `VERDIN_ADMIN_PASSWORD` | הסיסמה עבור `verdin admin create` ו-`verdin admin reset-password` (אחרת נקראת מ-stdin); ראו את [תיעוד שורת הפקודה](/he/reference/cli/). |
| `VERDIN_EMAIL_SMTP_PASSWORD` | סיסמת SMTP. |
| `VERDIN_EMAIL_API_KEY` | מפתח ה-API של הספקים Resend ו-Postmark. |
| `VERDIN_SSO_<ID>_SECRET` | סוד הלקוח של ספק SSO; `<ID>` הוא מזהה הספק באותיות גדולות עם `-` כ-`_` (ראו [כניסה יחידה (SSO)](/he/guides/auth/sso/)). |
| `VERDIN_OAUTH_<PROVIDER>_SECRET` | סוד הלקוח של ספק OAuth למשתמשי קצה, בשם כמו אלה של SSO (ראו [משתמשי קצה](/he/guides/auth/end-users/)). |
| `VERDIN_AI_KEY` | מפתח ה-API של ספק ה-`[ai]`. |
| `VERDIN_CDN_TOKEN` | אסימון ה-API של ספק ה-`[cdn]`. |
| `VERDIN_IMAGE_SECRET` | חותם על כתובות של המרות תמונות (ראו [`[upload.transforms]`](#uploadtransforms)). |
| `VERDIN_METRICS_TOKEN` | Bearer token לאיסוף `/_metrics` כש-`[metrics].enabled`; גובר על `[metrics].token`. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | פרטי הגישה של ספק ההעלאות S3. |
| `RUST_LOG` | מסנן היומן; גובר על `[log].level`. |
