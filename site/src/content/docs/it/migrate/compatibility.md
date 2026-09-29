---
title: Compatibilità con Strapi
description: Quali funzionalità e API di Strapi v5 Verdin supporta, supporta in parte o non supporta — REST, GraphQL, utenti e permessi, upload, i18n, bozza e pubblicazione, estensioni con codice, il pannello di amministrazione e le funzionalità Enterprise.
sidebar:
  order: 2
---

Verdin mantiene il modello dei contenuti e le content API di Strapi v5 così che frontend e
contenuti possano migrare (vedi [Migrare da Strapi](/it/migrate/from-strapi/)). Non è un
sostituto immediato per una *codebase* Strapi: non c'è un runtime JavaScript, quindi il
codice personalizzato va ricostruito come plugin WebAssembly. Questa pagina elenca ogni area
con il suo stato, aggiornato a Verdin 0.10.0.

**Supportato** funziona come in Strapi v5 (con le differenze indicate). **Parziale** copre i
casi comuni; la nota dice cosa manca. **Non supportato** non ha un equivalente.

## Modello dei contenuti

| Funzionalità | Stato | Note |
| --- | --- | --- |
| Collection type e single type | Supportato | File di schema JSON vicini a quelli di Strapi (`schema/content-types/*.json`). Vedi [Modello dei contenuti](/it/concepts/content-model/). |
| Tipi di attributo scalari | Supportato | `string`, `text`, `richtext` (Markdown), `blocks`, `email`, `uid`, `integer`, `biginteger`, `float`, `decimal`, `boolean`, `date`, `time`, `datetime`, `enumeration`, `json`, `password`. Il `timestamp` di Strapi viene importato come `datetime`. |
| Componenti e zone dinamiche | Supportato | Compresi media e relazioni `oneWay`/`manyWay` dentro i componenti. |
| Relazioni | Supportato | One/many-to-one/many, one-way e many-way, e le polimorfiche `morphToOne`, `morphToMany`, `morphOne`, `morphMany`. |
| Campi media | Supportato | Singoli o multipli, `allowedTypes`. |
| `unique` | Parziale | Non sugli attributi `text`, `richtext`, `blocks` e `json`. |
| Campi condizionali (`conditions`) | Supportato | Le condizioni JSON Logic di Strapi 5.17; i campi nascosti non sono obbligatori. |
| Campi personalizzati | Parziale | Gli attributi `customField` funzionano; l'input dell'admin arriva da un [plugin](/it/extending/plugins/) Verdin, non dai plugin React di Strapi. |
| Costruttore di tipi di contenuto | Supportato | Solo in modalità sviluppo (`verdin dev`), come in Strapi. |

## API REST

| Funzionalità | Stato | Note |
| --- | --- | --- |
| Route CRUD | Supportato | `GET`/`POST /api/{pluralName}`, `GET`/`PUT`/`DELETE /api/{pluralName}/{documentId}`, single type su `/api/{singularName}`. Le risposte portano `data` e `meta`, gli errori l'oggetto `error` di Strapi. |
| `filters` | Supportato | Ogni operatore di Strapi: `$eq`, `$eqi`, `$ne`, `$nei`, `$lt`, `$lte`, `$gt`, `$gte`, `$in`, `$notIn`, `$contains`, `$notContains`, `$containsi`, `$notContainsi`, `$null`, `$notNull`, `$between`, `$startsWith(i)`, `$endsWith(i)`, `$and`, `$or`, `$not`; attraverso relazioni, componenti, componenti ripetibili e zone dinamiche (`__component`). |
| `sort` | Supportato | Più campi, `:asc`/`:desc`, e il campo di una relazione to-one (`author.name:asc`). |
| `pagination` | Supportato | `page`/`pageSize` o `start`/`limit`, `withCount`. `pageSize` è limitato a `[api].max_page_size` (100). |
| `fields` | Supportato | |
| `populate` | Supportato | `*`, liste, oggetti annidati, `on` per le zone dinamiche, `count`. Profondità fino a 5; al massimo 1.000 voci popolate per relazione. |
| `status` | Supportato | `published` (default) o `draft`; leggere le bozze richiede il permesso `readDrafts`. |
| `locale` | Supportato | Vedi i18n sotto. |
| `hasPublishedVersion` | Supportato | |
| Ricerca full-text `_q` | Supportato | `$containsi` sui campi di testo, come Strapi; ricerca ordinata per rilevanza con `[search]`. |
| Scritture delle relazioni | Supportato | ID, `connect` / `disconnect` / `set`, con `position` (`before`, `after`, `start`, `end`). |
| Pubblicare, annullare la pubblicazione, scartare la bozza | Supportato | Le scritture pubblicano a meno di `?status=draft`, come in Strapi v5. Verdin aggiunge `POST /api/{pluralName}/{documentId}/actions/{publish,unpublish,discard-draft}`. |
| Formato di risposta di Strapi v4 e `publicationState` | Non supportato | Verdin parla solo v5: attributi piatti, `documentId`, `status`. |
| Documento OpenAPI | Parziale | Su `/api/_openapi.json` (solo con token di default) e un riferimento interattivo su `/api/docs`, invece di `/documentation` del plugin di documentazione. |

