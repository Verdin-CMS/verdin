---
title: "API הניהול"
description: "ה-API שמאחורי פאנל הניהול של Verdin, לאוטומציה: התחברות, סשנים, מוסכמות וקבוצות הנתיבים העיקריות."
sidebar:
  order: 4
  label: "ניהול"
---

פאנל הניהול הוא לקוח של API הניהול, שמוגש תחת `{admin.path}/api`
(`/admin/api` כברירת מחדל). כל מה שהפאנל עושה, גם סקריפט יכול לעשות: ליצור מנהלים
ואסימוני API, להגדיר webhooks ותכונות, לנהל שפות, או לעבוד עם טיוטות ומהדורות.
העמוד הזה מסביר איך מאמתים ומפרט את קבוצות הנתיבים.

:::caution[יציבות]
ל-API הניהול אין הבטחת יציבות לפני Verdin 1.0: נתיבים וגופי בקשות עשויים להשתנות
בגרסאות משניות, ויומן השינויים לא מפרט כל שינוי. לקריאה וכתיבה של תוכן עדיף להשתמש
ב-API של [REST](/he/api/rest/) או של [GraphQL](/he/api/graphql/) עם
[אסימון API](/he/guides/auth/api-tokens/). חוזה יציבות לכל ה-APIs מתוכנן לגרסה 1.0.
:::

## התחברות

ל-API הניהול עדיין אין אסימוני API: סקריפט מתחבר כמשתמש מנהל, רצוי כזה שהתפקיד שלו
מתיר רק את מה שהסקריפט צריך.

```sh title="Terminal"
curl -s -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"bot@example.com","password":"…"}'
```

```json
{
  "data": {
    "user": { "id": 3, "email": "bot@example.com", "…": "…" },
    "accessToken": "eyJhbGciOiJIUzI1NiIs…",
    "accessTokenExpiresAt": "2026-09-29T10:15:00.000Z"
  }
}
```

שלחו את אסימון הגישה בכל בקשה אחרת:

```sh title="Terminal"
curl -H "Authorization: Bearer $ACCESS_TOKEN" 'https://cms.example.com/admin/api/system/info'
```

| אישור | תוקף | היכן |
| --- | --- | --- |
| אסימון גישה (JWT) | 15 דקות | גוף התגובה. שלחו אותו כ-`Authorization: Bearer …`. |
| אסימון רענון | 30 ימים | העוגייה `verdin_refresh` (`HttpOnly`, `SameSite=Strict`, נתיב `/admin/api/auth`, `Secure` תחת `verdin start`). |

כדי לקבל אסימון גישה חדש, קראו ל-`POST /admin/api/auth/refresh` עם העוגייה וכותרת
`X-Verdin-CSRF` (כל ערך). התשובה זהה לזו של התחברות, ואסימון הרענון מוחלף: שמרו את
העוגייה החדשה, כי הצגה חוזרת של אסימון רענון שכבר נוצל מסיימת את כל הסשן.
`POST /admin/api/auth/logout`, עם אותה כותרת, מסיים את הסשן.

```sh title="Terminal"
curl -s -b cookies.txt -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/refresh' \
  -H 'X-Verdin-CSRF: 1'
```

- **אימות דו-שלבי.** לחשבון עם גורם שני, ההתחברות עונה
  `{ "data": { "twoFactorRequired": true, "twoFactorToken": "…", "methods": ["totp"] } }`.
  השלימו אותה עם `POST /admin/api/auth/login/two-factor` ועם
  `{ "twoFactorToken": "…", "code": "123456" }` (קוד TOTP או קוד שחזור). ראו
  [אימות דו-שלבי](/he/guides/auth/two-factor/).
- **הגבלת קצב.** התחברות והרשמה מוגבלות לפי כתובת ה-IP של הלקוח באמצעות
  `[admin].auth_rate_limit` (20 בדקה כברירת מחדל); לרענונים יש מכסה גדולה יותר.
- **כשלים.** פרטים שגויים, חשבונות לא מוכרים וחשבונות נעולים עונים כולם
  `400 Invalid credentials`. חמש סיסמאות שגויות נועלות את החשבון ל-15 דקות.
