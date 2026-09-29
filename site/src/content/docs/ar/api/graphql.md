---
title: "GraphQL API"
description: "تفعيل نقطة نهاية GraphQL في Verdin، والمخطط الذي تولّده من أنواع محتواك، والاستعلامات والطفرات والاتصالات والأخطاء والحدود."
sidebar:
  order: 2
  label: "GraphQL"
---

يمكن لـ Verdin تقديم GraphQL API مولَّد من أنواع محتواك، على شكل إضافة GraphQL في
Strapi v5. وهو يشارك REST API صلاحياته وعوامل التصفية والتقسيم إلى صفحات والتحقق:
تُترجَم وسائط GraphQL إلى الاستعلام نفسه الذي يُجريه طلب REST. هذه الصفحة هي المرجع؛
وتستخدم الأمثلة [مثال المدونة](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog).

## تفعيله

GraphQL معطّل افتراضيًا. فعّله من **الإعدادات ← الميزات ← GraphQL** (الصلاحية
`features.manage`). يُطبَّق التغيير فورًا، دون إعادة تشغيل، ونقطة النهاية هي:

```
POST /graphql
```

تُقدَّم من جذر الخادم، لا تحت بادئة REST. أرسل
`{ "query", "variables", "operationName" }` بصيغة JSON. ويشغّل `GET /graphql?query=…` الاستعلامات أيضًا
(تحتاج الطفرات إلى `POST`).

```sh title="Terminal"
curl -X POST 'https://cms.example.com/graphql' \
  -H "Authorization: Bearer $VERDIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ articles(sort: [\"publishedAt:desc\"]) { documentId title } }"}'
```

يصادق المستدعون كما في REST API: بلا ترويسة للوصول العام، أو برمز API، أو بـ JWT
لمستخدم نهائي. ترويسة `Authorization` مشوّهة أو رمز غير معروف يجيب بـ `401`. راجع
[الصلاحيات](/ar/concepts/permissions/). تحتاج المتصفحات من مصادر أخرى إلى `[api].cors_origins`.

### الإعدادات

| الإعداد | الافتراضي | المكان | الأثر |
| --- | --- | --- | --- |
| **بيئة GraphiQL التجريبية** | مفعّل في `verdin dev`، ومعطّل في `verdin start` | إعدادات الميزة | يقدّم GraphiQL عندما يفتح متصفح `GET /graphql`. يُحمَّل من unpkg.com. |
| **الاستبطان** | مفعّل | إعدادات الميزة | يتيح للعملاء والأدوات قراءة المخطط. أوقفه لإخفاء المخطط عن العامة. |
| **العمليات المعطّلة** | لا شيء | إعدادات الميزة | لكل نوع محتوى، يستبعد `find` أو `findOne` أو `create` أو `update` أو `delete` (أو كل الاستعلامات، أو كل الطفرات، أو كل شيء) من المخطط، مثل مفاتيح shadow CRUD في Strapi. لا يتأثر REST. |
| `maxDepth` | `10` | API الإدارة | أعمق تحديد مسموح به. |
| `maxComplexity` | `1000` | API الإدارة | أعلى تعقيد مسموح به للاستعلام (تقريبًا، عدد الحقول المحدَّدة). |

ليس لـ `maxDepth` و`maxComplexity` حقل في اللوحة بعد. عيّنهما عبر
[API الإدارة](/ar/api/admin/): يعيد `GET /admin/api/features` الإعدادات الحالية، ويستبدلها
`PUT /admin/api/features/graphql`، لذا أرسل أيضًا الإعدادات التي تريد الإبقاء عليها:

```json
{ "enabled": true, "settings": { "playground": false, "introspection": true, "maxDepth": 8, "maxComplexity": 500 } }
```

## المخطط

لكل نوع محتوى، يحتوي المخطط على نوع كائن يحمل اسم `singularName` بصيغة
PascalCase (`article` ← `Article`، `blog-post` ← `BlogPost`)، ويضم:

- `documentId: ID!`
- كل سمة ليست `private`
- `createdAt` و`updatedAt` و`publishedAt`، من نوع `DateTime`
- `locale: String`، في الأنواع المترجمة

| السمة | نوع GraphQL |
| --- | --- |
| `string`، `text`، `richtext`، `email`، `uid`، `enumeration` | `String` |
| `integer` | `Int` |
| `biginteger` | `Long` (سلسلة نصية، كما في REST) |
| `float`، `decimal` | `Float` |
| `boolean` | `Boolean` |
| `date`، `time`، `datetime` | `Date`، `Time`، `DateTime` |
| `json`، `blocks` | `JSON` |
| علاقة إلى واحد | نوع الهدف، مثل `Category` |
| علاقة إلى متعدد | `[Tag!]!`، مع الوسائط `filters` و`pagination` و`sort` |
| `media` | `UploadFile`، أو `[UploadFile!]!` عند `multiple` |
| `component` | `ComponentSharedSeo` (من الـ UID `shared.seo`)، أو قائمة عندما يكون قابلًا للتكرار |
| `dynamiczone` | `[ArticleBlocksDynamicZone!]!`، اتحاد (union) من مكوّناتها |
| علاقة متعددة الأشكال | `JSON` (مستندات مع `__type` الخاص بها) |

يحتوي `Query` الجذر أيضًا على `verdin: String!`، أي إصدار الخادم.

## الاستعلامات

| نوع المجموعة `article` | يعيد |
| --- | --- |
| `articles(filters, pagination, sort, status, locale)` | `[Article!]!` |
| `articles_connection(filters, pagination, sort, status, locale)` | `ArticleEntityResponseCollection` مع `nodes` و`pageInfo` |
| `article(documentId: ID!, status, locale)` | `Article` أو `null` |

