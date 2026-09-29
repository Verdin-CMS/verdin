---
title: Back-ups
description: Maak een back-up van een Verdin-project met databasedumps en kopieën van de mediaopslag, of verhuis het met verdin export en verdin import verdin.
sidebar:
  order: 9
---

De gegevens van een Verdin-project staan op twee plekken: de **database** (content, beheerders,
rollen, tokens, instellingen, geschiedenis, auditlogs) en de **mediaopslag** (de bestanden van de
mediabibliotheek, op schijf of in een bucket). De schemabestanden staan in je repository. Maak
van beide opslagplaatsen een back-up; `verdin export` voegt een draagbaar archief van de content
toe.

| Methode | Bevat | Gebruik het voor |
| --- | --- | --- |
| Databasedump + kopie van de media | Alles | Noodherstel van hetzelfde project |
| `verdin export` | Schema, locales, media, elke versie van elk item | Content verhuizen naar een andere instantie of database-engine; een extra, draagbare kopie |

## Databasedumps

Gebruik de eigen tools van je database, of de automatische back-ups van je provider:

```sh frame="terminal"
# PostgreSQL
pg_dump --format=custom --file=verdin-$(date +%F).dump "$VERDIN_DATABASE_URL"

# MySQL / MariaDB
mysqldump --single-transaction --routines -h <host> -u <user> -p <database> > verdin-$(date +%F).sql

# SQLite: een consistente kopie terwijl de server draait
sqlite3 /data/verdin.db ".backup '/backups/verdin-$(date +%F).db'"
```

Kopieer een live SQLite-bestand niet met `cp`: gebruik `.backup` (of stop eerst de server).

Een dump bevat wachtwoordhashes, hashes van API-tokens en privévelden. Versleutel hem en bewaar
hem uit de buurt van de servers die hij beschermt. Om er een te herstellen, heb je ook dezelfde
`VERDIN_TOKEN_PEPPER` en `VERDIN_ADMIN_JWT_SECRET` nodig: zonder de pepper werken API-tokens en de
codes van de authenticator-apps van beheerders niet meer.

## Mediaopslag

- **Lokale provider**: kopieer de uploadmap (`[upload].provider.dir`, `/data/uploads` in het
  Docker-image) met je gebruikelijke bestandsback-up, na de databasedump, zodat er geen bestand
  ontbreekt waarnaar de dump verwijst.
- **S3-provider**: zet versiebeheer of replicatie aan op de bucket, of kopieer hem met de tools
  van je provider.

De cache voor afbeeldingstransformaties en de zoekindex kunnen opnieuw worden opgebouwd en hebben
geen back-up nodig.

## `verdin export`

`verdin export` schrijft het schema, de content en de media van een project naar één `.tar.gz`,
en `verdin import verdin` zet het terug in hetzelfde project of een andere instantie, op elke
database-engine.

```sh frame="terminal"
verdin export backup-2026-09-28.tar.gz            # schema, locales, media en items
verdin export content-only.tar.gz --no-media      # zonder mediabestanden
verdin import verdin backup-2026-09-28.tar.gz     # in dit project
```

Draai ze met de configuratie van het project (dezelfde `verdin.toml` en omgeving als de server).
In een container: `docker compose exec verdin verdin export /data/backup.tar.gz`.

### Wat erin zit

- **Schemabestanden**, zoals ze zijn.
- **Locales.** Een leeg project neemt ze allemaal over, de standaardlocale inbegrepen. Een project
  dat al locales heeft, krijgt alleen de ontbrekende.
- **Mediamappen en -bestanden**, met hun responsieve formaten. Bestanden behouden hun
  `documentId`; hun numerieke id's veranderen.
- **Elke versie van elk item**: concepten, gepubliceerde versies en alle locales, met hun datums,
  relaties (via `documentId`) en media, inclusief relaties en media in componenten en dynamische
  zones. Privévelden en wachtwoordhashes zijn inbegrepen.

**Niet inbegrepen**: beheerders, rollen, API-tokens, webhooks, functie-instellingen,
reviewworkflows en releases. Maak ze opnieuw aan op het doel, of herstel in plaats daarvan een
databasedump.

:::caution
Een export bevat privévelden en wachtwoordhashes. Bewaar hem zoals een databasedump.
:::

### Importeren

1. De import schrijft de schemabestanden en migreert de database met alleen veilige stappen.
2. Schemabestanden die al bestaan en afwijken, laten hem stoppen, tenzij je `--force` meegeeft.
3. Contenttypes die al items hebben, laten hem ook stoppen, tenzij je `--force` meegeeft; de items
   worden dan naast de bestaande toegevoegd.
4. Geïmporteerde documenten behouden hun `documentId`, dus importeren in een project dat dezelfde
   documenten al heeft, mislukt.

De import triggert geen webhooks of plugin-hooks, en schrijft geen geschiedenis.

### Archiefformaat

Een met gzip gecomprimeerd tar-archief:

| Pad | Inhoud |
| --- | --- |
| `manifest.json` | `format: "verdin-export"`, formaatversie, Verdin-versie, versies per contenttype |
| `schema/…` | De schemabestanden |
| `locales.json` | `{ default, locales: [{ code, name }] }` |
| `folders.json`, `files.jsonl` | Mediamappen en -bestanden, één JSON-object per regel |
| `assets/{hash}{ext}` | De opgeslagen objecten van de bestanden en hun formaten |
| `entries/{uid}.jsonl` | Eén versie per regel: `documentId`, `locale`, `published`, datums, `data`, `relations`, `media` |

Om in plaats daarvan een Strapi-project binnen te halen, zie
[Migreren vanaf Strapi](/nl/migrate/from-strapi/).

## Test je herstelprocedures

Herstel af en toe naar een wegwerpdatabase, start Verdin erop met `verdin start`, en controleer
dat je kunt inloggen en items en media kunt lezen.
