---
title: Servidor Linux
description: Executa Verdin en un servidor Debian o Ubuntu des del paquet .deb — un servei de systemd, un usuari de sistema verdin, l'estat a /var/lib/verdin — darrere d'un proxy invers.
sidebar:
  order: 3
---

Aquesta pàgina executa Verdin directament en un servidor Debian o Ubuntu, sense contenidors, des
del paquet `.deb` adjunt a cada versió. La mateixa disposició funciona en altres distribucions amb
el binari de l'[script d'instal·lació](/ca/start/installation/) i els fitxers de
[`deploy/deb/`](https://github.com/verdin-cms/verdin/tree/main/deploy/deb) copiats a mà.

El paquet es va compilar i inspeccionar amb `cargo deb` el 2026-09-30; no es va instal·lar en un
servidor real per a aquesta guia.

## Què instal·la el paquet

| Camí | Què |
| --- | --- |
| `/usr/bin/verdin` | El binari (estàtic, amb el tauler d'administració integrat). |
| `/etc/verdin/verdin.toml` | La configuració (un conffile: les actualitzacions conserven les teves edicions). |
| `/etc/verdin/verdin.env` | Es crea en la primera instal·lació, mode `0640`: `VERDIN_ADMIN_JWT_SECRET` i `VERDIN_TOKEN_PEPPER` nous, i `VERDIN_DATABASE_URL` (SQLite per defecte). |
| `/var/lib/verdin/` | El directori d'inici de l'usuari de sistema `verdin`: la base de dades SQLite, `schema/`, `uploads/`, l'índex de cerca i la memòria cau d'imatges. |
| `/usr/lib/systemd/system/verdin.service` | El servei, instal·lat però no activat. |

El servei executa `verdin -c /etc/verdin/verdin.toml start --migrate` com a usuari `verdin`, amb
l'aïllament de systemd (sistema de només lectura, `/tmp` privat, sense nous privilegis) i accés
d'escriptura només a `/var/lib/verdin`. Escolta a `127.0.0.1:1337`.

## 1. Instal·la

```sh frame="terminal"
curl -fsSLO https://github.com/verdin-cms/verdin/releases/download/v0.11.0/verdin_0.11.0-1_amd64.deb
sudo apt install ./verdin_0.11.0-1_amd64.deb
```

Fes servir `arm64` al nom del fitxer en servidors ARM.

## 2. Configura

1. Copia el teu esquema confirmat a `/var/lib/verdin/schema/` (`content-types/` i
   `components/`), amb `verdin` com a propietari:

   ```sh frame="terminal"
   sudo rsync -a --chown=verdin:verdin schema/ /var/lib/verdin/schema/
   ```

2. Per a PostgreSQL, MySQL o MariaDB, edita `VERDIN_DATABASE_URL` a
   `/etc/verdin/verdin.env`. Conserva els dos secrets: un nou `VERDIN_TOKEN_PEPPER`
   invalida tots els tokens d'API.
3. A `/etc/verdin/verdin.toml`, defineix `[server].public_url` amb l'adreça que fan servir els
   navegadors, i `trusted_proxies = ["127.0.0.1"]` quan el proxy invers s'executa a la mateixa
   màquina. Totes les altres claus són a la [referència de configuració](/ca/reference/configuration/).

## 3. Inicia

```sh frame="terminal"
sudo systemctl enable --now verdin
journalctl -u verdin -f
```

El primer inici crea les taules. Crea el primer administrador des de la línia d'ordres (el fitxer
d'entorn del servei conté la URL de la base de dades):

```sh frame="terminal"
sudo -u verdin sh -c 'set -a; . /etc/verdin/verdin.env; verdin -c /etc/verdin/verdin.toml admin create --email you@example.com'
```

o obre el tauler d'administració a través del teu proxy i registra't allà.

## 4. Posa un proxy invers al davant

Verdin serveix HTTP pla a la interfície de loopback. Amb Caddy, que obté i renova el certificat
per si mateix:

```text title="/etc/caddy/Caddyfile"
cms.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:1337
}
```

nginx també funciona; desactiva la memòria intermèdia per a `/api/_events` perquè els
esdeveniments en temps real no es retinguin (`proxy_buffering off;`).

## Actualitzacions i eliminació

- **Actualitza:** instal·la el `.deb` de la versió següent amb `apt install ./verdin_….deb`. El
  servei es reinicia si s'estava executant, i `start --migrate` aplica les migracions segures.
  Llegeix primer [Actualitzar Verdin](/ca/migrate/upgrading/).
- **Elimina:** `apt remove verdin` atura el servei i conserva les dades i la
  configuració; `apt purge verdin` també elimina `/etc/verdin/verdin.env` (els
  secrets). El paquet mai elimina l'usuari `verdin` ni `/var/lib/verdin`:
  elimina'ls tu mateix quan tinguis una [còpia de seguretat](/ca/deploy/backups/).
