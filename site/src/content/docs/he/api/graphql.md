---
title: "GraphQL API"
description: "הפעלת נקודת הקצה של GraphQL ב-Verdin, הסכמה שהיא מייצרת מסוגי התוכן שלכם, שאילתות, מוטציות, connections, שגיאות ומגבלות."
sidebar:
  order: 2
  label: "GraphQL"
---

Verdin יכול להגיש GraphQL API שנוצר מסוגי התוכן שלכם, במבנה של תוסף ה-GraphQL של Strapi v5.
הוא חולק עם ה-REST API את ההרשאות, המסננים, העימוד והאימות: הארגומנטים של GraphQL מתורגמים
לאותה שאילתה שבקשת REST הייתה מבצעת. העמוד הזה הוא התיעוד המלא; הדוגמאות משתמשות ב-
[דוגמת הבלוג](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog).

## הפעלה

GraphQL כבוי כברירת מחדל. הפעילו אותו ב-**הגדרות ← תכונות ← GraphQL** (הרשאה
`features.manage`). השינוי חל מיד, בלי הפעלה מחדש, ונקודת הקצה היא:

```
POST /graphql
```

היא מוגשת בשורש השרת, לא תחת הקידומת של REST. שלחו
`{ "query", "variables", "operationName" }` כ-JSON. גם `GET /graphql?query=…` מריץ שאילתות
(מוטציות דורשות `POST`).

```sh title="Terminal"
curl -X POST 'https://cms.example.com/graphql' \
  -H "Authorization: Bearer $VERDIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ articles(sort: [\"publishedAt:desc\"]) { documentId title } }"}'
```

המבקשים מאמתים כמו ב-REST API: בלי כותרת לגישה ציבורית, עם אסימון API, או עם JWT של
משתמש קצה. כותרת `Authorization` פגומה או אסימון לא מוכר עונים `401`. ראו
[הרשאות](/he/concepts/permissions/). דפדפנים ממקורות אחרים צריכים את `[api].cors_origins`.

### הגדרות

| הגדרה | ברירת מחדל | היכן | השפעה |
| --- | --- | --- | --- |
| **סביבת GraphiQL** | פעיל ב-`verdin dev`, כבוי ב-`verdin start` | הגדרות התכונה | מגיש את GraphiQL כשדפדפן פותח את `GET /graphql`. נטען מ-unpkg.com. |
| **אינטרוספקציה (Introspection)** | פעיל | הגדרות התכונה | מאפשר ללקוחות ולכלים לקרוא את הסכמה. כבו אותו כדי להסתיר את הסכמה מהציבור. |
| **פעולות מושבתות** | אין | הגדרות התכונה | לכל סוג תוכן, משאיר את `find`, `findOne`, `create`, `update` או `delete` (או את כל השאילתות, כל המוטציות, הכול) מחוץ לסכמה, כמו מתגי ה-shadow CRUD של Strapi. REST לא מושפע. |
| `maxDepth` | `10` | API הניהול | עומק הבחירה המרבי המותר. |
| `maxComplexity` | `1000` | API הניהול | מורכבות השאילתה המרבית המותרת (בערך, מספר השדות שנבחרו). |

ל-`maxDepth` ול-`maxComplexity` עדיין אין שדה בפאנל. הגדירו אותם דרך
[API הניהול](/he/api/admin/): `GET /admin/api/features` מחזיר את ההגדרות הנוכחיות, ו-
`PUT /admin/api/features/graphql` מחליף אותן, לכן שלחו גם את אלה שאתם רוצים לשמור:

```json
{ "enabled": true, "settings": { "playground": false, "introspection": true, "maxDepth": 8, "maxComplexity": 500 } }
```

## סכמה

לכל סוג תוכן יש בסכמה טיפוס אובייקט שנקרא על שם ה-`singularName` שלו ב-PascalCase
(`article` → `Article`, `blog-post` → `BlogPost`), עם:

- `documentId: ID!`
- כל מאפיין שאינו `private`
- `createdAt`, `updatedAt` ו-`publishedAt`, כ-`DateTime`
- `locale: String`, בסוגים מתורגמים

