---
title: Sicherheit
description: Wie Verdin Admin-Panel, Content-API und Server schützt, welche Einstellungen eine Produktionsinstanz härten und wie du eine Schwachstelle meldest.
sidebar:
  order: 2
---

Diese Seite beschreibt, was Verdin zum Schutz eines Projekts tut, und welche Einstellungen du in
der Hand hast. Nutze sie zusammen mit der
[Checkliste für die Produktion](/de/deploy/production-checklist/), wenn du eine Instanz auf
echten Traffic vorbereitest.

## Was standardmäßig geschlossen ist

- **Die Content-API.** Anonyme Anfragen bekommen nichts, bis du unter
  **Einstellungen → Öffentlicher Zugriff** öffentliche Berechtigungen freigibst. Ein
  unbekanntes, abgelaufenes oder fehlerhaftes Token ergibt `401`, nie einen Rückfall auf die
  öffentliche Rolle. Siehe [Berechtigungen](/de/concepts/permissions/).
- **Das OpenAPI-Dokument** unter `/api/_openapi.json` braucht ein gültiges API-Token, bis du es
  unter **Einstellungen → Funktionen → API-Dokumentation** öffentlich machst.
- **Optionale Funktionen** wie GraphQL, Endnutzer, SSO und der MCP-Server bleiben aus, bis ein
  Admin mit der Berechtigung `features.manage` sie unter **Einstellungen → Funktionen**
  einschaltet.
- **Plugins** bleiben aus, bis ein Admin jedes einzeln unter **Einstellungen → Plugins**
  einschaltet.
- **Cross-Origin-Aufrufe aus dem Browser.** Kein Origin darf eine API aus dem Browser
  aufrufen, bis du ihn in `[api].cors_origins` einträgst.

## Admin-Anmeldung

| Schutz | Details |
| --- | --- |
| Passwort-Hashing | Argon2id mit OWASP-Parametern, neu gehasht, wenn sie sich ändern. |
| Sitzungen | Ein Access-Token mit 15 Minuten Gültigkeit im Speicher der Seite (nie in `localStorage`) und ein Refresh-Token mit 30 Tagen Gültigkeit in einem `HttpOnly`-, `SameSite=Strict`-Cookie, beschränkt auf `/admin/api/auth`. Das Refresh-Token rotiert bei jeder Nutzung; wer ein altes vorlegt, beendet die ganze Sitzung. |
| Sichere Cookies | Das Refresh-Cookie ist unter `verdin start` `Secure`. `[admin].secure_cookies = false` schaltet das ab und protokolliert eine Warnung. |
| CSRF | Refresh und Abmelden brauchen einen `X-Verdin-CSRF`-Header, den ein Cross-Site-Formular nicht senden kann. |
| Sperre | Fünf Fehlversuche sperren ein Konto für 15 Minuten. Fehlversuche zählen über den Passwort- und den Zwei-Faktor-Schritt hinweg. Unbekannte E-Mails und falsche Passwörter bekommen dieselbe Antwort, in derselben Zeit. |
| Rate Limit | Anmeldung, Registrierung und Refresh: `[admin].auth_rate_limit` Anfragen pro Minute und Client-Adresse (20). |
| Zweiter Faktor | Authenticator-Apps (TOTP) und Passkeys, mit Wiederherstellungscodes. Eine Rolle kann ihn verlangen (`requireTwoFactor`). Siehe [Zwei-Faktor-Authentifizierung](/de/guides/auth/two-factor/). |
| Super Admins | Nur ein Super Admin kann einen Super Admin anlegen, bearbeiten, löschen oder zurücksetzen oder diese Rolle vergeben. Der letzte aktive Super Admin lässt sich nicht entfernen. |

Der erste Admin wird über das Panel registriert, solange noch kein Admin existiert. Tu das
gleich nach dem ersten Start, oder leg ihn mit `verdin admin create --email …` an, bevor du den
Server erreichbar machst.

## Admin-Panel und Admin-API

