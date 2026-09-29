---
title: "Permisos"
description: "La visió general del control d'accés a Verdin: rols d'administració i RBAC amb permisos per camp i per idioma, el rol públic, els tokens d'API i els rols d'usuari final."
sidebar:
  order: 6
---

Verdin controla dos públics per separat: els **administradors**, que inicien la sessió al tauler
d'administració, i els **clients de l'API de contingut**, que llegeixen i escriuen contingut des
dels teus llocs i aplicacions. Aquesta pàgina explica com s'autoritza cadascun i com encaixen
les peces. La llista completa d'accions és a la [referència de permisos](/ca/reference/permissions/).

| Qui | S'autentica amb | Els permisos provenen de | S'aplica a |
| --- | --- | --- | --- |
| Administrador | Correu electrònic i contrasenya (més un segon factor o SSO) | Els seus [rols](#rols-dadministració) | Tauler d'administració i [API d'administració](/ca/api/admin/) |
| Client anònim | Cap capçalera `Authorization` | L'[accés públic](#accés-públic) | REST, GraphQL, temps real |
| Servidor o build | `Authorization: Bearer vd_…` | El tipus del [token d'API](#tokens-dapi) | REST, GraphQL, temps real |
| Usuari final amb sessió iniciada | `Authorization: Bearer <JWT>` | El seu [rol d'usuari final](#usuaris-finals) | REST, GraphQL, temps real |

Tot està tancat per defecte: l'API de contingut respon `403` fins que concedeixes accés, i un
administrador només pot fer el que permeten els seus rols.

## Rols d'administració

Un administrador té un o més rols; els seus permisos se sumen. Hi ha tres rols integrats:

| Rol | Pot |
| --- | --- |
| **Super Admin** | Tot, inclosos usuaris, rols i tokens d'API. No es pot editar. |
| **Editor** | Llegir, crear, actualitzar, eliminar i publicar tot el contingut; fer servir la mediateca; executar desplegaments; gestionar SEO, redireccions, menús i formularis. |
| **Author** | Crear contingut, i llegir, actualitzar i eliminar només les entrades que ha creat. No pot publicar. Puja fitxers i només edita o elimina els seus. |

Crees altres rols a **Configuració → Rols** (permís `roles.manage`). L'últim Super Admin actiu
no es pot desactivar, eliminar ni degradar, de manera que la instància mai no es queda tancada.
Un rol també pot exigir als seus membres que configurin
l'[autenticació de dos factors](/ca/guides/auth/two-factor/): fins que no ho facin, només poden
accedir al seu perfil.

### Què és un permís

Un permís és una **acció**, un **subjecte** per a les accions de contingut, i **condicions**
opcionals:

- **Accions de contingut**: `content.read`, `content.create`, `content.update`,
  `content.delete` i `content.publish`, sobre un tipus de contingut (`api::article`) o sobre
  tots (`*`).
- **Accions de multimèdia**: `media.read`, `media.create`, `media.update` i `media.delete`,
  per a la mediateca.
- **Accions de configuració**, com `users.manage`, `tokens.manage`, `webhooks.manage` o
  `features.manage`, que obren les pàgines corresponents de **Configuració**.
- **Condicions**: `is-creator` limita un permís de contingut o de multimèdia al que ha creat
  l'administrador. Així funciona el rol Author.

Les condicions passen a formar part de la consulta a la base de dades: una llista filtrada per
`is-creator` compta i pagina correctament, en lloc d'amagar files a posteriori.

### Permisos per camp i per idioma

Els permisos de contingut es poden restringir encara més:

- **Camps.** `content.read`, `content.create` i `content.update` poden llistar els atributs que
  cobreixen. Els camps fora de la llista s'amaguen a les lectures (incloses la cerca, els
  filtres, l'ordenació i les entrades relacionades) i es rebutgen a les escriptures.
- **Idiomes.** Als [tipus localitzats](/ca/concepts/internationalization/), els permisos de
  contingut poden llistar els idiomes que cobreixen. Les versions en altres idiomes no es poden
  llegir ni canviar.

Tots dos es defineixen per tipus de contingut a l'editor del rol, a **Camps** i **Idiomes**.

## API de contingut

Els clients de l'API de contingut es comproven amb permisos: una **acció** sobre un
**subjecte**.

| Acció | Permet |
| --- | --- |
| `find` | Llistar documents (`GET /api/articles`), o llegir un tipus únic. |
| `findOne` | Llegir un document (`GET /api/articles/{documentId}`). |
| `create` | `POST` |
| `update` | `PUT` |
| `delete` | `DELETE` |
| `publish` | Les rutes `actions/publish`, `actions/unpublish` i `actions/discard-draft`. |
| `readDrafts` | Llegir amb `status=draft`. |

Els subjectes són els tipus de contingut, la mediateca (`plugin::upload`) i els comptes d'usuari
final (`plugin::users-permissions.user`) quan els [usuaris finals](/ca/guides/auth/end-users/)
estan activats.

Unes quantes regles valen per a tots els clients:

- Llegir esborranys necessita `readDrafts` a més de `find` o `findOne`. Un permís que llegeix el
  contingut del teu lloc no pot llegir per error la feina no publicada.
- Poblar, filtrar o ordenar a través d'una relació necessita accés de lectura al tipus de
  destinació.
- Els camps `private` mai no es retornen, siguin quins siguin els permisos.
- Una escriptura retorna el document escrit fins i tot sense `find`, com a Strapi.
- Els mateixos permisos s'apliquen a [GraphQL](/ca/api/graphql/) i al
  [flux en temps real](/ca/api/realtime/).

### Accés públic

Les peticions sense capçalera `Authorization` reben els permisos de **Configuració → Accés
públic**. Per defecte no es concedeix res. El més habitual és `find` i `findOne` sobre els tipus
que mostra el teu lloc.

### Tokens d'API

Els tokens d'API són per a servidors, passos de build i scripts. Crea'ls a
**Configuració → Tokens d’API** (permís `tokens.manage`):

| Tipus | Permisos |
| --- | --- |
| **Només lectura** | `find` i `findOne` sobre tots els tipus. Mai esborranys. |
| **Accés complet** | Totes les accions sobre tots els tipus, esborranys inclosos. |
| **Personalitzat** | Els permisos que triïs, com l'accés públic. |

- Un token comença per `vd_`. El seu secret es mostra un sol cop, quan es crea o es regenera;
  Verdin només en desa un hash amb clau.
- Els tokens poden caducar. Un token desconegut, caducat o mal format és un `401`: mai no torna a
  l'accés públic.
- Qualsevol token vàlid pot llegir el document OpenAPI a `/api/_openapi.json`, tret que facis
  pública la documentació.

Consulta [Tokens d'API](/ca/guides/auth/api-tokens/) per crear-los i renovar-los.

### Usuaris finals

Els usuaris finals són les persones que inicien la sessió al teu lloc o aplicació, com amb el
connector users-permissions de Strapi. La funcionalitat està desactivada per defecte. Cada compte
té un rol:

- **Public** és el rol de les peticions sense token: els seus permisos són els de
  **Configuració → Accés públic**.
- **Authenticated** s'assigna per defecte als comptes nous.
- Els rols personalitzats contenen qualsevol conjunt de permisos, amb les mateixes accions
  d'abans.

Un usuari final envia el JWT que ha obtingut en iniciar la sessió com a
`Authorization: Bearer <jwt>`. Verdin el distingeix dels tokens d'API pel prefix `vd_`. Consulta
[Usuaris finals](/ca/guides/auth/end-users/).

## Comparació amb Strapi

El model segueix Strapi v5: RBAC d'administració amb condicions `is-creator`, i una API de
contingut amb accés públic, tokens d'API i rols de users-permissions. Les diferències:

- Totes les funcionalitats estan disponibles per a tots els projectes: rols personalitzats,
  permisos per camp i per idioma, [SSO](/ca/guides/auth/sso/) i
  [registres d'auditoria](/ca/guides/content/audit-logs/).
- Llegir esborranys per l'API de contingut és un permís propi, `readDrafts`.
- Publicar per REST té el seu propi permís, `publish`, i les seves pròpies rutes.
