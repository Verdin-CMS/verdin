---
title: Fly.io
description: פרסו את Verdin ב-Fly.io עם אימג' משלכם, PostgreSQL ואחסון האובייקטים Tigris, או Machine יחיד עם SQLite על volume.
sidebar:
  order: 4
---

העמוד הזה פורס פרויקט Verdin ב-[Fly.io](https://fly.io) כאימג' קטן שנבנה מעל האימג'
הרשמי. ההתקנה המומלצת לא שומרת מצב על ה-Machine: PostgreSQL למסד הנתונים ו-Tigris
(האחסון התואם S3 של Fly) למדיה. אחריה מופיעה גרסה עם SQLite על volume.

:::note
הפורמטים של Fly נבדקו מול [התיעוד של Fly](https://docs.fly.io/reference/configuration/)
ב-2026-09-29; ההתקנה לא הורצה על חשבון Fly אמיתי. ערכים בסוגריים משולשים ואלה שמסומנים
`# yours` הם שלכם למלא.
:::

דרישות מקדימות: [`flyctl`](https://docs.fly.io/flyctl/install/) מחובר, ופרויקט Verdin
שתיקיית ה-`schema/` שלו נמצאת ב-commit.

## 1. הוסיפו Dockerfile ותצורה

בתיקיית הפרויקט, הוסיפו `Dockerfile` שמעתיק את התצורה והסכמה שלכם לתוך האימג' הרשמי (ראו
[אימג' משלכם](/he/deploy/docker/)):

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

ו-`verdin.toml` עבור Fly:

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337
public_url = "https://my-verdin.fly.dev"       # yours: the app's URL or your domain

[schema]
path = "schema"

[log]
format = "json"

[upload]
provider = { name = "s3", bucket = "my-verdin-media",   # yours: the bucket name
             region = "auto", endpoint = "https://t3.storage.dev",
             public_url = "https://my-verdin-media.t3.tigrisfiles.io" }
```

ודאו ש-`.env` נשאר מחוץ להקשר הבנייה: הוסיפו אותו ל-`.dockerignore`.

## 2. כתבו `fly.toml`

```toml title="fly.toml"
app = "my-verdin"                # yours
primary_region = "fra"           # yours

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 1337
  force_https = true
  # Keep a Machine running: webhooks, scheduled releases, plugin jobs and the
  # daily digest run inside the server process.
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "30s"
    interval = "15s"
    method = "GET"
    timeout = "5s"
    path = "/_ready"

[[vm]]
  memory = "512mb"               # adjust to your content and traffic
```

פקודת ברירת המחדל של האימג', `start --migrate`, מחילה הגירות בטוחות כשכל Machine עולה, כך
שאין צורך ב-`release_command`. (Fly מריץ את `release_command` ב-Machine זמני בלי volumes,
מה שבכל מקרה לא היה עובד עם SQLite.)

## 3. צרו את האפליקציה, מסד הנתונים וה-bucket

1. צרו את האפליקציה בלי לפרוס אותה. `--ha=false` מתחיל עם Machine אחד; קראו את
   [הרצת כמה מופעים](/he/deploy/scaling/) לפני שאתם מוסיפים עוד.

   ```sh frame="terminal"
   fly launch --no-deploy --copy-config --ha=false
   ```

2. צרו מסד נתונים PostgreSQL, למשל עם
   [Fly Managed Postgres](https://docs.fly.io/mpg/) או עם כל ספק PostgreSQL, ורשמו את
   כתובת החיבור שלו.

3. צרו bucket ציבורי ב-Tigris. הפקודה מגדירה את `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3` ו-`BUCKET_NAME` כסודות של האפליקציה;
   Verdin קורא את שני הראשונים. שימו את שם ה-bucket ב-`verdin.toml`.

   ```sh frame="terminal"
   fly storage create --public
   ```

4. הגדירו את הסודות של Verdin ואת כתובת מסד הנתונים:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets | fly secrets import
   fly secrets set VERDIN_DATABASE_URL='postgres://<user>:<password>@<host>:5432/<db>?sslmode=require'
   ```

5. פרסו, ואז פתחו את `https://<app>.fly.dev/admin/` ורשמו את המנהל הראשון:

   ```sh frame="terminal"
   fly deploy
   ```

## כתובות לקוח והגבלת קצב

ה-proxy של Fly מוסיף את הלקוח ל-`X-Forwarded-For`, ולפי
[התיעוד של Fly על כותרות הבקשה](https://docs.fly.io/networking/request-headers/)
הכתובת הימנית ביותר היא ה-IP של האפליקציה שלכם עצמה. כדי ש-Verdin ימצא את הלקוח, סמכו על
הטווח של ה-proxy ועל הכתובות של האפליקציה שלכם (`fly ips list`):

```toml title="verdin.toml"
[server]
trusted_proxies = ["172.16.0.0/12", "<app IPv4>", "<app IPv6>"]
```

זה לא אומת על אפליקציה רצה. עד שבדקתם, השאירו את `[api].public_rate_limit` על `0`: בלי
ה-proxies הנכונים, כל מבקר נספר כאותה כתובת.

## גרסה: Machine אחד עם SQLite

לפרויקט קטן אפשר במקום זאת לשמור את מסד הנתונים ואת ההעלאות על volume של Fly.

- ב-`verdin.toml`, הגדירו `provider = { name = "local", dir = "/data/uploads" }` תחת
  `[upload]` (תיקיית ברירת המחדל יחסית ל-`/app`, שהשרת לא יכול לכתוב אליה), והגדירו את
  `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` כסוד.
- חברו volume ב-`/data`:

  ```toml title="fly.toml"
  [mounts]
    source = "verdin_data"
    destination = "/data"
    initial_size = "1gb"
  ```

- הריצו בדיוק Machine אחד (`fly scale count 1`). volume מתחבר ל-Machine אחד, ואי אפשר
  לשתף SQLite.
- Fly יוצר volumes בבעלות root, והאימג' רץ כ-uid `65532`. אם ההפעלה נכשלת עם שגיאת הרשאה
  על `/data`, הוסיפו `USER root` ל-`Dockerfile` שלכם.

גבו את ה-volume: Fly שומר תמונות מצב יומיות של volumes, ו-`verdin export` נותן לכם ארכיון
נייד (ראו [גיבויים](/he/deploy/backups/)).
