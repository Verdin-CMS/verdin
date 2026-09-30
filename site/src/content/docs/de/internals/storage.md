---
title: Speicherung
description: Wie Verdin Inhalte in der Datenbank anordnet, von Tabellennamen und Systemspalten über Entwurfs- und veröffentlichte Zeilen, Verknüpfungen von Relationen und das JSON der Komponenten bis zu den Plattformtabellen.
sidebar:
  order: 2
---

Diese Seite beschreibt die Tabellen, die Verdin aus deinem Schema ableitet, und wie jede Art von Attribut gespeichert wird. Lies sie, bevor du etwas in `crates/verdin-migrate/src/derive.rs` oder im Document Service änderst, oder wenn du die Datenbank direkt abfragen musst. Was jeder Attributtyp akzeptiert, steht unter [Attributtypen](/de/reference/attribute-types/).

Du schreibst diese Tabellen nie von Hand: Die [Migrations-Engine](/de/internals/migrations/) legt sie aus dem Schema an und entwickelt sie weiter.

## Namenskonventionen

| Objekt | Name |
|---|---|
| Tabelle eines Inhaltstyps | `collectionName`, standardmäßig der `pluralName` mit Unterstrichen statt Bindestrichen (`blog-posts` → `blog_posts`) |
| Spalte | Der Attributname in snake_case (`metaTitle` → `meta_title`) |
| Verknüpfungen von Relationen | `{table}_{column}_lnk` |
| Verknüpfungen polymorpher Relationen | `{table}_{column}_mph` |
| Medienverknüpfungen | `{table}_{column}_mda` |
| Index | `{table}_{part}_uq` für eindeutige Indizes, `{table}_{part}_idx` für andere |
| Plattformtabelle | Präfix `vd_` (`vd_admin_users`, `vd_schema_snapshots`…) |

Regeln, die der Schema-Validator durchsetzt (`crates/verdin-schema/src/naming.rs` und `validate.rs`):

- Ein `collectionName` passt auf `^[a-z][a-z0-9_]*$`, hat höchstens 50 Zeichen und darf nicht mit `vd_` beginnen.
- `singularName` und `pluralName` sind in kebab-case (`^[a-z][a-z0-9-]*$`, ohne führende, abschließende oder doppelte Bindestriche). `upload`, `uploads`, `auth`, `users` und `connect` sind reserviert, weil die Content-API diese Routen nutzt.
- Attributnamen beginnen mit einem Buchstaben und gehen mit Buchstaben, Ziffern oder Unterstrichen weiter (die Regel von Strapi), höchstens 50 Zeichen.
- In Inhaltstypen sind `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`, `updatedAt`, `createdBy` und `updatedBy` reserviert, ebenso jeder Name, dessen snake_case mit ihnen kollidiert. In Komponenten ist `id` reserviert.
- Erzeugte Bezeichner sind auf 60 Zeichen begrenzt (PostgreSQL erlaubt 63, MySQL 64). Ein längerer Name wird gekürzt und bekommt einen 8-stelligen Hash des vollen Namens, sodass unterschiedliche lange Namen unterschiedlich bleiben und das Ergebnis deterministisch ist.

Jeder Bezeichner wird im erzeugten SQL gequotet, reservierte SQL-Wörter sind also gültige Attributnamen.

## Systemspalten

Jede Tabelle eines Inhaltstyps beginnt mit diesen Spalten:

```sql
id                 BIGINT       primary key, auto-increment
document_id        CHAR(26)     NOT NULL           -- ULID, shared by every version of a document
locale             VARCHAR(16)  NOT NULL DEFAULT '' -- '' for types that are not localized
publication_state  SMALLINT     NOT NULL           -- 0 = draft, 1 = published
published_at       <datetime>   NULL
created_at         <datetime>   NOT NULL
updated_at         <datetime>   NOT NULL
created_by_id      BIGINT       NULL               -- vd_admin_users.id
updated_by_id      BIGINT       NULL
UNIQUE (document_id, locale, publication_state)
INDEX  (publication_state, locale)
```

