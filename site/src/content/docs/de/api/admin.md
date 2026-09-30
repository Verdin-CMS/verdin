---
title: "Admin-API"
description: "Die API hinter dem Admin-Panel von Verdin, für Automatisierung: Anmeldung, Sitzungen, Konventionen und die wichtigsten Routengruppen."
sidebar:
  order: 4
  label: "Admin"
---

Das Admin-Panel ist ein Client der Admin-API, die unter `{admin.path}/api` bereitsteht
(standardmäßig `/admin/api`). Alles, was das Panel kann, kann auch ein Skript: Admins und
API-Tokens anlegen, Webhooks und Funktionen konfigurieren, Sprachen verwalten oder mit
Entwürfen und Releases arbeiten. Diese Seite erklärt die Authentifizierung und listet die
Routengruppen auf.

:::caution[Stabilität]
Die Admin-API hat vor Verdin 1.0 keine Stabilitätsgarantie: Routen und Request-Bodies können
sich in Minor-Releases ändern, und das Changelog nennt nicht jede Änderung. Zum Lesen und
Schreiben von Inhalten nimm lieber die [REST-](/de/api/rest/) oder die
[GraphQL-API](/de/api/graphql/) mit einem [API-Token](/de/guides/auth/api-tokens/). Ein
Stabilitätsversprechen für alle APIs ist für 1.0 geplant.
:::

## Anmelden

Die Admin-API kennt noch keine API-Tokens: Ein Skript meldet sich als Admin-Benutzer an, am
besten mit einer Rolle, die nur erlaubt, was das Skript braucht.

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

Schicke das Access-Token bei jeder weiteren Anfrage mit:

```sh title="Terminal"
curl -H "Authorization: Bearer $ACCESS_TOKEN" 'https://cms.example.com/admin/api/system/info'
```

| Zugangsdaten | Gültigkeit | Wo |
| --- | --- | --- |
| Access-Token (JWT) | 15 Minuten | Im Response-Body. Schicke es als `Authorization: Bearer …`. |
| Refresh-Token | 30 Tage | Im Cookie `verdin_refresh` (`HttpOnly`, `SameSite=Strict`, Pfad `/admin/api/auth`, `Secure` unter `verdin start`). |

Für ein neues Access-Token rufst du `POST /admin/api/auth/refresh` mit dem Cookie und einem
`X-Verdin-CSRF`-Header (beliebiger Wert) auf. Die Antwort sieht aus wie bei der Anmeldung,
und das Refresh-Token wird rotiert: Speichere das neue Cookie, denn wer ein bereits benutztes
Refresh-Token erneut vorlegt, beendet die ganze Sitzung. `POST /admin/api/auth/logout` mit
demselben Header beendet die Sitzung.

```sh title="Terminal"
curl -s -b cookies.txt -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/refresh' \
  -H 'X-Verdin-CSRF: 1'
```

- **Zwei-Faktor-Authentifizierung.** Bei einem Konto mit zweitem Faktor antwortet die
  Anmeldung mit
  `{ "data": { "twoFactorRequired": true, "twoFactorToken": "…", "methods": ["totp"] } }`.
  Schließe sie mit `POST /admin/api/auth/login/two-factor` und
  `{ "twoFactorToken": "…", "code": "123456" }` ab (ein TOTP- oder Wiederherstellungscode).
  Siehe [Zwei-Faktor-Authentifizierung](/de/guides/auth/two-factor/).
- **Rate Limits.** Anmeldung und Registrierung sind pro Client-IP durch
  `[admin].auth_rate_limit` begrenzt (standardmäßig 20 pro Minute); für Refreshes gilt ein
  größeres Budget.
- **Fehlschläge.** Falsche Zugangsdaten, unbekannte und gesperrte Konten antworten alle mit
  `400 Invalid credentials`. Fünf falsche Passwörter sperren das Konto für 15 Minuten.
- **Erster Admin.** Auf einer frischen Instanz legt `POST /admin/api/auth/register-first-admin`
  den Super Admin an; das funktioniert nur, solange noch kein Admin existiert.
  `verdin admin create` erledigt dasselbe auf der Kommandozeile.

## Konventionen

- Request- und Response-Bodies sind JSON. Antworten verpacken ihr Ergebnis in `data`
  (`{ "data": … }`); Content-Routen liefern wie die REST-API außerdem `meta`.
- Content-Routen erwarten wie die REST-API Bodies der Form `{ "data": { … } }`.
  Einstellungsrouten erwarten einfache JSON-Objekte.