## GraphQL

| Funzionalità | Stato | Note |
| --- | --- | --- |
| Query | Supportato | `articles`, `articles_connection` con `pageInfo`, `article(documentId)`, single type; `filters`, `sort`, `pagination`, `status`, `locale`. Disattivato finché non attivi **Impostazioni → Funzionalità → GraphQL**. |
| Mutation | Supportato | `create…`, `update…`, `delete…` con `status` e `locale`. |
| Componenti, zone dinamiche, media | Supportato | Zone dinamiche come union, media come `UploadFile`. |
| Relazioni polimorfiche | Parziale | Restituite come JSON, non come union tipizzate. |
| Shadow CRUD (disattivare operazioni per tipo) | Supportato | L'impostazione `disabled` della funzionalità. |
| Resolver personalizzati ed estensioni dello schema | Parziale | Campi radice risolti dai plugin (`[[graphql]]` in `plugin.toml`); niente `extensionService`. |
| Mutation di Users & Permissions (`login`, `register`, `me`…) | Non supportato | Usa le route REST. |
| Query/mutation di upload e i18n (`uploadFiles`, `i18NLocales`…) | Non supportato | Usa le route REST e il pannello di amministrazione. |
| Limiti, GraphiQL | Supportato | `maxDepth`, `maxComplexity`, interruttori per introspezione e playground. |

## Users & Permissions (utenti finali)

Attiva **Impostazioni → Funzionalità → Utenti e permessi**. Vedi
[Utenti finali](/it/guides/auth/end-users/).

