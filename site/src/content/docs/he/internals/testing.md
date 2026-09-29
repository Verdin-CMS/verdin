---
title: בדיקות
description: איך Verdin נבדק, מבדיקות יחידה ב-Rust ועד חבילת התאימות שרצה על שישה מסדי נתונים, בדיקות היחידה וה-Playwright של פאנל הניהול, ומשימות ה-CI שמסננות כל שינוי.
sidebar:
  order: 7
---

העמוד הזה מסביר את חבילות הבדיקות, איך להריץ כל אחת מקומית, ומה ה-CI בודק בכל pull request. הכלל שמאחורי כל זה: תכונה לא גמורה עד שהיא עוברת בכל מסד נתונים נתמך.

## בדיקות Rust

הריצו הכול עם:

```sh title="Terminal"
cargo test --workspace
```

בלי תצורה, הבדיקות משתמשות ב-SQLite. יש שלושה סוגים:

| סוג | היכן | מה |
|---|---|---|
| בדיקות יחידה | מודולי `#[cfg(test)]` בכל crate | פענוח ואימות של סכמה, שמות, diff ו-plan, פענוח שאילתות, יצירת SQL לכל דיאלקט, קידוד ערכים, אימות קלט |
| בדיקות אינטגרציה של crates | `crates/*/tests/` | התחברות וזיהוי flavor (`verdin-db`), החלת הגירות (`verdin-migrate`), תהליכי אימות (`verdin-auth`), GraphQL, תוספים, אחסון S3 |
| בדיקות API | `crates/verdin-api/tests/api/` | בקשות HTTP מול API התוכן ומול API הניהול, כולל חבילת התאימות |

