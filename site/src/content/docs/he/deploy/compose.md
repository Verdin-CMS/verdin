---
title: Docker Compose בייצור
description: מתכון Compose לייצור עבור שרת אחד — Verdin, PostgreSQL ו-Caddy עם HTTPS אוטומטי, ו-RustFS אופציונלי עבור מדיה תואמת S3.
sidebar:
  order: 3
---

[`deploy/compose/`](https://github.com/verdin-cms/verdin/tree/main/deploy/compose) היא התקנה
מוכנה לשרת אחד: Verdin ו-PostgreSQL ברשת פרטית, ו-Caddy לפניהם עם תעודה שהוא משיג ומחדש
בעצמו. קובץ override מוסיף את RustFS, מאגר תואם S3 באותו מארח, עבור מדיה.
[Docker](/he/deploy/docker/) מסביר את האימג' שהקבצים האלה משתמשים בו.

הקבצים נבדקו עם `docker compose config` ועם `caddy validate` ב-2026-09-30.

## קבצים

| קובץ | מה |
| --- | --- |
| `compose.yaml` | `verdin`, `db` (PostgreSQL 17) ו-`caddy`. רק Caddy מפרסם פורטים (80, 443 ו-443/udp עבור HTTP/3). |
| `compose.s3.yaml` | מוסיף את `rustfs` ומשימה חד-פעמית שיוצרת את ה-bucket בשם `media` עם קריאה ציבורית, ומעביר אליו את ספק ההעלאות של Verdin. |
| `Caddyfile` | TLS עבור `$VERDIN_DOMAIN`, דחיסה, `/media/*` אל RustFS וכל השאר אל Verdin. |
| `.env.example` | המשתנים ש-Compose קורא: דומיין, דוא"ל ACME, תגית האימג', סיסמאות. |

## הקמה

דרישות מוקדמות: שרת עם Docker, רשומת DNS לדומיין שלכם שמצביעה אליו, ופורטים 80 ו-443
פתוחים.

1. העתיקו את התיקייה לשרת ומלאו את `.env`:

   ```sh frame="terminal"
   cp .env.example .env                                  # VERDIN_DOMAIN, ACME_EMAIL
   echo "DB_PASSWORD=$(openssl rand -hex 24)" >> .env
   docker run --rm ghcr.io/verdin-cms/verdin:0.11 secrets > verdin.env
   ```

2. שימו את הסכמה שעשיתם לה commit ב-`schema/` (`content-types/` ו-`components/`). היא
   מחוברת לקריאה בלבד ב-`/app/schema`.
3. הפעילו:

   ```sh frame="terminal"
   docker compose up -d
   docker compose logs -f verdin
   ```

4. פתחו את `https://<your domain>/admin/` ורשמו את המנהל הראשון.

שמרו את `.env` ואת `verdin.env` מחוץ לבקרת גרסאות, וגבו אותם: `VERDIN_TOKEN_PEPPER` חדש
מבטל כל אסימון API.

## מדיה ב-S3

כברירת מחדל ההעלאות הולכות ל-volume בשם `verdin-data`. כדי לשמור אותן ב-RustFS במקום:

```sh frame="terminal"
echo "S3_SECRET_KEY=$(openssl rand -hex 24)" >> .env
docker compose -f compose.yaml -f compose.s3.yaml up -d
```

הקבצים מוגשים אז על ידי Caddy ב-`https://<your domain>/media/<key>`. עבור AWS S3,
Cloudflare R2 או ספק אחר, השמיטו את שירותי RustFS והגדירו את המשתנים
`VERDIN_UPLOAD__PROVIDER__*` ואת פרטי הגישה `AWS_*` לערכים של אותו ספק (ראו
[אחסון](/he/internals/storage/)). מעבר באתר קיים לא מעביר קבצים: העלאות חדשות הולכות לספק
החדש.

## הערות

- **כתובות לקוחות.** Verdin סומך על `X-Forwarded-For` מרשת Compose (`172.30.0.0/24`, קבועה
  ב-`compose.yaml`), שבה Caddy הוא ה-proxy היחיד. שנו את שניהם אם הטווח הזה מתנגש באחת
  הרשתות שלכם.
- **זמן אמת.** Caddy מזרים תגובות `text/event-stream` בלי חציצה (buffering), כך ש[אירועי
  זמן אמת](/he/guides/frontend/realtime/) עובדים מאחוריו ללא שינוי.
- **שדרוגים.** שנו את `VERDIN_VERSION` ב-`.env`, ואז `docker compose pull && docker compose up -d`.
  קראו קודם את [שדרוג](/he/migrate/upgrading/).
- **גיבויים.** בצעו dump של PostgreSQL ושמרו את ה-volume בשם `verdin-data` (או את ה-bucket);
  ראו [גיבויים](/he/deploy/backups/).
- **פקודות ניהול.** באימג' אין shell: `docker compose exec verdin verdin admin create --email you@example.com`.
