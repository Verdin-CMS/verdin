---
title: الإصدارات واستضافة الوثائق
description: ما الذي ينشره سير عمل الإصدار (الملفات التنفيذية، وقيم التحقق، وحزم .deb، والصورة، وHomebrew، وwinget)، والأسرار التي تحتاجها كل مهمة اختيارية، وكيف يُستضاف موقع الوثائق ونطاقه ومعاينات طلبات الدمج.
sidebar:
  order: 9
---

هذه الصفحة للمشرفين على المشروع: ما الذي يحدث عند دفع وسم إصدار، وأي الأجزاء
تحتاج إلى سر أو حساب، وكيف يُنشر موقع الوثائق.

## سير عمل الإصدار

يشغّل دفع وسم `vX.Y.Z` الملف `.github/workflows/release.yml`:

| المهمة | تنشر | تحتاج إلى |
| --- | --- | --- |
| `admin`، `binaries` | `verdin-vX.Y.Z-<target>.tar.gz` (`.zip` على Windows) لـ `x86_64`/`aarch64-unknown-linux-musl` و`x86_64`/`aarch64-apple-darwin` و`x86_64-pc-windows-msvc`. لكل أرشيف مجلد واحد فيه `verdin` والتراخيص. | لا شيء |
| `deb` | `verdin_X.Y.Z-1_amd64.deb` و`_arm64.deb`، مبنيّتان بـ `cargo deb --no-build` من ملفات musl التنفيذية. | لا شيء |
| `publish` | إصدار GitHub: الأرشيفات والحزم و`SHA256SUMS`، مع ملاحظات قسم الإصدار من `CHANGELOG.md`. | لا شيء |
| `image` | `ghcr.io/verdin-cms/verdin` لـ amd64 وarm64. | لا شيء |
| `npm` | `@verdin/client`. | `NPM_TOKEN` (تُتخطى بدونه) |
| `homebrew` | `Formula/verdin.rb` في الـ tap، من `deploy/homebrew/verdin.rb.in`. | `HOMEBREW_TAP_TOKEN` (تُتخطى بدونه) |
| `winget` | طلب دمج إلى `microsoft/winget-pkgs` بملفات manifest الموجودة في `deploy/winget/`. | `WINGET_TOKEN` (تُتخطى بدونه) |

أسماء الأصول عقد ملزم: فـ `install.sh` وبيانات `cargo binstall` الوصفية في
`crates/verdin/Cargo.toml` وصيغة Homebrew وملفات manifest الخاصة بـ winget كلها تبنيها
من الإصدار والهدف. ويملأ `deploy/render-template.sh` قوالب Homebrew و
winget بالإصدار وقيم التحقق من `SHA256SUMS`، ويفشل إن فُقدت إحداها.

## إعداد لمرة واحدة للمهام الاختيارية

| ماذا | أين |
| --- | --- |
| **Homebrew tap.** أنشئ المستودع العام `verdin-cms/homebrew-tap` (الاسم هو ما يجعل `brew install verdin-cms/tap/verdin` يعمل). أضف رمزًا دقيق الصلاحيات بـ *Contents: read and write* عليه كسر `HOMEBREW_TAP_TOKEN`. لمستودع آخر: عيّن المتغير `HOMEBREW_TAP_REPOSITORY`. | أسرار المستودع ومتغيراته |
| **winget.** يراجع مشرفو winget أول تقديم لـ `VerdinCMS.Verdin`. انسخ (fork) `microsoft/winget-pkgs` بالحساب الذي يقدّم، وأضف رمزًا كلاسيكيًا لذلك الحساب بنطاق `public_repo` كـ `WINGET_TOKEN`. | أسرار المستودع |
| **npm.** `NPM_TOKEN`، رمز أتمتة لنطاق `@verdin`. | أسرار المستودع |
| **crates.io** (اختياري). يحتاج `cargo binstall verdin` بدون `--git` إلى وجود الحزمة على crates.io؛ وإلى ذلك الحين تستخدم الوثائق `--git`. | — |
| **زر Railway** (اختياري). أنشئ قالبًا على railway.com من المستودع (مسار التهيئة `deploy/one-click/railway.json`، وخدمة PostgreSQL، ووحدة تخزين على `/data`) وأضف زره إلى README و[النشر بنقرة واحدة](/ar/deploy/one-click/). | railway.com |

لا يحتاج زرا Render وDigitalOcean إلى أي حساب من جهة المشروع: فهما يقرآن
`render.yaml` و`.do/deploy.template.yaml` من الفرع الافتراضي.

