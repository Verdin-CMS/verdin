---
title: Versions i allotjament de la documentació
description: Què publica el flux de treball de versions (binaris, sumes de verificació, paquets .deb, la imatge, Homebrew, winget), els secrets que necessita cada tasca opcional, i com s'allotgen el lloc de la documentació, el seu domini i les previsualitzacions de pull requests.
sidebar:
  order: 9
---

Aquesta pàgina és per als mantenidors: què passa quan s'envia una etiqueta de versió, quines parts
necessiten un secret o un compte, i com es publica el lloc de la documentació.

## El flux de treball de versions

Enviar una etiqueta `vX.Y.Z` executa `.github/workflows/release.yml`:

| Tasca | Publica | Necessita |
| --- | --- | --- |
| `admin`, `binaries` | `verdin-vX.Y.Z-<target>.tar.gz` (`.zip` a Windows) per a `x86_64`/`aarch64-unknown-linux-musl`, `x86_64`/`aarch64-apple-darwin` i `x86_64-pc-windows-msvc`. Cada arxiu té una carpeta amb `verdin` i les llicències. | Res |
| `deb` | `verdin_X.Y.Z-1_amd64.deb` i `_arm64.deb`, construïts amb `cargo deb --no-build` a partir dels binaris musl. | Res |
| `publish` | La versió de GitHub: arxius, paquets i `SHA256SUMS`, amb les notes de la secció de la versió del `CHANGELOG.md`. | Res |
| `image` | `ghcr.io/verdin-cms/verdin` per a amd64 i arm64. | Res |
| `npm` | `@verdin/client`. | `NPM_TOKEN` (s'omet sense) |
| `homebrew` | `Formula/verdin.rb` al tap, a partir de `deploy/homebrew/verdin.rb.in`. | `HOMEBREW_TAP_TOKEN` (s'omet sense) |
| `winget` | Una pull request a `microsoft/winget-pkgs` amb els manifests de `deploy/winget/`. | `WINGET_TOKEN` (s'omet sense) |

Els noms dels recursos són un contracte: `install.sh`, les metadades de `cargo binstall` a
`crates/verdin/Cargo.toml`, la fórmula de Homebrew i els manifests de winget els construeixen
tots a partir de la versió i la destinació. `deploy/render-template.sh` omple les plantilles de
Homebrew i winget amb la versió i les sumes de verificació de `SHA256SUMS`, i falla si en falta
alguna.

## Configuració única per a les tasques opcionals

| Què | On |
| --- | --- |
| **Tap de Homebrew.** Crea el repositori públic `verdin-cms/homebrew-tap` (el nom fa que funcioni `brew install verdin-cms/tap/verdin`). Afegeix-hi un token de gra fi amb *Contents: read and write* com a secret `HOMEBREW_TAP_TOKEN`. Un altre repositori: defineix la variable `HOMEBREW_TAP_REPOSITORY`. | Secrets i variables del repositori |
| **winget.** El primer enviament de `VerdinCMS.Verdin` el revisen els mantenidors de winget. Fes un fork de `microsoft/winget-pkgs` amb el compte que l'envia, i afegeix un token clàssic d'aquest compte amb l'àmbit `public_repo` com a `WINGET_TOKEN`. | Secrets del repositori |
| **npm.** `NPM_TOKEN`, un token d'automatització de l'àmbit `@verdin`. | Secrets del repositori |
| **crates.io** (opcional). `cargo binstall verdin` sense `--git` necessita el crate a crates.io; fins aleshores la documentació fa servir `--git`. | — |
| **Botó de Railway** (opcional). Crea una plantilla a railway.com a partir del repositori (camí de configuració `deploy/one-click/railway.json`, un servei PostgreSQL, un volum a `/data`) i afegeix-ne el botó al README i a [Desplegaments amb un clic](/ca/deploy/one-click/). | railway.com |

Els botons de Render i DigitalOcean no necessiten cap compte de la banda del projecte: llegeixen
`render.yaml` i `.do/deploy.template.yaml` de la branca per defecte.

Algunes versions s'escriuen en fitxers i canvien amb cada versió menor: l'etiqueta de la imatge a
`deploy/one-click/Dockerfile`, `deploy/playground/Dockerfile`, `deploy/compose/` i la
documentació, i `version`/`appVersion` a `deploy/helm/verdin/Chart.yaml`.

## El lloc de la documentació

`.github/workflows/site.yml` construeix `site/` a cada push a `main` que el toqui i envia el
resultat a l'arrel de la branca `gh-pages`. GitHub Pages serveix aquesta branca
(Settings → Pages → Source: *Deploy from a branch*, `gh-pages`, `/`).

### El domini

On viu el lloc és una variable del repositori, **`SITE_URL`**:

| `SITE_URL` | Lloc |
| --- | --- |
| sense definir | `https://verdin-cms.github.io/verdin/` |
| `https://docs.example.com` | L'arrel d'aquest domini |
| `https://example.com/verdin` | Sota `/verdin` en aquest domini |

`site/scripts/repo.mjs` en pren el `site` i el `base` d'Astro, de manera que cada enllaç, recurs i
el mapa del lloc el segueixen. `BASE_PATH` encara substitueix el camí si està definit. Per a un
domini personalitzat:

1. Apunta el DNS del domini a GitHub Pages (un registre `CNAME` cap a `verdin-cms.github.io`
   per a un subdomini).
2. Defineix `SITE_URL` a Settings → Secrets and variables → Actions → Variables.
3. Executa el flux de treball Site (o fes push a `main`). Escriu el fitxer `CNAME` a la
   branca, i GitHub recull el domini; activa *Enforce HTTPS* quan s'hagi emès el certificat.

Els enllaços fora del lloc (el README, les metadades dels paquets, el `home` del gràfic de Helm)
conserven l'adreça `verdin-cms.github.io/verdin`, que GitHub redirigeix al domini personalitzat.

### Previsualitzacions de pull requests

Cada pull request que toca el lloc obté una previsualització a
`<SITE_URL>/pr-preview/pr-<number>/`, enllaçada en un comentari:

1. `site-preview.yml` s'executa amb `pull_request`. Construeix el lloc amb `SITE_URL` definit a
   l'adreça de la previsualització i el puja com a artefacte. Executa el codi de la pull
   request, de manera que, com tot flux de treball `pull_request` d'un fork, té un token de només
   lectura i cap secret.
2. `site-preview-deploy.yml` s'executa amb `workflow_run` quan aquesta construcció té èxit, en
   el context d'aquest repositori. Baixa l'artefacte, comprova que la pull request està oberta i
   que la construcció era del seu cap actual, copia els fitxers a `pr-preview/pr-<number>/` de
   `gh-pages` i actualitza el comentari. Mai no fa checkout ni executa codi de pull requests.
3. Quan la pull request es tanca, el mateix flux de treball (`pull_request_target`, que només
   clona `gh-pages`) elimina la carpeta.

El desplegament principal conserva `pr-preview/`, i els tres comparteixen un sol grup de
concurrència, de manera que només una tasca escriu a `gh-pages` alhora.

Les previsualitzacions se serveixen del mateix origen que la documentació. Això és acceptable per
a un lloc estàtic sense inici de sessió, però la pull request d'un fork pot publicar-hi qualsevol
HTML fins que es tanqui; tanca les pull requests que n'abusin. Si les variables del repositori no
estan disponibles per al flux de treball d'un fork, la seva previsualització es construeix per al
`SITE_URL` per defecte i els seus enllaços es trenquen amb un domini personalitzat; les
previsualitzacions de pull requests de branques d'aquest repositori no es veuen afectades.

### El playground allotjat

La demo pública executa el contenidor de `deploy/playground/`; consulta
[Playground allotjat](/ca/deploy/playground/). Allotjar-lo queda fora del repositori: serveix
qualsevol plataforma que mantingui un contenidor en marxa darrere d'HTTPS.
