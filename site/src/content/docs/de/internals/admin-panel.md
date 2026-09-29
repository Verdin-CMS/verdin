---
title: Admin-Panel
description: Wie das Angular-Admin-Panel von Verdin aufgebaut ist, wie es Formulare und Listen aus dem Schema erzeugt und wie es gebaut, in die Binärdatei eingebettet und übersetzt wird.
sidebar:
  order: 6
  label: Admin-Panel
---

Diese Seite richtet sich an Mitwirkende am Admin-Panel in `admin/`: wie die Angular-App organisiert ist, wie sie das Content-Schema in Formulare und Listen verwandelt und wie sie in der Binärdatei `verdin` landet. Wie man das Panel benutzt, beschreiben die Anleitungen; wie die Serverseite der Admin-API funktioniert, steht in der [Referenz der Admin-API](/de/api/admin/).

Das Panel ist eine Single-Page-App mit Angular 22: Standalone-Komponenten, zonenlose Change Detection, Signals, lazy geladene Routen und spartan/ui-Komponenten auf Tailwind CSS v4.

## Struktur

```text
admin/
├── src/app/
│   ├── app.config.ts     # providers: router, HttpClient interceptors, Transloco, icons
│   ├── app.routes.ts     # lazy routes, guards (auth, permissions, unsaved changes)
│   ├── core/             # services and pure models: api, auth, schema, i18n, permissions…
│   ├── layout/           # the shell (sidebar, header), home, deploy button
│   ├── features/
│   │   ├── auth/         # login, first admin, invitations, password reset
│   │   ├── dashboard/    # home widgets
│   │   ├── content/      # lists, the entry editor, history, releases, review, import
│   │   │   ├── fields/   # schema-driven form controls and the form model
│   │   │   └── collab/   # comments and tasks
│   │   ├── builder/      # content-type builder (verdin dev only)
│   │   ├── media/        # media library
│   │   ├── releases/
│   │   ├── profile/      # own account, two-factor, passkeys, sessions
│   │   └── settings/     # users, roles, tokens, webhooks, locales, plugins, site features…
│   └── shared/
│       ├── ui/           # spartan helm components, owned by the project
│       └── components/   # app-level shared components (confirm dialog, page header…)
├── public/i18n/          # translation catalogs, one JSON file per language
├── scripts/check-i18n.mjs
└── e2e/                  # Playwright tests and the server they run against
```

**Zustand** liegt in Signals innerhalb injizierbarer Services in `core/` (`Auth`, `Schema`, `I18n`, `Theme`…). Es gibt keine Store-Bibliothek.

**API-Zugriff** läuft über `core/api.ts`, einen kleinen Promise-basierten Wrapper um den `HttpClient` von Angular, mit handgeschriebenen Typen in `core/types.ts`. Die Laufzeitkonfiguration (Admin-Pfad, API-Präfix, Modus, Branding) kommt aus einem Tag `<meta name="verdin-config">`, das der Server einfügt.

**Sitzung.** Das Access-Token liegt nur im Speicher; das Refresh-Token ist ein `HttpOnly`-Cookie, beschränkt auf die Auth-Routen. Ein HTTP-Interceptor fügt das Bearer-Token hinzu und führt bei einem `401` einmal einen Refresh aus und wiederholt die Anfrage; schlägt der Refresh fehl, schickt er den Benutzer zur Anmeldeseite. Refresh- und Logout-Anfragen tragen den Header `X-Verdin-CSRF`, den der Server verlangt. Guards stellen die Sitzung beim Laden der Seite aus dem Cookie wieder her. Ein `403`, das besagt, dass die Rolle Zwei-Faktor-Authentifizierung verlangt, schickt den Benutzer zur Einrichtung.

## Schemagesteuerte Formulare

