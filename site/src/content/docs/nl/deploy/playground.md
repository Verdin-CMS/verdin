---
title: Gehoste playground
description: Draai een openbare demo van Verdin — het blogvoorbeeld op SQLite met democontent en een demoaccount, elk uur gewist en opnieuw geseed — vanuit deploy/playground.
sidebar:
  order: 11
---

[`deploy/playground/`](https://github.com/verdin-cms/verdin/tree/main/deploy/playground)
bouwt een container voor een openbare demo: het [blogvoorbeeld](https://github.com/verdin-cms/verdin/tree/main/examples/blog)
op SQLite, met een paar gepubliceerde artikelen en een demoaccount waarmee bezoekers kunnen
inloggen. Elk uur gooit hij de database weg en begint opnieuw. De container heeft geen volume,
geen databaseserver en geen geheimen van jou nodig. Waar je hem host, is aan jou; elk platform dat
één container met een openbaar HTTPS-adres draait, werkt.

De scripts zijn op 2026-09-30 uitgevoerd tegen een lokale build (drie resetcycli); het image is
gebouwd maar niet gedraaid vanuit een gepubliceerde release.

## Wat bezoekers krijgen

- Het beheerpaneel op `/admin/`, ingelogd als **demo@example.com** / **verdin-demo-1234**.
  Het account heeft de rol **Editor**: het kan content aanmaken, bewerken, publiceren en
  verwijderen en media uploaden, maar kan geen gebruikers, rollen, API-tokens, webhooks of
  instellingen beheren.
- Openbare leestoegang tot artikelen, categorieën, tags en de homepage via REST
  (`/api/articles?populate=*`) en GraphQL.
- Twee gepubliceerde artikelen, een concept, twee categorieën, twee tags en de homepage.

Er bestaat ook een Super Admin, met een willekeurig wachtwoord dat niemand kent.

## Hoe het werkt

`run.sh` draait in een lus:

1. Verwijdert `/var/lib/verdin-playground` (database, uploads, zoekindex, afbeeldingscache) en
   genereert nieuwe geheimen, zodat sessies van de vorige cyclus eindigen.
2. Start `verdin start --migrate` en wacht op `/_ready`.
3. Draait `seed.sh`: maakt de accounts aan via de CLI en de admin-API, opent openbare
   leestoegang en maakt de content aan.
4. Wacht `PLAYGROUND_RESET_SECONDS` (3600), stopt de server en begint opnieuw. Als de
   server zelf stopt, begint hij meteen opnieuw.

De configuratie (`deploy/playground/verdin.toml`) beperkt uploads tot 2 MB, limiteert anonieme
requests tot 300 per minuut per adres, houdt webhook-afleveringen weg van privéadressen en zet
zoeken aan.

## Bouwen en draaien

Vanaf de root van de repository:

```sh frame="terminal"
docker build -f deploy/playground/Dockerfile -t verdin-playground .
docker run -p 1337:1337 --tmpfs /var/lib/verdin-playground:uid=65532,gid=65532 verdin-playground
```

Het image is Alpine met `curl` en `jq` (de scripts hebben een shell nodig, die het officiële image
niet heeft) en de statische binary gekopieerd van `ghcr.io/verdin-cms/verdin`. Geef
`--build-arg VERDIN_IMAGE=ghcr.io/verdin-cms/verdin:<version>` mee om de release te kiezen. De
`tmpfs` houdt de gegevens in het geheugen; zonder die staan de gegevens in het bestandssysteem van
de container, wat ook werkt.

| Variabele | Standaard | Wat |
| --- | --- | --- |
| `PLAYGROUND_RESET_SECONDS` | `3600` | Tijd tussen resets. |
| `PLAYGROUND_EMAIL`, `PLAYGROUND_PASSWORD` | `demo@example.com`, `verdin-demo-1234` | Het demoaccount. |
| `VERDIN_SERVER__PUBLIC_URL` | | Het openbare adres van de playground. |
| `VERDIN_SERVER__TRUSTED_PROXIES` | | Het bereik van de proxy van het platform, zodat rate limits per bezoeker gelden. |

## Hosten

Draai precies één instantie (de database is lokaal), houd hem draaiend (niet naar nul schalen: de
resettimer leeft in het proces) en zet HTTPS ervoor: de sessiecookie van het beheerpaneel is
`Secure` in de modus `start`, dus inloggen vereist HTTPS. Iedereen kan tot een uur lang content
schrijven en afbeeldingen uploaden, dus laat de pagina die ernaar linkt naar het resetschema
verwijzen, en houd de instantie op een domein dat los staat van alles wat cookies deelt.
