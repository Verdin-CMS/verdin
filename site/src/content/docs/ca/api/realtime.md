---
title: "API de temps real"
description: "El protocol Server-Sent Events del flux en temps real de Verdin: endpoint, autenticació, noms d'esdeveniments i forma dels missatges, i el protocol de presència de l'administració."
sidebar:
  order: 5
  label: "Temps real"
---

Verdin emet els canvis de contingut i de multimèdia a mesura que es confirmen, per mitjà de
[Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events) (SSE).
Cada subscriptor només rep esdeveniments sobre el que pot llegir. Aquesta pàgina descriu el
protocol; per fer-lo servir en un frontend, consulta
[Actualitzacions en temps real](/ca/guides/frontend/realtime/).

## Activació

El temps real està desactivat per defecte. Activa'l a **Configuració → Funcionalitats → Temps
real** (permís `features.manage`). Mentre està desactivat, els endpoints responen `404`.

## Flux de contingut

```
GET /api/_events
GET /api/_events?types=api::article,api::category
```

| Paràmetre | Descripció |
| --- | --- |
| `types` | Opcional, UID de tipus de contingut separats per comes; `plugin::upload` és la mediateca. La forma de Strapi `api::article.article` també funciona. Sense aquest paràmetre, reps tots els tipus que pots llegir. |

Autentica't com a l'API REST: un token d'API o el JWT d'un usuari final a
`Authorization: Bearer …`, o cap capçalera per a l'accés públic. Un token no vàlid respon `401`
abans que s'obri el flux.

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

## Missatges

El primer esdeveniment és sempre `ready`. Després, cada canvi és un esdeveniment SSE amb el seu
nom, i el seu `data` és un objecte JSON:

| Camp | Present | Descripció |
| --- | --- | --- |
| `event` | sempre | El nom de l'esdeveniment, com a la línia SSE `event:`. |
| `uid` | sempre | L'UID del tipus de contingut, o `plugin::upload` per a multimèdia. |
| `documentId` | sempre | El document o fitxer que ha canviat. |
| `locale` | tipus localitzats | L'idioma de la versió que ha canviat. |
| `fileId` | esdeveniments de multimèdia | L'id numèric del fitxer, tal com es fa servir als camps de multimèdia. |
| `actorId` | flux de l'administració | L'administrador que ha fet el canvi, quan l'ha fet un administrador. |

| Esdeveniments | S'envien quan | Qui els rep |
| --- | --- | --- |
| `entry.create`, `entry.update`, `entry.discard-draft` | Es crea o es desa un document, o se'n descarta l'esborrany | En tipus amb esborrany i publicació, els clients amb `readDrafts` (aquests esdeveniments només canvien esborranys). En altres tipus, els clients amb `find` o `findOne`. |
| `entry.publish`, `entry.unpublish`, `entry.delete` | Es publica, es despublica o s'elimina un document | Els clients amb `find` o `findOne` sobre el tipus |
| `media.create`, `media.update`, `media.delete` | Es puja, s'edita o s'elimina un fitxer | Els clients amb `find` o `findOne` sobre la mediateca |

Els esdeveniments porten ids, no contingut. Obtén el document o el fitxer amb l'API REST o
GraphQL per llegir-lo, amb els permisos habituals del client. Els esdeveniments provenen de totes
les API: REST, GraphQL, el tauler d'administració, els llançaments i els connectors.

## Durada de la connexió

- El servidor envia un comentari de manteniment cada 15 segons.
- Un flux de contingut acaba al cap d'una hora. Torna't a connectar (l'`EventSource` dels
  navegadors ho fa sol), cosa que també torna a comprovar el token.
- Un esdeveniment anomenat `lagged`, amb `data: {"missed": 12}`, vol dir que el client ha llegit
  massa a poc a poc i s'han descartat aquests esdeveniments. Torna a obtenir el que mostra el
  client.
- No hi ha reproducció: els esdeveniments que passen mentre un client està desconnectat no
  s'envien després.

L'`EventSource` dels navegadors no pot enviar una capçalera `Authorization`. Per a l'accés públic
funciona tal qual; amb un token, fes servir `fetch` amb un lector de cos en streaming, o un
client SSE que admeti capçaleres.

## Flux de l'administració

El tauler d'administració obre el seu propi flux amb el token d'accés de l'administrador:

```
GET /admin/api/events?types=api::article
```

Porta els mateixos esdeveniments de contingut i multimèdia per als tipus que l'administrador pot
llegir (amb `content.read` i `media.read`), esborranys inclosos, i a més:

- `actorId` en els canvis fets per administradors;
- esdeveniments `presence` (a sota);
- `comment.create`, `comment.update`, `comment.delete`, `comment.resolve`,
  `comment.reopen`, `task.create`, `task.update` i `task.delete`, amb `uid`,
  `documentId` i `locale` de l'entrada.

Un flux de l'administració acaba al cap de 15 minuts, la vida d'un token d'accés: torna't a
connectar amb un de nou.

### Presència

L'editor d'entrades diu al servidor qui és en una entrada:

```
POST /admin/api/presence
{ "uid": "api::article", "documentId": "k2m7q4…", "locale": "en", "editing": true }
```

- Envia-ho aproximadament cada 20 segons mentre l'editor és obert. `editing: true` vol dir que
  l'administrador té canvis sense desar. Envia `"leave": true` quan es tanca l'editor.
- Una presència caduca 45 segons després de l'últim senyal.
- La resposta llista qui és a l'entrada: `{ "data": [{ "userId": 3, "name": "Ada Lovelace", "editing": true, "holdsLock": true }] }`.
- `GET /admin/api/presence?uid=&documentId=&locale=` llegeix la mateixa llista.
- Quan la llista canvia, els fluxos de l'administració reben un esdeveniment `presence` amb
  l'`uid`, el `documentId` i el `locale` de l'entrada i la llista a `presence`.

El primer administrador que encara edita té un bloqueig suau (`holdsLock`). L'editor el mostra
als altres, però no n'impedeix els desaments. Llegir la presència necessita `content.read` sobre
el tipus.

## Diverses instàncies

Els esdeveniments i la presència són els de la instància a què està connectat un client. Darrere
d'un balancejador de càrrega, encamina `/api/_events` i `/admin/api/events` amb sessions
persistents (sticky sessions), o connecta els clients de temps real a una sola instància.
Consulta [Escalat](/ca/deploy/scaling/).
