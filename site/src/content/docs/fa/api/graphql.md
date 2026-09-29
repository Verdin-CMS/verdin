---
title: "GraphQL API"
description: "فعال کردن نقطهٔ پایانی GraphQL در Verdin، طرح‌واره‌ای که از نوع‌های محتوای شما تولید می‌کند، کوئری‌ها، mutationها، connectionها، خطاها و محدودیت‌ها."
sidebar:
  order: 2
  label: "GraphQL"
---

Verdin می‌تواند یک GraphQL API ارائه کند که از نوع‌های محتوای شما تولید شده و شکل آن مانند
افزونهٔ GraphQL در Strapi v5 است. این API مجوزها، فیلترها، صفحه‌بندی و اعتبارسنجی را با REST API
مشترک دارد: آرگومان‌های GraphQL به همان کوئری‌ای ترجمه می‌شوند که یک درخواست REST می‌سازد. این
صفحه مرجع است؛ مثال‌ها از
[مثال وبلاگ](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog) استفاده می‌کنند.

## فعال‌سازی

GraphQL به‌طور پیش‌فرض خاموش است. آن را در **تنظیمات ← قابلیت‌ها ← GraphQL** روشن کنید (مجوز
`features.manage`). تغییر بی‌درنگ و بدون راه‌اندازی مجدد اعمال می‌شود، و نقطهٔ پایانی این است:

```
POST /graphql
```

این نقطهٔ پایانی در ریشهٔ سرور ارائه می‌شود، نه زیر پیشوند REST. `{ "query", "variables", "operationName" }`
را به‌صورت JSON بفرستید. `GET /graphql?query=…` هم کوئری‌ها را اجرا می‌کند (mutationها به
`POST` نیاز دارند).

```sh title="Terminal"
curl -X POST 'https://cms.example.com/graphql' \
  -H "Authorization: Bearer $VERDIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ articles(sort: [\"publishedAt:desc\"]) { documentId title } }"}'
```

فراخوانندگان مانند REST API احراز هویت می‌کنند: بدون هدر برای دسترسی عمومی، با یک توکن API، یا
با JWT یک کاربر نهایی. یک هدر `Authorization` بدشکل یا یک توکن ناشناخته با `401` پاسخ می‌گیرد.
نگاه کنید به [مجوزها](/fa/concepts/permissions/). مرورگرهایی که از originهای دیگر درخواست
می‌دهند به `[api].cors_origins` نیاز دارند.

### تنظیمات

| تنظیم | پیش‌فرض | کجا | اثر |
| --- | --- | --- | --- |
| **زمین بازی GraphiQL** | روشن در `verdin dev`، خاموش در `verdin start` | تنظیمات قابلیت | وقتی یک مرورگر `GET /graphql` را باز کند GraphiQL را ارائه می‌کند. از unpkg.com بارگذاری می‌شود. |
| **درون‌نگری (Introspection)** | روشن | تنظیمات قابلیت | به کلاینت‌ها و ابزارها اجازه می‌دهد طرح‌واره را بخوانند. برای پنهان کردن طرح‌واره از عموم، آن را خاموش کنید. |
| **عملیات غیرفعال‌شده** | هیچ | تنظیمات قابلیت | به ازای هر نوع محتوا، `find`، `findOne`، `create`، `update` یا `delete` (یا همهٔ کوئری‌ها، همهٔ mutationها، همه‌چیز) را از طرح‌واره بیرون می‌گذارد، مانند کلیدهای shadow CRUD در Strapi. بر REST اثری ندارد. |
| `maxDepth` | `10` | Admin API | عمیق‌ترین انتخاب مجاز. |
| `maxComplexity` | `1000` | Admin API | بیشترین پیچیدگی مجاز کوئری (تقریباً تعداد فیلدهای انتخاب‌شده). |

`maxDepth` و `maxComplexity` هنوز فیلدی در پنل ندارند. آن‌ها را با [Admin API](/fa/api/admin/)
تنظیم کنید: `GET /admin/api/features` تنظیمات فعلی را برمی‌گرداند و `PUT /admin/api/features/graphql`
آن‌ها را جایگزین می‌کند، پس تنظیماتی را هم که می‌خواهید حفظ شوند بفرستید:

```json
{ "enabled": true, "settings": { "playground": false, "introspection": true, "maxDepth": 8, "maxComplexity": 500 } }
```

