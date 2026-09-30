---
title: انتشارها و میزبانی مستندات
description: آنچه workflow انتشار منتشر می‌کند (باینری‌ها، checksumها، بسته‌های .deb، ایمیج، Homebrew، winget)، کلیدهای محرمانه‌ای که هر کار اختیاری نیاز دارد، و اینکه سایت مستندات، دامنهٔ آن و پیش‌نمایش‌های pull request چگونه میزبانی می‌شوند.
sidebar:
  order: 9
---

این صفحه برای نگهدارندگان است: وقتی یک tag نسخه push می‌شود چه اتفاقی می‌افتد، کدام بخش‌ها
به یک کلید محرمانه یا حساب نیاز دارند، و سایت مستندات چگونه منتشر می‌شود.

## workflow انتشار

push کردن یک tag با نام `vX.Y.Z` فایل `.github/workflows/release.yml` را اجرا می‌کند:

| کار | منتشر می‌کند | نیاز دارد |
| --- | --- | --- |
| `admin`، `binaries` | `verdin-vX.Y.Z-<target>.tar.gz` (در Windows `.zip`) برای `x86_64`/`aarch64-unknown-linux-musl`، `x86_64`/`aarch64-apple-darwin` و `x86_64-pc-windows-msvc`. هر آرشیو یک پوشه با `verdin` و مجوزها دارد. | هیچ |
| `deb` | `verdin_X.Y.Z-1_amd64.deb` و `_arm64.deb`، ساخته‌شده با `cargo deb --no-build` از باینری‌های musl. | هیچ |
| `publish` | نسخهٔ GitHub: آرشیوها، بسته‌ها و `SHA256SUMS`، با یادداشت‌های بخش همان نسخه در `CHANGELOG.md`. | هیچ |
| `image` | `ghcr.io/verdin-cms/verdin` برای amd64 و arm64. | هیچ |
| `npm` | `@verdin/client`. | `NPM_TOKEN` (بدون آن رد می‌شود) |
| `homebrew` | `Formula/verdin.rb` در tap، از `deploy/homebrew/verdin.rb.in`. | `HOMEBREW_TAP_TOKEN` (بدون آن رد می‌شود) |
| `winget` | یک pull request به `microsoft/winget-pkgs` با manifestهای `deploy/winget/`. | `WINGET_TOKEN` (بدون آن رد می‌شود) |

نام دارایی‌ها (asset) یک قرارداد است: `install.sh`، فراداده‌های `cargo binstall` در
`crates/verdin/Cargo.toml`، formula در Homebrew و manifestهای winget همه آن‌ها را
از نسخه و target می‌سازند. `deploy/render-template.sh` قالب‌های Homebrew و
winget را با نسخه و checksumهای `SHA256SUMS` پر می‌کند، و اگر یکی موجود نباشد شکست می‌خورد.

## راه‌اندازی یک‌باره برای کارهای اختیاری

| چه | کجا |
| --- | --- |
| **tap در Homebrew.** مخزن عمومی `verdin-cms/homebrew-tap` را بسازید (این نام باعث می‌شود `brew install verdin-cms/tap/verdin` کار کند). یک توکن fine-grained با *Contents: read and write* روی آن را به‌عنوان کلید محرمانهٔ `HOMEBREW_TAP_TOKEN` اضافه کنید. مخزن دیگر: متغیر `HOMEBREW_TAP_REPOSITORY` را تنظیم کنید. | کلیدهای محرمانه و متغیرهای مخزن |
| **winget.** نخستین ارسال `VerdinCMS.Verdin` را نگهدارندگان winget بازبینی می‌کنند. `microsoft/winget-pkgs` را با حسابی که ارسال می‌کند fork کنید، و یک توکن classic از آن حساب با scope برابر `public_repo` را به‌عنوان `WINGET_TOKEN` اضافه کنید. | کلیدهای محرمانهٔ مخزن |
| **npm.** `NPM_TOKEN`، یک توکن automation از scope برابر `@verdin`. | کلیدهای محرمانهٔ مخزن |
| **crates.io** (اختیاری). `cargo binstall verdin` بدون `--git` به crate روی crates.io نیاز دارد؛ تا آن زمان مستندات از `--git` استفاده می‌کنند. | — |
| **دکمهٔ Railway** (اختیاری). یک template در railway.com از مخزن بسازید (مسیر پیکربندی `deploy/one-click/railway.json`، یک سرویس PostgreSQL، یک volume در `/data`) و دکمهٔ آن را به README و [استقرارهای یک‌کلیکی](/fa/deploy/one-click/) اضافه کنید. | railway.com |

دکمه‌های Render و DigitalOcean به هیچ حسابی از سمت پروژه نیاز ندارند: آن‌ها
`render.yaml` و `.do/deploy.template.yaml` را از شاخهٔ پیش‌فرض می‌خوانند.