- `document_id` ist eine ULID in Kleinbuchstaben, die beim Anlegen erzeugt wird. Sie bleibt über Entwurf, veröffentlichte Version und jede Sprache hinweg gleich.
- Nicht lokalisierte Typen nutzen `locale = ''` statt `NULL`, weil NULLs auf keiner Engine in eindeutigen Indizes kollidieren, was die Constraint `(document_id, locale, publication_state)` aushebeln würde.
- Die Zustandsspalte heißt `publication_state`, nicht `state`, weil `state` ein häufiger Attributname ist.

Danach folgen die Attributspalten, eine pro skalarem Attribut. **Jede Attributspalte ist nullable.** Wie in Strapi v5 dürfen Entwürfe unvollständig sein, deshalb wird `required` geprüft, wenn eine Version veröffentlicht wird (oder bei jedem Schreiben in Typen ohne Entwurf und Veröffentlichung), nicht von der Datenbank. Das macht auch das Hinzufügen eines Pflichtattributs zu einer sicheren Migration.

`unique`-Attribute und jede `uid` bekommen einen eindeutigen Index auf `(column, locale, publication_state)`. Ein Entwurf und seine veröffentlichte Version dürfen einen Wert teilen, zwei veröffentlichte Dokumente nicht, und die Datenbank setzt das frei von Race Conditions durch. Eine Verletzung wird als `ValidationError` an diesem Feld gemeldet.

## Entwurf und Veröffentlichung

Verdin folgt dem Modell von Strapi v5. Die Sicht der Benutzer beschreibt [Entwurf und Veröffentlichung](/de/concepts/draft-and-publish/); hier steht, was in der Tabelle passiert.

- Ein Dokument hat pro Sprache höchstens eine Entwurfszeile (`publication_state = 0`) und eine veröffentlichte Zeile (`publication_state = 1`).
- Schreibvorgänge aus dem Admin-Panel zielen auf die Entwurfszeile.
- **Veröffentlichen** prüft `required`-Attribute und Validierungsregeln am Entwurf und kopiert dann die Attributwerte des Entwurfs auf die veröffentlichte Zeile (aktualisiert sie oder fügt sie beim ersten Mal ein), in einer Transaktion. Die Relations- und Medienverknüpfungen des Entwurfs werden mitkopiert.
- **Veröffentlichung zurücknehmen** löscht die veröffentlichte Zeile. Ihre Verknüpfungen verschwinden über `ON DELETE CASCADE` mit.
- **Entwurf verwerfen** überschreibt den Entwurf mit den Werten und Verknüpfungen der veröffentlichten Zeile.
- Inhaltstypen ohne Entwurf und Veröffentlichung haben immer nur eine veröffentlichte Zeile.
- Bei lokalisierten Typen werden nicht lokalisierte Attribute geteilt: Das Veröffentlichen einer Sprache kopiert sie in die veröffentlichten Zeilen der anderen Sprachen.

## Relationen: über die Dokument-ID verknüpft

**Das ist der wichtigste Unterschied zur Speicherung von Strapi.** Strapi verknüpft Zeilen über die Zeilen-ID und muss beim Veröffentlichen Verknüpfungen umschreiben. Verdin speichert eine Relation als *Quellzeile → Zieldokument*:

```sql
-- articles_category_lnk
id                  BIGINT   primary key, auto-increment
source_id           BIGINT   NOT NULL REFERENCES articles(id) ON DELETE CASCADE
target_document_id  CHAR(26) NOT NULL
position            DOUBLE   NOT NULL   -- 1..n, rewritten on every write
UNIQUE (source_id, target_document_id)
UNIQUE (source_id)                      -- to-one kinds only
INDEX  (target_document_id)
```

