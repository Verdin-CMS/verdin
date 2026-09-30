---
title: ذخیره‌سازی
description: Verdin محتوا را چگونه در پایگاه داده می‌چیند، از نام جدول‌ها و ستون‌های سیستمی تا ردیف‌های پیش‌نویس و منتشرشده، پیوندهای روابط، JSON کامپوننت‌ها و جدول‌های پلتفرم.
sidebar:
  order: 2
---

این صفحه جدول‌هایی را که Verdin از طرح‌وارهٔ شما مشتق می‌کند و نحوهٔ ذخیرهٔ هر گونه ویژگی را شرح می‌دهد. پیش از تغییر هر چیزی در `crates/verdin-migrate/src/derive.rs` یا Document Service (سرویس سند)، یا وقتی لازم است مستقیماً از پایگاه داده کوئری بگیرید، آن را بخوانید. برای آنچه هر نوع ویژگی می‌پذیرد، [نوع‌های ویژگی](/fa/reference/attribute-types/) را ببینید.

شما هرگز این جدول‌ها را دستی نمی‌نویسید: [موتور مهاجرت](/fa/internals/migrations/) آن‌ها را از طرح‌واره می‌سازد و تکامل می‌دهد.

## قراردادهای نام‌گذاری

| شیء | نام |
|---|---|
| جدول نوع محتوا | `collectionName`، که پیش‌فرض آن `pluralName` است با تبدیل خط‌تیره‌ها به زیرخط (`blog-posts` → `blog_posts`) |
| ستون | نام ویژگی به شکل snake case (`metaTitle` → `meta_title`) |
| پیوندهای رابطه | `{table}_{column}_lnk` |
| پیوندهای رابطهٔ چندریختی | `{table}_{column}_mph` |
| پیوندهای رسانه | `{table}_{column}_mda` |
| نمایه | `{table}_{part}_uq` برای نمایه‌های یکتا، `{table}_{part}_idx` برای بقیه |
| جدول پلتفرم | پیشوند `vd_` (`vd_admin_users`، `vd_schema_snapshots`…) |

قاعده‌هایی که اعتبارسنج طرح‌واره اعمال می‌کند (`crates/verdin-schema/src/naming.rs` و `validate.rs`):

- یک `collectionName` با `^[a-z][a-z0-9_]*$` تطبیق می‌کند، حداکثر 50 نویسه دارد و نمی‌تواند با `vd_` شروع شود.
- `singularName` و `pluralName` به شکل kebab case هستند (`^[a-z][a-z0-9-]*$`، بدون خط‌تیرهٔ آغازین، پایانی یا دوتایی). `upload`، `uploads`، `auth`، `users` و `connect` رزرو شده‌اند، چون API محتوا از این مسیرها استفاده می‌کند.
- نام ویژگی‌ها با یک حرف شروع می‌شوند و با حروف، ارقام یا زیرخط ادامه می‌یابند (قاعدهٔ Strapi) و حداکثر 50 نویسه دارند.
- در نوع‌های محتوا، `id`، `documentId`، `locale`، `publicationState`، `publishedAt`، `createdAt`، `updatedAt`، `createdBy` و `updatedBy` رزرو شده‌اند، و همین‌طور هر نامی که شکل snake case آن با این‌ها برخورد کند. در کامپوننت‌ها، `id` رزرو شده است.
- شناسه‌های تولیدشده حداکثر 60 نویسه دارند (PostgreSQL تا 63 و MySQL تا 64 را مجاز می‌داند). نام طولانی‌تر بریده می‌شود و یک هش 8 نویسه‌ای از نام کامل به آن اضافه می‌شود، تا نام‌های طولانی متمایز، متمایز بمانند و نتیجه قطعی باشد.

هر شناسه در SQL تولیدشده نقل‌قول می‌شود، بنابراین واژه‌های رزروشدهٔ SQL نام‌های معتبری برای ویژگی‌اند.

## ستون‌های سیستمی

هر جدول نوع محتوا با این ستون‌ها شروع می‌شود:

```sql
id                 BIGINT       primary key, auto-increment
document_id        CHAR(26)     NOT NULL           -- ULID, shared by every version of a document
locale             VARCHAR(16)  NOT NULL DEFAULT '' -- '' for types that are not localized
publication_state  SMALLINT     NOT NULL           -- 0 = draft, 1 = published
published_at       <datetime>   NULL
created_at         <datetime>   NOT NULL
updated_at         <datetime>   NOT NULL
created_by_id      BIGINT       NULL               -- vd_admin_users.id
updated_by_id      BIGINT       NULL
UNIQUE (document_id, locale, publication_state)
INDEX  (publication_state, locale)
```

