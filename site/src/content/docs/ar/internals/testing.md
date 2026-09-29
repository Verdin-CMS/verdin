---
title: الاختبار
description: كيف يُختبر Verdin، من اختبارات Rust الوحدوية إلى مجموعة المطابقة التي تعمل على ست قواعد بيانات، واختبارات لوحة الإدارة الوحدوية واختبارات Playwright، ومهام CI التي تحرس كل تغيير.
sidebar:
  order: 7
---

تشرح هذه الصفحة مجموعات الاختبارات، وكيفية تشغيل كل منها محليًا، وما يتحقق منه CI في كل طلب سحب (pull request). القاعدة وراء كل ذلك: لا تكتمل الميزة حتى تنجح على كل قاعدة بيانات مدعومة.

## اختبارات Rust

شغّل كل شيء بـ:

```sh title="Terminal"
cargo test --workspace
```

بدون تهيئة، تستخدم الاختبارات SQLite. هناك ثلاثة أنواع:

| النوع | المكان | ماذا |
|---|---|---|
| الاختبارات الوحدوية | وحدات `#[cfg(test)]` في كل crate | تحليل المخطط والتحقق منه، والتسمية، والفرق والخطة، وتحليل الاستعلامات، وتوليد SQL لكل لهجة، وترميز القيم، والتحقق من المدخلات |
| اختبارات التكامل للـ crates | `crates/*/tests/` | الاتصال واكتشاف الـ flavor (`verdin-db`)، وتطبيق الترحيلات (`verdin-migrate`)، وتدفقات المصادقة (`verdin-auth`)، وGraphQL، والإضافات، وتخزين S3 |
| اختبارات الـ API | `crates/verdin-api/tests/api/` | طلبات HTTP على API المحتوى وAPI الإدارة، بما في ذلك مجموعة المطابقة |

