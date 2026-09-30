---
title: Releases et hébergement de la documentation
description: Ce que publie le workflow de release (binaires, sommes de contrôle, paquets .deb, l’image, Homebrew, winget), les secrets dont chaque job facultatif a besoin, et comment le site de documentation, son domaine et les aperçus de pull requests sont hébergés.
sidebar:
  order: 9
---

Cette page s’adresse aux mainteneurs : ce qui se passe quand un tag de version est poussé, quelles
parties ont besoin d’un secret ou d’un compte, et comment le site de documentation est publié.

## Le workflow de release

Pousser un tag `vX.Y.Z` exécute `.github/workflows/release.yml` :

| Job | Publie | Nécessite |
| --- | --- | --- |
| `admin`, `binaries` | `verdin-vX.Y.Z-<target>.tar.gz` (`.zip` sous Windows) pour `x86_64`/`aarch64-unknown-linux-musl`, `x86_64`/`aarch64-apple-darwin` et `x86_64-pc-windows-msvc`. Chaque archive contient un dossier avec `verdin` et les licences. | Rien |
| `deb` | `verdin_X.Y.Z-1_amd64.deb` et `_arm64.deb`, construits avec `cargo deb --no-build` à partir des binaires musl. | Rien |
| `publish` | La release GitHub : archives, paquets et `SHA256SUMS`, avec les notes de la section de la version dans `CHANGELOG.md`. | Rien |
| `image` | `ghcr.io/verdin-cms/verdin` pour amd64 et arm64. | Rien |
| `npm` | `@verdin/client`. | `NPM_TOKEN` (ignoré sans lui) |
| `homebrew` | `Formula/verdin.rb` dans le tap, à partir de `deploy/homebrew/verdin.rb.in`. | `HOMEBREW_TAP_TOKEN` (ignoré sans lui) |
| `winget` | Une pull request vers `microsoft/winget-pkgs` avec les manifestes de `deploy/winget/`. | `WINGET_TOKEN` (ignoré sans lui) |

Les noms des assets sont un contrat : `install.sh`, les métadonnées `cargo binstall` de
`crates/verdin/Cargo.toml`, la formule Homebrew et les manifestes winget les construisent tous à
partir de la version et de la cible. `deploy/render-template.sh` remplit les modèles Homebrew et
winget avec la version et les sommes de contrôle de `SHA256SUMS`, et échoue si l’une manque.

## Configuration unique pour les jobs facultatifs

| Quoi | Où |
| --- | --- |
| **Tap Homebrew.** Créez le dépôt public `verdin-cms/homebrew-tap` (le nom fait fonctionner `brew install verdin-cms/tap/verdin`). Ajoutez-y un jeton à granularité fine avec *Contents: read and write* comme secret `HOMEBREW_TAP_TOKEN`. Autre dépôt : définissez la variable `HOMEBREW_TAP_REPOSITORY`. | Secrets et variables du dépôt |
| **winget.** La première soumission de `VerdinCMS.Verdin` est examinée par les mainteneurs de winget. Forkez `microsoft/winget-pkgs` avec le compte qui soumet, et ajoutez un jeton classique de ce compte avec le scope `public_repo` comme `WINGET_TOKEN`. | Secrets du dépôt |
| **npm.** `NPM_TOKEN`, un jeton d’automatisation du scope `@verdin`. | Secrets du dépôt |
| **crates.io** (facultatif). `cargo binstall verdin` sans `--git` nécessite que le crate soit sur crates.io ; d’ici là, la documentation utilise `--git`. | — |
| **Bouton Railway** (facultatif). Créez un template sur railway.com à partir du dépôt (chemin de configuration `deploy/one-click/railway.json`, un service PostgreSQL, un volume sur `/data`) et ajoutez son bouton au README et à [Déploiements en un clic](/fr/deploy/one-click/). | railway.com |

Les boutons Render et DigitalOcean n’ont besoin d’aucun compte côté projet : ils lisent
`render.yaml` et `.do/deploy.template.yaml` depuis la branche par défaut.