بعض الإصدارات مكتوبة في الملفات وتتحرك مع كل إصدار فرعي: وسم الصورة في
`deploy/one-click/Dockerfile` و`deploy/playground/Dockerfile` و`deploy/compose/` و
الوثائق، و`version`/`appVersion` في `deploy/helm/verdin/Chart.yaml`.

## موقع الوثائق

يبني `.github/workflows/site.yml` المجلد `site/` عند كل دفع إلى `main` يمسّه
ويدفع الناتج إلى جذر فرع `gh-pages`. وتقدّم GitHub Pages ذلك الفرع
(Settings ← Pages ← Source: *Deploy from a branch*، و`gh-pages`، و`/`).

### النطاق

مكان الموقع هو متغير مستودع واحد، **`SITE_URL`**:

| `SITE_URL` | الموقع |
| --- | --- |
| غير معيَّن | `https://verdin-cms.github.io/verdin/` |
| `https://docs.example.com` | جذر ذلك النطاق |
| `https://example.com/verdin` | تحت `/verdin` على ذلك النطاق |

يأخذ `site/scripts/repo.mjs` قيمتَي `site` و`base` الخاصتين بـ Astro منه، فيتبعه كل رابط وأصل
وخريطة الموقع. ولا يزال `BASE_PATH` يتغلب على المسار إن عُيّن. لنطاق مخصص:

1. وجّه DNS النطاق إلى GitHub Pages (سجل `CNAME` إلى `verdin-cms.github.io`
   للنطاق الفرعي).
2. عيّن `SITE_URL` في Settings ← Secrets and variables ← Actions ← Variables.
3. شغّل سير عمل Site (أو ادفع إلى `main`). يكتب ملف `CNAME` في
   الفرع، فتلتقط GitHub النطاق؛ فعّل *Enforce HTTPS* بعد إصدار
   الشهادة.

تحتفظ الروابط خارج الموقع (README وبيانات الحزم الوصفية و`home` في مخطط Helm) بعنوان
`verdin-cms.github.io/verdin`، الذي تعيد GitHub توجيهه إلى النطاق المخصص.

### معاينات طلبات الدمج

يحصل كل طلب دمج يمسّ الموقع على معاينة على
`<SITE_URL>/pr-preview/pr-<number>/`، مرتبطة في تعليق:

1. يعمل `site-preview.yml` عند `pull_request`. يبني الموقع مع تعيين `SITE_URL` إلى
   عنوان المعاينة ويرفعه كـ artifact. وهو يشغّل شيفرة
   طلب الدمج، ولذلك، كما في كل سير عمل `pull_request` من fork، يملك رمزًا للقراءة فقط
   وبلا أسرار.
2. يعمل `site-preview-deploy.yml` عند `workflow_run` عندما ينجح ذلك البناء، في سياق
   هذا المستودع. ينزّل الـ artifact، ويتحقق من أن طلب الدمج
   مفتوح وأن البناء كان لرأسه الحالي، وينسخ الملفات إلى
   `pr-preview/pr-<number>/` على `gh-pages` ويحدّث التعليق. ولا يسحب شيفرة طلب الدمج
   ولا يشغّلها أبدًا.
3. عند إغلاق طلب الدمج، يحذف سير العمل نفسه (`pull_request_target`، الذي لا يستنسخ إلا
   `gh-pages`) المجلد.

يُبقي النشر الرئيسي على `pr-preview/`، وتتشارك المهام الثلاث مجموعة تزامن واحدة، فلا تكتب
إلا مهمة واحدة في `gh-pages` في كل مرة.

تُقدَّم المعاينات من المصدر (origin) نفسه الذي تُقدَّم منه الوثائق. هذا مقبول
لموقع ساكن بلا تسجيل دخول، لكن طلب دمج من fork يستطيع نشر أي HTML هناك
إلى أن يُغلق؛ أغلق طلبات الدمج التي تسيء استخدامه. وإن لم تكن متغيرات المستودع
متاحة لسير عمل fork، تُبنى معاينته لـ `SITE_URL` الافتراضي
وتنكسر روابطه تحت نطاق مخصص؛ أما معاينات طلبات الدمج من فروع هذا
المستودع فلا تتأثر.

### بيئة التجربة المستضافة

يشغّل العرض التجريبي العام حاوية `deploy/playground/`؛ راجع
[بيئة التجربة المستضافة](/ar/deploy/playground/). الاستضافة خارج المستودع: أي
منصة تُبقي حاوية واحدة تعمل خلف HTTPS.
