---
title: "מדיה"
description: "ספריית המדיה, שדות מדיה, פורמטים של תמונות, ספקי אחסון (מקומי או S3) ותיקיות, ואיך קבצים מקושרים לתוכן."
sidebar:
  order: 8
---

ספריית המדיה מחזיקה את התמונות, הסרטונים, קובצי השמע ושאר הקבצים שהתוכן שלכם משתמש בהם.
העמוד הזה מסביר איך קבצים נשמרים, מתוארים ומקושרים למסמכים. להגשת תמונות בגדלים שונים
באתר שלכם, ראו [תמונות](/he/guides/frontend/images/).

## קבצים

כל העלאה היא רשומת קובץ במבנה של Strapi, כך שפרונטאנדים שנכתבו עבור Strapi קוראים אותה בלי
שינוי (`formats` מקוצר):

```json
{
  "id": 5,
  "documentId": "v3k…",
  "name": "harbour.jpg",
  "alternativeText": "Boats in the harbour at dawn",
  "caption": null,
  "width": 2400,
  "height": 1600,
  "focalPoint": { "x": 0.4, "y": 0.6 },
  "formats": {
    "thumbnail": { "url": "/uploads/harbour_thumbnail_4f1c.jpg", "width": 234, "height": 156 },
    "large": { "url": "/uploads/harbour_large_4f1c.jpg", "width": 1000, "height": 667 }
  },
  "hash": "harbour_4f1c",
  "ext": ".jpg",
  "mime": "image/jpeg",
  "size": 812.4,
  "url": "/uploads/harbour_4f1c.jpg",
  "previewUrl": null,
  "provider": "local",
  "provider_metadata": null,
  "createdAt": "2026-09-25T09:00:00.000Z",
  "updatedAt": "2026-09-25T09:00:00.000Z",
  "publishedAt": "2026-09-25T09:00:00.000Z"
}
```

- `size` הוא בקילובייטים, כמו ב-Strapi.
- סוג ה-MIME נקבע לפי הבייטים של הקובץ, אף פעם לא לפי מה שהלקוח טוען.
- `focalPoint` מסמן את החלק בתמונה שצריך להישאר בתמונה כשהיא נחתכת.

לקבצים אין טיוטה: העלאה זמינה ברגע שהיא נשמרת.

## ספריית המדיה

בפאנל הניהול, **ספריית המדיה** מציגה את הקבצים עם חיפוש, סינון לפי סוג ותיקיות. מנהלים
מעלים קבצים, מייבאים אותם מכתובת URL, עורכים את השם, הטקסט החלופי, הכיתוב ונקודת המוקד
שלהם, מחליפים את התוכן של קובץ תוך שמירה על המזהה שלו, ורואים **היכן הוא בשימוש**: שדות
מדיה, מדיה בתוך רכיבים, בלוקים של טקסט עשיר ו-Markdown שמכיל את כתובת ה-URL שלו.

**תיקיות** מארגנות את הספרייה עבור העורכים. אובייקטי הקבצים בתגובות ה-API לא מציגים אותן,
אבל העלאה דרך API התוכן יכולה לציין מזהה תיקייה ב-`fileInfo` שלה. מחיקת תיקייה מוחקת את
הקבצים שבה.

הגישה של מנהלים נשלטת על ידי ההרשאות `media.read`, `media.create`, `media.update`
ו-`media.delete`. התפקיד המובנה Author רשאי לערוך ולמחוק רק את הקבצים שהוא העלה. ראו
[הרשאות](/he/concepts/permissions/).

## שדות מדיה

סוג תוכן מקשר קבצים דרך מאפיין `media`:

```json
"cover": { "type": "media", "allowedTypes": ["images"] },
"gallery": { "type": "media", "multiple": true, "allowedTypes": ["images", "videos"] }
```

| אפשרות | ברירת מחדל | תיאור |
| --- | --- | --- |
| `multiple` | `false` | מחזיק רשימה של קבצים במקום קובץ אחד. |
| `allowedTypes` | כל קובץ | כל אחד מ-`images`, `videos`, `audios` ו-`files` (כל השאר), שנבדק בכל כתיבה מול סוג ה-MIME השמור. |

שדות מדיה מתנהגים כמו קשרים: לכל גרסה של מסמך יש קישורים משלה, הפרסום מעתיק אותם,
ו-`required` נבדק בזמן הפרסום. הם נשמרים בטבלת קישור לכל שדה. בתוך
[רכיבים](/he/concepts/components-and-dynamic-zones/), ה-JSON של הרכיב שומר במקום זאת את
מזהי הקבצים.

