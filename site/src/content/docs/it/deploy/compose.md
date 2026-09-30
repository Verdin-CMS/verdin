---
title: Docker Compose in produzione
description: Una ricetta Compose per la produzione su un singolo server — Verdin, PostgreSQL e Caddy con HTTPS automatico, e RustFS opzionale per i media compatibili con S3.
sidebar:
  order: 3
---

[`deploy/compose/`](https://github.com/verdin-cms/verdin/tree/main/deploy/compose) è una
configurazione pronta per un singolo server: Verdin e PostgreSQL su una rete privata, e Caddy
davanti con un certificato che ottiene e rinnova da solo. Un file di override aggiunge RustFS,
uno store compatibile con S3 sullo stesso host, per i media. [Docker](/it/deploy/docker/)
spiega l'immagine che questi file usano.

I file sono stati verificati con `docker compose config` e `caddy validate` il 2026-09-30.

## File

| File | Cosa |
| --- | --- |
| `compose.yaml` | `verdin`, `db` (PostgreSQL 17) e `caddy`. Solo Caddy pubblica porte (80, 443 e 443/udp per HTTP/3). |
| `compose.s3.yaml` | Aggiunge `rustfs` e un job one-shot che crea il bucket `media` in lettura pubblica, e porta su di esso il provider di upload di Verdin. |
| `Caddyfile` | TLS per `$VERDIN_DOMAIN`, compressione, `/media/*` a RustFS e tutto il resto a Verdin. |
| `.env.example` | Le variabili che Compose legge: dominio, email ACME, tag dell'immagine, password. |

## Configurazione

Prerequisiti: un server con Docker, un record DNS per il tuo dominio che punti ad esso, e le
porte 80 e 443 aperte.

1. Copia la directory sul server e compila `.env`:

   ```sh frame="terminal"
   cp .env.example .env                                  # VERDIN_DOMAIN, ACME_EMAIL
   echo "DB_PASSWORD=$(openssl rand -hex 24)" >> .env
   docker run --rm ghcr.io/verdin-cms/verdin:0.11 secrets > verdin.env
   ```

2. Metti in `schema/` lo schema di cui hai fatto commit (`content-types/` e `components/`).
   Viene montato in sola lettura su `/app/schema`.
3. Avvialo:

   ```sh frame="terminal"
   docker compose up -d
   docker compose logs -f verdin
   ```

4. Apri `https://<your domain>/admin/` e registra il primo admin.

Tieni `.env` e `verdin.env` fuori dal controllo di versione, e fanne un backup: un nuovo
`VERDIN_TOKEN_PEPPER` invalida ogni token API.

## Media su S3

Di default gli upload vanno nel volume `verdin-data`. Per salvarli invece in RustFS:

```sh frame="terminal"
echo "S3_SECRET_KEY=$(openssl rand -hex 24)" >> .env
docker compose -f compose.yaml -f compose.s3.yaml up -d
```

I file vengono poi serviti da Caddy su `https://<your domain>/media/<key>`. Per AWS S3,
Cloudflare R2 o un altro provider, lascia fuori i servizi RustFS e imposta le variabili
`VERDIN_UPLOAD__PROVIDER__*` e le credenziali `AWS_*` ai valori di quel provider (vedi
[Storage](/it/internals/storage/)). Cambiare provider su un sito esistente non sposta alcun
file: i nuovi upload vanno al nuovo provider.

## Note

- **Indirizzi dei client.** Verdin si fida di `X-Forwarded-For` dalla rete Compose
  (`172.30.0.0/24`, fissata in `compose.yaml`), dove Caddy è l'unico proxy. Cambia entrambi
  se quell'intervallo collide con una delle tue reti.
- **Tempo reale.** Caddy trasmette le risposte `text/event-stream` senza buffering, quindi gli
  [eventi realtime](/it/guides/frontend/realtime/) funzionano dietro di esso senza modifiche.
- **Aggiornamenti.** Cambia `VERDIN_VERSION` in `.env`, poi `docker compose pull && docker compose up -d`.
  Leggi prima [Aggiornare Verdin](/it/migrate/upgrading/).
- **Backup.** Fai il dump di PostgreSQL e conserva il volume `verdin-data` (o il bucket); vedi
  [Backup](/it/deploy/backups/).
- **Comandi admin.** L'immagine non ha una shell: `docker compose exec verdin verdin admin create --email you@example.com`.
