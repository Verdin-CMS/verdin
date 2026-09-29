---
title: Entscheidungsprotokoll
description: Die Designentscheidungen hinter Verdin, nummeriert in der Reihenfolge, in der sie getroffen wurden, jeweils mit Ergebnis und Begründung.
sidebar:
  order: 8
---

Dieses Protokoll hält die Designentscheidungen fest, die Verdin geprägt haben, in der Reihenfolge, in der sie getroffen wurden, damit du siehst, warum der Code so ist, wie er ist, bevor du eine Änderung vorschlägst. Die Einträge bleiben, wie sie geschrieben wurden, samt Namen der Meilensteine (M2–M4 sind die Meilensteine vor den ersten Releases); ein späterer Eintrag kann einen früheren präzisieren, wie 28 es für 1 tut. Füge eine neue Zeile hinzu, wenn du eine Entscheidung triffst, die sonst jemand aus dem Code rekonstruieren müsste.

| # | Entscheidung | Ergebnis | Begründung |
|---|---|---|---|
| 1 | Komponenten: JSON oder Tabellen | **JSON-Spalte** ([Speicherung](/de/internals/storage/#komponenten-und-dynamic-zones-eine-json-spalte)) | Weniger Joins, triviales Veröffentlichen und Versionieren, einfachere Migrationen. Filter auf wiederholbaren Komponenten sind selten; sie lassen sich später mit JSON-Funktionen ergänzen |
| 2 | JSON-Kodierung von `decimal` | Standardmäßig **Zahl**, `api.decimal_as_string` als Opt-in | Kompatibilität mit Strapi maximiert die Verbreitung; exakte Werte gibt es bei Bedarf |
| 3 | Admin-Formulare | **Signal Forms** | Passt zu einem Signal-first-, zonenlosen Admin-Panel; dynamische Formularbäume aus dem Schema |
| 4 | Sprache | **Englisch** für Code, Dokumentation und Commits | Reichweite als Open Source |
| 5 | REST-Kompatibilität mit Strapi | **Gleiche Parameter und gleiches Antwortformat**; Erweiterungen nur für Verdin unter `actions/` | Frontends migrieren mit minimalen Änderungen |
| 6 | JWT-Algorithmus des Admin-Panels | HS256 | Ein einziges Secret, einfach; EdDSA, falls je externe Prüfer auftauchen |
| 7 | Dokument-IDs | ULID (26 Zeichen) | Sortierbar und portabel; die IDs von Strapi sind opake Strings mit 24 Zeichen, Clients parsen sie nie |
| 8 | Inhalt des Snapshots | Physisches Modell, nicht Schema | Spätere Versionen können aus einem unveränderten Schema neue Tabellen ableiten |
| 9 | Nullable-Verhalten der Attribute | Immer nullable; `required` wird beim Veröffentlichen geprüft | Entwürfe dürfen unvollständig sein (Verhalten von Strapi v5); Pflichtfelder hinzuzufügen ist sicher |
| 10 | Durchsetzung von `unique` | Eindeutiger Index auf `(column, locale, publication_state)` | Frei von Race Conditions; Entwürfe und ihre veröffentlichte Version teilen Werte |
| 11 | Name der Zustandsspalte | `publication_state` | `state` ist ein häufiger Attributname |
| 12 | Reservierte SQL-Wörter | Bezeichner immer quoten | Keine willkürliche Sperrliste für Attributnamen |
| 13 | Bau von DML | Eigener Builder statt `sea-query` | Details pro Dialekt überwiegen (typisierte NULLs, Collations, SQLite-Formate); eine Abstraktion weniger |
| 14 | Schreibvorgänge ohne `?status=draft` | Veröffentlichen (REST-Verhalten von Strapi v5) | Drop-in-Kompatibilität für bestehende Clients |
| 15 | Textvergleich | Standardmäßig exakt auf jeder Engine; `…i`-Operatoren für schreibungsunabhängige Vergleiche | Gleiche Ergebnisse auf MySQL wie auf PostgreSQL |
| 16 | Vorläufige Zugriffskontrolle (M2–M3) | Schalter `[api].open_access`, in M4 entfernt | Standardmäßig sicher, bis es Berechtigungen gab |
| 17 | „Ziel gehört einem Dokument“ | Durchgesetzt durch Verschieben des Ziels, pro Zustand | Ein eindeutiger Index würde verbieten, dass ein Entwurf und seine veröffentlichte Version ein Ziel teilen |
| 18 | Inverse Seiten (`mappedBy`) | Schreibgeschützt | Über sie zu schreiben ist mit Entwurf und Veröffentlichung mehrdeutig (welche Version des Besitzers?) |
| 19 | Positionen von Verknüpfungen | Bei jedem Schreiben neu nummeriert 1..n | Keine Erschöpfung von Fließkommazahlen; Listen sind klein |
| 20 | Zeilen in Verknüpfungstabellen | Einen Primärschlüssel `id` behalten | Einheitliche Tabellen für die Migrations-Engine und SQLite-Neuaufbauten |
| 21 | JWT-Bibliothek | Eigenes HS256 (HMAC-SHA256, Prüfung in konstanter Zeit, `alg` fixiert) | `jsonwebtoken` 11 braucht ein Krypto-Backend, das RSA mitzieht |
| 22 | Plattformtabellen | Zusammen mit dem Inhaltsmodell abgeleitet | Ein Migrationsmechanismus für alles |
| 23 | Wiederverwendung von Refresh-Tokens | Die ganze Familie widerrufen, ohne Gnadenfrist | Einfach und streng; der Admin meldet sich erneut an |
| 24 | Entwürfe über die Content-API | Eigene Berechtigung `readDrafts` | Tokens, die veröffentlichte Inhalte lesen, geben keine Entwürfe preis |
| 25 | Reihenfolge beim Anwenden im Builder | Migrieren, dann Dateien schreiben, dann die App im laufenden Betrieb austauschen | Eine gescheiterte Migration lässt Dateien und laufende App unberührt |
| 26 | Schreibvorgänge im Admin-Panel | Nur Entwürfe speichern; Veröffentlichen ist eine ausdrückliche Aktion | Entspricht den Erwartungen der Redaktion; die Content-API behält das standardmäßige Veröffentlichen von Strapi |
| 27 | Laufzeitkonfiguration des Admin-Panels | `<meta>`-Tag, kein Inline-Skript | Hält die CSP frei von `unsafe-inline`-Skripten |
| 28 | Filter auf Komponentenfeldern | JSON-Pfad-Operatoren pro Dialekt (`#>>`, `JSON_VALUE`, `json_extract`); `EXISTS` über Array-Elemente für wiederholbare Komponenten und Dynamic Zones (0.8) | Dynamic Zones nur nach `__component`: Ihre Elemente haben unterschiedliche Felder |
| 29 | i18n des Admin-Panels | Transloco mit flachen JSON-Katalogen (`admin/public/i18n`) und ICU MessageFormat über FormatJS (ein eigener Transpiler), hinter einer kleinen `I18n`-Fassade; nicht das i18n von Angular zur Kompilierzeit | Sprachwechsel zur Laufzeit; Standarddateien für Weblate/Crowdin; FormatJS interpretiert Meldungen, die strenge CSP braucht also kein `unsafe-eval` (`@messageformat/core` kompiliert mit `new Function`); Schlüssel aus `en.json` typisiert, Vollständigkeit per `npm run i18n:check` geprüft |
| 30 | Wochenbeginn | `Intl.Locale#getWeekInfo` des regionalen Tags des Browsers (en-GB ≠ en-US), Regionstabelle als Rückfall, Überschreibung pro Benutzer | Folgt der Region jedes Benutzers, auch wenn die UI-Sprache geteilt ist |
| 31 | Speicherung des Dashboard-Layouts | JSON-Spalte `preferences` pro Benutzer in `vd_admin_users` (≤ 64 KiB) | Folgt dem Benutzer über Browser hinweg; Theme und Sprache bleiben in `localStorage`, weil sie vor der Anmeldung gelten |
| 32 | Standard für `Secure` am Refresh-Cookie | An in `start`, aus in `dev`, überschreibbar | `verdin dev` über reines HTTP funktioniert in jedem Browser; die Produktion bleibt streng |
| 33 | Release-Profil | Thin LTO, 1 Codegen-Unit, gestrippt; Unwinding bleibt erhalten | Ein Handler mit Panic darf den Server nicht mitreißen |
| 34 | „Ungesehene“ Dokumente | Zeilen in `vd_document_views` pro Benutzer, bei einer Änderung am Dokument für alle außer dem Bearbeiter gelöscht; in SQL mit `NOT EXISTS` gefiltert | Paginierung und Zählungen bleiben exakt; keine Zeitstempel pro Zeile zu vergleichen |
| 35 | Abstimmungen und Umfragen | Tabellen für die Zusammenarbeit nur im Admin-Panel (`vd_document_votes`, `vd_polls`, `vd_poll_votes`), für jeden Inhaltstyp | Vorschlagsboxen und Teamentscheidungen, ohne Abstimmungsfelder in jedem Schema zu modellieren |
| 36 | Medienspeicher | `object_store` für lokal und S3 | Ein Codepfad; streamende Multipart-Uploads; RustFS im Dev-Stack und in der CI |
| 37 | Medienverknüpfungen | Verknüpfungstabellen pro Feld wie bei Relationen | Gleiche Semantik bei Entwurf und Veröffentlichung wie bei Relationen; Kaskaden halten die Verknüpfungen konsistent |
| 38 | Upgrades eingebauter Berechtigungen | Versionsmarker in `vd_settings`, Ergänzungen einmal angewendet | Bestehende Installationen bekommen neue Berechtigungen, ohne spätere Änderungen eines Admins rückgängig zu machen |
| 39 | Laufzeitfunktionen | Katalog in `verdin-api`, Schalter in `vd_settings` (`features`), die App wird in jedem Modus an Ort und Stelle neu gebaut (ArcSwap) | Plugin-Schalter wie bei Strapi ohne Neustart; nicht verfügbare Funktionen werden mit ihrer geplanten Version aufgeführt |
| 40 | Oberfläche der API-Referenz | Scalar (`scalar_api_reference`, Bundle eingebettet) unter `{api}/docs`, nur wenn das Dokument öffentlich ist; die CSP erlaubt sein Inline-Bootstrap per Hash | Selbst gehostet (kein CDN, keine Fonts, kein KI-Agent, keine Telemetrie); das Dokument bleibt standardmäßig nur mit Token erreichbar |
| 41 | GraphQL | Dynamisches Schema mit `async-graphql`, zusammen mit der App gebaut; Argumente und Selektionen werden in den REST-Parameterbaum übersetzt und vom selben Query-Parser verarbeitet | Ein Regelwerk für Filter, Paginierung, Populate, Validierung und Berechtigungen über REST und GraphQL; ein aus der Selektion abgeleitetes Populate behält das gebündelte Laden |
| 42 | Dokument-Events | Listener am Document Service, nach dem Commit aufgerufen | Seiteneffekte (Gesehen-Markierungen, künftige Webhooks) gelten für jede API, ohne Hooks pro Handler |
