---
title: Docker Compose en production
description: Une recette Compose de production pour un serveur — Verdin, PostgreSQL et Caddy avec HTTPS automatique, et RustFS en option pour des médias compatibles S3.
sidebar:
  order: 3
---

[`deploy/compose/`](https://github.com/verdin-cms/verdin/tree/main/deploy/compose) est une
configuration prête à l’emploi pour un serveur : Verdin et PostgreSQL sur un réseau privé, et
Caddy devant, avec un certificat qu’il obtient et renouvelle lui-même. Un fichier d’override
ajoute RustFS, un stockage compatible S3 sur le même hôte, pour les médias.
[Docker](/fr/deploy/docker/) explique l’image utilisée par ces fichiers.

Les fichiers ont été vérifiés avec `docker compose config` et `caddy validate` le 2026-09-30.

## Fichiers

| Fichier | Quoi |
| --- | --- |
| `compose.yaml` | `verdin`, `db` (PostgreSQL 17) et `caddy`. Seul Caddy publie des ports (80, 443 et 443/udp pour HTTP/3). |
| `compose.s3.yaml` | Ajoute `rustfs` et un job ponctuel qui crée le bucket `media` en lecture publique, et bascule le fournisseur de téléversement de Verdin dessus. |
| `Caddyfile` | TLS pour `$VERDIN_DOMAIN`, compression, `/media/*` vers RustFS et tout le reste vers Verdin. |
| `.env.example` | Les variables lues par Compose : domaine, e-mail ACME, tag de l’image, mots de passe. |

## Mise en place

Prérequis : un serveur avec Docker, un enregistrement DNS de votre domaine qui pointe vers lui,
et les ports 80 et 443 ouverts.

1. Copiez le répertoire sur le serveur et renseignez `.env` :

   ```sh frame="terminal"
   cp .env.example .env                                  # VERDIN_DOMAIN, ACME_EMAIL
   echo "DB_PASSWORD=$(openssl rand -hex 24)" >> .env
   docker run --rm ghcr.io/verdin-cms/verdin:0.11 secrets > verdin.env
   ```

2. Placez votre schéma commité dans `schema/` (`content-types/` et `components/`). Il est monté
   en lecture seule sur `/app/schema`.
3. Démarrez :

   ```sh frame="terminal"
   docker compose up -d
   docker compose logs -f verdin
   ```

4. Ouvrez `https://<your domain>/admin/` et enregistrez le premier administrateur.

Gardez `.env` et `verdin.env` hors du contrôle de version, et sauvegardez-les : un nouveau
`VERDIN_TOKEN_PEPPER` invalide tous les jetons d’API.

## Médias sur S3

Par défaut, les téléversements vont dans le volume `verdin-data`. Pour les stocker plutôt dans
RustFS :

```sh frame="terminal"
echo "S3_SECRET_KEY=$(openssl rand -hex 24)" >> .env
docker compose -f compose.yaml -f compose.s3.yaml up -d
```

Les fichiers sont alors servis par Caddy sur `https://<your domain>/media/<key>`. Pour AWS S3,
Cloudflare R2 ou un autre fournisseur, omettez les services RustFS et définissez les variables
`VERDIN_UPLOAD__PROVIDER__*` et les identifiants `AWS_*` aux valeurs de ce fournisseur (voir
[Stockage](/fr/internals/storage/)). Changer un site existant ne déplace aucun fichier : les
nouveaux téléversements vont chez le nouveau fournisseur.

## Notes

- **Adresses des clients.** Verdin fait confiance à `X-Forwarded-For` depuis le réseau Compose
  (`172.30.0.0/24`, fixé dans `compose.yaml`), où Caddy est le seul proxy. Changez les deux si
  cette plage entre en collision avec l’un de vos réseaux.
- **Temps réel.** Caddy diffuse les réponses `text/event-stream` sans mise en mémoire tampon :
  les [événements temps réel](/fr/guides/frontend/realtime/) fonctionnent donc derrière lui sans
  changement.
- **Mises à niveau.** Changez `VERDIN_VERSION` dans `.env`, puis
  `docker compose pull && docker compose up -d`. Lisez d’abord
  [Mettre à niveau Verdin](/fr/migrate/upgrading/).
- **Sauvegardes.** Exportez PostgreSQL et gardez le volume `verdin-data` (ou le bucket) ; voir
  [Sauvegardes](/fr/deploy/backups/).
- **Commandes d’administration.** L’image n’a pas de shell :
  `docker compose exec verdin verdin admin create --email you@example.com`.
