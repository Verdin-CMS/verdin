---
title: "Webhooks"
description: "Événements de webhook, forme des payloads, en-têtes, vérification des signatures, nouvelles tentatives et journal des envois."
sidebar:
  order: 6
---

Un webhook envoie un `POST` HTTP à votre URL quand du contenu ou des médias changent. Cette
page est la référence pour les récepteurs : événements, payloads, en-têtes, signatures et
envoi. Pour créer et gérer des webhooks dans le panneau d’administration, voir
[Webhooks](/fr/guides/integrations/webhooks/).

## Événements

| Événement | Envoyé quand |
| --- | --- |
| `entry.create` | Un document est créé, depuis n’importe quelle API : REST, GraphQL, le panneau d’administration ou un plugin. |
| `entry.update` | Un document est enregistré. |
| `entry.publish` | Un document est publié. Créer ou mettre à jour un document en REST ou en GraphQL sans `status=draft` le publie. |
| `entry.unpublish` | Un document est dépublié. |
| `entry.discard-draft` | Le brouillon d’un document est abandonné. |
| `entry.delete` | Un document est supprimé. |
| `media.create`, `media.update`, `media.delete` | Un fichier est téléversé, modifié ou supprimé. Supprimer un dossier envoie `media.delete` pour chacun de ses fichiers. |
| `releases.publish` | Une [release](/fr/guides/content/releases/) s’est exécutée, immédiatement ou à sa date. |
| `review-workflows.updateEntryStage` | Une entrée est passée à une autre [étape de relecture](/fr/guides/content/review-workflows/). |

Un webhook s’abonne à certains événements et peut être limité à certains types de contenu.
Les événements de médias ne sont liés à aucun type de contenu.

## Payloads

Chaque payload contient `event` et `createdAt` (le moment où l’événement a été mis en file
d’attente). Les événements d’entrée ajoutent le type de contenu et le document :

```json
{
  "event": "entry.publish",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "model": "article",
  "uid": "api::article",
  "locale": null,
  "entry": {
    "id": 3,
    "documentId": "k2m7q4dx8n5t1v3b9c0e6a2wfr",
    "title": "Hello, Verdin",
    "slug": "hello-verdin",
    "createdAt": "2026-09-25T08:55:00.000Z",
    "updatedAt": "2026-09-25T09:00:00.000Z",
    "publishedAt": "2026-09-25T09:00:00.000Z"
  }
}
```

- `model` est le `singularName` du type, `uid` son UID, et `locale` la langue de la version
  modifiée (`null` sur les types non localisés).
- `entry` est le document tel que le renvoie l’API REST, sans relations, médias, composants ni
  champs `private`.
- `entry.publish` transporte la version publiée. Les autres événements d’entrée transportent
  le brouillon, ou la seule version sur les types sans brouillon et publication.
- `entry.delete` ne transporte que `{ "documentId": … }`.

Les événements de médias envoient l’objet fichier dans `media`, sans `model`, `uid` ni
`entry` :

```json
{
  "event": "media.create",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "media": { "id": 5, "documentId": "v3k9…", "name": "harbour.jpg", "mime": "image/jpeg", "url": "/uploads/harbour_4f1c.jpg" }
}
```

`releases.publish` envoie la `release` avec le résultat de chacune de ses actions.
`review-workflows.updateEntryStage` envoie :

```json
{
  "event": "review-workflows.updateEntryStage",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "model": "article",
  "uid": "api::article",
  "entry": { "documentId": "k2m7q4…", "locale": "en" },
  "workflow": { "id": 1, "name": "Editorial" },
  "stages": { "from": { "id": 1, "name": "To do" }, "to": { "id": 2, "name": "In review" } }
}
```

Comme dans les événements d’entrée, `model` est le nom au singulier et `uid` l’UID du type de
contenu (avant la 0.10, `model` contenait ici l’UID).

Le bouton **Envoyer un événement de test** envoie `{ "event": "trigger-test", "createdAt": … }`.

## En-têtes

| En-tête | Valeur |
| --- | --- |
| `content-type` | `application/json` |
| `x-verdin-event` | Le nom de l’événement. |
| `x-verdin-delivery` | L’identifiant de l’envoi. Il reste le même d’une tentative à l’autre : utilisez-le pour ignorer les doublons. |
| `x-verdin-signature` | `t=<unix seconds>,v1=<hex>`, quand le webhook est signé. |

Les webhooks peuvent ajouter leurs propres en-têtes, par exemple un jeton `authorization` pour
votre endpoint. Les en-têtes ci-dessus ne peuvent pas être remplacés.

## Vérifier les signatures

