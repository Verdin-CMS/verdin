---
title: Releases und Hosting der Dokumentation
description: Was der Release-Workflow veröffentlicht (Binärdateien, Prüfsummen, .deb-Pakete, das Image, Homebrew, winget), welche Secrets jeder optionale Job braucht und wie die Dokumentationsseite, ihre Domain und Pull-Request-Vorschauen gehostet werden.
sidebar:
  order: 9
---

Diese Seite richtet sich an Maintainer: was passiert, wenn ein Versions-Tag gepusht wird, welche
Teile ein Secret oder ein Konto brauchen und wie die Dokumentationsseite veröffentlicht wird.

## Der Release-Workflow

Das Pushen eines Tags `vX.Y.Z` führt `.github/workflows/release.yml` aus:

| Job | Veröffentlicht | Braucht |
| --- | --- | --- |
| `admin`, `binaries` | `verdin-vX.Y.Z-<target>.tar.gz` (`.zip` unter Windows) für `x86_64`/`aarch64-unknown-linux-musl`, `x86_64`/`aarch64-apple-darwin` und `x86_64-pc-windows-msvc`. Jedes Archiv hat einen Ordner mit `verdin` und den Lizenzen. | Nichts |
| `deb` | `verdin_X.Y.Z-1_amd64.deb` und `_arm64.deb`, mit `cargo deb --no-build` aus den musl-Binärdateien gebaut. | Nichts |
| `publish` | Das GitHub-Release: Archive, Pakete und `SHA256SUMS`, mit den Notizen des Abschnitts der Version in `CHANGELOG.md`. | Nichts |
| `image` | `ghcr.io/verdin-cms/verdin` für amd64 und arm64. | Nichts |
| `npm` | `@verdin/client`. | `NPM_TOKEN` (wird ohne übersprungen) |
| `homebrew` | `Formula/verdin.rb` im Tap, aus `deploy/homebrew/verdin.rb.in`. | `HOMEBREW_TAP_TOKEN` (wird ohne übersprungen) |
| `winget` | Ein Pull Request an `microsoft/winget-pkgs` mit den Manifesten aus `deploy/winget/`. | `WINGET_TOKEN` (wird ohne übersprungen) |

Die Asset-Namen sind ein Vertrag: `install.sh`, die `cargo binstall`-Metadaten in
`crates/verdin/Cargo.toml`, die Homebrew-Formel und die winget-Manifeste bilden sie alle aus
Version und Target. `deploy/render-template.sh` füllt die Homebrew- und winget-Vorlagen mit der
Version und den Prüfsummen aus `SHA256SUMS` und schlägt fehl, wenn eine fehlt.

## Einmalige Einrichtung für die optionalen Jobs

| Was | Wo |
| --- | --- |
| **Homebrew-Tap.** Lege das öffentliche Repository `verdin-cms/homebrew-tap` an (der Name lässt `brew install verdin-cms/tap/verdin` funktionieren). Füge ein Fine-grained-Token mit *Contents: read and write* darauf als Secret `HOMEBREW_TAP_TOKEN` hinzu. Anderes Repository: Setze die Variable `HOMEBREW_TAP_REPOSITORY`. | Repository-Secrets und -Variablen |
| **winget.** Die erste Einreichung von `VerdinCMS.Verdin` wird von den winget-Maintainern geprüft. Forke `microsoft/winget-pkgs` mit dem Konto, das einreicht, und füge ein Classic-Token dieses Kontos mit dem Scope `public_repo` als `WINGET_TOKEN` hinzu. | Repository-Secrets |
| **npm.** `NPM_TOKEN`, ein Automation-Token des Scopes `@verdin`. | Repository-Secrets |
| **crates.io** (optional). `cargo binstall verdin` ohne `--git` braucht das Crate auf crates.io; bis dahin nutzt die Dokumentation `--git`. | — |
| **Railway-Button** (optional). Lege auf railway.com eine Vorlage aus dem Repository an (Konfigurationspfad `deploy/one-click/railway.json`, ein PostgreSQL-Dienst, ein Volume unter `/data`) und füge ihren Button zur README und zu [One-Click-Deploys](/de/deploy/one-click/) hinzu. | railway.com |

Die Buttons für Render und DigitalOcean brauchen auf Seiten des Projekts kein Konto: Sie lesen
`render.yaml` und `.do/deploy.template.yaml` vom Standard-Branch.