Der Eintragseditor (`features/content/edit.ts`) hat keinen Code pro Typ. Er liest Inhaltstypen und Komponenten aus `GET /admin/api/content-types` und `GET /admin/api/components` sowie das Editor-Layout aus den Einstellungen der Bearbeitungsansicht und baut das Formular zur Laufzeit mit **Signal Forms** (`@angular/forms/signals`):

- Das Dokumentmodell ist ein Signal eines einfachen Objekts (`FormModel` in `fields/model.ts`); der Feldbaum und seine Validatoren werden aus dem Schema abgeleitet.
- Eine rekursive Komponente `vd-fields` (`fields/fields.ts`) rendert jede Attribut-Map gegen einen Feldbaum. Text, Datumswerte und Uhrzeiten nutzen native Eingabefelder, gebunden mit `[formField]`. Eigene `FormValueControl`s übernehmen Zahlen (nullable; große Ganzzahlen bleiben Strings), Schalter, Enumerationen, Zeitstempel (Ortszeit im Eingabefeld, UTC im Modell), JSON, Markdown, `blocks` (TipTap), Medien, Relationen (Auswahl mit Suche beim Tippen und Sortierung) und polymorphe Relationen.
- Komponenten sind verschachtelte Fieldsets; wiederholbare Komponenten und Dynamic Zones sind sortierbare Listen. Plugins können eigene Feldtypen registrieren, die als Custom Elements gerendert werden.
- `toModel` wandelt ein geladenes Dokument ins Formularmodell um (Relationen werden zu `documentId`s, Dateien zu IDs), und `toPayload` wandelt zurück in die `data`-Payload: Leere Strings werden zu `null`, Render-Schlüssel (`__key`) und schreibgeschützte Seiten (`mappedBy`, `morphOne`, `morphMany`) entfallen. Beides ist in `fields/model.spec.ts` per Unit-Test abgedeckt.
- Die aus dem Schema abgeleitete Validierung gibt sofortiges Feedback. Bedingte Felder (`conditions.visible`) werden im Browser von einer Portierung des JSON-Logic-Evaluators des Servers (`core/logic.ts`) ausgewertet. Feldübergreifende Validierungsregeln prüft nur der Server. Der Server bleibt die maßgebliche Instanz: Seine Einträge `details.errors[].path` werden dem passenden Feld zugeordnet.
- Speichern ist ausdrücklich, mit Änderungsverfolgung und einer Warnung beim Verlassen der Seite (ein Route-Guard plus `beforeunload`). Die Buttons **Veröffentlichen**, **Veröffentlichung zurücknehmen** und **Änderungen verwerfen** erscheinen je nach Zustand des Dokuments. Das Admin-Panel speichert nur Entwürfe; Veröffentlichen ist immer eine eigene Aktion.

Das Layout des Editors (Feldreihenfolge, Breiten, Beschriftungen, Beschreibungen, schreibgeschützte Felder, das Feld, das verknüpfte Einträge benennt) teilen sich alle Admins; es wird auf dem Server in `vd_settings` gespeichert und auf der Seite **Ansicht konfigurieren** mit der Berechtigung `views.manage` geändert.

## Listen

Content-Listen (`features/content/list.ts`) nutzen die spartan-helm-Tabelle mit serverseitiger Paginierung, Sortierung und Filtern. Filter, Suche (`_q`) und die Seite werden in der URL gespiegelt, eine gefilterte Liste ist also ein teilbarer Link. Jeder Admin wählt pro Typ die sichtbaren Spalten, die Standardsortierung und die Seitengröße (`list-view.ts`); diese Einstellungen werden in seinen eigenen Präferenzen auf dem Server gespeichert und folgen ihm so über Browser hinweg. Listen aktualisieren sich außerdem live über den Admin-Event-Stream.

## Content-Type Builder

Der **Content-Type Builder** ist nur sichtbar, wenn der Server im Entwicklungsmodus läuft (`verdin dev`) und der Admin `schema.manage` hat. Er bearbeitet Inhaltstypen und Komponenten in ihrem Dateiformat: Felder, Arten und Ziele von Relationen (samt Anlegen des inversen Attributs am Ziel), Komponenten, Dynamic Zones, Längen, Wertebereiche und die Flags `required`, `unique` und `private`.