## طرح‌واره

برای هر نوع محتوا، طرح‌واره (schema) یک نوع شیء دارد که نامش `singularName` آن به شکل
PascalCase است (`article` → `Article`، `blog-post` → `BlogPost`)، با:

- `documentId: ID!`
- همهٔ ویژگی‌هایی که `private` نیستند
- `createdAt`، `updatedAt` و `publishedAt`، به‌صورت `DateTime`
- `locale: String`، در نوع‌های بومی‌سازی‌شده

| ویژگی | نوع GraphQL |
| --- | --- |
| `string`، `text`، `richtext`، `email`، `uid`، `enumeration` | `String` |
| `integer` | `Int` |
| `biginteger` | `Long` (یک رشته، مانند REST) |
| `float`، `decimal` | `Float` |
| `boolean` | `Boolean` |
| `date`، `time`، `datetime` | `Date`، `Time`، `DateTime` |
| `json`، `blocks` | `JSON` |
| رابطهٔ به‌یک | نوع هدف، مثلاً `Category` |
| رابطهٔ به‌چند | `[Tag!]!`، با آرگومان‌های `filters`، `pagination` و `sort` |
| `media` | `UploadFile`، یا `[UploadFile!]!` وقتی `multiple` باشد |
| `component` | `ComponentSharedSeo` (از UID `shared.seo`)، یا یک فهرست وقتی تکرارشونده باشد |
| `dynamiczone` | `[ArticleBlocksDynamicZone!]!`، یک union از کامپوننت‌هایش |
| رابطهٔ چندریختی | `JSON` (سندها همراه با `__type` خود) |

`Query` ریشه همچنین `verdin: String!` را دارد، یعنی نسخهٔ سرور.

## کوئری‌ها

| نوع مجموعه‌ای `article` | برمی‌گرداند |
| --- | --- |
| `articles(filters, pagination, sort, status, locale)` | `[Article!]!` |
| `articles_connection(filters, pagination, sort, status, locale)` | `ArticleEntityResponseCollection` با `nodes` و `pageInfo` |
| `article(documentId: ID!, status, locale)` | `Article` یا `null` |

| نوع تکی `homepage` | برمی‌گرداند |
| --- | --- |
| `homepage(status, locale)` | `Homepage` یا `null` |

نام کوئری‌ها و فیلدها از `pluralName` و `singularName` به شکل camelCase می‌آیند
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

همان درخواست از طریق REST:

```http
GET /api/articles?filters[category][name][$eq]=News&filters[title][$containsi]=rust
  &sort=publishedAt:desc&pagination[page]=1&pagination[pageSize]=10
  &populate[category][fields][0]=name&populate[tags][sort]=label:asc&populate[0]=seo&populate[1]=blocks
```

### آرگومان‌ها

