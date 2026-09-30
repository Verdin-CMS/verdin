---
title: Docker Compose en producció
description: Una recepta de Compose per a producció en un sol servidor — Verdin, PostgreSQL i Caddy amb HTTPS automàtic, i RustFS opcional per a multimèdia compatible amb S3.
sidebar:
  order: 3
---

[`deploy/compose/`](https://github.com/verdin-cms/verdin/tree/main/deploy/compose) és una
configuració ja preparada per a un sol servidor: Verdin i PostgreSQL en una xarxa privada, i Caddy
al davant amb un certificat que obté i renova per si mateix. Un fitxer d'override afegeix RustFS,
un emmagatzematge compatible amb S3 al mateix host, per a la multimèdia. [Docker](/ca/deploy/docker/)
explica la imatge que fan servir aquests fitxers.

Els fitxers es van comprovar amb `docker compose config` i `caddy validate` el 2026-09-30.

## Fitxers

| Fitxer | Què |
| --- | --- |
| `compose.yaml` | `verdin`, `db` (PostgreSQL 17) i `caddy`. Només Caddy publica ports (80, 443 i 443/udp per a HTTP/3). |
| `compose.s3.yaml` | Afegeix `rustfs` i una tasca d'una sola execució que crea el bucket `media` de lectura pública, i hi canvia el proveïdor de pujades de Verdin. |
| `Caddyfile` | TLS per a `$VERDIN_DOMAIN`, compressió, `/media/*` cap a RustFS i tota la resta cap a Verdin. |
| `.env.example` | Les variables que llegeix Compose: domini, correu d'ACME, etiqueta de la imatge, contrasenyes. |

## Configura-ho

Requisits previs: un servidor amb Docker, un registre DNS per al teu domini que hi apunti, i els
ports 80 i 443 oberts.

1. Copia el directori al servidor i omple `.env`:

   ```sh frame="terminal"
   cp .env.example .env                                  # VERDIN_DOMAIN, ACME_EMAIL
   echo "DB_PASSWORD=$(openssl rand -hex 24)" >> .env
   docker run --rm ghcr.io/verdin-cms/verdin:0.11 secrets > verdin.env
   ```

2. Posa el teu esquema confirmat a `schema/` (`content-types/` i `components/`). Es munta en mode
   de només lectura a `/app/schema`.
3. Inicia'l:

   ```sh frame="terminal"
   docker compose up -d
   docker compose logs -f verdin
   ```

4. Obre `https://<your domain>/admin/` i registra el primer administrador.

Mantén `.env` i `verdin.env` fora del control de versions, i fes-ne còpia de seguretat: un nou
`VERDIN_TOKEN_PEPPER` invalida tots els tokens d'API.

## Multimèdia a S3

Per defecte les pujades van al volum `verdin-data`. Per emmagatzemar-les a RustFS:

```sh frame="terminal"
echo "S3_SECRET_KEY=$(openssl rand -hex 24)" >> .env
docker compose -f compose.yaml -f compose.s3.yaml up -d
```

Caddy serveix aleshores els fitxers a `https://<your domain>/media/<key>`. Per a AWS S3,
Cloudflare R2 o un altre proveïdor, deixa fora els serveis de RustFS i defineix les variables
`VERDIN_UPLOAD__PROVIDER__*` i les credencials `AWS_*` amb els valors d'aquell proveïdor
(consulta [Emmagatzematge](/ca/internals/storage/)). Canviar un lloc existent no mou cap fitxer:
les pujades noves van al proveïdor nou.

## Notes

- **Adreces de client.** Verdin confia en `X-Forwarded-For` de la xarxa de Compose
  (`172.30.0.0/24`, fixada a `compose.yaml`), on Caddy és l'únic servidor intermediari. Canvia
  tots dos si aquest interval col·lisiona amb una de les teves xarxes.
- **Temps real.** Caddy transmet les respostes `text/event-stream` sense memòria intermèdia, de
  manera que els [esdeveniments en temps real](/ca/guides/frontend/realtime/) funcionen al seu
  darrere sense canvis.
- **Actualitzacions.** Canvia `VERDIN_VERSION` a `.env`, després `docker compose pull && docker compose up -d`.
  Llegeix primer [Actualitzar Verdin](/ca/migrate/upgrading/).
- **Còpies de seguretat.** Bolca PostgreSQL i conserva el volum `verdin-data` (o el bucket); consulta
  [Còpies de seguretat](/ca/deploy/backups/).
- **Ordres d'administració.** La imatge no té shell: `docker compose exec verdin verdin admin create --email you@example.com`.
