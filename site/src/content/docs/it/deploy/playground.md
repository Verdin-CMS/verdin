---
title: Playground ospitato
description: Esegui una demo pubblica di Verdin — l'esempio del blog su SQLite con contenuti e un account demo, azzerati e ricreati ogni ora — da deploy/playground.
sidebar:
  order: 11
---

[`deploy/playground/`](https://github.com/verdin-cms/verdin/tree/main/deploy/playground)
costruisce un container per una demo pubblica: l'[esempio del blog](https://github.com/verdin-cms/verdin/tree/main/examples/blog)
su SQLite, con alcuni articoli pubblicati e un account demo con cui i visitatori possono
accedere. Ogni ora butta via il database e ricomincia. Il container non ha bisogno di un
volume, di un server di database né di segreti da parte tua. Dove ospitarlo dipende da te;
va bene qualsiasi piattaforma che esegua un container con un indirizzo HTTPS pubblico.

Gli script sono stati eseguiti contro una build locale il 2026-09-30 (tre cicli di reset);
l'immagine è stata costruita ma non eseguita da una release pubblicata.

## Cosa ottengono i visitatori

- Il pannello di amministrazione su `/admin/`, con accesso come **demo@example.com** /
  **verdin-demo-1234**. L'account ha il ruolo **Editor**: può creare, modificare, pubblicare
  ed eliminare contenuti e caricare media, ma non può gestire utenti, ruoli, token API,
  webhook o impostazioni.
- Accesso pubblico in lettura a articoli, categorie, tag e homepage tramite REST
  (`/api/articles?populate=*`) e GraphQL.
- Due articoli pubblicati, una bozza, due categorie, due tag e la homepage.

Esiste anche un Super Admin, con una password casuale che nessuno conosce.

## Come funziona

`run.sh` è un ciclo:

1. Elimina `/var/lib/verdin-playground` (database, upload, indice di ricerca, cache delle
   immagini) e genera nuovi segreti, così le sessioni dell'ultimo ciclo terminano.
2. Avvia `verdin start --migrate` e attende `/_ready`.
3. Esegue `seed.sh`: crea gli account tramite la CLI e l'API admin, apre l'accesso pubblico
   in lettura e crea i contenuti.
4. Attende `PLAYGROUND_RESET_SECONDS` (3600), ferma il server e ricomincia. Se il server si
   ferma da solo, ricomincia subito.

La configurazione (`deploy/playground/verdin.toml`) limita gli upload a 2 MB, limita le
richieste anonime a 300 al minuto per indirizzo, tiene gli invii dei webhook lontani dagli
indirizzi privati e attiva la ricerca.

## Costruiscilo ed eseguilo

Dalla radice del repository:

```sh frame="terminal"
docker build -f deploy/playground/Dockerfile -t verdin-playground .
docker run -p 1337:1337 --tmpfs /var/lib/verdin-playground:uid=65532,gid=65532 verdin-playground
```

L'immagine è Alpine con `curl` e `jq` (gli script hanno bisogno di una shell, che l'immagine
ufficiale non ha) e il binario statico copiato da `ghcr.io/verdin-cms/verdin`. Passa
`--build-arg VERDIN_IMAGE=ghcr.io/verdin-cms/verdin:<version>` per scegliere la release.
Il `tmpfs` tiene i dati in memoria; senza, i dati vivono nel filesystem del container, il che
funziona comunque.

| Variabile | Default | Cosa |
| --- | --- | --- |
| `PLAYGROUND_RESET_SECONDS` | `3600` | Tempo tra un reset e l'altro. |
| `PLAYGROUND_EMAIL`, `PLAYGROUND_PASSWORD` | `demo@example.com`, `verdin-demo-1234` | L'account demo. |
| `VERDIN_SERVER__PUBLIC_URL` | | L'indirizzo pubblico del playground. |
| `VERDIN_SERVER__TRUSTED_PROXIES` | | L'intervallo del proxy della piattaforma, così i limiti di frequenza si applicano per visitatore. |

## Ospitarlo

Esegui esattamente un'istanza (il database è locale), tienila sempre in esecuzione (niente
scale to zero: il timer del reset vive nel processo) e metti HTTPS davanti: il cookie di
sessione del pannello di amministrazione è `Secure` in modalità `start`, quindi l'accesso
richiede HTTPS. Chiunque può scrivere contenuti e caricare immagini per un massimo di un'ora,
quindi indica nella pagina che rimanda al playground la pianificazione dei reset, e tieni
l'istanza su un dominio separato da qualsiasi cosa condivida i cookie.
