---
title: Sicurezza
description: Come Verdin protegge il pannello di amministrazione, la content API e il server, quali impostazioni rafforzano un'istanza di produzione, e come segnalare una vulnerabilità.
sidebar:
  order: 2
---

Questa pagina descrive cosa fa Verdin per proteggere un progetto e le impostazioni che
controlli tu. Usala insieme alla [checklist per la produzione](/it/deploy/production-checklist/)
quando prepari un'istanza per il traffico reale.

## Cosa è chiuso di default

- **La content API.** Le richieste anonime non ricevono nulla finché non concedi permessi
  pubblici in **Impostazioni → Accesso pubblico**. Un token sconosciuto, scaduto o malformato
  è un `401`, mai un ripiego sul ruolo pubblico. Vedi [Permessi](/it/concepts/permissions/).
- **Il documento OpenAPI** su `/api/_openapi.json` richiede un token API valido finché non
  lo rendi pubblico in **Impostazioni → Funzionalità → Documentazione dell’API**.
- **Le funzionalità opzionali** come GraphQL, utenti finali, SSO e il server MCP restano
  disattivate finché un admin con il permesso `features.manage` non le attiva in
  **Impostazioni → Funzionalità**.
- **I plugin** restano disattivati finché un admin non li attiva uno per uno in
  **Impostazioni → Plugin**.
- **Chiamate cross-origin dal browser.** Nessuna origine può chiamare un'API da un browser
  finché non la elenchi in `[api].cors_origins`.

## Accesso degli admin

| Protezione | Dettagli |
| --- | --- |
| Hash delle password | Argon2id con i parametri OWASP, ricalcolato quando cambiano. |
| Sessioni | Un access token di 15 minuti tenuto nella memoria della pagina (mai in `localStorage`), e un refresh token di 30 giorni in un cookie `HttpOnly`, `SameSite=Strict` limitato a `/admin/api/auth`. Il refresh token ruota a ogni uso; presentarne uno vecchio chiude l'intera sessione. |
| Cookie sicuri | Il cookie di refresh è `Secure` in `verdin start`. `[admin].secure_cookies = false` lo disattiva e registra un avviso. |
| CSRF | Refresh e uscita richiedono un header `X-Verdin-CSRF`, che un form cross-site non può inviare. |
| Blocco | Cinque tentativi falliti bloccano un account per 15 minuti. I fallimenti si sommano tra il passaggio della password e quello del secondo fattore. Email sconosciute e password errate ricevono la stessa risposta, nello stesso tempo. |
| Limite di frequenza | Accesso, registrazione e refresh: `[admin].auth_rate_limit` richieste al minuto per indirizzo del client (20). |
| Secondo fattore | App di autenticazione (TOTP) e passkey, con codici di recupero. Un ruolo può richiederlo (`requireTwoFactor`). Vedi [Autenticazione a due fattori](/it/guides/auth/two-factor/). |
| Super Admin | Solo un Super Admin può creare, modificare, eliminare o reimpostare un Super Admin, o assegnare quel ruolo. L'ultimo Super Admin attivo non può essere rimosso. |

Il primo admin si registra tramite il pannello finché non esiste nessun admin. Fallo subito
dopo il primo avvio, o crealo con `verdin admin create --email …` prima di esporre il
server.

## Pannello di amministrazione e API admin

- L'API admin (`/admin/api`) non invia header CORS, qualunque cosa dica `[api].cors_origins`:
  i browser permettono di leggere le sue risposte solo all'origine del pannello.
- Il pannello è servito con una Content Security Policy rigorosa (script solo dalla sua
  origine), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` e
  `Referrer-Policy: strict-origin-when-cross-origin`.
- Verdin non invia `Strict-Transport-Security`. Aggiungilo sul reverse proxy che termina il
  TLS.

## Content API

- **I token API** vengono mostrati una volta sola. Verdin memorizza un HMAC-SHA256 di ogni
  token, con chiave `VERDIN_TOKEN_PEPPER`, e conserva un prefisso di 10 caratteri per la
  visualizzazione. I token possono scadere e possono essere rigenerati.
- **I permessi su campi e lingue** limitano ciò che un ruolo legge e scrive, e `populate`,
  filtri e ordinamenti sulle relazioni raggiungono solo i tipi che il chiamante può leggere.
- **Limiti delle query**: `pageSize` fino a `[api].max_page_size` (100), profondità del
  `populate` fino a 5, al massimo 100 condizioni di filtro, query string fino a 16 KB, e al
  massimo 1.000 voci popolate per relazione. Campi sconosciuti o privati in una query sono
  un `400`.
- **GraphQL** ha i propri limiti di profondità e complessità (`maxDepth`, `maxComplexity`)
  e un interruttore per l'introspezione nelle impostazioni della funzionalità.
- **Limiti di frequenza**: `[api].public_rate_limit` per indirizzo del client senza token e
  `[api].token_rate_limit` per token API o utente finale, in richieste al minuto. Entrambi
  sono disattivati (`0`) di default. Le richieste con un bearer token sconosciuto sono
  limitate per indirizzo.

### CORS

`[api].cors_origins` elenca le origini dei browser autorizzate a chiamare la content API e
GraphQL:

```toml title="verdin.toml"
[api]
cors_origins = ["https://www.example.com", "https://preview.example.com"]
```

Ogni voce è `scheme://host[:port]` senza path né slash finale; `["*"]` consente qualsiasi
origine e non si può combinare con altre. I metodi consentiti sono `GET`, `POST`, `PUT` e
`DELETE`, e gli header di richiesta consentiti `Authorization`, `Content-Type` e
`If-None-Match`. L'avvio fallisce su una voce che non è un'origine.