- **`filters`**: یک `ArticleFiltersInput` با یک فیلد برای هر ویژگی، به‌علاوهٔ `documentId`،
  برچسب‌های زمانی، و `and`، `or` و `not`. فیلدهای اسکالر ورودی‌های عملگر مانند
  `StringFilterInput` می‌گیرند که عملگرهایشان همان [عملگرهای REST](/fa/api/rest/#فیلترها) بدون
  `$` هستند: `eq`، `ne`، `containsi`، `in`، `between`، `null`… روابط ورودی فیلتر هدف را
  می‌گیرند، و کامپوننت‌های غیرتکرارشونده ورودی فیلتر کامپوننت خود را.
- **`pagination`**: `{ page, pageSize }` یا `{ start, limit }`، با پیش‌فرض‌ها و بیشینهٔ REST.
- **`sort`**: فهرستی از رشته‌های `"field"` یا `"field:asc|desc"`، مانند REST.
- **`status`**: `PUBLISHED` (پیش‌فرض) یا `DRAFT` که به مجوز `readDrafts` نیاز دارد. سندهای
  مرتبط همیشه از وضعیت والدشان پیروی می‌کنند.
- **`locale`**: کد یک زبان برای نوع‌های بومی‌سازی‌شده؛ در غیر این صورت زبان پیش‌فرض.

فقط آنچه انتخاب می‌کنید بارگذاری می‌شود: انتخاب به `populate` در REST تبدیل می‌شود و هر سطح از
روابط یک کوئری دسته‌ای است. `pageInfo` در `articles_connection` همهٔ نتایج مطابق (`total`) و
صفحه‌ها (`pageCount`) را می‌شمارد.

## Mutationها

| نوع مجموعه‌ای `article` | برمی‌گرداند |
| --- | --- |
| `createArticle(data: ArticleInput!, status, locale)` | `Article` |
| `updateArticle(documentId: ID!, data: ArticleInput!, status, locale)` | `Article` |
| `deleteArticle(documentId: ID!, locale)` | `DeleteMutationResponse` (`{ documentId }`) |

| نوع تکی `homepage` | برمی‌گرداند |
| --- | --- |
| `updateHomepage(data: HomepageInput!, status, locale)` | `Homepage`؛ نخستین به‌روزرسانی سند را می‌سازد |
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

- مانند REST، `create` و `update` منتشر می‌کنند مگر اینکه `status: DRAFT` باشد. mutation
  جداگانه‌ای برای انتشار وجود ندارد: برای لغو انتشار یا کنار گذاشتن یک پیش‌نویس از
  [کنش‌های](/fa/api/rest/#کنشها) REST استفاده کنید.
- ورودی‌ها بازتاب ویژگی‌ها هستند: روابط `ID` یا `[ID!]` (`documentId`ها) می‌گیرند، رسانه‌ها
  شناسهٔ فایل، کامپوننت‌ها نوع `…Input` خود را، و آیتم‌های ناحیهٔ پویا اشیای `JSON` با یک
  `__component` هستند. روابط معکوس (`mappedBy`) در ورودی‌ها نیستند.
- mutationهای `delete` نسخهٔ `locale` را حذف می‌کنند (بدون آن، زبان پیش‌فرض را)، مانند
  `DELETE /api/articles/{documentId}?locale=fr`.
- همان اعتبارسنجی REST اجرا می‌شود.

## خطاها

خطاهای GraphQL در فهرست `errors` یک پاسخ `200` می‌آیند، با یک کد در `extensions.code`:

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

| کد | چه زمانی |
| --- | --- |
| `FORBIDDEN` | فراخواننده مجوز آن عملیات را ندارد، یا برای `status: DRAFT` مجوز `readDrafts` را ندارد. |
| `BAD_USER_INPUT` | آرگومان‌ها یا محتوای نامعتبر؛ `details` مشکلات اعتبارسنجی را با مسیرهایشان فهرست می‌کند. |
| `NOT_FOUND` | سند وجود ندارد (در به‌روزرسانی‌ها و حذف‌ها). |
| `INTERNAL_SERVER_ERROR` | یک خطای غیرمنتظره که روی سرور در لاگ ثبت می‌شود. |

کوئری‌هایی عمیق‌تر از `maxDepth` یا پیچیده‌تر از `maxComplexity` پیش از اجرا رد می‌شوند.

## محدودیت‌ها

GraphQL علاوه بر محدودیت‌های REST API، محدودیت‌های خودش را دارد (`maxDepth`، `maxComplexity`):
حداکثر `[api].max_page_size` سند در هر فهرست، روابط تودرتو حداکثر تا 5 سطح، حداکثر 1,000 سند
مرتبط برای هر سند و رابطه، و حداکثر 100 شرط فیلتر. نگاه کنید به
[محدودیت‌های REST](/fa/api/rest/#محدودیتها).

## افزونه‌ها

[افزونه‌ها](/fa/extending/plugins/) می‌توانند کوئری‌ها و mutationهای ریشه به شکل
`name(args: JSON): JSON` اضافه کنند. نام‌هایی که نوع‌های محتوا از قبل استفاده کرده‌اند نادیده
گرفته می‌شوند.

## مقایسه با Strapi

نام نوع‌ها، کوئری‌ها و mutationها، کوئری‌های `_connection` با `nodes` و `pageInfo`، آرگومان‌های
`documentId`، `status` و `locale` از افزونهٔ GraphQL در Strapi v5 پیروی می‌کنند، و نوع‌های
بومی‌سازی‌شده یک فیلد `locale` دارند. نوع‌ها `id` را ارائه نمی‌کنند و subscriptionهای GraphQL
وجود ندارد؛ برای به‌روزرسانی‌های زنده از [realtime API](/fa/api/realtime/) استفاده کنید.
