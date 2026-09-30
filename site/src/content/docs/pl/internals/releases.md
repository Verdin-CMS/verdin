---
title: Wydania i hosting dokumentacji
description: Co publikuje workflow wydania (binarki, sumy kontrolne, pakiety .deb, obraz, Homebrew, winget), jakich sekretów potrzebuje każde opcjonalne zadanie oraz jak hostowana jest witryna dokumentacji, jej domena i podglądy pull requestów.
sidebar:
  order: 9
---

Ta strona jest dla opiekunów projektu: co dzieje się po wypchnięciu tagu wersji, które
części potrzebują sekretu lub konta i jak publikowana jest witryna dokumentacji.

## Workflow wydania

Wypchnięcie tagu `vX.Y.Z` uruchamia `.github/workflows/release.yml`:

| Zadanie | Publikuje | Potrzebuje |
| --- | --- | --- |
| `admin`, `binaries` | `verdin-vX.Y.Z-<target>.tar.gz` (`.zip` w Windows) dla `x86_64`/`aarch64-unknown-linux-musl`, `x86_64`/`aarch64-apple-darwin` i `x86_64-pc-windows-msvc`. Każde archiwum ma jeden folder z `verdin` i licencjami. | Niczego |
| `deb` | `verdin_X.Y.Z-1_amd64.deb` i `_arm64.deb`, zbudowane przez `cargo deb --no-build` z binarek musl. | Niczego |
| `publish` | Wydanie GitHub: archiwa, pakiety i `SHA256SUMS`, z notatkami z sekcji `CHANGELOG.md` danej wersji. | Niczego |
| `image` | `ghcr.io/verdin-cms/verdin` dla amd64 i arm64. | Niczego |
| `npm` | `@verdin/client`. | `NPM_TOKEN` (pomijane bez niego) |
| `homebrew` | `Formula/verdin.rb` w tapie, z `deploy/homebrew/verdin.rb.in`. | `HOMEBREW_TAP_TOKEN` (pomijane bez niego) |
| `winget` | Pull request do `microsoft/winget-pkgs` z manifestami z `deploy/winget/`. | `WINGET_TOKEN` (pomijane bez niego) |

Nazwy zasobów to kontrakt: `install.sh`, metadane `cargo binstall` w
`crates/verdin/Cargo.toml`, formuła Homebrew i manifesty winget budują je z wersji i celu.
`deploy/render-template.sh` uzupełnia szablony Homebrew i winget wersją i sumami kontrolnymi
z `SHA256SUMS` i kończy się błędem, jeśli którejś brakuje.

## Jednorazowa konfiguracja zadań opcjonalnych

| Co | Gdzie |
| --- | --- |
| **Tap Homebrew.** Utwórz publiczne repozytorium `verdin-cms/homebrew-tap` (ta nazwa sprawia, że działa `brew install verdin-cms/tap/verdin`). Dodaj do niego token o szczegółowych uprawnieniach z *Contents: read and write* jako sekret `HOMEBREW_TAP_TOKEN`. Inne repozytorium: ustaw zmienną `HOMEBREW_TAP_REPOSITORY`. | Sekrety i zmienne repozytorium |
| **winget.** Pierwsze zgłoszenie `VerdinCMS.Verdin` jest recenzowane przez opiekunów winget. Zrób fork `microsoft/winget-pkgs` z konta, które zgłasza, i dodaj klasyczny token tego konta z zakresem `public_repo` jako `WINGET_TOKEN`. | Sekrety repozytorium |
| **npm.** `NPM_TOKEN`, token automatyzacji zakresu `@verdin`. | Sekrety repozytorium |
| **crates.io** (opcjonalnie). `cargo binstall verdin` bez `--git` wymaga crate'a na crates.io; do tego czasu dokumentacja używa `--git`. | — |
| **Przycisk Railway** (opcjonalnie). Utwórz szablon na railway.com z repozytorium (ścieżka konfiguracji `deploy/one-click/railway.json`, usługa PostgreSQL, wolumen w `/data`) i dodaj jego przycisk do README oraz do [Wdrożeń jednym kliknięciem](/pl/deploy/one-click/). | railway.com |

