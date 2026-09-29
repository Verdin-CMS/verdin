---
title: Stockage
description: Comment Verdin organise le contenu dans la base de données, des noms de tables et colonnes système aux lignes brouillon et publiées, en passant par les liens de relations, le JSON des composants et les tables de la plateforme.
sidebar:
  order: 2
---

Cette page décrit les tables que Verdin dérive de votre schéma et la façon dont chaque genre d’attribut est stocké. Lisez-la avant de modifier quoi que ce soit dans `crates/verdin-migrate/src/derive.rs` ou dans le Document Service, ou quand vous avez besoin d’interroger directement la base de données. Pour ce qu’accepte chaque type d’attribut, voir [Types d’attributs](/fr/reference/attribute-types/).

Vous n’écrivez jamais ces tables à la main : le [moteur de migration](/fr/internals/migrations/) les crée et les fait évoluer à partir du schéma.

## Conventions de nommage

| Objet | Nom |
|---|---|
| Table d’un type de contenu | `collectionName`, qui vaut par défaut le `pluralName` avec les tirets remplacés par des tirets bas (`blog-posts` → `blog_posts`) |
| Colonne | Le nom de l’attribut en snake case (`metaTitle` → `meta_title`) |
| Liens de relations | `{table}_{column}_lnk` |
| Liens de relations polymorphes | `{table}_{column}_mph` |
| Liens de médias | `{table}_{column}_mda` |
| Index | `{table}_{part}_uq` pour les index uniques, `{table}_{part}_idx` pour les autres |
| Table de la plateforme | Préfixe `vd_` (`vd_admin_users`, `vd_schema_snapshots`…) |

Règles qu’applique le validateur de schéma (`crates/verdin-schema/src/naming.rs` et `validate.rs`) :

- Un `collectionName` correspond à `^[a-z][a-z0-9_]*$`, fait au plus 50 caractères et ne peut pas commencer par `vd_`.
- `singularName` et `pluralName` sont en kebab case (`^[a-z][a-z0-9-]*$`, sans tiret au début, à la fin ni doublé). `upload`, `uploads`, `auth`, `users` et `connect` sont réservés, car l’API de contenu utilise ces routes.
- Les noms d’attributs commencent par une lettre et se poursuivent par des lettres, chiffres ou tirets bas (la règle de Strapi), et font au plus 50 caractères.
- Sur les types de contenu, `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`, `updatedAt`, `createdBy` et `updatedBy` sont réservés, ainsi que tout nom dont la forme en snake case entre en collision avec eux. Sur les composants, `id` est réservé.
- Les identifiants générés sont plafonnés à 60 caractères (PostgreSQL en autorise 63, MySQL 64). Un nom plus long est tronqué et reçoit un hash de 8 caractères du nom complet : des noms longs distincts restent ainsi distincts et le résultat est déterministe.

Chaque identifiant est entouré de guillemets dans le SQL généré : les mots réservés SQL sont donc des noms d’attributs valides.

## Colonnes système

Chaque table de type de contenu commence par ces colonnes :

```sql
id                 BIGINT       primary key, auto-increment
document_id        CHAR(26)     NOT NULL           -- ULID, shared by every version of a document
locale             VARCHAR(16)  NOT NULL DEFAULT '' -- '' for types that are not localized
publication_state  SMALLINT     NOT NULL           -- 0 = draft, 1 = published
published_at       <datetime>   NULL
created_at         <datetime>   NOT NULL
updated_at         <datetime>   NOT NULL
created_by_id      BIGINT       NULL               -- vd_admin_users.id
updated_by_id      BIGINT       NULL
UNIQUE (document_id, locale, publication_state)
INDEX  (publication_state, locale)
```

- `document_id` est un ULID en minuscules généré à la création. Il reste le même pour le brouillon, la version publiée et toutes les langues.
- Les types non localisés utilisent `locale = ''` plutôt que `NULL`, car les NULL n’entrent jamais en collision dans les index uniques, quel que soit le moteur, ce qui casserait la contrainte `(document_id, locale, publication_state)`.
- La colonne d’état est `publication_state`, et non `state`, car `state` est un nom d’attribut courant.

Les colonnes d’attributs suivent, une par attribut scalaire. **Chaque colonne d’attribut est nullable.** Comme dans Strapi v5, les brouillons peuvent être incomplets : `required` est donc vérifié quand une version est publiée (ou à chaque écriture sur les types sans brouillon et publication), et non par la base de données. Cela fait aussi de l’ajout d’un attribut obligatoire une migration sans risque.

Les attributs `unique`, et chaque `uid`, reçoivent un index unique sur `(column, locale, publication_state)`. Un brouillon et sa version publiée peuvent partager une valeur, deux documents publiés ne le peuvent pas, et la base de données l’impose sans concurrence possible. Une violation est signalée comme `ValidationError` sur ce champ.

