---
title: Releases and docs hosting
description: What the release workflow publishes (binaries, checksums, .deb packages, the image, Homebrew, winget), the secrets each optional job needs, and how the documentation site, its domain and pull request previews are hosted.
sidebar:
  order: 9
---

This page is for maintainers: what happens when a version tag is pushed, which parts
need a secret or an account, and how the documentation site is published.

## The release workflow

Pushing a tag `vX.Y.Z` runs `.github/workflows/release.yml`:

| Job | Publishes | Needs |
| --- | --- | --- |
| `admin`, `binaries` | `verdin-vX.Y.Z-<target>.tar.gz` (`.zip` on Windows) for `x86_64`/`aarch64-unknown-linux-musl`, `x86_64`/`aarch64-apple-darwin` and `x86_64-pc-windows-msvc`. Each archive has one folder with `verdin` and the licences. | Nothing |
| `deb` | `verdin_X.Y.Z-1_amd64.deb` and `_arm64.deb`, built with `cargo deb --no-build` from the musl binaries. | Nothing |
| `publish` | The GitHub release: archives, packages and `SHA256SUMS`, with the notes of the version's `CHANGELOG.md` section. | Nothing |
| `image` | `ghcr.io/verdin-cms/verdin` for amd64 and arm64. | Nothing |
| `npm` | `@verdin/client`. | `NPM_TOKEN` (skips without) |
| `homebrew` | `Formula/verdin.rb` in the tap, from `deploy/homebrew/verdin.rb.in`. | `HOMEBREW_TAP_TOKEN` (skips without) |
| `winget` | A pull request to `microsoft/winget-pkgs` with the manifests of `deploy/winget/`. | `WINGET_TOKEN` (skips without) |

The asset names are a contract: `install.sh`, the `cargo binstall` metadata in
`crates/verdin/Cargo.toml`, the Homebrew formula and the winget manifests all build
them from the version and target. `deploy/render-template.sh` fills the Homebrew and
winget templates with the version and the checksums of `SHA256SUMS`, and fails if one
is missing.

## One-time setup for the optional jobs

| What | Where |
| --- | --- |
| **Homebrew tap.** Create the public repository `verdin-cms/homebrew-tap` (the name makes `brew install verdin-cms/tap/verdin` work). Add a fine-grained token with *Contents: read and write* on it as the `HOMEBREW_TAP_TOKEN` secret. Another repository: set the `HOMEBREW_TAP_REPOSITORY` variable. | Repository secrets and variables |
| **winget.** The first submission of `VerdinCMS.Verdin` is reviewed by the winget maintainers. Fork `microsoft/winget-pkgs` with the account that submits, and add a classic token of that account with the `public_repo` scope as `WINGET_TOKEN`. | Repository secrets |
| **npm.** `NPM_TOKEN`, an automation token of the `@verdin` scope. | Repository secrets |
| **crates.io** (optional). `cargo binstall verdin` without `--git` needs the crate on crates.io; until then the docs use `--git`. | — |
| **Railway button** (optional). Create a template on railway.com from the repository (config path `deploy/one-click/railway.json`, a PostgreSQL service, a volume at `/data`) and add its button to the README and [One-click deploys](/deploy/one-click/). | railway.com |

The Render and DigitalOcean buttons need no account on the project's side: they read
`render.yaml` and `.do/deploy.template.yaml` from the default branch.

Some versions are written into files and move with each minor release: the image tag in
`deploy/one-click/Dockerfile`, `deploy/playground/Dockerfile`, `deploy/compose/` and
the docs, and `version`/`appVersion` in `deploy/helm/verdin/Chart.yaml`.

## The documentation site

`.github/workflows/site.yml` builds `site/` on every push to `main` that touches it and
pushes the result to the root of the `gh-pages` branch. GitHub Pages serves that branch
(Settings → Pages → Source: *Deploy from a branch*, `gh-pages`, `/`).

### The domain

Where the site lives is one repository variable, **`SITE_URL`**:

| `SITE_URL` | Site |
| --- | --- |
| unset | `https://verdin-cms.github.io/verdin/` |
| `https://docs.example.com` | The root of that domain |
| `https://example.com/verdin` | Under `/verdin` on that domain |

`site/scripts/repo.mjs` takes Astro's `site` and `base` from it, so every link, asset and
the sitemap follow. `BASE_PATH` still overrides the path if set. For a custom domain:

1. Point the domain's DNS at GitHub Pages (a `CNAME` record to `verdin-cms.github.io`
   for a subdomain).
2. Set `SITE_URL` in Settings → Secrets and variables → Actions → Variables.
3. Run the Site workflow (or push to `main`). It writes the `CNAME` file into the
   branch, and GitHub picks the domain up; enable *Enforce HTTPS* once the certificate
   is issued.

Links outside the site (the README, package metadata, the Helm chart's `home`) keep the
`verdin-cms.github.io/verdin` address, which GitHub redirects to the custom domain.

### Pull request previews

Each pull request that touches the site gets a preview at
`<SITE_URL>/pr-preview/pr-<number>/`, linked in a comment:

1. `site-preview.yml` runs on `pull_request`. It builds the site with `SITE_URL` set to
   the preview's address and uploads it as an artifact. It runs the pull request's
   code, so, as for every `pull_request` workflow from a fork, it has a read-only token
   and no secrets.
2. `site-preview-deploy.yml` runs on `workflow_run` when that build succeeds, in this
   repository's context. It downloads the artifact, checks that the pull request is
   open and that the build was for its current head, copies the files to
   `pr-preview/pr-<number>/` on `gh-pages` and updates the comment. It never checks out
   or runs pull request code.
3. When the pull request closes, the same workflow (`pull_request_target`, which only
   clones `gh-pages`) deletes the folder.

The main deploy keeps `pr-preview/`, and all three share one concurrency group, so only
one job writes `gh-pages` at a time.

Previews are served from the same origin as the documentation. That is acceptable for
a static site without sign-in, but a fork's pull request can publish any HTML there
until it is closed; close pull requests that abuse it. If repository variables are not
available to a fork's workflow, its preview is built for the default `SITE_URL` and
its links break under a custom domain; previews of pull requests from branches of this
repository are not affected.

### The hosted playground

The public demo runs the container of `deploy/playground/`; see
[Hosted playground](/deploy/playground/). Hosting it is outside the repository: any
platform that keeps one container running behind HTTPS.
