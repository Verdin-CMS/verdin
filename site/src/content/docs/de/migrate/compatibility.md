---
title: Kompatibilität mit Strapi
description: Welche Funktionen und APIs von Strapi v5 Verdin unterstützt, teilweise unterstützt oder nicht unterstützt – REST, GraphQL, Benutzer und Berechtigungen, Uploads, i18n, Entwurf und Veröffentlichung, Code-Erweiterungen, das Admin-Panel und Enterprise-Funktionen.
sidebar:
  order: 2
---

Verdin behält das Inhaltsmodell und die Content-APIs von Strapi v5 bei, damit Frontends und
Inhalte umziehen können (siehe [Von Strapi migrieren](/de/migrate/from-strapi/)). Es ist kein
Drop-in-Ersatz für eine Strapi-*Codebasis*: Es gibt keine JavaScript-Laufzeit, eigener Code wird
also als WebAssembly-Plugins neu gebaut. Diese Seite listet jeden Bereich mit seinem Status,
Stand Verdin 0.10.0.

**Unterstützt** funktioniert wie in Strapi v5 (Unterschiede sind vermerkt). **Teilweise** deckt
die üblichen Fälle ab; der Hinweis sagt, was fehlt. **Nicht unterstützt** hat kein Gegenstück.

## Inhaltsmodell

| Funktion | Status | Hinweise |
| --- | --- | --- |
| Collection Types und Single Types | Unterstützt | JSON-Schemadateien nah an denen von Strapi (`schema/content-types/*.json`). Siehe [Inhaltsmodell](/de/concepts/content-model/). |
| Skalare Attributtypen | Unterstützt | `string`, `text`, `richtext` (Markdown), `blocks`, `email`, `uid`, `integer`, `biginteger`, `float`, `decimal`, `boolean`, `date`, `time`, `datetime`, `enumeration`, `json`, `password`. `timestamp` von Strapi wird als `datetime` importiert. |
| Komponenten und Dynamic Zones | Unterstützt | Einschließlich Medien und `oneWay`/`manyWay`-Relationen in Komponenten. |
| Relationen | Unterstützt | One/many-to-one/many, one-way und many-way sowie polymorphe `morphToOne`, `morphToMany`, `morphOne`, `morphMany`. |
| Medienfelder | Unterstützt | Einzeln oder mehrfach, `allowedTypes`. |
| `unique` | Teilweise | Nicht bei Attributen vom Typ `text`, `richtext`, `blocks` und `json`. |
| Bedingte Felder (`conditions`) | Unterstützt | Die JSON-Logic-Bedingungen von Strapi 5.17; ausgeblendete Felder sind nicht Pflicht. |
| Benutzerdefinierte Felder | Teilweise | `customField`-Attribute funktionieren; das Eingabefeld im Admin-Panel kommt von einem Verdin-[Plugin](/de/extending/plugins/), nicht von den React-Plugins von Strapi. |
| Content-Type Builder | Unterstützt | Nur im Entwicklungsmodus (`verdin dev`), wie bei Strapi. |

## REST-API

| Funktion | Status | Hinweise |
| --- | --- | --- |
| CRUD-Routen | Unterstützt | `GET`/`POST /api/{pluralName}`, `GET`/`PUT`/`DELETE /api/{pluralName}/{documentId}`, Single Types unter `/api/{singularName}`. Antworten enthalten `data` und `meta`, Fehler das `error`-Objekt von Strapi. |
| `filters` | Unterstützt | Jeder Operator von Strapi: `$eq`, `$eqi`, `$ne`, `$nei`, `$lt`, `$lte`, `$gt`, `$gte`, `$in`, `$notIn`, `$contains`, `$notContains`, `$containsi`, `$notContainsi`, `$null`, `$notNull`, `$between`, `$startsWith(i)`, `$endsWith(i)`, `$and`, `$or`, `$not`; über Relationen, Komponenten, wiederholbare Komponenten und Dynamic Zones (`__component`). |
| `sort` | Unterstützt | Mehrere Felder, `:asc`/`:desc` und das Feld einer To-one-Relation (`author.name:asc`). |
| `pagination` | Unterstützt | `page`/`pageSize` oder `start`/`limit`, `withCount`. `pageSize` ist auf `[api].max_page_size` (100) begrenzt. |
| `fields` | Unterstützt | |
| `populate` | Unterstützt | `*`, Listen, verschachtelte Objekte, `on` für Dynamic Zones, `count`. Tiefe bis 5; höchstens 1.000 geladene Einträge pro Relation. |
| `status` | Unterstützt | `published` (Standard) oder `draft`; Entwürfe zu lesen braucht die Berechtigung `readDrafts`. |
| `locale` | Unterstützt | Siehe i18n unten. |
| `hasPublishedVersion` | Unterstützt | |
| Volltextsuche `_q` | Unterstützt | `$containsi` über Textfelder, wie bei Strapi; nach Relevanz sortierte Suche mit `[search]`. |
| Schreiben von Relationen | Unterstützt | IDs, `connect` / `disconnect` / `set`, mit `position` (`before`, `after`, `start`, `end`). |
| Veröffentlichen, zurückziehen, Entwurf verwerfen | Unterstützt | Schreibvorgänge veröffentlichen, sofern nicht `?status=draft`, wie in Strapi v5. Verdin ergänzt `POST /api/{pluralName}/{documentId}/actions/{publish,unpublish,discard-draft}`. |
| Antwortformat von Strapi v4 und `publicationState` | Nicht unterstützt | Verdin spricht nur v5: flache Attribute, `documentId`, `status`. |
| OpenAPI-Dokument | Teilweise | Unter `/api/_openapi.json` (standardmäßig nur mit Token) und eine interaktive Referenz unter `/api/docs`, statt `/documentation` des Documentation-Plugins. |

