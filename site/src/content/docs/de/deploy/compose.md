---
title: Docker Compose in Produktion
description: Ein Compose-Rezept für Produktion auf einem Server – Verdin, PostgreSQL und Caddy mit automatischem HTTPS sowie optional RustFS für S3-kompatible Medien.
sidebar:
  order: 3
---

[`deploy/compose/`](https://github.com/verdin-cms/verdin/tree/main/deploy/compose) ist ein
fertiges Setup für einen Server: Verdin und PostgreSQL in einem privaten Netzwerk, davor Caddy
mit einem Zertifikat, das er selbst bezieht und erneuert. Eine Override-Datei fügt RustFS
hinzu, einen S3-kompatiblen Speicher auf demselben Host, für Medien. [Docker](/de/deploy/docker/)
erklärt das Image, das diese Dateien nutzen.

Die Dateien wurden am 30.09.2026 mit `docker compose config` und `caddy validate` geprüft.

## Dateien

| Datei | Was |
| --- | --- |
| `compose.yaml` | `verdin`, `db` (PostgreSQL 17) und `caddy`. Nur Caddy veröffentlicht Ports (80, 443 und 443/udp für HTTP/3). |
| `compose.s3.yaml` | Fügt `rustfs` und einen einmaligen Job hinzu, der den öffentlich lesbaren Bucket `media` anlegt, und stellt den Upload-Provider von Verdin darauf um. |
| `Caddyfile` | TLS für `$VERDIN_DOMAIN`, Kompression, `/media/*` an RustFS und alles andere an Verdin. |
| `.env.example` | Die Variablen, die Compose liest: Domain, ACME-E-Mail, Image-Tag, Passwörter. |

## Einrichten

Voraussetzungen: ein Server mit Docker, ein DNS-Eintrag deiner Domain, der darauf zeigt, und
offene Ports 80 und 443.

1. Kopiere das Verzeichnis auf den Server und fülle `.env` aus:

   ```sh frame="terminal"
   cp .env.example .env                                  # VERDIN_DOMAIN, ACME_EMAIL
   echo "DB_PASSWORD=$(openssl rand -hex 24)" >> .env
   docker run --rm ghcr.io/verdin-cms/verdin:0.11 secrets > verdin.env
   ```

2. Lege dein committetes Schema in `schema/` ab (`content-types/` und `components/`). Es wird
   schreibgeschützt unter `/app/schema` eingebunden.
3. Starte es:

   ```sh frame="terminal"
   docker compose up -d
   docker compose logs -f verdin
   ```

4. Öffne `https://<deine Domain>/admin/` und registriere den ersten Admin.

Halte `.env` und `verdin.env` aus der Versionsverwaltung heraus und sichere sie: Ein neuer
`VERDIN_TOKEN_PEPPER` macht jedes API-Token ungültig.

## Medien auf S3

Standardmäßig landen Uploads im Volume `verdin-data`. So speicherst du sie stattdessen in
RustFS:

```sh frame="terminal"
echo "S3_SECRET_KEY=$(openssl rand -hex 24)" >> .env
docker compose -f compose.yaml -f compose.s3.yaml up -d
```

Die Dateien liefert dann Caddy unter `https://<deine Domain>/media/<key>` aus. Für AWS S3,
Cloudflare R2 oder einen anderen Anbieter lass die RustFS-Dienste weg und setze die Variablen
`VERDIN_UPLOAD__PROVIDER__*` und die `AWS_*`-Zugangsdaten auf die Werte dieses Anbieters (siehe
[Speicherung](/de/internals/storage/)). Das Umstellen einer bestehenden Website verschiebt keine
Dateien: Neue Uploads gehen an den neuen Provider.

## Hinweise

- **Client-Adressen.** Verdin vertraut `X-Forwarded-For` aus dem Compose-Netzwerk
  (`172.30.0.0/24`, fest in `compose.yaml`), in dem Caddy der einzige Proxy ist. Ändere beides,
  wenn dieser Bereich mit einem deiner Netzwerke kollidiert.
- **Echtzeit.** Caddy streamt `text/event-stream`-Antworten ohne Pufferung, sodass
  [Echtzeit-Events](/de/guides/frontend/realtime/) dahinter unverändert funktionieren.
- **Upgrades.** Ändere `VERDIN_VERSION` in `.env`, dann `docker compose pull && docker compose up -d`.
  Lies vorher [Aktualisieren](/de/migrate/upgrading/).
- **Backups.** Sichere PostgreSQL per Dump und behalte das Volume `verdin-data` (oder den
  Bucket); siehe [Backups](/de/deploy/backups/).
- **Admin-Befehle.** Das Image hat keine Shell: `docker compose exec verdin verdin admin create --email you@example.com`.
