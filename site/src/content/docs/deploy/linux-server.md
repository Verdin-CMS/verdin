---
title: Linux server
description: Run Verdin on a Debian or Ubuntu server from the .deb package — a systemd service, a verdin system user, state in /var/lib/verdin — behind a reverse proxy.
sidebar:
  order: 3
---

This page runs Verdin directly on a Debian or Ubuntu server, without containers, from
the `.deb` package attached to every release. The same layout works on other
distributions with the binary from the [install script](/start/installation/) and the
files under [`deploy/deb/`](https://github.com/verdin-cms/verdin/tree/main/deploy/deb)
copied by hand.

The package was built and inspected with `cargo deb` on 2026-09-30; it was not installed
on a live server for this guide.

## What the package installs

| Path | What |
| --- | --- |
| `/usr/bin/verdin` | The binary (static, admin panel built in). |
| `/etc/verdin/verdin.toml` | The configuration (a conffile: upgrades keep your edits). |
| `/etc/verdin/verdin.env` | Created on first install, mode `0640`: fresh `VERDIN_ADMIN_JWT_SECRET` and `VERDIN_TOKEN_PEPPER`, and `VERDIN_DATABASE_URL` (SQLite by default). |
| `/var/lib/verdin/` | Home of the `verdin` system user: the SQLite database, `schema/`, `uploads/`, the search index and the image cache. |
| `/usr/lib/systemd/system/verdin.service` | The service, installed but not enabled. |

The service runs `verdin -c /etc/verdin/verdin.toml start --migrate` as the `verdin`
user, with systemd's sandboxing (read-only system, private `/tmp`, no new privileges)
and write access to `/var/lib/verdin` only. It listens on `127.0.0.1:1337`.

## 1. Install

```sh frame="terminal"
curl -fsSLO https://github.com/verdin-cms/verdin/releases/download/v0.11.0/verdin_0.11.0-1_amd64.deb
sudo apt install ./verdin_0.11.0-1_amd64.deb
```

Use `arm64` in the file name on ARM servers.

## 2. Configure

1. Copy your committed schema to `/var/lib/verdin/schema/` (`content-types/` and
   `components/`), owned by `verdin`:

   ```sh frame="terminal"
   sudo rsync -a --chown=verdin:verdin schema/ /var/lib/verdin/schema/
   ```

2. For PostgreSQL, MySQL or MariaDB, edit `VERDIN_DATABASE_URL` in
   `/etc/verdin/verdin.env`. Keep the two secrets: a new `VERDIN_TOKEN_PEPPER`
   invalidates every API token.
3. In `/etc/verdin/verdin.toml`, set `[server].public_url` to the address browsers use,
   and `trusted_proxies = ["127.0.0.1"]` when the reverse proxy runs on the same
   machine. Every other key is in the [configuration reference](/reference/configuration/).

## 3. Start

```sh frame="terminal"
sudo systemctl enable --now verdin
journalctl -u verdin -f
```

The first start creates the tables. Create the first admin from the command line (the
service's environment file holds the database URL):

```sh frame="terminal"
sudo -u verdin sh -c 'set -a; . /etc/verdin/verdin.env; verdin -c /etc/verdin/verdin.toml admin create --email you@example.com'
```

or open the admin panel through your proxy and register there.

## 4. Put a reverse proxy in front

Verdin serves plain HTTP on the loopback interface. With Caddy, which gets and renews
the certificate by itself:

```text title="/etc/caddy/Caddyfile"
cms.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:1337
}
```

nginx works as well; turn off buffering for `/api/_events` so realtime events are not
held back (`proxy_buffering off;`).

## Upgrades and removal

- **Upgrade:** install the next release's `.deb` with `apt install ./verdin_….deb`. The
  service restarts if it was running, and `start --migrate` applies safe migrations.
  Read [Upgrading](/migrate/upgrading/) first.
- **Remove:** `apt remove verdin` stops the service and keeps the data and the
  configuration; `apt purge verdin` also deletes `/etc/verdin/verdin.env` (the
  secrets). The `verdin` user and `/var/lib/verdin` are never deleted by the package:
  remove them yourself once you have a [backup](/deploy/backups/).
