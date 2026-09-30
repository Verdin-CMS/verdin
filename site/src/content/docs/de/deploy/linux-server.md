---
title: Linux-Server
description: Verdin auf einem Debian- oder Ubuntu-Server aus dem .deb-Paket betreiben – ein systemd-Dienst, ein Systembenutzer verdin, Zustand in /var/lib/verdin – hinter einem Reverse Proxy.
sidebar:
  order: 3
---

Diese Seite betreibt Verdin direkt auf einem Debian- oder Ubuntu-Server, ohne Container, aus dem
`.deb`-Paket, das jedem Release beiliegt. Dasselbe Layout funktioniert auf anderen Distributionen
mit der Binärdatei aus dem [Installationsskript](/de/start/installation/) und den Dateien unter
[`deploy/deb/`](https://github.com/verdin-cms/verdin/tree/main/deploy/deb), von Hand kopiert.

Das Paket wurde am 30.09.2026 mit `cargo deb` gebaut und untersucht; für diese Anleitung wurde
es nicht auf einem Live-Server installiert.

## Was das Paket installiert

| Pfad | Was |
| --- | --- |
| `/usr/bin/verdin` | Die Binärdatei (statisch, Admin-Panel eingebaut). |
| `/etc/verdin/verdin.toml` | Die Konfiguration (eine Conffile: Upgrades behalten deine Änderungen). |
| `/etc/verdin/verdin.env` | Wird bei der ersten Installation angelegt, Modus `0640`: frische `VERDIN_ADMIN_JWT_SECRET` und `VERDIN_TOKEN_PEPPER` sowie `VERDIN_DATABASE_URL` (standardmäßig SQLite). |
| `/var/lib/verdin/` | Home des Systembenutzers `verdin`: die SQLite-Datenbank, `schema/`, `uploads/`, der Suchindex und der Bild-Cache. |
| `/usr/lib/systemd/system/verdin.service` | Der Dienst, installiert, aber nicht aktiviert. |

Der Dienst führt `verdin -c /etc/verdin/verdin.toml start --migrate` als Benutzer `verdin` aus,
mit dem Sandboxing von systemd (schreibgeschütztes System, privates `/tmp`, keine neuen
Privilegien) und Schreibzugriff nur auf `/var/lib/verdin`. Er lauscht auf `127.0.0.1:1337`.

## 1. Installieren

```sh frame="terminal"
curl -fsSLO https://github.com/verdin-cms/verdin/releases/download/v0.11.0/verdin_0.11.0-1_amd64.deb
sudo apt install ./verdin_0.11.0-1_amd64.deb
```

Nimm auf ARM-Servern `arm64` im Dateinamen.

## 2. Konfigurieren

1. Kopiere dein committetes Schema nach `/var/lib/verdin/schema/` (`content-types/` und
   `components/`), im Besitz von `verdin`:

   ```sh frame="terminal"
   sudo rsync -a --chown=verdin:verdin schema/ /var/lib/verdin/schema/
   ```

2. Für PostgreSQL, MySQL oder MariaDB bearbeite `VERDIN_DATABASE_URL` in
   `/etc/verdin/verdin.env`. Behalte die beiden Secrets: Ein neuer `VERDIN_TOKEN_PEPPER` macht
   jedes API-Token ungültig.
3. Setze in `/etc/verdin/verdin.toml` `[server].public_url` auf die Adresse, die Browser nutzen,
   und `trusted_proxies = ["127.0.0.1"]`, wenn der Reverse Proxy auf derselben Maschine läuft.
   Alle anderen Schlüssel stehen in der [Konfigurationsreferenz](/de/reference/configuration/).

## 3. Starten

```sh frame="terminal"
sudo systemctl enable --now verdin
journalctl -u verdin -f
```

Der erste Start legt die Tabellen an. Lege den ersten Admin über die Kommandozeile an (die
Umgebungsdatei des Dienstes enthält die Datenbank-URL):

```sh frame="terminal"
sudo -u verdin sh -c 'set -a; . /etc/verdin/verdin.env; verdin -c /etc/verdin/verdin.toml admin create --email you@example.com'
```

oder öffne das Admin-Panel über deinen Proxy und registriere dich dort.

## 4. Einen Reverse Proxy davorsetzen

Verdin liefert einfaches HTTP auf dem Loopback-Interface aus. Mit Caddy, der das Zertifikat
selbst bezieht und erneuert:

```text title="/etc/caddy/Caddyfile"
cms.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:1337
}
```

nginx funktioniert ebenfalls; schalte die Pufferung für `/api/_events` aus, damit
Echtzeit-Events nicht zurückgehalten werden (`proxy_buffering off;`).

## Upgrades und Entfernen

- **Upgrade:** Installiere das `.deb` des nächsten Releases mit `apt install ./verdin_….deb`.
  Der Dienst startet neu, wenn er lief, und `start --migrate` wendet sichere Migrationen an.
  Lies vorher [Aktualisieren](/de/migrate/upgrading/).
- **Entfernen:** `apt remove verdin` stoppt den Dienst und behält Daten und Konfiguration;
  `apt purge verdin` löscht zusätzlich `/etc/verdin/verdin.env` (die Secrets). Der Benutzer
  `verdin` und `/var/lib/verdin` werden vom Paket nie gelöscht: Entferne sie selbst, sobald du
  ein [Backup](/de/deploy/backups/) hast.