**لقطات DDL.** يعرض `crates/verdin-migrate/tests/sql_snapshots.rs` الـ DDL لمخطط عيّنة لكل لهجة ويقارنه بلقطات [`insta`](https://insta.rs) في `crates/verdin-migrate/tests/snapshots/`. عندما تغيّر الـ DDL عمدًا، راجع اللقطات الجديدة واقبلها بـ `cargo insta review` (من `cargo-insta`) واعتمدها.

**اختبارات الـ API** تعيش في ملف اختبار تنفيذي واحد (`tests/api/main.rs`، وحدة لكل مجال) لتقليل أوقات الربط وحجم `target/`. يبني الإطار في `tests/api/common/mod.rs` ‏API المحتوى على `/api` وAPI الإدارة على `/admin/api` فوق قاعدة بيانات جديدة مرحَّلة لكل اختبار. تحمل الطلبات رمز API بوصول كامل ما لم يمرّر الاختبار رمزًا آخر، أو لا شيء.

## مصفوفة قواعد البيانات الست

يقرأ كل اختبار يلمس قاعدة بيانات `VERDIN_TEST_DATABASE_URL` ويستخدم افتراضيًا SQLite في الذاكرة. يمنح `verdin-testkit` كل اختبار قاعدة بيانات خاصة به: ملف SQLite مؤقت، أو قاعدة بيانات `vd_test_…` جديدة تُنشأ على الخادم وتُحذف بعد ذلك.

يشغّل CI مساحة العمل كاملة مرة لكل محرك:

| المحرك | الصورة |
|---|---|
| SQLite | مضمَّن |
| PostgreSQL 14 | `postgres:14-alpine` |
| PostgreSQL 17 | `postgres:17-alpine` |
| MySQL 8.4 | `mysql:8.4` |
| MariaDB 10.11 | `mariadb:10.11` |
| MariaDB 11.4 | `mariadb:11.4` |

هذه هي [الحدود الدنيا للإصدارات](/ar/internals/database/#الحد-الأدنى-للإصدارات) بالإضافة إلى أحدث الإصدارات التي يُختبر عليها Verdin. يعيّن CI أيضًا `VERDIN_TEST_EXPECT_FLAVOR` حتى يؤكد `crates/verdin-db/tests/connect.rs` أن المحرك اكتُشف بشكل صحيح (يُوصل إلى MariaDB بعنوان `mysql://` ويجب أن يظل يُكتشف على أنه MariaDB).

لتشغيل المصفوفة محليًا، شغّل قواعد البيانات باستخدام Docker:

```sh title="Terminal"
docker compose -f docker/compose.dev.yml up -d
```

ثم شغّل الاختبارات على كل محرك. تنشئ الاختبارات قاعدة بيانات لكل اختبار، لذا تتصل على MySQL وMariaDB بصفة `root`:

```sh title="Terminal"
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5414/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5417/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3384/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3311/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3314/verdin cargo test --workspace
```

تقابل المنافذ PostgreSQL 14 و17، وMySQL 8.4، وMariaDB 10.11 و11.4. ويشغّل ملف compose نفسه RustFS (تخزين متوافق مع S3 على المنفذ 9000) وMailpit (SMTP على المنفذ 1025، وصندوق الوارد على المنفذ 8025) للعمل على الوسائط والبريد الإلكتروني.

## مجموعة المطابقة

يرسل `crates/verdin-api/tests/api/conformance.rs` طلبات HTTP نفسها إلى API المحتوى على كل محرك ويتحقق من الاستجابات: جولات الإنشاء والقراءة والتحديث والحذف، والتحقق من المدخلات، والمسودة والنشر، وعوامل التصفية وقواعد مطابقة النصوص فيها، والترتيب والتقسيم إلى صفحات، وأنواع الحقول والتعبئة، والقيم الفريدة، والأنواع المفردة، وقواعد الوصول إلى API المحتوى، ومستند OpenAPI، وعوامل التصفية على حقول المكوّنات. تغطي الوحدات الأخرى في `tests/api/` (`filters.rs`، `populate.rs`، `relations.rs`، `components.rs`، `morph.rs`، `i18n.rs`…) مجالاتها بالطريقة نفسها، فيكون ملف اختبار `verdin-api` كله فعليًا هو مجموعة المطابقة.

عندما تصلح اختلافًا بين اللهجات، أضف الحالة هنا: الاختبار الذي ينجح على PostgreSQL ويفشل على MySQL هو بالضبط ما وُجدت المجموعة لالتقاطه.

## اختبارات لوحة الإدارة

**الاختبارات الوحدوية** ملفات `*.spec.ts` بجوار الشيفرة في `admin/src/app`، تُشغَّل بـ Vitest عبر منشئ الاختبارات الوحدوية في Angular داخل jsdom. وهي تغطي النماذج الصرفة: تحويل نموذج النموذج، وقواعد الحقول، وعوامل تصفية القوائم وعروضها، والصلاحيات، ومحوّل ICU، وبداية الأسبوع، وغير ذلك.

```sh title="Terminal"
cd admin
npx ng test --watch=false
```

**الاختبارات من طرف إلى طرف** مواصفات Playwright في `admin/e2e/`. ينشئ `e2e/serve.sh` مشروعًا مؤقتًا (مع إضافة WebAssembly عيّنة)، ويشغّل `verdin dev` على المنفذ 1393 على SQLite، مقدّمًا لوحة الإدارة من `admin/dist/admin/browser`. تُنفَّذ الاختبارات واحدًا تلو الآخر في Chromium بواجهة إنجليزية.

```sh title="Terminal"
cd admin
npx ng build
cargo build -p verdin
npx playwright install chromium
npx playwright test
```

تغطي المواصفات تسجيل الدخول والمصادقة الثنائية، ومحرر الإدخال، والعلاقات متعددة الأشكال، ومسارات المراجعة، وميزات الفريق والحوكمة، والإشارات، والاستيراد والتصدير، وعروض التحرير، وحراس التغييرات غير المحفوظة.

## CI

يعمل `.github/workflows/ci.yml` مع كل دفع إلى `main` وكل طلب سحب. تُبنى كل مهام Rust بـ `RUSTFLAGS=-D warnings`.

| المهمة | تتحقق من |
|---|---|
| `lint` | `cargo fmt --all --check`، `cargo clippy --workspace --all-targets`، `cargo deny` (التراخيص والتنبيهات الأمنية) |
| `test (sqlite)` | `cargo test --workspace` على SQLite في الذاكرة |
| `test (…)` | `cargo test --workspace` على PostgreSQL 14 و17، وMySQL 8.4، وMariaDB 10.11 و11.4، مهمة لكل منها، كخدمات Docker |
| `test (s3 storage, RustFS)` | `cargo test -p verdin-upload --test s3` على حاوية RustFS |
| `admin` | فحص Prettier، و`npm run i18n:check`، و`npm audit --audit-level=high`، والاختبارات الوحدوية، و`ng build`، و`cargo build -p verdin --features embed-admin`، وPlaywright |
| `client` | أن يكون لـ `packages/client` الإصدار نفسه لمساحة العمل، ثم فحص الأنواع والاختبارات والبناء |
| `site` | `npm audit`، وبناء التوثيق، الذي يفشل عند أي رابط داخلي مكسور |

ترفع تشغيلات Playwright الفاشلة آثارها (traces) كمخرَج (artifact)، يُحتفظ به سبعة أيام.