I frontend lato server (Astro, Next.js sul server) chiamano l'API senza browser e non
hanno bisogno di una voce CORS.

## Richieste e upload

| Impostazione | Default | Protegge da |
| --- | --- | --- |
| `[server].body_limit` | `"1mb"` | Corpi di richiesta grandi sulle API normali. |
| `[server].request_timeout_secs` | `30` | Richieste lente che tengono occupate le connessioni. |
| `[upload].max_file_size` | 200 MB | Upload grandi (gli upload hanno un limite proprio al posto di `body_limit`). |
| `[upload].max_image_megapixels` | `100` | Decompression bomb. |

Il tipo di un file caricato deriva dai suoi byte, non dal tipo inviato dal client; il nome
del file è solo un ripiego, e mai per i tipi che i browser eseguono attivamente (quei file
vengono memorizzati come `application/octet-stream`). I link nel rich text `blocks` devono
essere `http(s)`, `mailto:` o relativi.

## Indirizzi dei client dietro un proxy

Limiti di frequenza e log di audit usano l'indirizzo del client. Dietro un reverse proxy ogni
richiesta arriva dal proxy, quindi elenca il proxy in `[server].trusted_proxies`:

```toml title="verdin.toml"
[server]
trusted_proxies = ["10.0.0.0/8"]   # the proxies' IPs or CIDR ranges
```

Verdin legge allora `X-Forwarded-For` da destra a sinistra e prende il primo indirizzo che
non è un proxy affidabile. Le richieste da qualsiasi altro indirizzo mantengono il loro
indirizzo di connessione, così un client non può falsificare il proprio indirizzo inviando
l'header da sé. Non elencare intervalli da cui possono connettersi client non affidabili.

## Richieste in uscita

Webhook, deploy hook, webhook di purge della CDN e upload da URL fanno richieste scelte da un
admin. In `verdin start` rifiutano indirizzi di loopback, privati e link-local (comprese le
forme IPv6 che incorporano indirizzi IPv4 privati), così un admin non può usarli per
raggiungere servizi sulla tua rete interna. `[webhooks].allow_private_networks = true`
rimuove questa restrizione; fallo solo quando ogni admin è affidabile rispetto alla rete
interna.

## Segreti

`VERDIN_ADMIN_JWT_SECRET` e `VERDIN_TOKEN_PEPPER` vengono letti solo dall'ambiente e devono
essere lunghi almeno 32 byte ciascuno (`verdin secrets` ne stampa di nuovi). Il pepper
sigilla anche i segreti TOTP degli admin e deriva la chiave con cui si calcola l'hash degli
indirizzi di chi invia i form. Conserva entrambi nel secret manager della tua piattaforma e
non fare mai commit di `.env`.

I log delle richieste nascondono i valori dei parametri di query i cui nomi sembrano segreti
(`token`, `code`, `password`, `key`, `signature`…) e la parte segreta degli URL di callback
dei deploy.

## Metriche

`/_metrics` è disattivato a meno di `[metrics].enabled = true`. Quando è attivo e non è
impostato alcun token, chiunque raggiunga la porta può leggerlo. Imposta
`VERDIN_METRICS_TOKEN` (o `[metrics].token`) e fai lo scrape con
`Authorization: Bearer <token>`, oppure blocca il path sul proxy. Vedi
[Monitoraggio](/it/deploy/monitoring/).

## Plugin

I plugin sono moduli WebAssembly eseguiti da Extism in una sandbox. Un modulo non ha un
proprio file system, rete o database: tutto passa da funzioni host limitate dalle capability
nel suo `plugin.toml` (tipi di contenuto che legge o scrive, host HTTP, il proprio
key-value store), con un limite di tempo e memoria per chiamata (`[limits]`, 5 s e 64 MB nel
manifest di esempio). Gli admin vedono cosa chiede un plugin prima di attivarlo. Gli script
admin dei plugin girano nella pagina del pannello, quindi installa solo plugin di cui ti
fidi. Vedi [Plugin](/it/extending/plugins/).

## Export e backup

Gli archivi di `verdin export` contengono campi privati e hash delle password. Conservali
come dump del database. Vedi [Backup](/it/deploy/backups/).

## Segnalare una vulnerabilità

Non aprire una issue pubblica per un problema di sicurezza. Segui la
[security policy](https://github.com/Verdin-CMS/verdin/blob/main/SECURITY.md) del
repository: segnalalo in privato tramite la scheda **Security** del
[repository](https://github.com/Verdin-CMS/verdin/security) (**Report a vulnerability**),
con la versione, i passaggi per riprodurlo e l'impatto che osservi. Le correzioni di
sicurezza sono elencate sotto **Security** nel [changelog](/it/project/changelog/).