- Die Admin-API (`/admin/api`) sendet keine CORS-Header, egal was in `[api].cors_origins`
  steht: Browser lassen nur den eigenen Origin des Panels ihre Antworten lesen.
- Das Panel wird mit einer strengen Content Security Policy ausgeliefert (Skripte nur vom
  eigenen Origin), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` und
  `Referrer-Policy: strict-origin-when-cross-origin`.
- Verdin sendet kein `Strict-Transport-Security`. Füge es am Reverse Proxy hinzu, der TLS
  terminiert.

## Content-API

- **API-Tokens** werden einmal angezeigt. Verdin speichert einen HMAC-SHA256 jedes Tokens mit
  `VERDIN_TOKEN_PEPPER` als Schlüssel und behält ein 10-stelliges Präfix zur Anzeige. Tokens
  können ablaufen und neu generiert werden.
- **Feld- und Sprachberechtigungen** begrenzen, was eine Rolle liest und schreibt, und
  `populate`, Relationsfilter und Sortierungen über Relationen erreichen nur Typen, die der
  Aufrufer lesen darf.
- **Abfragelimits**: `pageSize` bis `[api].max_page_size` (100), `populate`-Tiefe bis 5,
  höchstens 100 Filterbedingungen, Query-Strings bis 16 KB und höchstens 1.000 geladene
  Einträge pro Relation. Unbekannte oder private Felder in einer Abfrage ergeben `400`.
- **GraphQL** hat eigene Tiefen- und Komplexitätslimits (`maxDepth`, `maxComplexity`) und einen
  Schalter für Introspektion in den Einstellungen der Funktion.
- **Rate Limits**: `[api].public_rate_limit` pro Client-Adresse ohne Token und
  `[api].token_rate_limit` pro API-Token oder Endnutzer, in Anfragen pro Minute. Beide sind
  standardmäßig aus (`0`). Anfragen mit einem unbekannten Bearer-Token werden pro Adresse
  begrenzt.

### CORS

`[api].cors_origins` listet die Browser-Origins, die Content-API und GraphQL aufrufen dürfen:

```toml title="verdin.toml"
[api]
cors_origins = ["https://www.example.com", "https://preview.example.com"]
```

Jeder Eintrag hat die Form `scheme://host[:port]`, ohne Pfad und ohne abschließenden
Schrägstrich; `["*"]` erlaubt jeden Origin und lässt sich nicht mit anderen kombinieren.
Erlaubte Methoden sind `GET`, `POST`, `PUT` und `DELETE`, erlaubte Request-Header
`Authorization`, `Content-Type` und `If-None-Match`. Der Start schlägt bei einem Eintrag fehl,
der kein Origin ist.

Serverseitige Frontends (Astro, Next.js auf dem Server) rufen die API ohne Browser auf und
brauchen keinen CORS-Eintrag.

## Anfragen und Uploads

| Einstellung | Standard | Schützt vor |
| --- | --- | --- |
| `[server].body_limit` | `"1mb"` | Großen Request-Bodies auf den regulären APIs. |
| `[server].request_timeout_secs` | `30` | Langsamen Anfragen, die Verbindungen blockieren. |
| `[upload].max_file_size` | 200 MB | Großen Uploads (Uploads haben statt `body_limit` ein eigenes Limit). |
| `[upload].max_image_megapixels` | `100` | Dekompressionsbomben. |

Der Typ einer hochgeladenen Datei wird aus ihren Bytes bestimmt, nicht aus dem Typ, den der
Client schickt; der Dateiname ist nur ein Rückfall, und nie für Typen, die Browser aktiv
ausführen (solche Dateien werden als `application/octet-stream` gespeichert). Links in
Rich-Text-`blocks` müssen `http(s)`, `mailto:` oder relativ sein.

## Client-Adressen hinter einem Proxy

Rate Limits und Audit-Logs nutzen die Adresse des Clients. Hinter einem Reverse Proxy kommt
jede Anfrage vom Proxy, trag den Proxy also in `[server].trusted_proxies` ein:

