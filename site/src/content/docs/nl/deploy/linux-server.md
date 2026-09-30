---
title: Linux-server
description: Draai Verdin op een Debian- of Ubuntu-server vanuit het .deb-pakket — een systemd-service, een systeemgebruiker verdin, state in /var/lib/verdin — achter een reverse proxy.
sidebar:
  order: 3
---

Deze pagina draait Verdin rechtstreeks op een Debian- of Ubuntu-server, zonder containers, vanuit
het `.deb`-pakket dat bij elke release zit. Dezelfde indeling werkt op andere distributies met de
binary van het [installatiescript](/nl/start/installation/) en de bestanden onder
[`deploy/deb/`](https://github.com/verdin-cms/verdin/tree/main/deploy/deb) met de hand gekopieerd.

Het pakket is op 2026-09-30 gebouwd en geïnspecteerd met `cargo deb`; het is voor deze gids niet
op een live server geïnstalleerd.

## Wat het pakket installeert

| Pad | Wat |
| --- | --- |
| `/usr/bin/verdin` | De binary (statisch, beheerpaneel ingebouwd). |
| `/etc/verdin/verdin.toml` | De configuratie (een conffile: upgrades behouden je wijzigingen). |
| `/etc/verdin/verdin.env` | Aangemaakt bij de eerste installatie, modus `0640`: verse `VERDIN_ADMIN_JWT_SECRET` en `VERDIN_TOKEN_PEPPER`, en `VERDIN_DATABASE_URL` (standaard SQLite). |
| `/var/lib/verdin/` | Thuismap van de systeemgebruiker `verdin`: de SQLite-database, `schema/`, `uploads/`, de zoekindex en de afbeeldingscache. |
| `/usr/lib/systemd/system/verdin.service` | De service, geïnstalleerd maar niet ingeschakeld. |

De service draait `verdin -c /etc/verdin/verdin.toml start --migrate` als gebruiker `verdin`, met
de sandboxing van systemd (alleen-lezen systeem, privé `/tmp`, geen nieuwe privileges) en
schrijftoegang alleen tot `/var/lib/verdin`. Ze luistert op `127.0.0.1:1337`.

## 1. Installeren

```sh frame="terminal"
curl -fsSLO https://github.com/verdin-cms/verdin/releases/download/v0.11.0/verdin_0.11.0-1_amd64.deb
sudo apt install ./verdin_0.11.0-1_amd64.deb
```

Gebruik `arm64` in de bestandsnaam op ARM-servers.

## 2. Configureren

1. Kopieer je gecommitte schema naar `/var/lib/verdin/schema/` (`content-types/` en
   `components/`), eigendom van `verdin`:

   ```sh frame="terminal"
   sudo rsync -a --chown=verdin:verdin schema/ /var/lib/verdin/schema/
   ```

2. Pas voor PostgreSQL, MySQL of MariaDB `VERDIN_DATABASE_URL` aan in
   `/etc/verdin/verdin.env`. Houd de twee geheimen: een nieuwe `VERDIN_TOKEN_PEPPER`
   maakt elk API-token ongeldig.
3. Stel in `/etc/verdin/verdin.toml` `[server].public_url` in op het adres dat browsers gebruiken,
   en `trusted_proxies = ["127.0.0.1"]` als de reverse proxy op dezelfde machine draait. Elke
   andere sleutel staat in de [configuratiereferentie](/nl/reference/configuration/).

## 3. Starten

```sh frame="terminal"
sudo systemctl enable --now verdin
journalctl -u verdin -f
```

De eerste start maakt de tabellen aan. Maak de eerste beheerder aan vanaf de opdrachtregel (het
omgevingsbestand van de service bevat de database-URL):

```sh frame="terminal"
sudo -u verdin sh -c 'set -a; . /etc/verdin/verdin.env; verdin -c /etc/verdin/verdin.toml admin create --email you@example.com'
```

of open het beheerpaneel via je proxy en registreer je daar.

## 4. Zet een reverse proxy ervoor

Verdin serveert gewone HTTP op de loopback-interface. Met Caddy, die het certificaat zelf ophaalt
en vernieuwt:

```text title="/etc/caddy/Caddyfile"
cms.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:1337
}
```

nginx werkt ook; zet buffering uit voor `/api/_events`, zodat realtime-events niet worden
tegengehouden (`proxy_buffering off;`).

## Upgrades en verwijderen

- **Upgraden:** installeer de `.deb` van de volgende release met `apt install ./verdin_….deb`. De
  service herstart als ze draaide, en `start --migrate` past veilige migraties toe.
  Lees eerst [Upgraden](/nl/migrate/upgrading/).
- **Verwijderen:** `apt remove verdin` stopt de service en behoudt de gegevens en de
  configuratie; `apt purge verdin` verwijdert ook `/etc/verdin/verdin.env` (de
  geheimen). De gebruiker `verdin` en `/var/lib/verdin` worden nooit door het pakket verwijderd:
  verwijder ze zelf zodra je een [back-up](/nl/deploy/backups/) hebt.
