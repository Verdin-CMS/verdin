---
title: "API d'administració"
description: "L'API que hi ha darrere del tauler d'administració de Verdin, per a automatitzacions: inici de sessió, sessions, convencions i els principals grups de rutes."
sidebar:
  order: 4
  label: "Administració"
---

El tauler d'administració és un client de l'API d'administració, servida a `{admin.path}/api`
(`/admin/api` per defecte). Tot el que fa el tauler també ho pot fer un script: crear
administradors i tokens d'API, configurar webhooks i funcionalitats, gestionar idiomes o
treballar amb esborranys i llançaments. Aquesta pàgina explica com autenticar-te i llista els
grups de rutes.

:::caution[Estabilitat]
L'API d'administració no té cap garantia d'estabilitat abans de Verdin 1.0: les rutes i els
cossos poden canviar en versions menors, i el registre de canvis no llista tots els canvis. Per
llegir i escriure contingut, fes servir preferentment l'API [REST](/ca/api/rest/) o
[GraphQL](/ca/api/graphql/) amb un [token d'API](/ca/guides/auth/api-tokens/). Hi ha previst un
contracte d'estabilitat per a totes les API a la 1.0.
:::

## Inici de sessió

L'API d'administració encara no té tokens d'API: un script inicia la sessió com a usuari
administrador, idealment un el rol del qual només permeti el que l'script necessita.

```sh title="Terminal"
curl -s -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"bot@example.com","password":"…"}'
```

```json
{
  "data": {
    "user": { "id": 3, "email": "bot@example.com", "…": "…" },
    "accessToken": "eyJhbGciOiJIUzI1NiIs…",
    "accessTokenExpiresAt": "2026-09-29T10:15:00.000Z"
  }
}
```

Envia el token d'accés a totes les altres peticions:

```sh title="Terminal"
curl -H "Authorization: Bearer $ACCESS_TOKEN" 'https://cms.example.com/admin/api/system/info'
```

| Credencial | Durada | On |
| --- | --- | --- |
| Token d'accés (JWT) | 15 minuts | El cos de la resposta. Envia'l com a `Authorization: Bearer …`. |
| Token de refresc | 30 dies | La galeta `verdin_refresh` (`HttpOnly`, `SameSite=Strict`, camí `/admin/api/auth`, `Secure` amb `verdin start`). |

Per obtenir un token d'accés nou, crida `POST /admin/api/auth/refresh` amb la galeta i una
capçalera `X-Verdin-CSRF` (qualsevol valor). Respon com un inici de sessió i renova el token de
refresc: desa la galeta nova, perquè tornar a presentar un token de refresc ja utilitzat tanca
tota la sessió. `POST /admin/api/auth/logout`, amb la mateixa capçalera, tanca la sessió.

```sh title="Terminal"
curl -s -b cookies.txt -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/refresh' \
  -H 'X-Verdin-CSRF: 1'
```

- **Autenticació de dos factors.** Per a un compte amb segon factor, l'inici de sessió respon
  `{ "data": { "twoFactorRequired": true, "twoFactorToken": "…", "methods": ["totp"] } }`.
  Completa'l amb `POST /admin/api/auth/login/two-factor` i
  `{ "twoFactorToken": "…", "code": "123456" }` (un codi TOTP o de recuperació). Consulta
  [Autenticació de dos factors](/ca/guides/auth/two-factor/).
- **Límits de freqüència.** L'inici de sessió i el registre estan limitats per IP del client
  amb `[admin].auth_rate_limit` (20 per minut per defecte); els refrescos tenen un marge més gran.
- **Errors.** Les credencials incorrectes, els comptes desconeguts i els comptes bloquejats
  responen tots `400 Invalid credentials`. Cinc contrasenyes incorrectes bloquegen el compte
  durant 15 minuts.
- **Primer administrador.** En una instància nova, `POST /admin/api/auth/register-first-admin`
  crea el Super Admin; només funciona mentre no hi hagi cap administrador. `verdin admin create`
  fa el mateix des de la línia d'ordres.

## Convencions

- Els cossos i les respostes són JSON. Les respostes embolcallen el resultat a `data`
  (`{ "data": … }`); les rutes de contingut també retornen `meta`, com l'API REST.
- Les rutes de contingut accepten cossos `{ "data": { … } }`, com l'API REST. Les rutes de
  configuració accepten objectes JSON simples.
- Els errors tenen la [forma d'error de REST](/ca/api/rest/#errors). Una ruta d'una
  funcionalitat desactivada respon `404`. Un administrador el rol del qual requereix
  autenticació de dos factors rep `403 TwoFactorRequiredError` fins que la configura.
- Cada ruta comprova els [permisos](/ca/concepts/permissions/) de l'administrador: les rutes de
  contingut, les accions de contingut sobre el tipus; les rutes de configuració, la seva acció
  de configuració.
- L'API d'administració mai no respon peticions d'un altre origen: crida-la des d'un servidor o
  un script, no des de les pàgines d'un altre lloc.
- Els canvis correctes queden enregistrats al [registre d'auditoria](/ca/guides/content/audit-logs/).

## Grups de rutes

Els camins són relatius a `/admin/api`. Els routers són a
[`crates/verdin-api/src/admin.rs`](https://github.com/Verdin-CMS/verdin/blob/main/crates/verdin-api/src/admin.rs)
i als mòduls `*_admin.rs` del costat.

| Grup | Rutes | Permís |
| --- | --- | --- |
| Inici de sessió i compte | `GET /auth/status`, `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `GET\|PUT /users/me`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, invitacions i restabliment de contrasenya a `/auth/*` | Sessió iniciada (les rutes d'inici de sessió són públiques) |
| Dos factors | `/auth/two-factor/*`, `POST /auth/login/two-factor`, `POST /auth/login/passkey/options`, `DELETE /users/{id}/two-factor` | Sessió iniciada; `users.manage` per restablir un altre administrador |
| SSO | `GET /auth/sso`, `GET /auth/sso/{id}`, `GET /auth/sso/{id}/callback` | Públic |
| Usuaris administradors | `GET\|POST /users`, `GET\|PUT\|DELETE /users/{id}`, `POST /users/{id}/invite` | `users.manage` |
| Rols i accés públic | `GET\|POST /roles`, `GET\|PUT\|DELETE /roles/{id}`, `GET\|PUT /public-permissions` | `roles.manage` |
| Tokens d'API | `GET\|POST /api-tokens`, `GET\|PUT\|DELETE /api-tokens/{id}`, `POST /api-tokens/{id}/regenerate` | `tokens.manage` |
| Esquema | `GET /content-types`, `GET /components`, `GET\|PUT\|DELETE /content-types/{uid}/edit-view`; `GET /schema`, `POST /schema/plan`, `POST /schema/apply` només a `verdin dev` | Sessió iniciada; `views.manage` per a les vistes d'edició; `schema.manage` per al constructor |
| Contingut | `GET\|POST /content/{uid}`, `GET\|PUT\|DELETE /content/{uid}/{documentId}`, `POST /content/{uid}/{documentId}/actions/{publish\|unpublish\|discard-draft}`, `POST …/clone`, `GET …/locales`, `GET …/usage`, `GET /content/{uid}/uid-available`, `GET /content/{uid}/stats` | Accions de contingut sobre `{uid}` |
| Importació i exportació | `GET /content/{uid}/export`, `POST /content/{uid}/import` | Accions de contingut sobre `{uid}` |
| Historial | `GET /history/{uid}/{documentId}`, `GET /history/versions/{id}`, `POST /history/versions/{id}/restore` | Accions de contingut sobre el tipus |
| Llançaments | `GET\|POST /releases`, `GET\|PUT\|DELETE /releases/{id}`, `POST /releases/{id}/actions`, `DELETE /releases/{id}/actions/{actionId}`, `POST /releases/{id}/publish` | `releases.manage` |
| Fluxos de revisió | `GET\|POST /review-workflows`, `GET\|PUT\|DELETE /review-workflows/{id}`, `GET\|PUT /content/{uid}/{documentId}/review`, `GET /review/*` | `workflows.manage` per configurar-los |
| Multimèdia | `POST /upload`, `POST /upload/from-url`, `GET /upload/files`, `GET\|PUT\|DELETE /upload/files/{id}`, `POST /upload/files/{id}/replace`, `GET /upload/files/{id}/usage`, `/upload/folders…` | `media.*` |
| Idiomes | `GET\|POST /i18n/locales`, `PUT\|DELETE /i18n/locales/{code}` | `locales.manage` per canviar-los |
| Webhooks | `GET\|POST /webhooks`, `GET\|PUT\|DELETE /webhooks/{id}`, `POST\|DELETE /webhooks/{id}/secret`, `POST /webhooks/{id}/trigger`, `GET /webhooks/{id}/deliveries`, `POST /webhooks/deliveries/{id}/retry` | `webhooks.manage` |
| Usuaris finals | `GET\|POST /end-users`, `GET\|PUT\|DELETE /end-users/{id}`, `GET\|POST /end-user-roles`, `PUT\|DELETE /end-user-roles/{id}` | `endusers.manage` |
| Funcionalitats | `GET /features`, `PUT /features/{id}`, `POST /email/test` | `features.manage` per canviar-les |
| Connectors | `GET /plugins`, `GET /plugins/extensions`, `PUT /plugins/{name}`, `GET /plugins/{name}/logs` | `plugins.manage` |
| Desplegaments i CDN | `/deploy/targets…`, `GET /deploy/deployments`, `GET /deploy/cdn`, `POST /deploy/cdn/purge` | `deploy.manage`; `deploy.trigger` per executar-los |
| Lloc | `/site/redirects…`, `/site/menus…`, `/site/forms…` i els enviaments de formularis | `site.manage` |
| Col·laboració | `/comments…`, `/tasks…`, `/engagement/*`, `/polls…` | Accés de lectura al tipus de l'entrada |
| Temps real | `GET /events`, `GET\|POST /presence` | Consulta l'[API de temps real](/ca/api/realtime/#flux-de-ladministració) |
| IA | `GET /ai`, `POST /ai/translate`, `/ai/alt-text`, `/ai/summarize`, `/ai/seo` | Consulta les [accions d'IA](/ca/guides/integrations/ai-actions/) |
| Registres d'auditoria | `GET /audit-logs` | `audit.read` |
| Sistema | `GET /system/info` (versió, base de dades i mode) | Sessió iniciada |

## Rutes de contingut

Les rutes de contingut executen el mateix Document Service que l'API REST, amb regles
d'administració:

- `{uid}` és l'UID del tipus de contingut, com ara `api::article`.
- Les lectures retornen **esborranys** tret que passis `status=published`. Accepten els
  [paràmetres de consulta](/ca/api/rest/#paràmetres-de-consulta) de REST, més `unseen=true` per
  als documents que l'administrador no ha obert des de l'últim canvi.
- Les escriptures només desen l'esborrany. Publicar és sempre una acció explícita.
- Les escriptures registren l'administrador com a creador o darrer editor. Les restriccions de
  camp, d'idioma i `is-creator` dels rols de l'administrador s'apliquen a lectures i escriptures.

```sh title="Terminal"
curl -X PUT 'https://cms.example.com/admin/api/content/api::article/k2m7q4…?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"data":{"title":"Bonjour, Verdin"}}'
curl -X POST 'https://cms.example.com/admin/api/content/api::article/k2m7q4…/actions/publish?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```