**תמונות מצב של DDL.** `crates/verdin-migrate/tests/sql_snapshots.rs` מייצר את ה-DDL של סכמה לדוגמה לכל דיאלקט ומשווה אותו לתמונות המצב של [`insta`](https://insta.rs) ב-`crates/verdin-migrate/tests/snapshots/`. כשאתם משנים DDL בכוונה, עברו על תמונות המצב החדשות וקבלו אותן עם `cargo insta review` (מ-`cargo-insta`) ועשו להן commit.

**בדיקות API** נמצאות בקובץ בדיקה בינארי אחד (`tests/api/main.rs`, מודול אחד לכל תחום) כדי לצמצם את זמני הקישור ואת גודל `target/`. ה-harness ב-`tests/api/common/mod.rs` בונה את API התוכן ב-`/api` ואת API הניהול ב-`/admin/api` מעל מסד נתונים חדש שעבר הגירה לכל בדיקה. הבקשות נושאות אסימון API עם גישה מלאה אלא אם הבדיקה מעבירה אחר, או אף אחד.

## מטריצת ששת מסדי הנתונים

כל בדיקה שנוגעת במסד נתונים קוראת את `VERDIN_TEST_DATABASE_URL` וברירת המחדל שלה היא SQLite בזיכרון. `verdin-testkit` נותן לכל בדיקה מסד נתונים משלה: קובץ SQLite זמני, או מסד נתונים `vd_test_…` חדש שנוצר בשרת ונמחק אחר כך.

ה-CI מריץ את כל ה-workspace פעם אחת לכל מנוע:

| מנוע | אימג' |
|---|---|
| SQLite | מובנה |
| PostgreSQL 14 | `postgres:14-alpine` |
| PostgreSQL 17 | `postgres:17-alpine` |
| MySQL 8.4 | `mysql:8.4` |
| MariaDB 10.11 | `mariadb:10.11` |
| MariaDB 11.4 | `mariadb:11.4` |

אלה [הגרסאות המינימליות](/he/internals/database/#גרסאות-מינימליות) ועוד הגרסאות החדשות ביותר ש-Verdin נבדק עליהן. ה-CI מגדיר גם את `VERDIN_TEST_EXPECT_FLAVOR` כדי ש-`crates/verdin-db/tests/connect.rs` יוודא שהמנוע זוהה נכון (MariaDB מגיעים אליו עם כתובת `mysql://` והוא עדיין חייב להיות מזוהה כ-MariaDB).

כדי להריץ את המטריצה מקומית, הפעילו את מסדי הנתונים עם Docker:

```sh title="Terminal"
docker compose -f docker/compose.dev.yml up -d
```

ואז הריצו את הבדיקות מול כל מנוע. הבדיקות יוצרות מסד נתונים לכל בדיקה, ולכן ב-MySQL וב-MariaDB הן מתחברות כ-`root`:

```sh title="Terminal"
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5414/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5417/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3384/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3311/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3314/verdin cargo test --workspace
```

הפורטים ממופים ל-PostgreSQL 14 ו-17, ל-MySQL 8.4, ול-MariaDB 10.11 ו-11.4. אותו קובץ compose מפעיל גם את RustFS (אחסון תואם S3 בפורט 9000) ואת Mailpit (SMTP בפורט 1025, תיבת דואר בפורט 8025) לעבודה עם מדיה ודוא"ל.

## חבילת התאימות

`crates/verdin-api/tests/api/conformance.rs` שולח את אותן בקשות HTTP ל-API התוכן בכל מנוע ובודק את התגובות: סבבי יצירה, קריאה, עדכון ומחיקה, אימות קלט, טיוטה ופרסום, מסננים וכללי התאמת הטקסט שלהם, מיון ועימוד, טיפוסי שדות ו-populate, ערכים ייחודיים, סוגים יחידים, כללי גישה ל-API התוכן, מסמך ה-OpenAPI, ומסננים על שדות של רכיבים. מודולים אחרים ב-`tests/api/` (`filters.rs`, `populate.rs`, `relations.rs`, `components.rs`, `morph.rs`, `i18n.rs`…) מכסים את התחומים שלהם באותה דרך, כך שכל קובץ הבדיקה הבינארי של `verdin-api` הוא למעשה חבילת התאימות.

כשאתם מתקנים הבדל בין דיאלקטים, הוסיפו את המקרה כאן: הבדיקה שעוברת ב-PostgreSQL ונכשלת ב-MySQL היא בדיוק זו שהחבילה קיימת כדי לתפוס.

## בדיקות פאנל הניהול

**בדיקות יחידה** הן קובצי `*.spec.ts` ליד הקוד ב-`admin/src/app`, שרצים עם Vitest דרך ה-unit-test builder של Angular ב-jsdom. הן מכסות את המודלים הטהורים: המרת מודל הטופס, כללי שדות, מסננים ותצוגות של רשימות, הרשאות, ה-transpiler של ICU, תחילת השבוע ועוד.

```sh title="Terminal"
cd admin
npx ng test --watch=false
```

**בדיקות מקצה לקצה** הן specs של Playwright ב-`admin/e2e/`. `e2e/serve.sh` יוצר פרויקט זמני (עם תוסף WebAssembly לדוגמה), ומפעיל את `verdin dev` בפורט 1393 על SQLite, כשהוא מגיש את פאנל הניהול מ-`admin/dist/admin/browser`. הבדיקות רצות אחת בכל פעם ב-Chromium עם ממשק באנגלית.

```sh title="Terminal"
cd admin
npx ng build
cargo build -p verdin
npx playwright install chromium
npx playwright test
```

ה-specs מכסים התחברות ואימות דו-שלבי, את עורך הרשומות, קשרים פולימורפיים, תהליכי בקרה, תכונות צוות וממשל, אזכורים, ייבוא וייצוא, תצוגות עריכה ו-guards לשינויים שלא נשמרו.

## CI

`.github/workflows/ci.yml` רץ בכל push ל-`main` ובכל pull request. כל משימות ה-Rust נבנות עם `RUSTFLAGS=-D warnings`.

| משימה | בודקת |
|---|---|
| `lint` | `cargo fmt --all --check`, `cargo clippy --workspace --all-targets`, `cargo deny` (רישיונות והתראות אבטחה) |
| `test (sqlite)` | `cargo test --workspace` על SQLite בזיכרון |
| `test (…)` | `cargo test --workspace` על PostgreSQL 14 ו-17, MySQL 8.4, MariaDB 10.11 ו-11.4, משימה אחת לכל אחד, כשירותי Docker |
| `test (s3 storage, RustFS)` | `cargo test -p verdin-upload --test s3` מול קונטיינר RustFS |
| `admin` | בדיקת Prettier, `npm run i18n:check`, `npm audit --audit-level=high`, בדיקות יחידה, `ng build`, `cargo build -p verdin --features embed-admin`, Playwright |
| `client` | ל-`packages/client` יש אותה גרסה כמו ל-workspace, ואז בדיקת טיפוסים, בדיקות ובנייה |
| `site` | `npm audit`, ובניית התיעוד, שנכשלת על כל קישור פנימי שבור |

הרצות Playwright שנכשלו מעלות את ה-traces שלהן כ-artifact, שנשמר לשבעה ימים.
