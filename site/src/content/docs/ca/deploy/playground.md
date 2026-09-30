---
title: Playground allotjat
description: Executa una demo pública de Verdin — l'exemple del blog sobre SQLite amb contingut de demostració i un compte de demo, esborrat i sembrat de nou cada hora — des de deploy/playground.
sidebar:
  order: 11
---

[`deploy/playground/`](https://github.com/verdin-cms/verdin/tree/main/deploy/playground)
construeix un contenidor per a una demo pública: l'[exemple del blog](https://github.com/verdin-cms/verdin/tree/main/examples/blog)
sobre SQLite, amb alguns articles publicats i un compte de demo amb el qual els visitants poden
iniciar sessió. Cada hora descarta la base de dades i comença de nou. El contenidor no necessita
cap volum, cap servidor de base de dades ni cap secret teu. On allotjar-lo depèn de tu; serveix
qualsevol plataforma que executi un contenidor amb una adreça HTTPS pública.

Els scripts es van executar contra una compilació local el 2026-09-30 (tres cicles de
reinici); la imatge es va compilar però no es va executar des d'una versió publicada.

## Què obtenen els visitants

- El tauler d'administració a `/admin/`, amb la sessió iniciada com a **demo@example.com** /
  **verdin-demo-1234**. El compte té el rol **Editor**: pot crear, editar, publicar i eliminar
  contingut i pujar multimèdia, però no pot gestionar usuaris, rols, tokens d'API, webhooks ni
  la configuració.
- Accés públic de lectura als articles, les categories, les etiquetes i la pàgina d'inici per
  REST (`/api/articles?populate=*`) i GraphQL.
- Dos articles publicats, un esborrany, dues categories, dues etiquetes i la pàgina d'inici.

També hi ha un Super Admin, amb una contrasenya aleatòria que ningú coneix.

## Com funciona

`run.sh` fa un bucle:

1. Elimina `/var/lib/verdin-playground` (base de dades, pujades, índex de cerca, memòria cau
   d'imatges) i genera secrets nous, de manera que les sessions del cicle anterior s'acaben.
2. Inicia `verdin start --migrate` i espera `/_ready`.
3. Executa `seed.sh`: crea els comptes a través de la CLI i l'API d'administració, obre l'accés
   públic de lectura i crea el contingut.
4. Espera `PLAYGROUND_RESET_SECONDS` (3600), atura el servidor i torna a començar. Si el
   servidor s'atura per si sol, torna a començar a l'instant.

La configuració (`deploy/playground/verdin.toml`) limita les pujades a 2 MB, limita la freqüència
de les peticions anònimes a 300 per minut per adreça, manté els enviaments de webhooks lluny de
les adreces privades i activa la cerca.

## Compila'l i executa'l

Des de l'arrel del repositori:

```sh frame="terminal"
docker build -f deploy/playground/Dockerfile -t verdin-playground .
docker run -p 1337:1337 --tmpfs /var/lib/verdin-playground:uid=65532,gid=65532 verdin-playground
```

La imatge és Alpine amb `curl` i `jq` (els scripts necessiten un shell, que la imatge oficial no
té) i el binari estàtic copiat de `ghcr.io/verdin-cms/verdin`. Passa
`--build-arg VERDIN_IMAGE=ghcr.io/verdin-cms/verdin:<version>` per triar la versió. El
`tmpfs` manté les dades en memòria; sense ell les dades viuen al sistema de fitxers del
contenidor, cosa que també funciona.

| Variable | Per defecte | Què |
| --- | --- | --- |
| `PLAYGROUND_RESET_SECONDS` | `3600` | Temps entre reinicis. |
| `PLAYGROUND_EMAIL`, `PLAYGROUND_PASSWORD` | `demo@example.com`, `verdin-demo-1234` | El compte de demo. |
| `VERDIN_SERVER__PUBLIC_URL` | | L'adreça pública del playground. |
| `VERDIN_SERVER__TRUSTED_PROXIES` | | L'interval del proxy de la plataforma, perquè els límits de freqüència s'apliquin per visitant. |

## Allotjar-lo

Executa exactament una instància (la base de dades és local), mantén-la en marxa (sense escalat a
zero: el temporitzador de reinici viu al procés) i posa HTTPS al davant: la cookie de sessió del
tauler d'administració és `Secure` en mode `start`, de manera que l'inici de sessió necessita
HTTPS. Qualsevol pot escriure contingut i pujar imatges durant fins a una hora, així que fes que
la pàgina que hi enllaça indiqui la programació dels reinicis, i mantén la instància en un domini
separat de qualsevol cosa que comparteixi cookies.