Certaines versions sont écrites dans des fichiers et bougent à chaque release mineure : le tag de
l’image dans `deploy/one-click/Dockerfile`, `deploy/playground/Dockerfile`, `deploy/compose/` et
la documentation, et `version`/`appVersion` dans `deploy/helm/verdin/Chart.yaml`.

## Le site de documentation

`.github/workflows/site.yml` construit `site/` à chaque push sur `main` qui le touche et pousse le
résultat à la racine de la branche `gh-pages`. GitHub Pages sert cette branche
(Settings → Pages → Source: *Deploy from a branch*, `gh-pages`, `/`).

### Le domaine

L’emplacement du site est une seule variable de dépôt, **`SITE_URL`** :

| `SITE_URL` | Site |
| --- | --- |
| non définie | `https://verdin-cms.github.io/verdin/` |
| `https://docs.example.com` | La racine de ce domaine |
| `https://example.com/verdin` | Sous `/verdin` sur ce domaine |

`site/scripts/repo.mjs` en tire le `site` et le `base` d’Astro : chaque lien, chaque asset et le
sitemap suivent donc. `BASE_PATH` remplace toujours le chemin s’il est défini. Pour un domaine
personnalisé :

1. Faites pointer le DNS du domaine vers GitHub Pages (un enregistrement `CNAME` vers
   `verdin-cms.github.io` pour un sous-domaine).
2. Définissez `SITE_URL` dans Settings → Secrets and variables → Actions → Variables.
3. Exécutez le workflow Site (ou poussez sur `main`). Il écrit le fichier `CNAME` dans la
   branche, et GitHub prend le domaine en compte ; activez *Enforce HTTPS* une fois le certificat
   émis.

Les liens hors du site (le README, les métadonnées des paquets, le `home` du chart Helm)
conservent l’adresse `verdin-cms.github.io/verdin`, que GitHub redirige vers le domaine
personnalisé.

### Aperçus des pull requests

Chaque pull request qui touche le site reçoit un aperçu sur
`<SITE_URL>/pr-preview/pr-<number>/`, lié dans un commentaire :

1. `site-preview.yml` s’exécute sur `pull_request`. Il construit le site avec `SITE_URL` défini à
   l’adresse de l’aperçu et le téléverse comme artefact. Il exécute le code de la pull request :
   comme pour tout workflow `pull_request` venant d’un fork, il a donc un jeton en lecture seule
   et aucun secret.
2. `site-preview-deploy.yml` s’exécute sur `workflow_run` quand ce build réussit, dans le contexte
   de ce dépôt. Il télécharge l’artefact, vérifie que la pull request est ouverte et que le build
   correspondait à son dernier commit, copie les fichiers dans `pr-preview/pr-<number>/` sur
   `gh-pages` et met à jour le commentaire. Il ne récupère ni n’exécute jamais le code de la pull
   request.
3. Quand la pull request se ferme, le même workflow (`pull_request_target`, qui ne clone que
   `gh-pages`) supprime le dossier.

Le déploiement principal conserve `pr-preview/`, et les trois partagent un seul groupe de
concurrence : un seul job écrit donc sur `gh-pages` à la fois.

Les aperçus sont servis depuis la même origine que la documentation. C’est acceptable pour un site
statique sans connexion, mais la pull request d’un fork peut y publier n’importe quel HTML jusqu’à
sa fermeture ; fermez les pull requests qui en abusent. Si les variables du dépôt ne sont pas
disponibles pour le workflow d’un fork, son aperçu est construit pour le `SITE_URL` par défaut et
ses liens cassent sous un domaine personnalisé ; les aperçus des pull requests venant de branches
de ce dépôt ne sont pas concernés.

### Le playground hébergé

La démo publique exécute le conteneur de `deploy/playground/` ; voir
[Playground hébergé](/fr/deploy/playground/). L’héberger se fait hors du dépôt : n’importe quelle
plateforme qui garde un conteneur en marche derrière HTTPS.
