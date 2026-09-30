---
title: ניטור
description: מעקב אחרי מופע Verdin רץ — בדיקות /_health ו-/_ready, מדדי Prometheus ב-/_metrics ולוח בקרה של Grafana, עקבות OpenTelemetry, דיווחי שגיאות ל-Sentry, פורמט היומנים, רמות ומזהי בקשות.
sidebar:
  order: 10
---

מופע Verdin מדווח על עצמו דרך שתי נקודות קצה של תקינות, מדדי Prometheus אופציונליים,
עקבות OpenTelemetry ודיווחי שגיאות ל-Sentry אופציונליים, ויומנים מובנים. העמוד הזה מפרט מה
כל אחד מהם מחזיר ואיך מפעילים אותו.

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
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`, `kind`, `function` | זמן שפונקציות של [תוספים](/he/extending/plugins/) לקחו. אותם דליים. |
| `verdin_plugin_call_errors_total` | counter | `plugin`, `kind`, `function` | קריאות לתוסף שנכשלו: trap, חריגת זמן, פלט שאינו JSON, או `{ error }` של פונקציית הפעלה. |
| `verdin_webhook_deliveries_pending` | gauge | | שליחות webhook שממתינות לשליחה. |
| `verdin_realtime_subscribers` | gauge | | זרמי אירועי זמן אמת פתוחים. |
| `verdin_cluster_events_total` | counter | `direction` | אירועים ב[אפיק האירועים המשותף](/he/deploy/scaling/#אפיק-אירועים-משותף), כש-`[cluster].bus` מוגדר: `sent` למופעים אחרים, `received` מהם, `dropped` (תור מלא או כתיבה שנכשלה). |
| `verdin_uptime_seconds` | gauge | | שניות מאז שהתהליך עלה. |
| `verdin_build_info` | gauge | `version` | תמיד 1; הגרסה הרצה. |

`area` הוא החלק של השרת: `api` (API התוכן), `admin_api`, `admin` (הקבצים של הפאנל),
`graphql`, `mcp`, `uploads`, `internal` (נתיבים שמתחילים ב-`/_`) או `other`. `status` הוא
מחלקת הסטטוס: `2xx`, `3xx`, `4xx` או `5xx`. בקריאות לתוספים, `kind` הוא `hook`, `route`,
`job`, `startup` או `graphql`; סדרות התוסף מופיעות אחרי הקריאה הראשונה (ראו את
[תיעוד התוספים](/he/extending/plugin-reference/#מדדים)).

התראות שימושיות: `/_ready` נכשל, חלק עולה של `5xx`, `verdin_webhook_deliveries_pending`
שגדל (יעד של webhook לא זמין), `verdin_plugin_call_errors_total` שעולה או hooks איטיים של
תוספים (הם מאטים את הכתיבות שהם רצים עליהן), ו-`verdin_uptime_seconds` שמתאפס (הפעלות
מחדש).

### לוח בקרה של Grafana

[`docker/grafana/verdin.json`](https://github.com/Verdin-CMS/verdin/blob/main/docker/grafana/verdin.json)
הוא לוח בקרה עבור המדדים האלה: קצב בקשות, חלק ה-`5xx` וקוונטילים של זמן השהיה לפי אזור,
שיטה ומחלקת סטטוס, שליחות webhook ממתינות, מנויי זמן אמת, תעבורת אפיק האירועים, וקצב
קריאות לתוספים, p95 ושגיאות לכל פונקציית תוסף. ייבאו אותו ב-Grafana (**Dashboards → New →
Import**) ובחרו את מקור הנתונים של Prometheus; המשתנים `instance` ו-`area` שבראש מסננים כל
פאנל.

## עקבות (OpenTelemetry)

Verdin יכול לייצא עקבה של כל בקשה ל-collector של OpenTelemetry (OpenTelemetry Collector,
Grafana Alloy או Tempo, Jaeger, Honeycomb, Datadog…) דרך OTLP/HTTP. הוא כבוי כברירת מחדל:

```toml title="verdin.toml"
[telemetry]
enabled = true
endpoint = "http://otel-collector:4318"
```

גם המשתנים הסטנדרטיים עובדים, וגוברים על הקובץ:

```sh
VERDIN_TELEMETRY__ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<key>
OTEL_SERVICE_NAME=cms-production
```

כל עקבה כוללת:

- **span של בקשה** (מסוג `server`), על שם השיטה והנתיב עם מזהים שמוחלפים ב-`{id}`
  (`PUT /api/articles/{id}`), עם `http.response.status_code` וסטטוס שגיאה ב-`5xx`. בקשה עם
  כותרת W3C `traceparent` מצטרפת לעקבה של הקורא.
- **span לכל פקודת מסד נתונים** (מסוג `client`) מתחתיו: `db.system.name` (`postgresql`,
  `mysql`, `mariadb` או `sqlite`) ו-`db.query.text`, ה-SQL עם ה-placeholders `?` שלו. ערכים
  מקושרים לעולם לא נרשמים, כך שתוכן, סיסמאות ואסימונים נשארים מחוץ לעקבות. ל-`COMMIT`
  ול-`ROLLBACK` יש spans משלהם, וב-SQLite span בשם `write lock` מראה כמה זמן כתיבה חיכתה
  לכותבים שלפניה.
- אירועי היומן שנכתבו בזמן הגשת הבקשה, כאירועי span.

פקודות שרצות מחוץ לבקשה (עלייה, הגירות, משימות רקע) לא נכללות בעקבות.
`[telemetry].sample_ratio` שומר חלק מהעקבות (`0.1` שומר אחת מכל עשר); ה-spans נשלחים
באצוות ומרוקנים כשהשרת נעצר. רמת היומן לא מסננת עקבות: `[log].level = "warn"` עדיין מייצא
כל בקשה.

## דיווח שגיאות (Sentry)

הגדירו DSN כדי לשלוח panics ותגובות `5xx` ל-[Sentry](https://sentry.io) (או לשירות תואם
Sentry כמו GlitchTip):

```sh
SENTRY_DSN=https://<key>@o0.ingest.sentry.io/<project>
```

גם `[telemetry].sentry_dsn` עובד; המשתנה גובר. `5xx` מגיע כאירוע שגיאה
`POST /api/articles answered 500`, עם התגיות `http.method`, `http.status_code` ו-`request_id`,
שתואם לכותרת `X-Request-Id` ולשורות היומן של אותה בקשה. לאירועים יש את גרסת Verdin כ-release
ואת `production` (`verdin start`) או `development` (`verdin dev`) כסביבה, אלא אם
`SENTRY_ENVIRONMENT` או `[telemetry].sentry_environment` קובעים אחרת. כתובות URL מדווחות עם
ערכי שאילתה שנראים סודיים מוסתרים, כמו ביומנים; גופי בקשות וכותרות לעולם לא נשלחים.

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
