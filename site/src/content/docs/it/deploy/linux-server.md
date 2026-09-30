---
title: Server Linux
description: Esegui Verdin su un server Debian o Ubuntu dal pacchetto .deb — un servizio systemd, un utente di sistema verdin, lo stato in /var/lib/verdin — dietro un reverse proxy.
sidebar:
  order: 3
---

Questa pagina esegue Verdin direttamente su un server Debian o Ubuntu, senza container, dal
pacchetto `.deb` allegato a ogni release. La stessa struttura funziona su altre distribuzioni
con il binario dello [script di installazione](/it/start/installation/) e i file in
[`deploy/deb/`](https://github.com/verdin-cms/verdin/tree/main/deploy/deb) copiati a mano.

Il pacchetto è stato costruito e ispezionato con `cargo deb` il 2026-09-30; non è stato
installato su un server reale per questa guida.

## Cosa installa il pacchetto

| Path | Cosa |
| --- | --- |
| `/usr/bin/verdin` | Il binario (statico, pannello di amministrazione incluso). |
| `/etc/verdin/verdin.toml` | La configurazione (un conffile: gli aggiornamenti mantengono le tue modifiche). |
| `/etc/verdin/verdin.env` | Creato alla prima installazione, modo `0640`: nuovi `VERDIN_ADMIN_JWT_SECRET` e `VERDIN_TOKEN_PEPPER`, e `VERDIN_DATABASE_URL` (SQLite di default). |
| `/var/lib/verdin/` | Home dell'utente di sistema `verdin`: il database SQLite, `schema/`, `uploads/`, l'indice di ricerca e la cache delle immagini. |
| `/usr/lib/systemd/system/verdin.service` | Il servizio, installato ma non abilitato. |

Il servizio esegue `verdin -c /etc/verdin/verdin.toml start --migrate` come utente `verdin`,
con il sandboxing di systemd (sistema in sola lettura, `/tmp` privato, nessun nuovo
privilegio) e accesso in scrittura solo a `/var/lib/verdin`. Ascolta su `127.0.0.1:1337`.

## 1. Installa

```sh frame="terminal"
curl -fsSLO https://github.com/verdin-cms/verdin/releases/download/v0.11.0/verdin_0.11.0-1_amd64.deb
sudo apt install ./verdin_0.11.0-1_amd64.deb
```

Usa `arm64` nel nome del file sui server ARM.

## 2. Configura

1. Copia lo schema di cui hai fatto commit in `/var/lib/verdin/schema/` (`content-types/` e
   `components/`), di proprietà di `verdin`:

   ```sh frame="terminal"
   sudo rsync -a --chown=verdin:verdin schema/ /var/lib/verdin/schema/
   ```

2. Per PostgreSQL, MySQL o MariaDB, modifica `VERDIN_DATABASE_URL` in
   `/etc/verdin/verdin.env`. Tieni i due segreti: un nuovo `VERDIN_TOKEN_PEPPER` invalida ogni
   token API.
3. In `/etc/verdin/verdin.toml`, imposta `[server].public_url` all'indirizzo usato dai browser,
   e `trusted_proxies = ["127.0.0.1"]` quando il reverse proxy gira sulla stessa macchina.
   Ogni altra chiave è nel [riferimento della configurazione](/it/reference/configuration/).

## 3. Avvia

```sh frame="terminal"
sudo systemctl enable --now verdin
journalctl -u verdin -f
```

Il primo avvio crea le tabelle. Crea il primo admin dalla riga di comando (il file di
ambiente del servizio contiene l'URL del database):

```sh frame="terminal"
sudo -u verdin sh -c 'set -a; . /etc/verdin/verdin.env; verdin -c /etc/verdin/verdin.toml admin create --email you@example.com'
```

oppure apri il pannello di amministrazione attraverso il tuo proxy e registrati lì.

## 4. Metti un reverse proxy davanti

Verdin serve HTTP semplice sull'interfaccia di loopback. Con Caddy, che ottiene e rinnova il
certificato da solo:

```text title="/etc/caddy/Caddyfile"
cms.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:1337
}
```

Funziona anche nginx; disattiva il buffering per `/api/_events` così che gli eventi realtime
non vengano trattenuti (`proxy_buffering off;`).

## Aggiornamenti e rimozione

- **Aggiornamento:** installa il `.deb` della release successiva con
  `apt install ./verdin_….deb`. Il servizio si riavvia se era in esecuzione, e
  `start --migrate` applica le migrazioni sicure. Leggi prima
  [Aggiornare Verdin](/it/migrate/upgrading/).
- **Rimozione:** `apt remove verdin` ferma il servizio e mantiene i dati e la configurazione;
  `apt purge verdin` elimina anche `/etc/verdin/verdin.env` (i segreti). L'utente `verdin` e
  `/var/lib/verdin` non vengono mai eliminati dal pacchetto: rimuovili tu una volta che hai un
  [backup](/it/deploy/backups/).
