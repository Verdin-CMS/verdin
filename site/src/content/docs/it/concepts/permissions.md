---
title: "Permessi"
description: "Il quadro generale del controllo degli accessi in Verdin: ruoli admin e RBAC con permessi su campi e lingue, il ruolo pubblico, i token API e i ruoli degli utenti finali."
sidebar:
  order: 6
---

Verdin controlla separatamente due pubblici: gli **admin**, che accedono al pannello di
amministrazione, e i **chiamanti della content API**, che leggono e scrivono contenuti dai
tuoi siti e dalle tue app. Questa pagina spiega come viene autorizzato ciascuno e come si
incastrano i pezzi. L'elenco completo delle azioni è nel
[riferimento dei permessi](/it/reference/permissions/).

| Chi | Si autentica con | I permessi arrivano da | Si applica a |
| --- | --- | --- | --- |
| Admin | Email e password (più un secondo fattore o SSO) | I suoi [ruoli](#ruoli-admin) | Pannello di amministrazione e [API admin](/it/api/admin/) |
| Chiamante anonimo | Nessun header `Authorization` | [Accesso pubblico](#accesso-pubblico) | REST, GraphQL, realtime |
| Server o build | `Authorization: Bearer vd_…` | Il tipo del [token API](#token-api) | REST, GraphQL, realtime |
| Utente finale autenticato | `Authorization: Bearer <JWT>` | Il suo [ruolo di utente finale](#utenti-finali) | REST, GraphQL, realtime |

Tutto è chiuso di default: la content API risponde `403` finché non concedi l'accesso, e un
admin può fare solo ciò che i suoi ruoli consentono.

## Ruoli admin

Un admin ha uno o più ruoli; i loro permessi si sommano. Tre ruoli sono predefiniti:

| Ruolo | Può |
| --- | --- |
| **Super Admin** | Tutto, inclusi utenti, ruoli e token API. Non può essere modificato. |
| **Editor** | Leggere, creare, aggiornare, eliminare e pubblicare tutti i contenuti; usare la libreria media; avviare deploy; gestire SEO, redirect, menu e form. |
| **Author** | Creare contenuti, e leggere, aggiornare ed eliminare solo le voci che ha creato. Non può pubblicare. Carica file e modifica o elimina solo i propri. |

Crei altri ruoli in **Impostazioni → Ruoli** (permesso `roles.manage`). L'ultimo Super Admin
attivo non può essere disattivato, eliminato o declassato, così l'istanza non si chiude mai
fuori da sola. Un ruolo può anche richiedere ai suoi membri di configurare
l'[autenticazione a due fattori](/it/guides/auth/two-factor/): finché non lo fanno, possono
accedere solo al proprio profilo.

### Cos'è un permesso

Un permesso è un'**azione**, un **oggetto** per le azioni sui contenuti, e **condizioni**
opzionali:

- **Azioni sui contenuti**: `content.read`, `content.create`, `content.update`,
  `content.delete` e `content.publish`, su un tipo di contenuto (`api::article`) o su tutti
  (`*`).
- **Azioni sui media**: `media.read`, `media.create`, `media.update` e `media.delete`, per
  la libreria media.
- **Azioni sulle impostazioni**, come `users.manage`, `tokens.manage`, `webhooks.manage` o
  `features.manage`, che aprono le pagine corrispondenti di **Impostazioni**.
- **Condizioni**: `is-creator` limita un permesso su contenuti o media a ciò che l'admin ha
  creato. È così che funziona il ruolo Author.

Le condizioni diventano parte della query al database: una lista filtrata da `is-creator`
conta e pagina correttamente, invece di nascondere le righe a posteriori.

### Permessi su campi e lingue

I permessi sui contenuti si possono restringere ulteriormente:

- **Campi.** `content.read`, `content.create` e `content.update` possono elencare gli
  attributi che coprono. I campi fuori dalla lista vengono nascosti nelle letture (incluse
  ricerca, filtri, ordinamento e voci collegate) e rifiutati nelle scritture.
- **Lingue.** Sui [tipi localizzati](/it/concepts/internationalization/), i permessi sui
  contenuti possono elencare le lingue che coprono. Le versioni in altre lingue non possono
  essere lette né modificate.

Entrambi si impostano per tipo di contenuto nell'editor del ruolo, sotto **Campi** e
**Lingue**.

## Content API

I chiamanti della content API vengono verificati rispetto ai permessi: un'**azione** su un
**oggetto**.

| Azione | Consente |
| --- | --- |
| `find` | Elencare documenti (`GET /api/articles`), o leggere un single type. |
| `findOne` | Leggere un documento (`GET /api/articles/{documentId}`). |
| `create` | `POST` |
| `update` | `PUT` |
| `delete` | `DELETE` |
| `publish` | Le route `actions/publish`, `actions/unpublish` e `actions/discard-draft`. |
| `readDrafts` | Leggere con `status=draft`. |

Gli oggetti sono i tipi di contenuto, la libreria media (`plugin::upload`) e gli account
degli utenti finali (`plugin::users-permissions.user`) quando gli
[utenti finali](/it/guides/auth/end-users/) sono attivi.

Alcune regole valgono per ogni chiamante:

- Leggere le bozze richiede `readDrafts` oltre a `find` o `findOne`. Un permesso che legge i
  contenuti del tuo sito non può leggere per errore il lavoro non pubblicato.
- Popolare, filtrare o ordinare attraverso una relazione richiede l'accesso in lettura al
  suo tipo di destinazione.
- I campi `private` non vengono mai restituiti, qualunque siano i permessi.
- Una scrittura restituisce il documento scritto anche senza `find`, come in Strapi.
- Gli stessi permessi si applicano a [GraphQL](/it/api/graphql/) e allo
  [stream realtime](/it/api/realtime/).

### Accesso pubblico

Le richieste senza header `Authorization` ricevono i permessi di **Impostazioni → Accesso
pubblico**. Di default non viene concesso nulla. Le scelte tipiche sono `find` e `findOne`
sui tipi mostrati dal tuo sito.

### Token API

I token API sono per server, step di build e script. Creali in **Impostazioni → Token API**
(permesso `tokens.manage`):

| Tipo | Permessi |
| --- | --- |
| **Sola lettura** | `find` e `findOne` su ogni tipo. Mai le bozze. |
| **Accesso completo** | Ogni azione su ogni tipo, bozze incluse. |
| **Personalizzato** | I permessi che scegli, come per l'accesso pubblico. |

- Un token inizia con `vd_`. Il suo segreto viene mostrato una sola volta, quando viene
  creato o rigenerato; Verdin ne memorizza solo un hash con chiave.
- I token possono scadere. Un token sconosciuto, scaduto o malformato è un `401`: non ricade
  mai sull'accesso pubblico.
- Qualsiasi token valido può leggere il documento OpenAPI su `/api/_openapi.json`, a meno
  che tu non renda pubblica la documentazione.

Vedi [Token API](/it/guides/auth/api-tokens/) per crearli e ruotarli.

### Utenti finali

Gli utenti finali sono le persone che accedono al tuo sito o alla tua app, come con il
plugin users-permissions di Strapi. La funzionalità è disattivata di default. Ogni account
ha un ruolo:

- **Public** è il ruolo delle richieste senza token: i suoi permessi sono quelli di
  **Impostazioni → Accesso pubblico**.
- **Authenticated** viene assegnato di default ai nuovi account.
- I ruoli personalizzati contengono qualsiasi insieme di permessi, con le stesse azioni
  viste sopra.

Un utente finale invia il JWT ricevuto all'accesso come `Authorization: Bearer <jwt>`.
Verdin lo distingue dai token API grazie al prefisso `vd_`. Vedi
[Utenti finali](/it/guides/auth/end-users/).

## Confronto con Strapi

Il modello segue Strapi v5: RBAC admin con condizioni `is-creator`, e una content API con
accesso pubblico, token API e ruoli users-permissions. Le differenze:

- Ogni funzionalità è disponibile per ogni progetto: ruoli personalizzati, permessi su campi
  e lingue, [SSO](/it/guides/auth/sso/) e [log di audit](/it/guides/content/audit-logs/).
- Leggere le bozze tramite la content API è un permesso a sé, `readDrafts`.
- Pubblicare via REST ha un permesso proprio, `publish`, e route proprie.