בכתיבות, שלחו מזהי קבצים: `5`, `{ "id": 5 }`, `[5, 6]`, או `null` כדי לנקות את השדה.
בקריאות, שדות מדיה מוחזרים רק כשהם עוברים populate (`populate=cover`), כאובייקטי קבצים.
מחיקת קובץ מסירה אותו מכל מסמך שהשתמש בו.

## פורמטים של תמונות

כשמעלים תמונת raster, Verdin מייצר את הפורמטים של Strapi בפורמט של התמונה עצמה, תוך כיבוד
כיוון ה-EXIF שלה:

| פורמט | גודל |
| --- | --- |
| `thumbnail` | נכנס בתוך 245 × 156 |
| `large` | ברוחב 1000 px |
| `medium` | ברוחב 750 px |
| `small` | ברוחב 500 px |

פורמט מדולג כשהמקור לא גדול ממנו. `[upload].breakpoints` משנה את הרוחבים והשמות,
ו-`responsive_formats = false` מכבה אותם. `max_original_size` מקטין מקורות גדולים בזמן
ההעלאה, מה שגם מסיר את המטא-נתונים שלהם (EXIF, GPS). `max_image_megapixels` (100 כברירת
מחדל) דוחה תמונות שהפענוח שלהן היה דורש יותר מדי זיכרון. עם הספק המקומי, `/uploads` יכול גם
לשנות גודל ולהמיר תמונות לפי בקשה; ראו [תמונות](/he/guides/frontend/images/).

## ספקי אחסון

הקבצים נשמרים על ידי ספק, שמוגדר ב-`[upload].provider`:

| ספק | שומר קבצים | מגיש אותם |
| --- | --- | --- |
| `local` (ברירת מחדל) | ב-`public/uploads` (האפשרות `dir`), יחסית לפרויקט | ב-`/uploads` בשרת Verdin |
| `s3` | בכל bucket תואם S3: AWS S3, Cloudflare R2, Backblaze B2, MinIO, RustFS… | מה-`public_url` של ה-bucket או של ה-CDN |

```toml title="verdin.toml"
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

פרטי הגישה ל-S3 מגיעים ממשתני הסביבה הסטנדרטיים `AWS_*`, אף פעם לא מ-`verdin.toml`. כל
האפשרויות נמצאות ב[תיעוד התצורה](/he/reference/configuration/).

השמות השמורים הם `{slug}_{random}{ext}` ולעולם לא משתנים, כך שאפשר לשמור את כתובות ה-URL
במטמון לנצח. עם כמה מופעי Verdin, השתמשו ב-S3: קבצים מקומיים קיימים רק במופע שקיבל אותם.

## בטיחות

- העלאות מוזרמות לקבצים זמניים, אף פעם לא מוחזקות בזיכרון, ומוגבלות על ידי
  `[upload].max_file_size` (200 MB כברירת מחדל), עם לכל היותר 20 קבצים לבקשה.
- קבצים שמוגשים מ-`/uploads` נושאים `Content-Security-Policy: sandbox` ו-
  `X-Content-Type-Options: nosniff`. כל מה שאינו תמונה, סרטון, שמע, PDF או טקסט פשוט נשלח
  כהורדה, כך שקובץ HTML או SVG שהועלה לא יכול להריץ סקריפטים בדומיין שלכם. אובייקטים מסוגים
  כאלה נשמרים כהורדות גם ב-S3.

## מדיה דרך API התוכן

ל-API התוכן יש את נתיבי ההעלאה של Strapi, שנבדקים מול ההרשאות על **ספריית המדיה**
(`plugin::upload`):

| נתיב | הרשאה |
| --- | --- |
| `POST /api/upload` (multipart `files`, `fileInfo` אופציונלי) | `create` |
| `POST /api/upload?id={id}` (`fileInfo` חדש, ואופציונלית קובץ חדש) | `update` |
| `GET /api/upload/files` | `find` |
| `GET /api/upload/files/{id}` | `findOne` |
| `DELETE /api/upload/files/{id}` | `delete` |

כמו ב-Strapi, הם עונים באובייקטי קבצים ובמערכים פשוטים, בלי מעטפת ה-`data`. ראו
[REST API](/he/api/rest/#ספריית-המדיה). שינויים שולחים אירועי
[webhook](/he/api/webhooks/) ו[זמן אמת](/he/api/realtime/) `media.create`, `media.update`
ו-`media.delete`.