## GraphQL

| Funktion | Status | Hinweise |
| --- | --- | --- |
| Queries | Unterstützt | `articles`, `articles_connection` mit `pageInfo`, `article(documentId)`, Single Types; `filters`, `sort`, `pagination`, `status`, `locale`. Aus, bis du **Einstellungen → Funktionen → GraphQL** einschaltest. |
| Mutations | Unterstützt | `create…`, `update…`, `delete…` mit `status` und `locale`. |
| Komponenten, Dynamic Zones, Medien | Unterstützt | Dynamic Zones als Unions, Medien als `UploadFile`. |
| Polymorphe Relationen | Teilweise | Als JSON geliefert, nicht als typisierte Unions. |
| Shadow CRUD (Operationen pro Typ abschalten) | Unterstützt | Die Einstellung `disabled` der Funktion. |
| Eigene Resolver und Schemaerweiterungen | Teilweise | Root-Felder, die Plugins auflösen (`[[graphql]]` in `plugin.toml`); kein `extensionService`. |
| Mutations von Users & Permissions (`login`, `register`, `me`…) | Nicht unterstützt | Nutze die REST-Routen. |
| Queries/Mutations für Upload und i18n (`uploadFiles`, `i18NLocales`…) | Nicht unterstützt | Nutze die REST-Routen und das Admin-Panel. |
| Limits, GraphiQL | Unterstützt | `maxDepth`, `maxComplexity`, Schalter für Introspektion und Playground. |

## Users & Permissions (Endnutzer)

Schalte **Einstellungen → Funktionen → Benutzer und Berechtigungen** ein. Siehe
[Endnutzer](/de/guides/auth/end-users/).

