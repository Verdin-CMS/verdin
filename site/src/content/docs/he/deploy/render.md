---
title: Render
description: פרסו את Verdin ב-Render עם Blueprint — שירות web של Docker שנבנה מהמאגר שלכם, מסד נתונים PostgreSQL של Render, ומדיה באחסון תואם S3 או בדיסק.
sidebar:
  order: 5
---

העמוד הזה פורס פרויקט Verdin ב-[Render](https://render.com) עם Blueprint
(`render.yaml`): שירות web שנבנה מ-Dockerfile קטן במאגר שלכם, ומסד נתונים PostgreSQL של
Render. מערכת הקבצים של Render זמנית, ולכן המדיה הולכת לאחסון תואם S3, או לדיסק קבוע אם
אתם מריצים מופע אחד.

:::note
פורמט ה-Blueprint נבדק מול [תיעוד ה-Blueprint של Render](https://render.com/docs/blueprint-spec)
ב-2026-09-29; הוא לא נפרס על חשבון Render אמיתי. ערכים שמסומנים `# yours` הם שלכם למלא.
:::

דרישות מקדימות: פרויקט ה-Verdin שלכם (עם `schema/`) במאגר Git ש-Render יכול לקרוא.

## 1. הוסיפו Dockerfile ותצורה

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
# Cloudflare R2 as an example; any S3-compatible service works.
provider = { name = "s3", bucket = "media", region = "auto",             # yours
             endpoint = "https://<account>.r2.cloudflarestorage.com",    # yours
             public_url = "https://media.example.com" }                  # yours
```

השאירו את `.env` מחוץ למאגר ומחוץ לאימג' (`.dockerignore`).

## 2. כתבו `render.yaml`

```yaml title="render.yaml"
services:
  - type: web
    name: verdin
    runtime: docker
    repo: https://github.com/<you>/<your-project>   # yours
    branch: main
    dockerfilePath: ./Dockerfile
    region: frankfurt                               # yours
    healthCheckPath: /_ready
    envVars:
      - key: VERDIN_DATABASE_URL
        fromDatabase:
          name: verdin-db
          property: connectionString
      - key: VERDIN_ADMIN_JWT_SECRET
        generateValue: true
      - key: VERDIN_TOKEN_PEPPER
        generateValue: true
      - key: VERDIN_SERVER__PUBLIC_URL
        value: https://verdin.onrender.com          # yours: the service URL or your domain
      - key: AWS_ACCESS_KEY_ID
        sync: false                                 # asked for when you create the Blueprint
      - key: AWS_SECRET_ACCESS_KEY
        sync: false

databases:
  - name: verdin-db
    databaseName: verdin
    user: verdin
    region: frankfurt                               # yours: the same region
    postgresMajorVersion: "17"
```

הוסיפו `plan` לשירות ולמסד הנתונים כדי לבחור סוג מופע (ראו את דף התמחור של Render); בלעדיו,
Render משתמש בברירת המחדל שלו.

`generateValue: true` יוצר כל סוד פעם אחת, כשה-Blueprint מוחל לראשונה, ושומר עליו אחר כך.
אל תיצרו אותם מחדש: `VERDIN_TOKEN_PEPPER` חדש גורם לכל אסימוני ה-API להפסיק לעבוד.

## 3. פריסה

1. בלוח הבקרה של Render, צרו **Blueprint** מהמאגר והזינו את הערכים עבור המשתנים עם
   `sync: false`.
2. חכו לפריסה הראשונה. פקודת ברירת המחדל של האימג', `start --migrate`, יוצרת את הטבלאות
   בהפעלה הראשונה ומחילה הגירות בטוחות בפריסות הבאות.
3. פתחו את `https://<service>.onrender.com/admin/` ורשמו את המנהל הראשון.

Render שולח `SIGTERM` לפני שהוא עוצר מופע; Verdin מסיים ויוצא כשהוא מקבל אותו.

## גרסה: מדיה על דיסק

למופע יחיד אפשר לאחסן את ההעלאות על דיסק קבוע של Render במקום ב-S3. הגדירו את הספק המקומי
ב-`verdin.toml`:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

והוסיפו דיסק לשירות:

```yaml title="render.yaml"
    disk:
      name: verdin-data
      mountPath: /data
      sizeGB: 5
```

עם דיסק, Render לא מאפשר להרחיב את השירות לכמה מופעים, ופריסות עוצרות את המופע הישן לפני
שהחדש עולה, כך שלכל פריסה יש השבתה קצרה. אותו דיסק יכול להחזיק מסד נתונים SQLite
(`sqlite:///data/verdin.db`) אם אתם לא רוצים מסד נתונים של Render. ודאו שהמשתמש של האימג'
(uid `65532`) יכול לכתוב לדיסק; אם ההפעלה נכשלת עם שגיאת הרשאה על `/data`, הוסיפו
`USER root` ל-`Dockerfile` שלכם.

## כתובות לקוח

ה-proxy של Render יושב לפני השירות. טווח הכתובות שלו לא אומת עבור המדריך הזה, ולכן
`[server].trusted_proxies` נשאר ריק: אז כל מבקר נספר כאותה כתובת להגבלת קצב, לכן השאירו את
`[api].public_rate_limit` על `0` אלא אם תמצאו את הטווח של ה-proxy ותסמכו עליו.