Les webhooks sont signés par défaut. `v1` est le HMAC-SHA256 en hexadécimal de
`<t>.<raw body>`, calculé avec le secret du webhook (`whsec_…`). Le secret n’est affiché
qu’une fois, à la création du webhook ou lors du renouvellement de son secret.

Pour vérifier un envoi :

1. Séparez l’en-tête en `t` et `v1`.
2. Rejetez-le si `t` s’écarte de plus de quelques minutes de votre horloge.
3. Calculez le HMAC sur `t`, un point et le corps **brut** de la requête. Ne parsez pas le JSON
   pour le resérialiser avant : les octets seraient différents.
4. Comparez-le à `v1` en temps constant.

```js title="verify.mjs"
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, header, rawBody, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=')));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const received = parts.v1 ?? '';
  return (
    received.length === expected.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  );
}
```

Avec Express, lisez le corps brut et vérifiez-le avant de le parser :

```js title="server.mjs"
import express from 'express';
import { verify } from './verify.mjs';

const app = express();

app.post('/hooks/verdin', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body.toString('utf8');
  if (!verify(process.env.VERDIN_WEBHOOK_SECRET, req.get('x-verdin-signature') ?? '', rawBody)) {
    return res.sendStatus(401);
  }
  const payload = JSON.parse(rawBody);
  console.log(req.get('x-verdin-delivery'), payload.event, payload.entry?.documentId);
  res.sendStatus(204);
});

app.listen(3000);
```

En Python :

```python title="verify.py"
import hashlib
import hmac
import time


def verify(secret: str, header: str, raw_body: bytes, tolerance: int = 300) -> bool:
    parts = dict(part.split("=", 1) for part in header.split(","))
    if abs(time.time() - int(parts["t"])) > tolerance:
        return False
    signed = parts["t"].encode() + b"." + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))
```

## Envoi et nouvelles tentatives

Les envois sont mis en file d’attente dans la base de données au moment où la modification est
validée, et un worker en arrière-plan les envoie. Un endpoint lent ou défaillant ne ralentit
jamais les rédacteurs ni les écritures de l’API, et les envois survivent à un redémarrage.

- **Succès** : toute réponse `2xx`.
- **Échec** : tout autre statut, y compris les redirections (qui ne sont pas suivies), une
  erreur de connexion ou un délai dépassé (`[webhooks].timeout_secs`, 10 secondes par défaut).
- **Nouvelles tentatives** : un envoi en échec est retenté après 30 secondes, 2 minutes,
  10 minutes, 1 heure et 6 heures, soit six tentatives au total. Il est ensuite marqué en échec.
- Désactiver ou supprimer un webhook arrête ses nouvelles tentatives en attente.
- Plusieurs instances partagent la file d’attente ; chaque envoi est pris en charge par l’une
  d’elles.

Répondez rapidement avec un `2xx` et faites le travail lent ensuite. Les envois peuvent
arriver plus d’une fois (une nouvelle tentative après un délai dépassé, par exemple) et dans le
désordre : utilisez `x-verdin-delivery` pour ignorer les doublons, et rechargez le document
quand l’ordre compte.

## Journal des envois

La page de chaque webhook dans **Paramètres → Webhooks** comporte un **Journal des envois**,
du plus récent au plus ancien. Pour chaque envoi, il affiche le statut (**En attente**,
**Envoi en cours**, **Réussi**, **Échoué**), le statut HTTP, les 2 premiers Ko du corps de la
réponse, l’erreur, le nombre de tentatives, l’heure de la prochaine tentative, la durée et le
payload envoyé. Un envoi en échec peut être relancé depuis le journal.

Les envois terminés sont supprimés après `[webhooks].retention_days` (30 par défaut).

Les mêmes données sont disponibles via l’[API d’administration](/fr/api/admin/) :
`GET /admin/api/webhooks/{id}/deliveries` et `POST /admin/api/webhooks/deliveries/{id}/retry`.

## Restrictions d’URL

Sous `verdin start`, les URL de webhooks ne peuvent pas pointer vers des adresses de bouclage,
privées, link-local ou autrement réservées, qu’elles soient écrites sous forme d’adresses IP
ou de noms d’hôte qui s’y résolvent. Un administrateur ne peut pas utiliser les webhooks pour
atteindre des services internes. `verdin dev` les autorise, pour que vous puissiez tester sur
`localhost` ; `[webhooks].allow_private_networks` remplace le comportement par défaut. Les URL
contenant des identifiants (`https://user:pass@…`) sont refusées : placez-les dans un en-tête.

## Comparaison avec Strapi

Les payloads suivent ceux de Strapi (`event`, `createdAt`, `model`, `uid`, `entry`). Verdin
ajoute les signatures, les nouvelles tentatives, un journal des envois et des filtres par type
de contenu. L’événement `entry.draft-discard` de Strapi s’appelle `entry.discard-draft`.