| النوع المفرد `homepage` | يعيد |
| --- | --- |
| `homepage(status, locale)` | `Homepage` أو `null` |

تأتي أسماء الاستعلامات والحقول من `pluralName` و`singularName` بصيغة camelCase
(`blog-posts` ← `blogPosts`).

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

الطلب نفسه عبر REST:

```http
GET /api/articles?filters[category][name][$eq]=News&filters[title][$containsi]=rust
  &sort=publishedAt:desc&pagination[page]=1&pagination[pageSize]=10
  &populate[category][fields][0]=name&populate[tags][sort]=label:asc&populate[0]=seo&populate[1]=blocks
```

### الوسائط

- **`filters`**: قيمة `ArticleFiltersInput` بحقل لكل سمة، بالإضافة إلى `documentId`
  والطوابع الزمنية، و`and` و`or` و`not`. تأخذ الحقول العددية مدخلات عوامل مثل
  `StringFilterInput`، وعواملها هي [عوامل REST](/ar/api/rest/#التصفية) دون
  `$`: `eq`، `ne`، `containsi`، `in`، `between`، `null`… تأخذ العلاقات مدخل التصفية الخاص بالهدف،
  والمكوّنات غير القابلة للتكرار مدخل مكوّنها.
- **`pagination`**: `{ page, pageSize }` أو `{ start, limit }`، بالقيم الافتراضية والحد الأقصى
  نفسها في REST.
- **`sort`**: قائمة من السلاسل `"field"` أو `"field:asc|desc"`، كما في REST.
- **`status`**: `PUBLISHED` (الافتراضي) أو `DRAFT`، الذي يتطلب الصلاحية `readDrafts`.
  تتبع المستندات المرتبطة دائمًا حالة المستند الأب.
- **`locale`**: رمز لغة للأنواع المترجمة؛ وإلا فاللغة الافتراضية.

لا يُحمَّل إلا ما تحدده: يصبح التحديد هو `populate` في REST، وكل مستوى من
العلاقات استعلام واحد مجمَّع. يعدّ `pageInfo` في `articles_connection` كل التطابقات
(`total`) والصفحات (`pageCount`).

## الطفرات

| نوع المجموعة `article` | يعيد |
| --- | --- |
| `createArticle(data: ArticleInput!, status, locale)` | `Article` |
| `updateArticle(documentId: ID!, data: ArticleInput!, status, locale)` | `Article` |
| `deleteArticle(documentId: ID!, locale)` | `DeleteMutationResponse` (`{ documentId }`) |

| النوع المفرد `homepage` | يعيد |
| --- | --- |
| `updateHomepage(data: HomepageInput!, status, locale)` | `Homepage`؛ أول تحديث ينشئ المستند |
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

- كما في REST، تنشر `create` و`update` ما لم يكن `status: DRAFT`. لا توجد طفرات نشر
  منفصلة: استخدم [إجراءات](/ar/api/rest/#الإجراءات) REST لإلغاء النشر أو تجاهل
  مسودة.
- تعكس المدخلات السمات: تأخذ العلاقات `ID` أو `[ID!]` (قيم `documentId`)، وتأخذ الوسائط
  معرّفات الملفات، والمكوّنات نوع `…Input` الخاص بها، وعناصر المنطقة الديناميكية كائنات `JSON` تحتوي
  على `__component`. العلاقات العكسية (`mappedBy`) ليست ضمن المدخلات.
- تحذف طفرات `delete` النسخة في `locale` (اللغة الافتراضية إن لم تُحدَّد)، مثل
  `DELETE /api/articles/{documentId}?locale=fr`.
- يجري التحقق نفسه الذي يجري في REST.

## الأخطاء

تأتي أخطاء GraphQL في قائمة `errors` ضمن استجابة `200`، مع رمز في
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

| الرمز | متى |
| --- | --- |
| `FORBIDDEN` | يفتقر المستدعي إلى الصلاحية للعملية، أو إلى `readDrafts` لـ `status: DRAFT`. |
| `BAD_USER_INPUT` | وسائط أو محتوى غير صالح؛ يسرد `details` مشكلات التحقق مع مساراتها. |
| `NOT_FOUND` | المستند غير موجود (في التحديث والحذف). |
| `INTERNAL_SERVER_ERROR` | خطأ غير متوقع، يُسجَّل على الخادم. |

تُرفض الاستعلامات الأعمق من `maxDepth` أو الأكثر تعقيدًا من `maxComplexity` قبل
تنفيذها.

## الحدود

لـ GraphQL حدوده الخاصة (`maxDepth`، `maxComplexity`) فوق حدود REST API: بحد أقصى
`[api].max_page_size` مستندًا لكل قائمة، وعلاقات متداخلة حتى 5 مستويات على الأكثر، وبحد أقصى 1,000
مستند مرتبط لكل مستند وعلاقة، وبحد أقصى 100 شرط تصفية. راجع
[حدود REST](/ar/api/rest/#الحدود).

## الإضافات

يمكن لـ[الإضافات](/ar/extending/plugins/) إضافة استعلامات وطفرات جذرية بالشكل
`name(args: JSON): JSON`. تُتخطّى الأسماء التي تستخدمها أنواع المحتوى بالفعل.

## مقارنة مع Strapi

تتبع أسماء الأنواع والاستعلامات والطفرات، واستعلامات `_connection` مع `nodes` و`pageInfo`،
ووسائط `documentId`، و`status` و`locale` إضافة GraphQL في Strapi v5، وللأنواع المترجمة
حقل `locale`. لا تكشف الأنواع `id`، ولا توجد اشتراكات GraphQL؛ للتحديثات المباشرة، استخدم
[API الوقت الفعلي](/ar/api/realtime/).
