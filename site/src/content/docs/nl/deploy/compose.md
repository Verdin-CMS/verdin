---
title: Docker Compose in productie
description: Een Compose-recept voor productie op één server — Verdin, PostgreSQL en Caddy met automatische HTTPS, en optioneel RustFS voor S3-compatibele media.
sidebar:
  order: 3
---

[`deploy/compose/`](https://github.com/verdin-cms/verdin/tree/main/deploy/compose) is een
kant-en-klare opstelling voor één server: Verdin en PostgreSQL op een privénetwerk, en Caddy
ervoor met een certificaat dat hij zelf ophaalt en vernieuwt. Een override-bestand voegt RustFS
toe, een S3-compatibele opslag op dezelfde host, voor media. [Docker](/nl/deploy/docker/) legt
het image uit dat deze bestanden gebruiken.

De bestanden zijn op 2026-09-30 gecontroleerd met `docker compose config` en `caddy validate`.

## Bestanden

| Bestand | Wat |
| --- | --- |
| `compose.yaml` | `verdin`, `db` (PostgreSQL 17) en `caddy`. Alleen Caddy publiceert poorten (80, 443 en 443/udp voor HTTP/3). |
| `compose.s3.yaml` | Voegt `rustfs` toe en een eenmalige job die de `media`-bucket met publieke leestoegang aanmaakt, en schakelt de uploadprovider van Verdin erop over. |
| `Caddyfile` | TLS voor `$VERDIN_DOMAIN`, compressie, `/media/*` naar RustFS en al het andere naar Verdin. |
| `.env.example` | De variabelen die Compose leest: domein, ACME-e-mailadres, image-tag, wachtwoorden. |

## Instellen

Vereisten: een server met Docker, een DNS-record van je domein dat ernaar wijst, en open poorten
80 en 443.

1. Kopieer de map naar de server en vul `.env` in:

   ```sh frame="terminal"
   cp .env.example .env                                  # VERDIN_DOMAIN, ACME_EMAIL
   echo "DB_PASSWORD=$(openssl rand -hex 24)" >> .env
   docker run --rm ghcr.io/verdin-cms/verdin:0.11 secrets > verdin.env
   ```

2. Zet je gecommitte schema in `schema/` (`content-types/` en `components/`). Het wordt
   alleen-lezen gemount op `/app/schema`.
3. Start het:

   ```sh frame="terminal"
   docker compose up -d
   docker compose logs -f verdin
   ```

4. Open `https://<your domain>/admin/` en registreer de eerste beheerder.

Houd `.env` en `verdin.env` buiten versiebeheer en maak er back-ups van: een nieuwe
`VERDIN_TOKEN_PEPPER` maakt elk API-token ongeldig.

## Media op S3

Standaard gaan uploads naar het volume `verdin-data`. Om ze in plaats daarvan in RustFS op te
slaan:

```sh frame="terminal"
echo "S3_SECRET_KEY=$(openssl rand -hex 24)" >> .env
docker compose -f compose.yaml -f compose.s3.yaml up -d
```

Bestanden worden dan door Caddy geserveerd op `https://<your domain>/media/<key>`. Voor AWS S3,
Cloudflare R2 of een andere provider laat je de RustFS-services weg en stel je de variabelen
`VERDIN_UPLOAD__PROVIDER__*` en de `AWS_*`-inloggegevens in op de waarden van die provider (zie
[Opslag](/nl/internals/storage/)). Een bestaande site overzetten verplaatst geen bestanden: nieuwe
uploads gaan naar de nieuwe provider.

## Opmerkingen

- **Clientadressen.** Verdin vertrouwt `X-Forwarded-For` van het Compose-netwerk
  (`172.30.0.0/24`, vast in `compose.yaml`), waar Caddy de enige proxy is. Wijzig beide als dat
  bereik botst met een van je netwerken.
- **Realtime.** Caddy streamt `text/event-stream`-responses zonder buffering, dus
  [realtime-events](/nl/guides/frontend/realtime/) werken er ongewijzigd achter.
- **Upgrades.** Wijzig `VERDIN_VERSION` in `.env`, en voer dan `docker compose pull && docker compose up -d` uit.
  Lees eerst [Upgraden](/nl/migrate/upgrading/).
- **Back-ups.** Dump PostgreSQL en bewaar het volume `verdin-data` (of de bucket); zie
  [Back-ups](/nl/deploy/backups/).
- **Admincommando's.** Het image heeft geen shell: `docker compose exec verdin verdin admin create --email you@example.com`.
