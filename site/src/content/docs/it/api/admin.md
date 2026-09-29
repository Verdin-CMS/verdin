---
title: "API admin"
description: "L'API dietro il pannello di amministrazione di Verdin, per l'automazione: accesso, sessioni, convenzioni e i principali gruppi di route."
sidebar:
  order: 4
  label: "Admin"
---

Il pannello di amministrazione è un client dell'API admin, servita sotto `{admin.path}/api`
(`/admin/api` di default). Tutto ciò che fa il pannello può farlo anche uno script: creare
admin e token API, configurare webhook e funzionalità, gestire le lingue, o lavorare con
bozze e rilasci. Questa pagina spiega come autenticarsi ed elenca i gruppi di route.

:::caution[Stabilità]
L'API admin non ha garanzie di stabilità prima di Verdin 1.0: route e corpi possono cambiare
nelle release minori, e il changelog non elenca ogni modifica. Per leggere e scrivere
contenuti, preferisci l'API [REST](/it/api/rest/) o [GraphQL](/it/api/graphql/) con un
[token API](/it/guides/auth/api-tokens/). Un contratto di stabilità per tutte le API è
previsto per la 1.0.
:::

## Accesso

L'API admin non ha ancora token API: uno script accede come utente admin, idealmente uno il
cui ruolo consente solo ciò che serve allo script.

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

Invia l'access token in ogni altra richiesta:

```sh title="Terminal"
curl -H "Authorization: Bearer $ACCESS_TOKEN" 'https://cms.example.com/admin/api/system/info'
```

| Credenziale | Durata | Dove |
| --- | --- | --- |
| Access token (JWT) | 15 minuti | Il corpo della risposta. Invialo come `Authorization: Bearer …`. |
| Refresh token | 30 giorni | Il cookie `verdin_refresh` (`HttpOnly`, `SameSite=Strict`, path `/admin/api/auth`, `Secure` sotto `verdin start`). |

Per ottenere un nuovo access token, chiama `POST /admin/api/auth/refresh` con il cookie e un
header `X-Verdin-CSRF` (qualsiasi valore). Risponde come un login e ruota il refresh token:
salva il nuovo cookie, perché presentare di nuovo un refresh token già usato chiude l'intera
sessione. `POST /admin/api/auth/logout`, con lo stesso header, chiude la sessione.

```sh title="Terminal"
curl -s -b cookies.txt -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/refresh' \
  -H 'X-Verdin-CSRF: 1'
```

- **Autenticazione a due fattori.** Per un account con un secondo fattore, il login risponde
  `{ "data": { "twoFactorRequired": true, "twoFactorToken": "…", "methods": ["totp"] } }`.
  Completalo con `POST /admin/api/auth/login/two-factor` e
  `{ "twoFactorToken": "…", "code": "123456" }` (un codice TOTP o di recupero). Vedi
  [Autenticazione a due fattori](/it/guides/auth/two-factor/).
- **Limiti di frequenza.** Login e registrazione sono limitati per IP del client da
  `[admin].auth_rate_limit` (20 al minuto di default); i refresh hanno un budget più ampio.
- **Errori.** Credenziali errate, account sconosciuti e account bloccati rispondono tutti
  `400 Invalid credentials`. Cinque password errate bloccano l'account per 15 minuti.
- **Primo admin.** Su un'istanza nuova, `POST /admin/api/auth/register-first-admin` crea il
  Super Admin; funziona solo finché non esiste nessun admin. `verdin admin create` fa lo
  stesso dalla riga di comando.

## Convenzioni

- Corpi e risposte sono JSON. Le risposte racchiudono il risultato in `data`
  (`{ "data": … }`); le route dei contenuti restituiscono anche `meta`, come l'API REST.
- Le route dei contenuti accettano corpi `{ "data": { … } }`, come l'API REST. Le route
  delle impostazioni accettano oggetti JSON semplici.
