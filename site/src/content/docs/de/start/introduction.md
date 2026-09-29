---
title: Was ist Verdin
description: Verdin ist ein quelloffenes Headless-CMS in Rust, mit Strapi-v5-kompatiblen Content-APIs und einem Admin-Panel in einer einzigen Binärdatei.
sidebar:
  order: 1
  label: Einführung
---

Verdin ist ein quelloffenes Headless-CMS, geschrieben in Rust. Du modellierst Inhaltstypen,
deine Redaktion schreibt und veröffentlicht im Admin-Panel, und deine Websites und Apps lesen
die Inhalte über eine REST- oder GraphQL-API. Verdin rendert keine Seiten: Das übernimmt dein
Frontend.

Verdin ist eine Neuentwicklung von [Strapi v5](https://strapi.io): Schemaformat und Content-API
sind gleich aufgebaut, sodass ein Strapi-Projekt samt Frontend mit wenigen Änderungen umziehen
kann.

## Für wen es gedacht ist

- **Entwickler, die eine Website oder App bauen** und ein CMS suchen, das als ein einziger
  Prozess läuft, dessen Inhaltsmodell in Git liegt und das sich von jedem Frontend aus lesen
  lässt: Astro, Next.js, eine mobile App.
- **Teams, die Strapi nutzen** und dieselbe API mit geringerem Ressourcenbedarf wollen oder
  Funktionen brauchen, die Strapi den kostenpflichtigen Plänen vorbehält. Verdin hat keine
  Enterprise-Edition: SSO, Audit-Logs, Review-Workflows und Releases gehören zum
  Open-Source-Projekt.
- **Redakteure**, die Entwürfe, Veröffentlichung, Versionsverlauf und Vorschau in einem
  Admin-Panel bekommen, das in 18 Sprachen verfügbar ist.

## Was enthalten ist

Eine einzige ausführbare Datei, `verdin`, ist Server, Kommandozeilenwerkzeug und Admin-Panel
zugleich. In Produktion gibt es keine Node.js-Laufzeit und kein `node_modules`.

| Bereich | Was du bekommst |
| --- | --- |
| Datenbanken | PostgreSQL 14+, MySQL 8.4+, MariaDB 10.11+ und SQLite, abgedeckt von derselben Testsuite. |
| Inhaltsmodell | Collection Types, Single Types, Komponenten, Dynamic Zones, Relationen, Medien, Rich Text in Markdown oder im Blocks-Format von Strapi. Das Schema besteht aus JSON-Dateien in deinem Projekt. |
| Schemaänderungen | Jede Änderung wird zu einem Migrationsplan mit Risikostufe und exaktem SQL. Destruktive Schritte laufen nur, wenn du sie erlaubst. |
| APIs | REST unter `/api` mit den Parametern von Strapi v5 (`filters`, `populate`, `sort`, `pagination`), ein optionaler GraphQL-Endpunkt, ein OpenAPI-Dokument und ein typisierter TypeScript-Client. |
| Redaktion | Entwurf und Veröffentlichung, lokalisierte Inhalte, Versionsverlauf, Releases, Review-Workflows, Kommentare und Aufgaben, Live-Präsenz, Vorschau und visuelles Bearbeiten auf deiner eigenen Website. |
| Zugriff | Admin-Rollen bis auf Feld- und Sprachebene, API-Tokens, öffentliche Zugriffsfreigaben, SSO mit OpenID Connect, Zwei-Faktor-Anmeldung mit Passkeys, Audit-Logs. |
| Website-Funktionen | Volltextsuche, Sitemap, Weiterleitungen, Menüs und Formulare, Webhooks, Echtzeit-Updates. |
| Erweiterung | WebAssembly-Plugins, die sich in Schreibvorgänge einklinken, Routen und Jobs hinzufügen und Admin-Widgets sowie eigene Felder mitbringen, beschränkt auf die Fähigkeiten, die sie deklarieren. |

## Verhältnis zu Strapi v5

**Gleich:**

- Schemadateien verwenden das Format von Strapi: `schema/content-types/<singularName>.json` und
  `schema/components/<category>/<name>.json`.
- Die REST-Content-API: Routen, das flache Antwortformat mit `documentId`, Query-Parameter und
  Operatoren, das Verhalten beim Schreiben (ein `POST` oder `PUT` veröffentlicht, sofern du nicht
  `?status=draft` übergibst), Fehlerantworten.
- Das GraphQL-Schema ist wie das des GraphQL-Plugins von Strapi v5 aufgebaut.
- Endnutzer (Registrierung, Anmeldung, OAuth, Rollen) folgen der `users-permissions`-API.

**Anders:**

- **Schemaänderungen sind geplante Migrationen.** Verdin vergleicht die Schemadateien mit der
  Datenbank und zeigt dir die Schritte, bevor es sie ausführt. `verdin start` verweigert den
  Start, solange die Datenbank hinter dem Schema zurückliegt.
- **Der Content-Type Builder läuft nur im Entwicklungsmodus.** In Produktion kommt das Schema
  aus deinem Repository.
- **Plugins sind WebAssembly, nicht JavaScript.** Strapi-Plugins sowie eigene Controller,
  Services oder Lifecycle-Dateien in `src/` laufen in Verdin nicht.
- **Die Datenbank wird nicht mit Strapi geteilt.** Ein Strapi-Projekt holst du mit
  `verdin import strapi` herüber; dabei bekommt jedes Dokument eine neue ID.
- **Ein paar Extras gegenüber REST**: Aktionen zum Veröffentlichen und Zurückziehen
  (`POST /api/<route>/<documentId>/actions/publish`), und eine per `populate` geladene
  Komponente kommt vollständig zurück, verschachtelte Komponenten eingeschlossen.

[Kompatibilität mit Strapi](/de/migrate/compatibility/) listet die Unterschiede im Detail auf.

## Wann du es nicht verwenden solltest

- **Du bist auf Strapi-Plugins oder eigenen Servercode in JavaScript angewiesen.** Verdin kann
  sie nicht ausführen; du müsstest sie als WebAssembly-Plugins neu schreiben oder die Logik
  woandershin verlagern.
- **Du brauchst eine stabile 1.0.** Verdin steht bei 0.9: Minor-Releases können Konfiguration
  und Verhalten noch ändern. Lies vor jedem Update [Aktualisieren](/de/migrate/upgrading/).
- **Das CMS soll deine Seiten rendern.** Verdin ist headless; kombiniere es mit einem
  Frontend-Framework oder einem Static-Site-Generator.
- **Du willst einen verwalteten Dienst.** Verdin ist selbst gehostet: Du betreibst die
  Binärdatei oder das Docker-Image auf deiner eigenen Infrastruktur.

## Wie es weitergeht

- [Schnellstart](/de/start/quickstart/): Verdin starten und den ersten Eintrag über die API
  lesen.
- [Tutorial: ein Blog mit Astro](/de/start/tutorial-astro/) oder
  [mit Next.js](/de/start/tutorial-nextjs/): ein Frontend für das Beispiel-Blog bauen.
- [Inhaltsmodell](/de/concepts/content-model/): Inhaltstypen, Felder und wie sie gespeichert
  werden.
- [Ein Strapi-Projekt importieren](/de/migrate/from-strapi/): ein bestehendes Projekt
  herüberholen.
