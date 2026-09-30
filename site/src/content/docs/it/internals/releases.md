---
title: Release e hosting della documentazione
description: Cosa pubblica il workflow di release (binari, checksum, pacchetti .deb, l'immagine, Homebrew, winget), i segreti che ogni job opzionale richiede, e come sono ospitati il sito della documentazione, il suo dominio e le anteprime delle pull request.
sidebar:
  order: 9
---

Questa pagina è per i maintainer: cosa succede quando viene pushato un tag di versione, quali
parti richiedono un segreto o un account, e come viene pubblicato il sito della documentazione.

## Il workflow di release

Pushare un tag `vX.Y.Z` esegue `.github/workflows/release.yml`:

| Job | Pubblica | Richiede |
| --- | --- | --- |
| `admin`, `binaries` | `verdin-vX.Y.Z-<target>.tar.gz` (`.zip` su Windows) per `x86_64`/`aarch64-unknown-linux-musl`, `x86_64`/`aarch64-apple-darwin` e `x86_64-pc-windows-msvc`. Ogni archivio ha una cartella con `verdin` e le licenze. | Nulla |
| `deb` | `verdin_X.Y.Z-1_amd64.deb` e `_arm64.deb`, costruiti con `cargo deb --no-build` dai binari musl. | Nulla |
| `publish` | La release di GitHub: archivi, pacchetti e `SHA256SUMS`, con le note della sezione della versione in `CHANGELOG.md`. | Nulla |
| `image` | `ghcr.io/verdin-cms/verdin` per amd64 e arm64. | Nulla |
| `npm` | `@verdin/client`. | `NPM_TOKEN` (saltato senza) |
| `homebrew` | `Formula/verdin.rb` nel tap, da `deploy/homebrew/verdin.rb.in`. | `HOMEBREW_TAP_TOKEN` (saltato senza) |
| `winget` | Una pull request a `microsoft/winget-pkgs` con i manifest di `deploy/winget/`. | `WINGET_TOKEN` (saltato senza) |

I nomi degli asset sono un contratto: `install.sh`, i metadati `cargo binstall` in
`crates/verdin/Cargo.toml`, la formula Homebrew e i manifest winget li costruiscono tutti
dalla versione e dal target. `deploy/render-template.sh` compila i template di Homebrew e
winget con la versione e i checksum di `SHA256SUMS`, e fallisce se ne manca uno.

## Configurazione una tantum dei job opzionali

| Cosa | Dove |
| --- | --- |
| **Tap Homebrew.** Crea il repository pubblico `verdin-cms/homebrew-tap` (il nome fa funzionare `brew install verdin-cms/tap/verdin`). Aggiungi un token fine-grained con *Contents: read and write* su di esso come segreto `HOMEBREW_TAP_TOKEN`. Altro repository: imposta la variabile `HOMEBREW_TAP_REPOSITORY`. | Repository secrets and variables |
| **winget.** Il primo invio di `VerdinCMS.Verdin` è rivisto dai maintainer di winget. Fai un fork di `microsoft/winget-pkgs` con l'account che invia, e aggiungi un token classic di quell'account con lo scope `public_repo` come `WINGET_TOKEN`. | Repository secrets |
| **npm.** `NPM_TOKEN`, un token di automazione dello scope `@verdin`. | Repository secrets |
| **crates.io** (opzionale). `cargo binstall verdin` senza `--git` richiede il crate su crates.io; fino ad allora la documentazione usa `--git`. | — |
| **Pulsante Railway** (opzionale). Crea un template su railway.com dal repository (path di configurazione `deploy/one-click/railway.json`, un servizio PostgreSQL, un volume su `/data`) e aggiungi il suo pulsante al README e a [Deploy con un clic](/it/deploy/one-click/). | railway.com |

I pulsanti di Render e DigitalOcean non richiedono un account da parte del progetto: leggono
`render.yaml` e `.do/deploy.template.yaml` dal branch di default.

Alcune versioni sono scritte nei file e si spostano a ogni release minore: il tag
dell'immagine in `deploy/one-click/Dockerfile`, `deploy/playground/Dockerfile`,
`deploy/compose/` e nella documentazione, e `version`/`appVersion` in
`deploy/helm/verdin/Chart.yaml`.

## Il sito della documentazione

`.github/workflows/site.yml` costruisce `site/` a ogni push su `main` che lo tocca e pusha il
risultato nella radice del branch `gh-pages`. GitHub Pages serve quel branch
(Settings → Pages → Source: *Deploy from a branch*, `gh-pages`, `/`).

### Il dominio

Dove vive il sito è una variabile del repository, **`SITE_URL`**:

| `SITE_URL` | Sito |
| --- | --- |
| non impostata | `https://verdin-cms.github.io/verdin/` |
| `https://docs.example.com` | La radice di quel dominio |
| `https://example.com/verdin` | Sotto `/verdin` su quel dominio |

`site/scripts/repo.mjs` ricava da essa `site` e `base` di Astro, così ogni link, asset e la
sitemap la seguono. `BASE_PATH` sovrascrive comunque il path se impostato. Per un dominio
personalizzato:

1. Punta il DNS del dominio a GitHub Pages (un record `CNAME` verso `verdin-cms.github.io`
   per un sottodominio).
2. Imposta `SITE_URL` in Settings → Secrets and variables → Actions → Variables.
3. Esegui il workflow Site (o fai push su `main`). Scrive il file `CNAME` nel branch, e GitHub
   rileva il dominio; attiva *Enforce HTTPS* una volta emesso il certificato.

I link fuori dal sito (il README, i metadati dei pacchetti, il `home` del chart Helm)
mantengono l'indirizzo `verdin-cms.github.io/verdin`, che GitHub reindirizza al dominio
personalizzato.

### Anteprime delle pull request

Ogni pull request che tocca il sito ottiene un'anteprima su
`<SITE_URL>/pr-preview/pr-<number>/`, collegata in un commento:

1. `site-preview.yml` gira su `pull_request`. Costruisce il sito con `SITE_URL` impostata
   sull'indirizzo dell'anteprima e lo carica come artifact. Esegue il codice della pull
   request, quindi, come ogni workflow `pull_request` da un fork, ha un token in sola lettura
   e nessun segreto.
2. `site-preview-deploy.yml` gira su `workflow_run` quando quella build riesce, nel contesto
   di questo repository. Scarica l'artifact, verifica che la pull request sia aperta e che la
   build fosse per il suo head attuale, copia i file in `pr-preview/pr-<number>/` su
   `gh-pages` e aggiorna il commento. Non fa mai il checkout né esegue codice di pull request.
3. Quando la pull request si chiude, lo stesso workflow (`pull_request_target`, che clona solo
   `gh-pages`) elimina la cartella.

Il deploy principale mantiene `pr-preview/`, e tutti e tre condividono un unico gruppo di
concorrenza, così un solo job alla volta scrive su `gh-pages`.

Le anteprime sono servite dalla stessa origin della documentazione. È accettabile per un sito
statico senza accesso, ma la pull request di un fork può pubblicare lì qualsiasi HTML finché
non viene chiusa; chiudi le pull request che ne abusano. Se le variabili del repository non
sono disponibili al workflow di un fork, la sua anteprima viene costruita per la `SITE_URL` di
default e i suoi link si rompono con un dominio personalizzato; le anteprime delle pull
request da branch di questo repository non sono interessate.

### Il playground ospitato

La demo pubblica esegue il container di `deploy/playground/`; vedi
[Playground ospitato](/it/deploy/playground/). Ospitarla è fuori dal repository: va bene
qualsiasi piattaforma che mantenga in esecuzione un container dietro HTTPS.
