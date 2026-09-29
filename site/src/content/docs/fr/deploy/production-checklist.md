---
title: Check-list de production
description: Ce qu’il faut configurer avant qu’un projet Verdin reçoive du vrai trafic — secrets, base de données, migrations, URL, proxys, cookies, CORS, stockage des médias, e-mail, sauvegardes et supervision.
sidebar:
  order: 1
---

Parcourez cette liste avant de mettre un projet Verdin devant de vrais utilisateurs. Chaque
élément renvoie à la page qui l’explique. Les pages des plateformes ([Docker](/fr/deploy/docker/),
[Fly.io](/fr/deploy/fly/), [Render](/fr/deploy/render/), [Railway](/fr/deploy/railway/),
[Kubernetes](/fr/deploy/kubernetes/)) appliquent ces paramètres pour vous quand elles le peuvent.

## Exécuter le serveur de production

- [ ] **Utilisez `verdin start`, pas `verdin dev`.** `dev` laisse le constructeur de types de
      contenu réécrire les fichiers de schéma, applique les migrations à chaque modification
      et assouplit les règles des cookies et des webhooks pour le travail en local. Modifiez
      le schéma en développement, commitez les fichiers et déployez-les.
- [ ] **Appliquez les migrations au déploiement.** `verdin start` refuse de s’exécuter tant
      que la base de données est en retard sur le schéma. `verdin start --migrate` applique
      d’abord les étapes *sans risque* en attente (c’est la commande par défaut de l’image
      Docker). Les étapes risquées ou destructives (changements de type, nouvelles
      contraintes d’unicité, colonnes supprimées) nécessitent
      `verdin migrate apply --allow risky|destructive`, que vous exécutez une fois. Voir
      [Migrations de schéma](/fr/concepts/schema-migrations/).
- [ ] **Livrez le schéma avec le serveur.** Montez le répertoire `schema/` en lecture seule,
      ou intégrez-le à votre image, pour que ce qui s’exécute soit ce que vous avez commité.

## Secrets

- [ ] **Générez une fois les deux secrets requis** avec `verdin secrets` et conservez-les dans
      le gestionnaire de secrets de votre plateforme : `VERDIN_ADMIN_JWT_SECRET` signe les
      jetons de session, et `VERDIN_TOKEN_PEPPER` sert de clé aux hachages des jetons d’API et
      des autres secrets stockés. `verdin start` échoue si l’un d’eux manque ou fait moins de
      32 octets. Les secrets sont lus uniquement depuis l’environnement, jamais depuis
      `verdin.toml`.
- [ ] **Gardez-les stables.** Changer `VERDIN_TOKEN_PEPPER` rend inutilisables tous les jetons
      d’API, ainsi que les codes d’application d’authentification et les codes de récupération
      des administrateurs. Changer `VERDIN_ADMIN_JWT_SECRET` invalide les jetons d’accès de
      courte durée des administrateurs et des utilisateurs finaux, les liens d’aperçu ouverts
      et les connexions OAuth en cours (le panneau d’administration et les clients dotés de
      jetons de rafraîchissement les renouvellent d’eux-mêmes). Toutes les instances d’un
      projet ont besoin des mêmes valeurs.
- [ ] Placez aussi dans l’environnement les autres secrets que vous utilisez :
      `VERDIN_EMAIL_SMTP_PASSWORD` ou `VERDIN_EMAIL_API_KEY`, `AWS_ACCESS_KEY_ID` /
      `AWS_SECRET_ACCESS_KEY`, `VERDIN_METRICS_TOKEN`, `VERDIN_SSO_<ID>_SECRET`,
      `VERDIN_IMAGE_SECRET`. La liste complète figure dans la
      [référence de configuration](/fr/reference/configuration/).

## Base de données

- [ ] **Choisissez le moteur.** PostgreSQL (14 ou ultérieur) est le choix habituel et celui à
      retenir si vous exécuterez [plusieurs instances](/fr/deploy/scaling/). MySQL 8.4+ et
      MariaDB 10.11+ fonctionnent de la même façon. SQLite convient à une instance unique avec
      un disque persistant.
- [ ] **Définissez `VERDIN_DATABASE_URL`** : `postgres://…`, `mysql://…` (MySQL et MariaDB) ou
      `sqlite:///data/verdin.db`. Ajoutez `?sslmode=require` pour les serveurs PostgreSQL qui
      exigent TLS.