- Gli errori hanno la [forma degli errori REST](/it/api/rest/#errori). Una route di una
  funzionalità disattivata risponde `404`. Un admin il cui ruolo richiede l'autenticazione a
  due fattori riceve `403 TwoFactorRequiredError` finché non la configura.
- Ogni route verifica i [permessi](/it/concepts/permissions/) dell'admin: le route dei
  contenuti le azioni sui contenuti del tipo, le route delle impostazioni la relativa azione
  di impostazione.
- L'API admin non risponde mai a richieste cross-origin: chiamala da un server o da uno
  script, non dalle pagine di un altro sito.
- Le modifiche riuscite vengono registrate nel [log di audit](/it/guides/content/audit-logs/).

## Gruppi di route

I path sono relativi a `/admin/api`. I router sono in
[`crates/verdin-api/src/admin.rs`](https://github.com/Verdin-CMS/verdin/blob/main/crates/verdin-api/src/admin.rs)
e nei moduli `*_admin.rs` accanto.

| Gruppo | Route | Permesso |
| --- | --- | --- |
| Accesso e account | `GET /auth/status`, `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `GET\|PUT /users/me`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, inviti e reimpostazione della password sotto `/auth/*` | Autenticato (le route di accesso sono pubbliche) |
| Due fattori | `/auth/two-factor/*`, `POST /auth/login/two-factor`, `POST /auth/login/passkey/options`, `DELETE /users/{id}/two-factor` | Autenticato; `users.manage` per reimpostare un altro admin |
| SSO | `GET /auth/sso`, `GET /auth/sso/{id}`, `GET /auth/sso/{id}/callback` | Pubblico |
| Utenti admin | `GET\|POST /users`, `GET\|PUT\|DELETE /users/{id}`, `POST /users/{id}/invite` | `users.manage` |
| Ruoli e accesso pubblico | `GET\|POST /roles`, `GET\|PUT\|DELETE /roles/{id}`, `GET\|PUT /public-permissions` | `roles.manage` |
| Token API | `GET\|POST /api-tokens`, `GET\|PUT\|DELETE /api-tokens/{id}`, `POST /api-tokens/{id}/regenerate` | `tokens.manage` |
| Schema | `GET /content-types`, `GET /components`, `GET\|PUT\|DELETE /content-types/{uid}/edit-view`; `GET /schema`, `POST /schema/plan`, `POST /schema/apply` solo in `verdin dev` | Autenticato; `views.manage` per le viste di modifica; `schema.manage` per il costruttore |
| Contenuti | `GET\|POST /content/{uid}`, `GET\|PUT\|DELETE /content/{uid}/{documentId}`, `POST /content/{uid}/{documentId}/actions/{publish\|unpublish\|discard-draft}`, `POST …/clone`, `GET …/locales`, `GET …/usage`, `GET /content/{uid}/uid-available`, `GET /content/{uid}/stats` | Azioni sui contenuti di `{uid}` |
| Import ed export | `GET /content/{uid}/export`, `POST /content/{uid}/import` | Azioni sui contenuti di `{uid}` |
| Cronologia | `GET /history/{uid}/{documentId}`, `GET /history/versions/{id}`, `POST /history/versions/{id}/restore` | Azioni sui contenuti del tipo |
| Rilasci | `GET\|POST /releases`, `GET\|PUT\|DELETE /releases/{id}`, `POST /releases/{id}/actions`, `DELETE /releases/{id}/actions/{actionId}`, `POST /releases/{id}/publish` | `releases.manage` |
| Flussi di revisione | `GET\|POST /review-workflows`, `GET\|PUT\|DELETE /review-workflows/{id}`, `GET\|PUT /content/{uid}/{documentId}/review`, `GET /review/*` | `workflows.manage` per configurare |
| Media | `POST /upload`, `POST /upload/from-url`, `GET /upload/files`, `GET\|PUT\|DELETE /upload/files/{id}`, `POST /upload/files/{id}/replace`, `GET /upload/files/{id}/usage`, `/upload/folders…` | `media.*` |
| Lingue | `GET\|POST /i18n/locales`, `PUT\|DELETE /i18n/locales/{code}` | `locales.manage` per modificare |
| Webhook | `GET\|POST /webhooks`, `GET\|PUT\|DELETE /webhooks/{id}`, `POST\|DELETE /webhooks/{id}/secret`, `POST /webhooks/{id}/trigger`, `GET /webhooks/{id}/deliveries`, `POST /webhooks/deliveries/{id}/retry` | `webhooks.manage` |
| Utenti finali | `GET\|POST /end-users`, `GET\|PUT\|DELETE /end-users/{id}`, `GET\|POST /end-user-roles`, `PUT\|DELETE /end-user-roles/{id}` | `endusers.manage` |
| Funzionalità | `GET /features`, `PUT /features/{id}`, `POST /email/test` | `features.manage` per modificare |
| Plugin | `GET /plugins`, `GET /plugins/extensions`, `PUT /plugins/{name}`, `GET /plugins/{name}/logs` | `plugins.manage` |
| Deploy e CDN | `/deploy/targets…`, `GET /deploy/deployments`, `GET /deploy/cdn`, `POST /deploy/cdn/purge` | `deploy.manage`; `deploy.trigger` per avviare |
| Sito | `/site/redirects…`, `/site/menus…`, `/site/forms…` e invii dei form | `site.manage` |
| Collaborazione | `/comments…`, `/tasks…`, `/engagement/*`, `/polls…` | Accesso in lettura al tipo della voce |
| Tempo reale | `GET /events`, `GET\|POST /presence` | Vedi [API realtime](/it/api/realtime/#stream-admin) |
| AI | `GET /ai`, `POST /ai/translate`, `/ai/alt-text`, `/ai/summarize`, `/ai/seo` | Vedi [Azioni IA](/it/guides/integrations/ai-actions/) |
| Log di audit | `GET /audit-logs` | `audit.read` |
| Sistema | `GET /system/info` (versione, database e modalità) | Autenticato |

## Route dei contenuti

Le route dei contenuti usano lo stesso Document Service dell'API REST, con regole admin:

- `{uid}` è l'UID del tipo di contenuto, come `api::article`.
- Le letture restituiscono le **bozze** a meno che tu non passi `status=published`.
  Accettano i [parametri di query](/it/api/rest/#parametri-di-query) REST, più
  `unseen=true` per i documenti che l'admin non ha aperto dall'ultima modifica.
- Le scritture salvano solo la bozza. La pubblicazione è sempre un'azione esplicita.
- Le scritture registrano l'admin come autore o ultimo editor. Le restrizioni su campi,
  lingue e `is-creator` dei ruoli dell'admin si applicano a letture e scritture.

```sh title="Terminal"
curl -X PUT 'https://cms.example.com/admin/api/content/api::article/k2m7q4…?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"data":{"title":"Bonjour, Verdin"}}'
curl -X POST 'https://cms.example.com/admin/api/content/api::article/k2m7q4…/actions/publish?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```
