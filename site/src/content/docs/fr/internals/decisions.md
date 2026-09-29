---
title: Journal des décisions
description: Les décisions de conception derrière Verdin, numérotées dans l’ordre où elles ont été prises, avec le résultat et la raison de chacune.
sidebar:
  order: 8
---

Ce journal consigne les choix de conception qui ont façonné Verdin, dans l’ordre où ils ont été faits, pour que vous puissiez comprendre pourquoi le code est tel qu’il est avant de proposer de le modifier. Les entrées sont conservées telles qu’elles ont été écrites, noms de jalons compris (M2–M4 sont les jalons antérieurs aux premières versions) ; une entrée ultérieure peut préciser une entrée antérieure, comme la 28 le fait pour la 1. Ajoutez une ligne quand vous prenez une décision que quelqu’un devrait sinon reconstituer à partir du code.

| # | Décision | Résultat | Justification |
|---|---|---|---|
| 1 | Composants : JSON ou tables | **Colonne JSON** ([Stockage](/fr/internals/storage/#composants-et-zones-dynamiques--une-colonne-json)) | Moins de jointures, publication et versionnement triviaux, migrations plus simples. Le filtrage sur les composants répétables est rare ; il pourra être ajouté plus tard avec les fonctions JSON |
| 2 | Encodage JSON de `decimal` | **nombre** par défaut, `api.decimal_as_string` en option | La compatibilité avec Strapi maximise l’adoption ; les valeurs exactes restent disponibles au besoin |
| 3 | Formulaires de l’administration | **Signal Forms** | Convient à une administration zoneless pensée autour des signals ; arbres de formulaires dynamiques dérivés du schéma |
| 4 | Langue | **Anglais** pour le code, la documentation et les commits | Portée open source |
| 5 | Compatibilité avec le REST de Strapi | **Mêmes paramètres et même forme de réponse** ; extensions propres à Verdin sous `actions/` | Les frontends migrent avec un minimum de modifications |
| 6 | Algorithme du JWT d’administration | HS256 | Un seul secret, simple ; EdDSA si des vérificateurs externes apparaissent un jour |
| 7 | Identifiants de documents | ULID (26 caractères) | Triables et portables ; les identifiants de Strapi sont des chaînes opaques de 24 caractères, que les clients ne parsent jamais |
| 8 | Contenu de l’instantané | Modèle physique, pas le schéma | Les versions ultérieures peuvent dériver de nouvelles tables d’un schéma inchangé |
| 9 | Nullabilité des attributs | Toujours nullables ; `required` vérifié à la publication | Les brouillons peuvent être incomplets (comportement de Strapi v5) ; ajouter des champs obligatoires est sans risque |
| 10 | Application de `unique` | Index unique sur `(column, locale, publication_state)` | Sans concurrence possible ; les brouillons et leur version publiée partagent les valeurs |
| 11 | Nom de la colonne d’état | `publication_state` | `state` est un nom d’attribut courant |
| 12 | Mots réservés SQL | Toujours entourer les identifiants de guillemets | Pas de liste arbitraire de noms d’attributs interdits |
| 13 | Construction du DML | Constructeur maison plutôt que `sea-query` | Les détails propres à chaque dialecte dominent (NULL typés, collations, formats SQLite) ; une abstraction de moins |
| 14 | Écritures sans `?status=draft` | Publication (comportement REST de Strapi v5) | Compatibilité immédiate pour les clients existants |
| 15 | Comparaison de texte | Exacte par défaut sur tous les moteurs ; opérateurs `…i` pour l’insensibilité à la casse | Mêmes résultats sur MySQL que sur PostgreSQL |
| 16 | Contrôle d’accès temporaire (M2–M3) | Interrupteur `[api].open_access`, retiré en M4 | Sécurisé par défaut jusqu’à l’arrivée des autorisations |
| 17 | « Une cible appartient à un seul document » | Appliqué en déplaçant la cible, par état | Un index unique interdirait à un brouillon et à sa version publiée de partager une cible |
| 18 | Côtés inverses (`mappedBy`) | Lecture seule | Écrire par leur intermédiaire est ambigu avec brouillon et publication (quelle version du propriétaire ?) |
| 19 | Positions des liens | Renumérotées de 1 à n à chaque écriture | Pas d’épuisement des flottants ; les listes sont courtes |
| 20 | Lignes des tables de liaison | Conserver une clé primaire `id` | Tables uniformes pour le moteur de migration et les reconstructions SQLite |
| 21 | Bibliothèque JWT | HS256 maison (HMAC-SHA256, vérification en temps constant, `alg` figé) | `jsonwebtoken` 11 nécessite un backend cryptographique qui embarque RSA |
| 22 | Tables de la plateforme | Dérivées avec le modèle de contenu | Un seul mécanisme de migration pour tout |
| 23 | Réutilisation d’un jeton de rafraîchissement | Révoquer toute la famille, sans délai de grâce | Simple et strict ; l’administrateur se reconnecte |
| 24 | Brouillons via l’API de contenu | Accès `readDrafts` distinct | Les jetons qui lisent le contenu publié ne divulguent pas les brouillons |
| 25 | Ordre d’application du constructeur | Migrer, puis écrire les fichiers, puis remplacer l’application à chaud | Une migration en échec laisse intacts les fichiers et l’application en cours |
| 26 | Écritures de l’administration | Enregistrer uniquement des brouillons ; la publication est une action explicite | Correspond aux attentes des rédacteurs ; l’API de contenu garde la publication par défaut de Strapi |
| 27 | Configuration d’exécution de l’administration | Balise `<meta>`, pas de script inline | Garde la CSP exempte de scripts `unsafe-inline` |
| 28 | Filtres sur les champs de composants | Opérateurs de chemin JSON par dialecte (`#>>`, `JSON_VALUE`, `json_extract`) ; `EXISTS` sur les éléments de tableau pour les composants répétables et les zones dynamiques (0.8) | Les zones dynamiques uniquement par `__component` : leurs éléments ont des champs différents |
| 29 | i18n de l’administration | Transloco avec des catalogues JSON plats (`admin/public/i18n`) et ICU MessageFormat via FormatJS (un transpileur personnalisé), derrière une petite façade `I18n` ; pas l’i18n à la compilation d’Angular | Changement de langue à l’exécution ; fichiers standard pour Weblate/Crowdin ; FormatJS interprète les messages, si bien que la CSP stricte n’a pas besoin de `unsafe-eval` (`@messageformat/core` compile avec `new Function`) ; clés typées à partir de `en.json`, complétude vérifiée par `npm run i18n:check` |
| 30 | Premier jour de la semaine | `Intl.Locale#getWeekInfo` de l’étiquette régionale du navigateur (en-GB ≠ en-US), table des régions en repli, surcharge par l’utilisateur | Suit la région de chaque utilisateur même quand la langue de l’interface est partagée |
| 31 | Stockage de la disposition du tableau de bord | Colonne JSON `preferences` par utilisateur sur `vd_admin_users` (≤ 64 Kio) | Suit l’utilisateur d’un navigateur à l’autre ; le thème et la langue restent dans `localStorage` car ils s’appliquent avant la connexion |
| 32 | Valeur par défaut de `Secure` pour le cookie de rafraîchissement | Activé sous `start`, désactivé sous `dev`, modifiable | `verdin dev` en HTTP simple fonctionne dans tous les navigateurs ; la production reste stricte |
| 33 | Profil de release | Thin LTO, 1 codegen unit, symboles retirés ; unwinding conservé | Un gestionnaire qui panique ne doit pas faire tomber le serveur |
| 34 | Documents « non vus » | Lignes `vd_document_views` par utilisateur, supprimées pour tout le monde sauf l’éditeur quand un document change ; filtrées avec `NOT EXISTS` en SQL | Pagination et comptages restent exacts ; aucun horodatage à comparer par ligne |
| 35 | Votes et sondages | Tables de collaboration réservées à l’administration (`vd_document_votes`, `vd_polls`, `vd_poll_votes`), pour tout type de contenu | Boîtes à idées et décisions d’équipe sans modéliser des champs de vote dans chaque schéma |
| 36 | Stockage des médias | `object_store` pour le local et S3 | Un seul chemin de code ; téléversements multipart en streaming ; RustFS dans la pile de développement et la CI |
| 37 | Liens de médias | Tables de liaison par champ, comme pour les relations | Même sémantique de brouillon et publication que les relations ; les cascades gardent les liens cohérents |
| 38 | Mises à niveau des autorisations intégrées | Marqueur de version dans `vd_settings`, ajouts appliqués une seule fois | Les installations existantes obtiennent les nouvelles autorisations sans annuler les modifications ultérieures d’un administrateur |
| 39 | Fonctionnalités à l’exécution | Catalogue dans `verdin-api`, interrupteurs dans `vd_settings` (`features`), application reconstruite sur place (ArcSwap) dans tous les modes | Interrupteurs à la façon des plugins de Strapi, sans redémarrage ; les fonctionnalités indisponibles sont listées avec leur version prévue |
| 40 | Interface de référence de l’API | Scalar (`scalar_api_reference`, bundle intégré) sur `{api}/docs`, uniquement quand le document est public ; la CSP autorise son script d’amorçage inline par hash | Auto-hébergé (pas de CDN, de polices, d’agent IA ni de télémétrie) ; le document reste réservé aux jetons par défaut |
| 41 | GraphQL | Schéma dynamique `async-graphql` construit avec l’application ; les arguments et les sélections sont traduits dans l’arbre de paramètres REST et analysés par le même parseur de requêtes | Un seul ensemble de règles pour les filtres, la pagination, le populate, la validation et les autorisations en REST et en GraphQL ; le populate dérivé de la sélection conserve le chargement groupé |
| 42 | Événements de document | Écouteurs sur le Document Service, appelés après le commit | Les effets de bord (marques de consultation, futurs webhooks) s’appliquent à toutes les API sans hooks par gestionnaire |
