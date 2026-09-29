---
title: Pannello di amministrazione
description: Com'è strutturato il pannello di amministrazione Angular di Verdin, come costruisce form e liste dallo schema, e come viene compilato, incorporato nel binario e tradotto.
sidebar:
  order: 6
  label: Pannello di amministrazione
---

Questa pagina è per chi contribuisce al pannello di amministrazione in `admin/`: com'è organizzata l'app Angular, come trasforma lo schema dei contenuti in form e liste, e come finisce dentro il binario `verdin`. Come usare il pannello è spiegato nelle guide; come funziona il lato server dell'API admin è nel [riferimento dell'API admin](/it/api/admin/).

Il pannello è una single-page app Angular 22: componenti standalone, change detection zoneless, signal, route caricate in lazy loading, e componenti spartan/ui su Tailwind CSS v4.

## Struttura

```text
admin/
├── src/app/
│   ├── app.config.ts     # providers: router, HttpClient interceptors, Transloco, icons
│   ├── app.routes.ts     # lazy routes, guards (auth, permissions, unsaved changes)
│   ├── core/             # services and pure models: api, auth, schema, i18n, permissions…
│   ├── layout/           # the shell (sidebar, header), home, deploy button
│   ├── features/
│   │   ├── auth/         # login, first admin, invitations, password reset
│   │   ├── dashboard/    # home widgets
│   │   ├── content/      # lists, the entry editor, history, releases, review, import
│   │   │   ├── fields/   # schema-driven form controls and the form model
│   │   │   └── collab/   # comments and tasks
│   │   ├── builder/      # content-type builder (verdin dev only)
│   │   ├── media/        # media library
│   │   ├── releases/
│   │   ├── profile/      # own account, two-factor, passkeys, sessions
│   │   └── settings/     # users, roles, tokens, webhooks, locales, plugins, site features…
│   └── shared/
│       ├── ui/           # spartan helm components, owned by the project
│       └── components/   # app-level shared components (confirm dialog, page header…)
├── public/i18n/          # translation catalogs, one JSON file per language
├── scripts/check-i18n.mjs
└── e2e/                  # Playwright tests and the server they run against
```

**Lo stato** vive in signal dentro service iniettabili in `core/` (`Auth`, `Schema`, `I18n`, `Theme`…). Non c'è una libreria di store.

**L'accesso all'API** passa da `core/api.ts`, un piccolo wrapper basato su promise sopra l'`HttpClient` di Angular, con tipi scritti a mano in `core/types.ts`. La configurazione di runtime (path dell'admin, prefisso dell'API, modalità, branding) arriva da un tag `<meta name="verdin-config">` che il server inietta.

**Sessione.** L'access token vive solo in memoria; il refresh token è un cookie `HttpOnly` limitato alle route di autenticazione. Un interceptor HTTP aggiunge il bearer token e, su un `401`, fa un refresh e riprova una volta; se il refresh fallisce manda l'utente alla pagina di login. Le richieste di refresh e logout portano l'header `X-Verdin-CSRF` richiesto dal server. Le guard ripristinano la sessione dal cookie al caricamento della pagina. Un `403` che dice che il ruolo richiede l'autenticazione a due fattori manda l'utente a configurarla.

## Form guidati dallo schema

L'editor delle voci (`features/content/edit.ts`) non ha codice per tipo. Legge tipi di contenuto e componenti da `GET /admin/api/content-types` e `GET /admin/api/components`, e il layout dell'editor dalle impostazioni della vista di modifica, e costruisce il form a runtime con i **Signal Forms** (`@angular/forms/signals`):