```toml title="verdin.toml"
[server]
trusted_proxies = ["10.0.0.0/8"]   # the proxies' IPs or CIDR ranges
```

Verdin liest `X-Forwarded-For` dann von rechts nach links und nimmt die erste Adresse, die kein
vertrauenswürdiger Proxy ist. Anfragen von jeder anderen Adresse behalten ihre
Verbindungsadresse, ein Client kann seine Adresse also nicht fälschen, indem er den Header
selbst schickt. Trag keine Bereiche ein, aus denen sich nicht vertrauenswürdige Clients
verbinden können.

## Ausgehende Anfragen

Webhooks, Deploy-Hooks, Webhooks für CDN-Purges und Uploads von einer URL machen Anfragen, die
ein Admin auswählt. Unter `verdin start` lehnen sie Loopback-, private und Link-Local-Adressen
ab (einschließlich IPv6-Formen, die private IPv4-Adressen einbetten), sodass ein Admin sie nicht
nutzen kann, um Dienste in deinem internen Netz zu erreichen.
`[webhooks].allow_private_networks = true` hebt das auf; tu das nur, wenn du jedem Admin das
interne Netz anvertraust.

## Secrets

`VERDIN_ADMIN_JWT_SECRET` und `VERDIN_TOKEN_PEPPER` werden nur aus der Umgebung gelesen und
müssen jeweils mindestens 32 Bytes lang sein (`verdin secrets` gibt frische aus). Der Pepper
versiegelt außerdem die TOTP-Secrets der Admins und leitet den Schlüssel ab, mit dem die
Adressen von Formular-Absendern gehasht werden. Leg beide im Secret-Manager deiner Plattform ab
und committe nie eine `.env`.

Request-Logs verbergen die Werte von Query-Parametern, deren Namen nach Geheimnissen aussehen
(`token`, `code`, `password`, `key`, `signature`…), und den geheimen Teil von
Deploy-Callback-URLs.

## Metriken

`/_metrics` ist aus, solange nicht `[metrics].enabled = true` gesetzt ist. Ist es an und kein
Token gesetzt, kann jeder, der den Port erreicht, es lesen. Setze `VERDIN_METRICS_TOKEN` (oder
`[metrics].token`) und scrape mit `Authorization: Bearer <token>`, oder sperre den Pfad am
Proxy. Siehe [Monitoring](/de/deploy/monitoring/).

## Plugins

Plugins sind WebAssembly-Module, die Extism in einer Sandbox ausführt. Ein Modul hat kein
eigenes Dateisystem, kein Netzwerk und keine Datenbank: Alles läuft über Host-Funktionen, die
durch die Fähigkeiten in seiner `plugin.toml` begrenzt sind (Inhaltstypen, die es liest oder
schreibt, HTTP-Hosts, sein eigener Key-Value-Speicher), mit einem Zeit- und Speicherlimit pro
Aufruf (`[limits]`, im Beispielmanifest 5 s und 64 MB). Admins sehen, was ein Plugin verlangt,
bevor sie es einschalten. Admin-Skripte von Plugins laufen in der Seite des Panels, installiere
also nur Plugins, denen du vertraust. Siehe [Plugins](/de/extending/plugins/).

## Exporte und Backups

Archive von `verdin export` enthalten private Felder und Passwort-Hashes. Bewahre sie auf wie
Datenbank-Dumps. Siehe [Backups](/de/deploy/backups/).

## Eine Schwachstelle melden

Eröffne für ein Sicherheitsproblem kein öffentliches Issue. Folge der
[Sicherheitsrichtlinie](https://github.com/Verdin-CMS/verdin/blob/main/SECURITY.md) des
Repositorys: Melde es vertraulich über den Tab **Security** des
[Repositorys](https://github.com/Verdin-CMS/verdin/security) (**Report a vulnerability**), mit
der Version, den Schritten zum Reproduzieren und den Auswirkungen, die du siehst.
Sicherheitskorrekturen stehen im [Changelog](/de/project/changelog/) unter **Security**.