| מאפיין | טיפוס GraphQL |
| --- | --- |
| `string`, `text`, `richtext`, `email`, `uid`, `enumeration` | `String` |
| `integer` | `Int` |
| `biginteger` | `Long` (מחרוזת, כמו ב-REST) |
| `float`, `decimal` | `Float` |
| `boolean` | `Boolean` |
| `date`, `time`, `datetime` | `Date`, `Time`, `DateTime` |
| `json`, `blocks` | `JSON` |
| קשר to-one | הטיפוס של היעד, למשל `Category` |
| קשר to-many | `[Tag!]!`, עם הארגומנטים `filters`, `pagination` ו-`sort` |
| `media` | `UploadFile`, או `[UploadFile!]!` כאשר `multiple` |
| `component` | `ComponentSharedSeo` (מה-UID `shared.seo`), או רשימה כשהוא חוזר |
| `dynamiczone` | `[ArticleBlocksDynamicZone!]!`, איחוד (union) של הרכיבים שלו |
| קשר פולימורפי | `JSON` (מסמכים עם ה-`__type` שלהם) |

ל-`Query` השורשי יש גם `verdin: String!`, הגרסה של השרת.

## שאילתות

| סוג אוסף `article` | מחזיר |
| --- | --- |
| `articles(filters, pagination, sort, status, locale)` | `[Article!]!` |
| `articles_connection(filters, pagination, sort, status, locale)` | `ArticleEntityResponseCollection` עם `nodes` ו-`pageInfo` |
| `article(documentId: ID!, status, locale)` | `Article` או `null` |

| סוג יחיד `homepage` | מחזיר |
| --- | --- |
| `homepage(status, locale)` | `Homepage` או `null` |

שמות השאילתות והשדות נגזרים מ-`pluralName` ומ-`singularName` ב-camelCase
(`blog-posts` → `blogPosts`).

```graphql
query LatestArticles($page: Int) {
  articles_connection(
    filters: { category: { name: { eq: "News" } }, title: { containsi: "rust" } }
    sort: ["publishedAt:desc"]
    pagination: { page: $page, pageSize: 10 }
  ) {
    nodes {
      documentId
      title
      slug
      category { name }
      tags(sort: ["label:asc"]) { label }
      seo { metaTitle metaDescription }
      blocks {
        __typename
        ... on ComponentBlocksHero { title subtitle }
        ... on ComponentBlocksQuote { text author }
      }
    }
    pageInfo { page pageSize pageCount total }
  }
}
```

אותה בקשה ב-REST:

```http
GET /api/articles?filters[category][name][$eq]=News&filters[title][$containsi]=rust
  &sort=publishedAt:desc&pagination[page]=1&pagination[pageSize]=10
  &populate[category][fields][0]=name&populate[tags][sort]=label:asc&populate[0]=seo&populate[1]=blocks
```

### ארגומנטים

