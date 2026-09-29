---
title: Panneau d’administration
description: Comment est structuré le panneau d’administration Angular de Verdin, comment il construit les formulaires et les listes à partir du schéma, et comment il est compilé, intégré au binaire et traduit.
sidebar:
  order: 6
  label: Panneau d’administration
---

Cette page s’adresse aux contributeurs du panneau d’administration dans `admin/` : l’organisation de l’application Angular, la façon dont elle transforme le schéma de contenu en formulaires et en listes, et comment elle finit dans le binaire `verdin`. L’utilisation du panneau est couverte par les guides ; le fonctionnement côté serveur de l’API d’administration se trouve dans la [référence de l’API d’administration](/fr/api/admin/).

Le panneau est une single-page app Angular 22 : composants standalone, détection des changements zoneless, signals, routes chargées à la demande, et composants spartan/ui sur Tailwind CSS v4.

## Structure

```text
admin/
├── src/app/
│   ├── app.config.ts     # providers: router, HttpClient interceptors, Transloco, icons
│   ├── app.routes.ts     # lazy routes, guards (auth, permissions, unsaved changes)
│   ├── core/             # services and pure models: api, auth, schema, i18n, permissions…
│   ├── layout/           # the shell (sidebar, header), home, deploy button
│   ├── features/
│   │   ├── auth/         # login, first admin, invitations, password reset
│   │   ├── dashboard/    # home widgets
│   │   ├── content/      # lists, the entry editor, history, releases, review, import
│   │   │   ├── fields/   # schema-driven form controls and the form model
│   │   │   └── collab/   # comments and tasks
│   │   ├── builder/      # content-type builder (verdin dev only)
│   │   ├── media/        # media library
│   │   ├── releases/
│   │   ├── profile/      # own account, two-factor, passkeys, sessions
│   │   └── settings/     # users, roles, tokens, webhooks, locales, plugins, site features…
│   └── shared/
│       ├── ui/           # spartan helm components, owned by the project
│       └── components/   # app-level shared components (confirm dialog, page header…)
├── public/i18n/          # translation catalogs, one JSON file per language
├── scripts/check-i18n.mjs
└── e2e/                  # Playwright tests and the server they run against
```

**L’état** réside dans des signals à l’intérieur de services injectables dans `core/` (`Auth`, `Schema`, `I18n`, `Theme`…). Il n’y a pas de bibliothèque de store.

**L’accès à l’API** passe par `core/api.ts`, une petite surcouche à base de promesses au-dessus du `HttpClient` d’Angular, avec des types écrits à la main dans `core/types.ts`. La configuration d’exécution (chemin d’administration, préfixe de l’API, mode, personnalisation visuelle) provient d’une balise `<meta name="verdin-config">` que le serveur injecte.

**Session.** Le jeton d’accès ne vit qu’en mémoire ; le jeton de rafraîchissement est un cookie `HttpOnly` limité aux routes d’authentification. Un intercepteur HTTP ajoute le jeton bearer et, sur un `401`, rafraîchit une fois et réessaie ; si le rafraîchissement échoue, il renvoie l’utilisateur à la page de connexion. Les requêtes de rafraîchissement et de déconnexion portent l’en-tête `X-Verdin-CSRF` qu’exige le serveur. Des guards restaurent la session à partir du cookie au chargement de la page. Un `403` indiquant que le rôle exige l’authentification à deux facteurs envoie l’utilisateur la configurer.

## Formulaires pilotés par le schéma

L’éditeur d’entrée (`features/content/edit.ts`) n’a aucun code propre à un type. Il lit les types de contenu et les composants depuis `GET /admin/api/content-types` et `GET /admin/api/components`, et la mise en page de l’éditeur depuis les paramètres de la vue d’édition, puis construit le formulaire à l’exécution avec les **Signal Forms** (`@angular/forms/signals`) :

- Le modèle du document est un signal d’un objet simple (`FormModel` dans `fields/model.ts`) ; l’arbre des champs et ses validateurs sont dérivés du schéma.
- Un composant récursif `vd-fields` (`fields/fields.ts`) affiche n’importe quelle map d’attributs sur un arbre de champs. Le texte, les dates et les heures utilisent des inputs natifs liés avec `[formField]`. Des `FormValueControl` personnalisés gèrent les nombres (nullables ; les grands entiers restent des chaînes), les interrupteurs, les énumérations, les date-heures (heure locale dans l’input, UTC dans le modèle), le JSON, le Markdown, les `blocks` (TipTap), les médias, les relations (sélecteur avec recherche à la saisie et ordonnancement) et les relations polymorphes.
- Les composants sont des fieldsets imbriqués ; les composants répétables et les zones dynamiques sont des listes réordonnables. Les plugins peuvent enregistrer des types de champs personnalisés, affichés sous forme de custom elements.
- `toModel` convertit un document peuplé en modèle de formulaire (les relations deviennent des `documentId`, les fichiers des identifiants), et `toPayload` fait la conversion inverse vers le payload `data` : les chaînes vides deviennent `null`, les clés de rendu (`__key`) et les côtés en lecture seule (`mappedBy`, `morphOne`, `morphMany`) sont retirés. Les deux sont couverts par des tests unitaires dans `fields/model.spec.ts`.
- La validation dérivée du schéma donne un retour immédiat. Les champs conditionnels (`conditions.visible`) sont évalués dans le navigateur par un portage de l’évaluateur JSON Logic du serveur (`core/logic.ts`). Les règles de validation inter-champs ne sont vérifiées que par le serveur. Le serveur reste l’autorité : les entrées `details.errors[].path` qu’il renvoie sont rattachées au champ correspondant.
- L’enregistrement est explicite, avec suivi des modifications et avertissement avant de quitter la page (un guard de route plus `beforeunload`). Les boutons **Publier**, **Dépublier** et **Annuler les modifications** apparaissent selon l’état du document. L’administration n’enregistre que des brouillons ; la publication est toujours une action séparée.