- Die Zielzeile wird beim Lesen gewählt, in der gelesenen Version: Ein veröffentlichter Artikel sieht veröffentlichte Kategorien, ein Entwurf sieht Entwürfe. Wird eine Kategorie zurückgezogen, verschwindet sie aus veröffentlichten Artikeln, ohne dass eine Verknüpfung angefasst wird.
- Veröffentlichen kopiert nur die eigenen Verknüpfungen der Quellzeile.
- Nur die **besitzende** Seite (das Attribut mit `inversedBy` oder eine einseitige Relation) hat eine Verknüpfungstabelle. Die inverse Seite (`mappedBy`) liest dieselbe Tabelle in Gegenrichtung und ist schreibgeschützt: Sie zu schreiben ist ein Validierungsfehler, der das besitzende Attribut nennt.
- „Höchstens ein Ziel“ (`oneToOne`, `manyToOne`, `oneWay`) ist der eindeutige Index auf `source_id`. „Ein Ziel gehört einem Quelldokument“ (`oneToOne`, `oneToMany`) kann kein Index sein, weil ein Entwurf und seine veröffentlichte Version berechtigterweise Ziele teilen. Der Document Service setzt es durch, indem er das Ziel *verschiebt*: Es zu verknüpfen entfernt die Verknüpfungen, die andere Dokumente im selben Zustand darauf halten, das Verhalten von Strapi.
- Auf `target_document_id` gibt es keinen Fremdschlüssel, weil `document_id` in der Zieltabelle nicht eindeutig ist. Der Document Service lehnt Verknüpfungen auf nicht existierende Dokumente ab und entfernt, wenn die letzte Version eines Dokuments gelöscht wird, in derselben Transaktion die Verknüpfungen, die darauf zeigen.
- Verknüpfungszeilen behalten einen Primärschlüssel `id`, sodass Verknüpfungstabellen für die Migrations-Engine und für Neuaufbauten von SQLite-Tabellen wie jede andere Tabelle aussehen.
- Wird eine Tabelle umbenannt, werden ihre Verknüpfungstabellen mit umbenannt. Migrationen laufen mit abgeschaltetem `foreign_keys` von SQLite, damit der Neuaufbau einer Tabelle nicht in ihre Verknüpfungstabellen kaskadiert.

**Polymorphe Relationen** (`morphToOne`, `morphToMany`) verknüpfen Dokumente beliebiger Inhaltstypen. Ihre Verknüpfungen liegen in `{table}_{column}_mph` mit `source_id`, `target_type` (die UID des Ziels), `target_document_id` und `position`, einem eindeutigen `(source_id, target_type, target_document_id)` und bei `morphToOne` einem eindeutigen `source_id`. Die inversen Seiten (`morphOne`, `morphMany`) haben keine Tabelle: Sie lesen die Verknüpfungen des Besitzers, die auf sie zeigen, und sind schreibgeschützt. Das Löschen eines Dokuments entfernt die polymorphen Verknüpfungen darauf. Was du mit ihnen tun kannst und was nicht, steht unter [Relationen](/de/concepts/relations/).

## Komponenten und Dynamic Zones: eine JSON-Spalte

Ein Komponentenattribut oder eine Dynamic Zone ist **eine JSON-Spalte** in der Zeile des Dokuments (`jsonb` auf PostgreSQL, `json` auf MySQL und MariaDB, `text` auf SQLite). Strapi speichert jede Komponente in einer eigenen Tabelle mit polymorphen Join-Tabellen; eine Spalte vermeidet diese Joins und macht Veröffentlichen und Verlauf zu einer einfachen Kopie.

```json
// "seo" column (a single component)
{ "id": 1, "metaTitle": "…", "metaDescription": "…" }

// "blocks" column (a dynamic zone)
[
  { "id": 1, "__component": "blocks.hero", "title": "…" },
  { "id": 2, "__component": "blocks.quote", "text": "…", "author": "…" }
]
```

- Jedes Komponentenelement hat eine ganzzahlige `id`, eindeutig innerhalb seines Attributs. Neue Elemente bekommen die nächste freie Nummer.
- Die Daten werden bei jedem Schreiben gegen das Komponentenschema validiert.
- Veröffentlichen und Verwerfen kopieren das JSON, wie es ist.
- **Relationen und Medien in Komponenten** werden im JSON selbst gespeichert: `documentId`s für Relationen (dort sind nur `oneWay` und `manyWay` erlaubt) und Datei-IDs für Medien. Sie werden beim Schreiben geprüft und beim Laden der Komponente mit gebündelten Abfragen aufgelöst. Polymorphe Relationen und `password`-Attribute dürfen nicht in Komponenten stehen.
- **Filtern** braucht dialektspezifische JSON-Funktionen. Skalare Felder einzelner Komponenten werden über einen JSON-Pfad gelesen (`#>>` auf PostgreSQL, `JSON_VALUE` auf MySQL und MariaDB, `json_extract` auf SQLite). Wiederholbare Komponenten nutzen `EXISTS` über die Array-Elemente (`jsonb_array_elements`, `JSON_TABLE`, `json_each`). Dynamic Zones lassen sich nur nach `__component` filtern, weil ihre Elemente unterschiedliche Felder haben.