- Fehler haben das [Fehlerformat der REST-API](/de/api/rest/#fehler). Eine Route einer
  deaktivierten Funktion antwortet mit `404`. Ein Admin, dessen Rolle
  Zwei-Faktor-Authentifizierung verlangt, bekommt `403 TwoFactorRequiredError`, bis er sie
  eingerichtet hat.
- Jede Route prüft die [Berechtigungen](/de/concepts/permissions/) des Admins: Content-Routen
  die Content-Aktionen auf dem Typ, Einstellungsrouten ihre jeweilige Einstellungsaktion.
- Die Admin-API beantwortet nie Cross-Origin-Anfragen: Ruf sie von einem Server oder einem
  Skript aus auf, nicht aus den Seiten einer anderen Website.
- Erfolgreiche Änderungen landen im [Audit-Log](/de/guides/content/audit-logs/).

## Listen

Einstellungslisten werden mit `page` (ab 1) und `pageSize` paginiert. Sie antworten mit den
Zeilen der Seite und den Zählungen:

```json
{ "data": [ … ], "meta": { "pagination": { "page": 2, "pageSize": 25, "total": 60, "pageCount": 3 } } }
```

| Liste | Standard-Seitengröße (Maximum) | Reihenfolge | Weitere Parameter |
| --- | --- | --- | --- |
| `GET /users`, `GET /roles`, `GET /api-tokens` | 25 (100) | Älteste zuerst | |
| `GET /webhooks` | 25 (100) | Älteste zuerst | `meta.events` listet die Events, die ein Webhook abonnieren kann |
| `GET /webhooks/{id}/deliveries` | 25 (100) | Neueste zuerst | |
| `GET /releases` | 25 (100) | Neueste zuerst | `status` (`pending`, `running`, `done`, `failed`) |
| `GET /site/redirects` | 25 (100) | Nach Quelle | `search` trifft auf die Quelle oder das Ziel |
| `GET /site/menus`, `GET /site/forms` | 25 (100) | Nach Name | |
| `GET /site/forms/{id}/submissions` | 25 (100) | Neueste zuerst | |
| `GET /deploy/targets` | 25 (100) | Älteste zuerst | |
| `GET /deploy/deployments` | 25 (100) | Neueste zuerst | `targetId`; `limit` ist ein veralteter Alias von `pageSize` |
| `GET /end-users` | 25 (100) | Neueste zuerst | `search` trifft auf den Benutzernamen oder die E-Mail |
| `GET /audit-logs` | 50 (200) | Neueste zuerst | Siehe [Audit-Logs](/de/guides/content/audit-logs/) |

Ein größeres `pageSize` wird auf das Maximum gesenkt. Um eine ganze Liste zu lesen, fordere
Seiten an, bis `page` `pageCount` erreicht:

```sh title="Terminal"
curl 'https://cms.example.com/admin/api/site/redirects?page=1&pageSize=100' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Content-Routen paginieren wie die REST-API, mit `pagination[page]` und
`pagination[pageSize]`.

## Routengruppen

Die Pfade sind relativ zu `/admin/api`. Die Router liegen in
[`crates/verdin-api/src/admin.rs`](https://github.com/Verdin-CMS/verdin/blob/main/crates/verdin-api/src/admin.rs)
und den `*_admin.rs`-Modulen daneben.

| Gruppe | Routen | Berechtigung |
| --- | --- | --- |
| Anmeldung und Konto | `GET /auth/status`, `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `GET\|PUT /users/me`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, Einladungen und Passwort-Reset unter `/auth/*` | Angemeldet (die Anmelderouten sind öffentlich) |
| Zwei-Faktor | `/auth/two-factor/*`, `POST /auth/login/two-factor`, `POST /auth/login/passkey/options`, `DELETE /users/{id}/two-factor` | Angemeldet; `users.manage`, um einen anderen Admin zurückzusetzen |
| SSO | `GET /auth/sso`, `GET /auth/sso/{id}`, `GET /auth/sso/{id}/callback` | Öffentlich |
| Admin-Benutzer | `GET\|POST /users`, `GET\|PUT\|DELETE /users/{id}`, `POST /users/{id}/invite` | `users.manage` |
| Rollen und öffentlicher Zugriff | `GET\|POST /roles`, `GET\|PUT\|DELETE /roles/{id}`, `GET\|PUT /public-permissions` | `roles.manage` |
| API-Tokens | `GET\|POST /api-tokens`, `GET\|PUT\|DELETE /api-tokens/{id}`, `POST /api-tokens/{id}/regenerate` | `tokens.manage` |
| Schema | `GET /content-types`, `GET /components`, `GET\|PUT\|DELETE /content-types/{uid}/edit-view`; `GET /schema`, `POST /schema/plan`, `POST /schema/apply` nur in `verdin dev` | Angemeldet; `views.manage` für Bearbeitungsansichten; `schema.manage` für den Builder |
| Inhalte | `GET\|POST /content/{uid}`, `GET\|PUT\|DELETE /content/{uid}/{documentId}`, `POST /content/{uid}/{documentId}/actions/{publish\|unpublish\|discard-draft}`, `POST …/clone`, `GET …/locales`, `GET …/usage`, `GET /content/{uid}/uid-available`, `GET /content/{uid}/stats` | Content-Aktionen auf `{uid}` |
| Import und Export | `GET /content/{uid}/export`, `POST /content/{uid}/import` | Content-Aktionen auf `{uid}` |
| Verlauf | `GET /history/{uid}/{documentId}`, `GET /history/versions/{id}`, `POST /history/versions/{id}/restore` | Content-Aktionen auf dem Typ |
| Releases | `GET\|POST /releases`, `GET\|PUT\|DELETE /releases/{id}`, `POST /releases/{id}/actions`, `DELETE /releases/{id}/actions/{actionId}`, `POST /releases/{id}/publish` | `releases.manage` |
| Review-Workflows | `GET\|POST /review-workflows`, `GET\|PUT\|DELETE /review-workflows/{id}`, `GET\|PUT /content/{uid}/{documentId}/review`, `GET /review/*` | `workflows.manage` zum Konfigurieren |
| Medien | `POST /upload`, `POST /upload/from-url`, `GET /upload/files`, `GET\|PUT\|DELETE /upload/files/{id}`, `POST /upload/files/{id}/replace`, `GET /upload/files/{id}/usage`, `/upload/folders…` | `media.*` |
| Sprachen | `GET\|POST /i18n/locales`, `PUT\|DELETE /i18n/locales/{code}` | `locales.manage` zum Ändern |
| Webhooks | `GET\|POST /webhooks`, `GET\|PUT\|DELETE /webhooks/{id}`, `POST\|DELETE /webhooks/{id}/secret`, `POST /webhooks/{id}/trigger`, `GET /webhooks/{id}/deliveries`, `POST /webhooks/deliveries/{id}/retry` | `webhooks.manage` |
| Endnutzer | `GET\|POST /end-users`, `GET\|PUT\|DELETE /end-users/{id}`, `GET\|POST /end-user-roles`, `PUT\|DELETE /end-user-roles/{id}` | `endusers.manage` |
| Funktionen | `GET /features`, `PUT /features/{id}`, `POST /email/test` | `features.manage` zum Ändern |
| Plugins | `GET /plugins`, `GET /plugins/extensions`, `PUT /plugins/{name}`, `GET /plugins/{name}/logs` | `plugins.manage` |
| Deploys und CDN | `/deploy/targets…`, `GET /deploy/deployments`, `GET /deploy/cdn`, `POST /deploy/cdn/purge` | `deploy.manage`; `deploy.trigger` zum Auslösen |
| Website | `/site/redirects…`, `/site/menus…`, `/site/forms…` und Formulareinsendungen | `site.manage` |
| Zusammenarbeit | `/comments…`, `/tasks…`, `/engagement/*`, `/polls…` | Lesezugriff auf den Typ des Eintrags |
| Echtzeit | `GET /events`, `GET\|POST /presence` | Siehe [Echtzeit-API](/de/api/realtime/#admin-stream) |
| KI | `GET /ai`, `POST /ai/translate`, `/ai/alt-text`, `/ai/summarize`, `/ai/seo` | Siehe [KI-Aktionen](/de/guides/integrations/ai-actions/) |
| Audit-Logs | `GET /audit-logs` | `audit.read` |
| System | `GET /system/info` (Version, Datenbank und Modus) | Angemeldet |

## Content-Routen

Die Content-Routen nutzen denselben Document Service wie die REST-API, mit Admin-Regeln:

- `{uid}` ist die UID des Inhaltstyps, etwa `api::article`.
- Lesezugriffe liefern **Entwürfe**, sofern du nicht `status=published` übergibst. Sie
  akzeptieren die [Query-Parameter](/de/api/rest/#query-parameter) der REST-API, dazu
  `unseen=true` für Dokumente, die der Admin seit ihrer letzten Änderung nicht geöffnet hat.
- Schreibzugriffe speichern nur den Entwurf. Veröffentlichen ist immer eine ausdrückliche
  Aktion.
- Schreibzugriffe halten den Admin als Ersteller oder letzten Bearbeiter fest. Feld-, Sprach-
  und `is-creator`-Einschränkungen seiner Rollen gelten für Lese- und Schreibzugriffe.

```sh title="Terminal"
curl -X PUT 'https://cms.example.com/admin/api/content/api::article/k2m7q4…?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"data":{"title":"Bonjour, Verdin"}}'
curl -X POST 'https://cms.example.com/admin/api/content/api::article/k2m7q4…/actions/publish?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```