Manche Versionen stehen in Dateien und wandern mit jedem Minor-Release: der Image-Tag in
`deploy/one-click/Dockerfile`, `deploy/playground/Dockerfile`, `deploy/compose/` und der
Dokumentation sowie `version`/`appVersion` in `deploy/helm/verdin/Chart.yaml`.

## Die Dokumentationsseite

`.github/workflows/site.yml` baut `site/` bei jedem Push auf `main`, der sie berührt, und pusht
das Ergebnis in die Wurzel des Branches `gh-pages`. GitHub Pages liefert diesen Branch aus
(Settings → Pages → Source: *Deploy from a branch*, `gh-pages`, `/`).

### Die Domain

Wo die Seite liegt, ist eine einzige Repository-Variable, **`SITE_URL`**:

| `SITE_URL` | Seite |
| --- | --- |
| nicht gesetzt | `https://verdin-cms.github.io/verdin/` |
| `https://docs.example.com` | Die Wurzel dieser Domain |
| `https://example.com/verdin` | Unter `/verdin` auf dieser Domain |

`site/scripts/repo.mjs` entnimmt ihr `site` und `base` von Astro, sodass jeder Link, jedes Asset
und die Sitemap folgen. `BASE_PATH` überschreibt den Pfad weiterhin, wenn gesetzt. Für eine
eigene Domain:

1. Richte das DNS der Domain auf GitHub Pages (ein `CNAME`-Eintrag auf `verdin-cms.github.io`
   für eine Subdomain).
2. Setze `SITE_URL` unter Settings → Secrets and variables → Actions → Variables.
3. Führe den Site-Workflow aus (oder pushe auf `main`). Er schreibt die Datei `CNAME` in den
   Branch, und GitHub übernimmt die Domain; aktiviere *Enforce HTTPS*, sobald das Zertifikat
   ausgestellt ist.

Links außerhalb der Seite (die README, Paketmetadaten, das `home` des Helm-Charts) behalten die
Adresse `verdin-cms.github.io/verdin`, die GitHub auf die eigene Domain umleitet.

### Pull-Request-Vorschauen

Jeder Pull Request, der die Seite berührt, bekommt eine Vorschau unter
`<SITE_URL>/pr-preview/pr-<number>/`, in einem Kommentar verlinkt:

1. `site-preview.yml` läuft bei `pull_request`. Er baut die Seite mit `SITE_URL` auf der Adresse
   der Vorschau und lädt sie als Artefakt hoch. Er führt den Code des Pull Requests aus, hat
   also, wie jeder `pull_request`-Workflow aus einem Fork, ein schreibgeschütztes Token und
   keine Secrets.
2. `site-preview-deploy.yml` läuft bei `workflow_run`, wenn dieser Build erfolgreich ist, im
   Kontext dieses Repositorys. Er lädt das Artefakt herunter, prüft, dass der Pull Request offen
   ist und dass der Build für seinen aktuellen Head war, kopiert die Dateien nach
   `pr-preview/pr-<number>/` auf `gh-pages` und aktualisiert den Kommentar. Er checkt nie Code
   eines Pull Requests aus und führt ihn nie aus.
3. Wenn der Pull Request schließt, löscht derselbe Workflow (`pull_request_target`, der nur
   `gh-pages` klont) den Ordner.

Das Haupt-Deploy behält `pr-preview/`, und alle drei teilen sich eine Concurrency-Gruppe, sodass
immer nur ein Job `gh-pages` beschreibt.

Vorschauen werden vom selben Origin wie die Dokumentation ausgeliefert. Das ist für eine
statische Seite ohne Anmeldung akzeptabel, aber der Pull Request eines Forks kann dort bis zu
seinem Schließen beliebiges HTML veröffentlichen; schließe Pull Requests, die das missbrauchen.
Sind Repository-Variablen für den Workflow eines Forks nicht verfügbar, wird seine Vorschau für
die Standard-`SITE_URL` gebaut und ihre Links brechen unter einer eigenen Domain; Vorschauen von
Pull Requests aus Branches dieses Repositorys sind nicht betroffen.

### Das gehostete Playground

Die öffentliche Demo betreibt den Container aus `deploy/playground/`; siehe
[Gehostetes Playground](/de/deploy/playground/). Das Hosten liegt außerhalb des Repositorys:
jede Plattform, die einen Container hinter HTTPS am Laufen hält.