Jede Änderung geht zuerst an `POST /admin/api/schema/plan`, das das künftige Schema validiert und die Migrationsschritte mit Risiko, SQL und Umbenennungsvorschlägen zurückgibt, die der Benutzer annehmen kann. Die Bestätigung ruft `POST /admin/api/schema/apply` mit der akzeptierten Risikostufe und den Umbenennungen auf. Der Server migriert, schreibt `schema/*.json` und tauscht die laufende App ohne Neustart gegen das neue Schema aus. Was dabei auf dem Server passiert, steht unter [Migrations-Engine](/de/internals/migrations/).

## Build und Auslieferung

- `ng build` schreibt den Produktions-Build nach `admin/dist/admin/browser`, mit `<base href="/admin/">`.
- Der Server bettet diesen Ordner mit `rust-embed` ein, wenn er mit dem Feature `embed-admin` kompiliert wird, das Release-Builds und das Docker-Image nutzen. Ohne das Feature, oder wenn `[admin].assets_dir` gesetzt ist, liefert er die Dateien von der Festplatte aus. `assets_dir` hat Vorrang vor dem eingebetteten Build.
- Der Server schreibt `<base href>` auf `[admin].path` um und fügt die Laufzeitkonfiguration als `<meta>`-Tag ein, nicht als Inline-Skript. Eine Änderung von `admin.path` erfordert nie einen Neubau des Panels.
- Unbekannte Pfade ohne Dateiendung fallen fürs clientseitige Routing auf `index.html` zurück. Bundles mit Fingerprint (`main-ABC123.js`) werden ein Jahr lang als `immutable` gecacht; alles andere ist `no-cache`.
- Jede Admin-Antwort trägt eine strenge Content Security Policy (`script-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`…), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` und `Referrer-Policy: strict-origin-when-cross-origin`. Das Inlining von kritischem CSS in Angular ist in `angular.json` abgeschaltet, weil es auf Inline-Event-Handler setzt, die die Policy verbietet.

Für Frontend-Arbeit startest du den Server und dann `npm start` in `admin/`: `ng serve` leitet `/admin/api` und `/api` an `http://localhost:1337` weiter (`admin/proxy.conf.json`).

## Übersetzungen

Das Panel wird zur Laufzeit mit Transloco übersetzt, nicht mit dem i18n von Angular zur Kompilierzeit, sodass ein Build jede Sprache bedient und Benutzer ohne Neuladen wechseln können.

- Kataloge sind flache JSON-Dateien in `admin/public/i18n/` (`en.json` ist die Quelle), die bei Bedarf geladen werden.
- Meldungen nutzen ICU MessageFormat (`{name}`, `{count, plural, one {# entry} other {# entries}}`), interpretiert von FormatJS (`intl-messageformat`) über einen eigenen Transloco-Transpiler. FormatJS interpretiert Meldungen, statt sie zu Funktionen zu kompilieren, die CSP braucht also kein `unsafe-eval`.
- Meldungsschlüssel sind aus `en.json` typisiert (`core/i18n/keys.ts`): Einen nicht existierenden Schlüssel zu verwenden ist ein Kompilierfehler.
- `npm run i18n:check` prüft jeden Katalog gegen `en.json`: dieselben Schlüssel, gültige ICU-Syntax, dieselben Argumente und jede Pluralkategorie der Sprache. Die CI führt es aus.
- Der Service `I18n` liefert außerdem sprachabhängige Formatierung und den ersten Wochentag, übernommen aus den Regionaleinstellungen des Browsers, mit einer Überschreibung pro Benutzer.

Wie du eine Sprache hinzufügst oder aktualisierst, steht unter [Übersetzen](/de/project/translating/).