- `document_id` یک ULID با حروف کوچک است که هنگام ساختن تولید می‌شود. در پیش‌نویس، نسخهٔ منتشرشده و همهٔ زبان‌ها ثابت می‌ماند.
- نوع‌هایی که بومی‌سازی‌شده نیستند به جای `NULL` از `locale = ''` استفاده می‌کنند، چون NULLها در نمایه‌های یکتا روی هیچ موتوری با هم برخورد نمی‌کنند، و این قید `(document_id, locale, publication_state)` را می‌شکند.
- ستون وضعیت `publication_state` است، نه `state`، چون `state` نام رایجی برای ویژگی است.

پس از آن ستون‌های ویژگی می‌آیند، یکی برای هر ویژگی اسکالر. **هر ستون ویژگی nullable است.** مانند Strapi v5، پیش‌نویس‌ها می‌توانند ناقص باشند، بنابراین `required` هنگام انتشار یک نسخه (یا در هر نوشتن روی نوع‌های بدون پیش‌نویس و انتشار) بررسی می‌شود، نه توسط پایگاه داده. همین باعث می‌شود افزودن یک ویژگی الزامی یک مهاجرت امن باشد.

ویژگی‌های `unique`، و هر `uid`، یک نمایهٔ یکتا روی `(column, locale, publication_state)` می‌گیرند. یک پیش‌نویس و نسخهٔ منتشرشدهٔ آن می‌توانند مقدار مشترک داشته باشند، دو سند منتشرشده نمی‌توانند، و پایگاه داده این را بدون شرایط رقابتی (race) اعمال می‌کند. نقض آن به شکل یک `ValidationError` روی همان فیلد گزارش می‌شود.

## پیش‌نویس و انتشار

Verdin از مدل Strapi v5 پیروی می‌کند. برای دید کاربر، [پیش‌نویس و انتشار](/fa/concepts/draft-and-publish/) را ببینید؛ این چیزی است که در جدول رخ می‌دهد.

- یک سند برای هر زبان حداکثر یک ردیف پیش‌نویس (`publication_state = 0`) و یک ردیف منتشرشده (`publication_state = 1`) دارد.
- نوشتن‌ها از پنل مدیریت ردیف پیش‌نویس را هدف می‌گیرند.
- **انتشار** ویژگی‌های `required` و قاعده‌های اعتبارسنجی را روی پیش‌نویس بررسی می‌کند، سپس مقدارهای ویژگی پیش‌نویس را روی ردیف منتشرشده کپی می‌کند (آن را به‌روز می‌کند، یا بار اول درج می‌کند)، در یک تراکنش. پیوندهای رابطه و رسانهٔ پیش‌نویس هم با آن کپی می‌شوند.
- **لغو انتشار** ردیف منتشرشده را حذف می‌کند. پیوندهای آن از طریق `ON DELETE CASCADE` همراهش حذف می‌شوند.
- **کنار گذاشتن پیش‌نویس** پیش‌نویس را با مقدارها و پیوندهای ردیف منتشرشده بازنویسی می‌کند.
- نوع‌های محتوای بدون پیش‌نویس و انتشار همیشه فقط یک ردیف منتشرشده دارند.
- در نوع‌های بومی‌سازی‌شده، ویژگی‌هایی که بومی‌سازی‌شده نیستند مشترک‌اند: انتشار یک زبان آن‌ها را روی ردیف‌های منتشرشدهٔ زبان‌های دیگر کپی می‌کند.

## روابط: پیوند با شناسهٔ سند

**این تفاوت اصلی با ذخیره‌سازی Strapi است.** Strapi ردیف‌ها را با شناسهٔ ردیف پیوند می‌دهد و هنگام انتشار باید پیوندها را بازنویسی کند. Verdin یک رابطه را به شکل *ردیف مبدأ ← سند مقصد* ذخیره می‌کند:

```sql
-- articles_category_lnk
id                  BIGINT   primary key, auto-increment
source_id           BIGINT   NOT NULL REFERENCES articles(id) ON DELETE CASCADE
target_document_id  CHAR(26) NOT NULL
position            DOUBLE   NOT NULL   -- 1..n, rewritten on every write
UNIQUE (source_id, target_document_id)
UNIQUE (source_id)                      -- to-one kinds only
INDEX  (target_document_id)
```

