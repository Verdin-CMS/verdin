---
title: ניטור
description: מעקב אחרי מופע Verdin רץ — בדיקות /_health ו-/_ready, מדדי Prometheus ב-/_metrics והאסימון שלהם, פורמט היומנים, רמות ומזהי בקשות.
sidebar:
  order: 10
---

מופע Verdin מדווח על עצמו דרך שתי נקודות קצה של תקינות, מדדי Prometheus אופציונליים
ויומנים מובנים. העמוד הזה מפרט מה כל אחד מהם מחזיר ואיך מפעילים אותו.

## בדיקות תקינות

שתי נקודות הקצה מוגשות בשורש השרת, מחוץ לקידומות ה-API, ולא דורשות אימות.

| נקודת קצה | עונה | מתאימה ל |
| --- | --- | --- |
| `GET /_health` | תמיד `200 {"status":"ok"}` כל עוד התהליך מגיש HTTP. | בדיקת חיוּת (liveness): הפעילו מחדש את התהליך כשהוא מפסיק לענות. |
| `GET /_ready` | `200 {"status":"ready","database":"postgres"}` כשמסד הנתונים עונה ל-ping, `503 {"status":"unavailable"}` כשלא. | בדיקות מוכנות (readiness) ומאזן עומסים: שלחו תעבורה רק למופעים שעונים 200. |

`database` הוא `postgres`, `mysql`, `mariadb` או `sqlite`. `/_ready` לא בודק הגירות:
`verdin start` מסרב לעלות כל עוד יש הגירות ממתינות (אלא אם `--migrate` מחיל אותן), כך
שלשרת רץ אין כאלה.

```sh frame="terminal"
curl -s localhost:1337/_ready
{"status":"ready","database":"sqlite"}
```

## מדדי Prometheus

הפעילו את המדדים והגדירו אסימון:

```toml title="verdin.toml"
[metrics]
enabled = true
```

```sh
VERDIN_METRICS_TOKEN=<a long random string>
```

אז `GET /_metrics` מגיש את פורמט הטקסט של Prometheus (גרסה 0.0.4). עם אסימון
(`VERDIN_METRICS_TOKEN`, שגובר על `[metrics].token`), איסוף בלי
`Authorization: Bearer <token>` מקבל `401`. בלי אסימון, כל מי שמגיע לפורט יכול לקרוא את
המדדים.

```yaml title="prometheus.yml"
scrape_configs:
  - job_name: verdin
    metrics_path: /_metrics
    authorization:
      type: Bearer
      credentials: <the token>
    static_configs:
      - targets: ["verdin:1337"]
```

עם כמה מופעים, אספו מכל אחד: כל מופע סופר את הבקשות שלו.

| מדד | סוג | תוויות | משמעות |
| --- | --- | --- | --- |
| `verdin_http_requests_total` | counter | `area`, `method`, `status` | בקשות HTTP שהוגשו. |
| `verdin_http_request_duration_seconds` | histogram | `area`, `method`, `status` | זמן הגשת הבקשות. דליים מ-5 ms עד 10 s. |
| `verdin_webhook_deliveries_pending` | gauge | | שליחות webhook שממתינות לשליחה. |
| `verdin_realtime_subscribers` | gauge | | זרמי אירועי זמן אמת פתוחים. |
| `verdin_uptime_seconds` | gauge | | שניות מאז שהתהליך עלה. |
| `verdin_build_info` | gauge | `version` | תמיד 1; הגרסה הרצה. |

`area` הוא החלק של השרת: `api` (API התוכן), `admin_api`, `admin` (הקבצים של הפאנל),
`graphql`, `mcp`, `uploads`, `internal` (נתיבים שמתחילים ב-`/_`) או `other`. `status` הוא
מחלקת הסטטוס: `2xx`, `3xx`, `4xx` או `5xx`.

התראות שימושיות: `/_ready` נכשל, חלק עולה של `5xx`, `verdin_webhook_deliveries_pending`
שגדל (יעד של webhook לא זמין), ו-`verdin_uptime_seconds` שמתאפס (הפעלות מחדש).

## יומנים

Verdin כותב יומנים ל-standard error.

| הגדרה | ערכים | ברירת מחדל |
| --- | --- | --- |
| `[log].format` | `pretty` (לטרמינלים) או `json` (אובייקט אחד לכל שורה) | `pretty`; `json` באימג' של Docker |
| `[log].level` | רמה או מסנן: `error`, `warn`, `info`, `debug`, `trace`, או לפי מודול (`info,verdin_api=debug`) | `info` |
| `RUST_LOG` | אותו תחביר; גובר על `[log].level` כשהוא מוגדר | לא מוגדר |

השתמשו ב-`json` בייצור ושלחו את ה-standard error למערכת היומנים שלכם. שורת JSON נראית כך:

```json
{"timestamp":"2026-09-29T09:27:16.444598Z","level":"INFO","fields":{"message":"verdin listening","address":"0.0.0.0:1337","mode":"production","version":"0.10.0"},"target":"verdin::app"}
```

בהפעלה, שורות `WARN` מצביעות על הגדרות שצריך לתקן בייצור, כמו
`[email].provider is 'log'` או עוגיות מאובטחות כבויות.

### בקשות

כל בקשה מקבלת מזהה בקשה: הכותרת הנכנסת `X-Request-Id` אם יש כזו, או UUID חדש. הוא נשלח
בחזרה בכותרת התגובה `X-Request-Id` ומצורף לכל שורת יומן שנכתבת בזמן הגשת הבקשה
(`request_id`, עם `method` ו-`uri`). העבירו את הכותרת מה-proxy שלכם כדי לעקוב אחרי בקשה בין
מערכות.

ברמת `info` הבקשות לא נרשמות אחת אחת. כדי לרשום כל בקשה עם הסטטוס וזמן ההשהיה שלה, העלו את
הרמה של שכבת ה-HTTP:

```sh
RUST_LOG=info,tower_http=debug
```

כתובות URL שנרשמות מסתירות את הערכים של פרמטרי שאילתה ששמם נראה סודי (`token`, `code`,
`state`, `password`, `key`, `signature`, `jwt`…), למשל
`/api/connect/github/callback?code=[hidden]`.

## בפאנל הניהול

הוסיפו את הווידג'ט **מערכת** ללוח הבקרה של דף הבית כדי לראות במבט אחד את הגרסה, מסד
הנתונים והסכמה.
