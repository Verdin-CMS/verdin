---
title: Релизы и хостинг документации
description: Что публикует рабочий процесс релиза (бинарники, контрольные суммы, пакеты .deb, образ, Homebrew, winget), какие секреты нужны каждому необязательному заданию и как хостятся сайт документации, его домен и превью pull request.
sidebar:
  order: 9
---

Эта страница для мейнтейнеров: что происходит при отправке тега версии, какие части требуют
секрета или учётной записи и как публикуется сайт документации.

## Рабочий процесс релиза

Отправка тега `vX.Y.Z` запускает `.github/workflows/release.yml`:

| Задание | Публикует | Требует |
| --- | --- | --- |
| `admin`, `binaries` | `verdin-vX.Y.Z-<target>.tar.gz` (`.zip` в Windows) для `x86_64`/`aarch64-unknown-linux-musl`, `x86_64`/`aarch64-apple-darwin` и `x86_64-pc-windows-msvc`. В каждом архиве одна папка с `verdin` и лицензиями. | Ничего |
| `deb` | `verdin_X.Y.Z-1_amd64.deb` и `_arm64.deb`, собранные командой `cargo deb --no-build` из бинарников musl. | Ничего |
| `publish` | Релиз GitHub: архивы, пакеты и `SHA256SUMS` с заметками из раздела `CHANGELOG.md` этой версии. | Ничего |
| `image` | `ghcr.io/verdin-cms/verdin` для amd64 и arm64. | Ничего |
| `npm` | `@verdin/client`. | `NPM_TOKEN` (без него пропускается) |
| `homebrew` | `Formula/verdin.rb` в tap из `deploy/homebrew/verdin.rb.in`. | `HOMEBREW_TAP_TOKEN` (без него пропускается) |
| `winget` | Pull request в `microsoft/winget-pkgs` с манифестами из `deploy/winget/`. | `WINGET_TOKEN` (без него пропускается) |

Имена ресурсов — это контракт: `install.sh`, метаданные `cargo binstall` в
`crates/verdin/Cargo.toml`, формула Homebrew и манифесты winget строят их из версии и
целевой платформы. `deploy/render-template.sh` заполняет шаблоны Homebrew и winget версией и
контрольными суммами из `SHA256SUMS` и завершается ошибкой, если какой-то суммы нет.

## Однократная настройка необязательных заданий

| Что | Где |
| --- | --- |
| **Tap Homebrew.** Создайте публичный репозиторий `verdin-cms/homebrew-tap` (благодаря имени работает `brew install verdin-cms/tap/verdin`). Добавьте в него как секрет `HOMEBREW_TAP_TOKEN` fine-grained токен с правом *Contents: read and write*. Другой репозиторий: задайте переменную `HOMEBREW_TAP_REPOSITORY`. | Секреты и переменные репозитория |
| **winget.** Первую подачу `VerdinCMS.Verdin` проверяют мейнтейнеры winget. Сделайте форк `microsoft/winget-pkgs` от имени аккаунта, который подаёт, и добавьте как `WINGET_TOKEN` классический токен этого аккаунта с областью `public_repo`. | Секреты репозитория |
| **npm.** `NPM_TOKEN` — токен автоматизации области `@verdin`. | Секреты репозитория |
| **crates.io** (необязательно). `cargo binstall verdin` без `--git` требует, чтобы крейт был на crates.io; пока его там нет, в документации используется `--git`. | — |
| **Кнопка Railway** (необязательно). Создайте шаблон на railway.com из репозитория (путь к конфигурации `deploy/one-click/railway.json`, сервис PostgreSQL, том в `/data`) и добавьте его кнопку в README и в [Развёртывание в один клик](/ru/deploy/one-click/). | railway.com |

Кнопкам Render и DigitalOcean не нужна учётная запись со стороны проекта: они читают
`render.yaml` и `.do/deploy.template.yaml` из ветки по умолчанию.

Некоторые версии записаны в файлах и меняются с каждым минорным релизом: тег образа в
`deploy/one-click/Dockerfile`, `deploy/playground/Dockerfile`, `deploy/compose/` и в
документации, а также `version`/`appVersion` в `deploy/helm/verdin/Chart.yaml`.

## Сайт документации

`.github/workflows/site.yml` собирает `site/` при каждом push в `main`, затрагивающем его, и
отправляет результат в корень ветки `gh-pages`. GitHub Pages отдаёт эту ветку (Settings →
Pages → Source: *Deploy from a branch*, `gh-pages`, `/`).

### Домен

Где находится сайт, определяет одна переменная репозитория, **`SITE_URL`**:

| `SITE_URL` | Сайт |
| --- | --- |
| не задана | `https://verdin-cms.github.io/verdin/` |
| `https://docs.example.com` | Корень этого домена |
| `https://example.com/verdin` | Под `/verdin` на этом домене |

`site/scripts/repo.mjs` берёт из неё `site` и `base` Astro, поэтому за ней следуют все ссылки,
ресурсы и карта сайта. `BASE_PATH`, если задан, по-прежнему переопределяет путь. Для
собственного домена:

1. Направьте DNS домена на GitHub Pages (запись `CNAME` на `verdin-cms.github.io` для
   поддомена).
2. Задайте `SITE_URL` в Settings → Secrets and variables → Actions → Variables.
3. Запустите рабочий процесс Site (или сделайте push в `main`). Он запишет файл `CNAME` в
   ветку, и GitHub подхватит домен; включите *Enforce HTTPS*, когда будет выпущен
   сертификат.

Ссылки за пределами сайта (README, метаданные пакетов, `home` Helm-чарта) сохраняют адрес
`verdin-cms.github.io/verdin`, который GitHub перенаправляет на собственный домен.

### Превью pull request

Каждый pull request, затрагивающий сайт, получает превью по адресу
`<SITE_URL>/pr-preview/pr-<number>/` со ссылкой в комментарии:

1. `site-preview.yml` запускается на `pull_request`. Он собирает сайт с `SITE_URL`, равным
   адресу превью, и загружает его как артефакт. Он выполняет код pull request, поэтому, как и
   любой рабочий процесс `pull_request` из форка, имеет токен только для чтения и не имеет
   секретов.
2. `site-preview-deploy.yml` запускается на `workflow_run`, когда эта сборка успешна, в
   контексте этого репозитория. Он скачивает артефакт, проверяет, что pull request открыт и
   что сборка была для его текущего head, копирует файлы в `pr-preview/pr-<number>/` на
   `gh-pages` и обновляет комментарий. Он никогда не получает и не выполняет код pull request.
3. Когда pull request закрывается, тот же рабочий процесс (`pull_request_target`, который
   только клонирует `gh-pages`) удаляет папку.

Основной деплой сохраняет `pr-preview/`, а все три процесса входят в одну группу
конкурентности, поэтому в `gh-pages` пишет только одно задание за раз.

Превью отдаются с того же origin, что и документация. Для статического сайта без входа это
приемлемо, но pull request из форка может опубликовать там любой HTML, пока не будет закрыт;
закрывайте pull request, которые этим злоупотребляют. Если переменные репозитория недоступны
рабочему процессу форка, его превью собирается для `SITE_URL` по умолчанию, и его ссылки ломаются
при собственном домене; превью pull request из веток этого репозитория это не затрагивает.

### Хостируемая демо-площадка

Публичное демо запускает контейнер из `deploy/playground/`; см.
[Хостируемая демо-площадка](/ru/deploy/playground/). Хостинг находится за пределами
репозитория: подойдёт любая платформа, которая держит один контейнер запущенным за HTTPS.