Die Seite der Modellierung beschreibt [Komponenten und Dynamic Zones](/de/concepts/components-and-dynamic-zones/).

## Plattformtabellen

Die Plattformtabellen gehören zu jedem abgeleiteten Modell, die Migrations-Engine legt sie also genau wie Content-Tabellen an und entwickelt sie weiter; sie erscheinen als sichere Schritte in `verdin migrate plan`. Definiert sind sie in `crates/verdin-migrate/src/system.rs`.

| Bereich | Tabellen |
|---|---|
| Migrationen | `vd_schema_snapshots`, `vd_migrations_journal` (gehören der Migrations-Engine, werden bei der ersten Nutzung angelegt) |
| Admins | `vd_admin_users`, `vd_admin_roles`, `vd_admin_user_roles`, `vd_admin_permissions`, `vd_sessions` (Refresh-Tokens), `vd_admin_tokens` (Einladungs- und Reset-Links), `vd_admin_two_factor`, `vd_admin_passkeys`, `vd_spent_challenges` |
| Zugriff auf die Content-API | `vd_api_tokens`, `vd_api_token_permissions`, `vd_public_permissions` |
| Endnutzer | `vd_users`, `vd_user_roles`, `vd_user_role_permissions`, `vd_end_user_sessions` |
| Instanz | `vd_settings` (Funktionsschalter, Layouts der Bearbeitungsansichten, einmalige Upgrade-Marker), `vd_locales`, `vd_cluster_events` (der gemeinsame Event-Bus, siehe [Mehrere Instanzen betreiben](/de/deploy/scaling/)) |
| Medien | `vd_files`, `vd_folders` |
| Redaktioneller Ablauf | `vd_history_versions`, `vd_releases`, `vd_release_actions`, `vd_workflows`, `vd_workflow_stages`, `vd_document_stages` |
| Zusammenarbeit | `vd_comments`, `vd_tasks`, `vd_document_views`, `vd_document_votes`, `vd_polls`, `vd_poll_votes` |
| Integrationen | `vd_webhooks`, `vd_webhook_deliveries`, `vd_deploy_targets`, `vd_deployments`, `vd_plugin_kv`, `vd_audit_logs` |
| Website-Funktionen | `vd_redirects`, `vd_menus`, `vd_forms`, `vd_form_submissions` |

## Medientabellen

Dateien sind Zeilen von `vd_files` im Format von Strapi (`name`, `alternative_text`, `caption`, `width`, `height`, `formats`, `hash`, `ext`, `mime`, `size`, `url`, `provider`…), dazu `focal_point`, `folder_id` und `folder_path`. Ordner (`vd_folders`) behalten den `path` aus `path_id`s von Strapi, etwa `/1/4`.

Ein Medienattribut ist eine Verknüpfungstabelle `{table}_{column}_mda` mit `source_id` (die Content-Zeile), `file_id` (eine Zeile von `vd_files`) und `position`. Sie hat ein eindeutiges `(source_id, file_id)` und, wenn das Attribut nicht `multiple` ist, ein eindeutiges `source_id`. Beide Spalten sind Fremdschlüssel mit `ON DELETE CASCADE`, das Löschen einer Datei oder Zeile entfernt also ihre Verknüpfungen. Medienverknüpfungen folgen denselben Regeln für Entwurf und Veröffentlichung wie Relationsverknüpfungen: Jede Version besitzt ihre Verknüpfungen, und Veröffentlichen kopiert sie.

Wie Uploads, Formate und Speicher-Provider funktionieren, steht unter [Medien](/de/concepts/media/).
