---
title: Cos'è Verdin
description: Verdin è un CMS headless open source scritto in Rust, con content API compatibili con Strapi v5 e un pannello di amministrazione in un unico binario.
sidebar:
  order: 1
  label: Introduzione
---

Verdin è un CMS headless open source scritto in Rust. Tu modelli i tipi di contenuto, i
tuoi redattori scrivono e pubblicano in un pannello di amministrazione, e i tuoi siti e le
tue app leggono i contenuti tramite un'API REST o GraphQL. Verdin non genera le pagine: lo
fa il tuo frontend.

È una riscrittura di [Strapi v5](https://strapi.io): il formato dello schema e la content
API hanno la stessa forma, quindi un progetto Strapi e il suo frontend possono migrare con
poche modifiche.

## A chi è rivolto

- **Sviluppatori che costruiscono un sito o un'app** e vogliono un CMS da eseguire come un
  unico processo, con il modello dei contenuti in git, leggibile da qualsiasi frontend:
  Astro, Next.js, un'app mobile.
- **Team su Strapi** che vogliono la stessa API con un ingombro minore, o hanno bisogno di
  funzionalità che Strapi riserva ai piani a pagamento. Verdin non ha un'edizione
  enterprise: SSO, log di audit, flussi di revisione e rilasci fanno parte del progetto
  open source.
- **Redattori**, che hanno bozze, pubblicazione, cronologia e anteprime in un pannello di
  amministrazione disponibile in 18 lingue.

## Cosa c'è dentro

Un solo eseguibile, `verdin`, è il server, lo strumento a riga di comando e il pannello di
amministrazione. In produzione non c'è un runtime Node.js né `node_modules`.

| Area | Cosa ottieni |
| --- | --- |
| Database | PostgreSQL 14+, MySQL 8.4+, MariaDB 10.11+ e SQLite, coperti dalla stessa suite di test. |
| Modello dei contenuti | Collection type, single type, componenti, zone dinamiche, relazioni, media, rich text in Markdown o nel formato blocks di Strapi. Lo schema è fatto di file JSON nel tuo progetto. |
| Modifiche allo schema | Ogni modifica diventa un piano di migrazione con un livello di rischio e l'SQL esatto. I passaggi distruttivi vengono eseguiti solo se li consenti. |
| API | REST sotto `/api` con i parametri di Strapi v5 (`filters`, `populate`, `sort`, `pagination`), un endpoint GraphQL opzionale, un documento OpenAPI e un client TypeScript tipizzato. |
| Editing | Bozza e pubblicazione, contenuti localizzati, cronologia dei contenuti, rilasci, flussi di revisione, commenti e attività, presenza in tempo reale, anteprima e modifica visiva sul tuo sito. |
| Accesso | Ruoli admin fino al livello di campi e lingue, token API, permessi di accesso pubblico, SSO con OpenID Connect, accesso a due fattori con passkey, log di audit. |
| Funzionalità per il sito | Ricerca full-text, sitemap, redirect, menu e form, webhook, aggiornamenti in tempo reale. |
| Estensioni | Plugin WebAssembly che si agganciano alle scritture, aggiungono route e job, e portano widget dell'admin e campi personalizzati, limitati alle capability che dichiarano. |

## Rapporto con Strapi v5

**Uguale:**

- I file dello schema usano il formato di Strapi: `schema/content-types/<singularName>.json` e
  `schema/components/<category>/<name>.json`.
- La content API REST: route, il formato di risposta piatto con `documentId`, parametri di
  query e operatori, semantica delle scritture (un `POST` o `PUT` pubblica a meno che tu non
  passi `?status=draft`), corpi degli errori.
- Lo schema GraphQL ha la stessa forma del plugin GraphQL di Strapi v5.
- Gli utenti finali (registrazione, accesso, OAuth, ruoli) seguono l'API di
  `users-permissions`.

**Diverso:**

- **Le modifiche allo schema sono migrazioni pianificate.** Verdin confronta i file dello
  schema con il database e ti mostra i passaggi prima di eseguirli. `verdin start` si
  rifiuta di partire finché il database è indietro rispetto allo schema.
- **Il costruttore di tipi di contenuto funziona solo in modalità sviluppo.** In produzione
  lo schema arriva dal tuo repository.
- **I plugin sono WebAssembly, non JavaScript.** I plugin di Strapi, e controller, service o
  file di lifecycle personalizzati in `src/`, non girano in Verdin.
- **Il database non è condiviso con Strapi.** Porti un progetto Strapi con
  `verdin import strapi`, che assegna un nuovo id a ogni documento.
- **Qualche extra rispetto a REST**: azioni di pubblicazione e rimozione dalla pubblicazione
  (`POST /api/<route>/<documentId>/actions/publish`), e un componente popolato viene
  restituito per intero, componenti annidati inclusi.

[Compatibilità con Strapi](/it/migrate/compatibility/) elenca le differenze in dettaglio.

## Quando non usarlo

- **Dipendi da plugin di Strapi o da codice server personalizzato in JavaScript.** Verdin
  non può eseguirli; dovresti riscriverli come plugin WebAssembly o spostare la logica
  altrove.
- **Ti serve una 1.0 stabile.** Verdin è alla 0.10: le release minori possono ancora
  cambiare configurazione e comportamento. Leggi [Aggiornare](/it/migrate/upgrading/) prima
  di ognuna.
- **Vuoi che sia il CMS a generare le pagine.** Verdin è headless; abbinalo a un framework
  frontend o a un generatore di siti statici.
- **Vuoi un servizio gestito.** Verdin è self-hosted: esegui il binario o l'immagine Docker
  sulla tua infrastruttura.

## Dove andare dopo

- [Quickstart](/it/start/quickstart/): avvia Verdin e leggi la tua prima voce dall'API.
- [Tutorial: un blog con Astro](/it/start/tutorial-astro/) o
  [con Next.js](/it/start/tutorial-nextjs/): costruisci un frontend sul blog di esempio.
- [Modello dei contenuti](/it/concepts/content-model/): tipi di contenuto, campi e come
  vengono memorizzati.
- [Importare un progetto Strapi](/it/migrate/from-strapi/): porta un progetto esistente.