- **המנהל הראשון.** במופע חדש, `POST /admin/api/auth/register-first-admin` יוצר את
  ה-Super Admin; זה עובד רק כל עוד אין אף מנהל. `verdin admin create` עושה את אותו הדבר
  משורת הפקודה.

## מוסכמות

- גופי בקשות ותגובות הם JSON. התגובות עוטפות את התוצאה ב-`data`
  (`{ "data": … }`); נתיבי תוכן מחזירים גם `meta`, כמו ה-REST API.
- נתיבי תוכן מקבלים גופים מהצורה `{ "data": { … } }`, כמו ה-REST API. נתיבי הגדרות
  מקבלים אובייקטי JSON פשוטים.
- לשגיאות יש את [מבנה השגיאה של REST](/he/api/rest/#שגיאות). נתיב של תכונה כבויה
  עונה `404`. מנהל שהתפקיד שלו מחייב אימות דו-שלבי מקבל
  `403 TwoFactorRequiredError` עד שיגדיר אותו.
- כל נתיב בודק את [ההרשאות](/he/concepts/permissions/) של המנהל: נתיבי תוכן בודקים את
  פעולות התוכן על הסוג, ונתיבי הגדרות את פעולת ההגדרות שלהם.
- API הניהול אף פעם לא עונה לבקשות cross-origin: קראו לו משרת או מסקריפט, לא מדפים של
  אתר אחר.
- שינויים מוצלחים נרשמים ב[יומן הביקורת](/he/guides/content/audit-logs/).

## קבוצות נתיבים

הנתיבים יחסיים ל-`/admin/api`. הנתבים נמצאים ב-
[`crates/verdin-api/src/admin.rs`](https://github.com/Verdin-CMS/verdin/blob/main/crates/verdin-api/src/admin.rs)
ובמודולי `*_admin.rs` שלצדו.

| קבוצה | נתיבים | הרשאה |
| --- | --- | --- |
| התחברות וחשבון | `GET /auth/status`, `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `GET\|PUT /users/me`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, הזמנות ואיפוס סיסמה תחת `/auth/*` | מחובר (נתיבי ההתחברות ציבוריים) |
| אימות דו-שלבי | `/auth/two-factor/*`, `POST /auth/login/two-factor`, `POST /auth/login/passkey/options`, `DELETE /users/{id}/two-factor` | מחובר; `users.manage` לאיפוס של מנהל אחר |
| SSO | `GET /auth/sso`, `GET /auth/sso/{id}`, `GET /auth/sso/{id}/callback` | ציבורי |
| משתמשי ניהול | `GET\|POST /users`, `GET\|PUT\|DELETE /users/{id}`, `POST /users/{id}/invite` | `users.manage` |
| תפקידים וגישה ציבורית | `GET\|POST /roles`, `GET\|PUT\|DELETE /roles/{id}`, `GET\|PUT /public-permissions` | `roles.manage` |
| אסימוני API | `GET\|POST /api-tokens`, `GET\|PUT\|DELETE /api-tokens/{id}`, `POST /api-tokens/{id}/regenerate` | `tokens.manage` |
| סכמה | `GET /content-types`, `GET /components`, `GET\|PUT\|DELETE /content-types/{uid}/edit-view`; `GET /schema`, `POST /schema/plan`, `POST /schema/apply` רק ב-`verdin dev` | מחובר; `views.manage` לתצוגות עריכה; `schema.manage` לבונה |
| תוכן | `GET\|POST /content/{uid}`, `GET\|PUT\|DELETE /content/{uid}/{documentId}`, `POST /content/{uid}/{documentId}/actions/{publish\|unpublish\|discard-draft}`, `POST …/clone`, `GET …/locales`, `GET …/usage`, `GET /content/{uid}/uid-available`, `GET /content/{uid}/stats` | פעולות תוכן על `{uid}` |
| ייבוא וייצוא | `GET /content/{uid}/export`, `POST /content/{uid}/import` | פעולות תוכן על `{uid}` |
| היסטוריה | `GET /history/{uid}/{documentId}`, `GET /history/versions/{id}`, `POST /history/versions/{id}/restore` | פעולות תוכן על הסוג |
| מהדורות | `GET\|POST /releases`, `GET\|PUT\|DELETE /releases/{id}`, `POST /releases/{id}/actions`, `DELETE /releases/{id}/actions/{actionId}`, `POST /releases/{id}/publish` | `releases.manage` |
| תהליכי בקרה | `GET\|POST /review-workflows`, `GET\|PUT\|DELETE /review-workflows/{id}`, `GET\|PUT /content/{uid}/{documentId}/review`, `GET /review/*` | `workflows.manage` להגדרה |
| מדיה | `POST /upload`, `POST /upload/from-url`, `GET /upload/files`, `GET\|PUT\|DELETE /upload/files/{id}`, `POST /upload/files/{id}/replace`, `GET /upload/files/{id}/usage`, `/upload/folders…` | `media.*` |
| שפות | `GET\|POST /i18n/locales`, `PUT\|DELETE /i18n/locales/{code}` | `locales.manage` לשינוי |
| Webhooks | `GET\|POST /webhooks`, `GET\|PUT\|DELETE /webhooks/{id}`, `POST\|DELETE /webhooks/{id}/secret`, `POST /webhooks/{id}/trigger`, `GET /webhooks/{id}/deliveries`, `POST /webhooks/deliveries/{id}/retry` | `webhooks.manage` |
| משתמשי קצה | `GET\|POST /end-users`, `GET\|PUT\|DELETE /end-users/{id}`, `GET\|POST /end-user-roles`, `PUT\|DELETE /end-user-roles/{id}` | `endusers.manage` |
| תכונות | `GET /features`, `PUT /features/{id}`, `POST /email/test` | `features.manage` לשינוי |
| תוספים | `GET /plugins`, `GET /plugins/extensions`, `PUT /plugins/{name}`, `GET /plugins/{name}/logs` | `plugins.manage` |
| פריסות ו-CDN | `/deploy/targets…`, `GET /deploy/deployments`, `GET /deploy/cdn`, `POST /deploy/cdn/purge` | `deploy.manage`; `deploy.trigger` להפעלה |
| אתר | `/site/redirects…`, `/site/menus…`, `/site/forms…` והגשות טפסים | `site.manage` |
| שיתוף פעולה | `/comments…`, `/tasks…`, `/engagement/*`, `/polls…` | הרשאת קריאה לסוג של הרשומה |
| זמן אמת | `GET /events`, `GET\|POST /presence` | ראו [API זמן אמת](/he/api/realtime/#זרם-הניהול) |
| AI | `GET /ai`, `POST /ai/translate`, `/ai/alt-text`, `/ai/summarize`, `/ai/seo` | ראו [פעולות AI](/he/guides/integrations/ai-actions/) |
| יומני ביקורת | `GET /audit-logs` | `audit.read` |
| מערכת | `GET /system/info` (גרסה, מסד נתונים ומצב) | מחובר |

## נתיבי תוכן

נתיבי התוכן מריצים את אותו Document Service כמו ה-REST API, עם כללי ניהול:

- `{uid}` הוא ה-UID של סוג התוכן, למשל `api::article`.
- קריאות מחזירות **טיוטות**, אלא אם מעבירים `status=published`. הן מקבלות את
  [פרמטרי השאילתה](/he/api/rest/#פרמטרי-שאילתה) של REST, ובנוסף `unseen=true` למסמכים
  שהמנהל לא פתח מאז שהשתנו לאחרונה.
- כתיבות שומרות רק את הטיוטה. פרסום הוא תמיד פעולה מפורשת.
- כתיבות רושמות את המנהל כיוצר או כעורך האחרון. הגבלות השדות, השפות ו-`is-creator`
  של תפקידי המנהל חלות על קריאות ועל כתיבות.

```sh title="Terminal"
curl -X PUT 'https://cms.example.com/admin/api/content/api::article/k2m7q4…?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"data":{"title":"Bonjour, Verdin"}}'
curl -X POST 'https://cms.example.com/admin/api/content/api::article/k2m7q4…/actions/publish?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```
