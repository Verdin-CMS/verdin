---
title: גרסאות ואירוח התיעוד
description: מה זרימת העבודה של הגרסאות מפרסמת (קבצים בינאריים, checksums, חבילות .deb, האימג', Homebrew, winget), אילו סודות כל משימה אופציונלית צריכה, ואיך אתר התיעוד, הדומיין שלו ותצוגות מקדימות של pull requests מתארחים.
sidebar:
  order: 9
---

העמוד הזה מיועד למתחזקים: מה קורה כש-tag של גרסה נדחף, אילו חלקים צריכים סוד או חשבון, ואיך
אתר התיעוד מתפרסם.

## זרימת העבודה של הגרסאות

דחיפת tag `vX.Y.Z` מריצה את `.github/workflows/release.yml`:

| משימה | מפרסמת | צריכה |
| --- | --- | --- |
| `admin`, `binaries` | `verdin-vX.Y.Z-<target>.tar.gz` (`.zip` ב-Windows) עבור `x86_64`/`aarch64-unknown-linux-musl`, `x86_64`/`aarch64-apple-darwin` ו-`x86_64-pc-windows-msvc`. בכל ארכיון תיקייה אחת עם `verdin` והרישיונות. | כלום |
| `deb` | `verdin_X.Y.Z-1_amd64.deb` ו-`_arm64.deb`, שנבנים עם `cargo deb --no-build` מהקבצים הבינאריים של musl. | כלום |
| `publish` | הגרסה ב-GitHub: ארכיונים, חבילות ו-`SHA256SUMS`, עם ההערות מהקטע של הגרסה ב-`CHANGELOG.md`. | כלום |
| `image` | `ghcr.io/verdin-cms/verdin` עבור amd64 ו-arm64. | כלום |
| `npm` | `@verdin/client`. | `NPM_TOKEN` (מדלגת בלעדיו) |
| `homebrew` | `Formula/verdin.rb` ב-tap, מ-`deploy/homebrew/verdin.rb.in`. | `HOMEBREW_TAP_TOKEN` (מדלגת בלעדיו) |
| `winget` | pull request אל `microsoft/winget-pkgs` עם המניפסטים של `deploy/winget/`. | `WINGET_TOKEN` (מדלגת בלעדיו) |

שמות הנכסים הם חוזה: `install.sh`, המטא-נתונים של `cargo binstall` ב-`crates/verdin/Cargo.toml`,
ה-formula של Homebrew ומניפסטי winget כולם בונים אותם מהגרסה וה-target. `deploy/render-template.sh`
ממלא את התבניות של Homebrew ו-winget בגרסה ובסכומי הביקורת של `SHA256SUMS`, ונכשל אם אחד חסר.

## הגדרה חד-פעמית למשימות האופציונליות

| מה | איפה |
| --- | --- |
| **Homebrew tap.** צרו את המאגר הציבורי `verdin-cms/homebrew-tap` (השם גורם ל-`brew install verdin-cms/tap/verdin` לעבוד). הוסיפו אליו אסימון fine-grained עם *Contents: read and write* כסוד `HOMEBREW_TAP_TOKEN`. מאגר אחר: הגדירו את המשתנה `HOMEBREW_TAP_REPOSITORY`. | סודות ומשתנים של המאגר |
| **winget.** ההגשה הראשונה של `VerdinCMS.Verdin` נבדקת על ידי מתחזקי winget. עשו fork ל-`microsoft/winget-pkgs` עם החשבון שמגיש, והוסיפו אסימון classic של אותו חשבון עם ההיקף `public_repo` כ-`WINGET_TOKEN`. | סודות המאגר |
| **npm.** `NPM_TOKEN`, אסימון automation של ההיקף `@verdin`. | סודות המאגר |
| **crates.io** (אופציונלי). `cargo binstall verdin` בלי `--git` צריך את ה-crate ב-crates.io; עד אז התיעוד משתמש ב-`--git`. | — |
| **כפתור Railway** (אופציונלי). צרו תבנית ב-railway.com מהמאגר (נתיב תצורה `deploy/one-click/railway.json`, שירות PostgreSQL, volume ב-`/data`) והוסיפו את הכפתור שלה ל-README ול[פריסות בלחיצה אחת](/he/deploy/one-click/). | railway.com |

כפתורי Render ו-DigitalOcean לא צריכים חשבון בצד הפרויקט: הם קוראים את `render.yaml` ואת
`.do/deploy.template.yaml` מהענף ברירת המחדל.

כמה גרסאות כתובות בקבצים ונעות עם כל גרסת minor: תגית האימג' ב-`deploy/one-click/Dockerfile`,
ב-`deploy/playground/Dockerfile`, ב-`deploy/compose/` ובתיעוד, ו-`version`/`appVersion` ב-
`deploy/helm/verdin/Chart.yaml`.

## אתר התיעוד

`.github/workflows/site.yml` בונה את `site/` בכל push ל-`main` שנוגע בו ודוחף את התוצאה לשורש
הענף `gh-pages`. GitHub Pages מגיש את הענף הזה (Settings → Pages → Source: *Deploy from a
branch*, `gh-pages`, `/`).

### הדומיין

המקום שבו האתר חי הוא משתנה מאגר אחד, **`SITE_URL`**:

| `SITE_URL` | אתר |
| --- | --- |
| לא מוגדר | `https://verdin-cms.github.io/verdin/` |
| `https://docs.example.com` | השורש של הדומיין הזה |
| `https://example.com/verdin` | תחת `/verdin` בדומיין הזה |

`site/scripts/repo.mjs` לוקח ממנו את `site` ו-`base` של Astro, כך שכל קישור, נכס ומפת האתר
עוקבים. `BASE_PATH` עדיין גובר על הנתיב אם הוא מוגדר. עבור דומיין מותאם אישית:

1. כוונו את ה-DNS של הדומיין אל GitHub Pages (רשומת `CNAME` אל `verdin-cms.github.io`
   עבור תת-דומיין).
2. הגדירו את `SITE_URL` ב-Settings → Secrets and variables → Actions → Variables.
3. הריצו את זרימת העבודה Site (או דחפו ל-`main`). היא כותבת את הקובץ `CNAME` אל הענף,
   ו-GitHub קולט את הדומיין; הפעילו *Enforce HTTPS* כשהתעודה הונפקה.

קישורים מחוץ לאתר (ה-README, מטא-נתוני החבילות, ה-`home` של ה-Helm chart) שומרים על הכתובת
`verdin-cms.github.io/verdin`, ש-GitHub מפנה ממנה לדומיין המותאם.

### תצוגות מקדימות של pull requests

כל pull request שנוגע באתר מקבל תצוגה מקדימה ב-`<SITE_URL>/pr-preview/pr-<number>/`, עם קישור
בתגובה:

1. `site-preview.yml` רץ על `pull_request`. הוא בונה את האתר עם `SITE_URL` שמוגדר לכתובת
   התצוגה המקדימה ומעלה אותו כ-artifact. הוא מריץ את הקוד של ה-pull request, ולכן, כמו בכל
   זרימת `pull_request` מ-fork, יש לו אסימון לקריאה בלבד ואין סודות.
2. `site-preview-deploy.yml` רץ על `workflow_run` כשהבנייה הזו מצליחה, בהקשר של המאגר הזה.
   הוא מוריד את ה-artifact, בודק שה-pull request פתוח ושהבנייה הייתה עבור ה-head הנוכחי שלו,
   מעתיק את הקבצים אל `pr-preview/pr-<number>/` ב-`gh-pages` ומעדכן את התגובה. הוא אף פעם
   לא מבצע checkout או מריץ קוד של pull request.
3. כש-pull request נסגר, אותה זרימה (`pull_request_target`, שרק משכפלת את `gh-pages`) מוחקת
   את התיקייה.

הפריסה הראשית שומרת על `pr-preview/`, ושלושתן חולקות קבוצת concurrency אחת, כך שרק משימה
אחת כותבת ל-`gh-pages` בכל פעם.

תצוגות מקדימות מוגשות מאותו origin כמו התיעוד. זה מקובל באתר סטטי בלי התחברות, אבל pull
request מ-fork יכול לפרסם שם כל HTML עד שהוא נסגר; סגרו pull requests שמנצלים זאת לרעה. אם
משתני המאגר לא זמינים לזרימת העבודה של fork, התצוגה המקדימה שלו נבנית עבור `SITE_URL` ברירת
המחדל והקישורים שלה נשברים תחת דומיין מותאם; תצוגות מקדימות של pull requests מענפים של המאגר
הזה לא מושפעות.

### ה-playground המאורח

הדמו הציבורי מריץ את הקונטיינר של `deploy/playground/`; ראו
[Playground מאורח](/he/deploy/playground/). האירוח שלו מחוץ למאגר: כל פלטפורמה ששומרת על
קונטיינר אחד רץ מאחורי HTTPS.
