---
title: Checklist per la produzione
description: Cosa impostare prima che un progetto Verdin riceva traffico reale — segreti, database, migrazioni, URL, proxy, cookie, CORS, storage dei media, email, backup e monitoraggio.
sidebar:
  order: 1
---

Scorri questa lista prima di mettere un progetto Verdin davanti a utenti reali. Ogni voce
rimanda alla pagina che la spiega. Le pagine delle piattaforme ([Docker](/it/deploy/docker/),
[Fly.io](/it/deploy/fly/), [Render](/it/deploy/render/), [Railway](/it/deploy/railway/),
[Kubernetes](/it/deploy/kubernetes/)) applicano queste impostazioni per te dove possono.

## Esegui il server di produzione

- [ ] **Usa `verdin start`, non `verdin dev`.** `dev` permette al costruttore di tipi di
      contenuto di riscrivere i file dello schema, applica le migrazioni a ogni modifica e
      allenta le regole su cookie e webhook per il lavoro in locale. Modifica lo schema in
      sviluppo, fai commit dei file e distribuiscili.
- [ ] **Applica le migrazioni al momento del deploy.** `verdin start` si rifiuta di partire
      finché il database è indietro rispetto allo schema. `verdin start --migrate` applica
      prima i passaggi *sicuri* in sospeso (è il comando di default dell'immagine Docker). I
      passaggi rischiosi o distruttivi (cambi di tipo, nuovi vincoli di unicità, colonne
      eliminate) richiedono `verdin migrate apply --allow risky|destructive`, eseguito una
      volta da te. Vedi [Migrazioni dello schema](/it/concepts/schema-migrations/).
- [ ] **Distribuisci lo schema con il server.** Monta la directory `schema/` in sola lettura,
      o includila nella tua immagine, così ciò che gira è ciò di cui hai fatto commit.

## Segreti

- [ ] **Genera una volta i due segreti obbligatori** con `verdin secrets` e tienili nel
      secret store della tua piattaforma: `VERDIN_ADMIN_JWT_SECRET` firma i token di
      sessione, e `VERDIN_TOKEN_PEPPER` fa da chiave per gli hash dei token API e degli
      altri segreti memorizzati. `verdin start` fallisce se uno dei due manca o è più corto
      di 32 byte. I segreti vengono letti solo dall'ambiente, mai da `verdin.toml`.
- [ ] **Mantienili stabili.** Cambiare `VERDIN_TOKEN_PEPPER` fa smettere di funzionare
      ogni token API, e anche i codici delle app di autenticazione e i codici di recupero
      degli admin. Cambiare `VERDIN_ADMIN_JWT_SECRET` invalida gli access token di breve
      durata di admin e utenti finali, i link di anteprima aperti e gli accessi OAuth in
      corso (il pannello di amministrazione e i client con refresh token li rinnovano da
      soli). Tutte le istanze di un progetto richiedono gli stessi valori.
- [ ] Metti nell'ambiente anche gli altri segreti che usi: `VERDIN_EMAIL_SMTP_PASSWORD`
      o `VERDIN_EMAIL_API_KEY`, `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`,
      `VERDIN_METRICS_TOKEN`, `VERDIN_SSO_<ID>_SECRET`, `VERDIN_IMAGE_SECRET`. L'elenco
      completo è nel [riferimento della configurazione](/it/reference/configuration/).

## Database

- [ ] **Scegli il motore.** PostgreSQL (14 o successivo) è la scelta abituale ed è quello
      da scegliere se eseguirai [più istanze](/it/deploy/scaling/). MySQL 8.4+ e MariaDB
      10.11+ funzionano allo stesso modo. SQLite è adatto a una singola istanza con un disco
      persistente.
- [ ] **Imposta `VERDIN_DATABASE_URL`**: `postgres://…`, `mysql://…` (MySQL e MariaDB) o
      `sqlite:///data/verdin.db`. Aggiungi `?sslmode=require` per i server PostgreSQL che
      richiedono TLS.
- [ ] **Dimensiona il pool.** Ogni istanza apre fino a `[database].pool_max` connessioni
      (10). Mantieni `instances × pool_max` sotto il limite di connessioni del server.

## URL, proxy e cookie

- [ ] **Servi via HTTPS.** Verdin parla HTTP semplice; termina il TLS su un reverse proxy,
      un load balancer o l'edge della tua piattaforma.
- [ ] **Imposta `[server].public_url`** (`VERDIN_SERVER__PUBLIC_URL`) all'indirizzo usato
      dai browser, come `https://cms.example.com`. Ne dipendono i link nelle email, i
      callback SSO, il digest giornaliero e le passkey; le passkey sono legate al suo host.
- [ ] **Imposta `[server].trusted_proxies`** con gli indirizzi dei tuoi reverse proxy (IP o
      intervalli CIDR). Solo allora Verdin legge l'indirizzo del client da
      `X-Forwarded-For`; senza, ogni client dietro il proxy condivide un unico indirizzo per
      limiti di frequenza e log di audit.
- [ ] **Lascia attivi i cookie sicuri.** In `verdin start` il cookie di refresh dell'admin
      è `Secure` di default. Lascia `[admin].secure_cookies` non impostato; impostarlo a
      `false` in produzione registra un avviso all'avvio.

## API

- [ ] **Concedi solo ciò che serve al pubblico.** La content API è chiusa finché non
      concedi permessi pubblici (**Impostazioni → Accesso pubblico**) o crei token API. Vedi
      [Permessi](/it/concepts/permissions/).
- [ ] **Imposta `[api].cors_origins`** se un browser su un'altra origine chiama la content
      API o GraphQL, per esempio `["https://www.example.com"]`. Senza, solo le pagine della
      stessa origine possono chiamarle da un browser. L'API admin non risponde mai a
      richieste cross-origin.
- [ ] **Valuta dei limiti di frequenza** per il traffico anonimo: `[api].public_rate_limit`
      e `[api].token_rate_limit` (richieste al minuto; `0`, il default, è illimitato).

## Media

- [ ] **Memorizza gli upload dove sopravvivono a un nuovo deploy.** Il provider locale di
      default scrive su disco: dagli un volume persistente, o usa il provider S3 (AWS S3,
      Cloudflare R2, Backblaze B2, MinIO, Tigris…). Sulle piattaforme con dischi effimeri, e
      con più istanze, usa S3. Vedi [Media](/it/concepts/media/).

## Email

- [ ] **Configura un provider reale.** Il default `[email].provider = "log"` scrive le email
      nel log, e `verdin start` lo segnala. Inviti, reimpostazioni della password, conferme
      degli utenti finali, menzioni nei commenti e il digest richiedono `smtp`, `resend` o
      `postmark`, e `[email].from` impostato su un indirizzo accettato dal tuo provider.

## Backup e monitoraggio

- [ ] **Fai il backup del database e dello storage dei media** a intervalli regolari, e prova
      un ripristino. Vedi [Backup](/it/deploy/backups/).
- [ ] **Punta gli health check su `/_ready`** e i check di liveness su `/_health`.
- [ ] **Scrivi i log in JSON** (`[log].format = "json"`, il default dell'immagine Docker) e
      raccogli lo standard error.
- [ ] **Fai lo scrape di `/_metrics`** se usi Prometheus, con un `VERDIN_METRICS_TOKEN`.
      Vedi [Monitoraggio](/it/deploy/monitoring/).

## Prima di andare online

- [ ] Registra tu stesso il primo admin subito dopo il primo avvio: finché non esiste un
      admin, chiunque raggiunga `/admin/` può registrarsi come Super Admin. Puoi anche
      crearlo dalla riga di comando con `verdin admin create --email …`.
- [ ] Rivedi il [modello di sicurezza](/it/deploy/security/) e attiva
      l'[autenticazione a due fattori](/it/guides/auth/two-factor/) per i Super Admin.
