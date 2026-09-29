---
title: Railway
description: פרסו את Verdin ב-Railway מה-Dockerfile של המאגר שלכם, עם PostgreSQL של Railway ומדיה באחסון תואם S3 או ב-volume.
sidebar:
  order: 6
---

העמוד הזה פורס פרויקט Verdin ב-[Railway](https://railway.com): שירות שנבנה מ-Dockerfile
קטן במאגר שלכם, מסד נתונים PostgreSQL של Railway, ומדיה באחסון תואם S3 (או ב-volume
למופע יחיד).

:::note
ההגדרות של Railway נבדקו מול [התיעוד של Railway](https://docs.railway.com/reference/config-as-code)
ב-2026-09-29; ההתקנה לא נפרסה על חשבון Railway אמיתי. ערכים שמסומנים `# yours` או
שבסוגריים משולשים הם שלכם למלא.
:::

## 1. הוסיפו Dockerfile, תצורה ו-`railway.json`

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337

[schema]
path = "schema"

[log]
format = "json"

[upload]
provider = { name = "s3", bucket = "media", region = "auto",             # yours
             endpoint = "https://<account>.r2.cloudflarestorage.com",    # yours
             public_url = "https://media.example.com" }                  # yours
```

```json title="railway.json"
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "healthcheckPath": "/_ready",
    "healthcheckTimeout": 120,
    "restartPolicyType": "ON_FAILURE"
  }
}
```

אין צורך בפקודת הפעלה: האימג' מריץ `start --migrate`, שמחיל הגירות בטוחות לפני שהוא מגיש.
השאירו את `.env` מחוץ למאגר.

## 2. צרו את הפרויקט

1. ב-Railway, צרו פרויקט ממאגר ה-GitHub שלכם. Railway מוצא את `railway.json` ובונה את
   ה-Dockerfile.
2. הוסיפו לפרויקט מסד נתונים **PostgreSQL**.
3. ב-**Variables** של שירות ה-Verdin, הוסיפו:

   | משתנה | ערך |
   | --- | --- |
   | `VERDIN_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (הכתובת הפרטית של שירות מסד הנתונים; השתמשו בשם של שירות מסד הנתונים שלכם) |
   | `VERDIN_ADMIN_JWT_SECRET` | מ-`verdin secrets` |
   | `VERDIN_TOKEN_PEPPER` | מ-`verdin secrets` |
   | `VERDIN_SERVER__PUBLIC_URL` | `https://<your-domain>` |
   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | פרטי הגישה שלכם ל-S3 |

   צרו את שני הסודות מקומית:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets
   ```

4. בהגדרות הרשת של השירות, לחצו **Generate Domain** והגדירו את פורט היעד שלו ל-`1337`.
   Verdin מאזין ב-`[server].port` ולא קורא את המשתנה `PORT` של Railway.
5. פרסו, פתחו את `https://<your-domain>/admin/` ורשמו את המנהל הראשון.

## גרסה: מדיה או SQLite על volume

למופע יחיד אפשר לשמור את ההעלאות, ואפילו את מסד הנתונים, על volume של Railway שמחובר
ב-`/data`:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

עם `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` אם אתם מוותרים על PostgreSQL. זכרו:

- לשירות עם volume לא יכולות להיות רפליקות, ולכל פריסה מחדש יש השבתה קצרה.
- Railway מחבר volumes בבעלות root, והאימג' רץ כ-uid `65532`. הגדירו את משתנה השירות
  `RAILWAY_RUN_UID=0` כדי שהשרת יוכל לכתוב ל-volume.

## כתובות לקוח

ה-proxy בקצה של Railway יושב לפני השירות. טווח הכתובות שלו לא אומת עבור המדריך הזה, ולכן
`[server].trusted_proxies` נשאר ריק: אז כל מבקר נספר כאותה כתובת להגבלת קצב, לכן השאירו את
`[api].public_rate_limit` על `0` אלא אם תמצאו את הטווח של ה-proxy ותסמכו עליו.