- **`filters`**: `ArticleFiltersInput` עם שדה אחד לכל מאפיין, ובנוסף `documentId`,
  חותמות הזמן, ו-`and`, `or` ו-`not`. שדות סקלריים מקבלים קלטי אופרטורים כמו
  `StringFilterInput`, שהאופרטורים שלו הם [האופרטורים של REST](/he/api/rest/#מסננים) בלי
  ה-`$`: `eq`, `ne`, `containsi`, `in`, `between`, `null`… קשרים מקבלים את קלט המסננים של
  היעד, ורכיבים שאינם חוזרים את זה של הרכיב שלהם.
- **`pagination`**: `{ page, pageSize }` או `{ start, limit }`, עם ברירות המחדל והמקסימום
  של REST.
- **`sort`**: רשימה של מחרוזות `"field"` או `"field:asc|desc"`, כמו ב-REST.
- **`status`**: `PUBLISHED` (ברירת המחדל) או `DRAFT`, שדורש את ההרשאה `readDrafts`.
  מסמכים קשורים תמיד עוקבים אחרי הסטטוס של ההורה שלהם.
- **`locale`**: קוד שפה לסוגים מתורגמים; אחרת, שפת ברירת המחדל.

רק מה שבוחרים נטען: הבחירה הופכת ל-`populate` של REST, וכל רמה של קשרים היא שאילתה
אחת מקובצת. `pageInfo` של `articles_connection` סופר את כל ההתאמות (`total`) ואת
העמודים (`pageCount`).

## מוטציות

| סוג אוסף `article` | מחזיר |
| --- | --- |
| `createArticle(data: ArticleInput!, status, locale)` | `Article` |
| `updateArticle(documentId: ID!, data: ArticleInput!, status, locale)` | `Article` |
| `deleteArticle(documentId: ID!, locale)` | `DeleteMutationResponse` (`{ documentId }`) |

| סוג יחיד `homepage` | מחזיר |
| --- | --- |
| `updateHomepage(data: HomepageInput!, status, locale)` | `Homepage`; העדכון הראשון יוצר את המסמך |
| `deleteHomepage(locale)` | `DeleteMutationResponse` |

```graphql
mutation {
  createArticle(
    data: { title: "Hello, Verdin", slug: "hello-verdin", category: "k2m7q4…", tags: ["a7c1…"] }
    status: DRAFT
  ) {
    documentId
    publishedAt
  }
}
```

- כמו ב-REST, `create` ו-`update` מפרסמים אלא אם `status: DRAFT`. אין מוטציות פרסום
  נפרדות: השתמשו ב[פעולות](/he/api/rest/#פעולות) של REST כדי לבטל פרסום או למחוק טיוטה.
- הקלטים משקפים את המאפיינים: קשרים מקבלים `ID` או `[ID!]` (ערכי `documentId`), מדיה
  מקבלת מזהי קבצים, רכיבים את טיפוס ה-`…Input` שלהם, ופריטי אזור דינמי הם אובייקטי
  `JSON` עם `__component`. קשרים הפוכים (`mappedBy`) אינם בקלטים.
- מוטציות `delete` מסירות את הגרסה ב-`locale` (שפת ברירת המחדל אם לא צוין), כמו
  `DELETE /api/articles/{documentId}?locale=fr`.
- רץ אותו אימות כמו ב-REST.

## שגיאות

שגיאות GraphQL מגיעות ברשימה `errors` של תגובת `200`, עם קוד ב-
`extensions.code`:

```json
{
  "data": { "createArticle": null },
  "errors": [
    {
      "message": "title is a required field",
      "path": ["createArticle"],
      "extensions": {
        "code": "BAD_USER_INPUT",
        "details": [{ "path": ["title"], "message": "title is a required field", "name": "ValidationError" }]
      }
    }
  ]
}
```

| קוד | מתי |
| --- | --- |
| `FORBIDDEN` | למבקש אין הרשאה לפעולה, או `readDrafts` עבור `status: DRAFT`. |
| `BAD_USER_INPUT` | ארגומנטים או תוכן לא תקינים; `details` מפרט את בעיות האימות עם הנתיבים שלהן. |
| `NOT_FOUND` | המסמך לא קיים (בעדכונים ובמחיקות). |
| `INTERNAL_SERVER_ERROR` | שגיאה לא צפויה, שנרשמת ביומן של השרת. |

שאילתות עמוקות מ-`maxDepth` או מורכבות מ-`maxComplexity` נדחות לפני שהן רצות.

## מגבלות

ל-GraphQL יש מגבלות משלו (`maxDepth`, `maxComplexity`) נוסף על אלה של ה-REST API: לכל היותר
`[api].max_page_size` מסמכים לרשימה, קשרים בקינון של עד 5 רמות, לכל היותר 1,000 מסמכים
קשורים לכל מסמך וקשר, ולכל היותר 100 תנאי סינון. ראו
[מגבלות REST](/he/api/rest/#מגבלות).

## תוספים

[תוספים](/he/extending/plugins/) יכולים להוסיף שאילתות ומוטציות שורש מהצורה
`name(args: JSON): JSON`. שמות שכבר תפוסים על ידי סוגי תוכן מדולגים.

## בהשוואה ל-Strapi

שמות הטיפוסים, השאילתות והמוטציות, שאילתות `_connection` עם `nodes` ו-`pageInfo`,
ארגומנטי `documentId`, `status` ו-`locale` עוקבים אחרי תוסף ה-GraphQL של Strapi v5, ולסוגים
מתורגמים יש שדה `locale`. הטיפוסים לא חושפים `id`, ואין GraphQL subscriptions; לעדכונים
חיים, השתמשו ב-[API זמן אמת](/he/api/realtime/).
