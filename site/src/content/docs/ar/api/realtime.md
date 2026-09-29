---
title: "API الوقت الفعلي"
description: "بروتوكول Server-Sent Events لبث Verdin في الوقت الفعلي: نقطة النهاية والمصادقة وأسماء الأحداث وأشكال الرسائل، وبروتوكول الحضور في لوحة الإدارة."
sidebar:
  order: 5
  label: "الوقت الفعلي"
---

يبث Verdin تغييرات المحتوى والوسائط لحظة اعتمادها (commit)، عبر
[Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events) (SSE).
لا يتلقى كل مشترك إلا الأحداث المتعلقة بما يُسمح له بقراءته. تصف هذه الصفحة
البروتوكول؛ ولاستخدامه في واجهة أمامية، راجع [التحديثات في الوقت الفعلي](/ar/guides/frontend/realtime/).

## تفعيله

الوقت الفعلي معطّل افتراضيًا. فعّله من **الإعدادات ← الميزات ← الوقت الفعلي** (الصلاحية
`features.manage`). ما دام معطّلًا، تجيب نقاط النهاية بـ `404`.

## بث المحتوى

```
GET /api/_events
GET /api/_events?types=api::article,api::category
```

| المعامل | الوصف |
| --- | --- |
| `types` | اختياري، قيم UID لأنواع المحتوى مفصولة بفواصل؛ `plugin::upload` هو مكتبة الوسائط. تعمل صيغة Strapi `api::article.article` أيضًا. بدونه، تتلقى كل نوع يُسمح لك بقراءته. |

صادِق كما في REST API: رمز API أو JWT لمستخدم نهائي في
`Authorization: Bearer …`، أو بلا ترويسة للوصول العام. رمز غير صالح يجيب بـ `401`
قبل فتح البث.

```sh title="Terminal"
curl -N -H "Authorization: Bearer $VERDIN_TOKEN" \
  'https://cms.example.com/api/_events?types=api::article'
```

```text
event: ready
data: {}

event: entry.publish
data: {"event":"entry.publish","uid":"api::article","documentId":"k2m7q4dx8n5t1v3b9c0e6a2wfr","locale":"en"}

event: media.create
data: {"event":"media.create","uid":"plugin::upload","documentId":"v3k9…","fileId":5}
```

## الرسائل

الحدث الأول دائمًا `ready`. بعد ذلك كل تغيير حدث SSE يحمل اسمه، و`data`
الخاص به كائن JSON:

| الحقل | متى يوجد | الوصف |
| --- | --- | --- |
| `event` | دائمًا | اسم الحدث، كما في سطر `event:` في SSE. |
| `uid` | دائمًا | UID نوع المحتوى، أو `plugin::upload` للوسائط. |
| `documentId` | دائمًا | المستند أو الملف الذي تغيّر. |
| `locale` | الأنواع المترجمة | لغة النسخة التي تغيّرت. |
| `fileId` | أحداث الوسائط | المعرّف الرقمي للملف، كما يُستخدم في حقول الوسائط. |
| `actorId` | بث الإدارة | المسؤول الذي أجرى التغيير، عندما يكون من أجراه مسؤولًا. |

| الأحداث | تُرسل عندما | من يتلقاها |
| --- | --- | --- |
| `entry.create`، `entry.update`، `entry.discard-draft` | يُنشأ مستند، أو يُحفظ، أو تُتجاهل مسودته | في أنواع المسودة والنشر، المستدعون الذين لديهم `readDrafts` (هذه الأحداث لا تغيّر إلا المسودات). وفي الأنواع الأخرى، المستدعون الذين لديهم `find` أو `findOne`. |
| `entry.publish`، `entry.unpublish`، `entry.delete` | يُنشر مستند، أو يُلغى نشره، أو يُحذف | المستدعون الذين لديهم `find` أو `findOne` على النوع |
| `media.create`، `media.update`، `media.delete` | يُرفع ملف، أو يُعدَّل، أو يُحذف | المستدعون الذين لديهم `find` أو `findOne` على مكتبة الوسائط |