برخی نسخه‌ها در فایل‌ها نوشته شده‌اند و با هر نسخهٔ minor جابه‌جا می‌شوند: تگ ایمیج در
`deploy/one-click/Dockerfile`، `deploy/playground/Dockerfile`، `deploy/compose/` و
مستندات، و `version`/`appVersion` در `deploy/helm/verdin/Chart.yaml`.

## سایت مستندات

`.github/workflows/site.yml` پوشهٔ `site/` را با هر push به `main` که به آن دست بزند build می‌کند و
نتیجه را به ریشهٔ شاخهٔ `gh-pages` push می‌کند. GitHub Pages آن شاخه را ارائه می‌کند
(Settings → Pages → Source: *Deploy from a branch*، `gh-pages`، `/`).

### دامنه

اینکه سایت کجا قرار دارد یک متغیر مخزن است، **`SITE_URL`**:

| `SITE_URL` | سایت |
| --- | --- |
| تنظیم‌نشده | `https://verdin-cms.github.io/verdin/` |
| `https://docs.example.com` | ریشهٔ آن دامنه |
| `https://example.com/verdin` | زیر `/verdin` در آن دامنه |

`site/scripts/repo.mjs` مقدارهای `site` و `base` در Astro را از آن می‌گیرد، پس هر پیوند، دارایی و
نقشهٔ سایت (sitemap) آن را دنبال می‌کند. اگر `BASE_PATH` تنظیم شده باشد هنوز مسیر را بازنویسی می‌کند. برای یک دامنهٔ سفارشی:

1. DNS دامنه را به GitHub Pages اشاره دهید (یک رکورد `CNAME` به `verdin-cms.github.io`
   برای یک زیردامنه).
2. `SITE_URL` را در Settings → Secrets and variables → Actions → Variables تنظیم کنید.
3. workflow مربوط به Site را اجرا کنید (یا به `main` push کنید). فایل `CNAME` را در
   شاخه می‌نویسد، و GitHub دامنه را برمی‌دارد؛ وقتی گواهی صادر شد *Enforce HTTPS* را فعال کنید.

پیوندهای بیرون از سایت (README، فراداده‌های بسته، `home` در چارت Helm) همان نشانی
`verdin-cms.github.io/verdin` را نگه می‌دارند، که GitHub آن را به دامنهٔ سفارشی هدایت می‌کند.

### پیش‌نمایش‌های pull request

هر pull request که به سایت دست بزند یک پیش‌نمایش در
`<SITE_URL>/pr-preview/pr-<number>/` می‌گیرد، که در یک نظر به آن پیوند داده می‌شود:

1. `site-preview.yml` روی `pull_request` اجرا می‌شود. سایت را با `SITE_URL` روی نشانی پیش‌نمایش
   build می‌کند و به‌صورت یک artifact بارگذاری می‌کند. کد خود pull request را اجرا می‌کند،
   بنابراین مانند هر workflow از نوع `pull_request` از یک fork، توکن فقط‌خواندنی دارد
   و هیچ کلید محرمانه‌ای ندارد.
2. `site-preview-deploy.yml` وقتی آن build موفق شود روی `workflow_run` و در بستر همین
   مخزن اجرا می‌شود. artifact را دانلود می‌کند، بررسی می‌کند که pull request باز است
   و build برای head فعلی آن بوده، فایل‌ها را به
   `pr-preview/pr-<number>/` در `gh-pages` کپی می‌کند و نظر را به‌روز می‌کند. هرگز کد pull request را
   checkout یا اجرا نمی‌کند.
3. وقتی pull request بسته شود، همان workflow (`pull_request_target`، که فقط `gh-pages` را
   clone می‌کند) پوشه را حذف می‌کند.

استقرار اصلی `pr-preview/` را نگه می‌دارد، و هر سه یک concurrency group مشترک دارند، پس هر بار فقط
یک کار روی `gh-pages` می‌نویسد.

پیش‌نمایش‌ها از همان origin مستندات ارائه می‌شوند. این برای یک سایت static بدون ورود قابل‌قبول است، اما pull request
یک fork می‌تواند تا وقتی بسته شود هر HTML‌ای را آنجا منتشر کند؛ pull requestهایی را که از آن سوءاستفاده می‌کنند ببندید. اگر متغیرهای مخزن
برای workflow یک fork در دسترس نباشند، پیش‌نمایش آن برای `SITE_URL` پیش‌فرض build می‌شود
و پیوندهایش زیر یک دامنهٔ سفارشی می‌شکنند؛ پیش‌نمایش pull requestهای شاخه‌های همین مخزن
تحت تأثیر نیست.

### playground میزبانی‌شده

دموی عمومی کانتینر `deploy/playground/` را اجرا می‌کند؛ بخش
[Playground میزبانی‌شده](/fa/deploy/playground/) را ببینید. میزبانی آن بیرون از مخزن است: هر
پلتفرمی که یک کانتینر را پشت HTTPS در حال اجرا نگه دارد.
