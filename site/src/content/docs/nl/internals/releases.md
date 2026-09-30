---
title: Releases en hosting van de docs
description: Wat de releaseworkflow publiceert (binaries, checksums, .deb-pakketten, het image, Homebrew, winget), de geheimen die elke optionele job nodig heeft, en hoe de documentatiesite, zijn domein en previews van pull requests worden gehost.
sidebar:
  order: 9
---

Deze pagina is voor maintainers: wat er gebeurt wanneer een versietag wordt gepusht, welke delen
een geheim of account nodig hebben, en hoe de documentatiesite wordt gepubliceerd.

## De releaseworkflow

Een tag `vX.Y.Z` pushen draait `.github/workflows/release.yml`:

| Job | Publiceert | Heeft nodig |
| --- | --- | --- |
| `admin`, `binaries` | `verdin-vX.Y.Z-<target>.tar.gz` (`.zip` op Windows) voor `x86_64`/`aarch64-unknown-linux-musl`, `x86_64`/`aarch64-apple-darwin` en `x86_64-pc-windows-msvc`. Elk archief heeft één map met `verdin` en de licenties. | Niets |
| `deb` | `verdin_X.Y.Z-1_amd64.deb` en `_arm64.deb`, gebouwd met `cargo deb --no-build` uit de musl-binaries. | Niets |
| `publish` | De GitHub-release: archieven, pakketten en `SHA256SUMS`, met de notities van de sectie van de versie in `CHANGELOG.md`. | Niets |
| `image` | `ghcr.io/verdin-cms/verdin` voor amd64 en arm64. | Niets |
| `npm` | `@verdin/client`. | `NPM_TOKEN` (overgeslagen zonder) |
| `homebrew` | `Formula/verdin.rb` in de tap, uit `deploy/homebrew/verdin.rb.in`. | `HOMEBREW_TAP_TOKEN` (overgeslagen zonder) |
| `winget` | Een pull request naar `microsoft/winget-pkgs` met de manifesten van `deploy/winget/`. | `WINGET_TOKEN` (overgeslagen zonder) |

De assetnamen zijn een contract: `install.sh`, de `cargo binstall`-metadata in
`crates/verdin/Cargo.toml`, de Homebrew-formula en de winget-manifesten bouwen ze allemaal
uit de versie en het target. `deploy/render-template.sh` vult de Homebrew- en
winget-templates met de versie en de checksums van `SHA256SUMS`, en faalt als er een
ontbreekt.

## Eenmalige inrichting voor de optionele jobs

| Wat | Waar |
| --- | --- |
| **Homebrew-tap.** Maak de openbare repository `verdin-cms/homebrew-tap` aan (de naam laat `brew install verdin-cms/tap/verdin` werken). Voeg er een fine-grained token met *Contents: read and write* voor toe als het secret `HOMEBREW_TAP_TOKEN`. Een andere repository: stel de variabele `HOMEBREW_TAP_REPOSITORY` in. | Repository-secrets en -variabelen |
| **winget.** De eerste indiening van `VerdinCMS.Verdin` wordt beoordeeld door de winget-maintainers. Fork `microsoft/winget-pkgs` met het account dat indient, en voeg een classic token van dat account met de scope `public_repo` toe als `WINGET_TOKEN`. | Repository-secrets |
| **npm.** `NPM_TOKEN`, een automation-token van de scope `@verdin`. | Repository-secrets |
| **crates.io** (optioneel). `cargo binstall verdin` zonder `--git` heeft de crate op crates.io nodig; tot dan gebruiken de docs `--git`. | — |
| **Railway-knop** (optioneel). Maak op railway.com een template aan vanuit de repository (configpad `deploy/one-click/railway.json`, een PostgreSQL-service, een volume op `/data`) en voeg de knop toe aan de README en [Deploys met één klik](/nl/deploy/one-click/). | railway.com |

De knoppen van Render en DigitalOcean hebben geen account aan de kant van het project nodig: ze
lezen `render.yaml` en `.do/deploy.template.yaml` van de standaardbranch.

