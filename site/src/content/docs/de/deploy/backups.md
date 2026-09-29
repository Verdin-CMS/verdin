---
title: Backups
description: Sichere ein Verdin-Projekt mit Datenbank-Dumps und Kopien des Medienspeichers, oder zieh es mit verdin export und verdin import verdin um.
sidebar:
  order: 9
---

Die Daten eines Verdin-Projekts liegen an zwei Orten: in der **Datenbank** (Inhalte, Admins,
Rollen, Tokens, Einstellungen, Verlauf, Audit-Logs) und im **Medienspeicher** (die Dateien der
Medienbibliothek, auf der Festplatte oder in einem Bucket). Die Schemadateien liegen in deinem
Repository. Sichere beide Speicher; `verdin export` liefert zusätzlich ein portables Archiv der
Inhalte.

| Methode | Enthält | Wofür |
| --- | --- | --- |
| Datenbank-Dump + Medienkopie | Alles | Wiederherstellung desselben Projekts nach einem Ausfall |
| `verdin export` | Schema, Sprachen, Medien, jede Version jedes Eintrags | Inhalte auf eine andere Instanz oder Datenbank-Engine umziehen; eine zusätzliche, portable Kopie |

## Datenbank-Dumps

Nutze die Werkzeuge deiner Datenbank oder die automatischen Backups deines Anbieters:

```sh frame="terminal"
# PostgreSQL
pg_dump --format=custom --file=verdin-$(date +%F).dump "$VERDIN_DATABASE_URL"

# MySQL / MariaDB
mysqldump --single-transaction --routines -h <host> -u <user> -p <database> > verdin-$(date +%F).sql

# SQLite: eine konsistente Kopie, während der Server läuft
sqlite3 /data/verdin.db ".backup '/backups/verdin-$(date +%F).db'"
```

Kopiere eine laufende SQLite-Datei nicht mit `cp`: Nimm `.backup` (oder stoppe vorher den
Server).

Ein Dump enthält Passwort-Hashes, Hashes der API-Tokens und private Felder. Verschlüssele ihn
und bewahre ihn getrennt von den Servern auf, die er absichert. Um ihn wiederherzustellen,
brauchst du außerdem denselben `VERDIN_TOKEN_PEPPER` und dasselbe `VERDIN_ADMIN_JWT_SECRET`:
Ohne den Pepper funktionieren API-Tokens und die Codes der Authenticator-Apps der Admins nicht
mehr.

## Medienspeicher

- **Lokaler Provider**: Kopiere das Upload-Verzeichnis (`[upload].provider.dir`,
  `/data/uploads` im Docker-Image) mit deiner üblichen Dateisicherung, und zwar nach dem
  Datenbank-Dump, damit keine Datei fehlt, auf die der Dump verweist.
- **S3-Provider**: Schalte Versionierung oder Replikation für den Bucket ein, oder kopiere ihn
  mit den Werkzeugen deines Anbieters.

Der Cache für Bildtransformationen und der Suchindex lassen sich neu aufbauen und brauchen kein
Backup.

## `verdin export`

`verdin export` schreibt Schema, Inhalte und Medien eines Projekts in eine einzige `.tar.gz`,
und `verdin import verdin` stellt sie im selben Projekt oder auf einer anderen Instanz wieder
her, auf jeder Datenbank-Engine.

```sh frame="terminal"
verdin export backup-2026-09-28.tar.gz            # Schema, Sprachen, Medien und Einträge
verdin export content-only.tar.gz --no-media      # ohne Mediendateien
verdin import verdin backup-2026-09-28.tar.gz     # in dieses Projekt
```

Führe sie mit der Konfiguration des Projekts aus (dieselbe `verdin.toml` und dieselbe Umgebung
wie der Server). In einem Container:
`docker compose exec verdin verdin export /data/backup.tar.gz`.

### Was enthalten ist

- **Schemadateien**, so wie sie sind.
- **Sprachen.** Ein leeres Projekt übernimmt sie alle, die Standardsprache eingeschlossen. Ein
  Projekt, das schon Sprachen hat, bekommt nur die fehlenden.
- **Medienordner und -dateien**, mit ihren responsiven Formaten. Dateien behalten ihre
  `documentId`; ihre numerischen IDs ändern sich.
- **Jede Version jedes Eintrags**: Entwürfe, veröffentlichte Versionen und alle Sprachen, mit
  ihren Daten, Relationen (über die `documentId`) und Medien, auch Relationen und Medien in
  Komponenten und Dynamic Zones. Private Felder und Passwort-Hashes sind enthalten.

**Nicht enthalten**: Admin-Benutzer, Rollen, API-Tokens, Webhooks, Funktionseinstellungen,
Review-Workflows und Releases. Leg sie auf dem Ziel neu an, oder stell stattdessen einen
Datenbank-Dump wieder her.

:::caution
Ein Export enthält private Felder und Passwort-Hashes. Bewahre ihn auf wie einen
Datenbank-Dump.
:::

### Importieren

1. Der Import schreibt die Schemadateien und migriert die Datenbank nur mit sicheren
   Schritten.
2. Existieren Schemadateien schon und unterscheiden sich, bricht er ab, sofern du nicht
   `--force` übergibst.
3. Auch Inhaltstypen, die schon Einträge haben, lassen ihn abbrechen, sofern du nicht `--force`
   übergibst; die Einträge werden dann neben die bestehenden gelegt.
4. Importierte Dokumente behalten ihre `documentId`; ein Import in ein Projekt, das dieselben
   Dokumente schon hat, scheitert also.

Der Import löst keine Webhooks oder Plugin-Hooks aus und schreibt keinen Verlauf.

### Archivformat

Ein gzip-komprimiertes Tar-Archiv:

| Pfad | Inhalt |
| --- | --- |
| `manifest.json` | `format: "verdin-export"`, Formatversion, Verdin-Version, Versionen pro Inhaltstyp |
| `schema/…` | Die Schemadateien |
| `locales.json` | `{ default, locales: [{ code, name }] }` |
| `folders.json`, `files.jsonl` | Medienordner und -dateien, ein JSON-Objekt pro Zeile |
| `assets/{hash}{ext}` | Die gespeicherten Objekte der Dateien und ihrer Formate |
| `entries/{uid}.jsonl` | Eine Version pro Zeile: `documentId`, `locale`, `published`, Datumsangaben, `data`, `relations`, `media` |

Um stattdessen ein Strapi-Projekt herüberzuholen, siehe
[Von Strapi migrieren](/de/migrate/from-strapi/).

## Teste deine Wiederherstellungen

Stell ab und zu in eine Wegwerf-Datenbank wieder her, starte Verdin darauf mit `verdin start`
und prüfe, ob du dich anmelden und Einträge und Medien lesen kannst.