Przyciski Render i DigitalOcean nie wymagają konta po stronie projektu: czytają `render.yaml`
i `.do/deploy.template.yaml` z domyślnej gałęzi.

Niektóre wersje są zapisane w plikach i zmieniają się z każdym wydaniem minor: tag obrazu
w `deploy/one-click/Dockerfile`, `deploy/playground/Dockerfile`, `deploy/compose/`
i dokumentacji oraz `version`/`appVersion` w `deploy/helm/verdin/Chart.yaml`.

## Witryna dokumentacji

`.github/workflows/site.yml` buduje `site/` przy każdym pushu do `main`, który jej dotyczy,
i wypycha wynik do katalogu głównego gałęzi `gh-pages`. GitHub Pages serwuje tę gałąź
(Settings → Pages → Source: *Deploy from a branch*, `gh-pages`, `/`).

### Domena

Miejsce, w którym działa witryna, to jedna zmienna repozytorium, **`SITE_URL`**:

| `SITE_URL` | Witryna |
| --- | --- |
| nieustawiona | `https://verdin-cms.github.io/verdin/` |
| `https://docs.example.com` | Katalog główny tej domeny |
| `https://example.com/verdin` | Pod `/verdin` w tej domenie |

`site/scripts/repo.mjs` bierze z niej `site` i `base` Astro, więc podążają za nią każdy
link, zasób i mapa witryny. `BASE_PATH` nadal nadpisuje ścieżkę, jeśli jest ustawione. Dla
własnej domeny:

1. Skieruj DNS domeny na GitHub Pages (rekord `CNAME` do `verdin-cms.github.io` dla
   subdomeny).
2. Ustaw `SITE_URL` w Settings → Secrets and variables → Actions → Variables.
3. Uruchom workflow Site (albo wypchnij do `main`). Zapisuje on plik `CNAME` w gałęzi,
   a GitHub przejmuje domenę; włącz *Enforce HTTPS*, gdy certyfikat zostanie wystawiony.

Linki spoza witryny (README, metadane pakietów, `home` chartu Helm) zachowują adres
`verdin-cms.github.io/verdin`, który GitHub przekierowuje na własną domenę.

### Podglądy pull requestów

Każdy pull request, który dotyczy witryny, dostaje podgląd pod
`<SITE_URL>/pr-preview/pr-<number>/`, z linkiem w komentarzu:

1. `site-preview.yml` działa przy `pull_request`. Buduje witrynę z `SITE_URL` ustawionym na
   adres podglądu i przesyła ją jako artefakt. Uruchamia kod pull requesta, więc, jak każdy
   workflow `pull_request` z forka, ma token tylko do odczytu i żadnych sekretów.
2. `site-preview-deploy.yml` działa przy `workflow_run`, gdy ten build się powiedzie,
   w kontekście tego repozytorium. Pobiera artefakt, sprawdza, że pull request jest otwarty
   i że build dotyczył jego bieżącego head, kopiuje pliki do `pr-preview/pr-<number>/`
   w `gh-pages` i aktualizuje komentarz. Nigdy nie pobiera ani nie uruchamia kodu pull
   requesta.
3. Gdy pull request się zamyka, ten sam workflow (`pull_request_target`, który tylko klonuje
   `gh-pages`) usuwa folder.

Główne wdrożenie zachowuje `pr-preview/`, a wszystkie trzy dzielą jedną grupę współbieżności,
więc naraz zapisuje do `gh-pages` tylko jedno zadanie.

Podglądy są serwowane z tego samego origin co dokumentacja. Jest to akceptowalne dla
statycznej witryny bez logowania, ale pull request z forka może tam opublikować dowolny HTML,
dopóki nie zostanie zamknięty; zamykaj pull requesty, które to nadużywają. Jeśli zmienne
repozytorium nie są dostępne dla workflow z forka, jego podgląd jest budowany dla domyślnego
`SITE_URL`, a jego linki nie działają przy własnej domenie; podglądy pull requestów z gałęzi
tego repozytorium nie są tym dotknięte.

### Hostowany playground

Publiczne demo uruchamia kontener z `deploy/playground/`; zobacz
[Hostowany playground](/pl/deploy/playground/). Hostowanie jest poza repozytorium: dowolna
platforma, która utrzymuje jeden kontener uruchomiony za HTTPS.
