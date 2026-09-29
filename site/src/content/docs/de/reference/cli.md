---
title: Referenz der Kommandozeile
description: Jeder Befehl, jeder Unterbefehl und jedes Flag der Binärdatei verdin, mit dem, was sie liest, schreibt und ausgibt.
sidebar:
  order: 2
  label: Kommandozeile
---

<!-- Written from crates/verdin/src/cli.rs and crates/verdin/src/new.rs. `npm run check-cli`
(site/scripts/check-cli.mjs) fails when a subcommand or flag in cli.rs is missing here. -->

`verdin` ist die einzige Binärdatei: Sie legt Projekte an, betreibt den Server, wendet
Migrationen an, verwaltet Admin-Benutzer und bringt Inhalte hinein und hinaus. Diese Seite
listet jeden Befehl und jedes Flag.

```text title="Terminal"
verdin [OPTIONS] <COMMAND>
```

| Befehl | Was er tut |
| --- | --- |
| [`verdin new`](#verdin-new) | Ein Projektverzeichnis anlegen. |
| [`verdin dev`](#verdin-dev) | Den Server im Entwicklungsmodus betreiben. |
| [`verdin start`](#verdin-start) | Den Server im Produktionsmodus betreiben. |
| [`verdin schema check`](#verdin-schema-check) | Die Schemadateien validieren. |
| [`verdin migrate plan`](#verdin-migrate-plan) | Die Migrationsschritte und ihr SQL anzeigen. |
| [`verdin migrate apply`](#verdin-migrate-apply) | Die Migrationsschritte anwenden. |
| [`verdin admin create`](#verdin-admin-create) | Einen Super Admin anlegen. |
| [`verdin admin reset-password`](#verdin-admin-reset-password) | Das Passwort eines Admins setzen. |
| [`verdin types`](#verdin-types) | TypeScript-Definitionen der Content-API erzeugen. |
| [`verdin import strapi`](#verdin-import-strapi) | Einen Strapi-Export importieren. |
| [`verdin import verdin`](#verdin-import-verdin) | Einen Verdin-Export importieren. |
| [`verdin export`](#verdin-export) | Das Projekt in ein `.tar.gz`-Archiv schreiben. |
| [`verdin healthcheck`](#verdin-healthcheck) | Prüfen, ob der lokale Server antwortet. |
| [`verdin secrets`](#verdin-secrets) | Neue Secrets ausgeben. |
| [`verdin version`](#verdin-version) | Die Version ausgeben. |

## Globale Optionen

| Option | Standard | Beschreibung |
| --- | --- | --- |
| `-c, --config <CONFIG>` | `verdin.toml` | Die Konfigurationsdatei des Projekts. Wird auch aus `VERDIN_CONFIG` gelesen. Das Projektwurzelverzeichnis ist das Verzeichnis der Datei: Schema, Plugins, Uploads und relative SQLite-Pfade werden dagegen aufgelöst. |
| `-h, --help` | | Hilfe zum Befehl ausgeben. |
| `-V, --version` | | Die Version ausgeben. |

`verdin help <COMMAND>` gibt dieselbe Hilfe aus wie `--help`.

Jeder Befehl außer `new`, `secrets` und `version` lädt zuerst das Projekt:

1. Er liest die Datei `.env` neben der Konfigurationsdatei, falls es eine gibt. Variablen, die
   schon in der Umgebung gesetzt sind, haben Vorrang.
2. Er lädt `verdin.toml` (optional) und die `VERDIN_*`-Überschreibungen. Siehe die
   [Konfigurationsreferenz](/de/reference/configuration/).
3. Er beginnt, mit `[log]` und `RUST_LOG` auf Standard Error zu protokollieren.

Befehle, die die Datenbank öffnen, brauchen `VERDIN_DATABASE_URL` oder `[database].url`.
Befehle, die Admin-Konten berühren oder den Server betreiben, brauchen außerdem
`VERDIN_ADMIN_JWT_SECRET` und `VERDIN_TOKEN_PEPPER`.

## `verdin new`

```text title="Terminal"
verdin new <DIR> [--database <DATABASE>]
```

Legt ein Projekt in `DIR` an, das nicht existieren oder leer sein muss:

| Datei | Inhalt |
| --- | --- |
| `verdin.toml` | `[server]`, `[api]` und `[admin]` mit ihren Standardwerten. |
| `.env` | `VERDIN_DATABASE_URL` sowie frische `VERDIN_ADMIN_JWT_SECRET` und `VERDIN_TOKEN_PEPPER`. Nur für dich lesbar (Modus `0600` unter Unix). |
| `.gitignore` | `.env`, `data/`, SQLite-Dateien und `.cache/`. |
| `schema/content-types/`, `schema/components/` | Leere Schemaverzeichnisse. |
| `data/` | Für die SQLite-Datenbank (nur SQLite). |

| Argument oder Option | Standard | Beschreibung |
| --- | --- | --- |
| `<DIR>` | | Anzulegendes Verzeichnis. |
| `--database <DATABASE>` | `sqlite` | Datenbank, auf die die `.env` zeigt: `sqlite`, `postgres`, `mysql` oder `mariadb`. |

Mit `sqlite` lautet die URL `sqlite://data/verdin.db`. Mit den anderen ist es die URL eines
lokalen Servers mit dem Benutzer `verdin`, dem Passwort `change-me` und einer Datenbank, die
nach dem Verzeichnis benannt ist (Kleinbuchstaben, Ziffern und `_`): Passe sie vor dem Start an.

```text title="Terminal"
$ verdin new blog --database postgres
created blog

  cd blog
  verdin dev

then open http://localhost:1337/admin/ to register the first admin
```

## `verdin dev`

```text title="Terminal"
verdin dev
```

Betreibt den Server im Entwicklungsmodus. Im Vergleich zu `verdin start`:

- Ausstehende Migrationen mit der Risikostufe `safe` werden beim Start angewendet. Riskantere
  Schritte stoppen den Server; prüfe sie mit [`verdin migrate plan`](#verdin-migrate-plan).
- Der **Content-Type Builder** des Admin-Panels bearbeitet die Schemadateien, und der Server
  lädt das Schema neu.
- Das Refresh-Cookie wird nicht als `Secure` markiert (sofern `[admin].secure_cookies` nichts
  anderes sagt), du kannst dich also über reines HTTP anmelden.
- Webhooks und Deploy-Ziele dürfen Loopback- und private Adressen aufrufen (sofern
  `[webhooks].allow_private_networks` nichts anderes sagt).

Er beendet sich bei Strg+C oder `SIGTERM`.

## `verdin start`

```text title="Terminal"
verdin start [--migrate]
```

Betreibt den Server im Produktionsmodus. Er verweigert den Start, wenn die Datenbank hinter dem
Schema zurückliegt, sodass ein Deploy nie Tabellen ändert, die du nicht geprüft hast.

| Option | Beschreibung |
| --- | --- |
| `--migrate` | Ausstehende `safe`-Migrationsschritte vor dem Start anwenden. Riskante und destruktive Schritte brauchen weiterhin `verdin migrate apply`. |

Bevor er lauscht, prüft er die Konfiguration (`[api].prefix` und `[admin].path` sehen aus wie
`/api`, Seitengrößen sind stimmig, `[server].trusted_proxies` und `[api].cors_origins` lassen
sich parsen) und legt die eingebauten Rollen an. Er protokolliert eine Warnung, wenn
`[admin].secure_cookies` `false` oder `[email].provider` `log` ist. Gibt es noch keinen Admin,
protokolliert er die Adresse des Admin-Panels, wo der erste Besucher den ersten Super Admin
registriert.

Er beendet sich bei Strg+C oder `SIGTERM`.

## `verdin schema check`

```text title="Terminal"
verdin schema check
```

Validiert die Schemadateien (`[schema].path`), ohne die Datenbank zu berühren. Er gibt eine
Zusammenfassung aus oder scheitert mit den Fehlern, jeweils mit Datei und Attributpfad:

```text title="Terminal"
$ verdin schema check
schema ok: 4 content types, 3 components
```

Nutze ihn in der CI vor einem Deploy. Was jedes Attribut akzeptiert, steht unter
[Attributtypen](/de/reference/attribute-types/).

## `verdin migrate plan`

```text title="Terminal"
verdin migrate plan [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Vergleicht die Datenbank mit dem Schema und gibt aus, was `verdin migrate apply` tun würde, ohne
etwas zu ändern: nummerierte Schritte, jeder mit Risikostufe und SQL. Gibt es nichts zu tun,
gibt er `database is up to date` aus.

| Option | Beschreibung |
| --- | --- |
| `--rename-table <OLD=NEW>` | Die Tabelle `OLD` als umbenannt in `NEW` behandeln (behält ihre Zeilen), statt eine zu entfernen und die andere anzulegen. Wiederholbar. |
| `--rename-column <TABLE.OLD=NEW>` | Die Spalte `OLD` von `TABLE` als umbenannt in `NEW` behandeln (behält ihre Werte). `TABLE` ist der neue Name der Tabelle. Wiederholbar. |

Risikostufen:

| Stufe | Bedeutung |
| --- | --- |
| `safe` | Kann keine Daten verlieren und nicht an bestehenden Zeilen scheitern: neue Tabellen, neue Spalten, die nullable sind oder einen Standardwert haben, Umbenennungen, nicht eindeutige Indizes. |
| `risky` | Kann an bestehenden Zeilen scheitern oder Werte umwandeln: Änderungen am Spaltentyp, neue Spalten, die nicht nullable sind und keinen Standardwert haben, eindeutige Indizes auf bestehenden Tabellen. |
| `destructive` | Entfernt Spalten oder Tabellen. |

Liegt ein Schritt über `safe`, endet der Plan mit dem Flag, das er braucht
(`requires: verdin migrate apply --allow risky`). Sieht eine entfernte Spalte oder Tabelle wie
eine umbenannte aus, listet er die zu übergebenden Umbenennungs-Flags. Wurde eine vorherige
Migration unterbrochen, zeigt er, wie viele Schritte angewendet wurden, und den letzten Fehler.

```text title="Terminal"
verdin migrate plan --rename-column articles.summary=excerpt
```

Siehe [Schemamigrationen](/de/concepts/schema-migrations/).

## `verdin migrate apply`

```text title="Terminal"
verdin migrate apply [--allow <ALLOW>] [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Wendet den Plan an. Er nimmt dieselben Umbenennungsoptionen wie `verdin migrate plan`; übergib
dieselben, die du geprüft hast.

| Option | Standard | Beschreibung |
| --- | --- | --- |
| `--allow <ALLOW>` | `safe` | Höchste anzuwendende Risikostufe: `safe`, `risky` oder `destructive`. Ein Plan mit einem Schritt darüber wird abgelehnt, bevor irgendetwas läuft. |
| `--rename-table <OLD=NEW>` | | Wie bei `verdin migrate plan`. |
| `--rename-column <TABLE.OLD=NEW>` | | Wie bei `verdin migrate plan`. |

Er gibt `applied N steps` oder `database is up to date` aus. Nach einer Unterbrechung (eine
verlorene Verbindung, ein fehlgeschlagener Schritt) behebst du die Ursache und führst ihn erneut
aus: Er setzt bei dem Schritt fort, der nicht abgeschlossen wurde.

## `verdin admin create`

```text title="Terminal"
verdin admin create --email <EMAIL>
```

Legt einen Super Admin an. Das Passwort wird aus `VERDIN_ADMIN_PASSWORD` gelesen oder, wenn das
nicht gesetzt ist, von der Standardeingabe. Die Datenbank muss mit dem Schema auf dem neuesten
Stand sein.

| Option | Beschreibung |
| --- | --- |
| `--email <EMAIL>` | Die E-Mail-Adresse des neuen Admins. |

```text title="Terminal"
$ VERDIN_ADMIN_PASSWORD='a long passphrase' verdin admin create --email ada@example.com
created Super Admin ada@example.com (id 1)
```

Nutze ihn, um den ersten Admin eines Servers anzulegen, der noch nicht im Browser erreichbar
ist; andernfalls registriert ihn der erste Besucher des Admin-Panels.

## `verdin admin reset-password`

```text title="Terminal"
verdin admin reset-password --email <EMAIL>
```

Setzt das Passwort eines Admins, entsperrt das Konto nach fehlgeschlagenen Anmeldungen und
beendet alle seine Sitzungen. Das Passwort wird wie bei `verdin admin create` gelesen.

| Option | Beschreibung |
| --- | --- |
| `--email <EMAIL>` | Die E-Mail-Adresse des Admins. |

Zweite Faktoren entfernt er nicht; ein Admin mit **Benutzer verwalten** kann sie unter
**Einstellungen → Benutzer** zurücksetzen.

## `verdin types`

```text title="Terminal"
verdin types [-o <OUT>]
```

Erzeugt aus dem Schema TypeScript-Definitionen der Content-API (ein Interface pro Inhaltstyp und
Komponente) und gibt sie auf der Standardausgabe aus. Eine Datenbank braucht er nicht.

| Option | Beschreibung |
| --- | --- |
| `-o, --out <OUT>` | Stattdessen in diese Datei schreiben. |

```text title="Terminal"
verdin types --out ../web/src/verdin.d.ts
```

Siehe [Typisierter Client](/de/guides/frontend/typed-client/).

## `verdin import strapi`

```text title="Terminal"
verdin import strapi <PATH> [--schema-only] [--force]
```

Importiert ein Projekt von Strapi v4 oder v5 aus einem Export, der mit
`strapi export --no-encrypt` erstellt wurde: eine `.tar.gz`, eine `.tar` oder ein entpacktes
Verzeichnis. Er schreibt die Inhaltstypen und Komponenten als Schemadateien und importiert dann
Einträge, Sprachen, Medien, Relationen und Ordner.

| Argument oder Option | Beschreibung |
| --- | --- |
| `<PATH>` | Die Exportdatei oder das Exportverzeichnis. |
| `--schema-only` | Nur die Schemadateien schreiben. |
| `--force` | Bestehende Schemadateien überschreiben und in Inhaltstypen importieren, die schon Einträge haben. |

Er gibt aus, was er geschrieben und importiert hat, mit Warnungen zu dem, was er nicht übernehmen
konnte, und schreibt `strapi-id-map.json` ins Projektwurzelverzeichnis: die Strapi-IDs und ihre
neuen `documentId`s und Datei-IDs in Verdin, um Links in deinem Frontend zu korrigieren.

Siehe [Von Strapi migrieren](/de/migrate/from-strapi/).

## `verdin import verdin`

```text title="Terminal"
verdin import verdin <PATH> [--force]
```

Importiert ein Archiv, das `verdin export` geschrieben hat: Schemadateien, Sprachen, Medien und
Einträge.

| Argument oder Option | Beschreibung |
| --- | --- |
| `<PATH>` | Die `.tar.gz`-Datei. |
| `--force` | Abweichende Schemadateien überschreiben und in Inhaltstypen importieren, die schon Einträge haben. |

## `verdin export`

```text title="Terminal"
verdin export <OUTPUT> [--no-media]
```

Schreibt Schema, Inhalte und Medien des Projekts in ein `.tar.gz`-Archiv: ein Backup oder ein
Weg, ein Projekt mit `verdin import verdin` auf eine andere Instanz umzuziehen. Das Archiv
enthält jede Version jedes Eintrags (Entwürfe, veröffentlichte Versionen, Sprachen) mit seinen
Relationen. Admin-Konten, API-Tokens und Einstellungen sind nicht enthalten.

| Argument oder Option | Beschreibung |
| --- | --- |
| `<OUTPUT>` | Das zu schreibende Archiv. |
| `--no-media` | Die Medienbibliothek weglassen: Dateien, Ordner und die Verknüpfungen der Einträge darauf. |

```text title="Terminal"
$ verdin export backup.tar.gz
exported to backup.tar.gz: 42 documents (57 versions), 18 files, 3 folders, 2 locales
```

Siehe [Backups](/de/deploy/backups/).

## `verdin healthcheck`

```text title="Terminal"
verdin healthcheck [--port <PORT>]
```

Fragt `GET /_health` beim Server auf dieser Maschine ab (`127.0.0.1`, der `[server].port` der
Konfiguration) und beendet sich mit Status 0, wenn er mit `200` antwortet, sonst mit 1, und gibt
den Grund aus. Er braucht weder Shell noch `curl` noch einen HTTP-Client, deshalb nutzt ihn das
Docker-Image als `HEALTHCHECK`; nutze ihn genauso in Compose oder in jedem Supervisor, der einen
Befehl ausführt.

| Option | Beschreibung |
| --- | --- |
| `--port <PORT>` | Diesen Port statt `[server].port` prüfen. |

```text title="Terminal"
$ verdin healthcheck
ok
```

Siehe [Monitoring](/de/deploy/monitoring/).

## `verdin secrets`

```text title="Terminal"
verdin secrets
```

Gibt ein frisches `VERDIN_ADMIN_JWT_SECRET` und einen frischen `VERDIN_TOKEN_PEPPER` aus, bereit
für eine `.env`-Datei oder den Secret-Store deiner Plattform. Er liest kein Projekt.

Eine Änderung von `VERDIN_ADMIN_JWT_SECRET` macht die kurzlebigen Access-Tokens von Admins und
Endnutzern ungültig, ebenso offene Vorschaulinks und laufende OAuth-Anmeldungen; das
Admin-Panel und Clients, die Refresh-Tokens nutzen, holen sich von selbst neue. Eine Änderung
von `VERDIN_TOKEN_PEPPER` macht gespeicherte Tokens ungültig (darunter API-Tokens), behalte ihn
also bei, sobald er in Gebrauch ist.

## `verdin version`

```text title="Terminal"
verdin version
```

Gibt `verdin` und die Version aus, wie `verdin --version`.