## Brouillon et publication

Verdin suit le modèle de Strapi v5. Voir [Brouillon et publication](/fr/concepts/draft-and-publish/) pour le point de vue de l’utilisateur ; voici ce qui se passe dans la table.

- Un document a au plus une ligne brouillon (`publication_state = 0`) et une ligne publiée (`publication_state = 1`) par langue.
- Les écritures depuis le panneau d’administration ciblent la ligne brouillon.
- **Publier** vérifie les attributs `required` et les règles de validation sur le brouillon, puis copie les valeurs des attributs du brouillon sur la ligne publiée (en la mettant à jour, ou en l’insérant la première fois), dans une seule transaction. Les liens de relations et de médias du brouillon sont copiés avec.
- **Dépublier** supprime la ligne publiée. Ses liens disparaissent avec elle grâce à `ON DELETE CASCADE`.
- **Abandonner le brouillon** écrase le brouillon avec les valeurs et les liens de la ligne publiée.
- Les types de contenu sans brouillon et publication n’ont jamais qu’une ligne publiée.
- Pour les types localisés, les attributs non localisés sont partagés : publier une langue les copie vers les lignes publiées des autres langues.

## Relations : liées par identifiant de document

**C’est la principale différence avec le stockage de Strapi.** Strapi lie les lignes par identifiant de ligne et doit réécrire les liens à la publication. Verdin stocke une relation sous la forme *ligne source → document cible* :

```sql
-- articles_category_lnk
id                  BIGINT   primary key, auto-increment
source_id           BIGINT   NOT NULL REFERENCES articles(id) ON DELETE CASCADE
target_document_id  CHAR(26) NOT NULL
position            DOUBLE   NOT NULL   -- 1..n, rewritten on every write
UNIQUE (source_id, target_document_id)
UNIQUE (source_id)                      -- to-one kinds only
INDEX  (target_document_id)
```

- La ligne cible est choisie à la lecture, dans la version en cours de lecture : un article publié voit les catégories publiées, un brouillon voit les brouillons. Si une catégorie est dépubliée, elle disparaît des articles publiés sans qu’aucun lien ne soit touché.
- La publication ne copie que les liens propres à la ligne source.
- Seul le côté **propriétaire** (l’attribut avec `inversedBy`, ou une relation à sens unique) a une table de liaison. Le côté inverse (`mappedBy`) lit la même table en sens inverse, et il est en lecture seule : l’écrire est une erreur de validation qui nomme l’attribut propriétaire.
- « Au plus une cible » (`oneToOne`, `manyToOne`, `oneWay`) correspond à l’index unique sur `source_id`. « Une cible appartient à un seul document source » (`oneToOne`, `oneToMany`) ne peut pas être un index, car un brouillon et sa version publiée partagent légitimement des cibles. Le Document Service l’impose en *déplaçant* la cible : la lier supprime les liens que d’autres documents détiennent vers elle dans le même état, ce qui est le comportement de Strapi.
- Il n’y a pas de clé étrangère sur `target_document_id`, car `document_id` n’est pas unique dans la table cible. Le Document Service rejette les liens vers des documents inexistants et, quand la dernière version d’un document est supprimée, retire dans la même transaction les liens qui pointent vers lui.
- Les lignes de liaison conservent une clé primaire `id` : les tables de liaison ressemblent ainsi à toutes les autres tables pour le moteur de migration et pour les reconstructions de tables SQLite.
- Renommer une table renomme ses tables de liaison avec elle. Les migrations s’exécutent avec les `foreign_keys` de SQLite désactivées : reconstruire une table ne se propage donc pas en cascade à ses tables de liaison.

Les **relations polymorphes** (`morphToOne`, `morphToMany`) lient des documents de n’importe quel type de contenu. Leurs liens se trouvent dans `{table}_{column}_mph` avec `source_id`, `target_type` (l’UID de la cible), `target_document_id` et `position`, un index unique `(source_id, target_type, target_document_id)`, et pour `morphToOne` un `source_id` unique. Les côtés inverses (`morphOne`, `morphMany`) n’ont pas de table : ils lisent les liens du propriétaire qui pointent vers eux, et sont en lecture seule. Supprimer un document retire les liens polymorphes qui pointent vers lui. Voir [Relations](/fr/concepts/relations/) pour ce que vous pouvez et ne pouvez pas en faire.

## Composants et zones dynamiques : une colonne JSON

Un attribut composant ou une zone dynamique est **une colonne JSON** sur la ligne du document (`jsonb` sur PostgreSQL, `json` sur MySQL et MariaDB, `text` sur SQLite). Strapi stocke chaque composant dans sa propre table avec des tables de jointure polymorphes ; une colonne évite ces jointures et fait de la publication et de l’historique une simple copie.