La mise en page de l’éditeur (ordre des champs, largeurs, libellés, descriptions, champs en lecture seule, champ qui nomme les entrées liées) est partagée par tous les administrateurs et stockée sur le serveur dans `vd_settings` ; elle se modifie depuis la page **Configurer la vue** avec l’autorisation `views.manage`.

## Listes

Les listes de contenu (`features/content/list.ts`) utilisent la table spartan helm avec pagination, tri et filtres côté serveur. Les filtres, la recherche (`_q`) et la page sont reflétés dans l’URL : une liste filtrée est donc un lien partageable. Chaque administrateur choisit les colonnes visibles, le tri par défaut et la taille de page par type (`list-view.ts`) ; ces choix sont enregistrés dans ses propres préférences sur le serveur, et le suivent donc d’un navigateur à l’autre. Les listes se mettent aussi à jour en direct à partir du flux d’événements de l’administration.

## Constructeur de types de contenu

Le **Constructeur de types de contenu** n’est visible que lorsque le serveur tourne en mode développement (`verdin dev`) et que l’administrateur dispose de `schema.manage`. Il modifie les types de contenu et les composants dans leur format de fichier : champs, types et cibles de relations (en créant l’attribut inverse sur la cible), composants, zones dynamiques, longueurs, plages, et les indicateurs `required`, `unique` et `private`.

Chaque modification est d’abord envoyée à `POST /admin/api/schema/plan`, qui valide le schéma envisagé et renvoie les étapes de migration avec leur risque, leur SQL et des suggestions de renommage que l’utilisateur peut accepter. La confirmation appelle `POST /admin/api/schema/apply` avec le niveau de risque accepté et les renommages. Le serveur migre, écrit `schema/*.json` et remplace l’application en cours par le nouveau schéma sans redémarrage. Voir le [moteur de migration](/fr/internals/migrations/) pour ce qui se passe côté serveur.

## Compilation et distribution

- `ng build` écrit la build de production dans `admin/dist/admin/browser`, avec `<base href="/admin/">`.
- Le serveur intègre ce dossier avec `rust-embed` quand il est compilé avec la feature `embed-admin`, qu’utilisent les builds de release et l’image Docker. Sans cette feature, ou quand `[admin].assets_dir` est défini, il sert les fichiers depuis le disque. `assets_dir` l’emporte sur la build intégrée.
- Le serveur réécrit `<base href>` avec `[admin].path` et injecte la configuration d’exécution sous forme de balise `<meta>`, et non de script inline. Changer `admin.path` ne nécessite jamais de recompiler le panneau.
- Les chemins inconnus sans extension de fichier se rabattent sur `index.html` pour le routage côté client. Les bundles avec empreinte (`main-ABC123.js`) sont mis en cache comme `immutable` pendant un an ; tout le reste est en `no-cache`.
- Chaque réponse de l’administration porte une Content Security Policy stricte (`script-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`…), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` et `Referrer-Policy: strict-origin-when-cross-origin`. L’inlining du CSS critique d’Angular est désactivé dans `angular.json`, car il repose sur des gestionnaires d’événements inline que la politique interdit.

Pour le travail sur le frontend, lancez le serveur, puis `npm start` dans `admin/` : `ng serve` redirige `/admin/api` et `/api` vers `http://localhost:1337` (`admin/proxy.conf.json`).

## Traductions

Le panneau est traduit à l’exécution avec Transloco, et non avec l’i18n à la compilation d’Angular : une seule build sert donc toutes les langues, et les utilisateurs peuvent changer de langue sans rechargement.

- Les catalogues sont des fichiers JSON plats dans `admin/public/i18n/` (`en.json` est la source), chargés à la demande.
- Les messages utilisent ICU MessageFormat (`{name}`, `{count, plural, one {# entry} other {# entries}}`), interprétés par FormatJS (`intl-messageformat`) via un transpileur Transloco personnalisé. FormatJS interprète les messages au lieu de les compiler en fonctions : la CSP n’a donc pas besoin de `unsafe-eval`.
- Les clés de messages sont typées à partir de `en.json` (`core/i18n/keys.ts`) : utiliser une clé inexistante est une erreur de compilation.
- `npm run i18n:check` vérifie chaque catalogue par rapport à `en.json` : mêmes clés, syntaxe ICU valide, mêmes arguments, et toutes les catégories de pluriel de la langue. La CI l’exécute.
- Le service `I18n` fournit aussi un formatage adapté à la langue et le premier jour de la semaine, tirés des paramètres régionaux du navigateur, avec une surcharge possible par utilisateur.

La façon d’ajouter ou de mettre à jour une langue est décrite dans [Traduire](/fr/project/translating/).
