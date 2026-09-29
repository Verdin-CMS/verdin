---
title: تست
description: Verdin چگونه تست می‌شود، از تست‌های واحد Rust تا مجموعهٔ تست انطباق که روی شش پایگاه داده اجرا می‌شود، تست‌های واحد و Playwright پنل مدیریت، و کارهای CI که هر تغییر را کنترل می‌کنند.
sidebar:
  order: 7
---

این صفحه مجموعه‌های تست، نحوهٔ اجرای هر کدام به‌صورت محلی و آنچه CI در هر pull request بررسی می‌کند را توضیح می‌دهد. قاعدهٔ پشت همهٔ این‌ها: یک قابلیت تا وقتی روی همهٔ پایگاه‌های دادهٔ پشتیبانی‌شده پاس نشود، تمام‌شده نیست.

## تست‌های Rust

همه‌چیز را با این فرمان اجرا کنید:

```sh title="Terminal"
cargo test --workspace
```

بدون پیکربندی، تست‌ها از SQLite استفاده می‌کنند. سه گونه تست وجود دارد:

| گونه | کجا | چه چیزی |
|---|---|---|
| تست‌های واحد | ماژول‌های `#[cfg(test)]` در هر crate | parse و اعتبارسنجی طرح‌واره، نام‌گذاری، diff و plan، parse کوئری، تولید SQL برای هر گویش، کدگذاری مقدارها، اعتبارسنجی ورودی |
| تست‌های یکپارچگی crate | `crates/*/tests/` | اتصال و تشخیص flavor (`verdin-db`)، اعمال مهاجرت‌ها (`verdin-migrate`)، جریان‌های احراز هویت (`verdin-auth`)، GraphQL، افزونه‌ها، ذخیره‌سازی S3 |
| تست‌های API | `crates/verdin-api/tests/api/` | درخواست‌های HTTP به API محتوا و API مدیریت، از جمله مجموعهٔ تست انطباق |