```json
// "seo" column (a single component)
{ "id": 1, "metaTitle": "…", "metaDescription": "…" }

// "blocks" column (a dynamic zone)
[
  { "id": 1, "__component": "blocks.hero", "title": "…" },
  { "id": 2, "__component": "blocks.quote", "text": "…", "author": "…" }
]
```

- Chaque élément de composant a un `id` entier, unique au sein de son attribut. Les nouveaux éléments reçoivent le prochain numéro libre.
- Les données sont validées par rapport au schéma du composant à chaque écriture.
- La publication et l’abandon copient le JSON tel quel.
- Les **relations et médias dans les composants** sont stockés dans le JSON lui-même : des `documentId` pour les relations (seuls `oneWay` et `manyWay` y sont autorisés) et des identifiants de fichiers pour les médias. Ils sont vérifiés à l’écriture et résolus par des requêtes groupées quand le composant est peuplé. Les relations polymorphes et les attributs `password` ne peuvent pas se trouver dans des composants.
- Le **filtrage** nécessite des fonctions JSON propres à chaque dialecte. Les champs scalaires des composants simples sont lus via un chemin JSON (`#>>` sur PostgreSQL, `JSON_VALUE` sur MySQL et MariaDB, `json_extract` sur SQLite). Les composants répétables utilisent `EXISTS` sur les éléments du tableau (`jsonb_array_elements`, `JSON_TABLE`, `json_each`). Les zones dynamiques ne peuvent être filtrées que par `__component`, car leurs éléments ont des champs différents.

Voir [Composants et zones dynamiques](/fr/concepts/components-and-dynamic-zones/) pour le côté modélisation.

## Tables de la plateforme

Les tables de la plateforme font partie de chaque modèle dérivé : le moteur de migration les crée et les fait évoluer exactement comme les tables de contenu ; elles apparaissent comme des étapes sans risque dans `verdin migrate plan`. Elles sont définies dans `crates/verdin-migrate/src/system.rs`.

| Domaine | Tables |
|---|---|
| Migrations | `vd_schema_snapshots`, `vd_migrations_journal` (propres au moteur de migration, créées à la première utilisation) |
| Administrateurs | `vd_admin_users`, `vd_admin_roles`, `vd_admin_user_roles`, `vd_admin_permissions`, `vd_sessions` (jetons de rafraîchissement), `vd_admin_tokens` (liens d’invitation et de réinitialisation), `vd_admin_two_factor`, `vd_admin_passkeys`, `vd_spent_challenges` |
| Accès à l’API de contenu | `vd_api_tokens`, `vd_api_token_permissions`, `vd_public_permissions` |
| Utilisateurs finaux | `vd_users`, `vd_user_roles`, `vd_user_role_permissions`, `vd_end_user_sessions` |
| Instance | `vd_settings` (interrupteurs des fonctionnalités, mises en page des vues d’édition, marqueurs de mises à niveau ponctuelles), `vd_locales` |
| Médias | `vd_files`, `vd_folders` |
| Workflow de contenu | `vd_history_versions`, `vd_releases`, `vd_release_actions`, `vd_workflows`, `vd_workflow_stages`, `vd_document_stages` |
| Collaboration | `vd_comments`, `vd_tasks`, `vd_document_views`, `vd_document_votes`, `vd_polls`, `vd_poll_votes` |
| Intégrations | `vd_webhooks`, `vd_webhook_deliveries`, `vd_deploy_targets`, `vd_deployments`, `vd_plugin_kv`, `vd_audit_logs` |
| Fonctionnalités de site | `vd_redirects`, `vd_menus`, `vd_forms`, `vd_form_submissions` |

## Tables des médias

Les fichiers sont des lignes de `vd_files` au format de Strapi (`name`, `alternative_text`, `caption`, `width`, `height`, `formats`, `hash`, `ext`, `mime`, `size`, `url`, `provider`…), plus `focal_point`, `folder_id` et `folder_path`. Les dossiers (`vd_folders`) conservent le `path` de Strapi composé de `path_id`, comme `/1/4`.

Un attribut de média est une table de liaison `{table}_{column}_mda` avec `source_id` (la ligne de contenu), `file_id` (une ligne de `vd_files`) et `position`. Elle a un index unique `(source_id, file_id)` et, quand l’attribut n’est pas `multiple`, un `source_id` unique. Les deux colonnes sont des clés étrangères avec `ON DELETE CASCADE` : supprimer un fichier ou une ligne retire donc ses liens. Les liens de médias suivent les mêmes règles de brouillon et de publication que les liens de relations : chaque version possède ses liens et la publication les copie.

Le fonctionnement des téléversements, des formats et des fournisseurs de stockage est décrit dans [Médias](/fr/concepts/media/).