| Funzionalità | Stato | Note |
| --- | --- | --- |
| `POST /api/auth/local`, `/auth/local/register` | Supportato | Stessa forma di richieste e risposte. |
| Conferma email, password dimenticata/reimpostazione/cambio | Supportato | `/auth/email-confirmation`, `/auth/send-email-confirmation`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/change-password`. |
| Refresh token | Supportato | `jwtManagement: "refresh"`, `/auth/refresh`, `/auth/logout`. |
| `/api/users`, `/users/me`, `/users/count` | Supportato | JSON semplice, permessi su `plugin::users-permissions.user`. |
| Provider OAuth | Parziale | GitHub, Google, Microsoft, Discord, Facebook, GitLab, LinkedIn e qualsiasi provider OAuth 2; non tutti i preset di Strapi. |
| Route di ruoli e permessi (`/api/users-permissions/roles`, `/permissions`) | Non supportato | Gestisci i ruoli in **Impostazioni → Utenti finali**. |
| Utenti importati | Supportato | Gli hash bcrypt continuano a funzionare; vengono ricalcolati con Argon2id all'accesso. |

## Libreria media e API di upload

| Funzionalità | Stato | Note |
| --- | --- | --- |
| `POST /api/upload` | Supportato | `files` e `fileInfo` multipart; `?id=` aggiorna le informazioni di un file, o sostituisce il file quando ne viene inviato uno. |
| Collegamento all'upload (`ref`, `refId`, `field`) | Non supportato | Carica, poi imposta il campo media con l'id del file. |
| `GET /api/upload/files`, `/files/{id}`, `DELETE /files/{id}` | Parziale | L'elenco accetta solo `pagination[page]`, `pagination[pageSize]`, `sort` e `filters[name][$containsi]`. |
| Formati responsive, breakpoint | Supportato | `thumbnail` più `[upload].breakpoints`. |
| Cartelle, punti focali, testo alternativo, didascalie | Supportato | |
| Provider di upload | Parziale | Disco locale e storage compatibile S3 (AWS, R2, B2, MinIO, Tigris…). Niente Cloudinary o altri pacchetti di provider. |
| Trasformazioni delle immagini | Solo Verdin | `/uploads/<file>?preset=…` e URL firmati (provider locale). |

## Internazionalizzazione

| Funzionalità | Stato | Note |
| --- | --- | --- |
| Tipi localizzati e campi non localizzati | Supportato | `pluginOptions.i18n.localized`, anche per attributo. |
| `?locale=` su REST, `locale` in GraphQL | Supportato | Una lingua sconosciuta è un `400`. |
| `localizations` nelle risposte | Non supportato | Leggi un'altra lingua con lo stesso `documentId` e `?locale=`. |
| `GET /api/i18n/locales` | Non supportato | Le lingue si gestiscono nell'admin (**Impostazioni → Internazionalizzazione**). |

## Bozza e pubblicazione

| Funzionalità | Stato | Note |
| --- | --- | --- |
| Versioni bozza e pubblicata per documento | Supportato | Per lingua. Vedi [Bozza e pubblicazione](/it/concepts/draft-and-publish/). |
| Scarto della bozza | Supportato | |
| Pubblicazione pianificata | Supportato | Tramite i [Rilasci](/it/guides/content/releases/). |

## Personalizzazione del server

| Strapi | Stato | Verdin |
| --- | --- | --- |
| Lifecycle hook, middleware del Document Service | Parziale | Hook before/after nei plugin WebAssembly, che possono modificare o rifiutare una scrittura. Niente JavaScript. |
| Controller, service e route personalizzati | Parziale | Route dei plugin sotto `/api/plugins/<name>/`. |
| Policy e middleware | Non supportato | Permessi e limiti di frequenza sono integrati. |
| Task cron | Parziale | Job dei plugin. |
| Document Service / Entity Service in JavaScript | Non supportato | Nessun runtime JavaScript. |
| Plugin npm dal marketplace di Strapi | Non supportato | |
| Webhook | Supportato | Firmati, ritentati e registrati; `entry.draft-discard` è `entry.discard-draft`. Vedi [Webhook](/it/guides/integrations/webhooks/). |
| Token API (sola lettura, accesso completo, personalizzati) | Supportato | Stessi tipi, scadenza opzionale, rigenerazione. |
| Transfer token, `strapi transfer` | Non supportato | Usa `verdin export` e `verdin import verdin`. |
| File di `strapi export` | Supportato (import) | `verdin import strapi`; gli export cifrati non vengono letti. |
| `config/*.js`, `.env` | Parziale | `verdin.toml` e variabili d'ambiente. |
| Tipi TypeScript | Supportato | `verdin types`. |
| Provider email | Parziale | SMTP, Resend e Postmark. |

## Pannello di amministrazione

| Funzionalità | Stato | Note |
| --- | --- | --- |
| Content manager, libreria media, costruttore di tipi di contenuto | Supportato | Un pannello Angular proprio, non l'admin React di Strapi. |
| Utenti admin, ruoli, ruoli personalizzati | Supportato | Super Admin, Editor e Author predefiniti, più ruoli personalizzati. |
| Permessi a livello di campo e di lingua | Supportato | |
| Condizioni RBAC | Parziale | Solo la condizione predefinita `is-creator`; nessuna condizione personalizzata. |
| Personalizzazione dell'admin (`src/admin/app`) | Parziale | Logo, favicon, titolo, colore d'accento e testi in `[admin.branding]`; widget e campi personalizzati dai plugin. Niente pagine personalizzate, injection zone o estensioni React. |
| API admin (`/admin/…`) | Non supportato | L'API admin di Verdin è propria; non costruirci sopra come su quella di Strapi. |
| Configurazione della vista di modifica e della vista a lista | Supportato | |

## Funzionalità Enterprise

In Verdin è tutto open source; queste sono funzionalità Enterprise o a pagamento in Strapi.

| Funzionalità di Strapi | Stato | Note |
| --- | --- | --- |
| SSO | Parziale | Provider OpenID Connect, con mappatura dei gruppi sui ruoli. Niente SAML o altre strategie passport. Vedi [Single sign-on](/it/guides/auth/sso/). |
| Log di audit | Supportato | Vedi [Log di audit](/it/guides/content/audit-logs/). |
| Flussi di revisione | Supportato | I ruoli per fase limitano chi sposta le voci *dentro* una fase, e una fase di pubblicazione richiesta si applica a ogni API. Vedi [Flussi di revisione](/it/guides/content/review-workflows/). |
| Rilasci | Supportato | Pianificati o immediati. |
| Cronologia dei contenuti | Supportato | `[history].max_versions` versioni per documento. |
| Anteprima e live preview | Supportato | URL di anteprima con token di breve durata, anteprima affiancata e [modifica visiva](/it/guides/frontend/visual-editing/). |
| Ruoli admin personalizzati | Supportato | Nessun limite al loro numero. |