- ردیف مقصد در زمان خواندن و در نسخه‌ای که خوانده می‌شود انتخاب می‌شود: یک مقالهٔ منتشرشده دسته‌های منتشرشده را می‌بیند و یک پیش‌نویس، پیش‌نویس‌ها را. اگر یک دسته از انتشار خارج شود، بدون دست زدن به هیچ پیوندی از مقاله‌های منتشرشده ناپدید می‌شود.
- انتشار فقط پیوندهای خود ردیف مبدأ را کپی می‌کند.
- فقط سمت **مالک** (ویژگی دارای `inversedBy`، یا یک رابطهٔ یک‌طرفه) جدول پیوند دارد. سمت معکوس (`mappedBy`) همان جدول را برعکس می‌خواند و فقط‌خواندنی است: نوشتن در آن خطای اعتبارسنجی است که ویژگی مالک را نام می‌برد.
- «حداکثر یک مقصد» (`oneToOne`، `manyToOne`، `oneWay`) همان نمایهٔ یکتا روی `source_id` است. «هر مقصد به یک سند مبدأ تعلق دارد» (`oneToOne`، `oneToMany`) نمی‌تواند یک نمایه باشد، چون یک پیش‌نویس و نسخهٔ منتشرشدهٔ آن به‌طور مشروع مقصدهای مشترک دارند. Document Service آن را با *جابه‌جا کردن* مقصد اعمال می‌کند: پیوند دادن آن، پیوندهایی را که سندهای دیگر در همان وضعیت به آن دارند حذف می‌کند، که همان رفتار Strapi است.
- هیچ کلید خارجی روی `target_document_id` وجود ندارد، چون `document_id` در جدول مقصد یکتا نیست. Document Service پیوند به سندهایی را که وجود ندارند رد می‌کند و وقتی آخرین نسخهٔ یک سند حذف می‌شود، پیوندهایی را که به آن اشاره می‌کنند در همان تراکنش حذف می‌کند.
- ردیف‌های پیوند یک کلید اصلی `id` دارند، بنابراین جدول‌های پیوند برای موتور مهاجرت و بازسازی جدول‌ها در SQLite مانند هر جدول دیگری به نظر می‌رسند.
- تغییرنام یک جدول، جدول‌های پیوند آن را هم تغییرنام می‌دهد. مهاجرت‌ها با `foreign_keys` خاموش در SQLite اجرا می‌شوند، بنابراین بازسازی یک جدول به جدول‌های پیوند آن cascade نمی‌شود.

**روابط چندریختی** (`morphToOne`، `morphToMany`) سندهایی از هر نوع محتوایی را پیوند می‌دهند. پیوندهای آن‌ها در `{table}_{column}_mph` با `source_id`، `target_type` (uid مقصد)، `target_document_id` و `position` قرار دارند، با یک `(source_id, target_type, target_document_id)` یکتا، و برای `morphToOne` یک `source_id` یکتا. سمت‌های معکوس (`morphOne`، `morphMany`) جدولی ندارند: پیوندهای مالک را که به آن‌ها اشاره می‌کنند می‌خوانند و فقط‌خواندنی‌اند. حذف یک سند پیوندهای چندریختی به آن را حذف می‌کند. برای آنچه با آن‌ها می‌توانید و نمی‌توانید انجام دهید، [روابط](/fa/concepts/relations/) را ببینید.

## کامپوننت‌ها و ناحیه‌های پویا: یک ستون JSON

یک ویژگی کامپوننت یا یک ناحیهٔ پویا **یک ستون JSON** روی ردیف سند است (`jsonb` در PostgreSQL، `json` در MySQL و MariaDB، `text` در SQLite). Strapi هر کامپوننت را در جدول خودش با جدول‌های اتصال چندریختی ذخیره می‌کند؛ یک ستون از این joinها جلوگیری می‌کند و انتشار و تاریخچه را به یک کپی ساده تبدیل می‌کند.

```json
// "seo" column (a single component)
{ "id": 1, "metaTitle": "…", "metaDescription": "…" }

// "blocks" column (a dynamic zone)
[
  { "id": 1, "__component": "blocks.hero", "title": "…" },
  { "id": 2, "__component": "blocks.quote", "text": "…", "author": "…" }
]
```

- هر آیتم کامپوننت یک `id` عدد صحیح دارد که درون ویژگی خودش یکتاست. آیتم‌های جدید عدد آزاد بعدی را می‌گیرند.
- داده‌ها در هر نوشتن با طرح‌وارهٔ کامپوننت اعتبارسنجی می‌شوند.
- انتشار و کنار گذاشتن پیش‌نویس، JSON را همان‌طور که هست کپی می‌کنند.
- **روابط و رسانه درون کامپوننت‌ها** در خود JSON ذخیره می‌شوند: `documentId` برای روابط (آنجا فقط `oneWay` و `manyWay` مجازند) و شناسهٔ فایل برای رسانه. هنگام نوشتن بررسی می‌شوند و وقتی کامپوننت populate شود با کوئری‌های دسته‌ای resolve می‌شوند. روابط چندریختی و ویژگی‌های `password` نمی‌توانند درون کامپوننت‌ها باشند.
- **فیلتر کردن** به تابع‌های JSON مخصوص هر گویش نیاز دارد. فیلدهای اسکالر کامپوننت‌های تکی از طریق یک مسیر JSON خوانده می‌شوند (`#>>` در PostgreSQL، `JSON_VALUE` در MySQL و MariaDB، `json_extract` در SQLite). کامپوننت‌های تکرارشونده از `EXISTS` روی آیتم‌های آرایه استفاده می‌کنند (`jsonb_array_elements`، `JSON_TABLE`، `json_each`). ناحیه‌های پویا فقط با `__component` قابل فیلترند، چون آیتم‌هایشان فیلدهای متفاوتی دارند.

