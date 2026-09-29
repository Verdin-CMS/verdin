---
title: Qu’est-ce que Verdin
description: Verdin est un CMS headless open source écrit en Rust, avec des API de contenu compatibles avec Strapi v5 et un panneau d’administration réunis dans un seul binaire.
sidebar:
  order: 1
  label: Introduction
---

Verdin est un CMS headless open source écrit en Rust. Vous modélisez vos types de contenu,
vos rédacteurs écrivent et publient dans un panneau d’administration, et vos sites et
applications lisent le contenu via une API REST ou GraphQL. Verdin ne génère pas les pages :
c’est le rôle de votre frontend.

Il s’agit d’une réécriture de [Strapi v5](https://strapi.io) : le format de schéma et l’API
de contenu ont la même forme, si bien qu’un projet Strapi et son frontend peuvent migrer
avec peu de modifications.

## À qui il s’adresse

- **Aux développeurs qui créent un site ou une application** et veulent un CMS qui tourne
  dans un seul processus, dont le modèle de contenu reste dans git et qui se lit depuis
  n’importe quel frontend : Astro, Next.js, une application mobile.
- **Aux équipes sous Strapi** qui veulent la même API avec une empreinte plus légère, ou qui
  ont besoin de fonctionnalités que Strapi réserve à ses offres payantes. Verdin n’a pas
  d’édition entreprise : SSO, journaux d’audit, workflows de relecture et releases font
  partie du projet open source.
- **Aux rédacteurs**, qui disposent des brouillons, de la publication, de l’historique et
  des aperçus dans un panneau d’administration disponible en 18 langues.

## Ce qui est inclus

Un seul exécutable, `verdin`, fait office de serveur, d’outil en ligne de commande et de
panneau d’administration. Pas de runtime Node.js ni de `node_modules` en production.

| Domaine | Ce que vous obtenez |
| --- | --- |
| Bases de données | PostgreSQL 14+, MySQL 8.4+, MariaDB 10.11+ et SQLite, couvertes par la même suite de tests. |
| Modèle de contenu | Types de collection, types uniques, composants, zones dynamiques, relations, médias, texte enrichi en Markdown ou au format blocks de Strapi. Le schéma se compose de fichiers JSON dans votre projet. |
| Évolutions du schéma | Chaque modification devient un plan de migration, avec un niveau de risque et le SQL exact. Les étapes destructives ne s’exécutent que si vous les autorisez. |
| API | REST sous `/api` avec les paramètres de Strapi v5 (`filters`, `populate`, `sort`, `pagination`), un endpoint GraphQL optionnel, un document OpenAPI et un client TypeScript typé. |
| Édition | Brouillon et publication, contenu localisé, historique du contenu, releases, workflows de relecture, commentaires et tâches, présence en direct, aperçu et édition visuelle sur votre propre site. |
| Accès | Rôles d’administration jusqu’au niveau des champs et des langues, jetons d’API, accès public, SSO avec OpenID Connect, connexion à deux facteurs avec passkeys, journaux d’audit. |
| Fonctionnalités de site | Recherche plein texte, sitemap, redirections, menus et formulaires, webhooks, mises à jour en temps réel. |
| Extensibilité | Plugins WebAssembly qui s’accrochent aux écritures, ajoutent des routes et des tâches, et apportent des widgets d’administration et des champs personnalisés, dans la limite des capacités qu’ils déclarent. |

## Ses liens avec Strapi v5

**Ce qui est identique :**

- Les fichiers de schéma utilisent le format de Strapi : `schema/content-types/<singularName>.json` et
  `schema/components/<category>/<name>.json`.
- L’API de contenu REST : les routes, le format de réponse à plat avec `documentId`, les
  paramètres et opérateurs de requête, la sémantique d’écriture (un `POST` ou un `PUT` publie,
  sauf si vous passez `?status=draft`), les corps d’erreur.
- Le schéma GraphQL reprend la forme de celui du plugin GraphQL de Strapi v5.
- Les utilisateurs finaux (inscription, connexion, OAuth, rôles) suivent l’API
  `users-permissions`.

**Ce qui change :**

- **Les évolutions du schéma sont des migrations planifiées.** Verdin compare les fichiers de
  schéma à la base de données et vous montre les étapes avant de les exécuter.
  `verdin start` refuse de démarrer tant que la base de données est en retard sur le schéma.
- **Le constructeur de types de contenu ne fonctionne qu’en mode développement.** En production,
  le schéma provient de votre dépôt.
- **Les plugins sont en WebAssembly, pas en JavaScript.** Les plugins Strapi, ainsi que les
  contrôleurs, services ou fichiers de cycle de vie personnalisés dans `src/`, ne s’exécutent
  pas dans Verdin.
- **La base de données n’est pas partagée avec Strapi.** Vous importez un projet Strapi avec
  `verdin import strapi`, qui attribue un nouvel identifiant à chaque document.
- **Quelques ajouts par rapport à REST** : des actions de publication et de dépublication
  (`POST /api/<route>/<documentId>/actions/publish`), et un composant peuplé est renvoyé en
  entier, composants imbriqués compris.

[Compatibilité avec Strapi](/fr/migrate/compatibility/) détaille les différences.

## Quand ne pas l’utiliser

- **Vous dépendez de plugins Strapi ou de code serveur personnalisé en JavaScript.** Verdin ne
  peut pas les exécuter : il faudrait les réécrire sous forme de plugins WebAssembly ou déplacer
  cette logique ailleurs.
- **Vous avez besoin d’une version 1.0 stable.** Verdin en est à la 0.10 : les versions mineures
  peuvent encore modifier la configuration et le comportement. Lisez
  [Mise à niveau](/fr/migrate/upgrading/) avant chacune d’elles.
- **Vous voulez que le CMS génère vos pages.** Verdin est headless : associez-le à un framework
  frontend ou à un générateur de site statique.
- **Vous voulez un service managé.** Verdin est auto-hébergé : vous exécutez le binaire ou
  l’image Docker sur votre propre infrastructure.

## Pour aller plus loin

- [Démarrage rapide](/fr/start/quickstart/) : lancez Verdin et lisez votre première entrée depuis l’API.
- [Tutoriel : un blog avec Astro](/fr/start/tutorial-astro/) ou
  [avec Next.js](/fr/start/tutorial-nextjs/) : créez un frontend pour le blog d’exemple.
- [Modèle de contenu](/fr/concepts/content-model/) : les types de contenu, les champs et leur stockage.
- [Importer un projet Strapi](/fr/migrate/from-strapi/) : reprenez un projet existant.