تحمل الأحداث معرّفات، لا محتوى. اجلب المستند أو الملف عبر REST أو GraphQL API لقراءته،
بالصلاحيات المعتادة للمستدعي. تأتي الأحداث من كل الواجهات: REST وGraphQL ولوحة
الإدارة وحزم النشر والإضافات.

## مدة الاتصال

- يرسل الخادم تعليق keep-alive كل 15 ثانية.
- ينتهي بث المحتوى بعد ساعة واحدة. أعِد الاتصال (يفعل `EventSource` في المتصفحات ذلك
  تلقائيًا)، وهو ما يتحقق من الرمز مرة أخرى أيضًا.
- حدث باسم `lagged`، مع `data: {"missed": 12}`، يعني أن العميل قرأ ببطء شديد
  وأن هذا العدد من الأحداث قد أُسقط. أعِد جلب ما يعرضه العميل.
- لا توجد إعادة تشغيل: الأحداث التي تقع أثناء انقطاع العميل لا تُرسل لاحقًا.

لا يستطيع `EventSource` في المتصفحات إرسال ترويسة `Authorization`. للوصول العام يعمل كما
هو؛ ومع رمز، استخدم `fetch` مع قارئ جسم متدفق، أو عميل SSE يدعم
الترويسات.

## بث الإدارة

تفتح لوحة الإدارة بثها الخاص برمز الوصول الخاص بالمسؤول:

```
GET /admin/api/events?types=api::article
```

يحمل أحداث المحتوى والوسائط نفسها للأنواع التي يُسمح للمسؤول بقراءتها (مع
`content.read` و`media.read`)، بما في ذلك المسودات، بالإضافة إلى:

- `actorId` في التغييرات التي يجريها المسؤولون؛
- أحداث `presence` (أدناه)؛
- `comment.create`، `comment.update`، `comment.delete`، `comment.resolve`،
  `comment.reopen`، `task.create`، `task.update` و`task.delete`، مع `uid`
  و`documentId` و`locale` الخاصة بالإدخال.

ينتهي بث الإدارة بعد 15 دقيقة، وهي مدة صلاحية رمز الوصول: أعِد الاتصال برمز
جديد.

### الحضور

يخبر محرر الإدخال الخادمَ بمن يوجد على إدخال ما:

```
POST /admin/api/presence
{ "uid": "api::article", "documentId": "k2m7q4…", "locale": "en", "editing": true }
```

- أرسله كل 20 ثانية تقريبًا ما دام المحرر مفتوحًا. تعني `editing: true` أن لدى المسؤول
  تغييرات غير محفوظة. أرسل `"leave": true` عند إغلاق المحرر.
- ينتهي الحضور بعد 45 ثانية من آخر نبضة (heartbeat).
- تسرد الإجابة من يوجد على الإدخال: `{ "data": [{ "userId": 3, "name": "Ada Lovelace", "editing": true, "holdsLock": true }] }`.
- يقرأ `GET /admin/api/presence?uid=&documentId=&locale=` القائمة نفسها.
- عندما تتغير القائمة، تتلقى بثوث الإدارة حدث `presence` مع `uid` الخاص بالإدخال
  و`documentId` و`locale` والقائمة في `presence`.

أول مسؤول لا يزال يحرر يمسك قفلًا مرنًا (`holdsLock`). يعرضه المحرر
للآخرين، لكنه لا يمنعهم من الحفظ. تتطلب قراءة الحضور `content.read` على النوع.

## عدة نسخ

الأحداث والحضور هي تلك الخاصة بالنسخة (instance) المتصل بها العميل. خلف موازن
أحمال، وجّه `/api/_events` و`/admin/api/events` بجلسات لاصقة (sticky sessions)، أو شغّل عملاء
الوقت الفعلي على نسخة واحدة. راجع [التوسّع](/ar/deploy/scaling/).
