---
title: Релізи й хостинг документації
description: Що публікує робочий процес релізу (бінарники, контрольні суми, пакети .deb, образ, Homebrew, winget), які секрети потрібні кожному необов'язковому завданню та як розміщено сайт документації, його домен і попередні перегляди pull request.
sidebar:
  order: 9
---

Ця сторінка для мейнтейнерів: що відбувається, коли надсилають тег версії, які частини
потребують секрету чи облікового запису та як публікується сайт документації.

## Робочий процес релізу

Надсилання тега `vX.Y.Z` запускає `.github/workflows/release.yml`:

| Завдання | Публікує | Потребує |
| --- | --- | --- |
| `admin`, `binaries` | `verdin-vX.Y.Z-<target>.tar.gz` (`.zip` у Windows) для `x86_64`/`aarch64-unknown-linux-musl`, `x86_64`/`aarch64-apple-darwin` і `x86_64-pc-windows-msvc`. Кожен архів містить одну теку з `verdin` і ліцензіями. | Нічого |
| `deb` | `verdin_X.Y.Z-1_amd64.deb` і `_arm64.deb`, зібрані через `cargo deb --no-build` з бінарників musl. | Нічого |
| `publish` | Реліз GitHub: архіви, пакети й `SHA256SUMS` з нотатками розділу `CHANGELOG.md` цієї версії. | Нічого |
| `image` | `ghcr.io/verdin-cms/verdin` для amd64 і arm64. | Нічого |
| `npm` | `@verdin/client`. | `NPM_TOKEN` (пропускається без нього) |
| `homebrew` | `Formula/verdin.rb` у tap, з `deploy/homebrew/verdin.rb.in`. | `HOMEBREW_TAP_TOKEN` (пропускається без нього) |
| `winget` | Pull request до `microsoft/winget-pkgs` з маніфестами з `deploy/winget/`. | `WINGET_TOKEN` (пропускається без нього) |

Імена ресурсів — це контракт: `install.sh`, метадані `cargo binstall` у
`crates/verdin/Cargo.toml`, формула Homebrew і маніфести winget будують їх із версії та цілі.
`deploy/render-template.sh` заповнює шаблони Homebrew і winget версією та контрольними сумами з
`SHA256SUMS` і завершується помилкою, якщо якоїсь бракує.

## Одноразове налаштування необов'язкових завдань

| Що | Де |
| --- | --- |
| **Homebrew tap.** Створіть публічний репозиторій `verdin-cms/homebrew-tap` (через цю назву працює `brew install verdin-cms/tap/verdin`). Додайте fine-grained токен із *Contents: read and write* на нього як секрет `HOMEBREW_TAP_TOKEN`. Інший репозиторій: задайте змінну `HOMEBREW_TAP_REPOSITORY`. | Секрети й змінні репозиторію |
| **winget.** Першу подачу `VerdinCMS.Verdin` перевіряють мейнтейнери winget. Зробіть форк `microsoft/winget-pkgs` з облікового запису, що подає, і додайте classic-токен цього облікового запису з областю `public_repo` як `WINGET_TOKEN`. | Секрети репозиторію |
| **npm.** `NPM_TOKEN`, automation-токен області `@verdin`. | Секрети репозиторію |
| **crates.io** (необов'язково). `cargo binstall verdin` без `--git` потребує крейта на crates.io; доти документація використовує `--git`. | — |
| **Кнопка Railway** (необов'язково). Створіть шаблон на railway.com з репозиторію (шлях конфігурації `deploy/one-click/railway.json`, сервіс PostgreSQL, том у `/data`) і додайте його кнопку до README та [Розгортання в один клік](/uk/deploy/one-click/). | railway.com |

Кнопкам Render і DigitalOcean не потрібен обліковий запис з боку проєкту: вони читають
`render.yaml` і `.do/deploy.template.yaml` з типової гілки.

Деякі версії записано у файли, і вони змінюються з кожним мінорним релізом: тег образу в
`deploy/one-click/Dockerfile`, `deploy/playground/Dockerfile`, `deploy/compose/` і в
документації, а також `version`/`appVersion` у `deploy/helm/verdin/Chart.yaml`.

## Сайт документації

`.github/workflows/site.yml` збирає `site/` за кожним надсиланням до `main`, що його торкається,
і надсилає результат у корінь гілки `gh-pages`. GitHub Pages віддає цю гілку (Settings → Pages →
Source: *Deploy from a branch*, `gh-pages`, `/`).

### Домен

Де живе сайт, визначає одна змінна репозиторію, **`SITE_URL`**:

| `SITE_URL` | Сайт |
| --- | --- |
| не задано | `https://verdin-cms.github.io/verdin/` |
| `https://docs.example.com` | Корінь цього домену |
| `https://example.com/verdin` | Під `/verdin` на цьому домені |

`site/scripts/repo.mjs` бере з неї `site` і `base` Astro, тож кожне посилання, ресурс і
sitemap йдуть слідом. `BASE_PATH` і далі перевизначає шлях, якщо його задано. Для власного
домену:

1. Спрямуйте DNS домену на GitHub Pages (запис `CNAME` на `verdin-cms.github.io` для
   піддомену).
2. Задайте `SITE_URL` у Settings → Secrets and variables → Actions → Variables.
3. Запустіть робочий процес Site (або надішліть до `main`). Він запише файл `CNAME` у гілку, і
   GitHub підхопить домен; увімкніть *Enforce HTTPS*, щойно буде видано сертифікат.

Посилання поза сайтом (README, метадані пакетів, `home` Helm-чарта) зберігають адресу
`verdin-cms.github.io/verdin`, яку GitHub перенаправляє на власний домен.

### Попередні перегляди pull request

Кожен pull request, що торкається сайту, отримує попередній перегляд за адресою
`<SITE_URL>/pr-preview/pr-<number>/` з посиланням у коментарі:

1. `site-preview.yml` запускається на `pull_request`. Він збирає сайт із `SITE_URL`, заданим як
   адреса перегляду, і завантажує його як артефакт. Він виконує код pull request, тож, як і
   кожен робочий процес `pull_request` із форка, має токен лише для читання і не має секретів.
2. `site-preview-deploy.yml` запускається на `workflow_run`, коли ця збірка успішна, у
   контексті цього репозиторію. Він завантажує артефакт, перевіряє, що pull request відкритий і
   що збірка була для його поточної голови, копіює файли в `pr-preview/pr-<number>/` на
   `gh-pages` і оновлює коментар. Він ніколи не отримує й не виконує код pull request.
3. Коли pull request закривається, той самий робочий процес (`pull_request_target`, що лише
   клонує `gh-pages`) видаляє теку.

Основне розгортання зберігає `pr-preview/`, а всі три ділять одну групу concurrency, тож
у `gh-pages` пише лише одне завдання одночасно.

Попередні перегляди віддаються з того самого origin, що й документація. Для статичного сайту
без входу це прийнятно, але pull request із форка може опублікувати там будь-який HTML, доки
його не закрито; закривайте pull request, що зловживають цим. Якщо змінні репозиторію недоступні
робочому процесу форка, його перегляд збирається для типового `SITE_URL`, а посилання ламаються
під власним доменом; перегляди pull request із гілок цього репозиторію це не зачіпає.

### Хостингова пісочниця

Публічна демонстрація запускає контейнер із `deploy/playground/`; див.
[Хостингова пісочниця](/uk/deploy/playground/). Її розміщення поза репозиторієм: підійде
будь-яка платформа, що тримає один контейнер запущеним за HTTPS.