| Funktion | Status | Hinweise |
| --- | --- | --- |
| `POST /api/auth/local`, `/auth/local/register` | Unterstützt | Gleiche Request- und Response-Formate. |
| E-Mail-Bestätigung, Passwort vergessen/zurücksetzen/ändern | Unterstützt | `/auth/email-confirmation`, `/auth/send-email-confirmation`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/change-password`. |
| Refresh-Tokens | Unterstützt | `jwtManagement: "refresh"`, `/auth/refresh`, `/auth/logout`. |
| `/api/users`, `/users/me`, `/users/count` | Unterstützt | Einfaches JSON, Berechtigungen auf `plugin::users-permissions.user`. |
| OAuth-Anbieter | Teilweise | GitHub, Google, Microsoft, Discord, Facebook, GitLab, LinkedIn und jeder OAuth-2-Anbieter; nicht jede Voreinstellung von Strapi. |
| Routen für Rollen und Berechtigungen (`/api/users-permissions/roles`, `/permissions`) | Nicht unterstützt | Verwalte Rollen unter **Einstellungen → Endnutzer**. |
| Importierte Benutzer | Unterstützt | bcrypt-Hashes funktionieren weiter; sie werden bei der Anmeldung mit Argon2id neu gehasht. |

## Medienbibliothek und Upload-API

| Funktion | Status | Hinweise |
| --- | --- | --- |
| `POST /api/upload` | Unterstützt | Multipart `files` und `fileInfo`; `?id=` aktualisiert die Informationen einer Datei oder ersetzt die Datei, wenn eine mitgeschickt wird. |
| Verknüpfen beim Upload (`ref`, `refId`, `field`) | Nicht unterstützt | Lade hoch und setze dann das Medienfeld mit der Datei-ID. |
| `GET /api/upload/files`, `/files/{id}`, `DELETE /files/{id}` | Teilweise | Die Auflistung akzeptiert nur `pagination[page]`, `pagination[pageSize]`, `sort` und `filters[name][$containsi]`. |
| Responsive Formate, Breakpoints | Unterstützt | `thumbnail` plus `[upload].breakpoints`. |
| Ordner, Fokuspunkte, Alternativtext, Bildunterschriften | Unterstützt | |
| Upload-Provider | Teilweise | Lokale Festplatte und S3-kompatibler Speicher (AWS, R2, B2, MinIO, Tigris…). Keine Pakete für Cloudinary oder andere Provider. |
| Bildtransformationen | Nur Verdin | `/uploads/<file>?preset=…` und signierte URLs (lokaler Provider). |

## Internationalisierung

| Funktion | Status | Hinweise |
| --- | --- | --- |
| Lokalisierte Typen und nicht lokalisierte Felder | Unterstützt | `pluginOptions.i18n.localized`, auch pro Attribut. |
| `?locale=` bei REST, `locale` in GraphQL | Unterstützt | Eine unbekannte Sprache ergibt `400`. |
| `localizations` in Antworten | Nicht unterstützt | Lies eine andere Sprache mit derselben `documentId` und `?locale=`. |
| `GET /api/i18n/locales` | Nicht unterstützt | Sprachen werden im Admin-Panel verwaltet (**Einstellungen → Internationalisierung**). |

## Entwurf und Veröffentlichung

| Funktion | Status | Hinweise |
| --- | --- | --- |
| Entwurfs- und veröffentlichte Version pro Dokument | Unterstützt | Pro Sprache. Siehe [Entwurf und Veröffentlichung](/de/concepts/draft-and-publish/). |
| Entwurf verwerfen | Unterstützt | |
| Geplantes Veröffentlichen | Unterstützt | Über [Releases](/de/guides/content/releases/). |

## Anpassungen am Server

| Strapi | Status | Verdin |
| --- | --- | --- |
| Lifecycle-Hooks, Middlewares des Document Service | Teilweise | Before-/After-Hooks in WebAssembly-Plugins, die einen Schreibvorgang ändern oder ablehnen können. Kein JavaScript. |
| Eigene Controller, Services, Routen | Teilweise | Plugin-Routen unter `/api/plugins/<name>/`. |
| Policies und Middlewares | Nicht unterstützt | Berechtigungen und Rate Limits sind eingebaut. |
| Cron-Tasks | Teilweise | Plugin-Jobs. |
| Document Service / Entity Service in JavaScript | Nicht unterstützt | Keine JavaScript-Laufzeit. |
| npm-Plugins aus dem Strapi-Marketplace | Nicht unterstützt | |
| Webhooks | Unterstützt | Signiert, wiederholt und protokolliert; `entry.draft-discard` heißt `entry.discard-draft`. Siehe [Webhooks](/de/guides/integrations/webhooks/). |
| API-Tokens (read-only, full access, custom) | Unterstützt | Gleiche Arten, optionaler Ablauf, Neugenerierung. |
| Transfer-Tokens, `strapi transfer` | Nicht unterstützt | Nutze `verdin export` und `verdin import verdin`. |
| Dateien von `strapi export` | Unterstützt (Import) | `verdin import strapi`; verschlüsselte Exporte werden nicht gelesen. |
| `config/*.js`, `.env` | Teilweise | `verdin.toml` und Umgebungsvariablen. |
| TypeScript-Typen | Unterstützt | `verdin types`. |
| E-Mail-Provider | Teilweise | SMTP, Resend und Postmark. |

## Admin-Panel

| Funktion | Status | Hinweise |
| --- | --- | --- |
| Content Manager, Medienbibliothek, Content-Type Builder | Unterstützt | Ein eigenes Angular-Panel, nicht das React-Admin von Strapi. |
| Admin-Benutzer, Rollen, eigene Rollen | Unterstützt | Super Admin, Editor und Author eingebaut, dazu eigene Rollen. |
| Berechtigungen auf Feld- und Sprachebene | Unterstützt | |
| RBAC-Bedingungen | Teilweise | Nur die eingebaute Bedingung `is-creator`; keine eigenen Bedingungen. |
| Anpassung des Admin-Panels (`src/admin/app`) | Teilweise | Logo, Favicon, Titel, Akzentfarbe und Texte in `[admin.branding]`; Widgets und benutzerdefinierte Felder aus Plugins. Keine eigenen Seiten, Injection Zones oder React-Erweiterungen. |
| Admin-API (`/admin/…`) | Nicht unterstützt | Die Admin-API von Verdin ist eine eigene; bau nicht auf der von Strapi auf. |
| Konfiguration von Bearbeitungs- und Listenansicht | Unterstützt | |

## Enterprise-Funktionen

In Verdin ist alles Open Source; in Strapi sind dies Enterprise- oder kostenpflichtige
Funktionen.

| Funktion in Strapi | Status | Hinweise |
| --- | --- | --- |
| SSO | Teilweise | OpenID-Connect-Anbieter, mit Zuordnung von Gruppen zu Rollen. Kein SAML und keine anderen Passport-Strategien. Siehe [Single Sign-on](/de/guides/auth/sso/). |
| Audit-Logs | Unterstützt | Siehe [Audit-Logs](/de/guides/content/audit-logs/). |
| Review-Workflows | Unterstützt | Rollen pro Phase begrenzen, wer Einträge *in* eine Phase verschiebt, und eine erforderliche Phase zum Veröffentlichen gilt für jede API. Siehe [Review-Workflows](/de/guides/content/review-workflows/). |
| Releases | Unterstützt | Geplant oder sofort. |
| Inhaltsverlauf | Unterstützt | `[history].max_versions` Versionen pro Dokument. |
| Vorschau und Live-Vorschau | Unterstützt | Vorschau-URLs mit kurzlebigen Tokens, Nebeneinander-Vorschau und [visuelles Bearbeiten](/de/guides/frontend/visual-editing/). |
| Eigene Admin-Rollen | Unterstützt | Ohne Begrenzung ihrer Zahl. |
