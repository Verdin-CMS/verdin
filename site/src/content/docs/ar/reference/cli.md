---
title: مرجع سطر الأوامر
description: كل أمر وأمر فرعي وخيار في الملف التنفيذي verdin، مع ما يقرؤه ويكتبه ويطبعه.
sidebar:
  order: 2
  label: سطر الأوامر
---

<!-- Written from crates/verdin/src/cli.rs and crates/verdin/src/new.rs. `npm run check-cli`
(site/scripts/check-cli.mjs) fails when a subcommand or flag in cli.rs is missing here. -->

`verdin` هو الملف التنفيذي الوحيد: ينشئ المشاريع، ويشغّل الخادم، ويطبّق الترحيلات،
ويدير المستخدمين المسؤولين، وينقل المحتوى إلى الداخل والخارج. تسرد هذه الصفحة كل أمر وخيار.

```text title="Terminal"
verdin [OPTIONS] <COMMAND>
```

| الأمر | ما يفعله |
| --- | --- |
| [`verdin new`](#verdin-new) | ينشئ مجلد مشروع. |
| [`verdin dev`](#verdin-dev) | يشغّل الخادم في وضع التطوير. |
| [`verdin start`](#verdin-start) | يشغّل الخادم في وضع الإنتاج. |
| [`verdin schema check`](#verdin-schema-check) | يتحقق من ملفات المخطط. |
| [`verdin migrate plan`](#verdin-migrate-plan) | يعرض خطوات الترحيل وSQL الخاص بها. |
| [`verdin migrate apply`](#verdin-migrate-apply) | يطبّق خطوات الترحيل. |
| [`verdin admin create`](#verdin-admin-create) | ينشئ Super Admin. |
| [`verdin admin reset-password`](#verdin-admin-reset-password) | يعيّن كلمة مرور مسؤول. |
| [`verdin types`](#verdin-types) | يولّد تعريفات TypeScript لـ API المحتوى. |
| [`verdin import strapi`](#verdin-import-strapi) | يستورد تصديرًا من Strapi. |
| [`verdin import verdin`](#verdin-import-verdin) | يستورد تصديرًا من Verdin. |
| [`verdin export`](#verdin-export) | يكتب المشروع في أرشيف `.tar.gz`. |
| [`verdin healthcheck`](#verdin-healthcheck) | يتحقق من أن الخادم المحلي يجيب. |
| [`verdin secrets`](#verdin-secrets) | يطبع أسرارًا جديدة. |
| [`verdin version`](#verdin-version) | يطبع الإصدار. |

## الخيارات العامة

| الخيار | الافتراضي | الوصف |
| --- | --- | --- |
| `-c, --config <CONFIG>` | `verdin.toml` | ملف تهيئة المشروع. يُقرأ أيضًا من `VERDIN_CONFIG`. جذر المشروع هو مجلد الملف: تُحَلّ المسارات النسبية للمخطط والإضافات والملفات المرفوعة وSQLite نسبةً إليه. |
| `-h, --help` | | يطبع المساعدة للأمر. |
| `-V, --version` | | يطبع الإصدار. |

يطبع `verdin help <COMMAND>` المساعدة نفسها التي يطبعها `--help`.

يحمّل كل أمر ما عدا `new` و`secrets` و`version` المشروع أولًا:

1. يقرأ ملف `.env` المجاور لملف التهيئة، إن وُجد. المتغيرات
   المعيّنة بالفعل في البيئة لها الأولوية.
2. يحمّل `verdin.toml` (اختياري) وتجاوزات `VERDIN_*`. راجع
   [مرجع التهيئة](/ar/reference/configuration/).
3. يبدأ التسجيل إلى الخطأ القياسي، مع `[log]` و`RUST_LOG`.

تحتاج الأوامر التي تفتح قاعدة البيانات إلى `VERDIN_DATABASE_URL` أو `[database].url`. وتحتاج الأوامر
التي تلمس حسابات المسؤولين أو تشغّل الخادم أيضًا إلى `VERDIN_ADMIN_JWT_SECRET` و
`VERDIN_TOKEN_PEPPER`.

## `verdin new`

```text title="Terminal"
verdin new <DIR> [--database <DATABASE>]
```

ينشئ مشروعًا في `DIR`، الذي يجب ألا يكون موجودًا أو أن يكون فارغًا:

| الملف | المحتويات |
| --- | --- |
| `verdin.toml` | `[server]` و`[api]` و`[admin]` بقيمها الافتراضية. |
| `.env` | `VERDIN_DATABASE_URL`، وقيم جديدة لـ `VERDIN_ADMIN_JWT_SECRET` و`VERDIN_TOKEN_PEPPER`. قابل للقراءة لك وحدك (الوضع `0600` على Unix). |
| `.gitignore` | `.env`، و`data/`، وملفات SQLite و`.cache/`. |
| `schema/content-types/`، `schema/components/` | مجلدات مخطط فارغة. |
| `data/` | لقاعدة بيانات SQLite (SQLite فقط). |

| الوسيط أو الخيار | الافتراضي | الوصف |
| --- | --- | --- |
| `<DIR>` | | المجلد المراد إنشاؤه. |
| `--database <DATABASE>` | `sqlite` | قاعدة البيانات التي يشير إليها `.env`: `sqlite` أو `postgres` أو `mysql` أو `mariadb`. |

مع `sqlite`، يكون عنوان URL هو `sqlite://data/verdin.db`. ومع الأخرى يكون عنوان URL لخادم محلي
بالمستخدم `verdin`، وكلمة المرور `change-me`، وقاعدة بيانات تحمل اسم
المجلد (أحرف صغيرة وأرقام و`_`): عدّله قبل أن تبدأ.

```text title="Terminal"
$ verdin new blog --database postgres
created blog

  cd blog
  verdin dev

then open http://localhost:1337/admin/ to register the first admin
```

## `verdin dev`

```text title="Terminal"
verdin dev
```

يشغّل الخادم في وضع التطوير. مقارنةً بـ `verdin start`:

- تُطبَّق الترحيلات المعلّقة ذات مستوى المخاطر `safe` عند بدء التشغيل. الخطوات الأكثر خطورة توقف
  الخادم؛ راجعها بـ [`verdin migrate plan`](#verdin-migrate-plan).
- يحرّر **منشئ أنواع المحتوى** في لوحة الإدارة ملفات المخطط ويعيد الخادم
  تحميل المخطط.
- لا يُعلَّم ملف تعريف ارتباط التجديد بـ `Secure` (ما لم ينص `[admin].secure_cookies` على ذلك)، فـ
  يمكنك تسجيل الدخول عبر HTTP العادي.
- يمكن للـ webhooks وأهداف النشر استدعاء عناوين loopback والعناوين الخاصة (ما لم
  ينص `[webhooks].allow_private_networks` على خلاف ذلك).

يتوقف عند Ctrl+C أو `SIGTERM`.

## `verdin start`

```text title="Terminal"
verdin start [--migrate]
```

يشغّل الخادم في وضع الإنتاج. يرفض البدء عندما تكون قاعدة البيانات متأخرة عن
المخطط، فلا تغيّر عملية نشر أبدًا جداول لم تراجعها.

| الخيار | الوصف |
| --- | --- |
| `--migrate` | يطبّق خطوات الترحيل المعلّقة `safe` قبل البدء. ولا تزال الخطوات المحفوفة بالمخاطر والمُدمِّرة تحتاج إلى `verdin migrate apply`. |

قبل الاستماع، يتحقق من التهيئة (أن `[api].prefix` و`[admin].path` يبدوان مثل
`/api`، وأن أحجام الصفحات متسقة، وأن `[server].trusted_proxies` و`[api].cors_origins`
قابلان للتحليل) وينشئ الأدوار المدمجة. ويسجّل تحذيرًا عندما يكون `[admin].secure_cookies`
`false` أو يكون `[email].provider` هو `log`. وعندما لا يوجد أي مسؤول بعد، يسجّل عنوان
لوحة الإدارة، حيث يسجّل أول زائر أول Super Admin.

يتوقف عند Ctrl+C أو `SIGTERM`.

## `verdin schema check`

```text title="Terminal"
verdin schema check
```

يتحقق من ملفات المخطط (`[schema].path`) دون المساس بقاعدة البيانات. يطبع
ملخصًا، أو يفشل مع الأخطاء، كل منها مع ملفه ومسار السمة:

```text title="Terminal"
$ verdin schema check
schema ok: 4 content types, 3 components
```

استخدمه في CI قبل النشر. راجع [أنواع السمات](/ar/reference/attribute-types/) لما
تقبله كل سمة.

## `verdin migrate plan`

```text title="Terminal"
verdin migrate plan [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

يقارن قاعدة البيانات بالمخطط ويطبع ما سيفعله `verdin migrate apply`،
دون تغيير أي شيء: خطوات مرقّمة، لكل منها مستوى مخاطرها وSQL الخاص بها. ويطبع
`database is up to date` عندما لا يوجد ما يُفعل.

| الخيار | الوصف |
| --- | --- |
| `--rename-table <OLD=NEW>` | يعامل الجدول `OLD` على أنه أُعيدت تسميته إلى `NEW` (يحتفظ بصفوفه) بدلًا من حذف أحدهما وإنشاء الآخر. قابل للتكرار. |
| `--rename-column <TABLE.OLD=NEW>` | يعامل العمود `OLD` في `TABLE` على أنه أُعيدت تسميته إلى `NEW` (يحتفظ بقيمه). `TABLE` هو الاسم الجديد للجدول. قابل للتكرار. |

مستويات المخاطر:

| المستوى | المعنى |
| --- | --- |
| `safe` | لا يمكن أن يفقد بيانات أو يفشل على الصفوف الموجودة: جداول جديدة، وأعمدة جديدة تقبل القيمة الفارغة أو لها قيمة افتراضية، وإعادات تسمية، وفهارس غير فريدة. |
| `risky` | قد يفشل على الصفوف الموجودة أو يحوّل القيم: تغييرات أنواع الأعمدة، وأعمدة جديدة لا تقبل القيمة الفارغة وليس لها قيمة افتراضية، وفهارس فريدة على جداول موجودة. |
| `destructive` | يحذف أعمدة أو جداول. |

عندما تكون خطوة فوق `safe`، تنتهي الخطة بالخيار الذي تحتاجه
(`requires: verdin migrate apply --allow risky`). وعندما يبدو عمود أو جدول محذوف
كأنه أُعيدت تسميته، تسرد خيارات إعادة التسمية الواجب تمريرها. وعندما يكون ترحيل سابق قد
انقطع، تعرض عدد الخطوات المطبّقة وآخر خطأ.

```text title="Terminal"
verdin migrate plan --rename-column articles.summary=excerpt
```

راجع [ترحيلات المخطط](/ar/concepts/schema-migrations/).

## `verdin migrate apply`

```text title="Terminal"
verdin migrate apply [--allow <ALLOW>] [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

يطبّق الخطة. يأخذ خيارات إعادة التسمية نفسها التي يأخذها `verdin migrate plan`؛ مرّر
الخيارات نفسها التي راجعتها.

| الخيار | الافتراضي | الوصف |
| --- | --- | --- |
| `--allow <ALLOW>` | `safe` | أعلى مستوى مخاطر للتطبيق: `safe` أو `risky` أو `destructive`. تُرفض الخطة التي تحتوي على خطوة فوقه قبل تنفيذ أي شيء. |
| `--rename-table <OLD=NEW>` | | كما في `verdin migrate plan`. |
| `--rename-column <TABLE.OLD=NEW>` | | كما في `verdin migrate plan`. |

يطبع `applied N steps`، أو `database is up to date`. بعد انقطاع (اتصال
مفقود، أو خطوة فشلت)، أصلح السبب وشغّله من جديد: يستأنف عند الخطوة
التي لم تكتمل.

## `verdin admin create`

```text title="Terminal"
verdin admin create --email <EMAIL>
```

ينشئ Super Admin. تُقرأ كلمة المرور من `VERDIN_ADMIN_PASSWORD`، أو من الإدخال
القياسي عندما لا يكون معيّنًا. يجب أن تكون قاعدة البيانات محدّثة مع المخطط.

| الخيار | الوصف |
| --- | --- |
| `--email <EMAIL>` | عنوان البريد الإلكتروني للمسؤول الجديد. |

```text title="Terminal"
$ VERDIN_ADMIN_PASSWORD='a long passphrase' verdin admin create --email ada@example.com
created Super Admin ada@example.com (id 1)
```

استخدمه لإنشاء المسؤول الأول لخادم لا يمكن الوصول إليه من متصفح بعد؛
وإلا فإن أول زائر للوحة الإدارة يسجّله.

## `verdin admin reset-password`

```text title="Terminal"
verdin admin reset-password --email <EMAIL>
```

يعيّن كلمة مرور مسؤول، ويفتح قفل الحساب بعد محاولات تسجيل الدخول الفاشلة، وينهي كل
جلساته. تُقرأ كلمة المرور كما في `verdin admin create`.

| الخيار | الوصف |
| --- | --- |
| `--email <EMAIL>` | عنوان البريد الإلكتروني للمسؤول. |

لا يزيل العوامل الثانية؛ يستطيع مسؤول لديه **إدارة المستخدمين** إعادة تعيينها في
**الإعدادات ← المستخدمون**.

## `verdin types`

```text title="Terminal"
verdin types [-o <OUT>]
```

يولّد تعريفات TypeScript لـ API المحتوى (واجهة واحدة لكل نوع محتوى و
مكوّن) من المخطط، ويطبعها إلى المخرج القياسي. لا يحتاج إلى
قاعدة البيانات.

| الخيار | الوصف |
| --- | --- |
| `-o, --out <OUT>` | يكتب في هذا الملف بدلًا من ذلك. |

```text title="Terminal"
verdin types --out ../web/src/verdin.d.ts
```

راجع [العميل المُنمَّط](/ar/guides/frontend/typed-client/).

## `verdin import strapi`

```text title="Terminal"
verdin import strapi <PATH> [--schema-only] [--force]
```

يستورد مشروع Strapi v4 أو v5 من تصدير أُجري بـ `strapi export --no-encrypt`:
`.tar.gz` أو `.tar` أو مجلد مفكوك. يكتب أنواع المحتوى والمكوّنات
كملفات مخطط، ثم يستورد الإدخالات واللغات والوسائط والعلاقات والمجلدات.

| الوسيط أو الخيار | الوصف |
| --- | --- |
| `<PATH>` | ملف التصدير أو مجلده. |
| `--schema-only` | يكتب ملفات المخطط فقط. |
| `--force` | يكتب فوق ملفات المخطط الموجودة، ويستورد إلى أنواع محتوى تحتوي على إدخالات بالفعل. |

يطبع ما كتبه واستورده، مع تحذيرات لما لم يستطع نقله، و
يكتب `strapi-id-map.json` في جذر المشروع: معرّفات Strapi وما يقابلها من قيم `documentId`
ومعرّفات ملفات جديدة في Verdin، لإصلاح الروابط في واجهتك الأمامية.

راجع [الترحيل من Strapi](/ar/migrate/from-strapi/).

## `verdin import verdin`

```text title="Terminal"
verdin import verdin <PATH> [--force]
```

يستورد أرشيفًا كتبه `verdin export`: ملفات المخطط، واللغات، والوسائط، والإدخالات.

| الوسيط أو الخيار | الوصف |
| --- | --- |
| `<PATH>` | ملف `.tar.gz`. |
| `--force` | يكتب فوق ملفات المخطط المختلفة، ويستورد إلى أنواع محتوى تحتوي على إدخالات بالفعل. |

## `verdin export`

```text title="Terminal"
verdin export <OUTPUT> [--no-media]
```

يكتب مخطط المشروع ومحتواه ووسائطه في أرشيف `.tar.gz`: نسخة احتياطية، أو طريقة
لنقل مشروع إلى نسخة أخرى بـ `verdin import verdin`. يحتوي الأرشيف على
كل نسخة من كل إدخال (المسودات، والنسخ المنشورة، واللغات) مع علاقاتها.
لا تُضمَّن حسابات المسؤولين ورموز API والإعدادات.

| الوسيط أو الخيار | الوصف |
| --- | --- |
| `<OUTPUT>` | الأرشيف المراد كتابته. |
| `--no-media` | يستبعد مكتبة الوسائط: الملفات، والمجلدات، وروابط الإدخالات إليها. |

```text title="Terminal"
$ verdin export backup.tar.gz
exported to backup.tar.gz: 42 documents (57 versions), 18 files, 3 folders, 2 locales
```

راجع [النسخ الاحتياطية](/ar/deploy/backups/).

## `verdin healthcheck`

```text title="Terminal"
verdin healthcheck [--port <PORT>]
```

يطلب `GET /_health` من الخادم على هذا الجهاز (`127.0.0.1`، و`[server].port` في
التهيئة) ويخرج بالحالة 0 عندما يجيب بـ `200`، و1 خلاف ذلك، مع طباعة السبب.
لا يحتاج إلى shell أو `curl` أو عميل HTTP، لذا تستخدمه صورة Docker بصفته
`HEALTHCHECK` الخاص بها؛ استخدمه بالطريقة نفسها في Compose أو أي مشرف يشغّل أمرًا.

| الخيار | الوصف |
| --- | --- |
| `--port <PORT>` | يفحص هذا المنفذ بدلًا من `[server].port`. |

```text title="Terminal"
$ verdin healthcheck
ok
```

راجع [المراقبة](/ar/deploy/monitoring/).

## `verdin secrets`

```text title="Terminal"
verdin secrets
```

يطبع قيمتين جديدتين لـ `VERDIN_ADMIN_JWT_SECRET` و`VERDIN_TOKEN_PEPPER`، جاهزتين لملف `.env`
أو لمخزن الأسرار لدى منصتك. لا يقرأ أي مشروع.

تغيير `VERDIN_ADMIN_JWT_SECRET` يبطل رموز الوصول قصيرة الأمد للمسؤولين والمستخدمين
النهائيين، وروابط المعاينة المفتوحة، وتسجيلات الدخول عبر OAuth الجارية؛ وتحصل لوحة الإدارة والعملاء الذين
يستخدمون رموز التجديد على رموز جديدة تلقائيًا. أما تغيير `VERDIN_TOKEN_PEPPER` فيبطل
الرموز المخزّنة (ومنها رموز API)، لذا احتفظ به بمجرد بدء استخدامه.

## `verdin version`

```text title="Terminal"
verdin version
```

يطبع `verdin` والإصدار، مثل `verdin --version`.