- Il modello del documento è un signal di un oggetto semplice (`FormModel` in `fields/model.ts`); l'albero dei campi e i suoi validatori derivano dallo schema.
- Un componente ricorsivo `vd-fields` (`fields/fields.ts`) mostra qualsiasi mappa di attributi rispetto a un albero di campi. Testo, date e orari usano input nativi collegati con `[formField]`. Dei `FormValueControl` personalizzati gestiscono numeri (nullable; i big integer restano stringhe), interruttori, enumerazioni, datetime (ora locale nell'input, UTC nel modello), JSON, Markdown, `blocks` (TipTap), media, relazioni (selettore con ricerca durante la digitazione e ordinamento) e relazioni polimorfiche.
- I componenti sono fieldset annidati; i componenti ripetibili e le zone dinamiche sono liste riordinabili. I plugin possono registrare tipi di campo personalizzati, mostrati come custom element.
- `toModel` converte un documento popolato nel modello del form (le relazioni diventano `documentId`, i file diventano id), e `toPayload` lo riconverte nel payload `data`: le stringhe vuote diventano `null`, le chiavi di rendering (`__key`) e i lati in sola lettura (`mappedBy`, `morphOne`, `morphMany`) vengono scartati. Entrambi hanno unit test in `fields/model.spec.ts`.
- La validazione derivata dallo schema dà un riscontro immediato. I campi condizionali (`conditions.visible`) vengono valutati nel browser da un port del valutatore JSON Logic del server (`core/logic.ts`). Le regole di validazione tra campi vengono verificate solo dal server. Il server resta l'autorità: le sue voci `details.errors[].path` vengono riportate sul campo corrispondente.
- Il salvataggio è esplicito, con tracciamento delle modifiche e un avviso all'uscita dalla pagina (una route guard più `beforeunload`). I pulsanti **Pubblica**, **Annulla pubblicazione** e **Scarta modifiche** compaiono in base allo stato del documento. L'admin salva solo bozze; la pubblicazione è sempre un'azione separata.

Il layout dell'editor (ordine dei campi, larghezze, etichette, descrizioni, campi in sola lettura, il campo che dà il nome alle voci collegate) è condiviso da tutti gli admin e memorizzato sul server in `vd_settings`, e si modifica dalla pagina **Configura la vista** con il permesso `views.manage`.

## Liste

Le liste dei contenuti (`features/content/list.ts`) usano la tabella helm di spartan con paginazione, ordinamento e filtri lato server. Filtri, ricerca (`_q`) e pagina si riflettono nell'URL, così una lista filtrata è un link condivisibile. Ogni admin sceglie le colonne visibili, l'ordinamento di default e la dimensione della pagina per tipo (`list-view.ts`); queste scelte vengono salvate nelle sue preferenze sul server, così lo seguono tra un browser e l'altro. Le liste si aggiornano anche in tempo reale dallo stream di eventi admin.

## Costruttore di tipi di contenuto

Il **Costruttore di tipi di contenuto** è visibile solo quando il server gira in modalità sviluppo (`verdin dev`) e l'admin ha `schema.manage`. Modifica tipi di contenuto e componenti nel loro formato di file: campi, tipi e target delle relazioni (creando l'attributo inverso sul target), componenti, zone dinamiche, lunghezze, intervalli, e i flag `required`, `unique` e `private`.

Ogni modifica viene prima inviata a `POST /admin/api/schema/plan`, che valida lo schema risultante e restituisce i passaggi della migrazione con il loro rischio, il loro SQL e i suggerimenti di rinomina che l'utente può accettare. La conferma chiama `POST /admin/api/schema/apply` con il livello di rischio e le rinomine accettati. Il server migra, scrive `schema/*.json`, e sostituisce l'app in esecuzione con il nuovo schema senza riavvio. Vedi [motore di migrazione](/it/internals/migrations/) per cosa succede sul server.

## Build e distribuzione

- `ng build` scrive la build di produzione in `admin/dist/admin/browser`, con `<base href="/admin/">`.
- Il server incorpora quella cartella con `rust-embed` quando viene compilato con la feature `embed-admin`, usata dalle build di release e dall'immagine Docker. Senza la feature, o quando `[admin].assets_dir` è impostato, serve i file dal disco. `assets_dir` prevale sulla build incorporata.
- Il server riscrive `<base href>` in `[admin].path` e inietta la configurazione di runtime come tag `<meta>`, non come script inline. Cambiare `admin.path` non richiede mai di ricompilare il pannello.
- I path sconosciuti senza estensione ricadono su `index.html` per il routing lato client. I bundle con fingerprint (`main-ABC123.js`) vengono messi in cache come `immutable` per un anno; tutto il resto è `no-cache`.
- Ogni risposta dell'admin porta una Content Security Policy rigorosa (`script-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`…), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` e `Referrer-Policy: strict-origin-when-cross-origin`. L'inlining del CSS critico di Angular è disattivato in `angular.json` perché si basa su event handler inline che la policy vieta.

Per lavorare sul frontend, avvia il server, poi `npm start` in `admin/`: `ng serve` fa da proxy di `/admin/api` e `/api` verso `http://localhost:1337` (`admin/proxy.conf.json`).

## Traduzioni

Il pannello viene tradotto a runtime con Transloco, non con l'i18n a compile time di Angular, così una sola build serve ogni lingua e gli utenti possono cambiarla senza ricaricare.

- I cataloghi sono file JSON piatti in `admin/public/i18n/` (`en.json` è la sorgente), caricati su richiesta.
- I messaggi usano ICU MessageFormat (`{name}`, `{count, plural, one {# entry} other {# entries}}`), interpretato da FormatJS (`intl-messageformat`) tramite un transpiler Transloco personalizzato. FormatJS interpreta i messaggi invece di compilarli in funzioni, così la CSP non ha bisogno di `unsafe-eval`.
- Le chiavi dei messaggi sono tipizzate da `en.json` (`core/i18n/keys.ts`): usare una chiave che non esiste è un errore di compilazione.
- `npm run i18n:check` verifica ogni catalogo rispetto a `en.json`: stesse chiavi, sintassi ICU valida, stessi argomenti, e ogni categoria plurale della lingua. La CI lo esegue.
- Il service `I18n` fornisce anche la formattazione in base alla lingua e il primo giorno della settimana, presi dalle impostazioni regionali del browser con la possibilità di personalizzarli per utente.

Come aggiungere o aggiornare una lingua è spiegato in [tradurre](/it/project/translating/).