برای جنبهٔ مدل‌سازی، [کامپوننت‌ها و ناحیه‌های پویا](/fa/concepts/components-and-dynamic-zones/) را ببینید.

## جدول‌های پلتفرم

جدول‌های پلتفرم بخشی از هر مدل مشتق‌شده‌اند، بنابراین موتور مهاجرت آن‌ها را دقیقاً مانند جدول‌های محتوا می‌سازد و تکامل می‌دهد؛ در `verdin migrate plan` به‌صورت گام‌های امن نمایش داده می‌شوند. در `crates/verdin-migrate/src/system.rs` تعریف شده‌اند.

| حوزه | جدول‌ها |
|---|---|
| مهاجرت‌ها | `vd_schema_snapshots`، `vd_migrations_journal` (متعلق به موتور مهاجرت، در نخستین استفاده ساخته می‌شوند) |
| مدیران | `vd_admin_users`، `vd_admin_roles`، `vd_admin_user_roles`، `vd_admin_permissions`، `vd_sessions` (توکن‌های refresh)، `vd_admin_tokens` (پیوندهای دعوت و بازنشانی)، `vd_admin_two_factor`، `vd_admin_passkeys`، `vd_spent_challenges` |
| دسترسی به API محتوا | `vd_api_tokens`، `vd_api_token_permissions`، `vd_public_permissions` |
| کاربران نهایی | `vd_users`، `vd_user_roles`، `vd_user_role_permissions`، `vd_end_user_sessions` |
| نمونه | `vd_settings` (کلیدهای قابلیت‌ها، چیدمان‌های edit-view، نشانگرهای ارتقای یک‌باره)، `vd_locales`، `vd_cluster_events` (گذرگاه رویداد مشترک؛ [چند نمونه](/fa/deploy/scaling/) را ببینید) |
| رسانه | `vd_files`، `vd_folders` |
| گردش‌کار محتوا | `vd_history_versions`، `vd_releases`، `vd_release_actions`، `vd_workflows`، `vd_workflow_stages`، `vd_document_stages` |
| همکاری | `vd_comments`، `vd_tasks`، `vd_document_views`، `vd_document_votes`، `vd_polls`، `vd_poll_votes` |
| یکپارچه‌سازی‌ها | `vd_webhooks`، `vd_webhook_deliveries`، `vd_deploy_targets`، `vd_deployments`، `vd_plugin_kv`، `vd_audit_logs` |
| قابلیت‌های سایت | `vd_redirects`، `vd_menus`، `vd_forms`، `vd_form_submissions` |

## جدول‌های رسانه

فایل‌ها ردیف‌های `vd_files` با شکل Strapi هستند (`name`، `alternative_text`، `caption`، `width`، `height`، `formats`، `hash`، `ext`، `mime`، `size`، `url`، `provider`…)، به‌علاوهٔ `focal_point`، `folder_id` و `folder_path`. پوشه‌ها (`vd_folders`) همان `path` متشکل از `path_id`ها در Strapi را نگه می‌دارند، مانند `/1/4`.

یک ویژگی رسانه یک جدول پیوند `{table}_{column}_mda` با `source_id` (ردیف محتوا)، `file_id` (یک ردیف از `vd_files`) و `position` است. یک `(source_id, file_id)` یکتا دارد و وقتی ویژگی `multiple` نباشد، یک `source_id` یکتا. هر دو ستون کلید خارجی با `ON DELETE CASCADE` هستند، بنابراین حذف یک فایل یا یک ردیف پیوندهای آن را حذف می‌کند. پیوندهای رسانه از همان قاعده‌های پیش‌نویس و انتشار پیوندهای رابطه پیروی می‌کنند: هر نسخه مالک پیوندهای خودش است و انتشار آن‌ها را کپی می‌کند.

نحوهٔ کار بارگذاری‌ها، قالب‌ها و ارائه‌دهنده‌های ذخیره‌سازی در [رسانه](/fa/concepts/media/) آمده است.