**snapshotهای DDL.** `crates/verdin-migrate/tests/sql_snapshots.rs` DDL یک طرح‌وارهٔ نمونه را برای هر گویش تولید می‌کند و آن را با snapshotهای [`insta`](https://insta.rs) در `crates/verdin-migrate/tests/snapshots/` مقایسه می‌کند. وقتی DDL را عمداً تغییر می‌دهید، snapshotهای جدید را با `cargo insta review` (از `cargo-insta`) بازبینی و تأیید کنید و commit کنید.

**تست‌های API** در یک فایل باینری تست قرار دارند (`tests/api/main.rs`، یک ماژول برای هر حوزه) تا زمان link و اندازهٔ `target/` پایین بماند. harness در `tests/api/common/mod.rs` برای هر تست، API محتوا را در `/api` و API مدیریت را در `/admin/api` روی یک پایگاه دادهٔ تازه و مهاجرت‌یافته می‌سازد. درخواست‌ها یک توکن API با دسترسی کامل حمل می‌کنند، مگر اینکه تست توکن دیگری بدهد، یا هیچ توکنی.

## ماتریس شش پایگاه داده

هر تستی که با پایگاه داده سروکار دارد `VERDIN_TEST_DATABASE_URL` را می‌خواند و پیش‌فرض آن SQLite درون حافظه است. `verdin-testkit` به هر تست پایگاه دادهٔ مخصوص خودش را می‌دهد: یک فایل موقت SQLite، یا یک پایگاه دادهٔ تازهٔ `vd_test_…` که روی سرور ساخته و پس از آن حذف می‌شود.

CI کل فضای کاری را یک بار برای هر موتور اجرا می‌کند:

| موتور | ایمیج |
|---|---|
| SQLite | همراه باینری |
| PostgreSQL 14 | `postgres:14-alpine` |
| PostgreSQL 17 | `postgres:17-alpine` |
| MySQL 8.4 | `mysql:8.4` |
| MariaDB 10.11 | `mariadb:10.11` |
| MariaDB 11.4 | `mariadb:11.4` |

این‌ها همان [حداقل نسخه‌ها](/fa/internals/database/#حداقل-نسخهها) به‌علاوهٔ جدیدترین نسخه‌هایی هستند که Verdin روی آن‌ها تست می‌شود. CI همچنین `VERDIN_TEST_EXPECT_FLAVOR` را تنظیم می‌کند تا `crates/verdin-db/tests/connect.rs` بررسی کند که موتور درست تشخیص داده شده است (به MariaDB با یک URL از نوع `mysql://` وصل می‌شویم و همچنان باید MariaDB تشخیص داده شود).

برای اجرای ماتریس به‌صورت محلی، پایگاه‌های داده را با Docker راه‌اندازی کنید:

```sh title="Terminal"
docker compose -f docker/compose.dev.yml up -d
```

سپس تست‌ها را روی هر موتور اجرا کنید. تست‌ها برای هر تست یک پایگاه داده می‌سازند، بنابراین در MySQL و MariaDB با `root` وصل می‌شوند:

```sh title="Terminal"
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5414/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5417/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3384/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3311/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3314/verdin cargo test --workspace
```

این درگاه‌ها به PostgreSQL 14 و 17، MySQL 8.4، و MariaDB 10.11 و 11.4 نگاشت می‌شوند. همین فایل compose برای کار روی رسانه و ایمیل، RustFS (ذخیره‌سازی سازگار با S3 روی درگاه 9000) و Mailpit (SMTP روی درگاه 1025، صندوق ورودی روی درگاه 8025) را هم راه‌اندازی می‌کند.

## مجموعهٔ تست انطباق

`crates/verdin-api/tests/api/conformance.rs` همان درخواست‌های HTTP را روی هر موتور به API محتوا می‌فرستد و پاسخ‌ها را بررسی می‌کند: چرخه‌های کامل ساختن، خواندن، به‌روزرسانی و حذف، اعتبارسنجی ورودی، پیش‌نویس و انتشار، فیلترها و قاعده‌های تطبیق متن آن‌ها، مرتب‌سازی و صفحه‌بندی، نوع فیلدها و populate، مقدارهای یکتا، نوع‌های تکی، قاعده‌های دسترسی API محتوا، سند OpenAPI و فیلتر روی فیلدهای کامپوننت. ماژول‌های دیگر در `tests/api/` (`filters.rs`، `populate.rs`، `relations.rs`، `components.rs`، `morph.rs`، `i18n.rs`…) حوزه‌های خودشان را به همین شکل پوشش می‌دهند، بنابراین کل فایل باینری تست `verdin-api` در عمل همان مجموعهٔ تست انطباق است.

وقتی یک تفاوت گویشی را برطرف می‌کنید، آن مورد را اینجا اضافه کنید: تستی که روی PostgreSQL پاس می‌شود و روی MySQL شکست می‌خورد دقیقاً همان چیزی است که این مجموعه برای گرفتنش وجود دارد.

## تست‌های پنل مدیریت

**تست‌های واحد** فایل‌های `*.spec.ts` در کنار کد در `admin/src/app` هستند که با Vitest از طریق unit-test builder در Angular و در jsdom اجرا می‌شوند. مدل‌های خالص را پوشش می‌دهند: تبدیل مدل فرم، قاعده‌های فیلد، فیلترها و نماهای فهرست، مجوزها، transpiler مربوط به ICU، آغاز هفته و موارد دیگر.

```sh title="Terminal"
cd admin
npx ng test --watch=false
```

**تست‌های end-to-end** مشخصه‌های Playwright در `admin/e2e/` هستند. `e2e/serve.sh` یک پروژهٔ یک‌بارمصرف (با یک افزونهٔ WebAssembly نمونه) می‌سازد و `verdin dev` را روی درگاه 1393 با SQLite راه‌اندازی می‌کند که پنل مدیریت را از `admin/dist/admin/browser` ارائه می‌دهد. تست‌ها یکی‌یکی در Chromium با UI انگلیسی اجرا می‌شوند.

```sh title="Terminal"
cd admin
npx ng build
cargo build -p verdin
npx playwright install chromium
npx playwright test
```

این مشخصه‌ها ورود و تأیید دومرحله‌ای، ویرایشگر مدخل، روابط چندریختی، گردش‌کارهای بازبینی، قابلیت‌های تیم و حاکمیت، اشاره‌ها (mention)، درون‌ریزی و خروجی گرفتن، edit viewها و guardهای تغییرات ذخیره‌نشده را پوشش می‌دهند.

## CI

`.github/workflows/ci.yml` در هر push به `main` و هر pull request اجرا می‌شود. همهٔ کارهای Rust با `RUSTFLAGS=-D warnings` ساخته می‌شوند.

| کار | بررسی‌ها |
|---|---|
| `lint` | `cargo fmt --all --check`، `cargo clippy --workspace --all-targets`، `cargo deny` (مجوزهای نرم‌افزاری و هشدارهای امنیتی) |
| `test (sqlite)` | `cargo test --workspace` روی SQLite درون حافظه |
| `test (…)` | `cargo test --workspace` روی PostgreSQL 14 و 17، MySQL 8.4، MariaDB 10.11 و 11.4، هر کدام یک کار، به شکل سرویس‌های Docker |
| `test (s3 storage, RustFS)` | `cargo test -p verdin-upload --test s3` روی یک کانتینر RustFS |
| `admin` | بررسی Prettier، `npm run i18n:check`، `npm audit --audit-level=high`، تست‌های واحد، `ng build`، `cargo build -p verdin --features embed-admin`، Playwright |
| `client` | `packages/client` همان نسخهٔ فضای کاری را دارد، سپس بررسی نوع، تست‌ها و ساخت |
| `site` | `npm audit`، و ساخت مستندات که با هر پیوند داخلی شکسته شکست می‌خورد |

اجراهای ناموفق Playwright traceهای خود را به‌عنوان artifact بارگذاری می‌کنند که هفت روز نگه داشته می‌شوند.
