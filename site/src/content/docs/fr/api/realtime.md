---
title: "API temps réel"
description: "Le protocole Server-Sent Events du flux temps réel de Verdin : endpoint, authentification, noms d’événements et forme des messages, et le protocole de présence de l’administration."
sidebar:
  order: 5
  label: "Temps réel"
---

Verdin diffuse les modifications de contenu et de médias au moment où elles sont validées, via
[Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events) (SSE).
Chaque abonné ne reçoit que les événements concernant ce qu’il a le droit de lire. Cette page
décrit le protocole ; pour l’utiliser dans un frontend, voir
[Mises à jour en temps réel](/fr/guides/frontend/realtime/).

## Activation

Le temps réel est désactivé par défaut. Activez-le dans
**Paramètres → Fonctionnalités → Temps réel** (autorisation `features.manage`). Tant qu’il est
désactivé, les endpoints répondent `404`.

## Flux de contenu

```
GET /api/_events
GET /api/_events?types=api::article,api::category
```

| Paramètre | Description |
| --- | --- |
| `types` | Facultatif, des UID de types de contenu séparés par des virgules ; `plugin::upload` désigne la médiathèque. La forme Strapi `api::article.article` fonctionne aussi. Sans ce paramètre, vous recevez tous les types que vous pouvez lire. |

Authentifiez-vous comme sur l’API REST : un jeton d’API ou le JWT d’un utilisateur final dans
`Authorization: Bearer …`, ou aucun en-tête pour l’accès public. Un jeton invalide répond `401`
avant l’ouverture du flux.

```sh title="Terminal"
curl -N -H "Authorization: Bearer $VERDIN_TOKEN" \
  'https://cms.example.com/api/_events?types=api::article'
```

```text
event: ready
data: {}

event: entry.publish
data: {"event":"entry.publish","uid":"api::article","documentId":"k2m7q4dx8n5t1v3b9c0e6a2wfr","locale":"en"}

event: media.create
data: {"event":"media.create","uid":"plugin::upload","documentId":"v3k9…","fileId":5}
```

## Messages

Le premier événement est toujours `ready`. Ensuite, chaque modification est un événement SSE
qui porte son nom, dont le `data` est un objet JSON :

| Champ | Présent | Description |
| --- | --- | --- |
| `event` | toujours | Le nom de l’événement, comme dans la ligne SSE `event:`. |
| `uid` | toujours | L’UID du type de contenu, ou `plugin::upload` pour les médias. |
| `documentId` | toujours | Le document ou le fichier modifié. |
| `locale` | types localisés | La langue de la version modifiée. |
| `fileId` | événements de médias | L’identifiant numérique du fichier, tel qu’utilisé dans les champs de média. |
| `actorId` | flux d’administration | L’administrateur à l’origine de la modification, quand c’est un administrateur. |

| Événements | Envoyés quand | Destinataires |
| --- | --- | --- |
| `entry.create`, `entry.update`, `entry.discard-draft` | Un document est créé, enregistré, ou son brouillon abandonné | Sur les types avec brouillon et publication, les appelants disposant de `readDrafts` (ces événements ne modifient que des brouillons). Sur les autres types, les appelants disposant de `find` ou `findOne`. |
| `entry.publish`, `entry.unpublish`, `entry.delete` | Un document est publié, dépublié ou supprimé | Les appelants disposant de `find` ou `findOne` sur le type |
| `media.create`, `media.update`, `media.delete` | Un fichier est téléversé, modifié ou supprimé | Les appelants disposant de `find` ou `findOne` sur la médiathèque |

Les événements transportent des identifiants, pas le contenu. Récupérez le document ou le
fichier avec l’API REST ou GraphQL pour le lire, avec les autorisations habituelles de
l’appelant. Les événements proviennent de toutes les API : REST, GraphQL, le panneau
d’administration, les releases et les plugins.

## Durée de vie de la connexion

- Le serveur envoie un commentaire keep-alive toutes les 15 secondes.
- Un flux de contenu se termine au bout d’une heure. Reconnectez-vous (l’`EventSource` des
  navigateurs le fait tout seul), ce qui vérifie aussi à nouveau le jeton.
- Un événement nommé `lagged`, avec `data: {"missed": 12}`, signifie que le client a lu trop
  lentement et que ce nombre d’événements a été perdu. Rechargez ce que le client affiche.
- Il n’y a pas de rejeu : les événements qui surviennent pendant qu’un client est déconnecté
  ne sont pas envoyés plus tard.

L’`EventSource` des navigateurs ne peut pas envoyer d’en-tête `Authorization`. Pour l’accès
public, il fonctionne tel quel ; avec un jeton, utilisez `fetch` avec un lecteur de corps en
streaming, ou un client SSE qui prend en charge les en-têtes.

## Flux d’administration

Le panneau d’administration ouvre son propre flux avec le jeton d’accès de l’administrateur :

```
GET /admin/api/events?types=api::article
```

Il transporte les mêmes événements de contenu et de médias pour les types que
l’administrateur peut lire (avec `content.read` et `media.read`), brouillons compris, plus :

- `actorId` sur les modifications faites par des administrateurs ;
- les événements `presence` (ci-dessous) ;
- `comment.create`, `comment.update`, `comment.delete`, `comment.resolve`,
  `comment.reopen`, `task.create`, `task.update` et `task.delete`, avec le `uid`, le
  `documentId` et la `locale` de l’entrée.

Un flux d’administration se termine au bout de 15 minutes, la durée de vie d’un jeton
d’accès : reconnectez-vous avec un jeton neuf.

### Présence

L’éditeur d’entrée indique au serveur qui se trouve sur une entrée :

```
POST /admin/api/presence
{ "uid": "api::article", "documentId": "k2m7q4…", "locale": "en", "editing": true }
```

- Envoyez-le environ toutes les 20 secondes tant que l’éditeur est ouvert. `editing: true`
  signifie que l’administrateur a des modifications non enregistrées. Envoyez
  `"leave": true` à la fermeture de l’éditeur.
- Une présence expire 45 secondes après le dernier heartbeat.
- La réponse liste qui se trouve sur l’entrée : `{ "data": [{ "userId": 3, "name": "Ada Lovelace", "editing": true, "holdsLock": true }] }`.
- `GET /admin/api/presence?uid=&documentId=&locale=` lit la même liste.
- Quand la liste change, les flux d’administration reçoivent un événement `presence` avec le
  `uid`, le `documentId` et la `locale` de l’entrée, et la liste dans `presence`.

Le premier administrateur encore en train d’éditer détient un verrou souple (`holdsLock`).
L’éditeur le signale aux autres, mais cela ne bloque pas leurs enregistrements. Lire la
présence nécessite `content.read` sur le type.

## Plusieurs instances

Les événements et la présence sont ceux de l’instance à laquelle un client est connecté.
Derrière un répartiteur de charge, routez `/api/_events` et `/admin/api/events` avec des
sessions persistantes (sticky sessions), ou faites pointer les clients temps réel vers une
seule instance. Voir [Exécuter plusieurs instances](/fr/deploy/scaling/).