Sommige versies staan in bestanden geschreven en gaan mee met elke minor release: de image-tag in
`deploy/one-click/Dockerfile`, `deploy/playground/Dockerfile`, `deploy/compose/` en
de docs, en `version`/`appVersion` in `deploy/helm/verdin/Chart.yaml`.

## De documentatiesite

`.github/workflows/site.yml` bouwt `site/` bij elke push naar `main` die het raakt en
pusht het resultaat naar de root van de branch `gh-pages`. GitHub Pages serveert die branch
(Settings → Pages → Source: *Deploy from a branch*, `gh-pages`, `/`).

### Het domein

Waar de site staat, is één repositoryvariabele, **`SITE_URL`**:

| `SITE_URL` | Site |
| --- | --- |
| niet ingesteld | `https://verdin-cms.github.io/verdin/` |
| `https://docs.example.com` | De root van dat domein |
| `https://example.com/verdin` | Onder `/verdin` op dat domein |

`site/scripts/repo.mjs` neemt `site` en `base` van Astro eruit over, dus elke link, asset en
de sitemap volgen. `BASE_PATH` overschrijft het pad nog steeds als het is ingesteld. Voor een eigen
domein:

1. Laat de DNS van het domein naar GitHub Pages wijzen (een `CNAME`-record naar
   `verdin-cms.github.io` voor een subdomein).
2. Stel `SITE_URL` in bij Settings → Secrets and variables → Actions → Variables.
3. Draai de Site-workflow (of push naar `main`). Hij schrijft het bestand `CNAME` in de
   branch, en GitHub pikt het domein op; zet *Enforce HTTPS* aan zodra het certificaat
   is uitgegeven.

Links buiten de site (de README, pakketmetadata, de `home` van de Helm-chart) behouden het adres
`verdin-cms.github.io/verdin`, dat GitHub doorverwijst naar het eigen domein.

### Previews van pull requests

Elke pull request die de site raakt, krijgt een preview op
`<SITE_URL>/pr-preview/pr-<number>/`, gelinkt in een reactie:

1. `site-preview.yml` draait bij `pull_request`. Hij bouwt de site met `SITE_URL` ingesteld op
   het adres van de preview en uploadt hem als artifact. Hij draait de code van de pull request,
   dus, zoals bij elke `pull_request`-workflow vanuit een fork, heeft hij een alleen-lezentoken
   en geen geheimen.
2. `site-preview-deploy.yml` draait bij `workflow_run` wanneer die build slaagt, in de context
   van deze repository. Hij downloadt het artifact, controleert dat de pull request
   open is en dat de build voor zijn huidige head was, kopieert de bestanden naar
   `pr-preview/pr-<number>/` op `gh-pages` en werkt de reactie bij. Hij checkt nooit code van
   een pull request uit en draait die nooit.
3. Wanneer de pull request sluit, verwijdert dezelfde workflow (`pull_request_target`, die alleen
   `gh-pages` kloont) de map.

De hoofddeploy behoudt `pr-preview/`, en alle drie delen één concurrency-groep, zodat er maar
één job tegelijk naar `gh-pages` schrijft.

Previews worden vanaf dezelfde origin geserveerd als de documentatie. Dat is acceptabel voor
een statische site zonder inloggen, maar de pull request van een fork kan daar elke HTML
publiceren totdat hij is gesloten; sluit pull requests die dit misbruiken. Als repositoryvariabelen
niet beschikbaar zijn voor de workflow van een fork, wordt zijn preview gebouwd voor de standaard
`SITE_URL` en breken zijn links onder een eigen domein; previews van pull requests vanuit branches
van deze repository worden daar niet door geraakt.

### De gehoste playground

De openbare demo draait de container van `deploy/playground/`; zie
[Gehoste playground](/nl/deploy/playground/). Het hosten ervan valt buiten de repository: elk
platform dat één container achter HTTPS draaiend houdt.
