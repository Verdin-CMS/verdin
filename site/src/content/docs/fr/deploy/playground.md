---
title: Playground hébergé
description: Exécutez une démo publique de Verdin — l’exemple de blog sur SQLite avec du contenu de démonstration et un compte de démo, effacé et réamorcé toutes les heures — depuis deploy/playground.
sidebar:
  order: 11
---

[`deploy/playground/`](https://github.com/verdin-cms/verdin/tree/main/deploy/playground)
construit un conteneur pour une démo publique : l’[exemple de blog](https://github.com/verdin-cms/verdin/tree/main/examples/blog)
sur SQLite, avec quelques articles publiés et un compte de démo avec lequel les visiteurs peuvent
se connecter. Toutes les heures, il jette la base de données et repart de zéro. Le conteneur n’a
besoin d’aucun volume, d’aucun serveur de base de données et d’aucun secret de votre part. Où
l’héberger est votre choix ; toute plateforme qui exécute un conteneur avec une adresse HTTPS
publique convient.

Les scripts ont été exécutés sur un build local le 2026-09-30 (trois cycles de réinitialisation) ;
l’image a été construite mais pas exécutée à partir d’une release publiée.

## Ce que les visiteurs obtiennent

- Le panneau d’administration sur `/admin/`, connecté en tant que **demo@example.com** /
  **verdin-demo-1234**. Le compte a le rôle **Editor** : il peut créer, modifier, publier et
  supprimer du contenu et téléverser des médias, mais ne peut pas gérer les utilisateurs, les
  rôles, les jetons d’API, les webhooks ni les paramètres.
- Un accès public en lecture aux articles, catégories, tags et à la page d’accueil via REST
  (`/api/articles?populate=*`) et GraphQL.
- Deux articles publiés, un brouillon, deux catégories, deux tags et la page d’accueil.

Un Super Admin existe aussi, avec un mot de passe aléatoire que personne ne connaît.

## Fonctionnement

`run.sh` boucle :

1. Supprime `/var/lib/verdin-playground` (base de données, téléversements, index de recherche,
   cache d’images) et génère de nouveaux secrets : les sessions du cycle précédent prennent donc
   fin.
2. Démarre `verdin start --migrate` et attend `/_ready`.
3. Exécute `seed.sh` : crée les comptes via la CLI et l’API d’administration, ouvre l’accès public
   en lecture et crée le contenu.
4. Attend `PLAYGROUND_RESET_SECONDS` (3600), arrête le serveur et recommence. Si le serveur
   s’arrête de lui-même, il recommence aussitôt.

La configuration (`deploy/playground/verdin.toml`) limite les téléversements à 2 Mo, limite le
débit des requêtes anonymes à 300 par minute et par adresse, tient les envois de webhooks à
l’écart des adresses privées et active la recherche.

## Le construire et l’exécuter

Depuis la racine du dépôt :

```sh frame="terminal"
docker build -f deploy/playground/Dockerfile -t verdin-playground .
docker run -p 1337:1337 --tmpfs /var/lib/verdin-playground:uid=65532,gid=65532 verdin-playground
```

L’image est une Alpine avec `curl` et `jq` (les scripts ont besoin d’un shell, que l’image
officielle n’a pas) et le binaire statique copié depuis `ghcr.io/verdin-cms/verdin`. Passez
`--build-arg VERDIN_IMAGE=ghcr.io/verdin-cms/verdin:<version>` pour choisir la release. Le
`tmpfs` garde les données en mémoire ; sans lui, les données vivent dans le système de fichiers
du conteneur, ce qui fonctionne aussi.

| Variable | Par défaut | Quoi |
| --- | --- | --- |
| `PLAYGROUND_RESET_SECONDS` | `3600` | Temps entre deux réinitialisations. |
| `PLAYGROUND_EMAIL`, `PLAYGROUND_PASSWORD` | `demo@example.com`, `verdin-demo-1234` | Le compte de démo. |
| `VERDIN_SERVER__PUBLIC_URL` | | L’adresse publique du playground. |
| `VERDIN_SERVER__TRUSTED_PROXIES` | | La plage du proxy de la plateforme, pour que les limites de débit s’appliquent par visiteur. |

## L’héberger

Exécutez exactement une instance (la base de données est locale), gardez-la en marche (pas de
mise à l’échelle à zéro : le minuteur de réinitialisation vit dans le processus) et placez HTTPS
devant : le cookie de session du panneau d’administration est `Secure` en mode `start`, la
connexion nécessite donc HTTPS. N’importe qui peut écrire du contenu et téléverser des images
pendant une heure au plus : indiquez donc le calendrier de réinitialisation sur la page qui y
renvoie, et gardez l’instance sur un domaine distinct de tout ce qui partage des cookies.
