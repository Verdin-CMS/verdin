---
title: שרת Linux
description: הריצו את Verdin על שרת Debian או Ubuntu מחבילת ה-.deb — שירות systemd, משתמש מערכת verdin, מצב ב-/var/lib/verdin — מאחורי reverse proxy.
sidebar:
  order: 3
---

העמוד הזה מריץ את Verdin ישירות על שרת Debian או Ubuntu, בלי קונטיינרים, מחבילת ה-`.deb`
שמצורפת לכל גרסה. אותו מבנה עובד בהפצות אחרות עם הקובץ הבינארי מ[סקריפט
ההתקנה](/he/start/installation/) והקבצים שתחת
[`deploy/deb/`](https://github.com/verdin-cms/verdin/tree/main/deploy/deb) שמועתקים ידנית.

החבילה נבנתה ונבדקה עם `cargo deb` ב-2026-09-30; היא לא הותקנה על שרת אמיתי עבור המדריך הזה.

## מה החבילה מתקינה

| נתיב | מה |
| --- | --- |
| `/usr/bin/verdin` | הקובץ הבינארי (סטטי, עם פאנל הניהול מובנה). |
| `/etc/verdin/verdin.toml` | התצורה (conffile: שדרוגים שומרים על העריכות שלכם). |
| `/etc/verdin/verdin.env` | נוצר בהתקנה הראשונה, הרשאות `0640`: `VERDIN_ADMIN_JWT_SECRET` ו-`VERDIN_TOKEN_PEPPER` חדשים, ו-`VERDIN_DATABASE_URL` (SQLite כברירת מחדל). |
| `/var/lib/verdin/` | ספריית הבית של משתמש המערכת `verdin`: מסד הנתונים SQLite, `schema/`, `uploads/`, אינדקס החיפוש ומטמון התמונות. |
| `/usr/lib/systemd/system/verdin.service` | השירות, מותקן אבל לא מופעל. |

השירות מריץ `verdin -c /etc/verdin/verdin.toml start --migrate` כמשתמש `verdin`, עם הבידוד של
systemd (מערכת לקריאה בלבד, `/tmp` פרטי, בלי הרשאות חדשות) והרשאת כתיבה רק ל-`/var/lib/verdin`.
הוא מאזין ב-`127.0.0.1:1337`.

## 1. התקנה

```sh frame="terminal"
curl -fsSLO https://github.com/verdin-cms/verdin/releases/download/v0.11.0/verdin_0.11.0-1_amd64.deb
sudo apt install ./verdin_0.11.0-1_amd64.deb
```

בשרתי ARM השתמשו ב-`arm64` בשם הקובץ.

## 2. הגדרה

1. העתיקו את הסכמה שעשיתם לה commit אל `/var/lib/verdin/schema/` (`content-types/` ו-
   `components/`), בבעלות `verdin`:

   ```sh frame="terminal"
   sudo rsync -a --chown=verdin:verdin schema/ /var/lib/verdin/schema/
   ```

2. עבור PostgreSQL, MySQL או MariaDB, ערכו את `VERDIN_DATABASE_URL` ב-
   `/etc/verdin/verdin.env`. שמרו את שני הסודות: `VERDIN_TOKEN_PEPPER` חדש מבטל כל אסימון API.
3. ב-`/etc/verdin/verdin.toml`, הגדירו את `[server].public_url` לכתובת שהדפדפנים משתמשים בה,
   ו-`trusted_proxies = ["127.0.0.1"]` כש-reverse proxy רץ על אותה מכונה. כל שאר המפתחות
   ב[תיעוד התצורה](/he/reference/configuration/).

## 3. הפעלה

```sh frame="terminal"
sudo systemctl enable --now verdin
journalctl -u verdin -f
```

ההפעלה הראשונה יוצרת את הטבלאות. צרו את המנהל הראשון משורת הפקודה (קובץ הסביבה של השירות
מחזיק את כתובת מסד הנתונים):

```sh frame="terminal"
sudo -u verdin sh -c 'set -a; . /etc/verdin/verdin.env; verdin -c /etc/verdin/verdin.toml admin create --email you@example.com'
```

או פתחו את פאנל הניהול דרך ה-proxy שלכם ורשמו שם.

## 4. שימת reverse proxy לפני השרת

Verdin מגיש HTTP רגיל בממשק ה-loopback. עם Caddy, שמשיג ומחדש את התעודה בעצמו:

```text title="/etc/caddy/Caddyfile"
cms.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:1337
}
```

nginx עובד גם כן; כבו חציצה (buffering) עבור `/api/_events` כדי שאירועי זמן אמת לא יעוכבו
(`proxy_buffering off;`).

## שדרוגים והסרה

- **שדרוג:** התקינו את ה-`.deb` של הגרסה הבאה עם `apt install ./verdin_….deb`. השירות
  מופעל מחדש אם רץ, ו-`start --migrate` מחיל הגירות בטוחות. קראו קודם את
  [שדרוג](/he/migrate/upgrading/).
- **הסרה:** `apt remove verdin` עוצר את השירות ושומר את הנתונים ואת התצורה; `apt purge verdin`
  מוחק גם את `/etc/verdin/verdin.env` (הסודות). המשתמש `verdin` ו-`/var/lib/verdin` אף פעם
  לא נמחקים על ידי החבילה: הסירו אותם בעצמכם אחרי שיש לכם [גיבוי](/he/deploy/backups/).
