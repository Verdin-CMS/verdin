---
title: "Internationalisation"
description: "Comment Verdin conserve une version d’un document par langue, quels champs sont localisés ou partagés, et comment les API choisissent une langue."
sidebar:
  order: 5
---

L’internationalisation (i18n) conserve le contenu d’un document en plusieurs langues. Cette
page explique le modèle : les langues, les champs localisés et partagés, et la façon dont les
lectures et les écritures choisissent une langue. Pour le travail des rédacteurs, voir
[Localiser le contenu](/fr/guides/content/localizing-content/).

## Langues

Les langues du projet sont listées dans **Paramètres → Internationalisation** (autorisation
`locales.manage`). Le premier démarrage ajoute l’anglais (`en`) comme langue par défaut.

- Une langue est toujours la langue par défaut. Les requêtes qui ne nomment aucune langue
  l’utilisent, et elle ne peut pas être supprimée.
- Les codes sont une langue de deux ou trois lettres minuscules, éventuellement suivie de
  sous-étiquettes : `en`, `fr`, `pt-BR`, `zh-Hans`.

:::caution
Supprimer une langue supprime aussi toutes les versions écrites dans cette langue.
:::

## Types de contenu localisés

Un type de contenu est localisé quand son schéma l’indique. Chaque document a alors une version
par langue, et toutes partagent le `documentId` :

```json title="schema/content-types/article.json (excerpt)"
{
  "kind": "collectionType",
  "singularName": "article",
  "pluralName": "articles",
  "displayName": "Article",
  "options": { "draftAndPublish": true },
  "pluginOptions": { "i18n": { "localized": true } },
  "attributes": {
    "title": { "type": "string", "required": true },
    "readingTime": { "type": "integer", "pluginOptions": { "i18n": { "localized": false } } }
  }
}
```

Avec [brouillon et publication](/fr/concepts/draft-and-publish/), chaque langue a son propre
brouillon et sa propre version publiée : une traduction française peut donc être publiée avant
ou après le texte anglais. Les types sans `pluginOptions.i18n.localized` ne sont pas localisés
et ignorent les paramètres `locale`.

## Ce qui est localisé

Dans un type localisé, chaque attribut est localisé, sauf s’il indique
`"pluginOptions": { "i18n": { "localized": false } }`. Un tel champ **partagé** a une seule
valeur pour tout le document :

- Enregistrer un champ partagé dans une langue l’écrit dans les brouillons de toutes les
  langues.
- Publier une langue copie ses champs partagés vers les versions publiées des autres langues.
- Cela s’applique aussi aux relations et aux médias : une relation partagée lie les mêmes
  documents dans toutes les langues.

Les champs système suivent la version : chaque langue a ses propres `createdAt`, `updatedAt`
et `publishedAt`. Les valeurs `unique` et `uid` sont uniques par langue, si bien que deux
traductions peuvent partager un slug.

## Relations entre types localisés

Les relations lient des documents, pas des versions (voir
[Relations](/fr/concepts/relations/#liées-par-document-pas-par-ligne)) : la langue est donc
choisie à la lecture.

- Quand les deux types sont localisés, l’article français affiche la version française de sa
  catégorie. Les filtres à travers la relation s’appliquent dans la même langue.
- Quand le type cible n’est pas localisé, toutes les langues voient la même cible.

## Choisir une langue dans les API

REST et l’API d’administration prennent `locale` comme paramètre de requête, au format de
Strapi v5 ; GraphQL prend un argument `locale` :

```http
GET /api/articles?locale=fr
PUT /api/articles/{documentId}?locale=fr
DELETE /api/articles/{documentId}?locale=fr
```

```graphql
query {
  articles(locale: "fr") {
    documentId
    title
  }
}
```

- Sans `locale`, les requêtes lisent et écrivent la langue par défaut.
- Un `PUT` dans une langue que le document n’a pas encore crée cette version.
- Un `DELETE` ne supprime que la version dans la langue demandée. Les liens qui pointent vers le
  document sont supprimés une fois qu’il ne reste plus aucune langue.
- Les réponses REST des types localisés incluent `locale`. Une langue inconnue est une erreur
  `400`.
- Les payloads de webhook, les événements temps réel et l’historique du contenu enregistrent la
  langue de la version modifiée.

## Autorisations par langue

Les rôles d’administration peuvent limiter les autorisations de contenu à certaines langues :
un rédacteur français peut ainsi ne lire ou modifier que les versions françaises. Voir
[Autorisations](/fr/concepts/permissions/#autorisations-par-champ-et-par-langue). Les accès de
l’API de contenu (accès public, jetons d’API, rôles d’utilisateurs finaux) s’appliquent à
toutes les langues.

## Comparaison avec Strapi

Le modèle et les paramètres correspondent à l’i18n de Strapi v5 : types localisés, champs
`localized: false`, `?locale=` et langue par défaut. Dans Verdin, l’i18n fait partie du cœur
et est toujours active : vous l’activez par type de contenu dans le schéma.
