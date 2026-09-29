---
title: Registro delle decisioni
description: Le decisioni di progettazione dietro Verdin, numerate nell'ordine in cui sono state prese, con l'esito e il motivo di ciascuna.
sidebar:
  order: 8
---

Questo registro raccoglie le scelte di progettazione che hanno dato forma a Verdin, nell'ordine in cui sono state fatte, così puoi capire perché il codice è com'è prima di proporre di cambiarlo. Le voci sono conservate come sono state scritte, nomi delle milestone compresi (M2–M4 sono le milestone prima delle prime release); una voce successiva può precisarne una precedente, come la 28 fa per la 1. Aggiungi una nuova riga quando prendi una decisione che altrimenti qualcuno dovrebbe ricostruire dal codice.

| # | Decisione | Esito | Motivazione |
|---|---|---|---|
| 1 | Componenti: JSON o tabelle | **Colonna JSON** ([storage](/it/internals/storage/#componenti-e-zone-dinamiche-una-colonna-json)) | Meno join, pubblicazione e versioning banali, migrazioni più semplici. Filtrare sui componenti ripetibili è raro; si può aggiungere in seguito con le funzioni JSON |
| 2 | Codifica JSON di `decimal` | **number** di default, `api.decimal_as_string` opzionale | La compatibilità con Strapi massimizza l'adozione; valori esatti disponibili quando servono |
| 3 | Form dell'admin | **Signal Forms** | Si adatta a un admin zoneless basato sui signal; alberi di form dinamici derivati dallo schema |
| 4 | Lingua | **Inglese** per codice, documentazione e commit | Portata open source |
| 5 | Compatibilità REST con Strapi | **Stessi parametri e stessa forma delle risposte**; estensioni solo di Verdin sotto `actions/` | I frontend migrano con modifiche minime |
| 6 | Algoritmo JWT dell'admin | HS256 | Un solo segreto, semplice; EdDSA se mai comparissero verificatori esterni |
| 7 | ID dei documenti | ULID (26 caratteri) | Ordinabili e portabili; gli id di Strapi sono stringhe opache di 24 caratteri, i client non li analizzano mai |
| 8 | Contenuto dello snapshot | Modello fisico, non schema | Le versioni successive possono derivare nuove tabelle da uno schema invariato |
| 9 | Nullabilità degli attributi | Sempre nullable; `required` verificato alla pubblicazione | Le bozze possono essere incomplete (comportamento di Strapi v5); aggiungere campi obbligatori è sicuro |
| 10 | Imposizione di `unique` | Indice unico su `(column, locale, publication_state)` | Senza race condition; le bozze e la loro versione pubblicata condividono i valori |
| 11 | Nome della colonna di stato | `publication_state` | `state` è un nome di attributo comune |
| 12 | Parole riservate SQL | Identificatori sempre quotati | Nessuna blocklist arbitraria di nomi di attributo |
| 13 | Costruzione del DML | Builder proprio invece di `sea-query` | Dominano i dettagli per dialetto (NULL tipizzati, collation, formati SQLite); un'astrazione in meno |
| 14 | Scritture senza `?status=draft` | Pubblicano (comportamento REST di Strapi v5) | Compatibilità immediata per i client esistenti |
| 15 | Confronto del testo | Esatto di default su ogni motore; operatori `…i` per il case-insensitive | Stessi risultati su MySQL e su PostgreSQL |
| 16 | Controllo degli accessi temporaneo (M2–M3) | Interruttore `[api].open_access`, rimosso in M4 | Sicuro di default finché non esistevano i permessi |
| 17 | "Il target appartiene a un documento" | Imposto spostando il target, per stato | Un indice unico impedirebbe a una bozza e alla sua versione pubblicata di condividere un target |
| 18 | Lati inversi (`mappedBy`) | In sola lettura | Scriverci è ambiguo con bozza e pubblicazione (quale versione del proprietario?) |
| 19 | Posizioni dei collegamenti | Rinumerate 1..n a ogni scrittura | Nessun esaurimento dei float; le liste sono piccole |
| 20 | Righe delle tabelle di link | Mantengono una primary key `id` | Tabelle uniformi per il motore di migrazione e le ricostruzioni SQLite |
| 21 | Libreria JWT | HS256 proprio (HMAC-SHA256, verifica a tempo costante, `alg` fissato) | `jsonwebtoken` 11 richiede un backend crittografico che si porta dietro RSA |
| 22 | Tabelle della piattaforma | Derivate insieme al modello dei contenuti | Un solo meccanismo di migrazione per tutto |
| 23 | Riuso del refresh token | Revoca l'intera famiglia, nessuna finestra di tolleranza | Semplice e rigoroso; l'admin rifà il login |
| 24 | Bozze tramite la content API | Permesso `readDrafts` separato | I token che leggono i contenuti pubblicati non espongono le bozze |
| 25 | Ordine di applicazione del builder | Migra, poi scrive i file, poi sostituisce a caldo l'app | Una migrazione fallita lascia intatti file e app in esecuzione |
| 26 | Scritture dell'admin | Salvano solo bozze; la pubblicazione è un'azione esplicita | Corrisponde alle aspettative dei redattori; la content API mantiene il publish-by-default di Strapi |
| 27 | Configurazione di runtime dell'admin | Tag `<meta>`, non script inline | Mantiene la CSP libera da script `unsafe-inline` |
| 28 | Filtri sui campi dei componenti | Operatori sui path JSON per dialetto (`#>>`, `JSON_VALUE`, `json_extract`); `EXISTS` sugli elementi degli array per componenti ripetibili e zone dinamiche (0.8) | Zone dinamiche solo per `__component`: i loro elementi hanno campi diversi |
| 29 | i18n dell'admin | Transloco con cataloghi JSON piatti (`admin/public/i18n`) e ICU MessageFormat tramite FormatJS (un transpiler personalizzato), dietro una piccola facade `I18n`; non l'i18n a compile time di Angular | Cambio di lingua a runtime; file standard per Weblate/Crowdin; FormatJS interpreta i messaggi, quindi la CSP rigorosa non ha bisogno di `unsafe-eval` (`@messageformat/core` compila con `new Function`); chiavi tipizzate da `en.json`, completezza verificata da `npm run i18n:check` |
| 30 | Inizio della settimana | `Intl.Locale#getWeekInfo` del tag regionale del browser (en-GB ≠ en-US), fallback su una tabella per regione, personalizzabile dall'utente | Segue la regione di ogni utente anche quando la lingua dell'interfaccia è condivisa |
| 31 | Memorizzazione del layout della dashboard | Colonna JSON `preferences` per utente su `vd_admin_users` (≤ 64 KiB) | Segue l'utente tra i browser; tema e lingua restano in `localStorage` perché si applicano prima del login |
| 32 | Default `Secure` del cookie di refresh | Attivo in `start`, disattivo in `dev`, sovrascrivibile | `verdin dev` su HTTP semplice funziona in ogni browser; la produzione resta rigorosa |
| 33 | Profilo di release | LTO thin, 1 codegen unit, stripped; unwinding mantenuto | Un handler che va in panic non deve far cadere il server |
| 34 | Documenti "non visti" | Righe `vd_document_views` per utente, eliminate per tutti tranne chi modifica quando un documento cambia; filtrate con `NOT EXISTS` in SQL | Paginazione e conteggi restano esatti; nessun timestamp da confrontare per riga |
| 35 | Voti e sondaggi | Tabelle di collaborazione solo per l'admin (`vd_document_votes`, `vd_polls`, `vd_poll_votes`), qualsiasi tipo di contenuto | Cassette dei suggerimenti e decisioni di team senza modellare campi di voto in ogni schema |
| 36 | Storage dei media | `object_store` per locale e S3 | Un solo percorso di codice; upload multipart in streaming; RustFS nello stack di sviluppo e in CI |
| 37 | Collegamenti ai media | Tabelle di link per campo come le relazioni | Stessa semantica di bozza e pubblicazione delle relazioni; le cascate mantengono coerenti i collegamenti |
| 38 | Aggiornamenti dei permessi predefiniti | Marcatore di versione in `vd_settings`, aggiunte applicate una volta | Le installazioni esistenti ottengono i nuovi permessi senza annullare le modifiche successive di un admin |
| 39 | Funzionalità a runtime | Catalogo in `verdin-api`, interruttori in `vd_settings` (`features`), l'app ricostruita sul posto (ArcSwap) in ogni modalità | Interruttori dei plugin alla Strapi senza riavvii; le funzionalità non disponibili sono elencate con la versione prevista |
| 40 | UI del riferimento dell'API | Scalar (`scalar_api_reference`, bundle incorporato) su `{api}/docs`, solo quando il documento è pubblico; la CSP consente il suo bootstrap inline tramite hash | Self-hosted (niente CDN, font, agente IA o telemetria); il documento resta accessibile solo con token di default |
| 41 | GraphQL | Schema dinamico `async-graphql` costruito con l'app; argomenti e selezioni vengono tradotti nell'albero dei parametri REST e analizzati dallo stesso parser di query | Un solo insieme di regole per filtri, paginazione, populate, validazione e permessi tra REST e GraphQL; il populate derivato dalla selezione mantiene il caricamento in batch |
| 42 | Eventi dei documenti | Listener sul Document Service, chiamati dopo il commit | Gli effetti collaterali (contrassegni di lettura, futuri webhook) si applicano a ogni API senza hook per handler |