- [ ] **Dimensionnez le pool.** Chaque instance ouvre jusqu’à `[database].pool_max`
      connexions (10). Gardez `instances × pool_max` sous la limite de connexions du serveur.

## URL, proxys et cookies

- [ ] **Servez en HTTPS.** Verdin parle HTTP en clair ; terminez le TLS sur un reverse proxy,
      un répartiteur de charge ou l’edge de votre plateforme.
- [ ] **Définissez `[server].public_url`** (`VERDIN_SERVER__PUBLIC_URL`) sur l’adresse
      qu’utilisent les navigateurs, par exemple `https://cms.example.com`. Les liens des
      e-mails, les callbacks SSO, le résumé quotidien et les passkeys en dépendent ; les
      passkeys sont liées à son hôte.
- [ ] **Définissez `[server].trusted_proxies`** sur les adresses de vos reverse proxies (IP ou
      plages CIDR). C’est seulement alors que Verdin lit l’adresse du client dans
      `X-Forwarded-For` ; sans cela, tous les clients derrière le proxy partagent une même
      adresse pour les limites de débit et les journaux d’audit.
- [ ] **Gardez les cookies sécurisés activés.** Sous `verdin start`, le cookie de
      rafraîchissement de l’administration est `Secure` par défaut. Laissez
      `[admin].secure_cookies` non défini ; le mettre à `false` en production journalise un
      avertissement au démarrage.

## API

- [ ] **N’accordez que ce dont le public a besoin.** L’API de contenu est fermée tant que vous
      n’accordez pas d’autorisations publiques (**Paramètres → Accès public**) ou ne créez pas
      de jetons d’API. Voir [Autorisations](/fr/concepts/permissions/).
- [ ] **Définissez `[api].cors_origins`** si un navigateur sur une autre origine appelle l’API
      de contenu ou GraphQL, par exemple `["https://www.example.com"]`. Sans cela, seules les
      pages de même origine peuvent les appeler depuis un navigateur. L’API d’administration ne
      répond jamais aux requêtes cross-origin.
- [ ] **Envisagez des limites de débit** pour le trafic anonyme : `[api].public_rate_limit` et
      `[api].token_rate_limit` (requêtes par minute ; `0`, la valeur par défaut, signifie
      illimité).

## Médias

- [ ] **Stockez les téléversements là où ils survivent à un redéploiement.** Le fournisseur
      local par défaut écrit sur le disque : donnez-lui un volume persistant, ou utilisez le
      fournisseur S3 (AWS S3, Cloudflare R2, Backblaze B2, MinIO, Tigris…). Sur les
      plateformes à disques éphémères, et avec plusieurs instances, utilisez S3. Voir
      [Médias](/fr/concepts/media/).

## E-mail

- [ ] **Configurez un vrai fournisseur.** La valeur par défaut `[email].provider = "log"`
      écrit les e-mails dans le log, et `verdin start` le signale. Les invitations, les
      réinitialisations de mot de passe, les confirmations d’utilisateurs finaux, les mentions
      dans les commentaires et le résumé nécessitent `smtp`, `resend` ou `postmark`, et un
      `[email].from` défini sur une adresse que votre fournisseur accepte.

## Sauvegardes et supervision

- [ ] **Sauvegardez la base de données et le stockage des médias** selon un calendrier, et
      testez une restauration. Voir [Sauvegardes](/fr/deploy/backups/).
- [ ] **Pointez les health checks vers `/_ready`** et les vérifications de liveness vers
      `/_health`.
- [ ] **Journalisez en JSON** (`[log].format = "json"`, la valeur par défaut de l’image
      Docker) et collectez la sortie d’erreur standard.
- [ ] **Collectez `/_metrics`** si vous utilisez Prometheus, avec un `VERDIN_METRICS_TOKEN`.
      Voir [Supervision](/fr/deploy/monitoring/).

## Avant la mise en ligne

- [ ] Créez vous-même le premier administrateur juste après le premier démarrage : tant
      qu’aucun administrateur n’existe, quiconque atteint `/admin/` peut s’inscrire comme
      Super Admin. Vous pouvez aussi le créer en ligne de commande avec
      `verdin admin create --email …`.
- [ ] Passez en revue le [modèle de sécurité](/fr/deploy/security/) et activez
      l’[authentification à deux facteurs](/fr/guides/auth/two-factor/) pour les Super Admins.
