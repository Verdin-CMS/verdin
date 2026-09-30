---
title: Riferimento della configurazione
description: Ogni sezione e chiave di verdin.toml, con i default, e le variabili d'ambiente che legge Verdin.
sidebar:
  order: 1
  label: Configurazione
---

<!-- Written from crates/verdin/src/config.rs, crates/verdin-upload/src/config.rs and
crates/verdin-email/src/lib.rs, crates/verdin-upload/src/transform.rs,
crates/verdin-search/src/lib.rs, crates/verdin-api/src/cdn.rs, crates/verdin-api/src/ai.rs
and crates/verdin/src/telemetry.rs.
Keep it in step when keys change. -->

La configurazione è a livelli: **default integrati ← `verdin.toml` ← ambiente**. Il file è
opzionale; ogni chiave ha un default. Le chiavi sconosciute vengono rifiutate, così un
errore di battitura fallisce all'avvio invece di essere ignorato.

- Sovrascrivi qualsiasi chiave con `VERDIN_<SECTION>__<KEY>` (due underscore), per esempio
  `VERDIN_SERVER__PORT=8080` o `VERDIN_ADMIN__SECURE_COOKIES=false`. Le tabelle annidate
  richiedono un `__` in più: `VERDIN_ADMIN__BRANDING__TITLE=ACME`. Anche qui le chiavi
  sconosciute vengono rifiutate, quindi ogni variabile che inizia con `VERDIN_` e contiene
  `__` deve nominare una chiave reale.
- `VERDIN_DATABASE_URL` è una scorciatoia per `database.url`.
- Il file è `verdin.toml` nella directory di lavoro, o il path indicato con `-c, --config` o
  `VERDIN_CONFIG`. I path relativi al suo interno (schema, plugin, upload, file SQLite)
  vengono risolti rispetto alla directory del file.
- Un file `.env` accanto alla configurazione viene caricato per primo; le variabili già
  impostate nell'ambiente prevalgono.

I segreti non vengono mai letti da `verdin.toml`; vedi
[Variabili d'ambiente](#variabili-dambiente).

## `[server]`

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `host` | `"0.0.0.0"` | Indirizzo su cui ascoltare. |
| `port` | `1337` | Porta su cui ascoltare. |
| `public_url` | non impostato | Dove i browser raggiungono il server, ad es. `"https://cms.example.com"`. Usato per i link nelle email e i callback SSO; di default `http://localhost:{port}`. |
| `body_limit` | `"1mb"` | Corpo massimo delle normali richieste API (gli upload hanno un limite proprio). Un numero di byte o una stringa con `b`, `kb`, `mb` o `gb`. |
| `request_timeout_secs` | `30` | Limite di tempo delle normali richieste API. |
| `sync_interval_secs` | `10` | Ogni quanto recepire le impostazioni modificate da altre istanze (funzionalità, interruttori dei plugin, lingue, flussi di revisione); `0` lo disattiva (istanza singola). |
| `trusted_proxies` | `[]` | Reverse proxy (IP o intervalli CIDR, ad es. `["10.0.0.0/8"]`) il cui `X-Forwarded-For` indica il client. Limiti di frequenza e log di audit usano quell'indirizzo; senza, ogni client dietro il proxy condivide lo stesso. |

## `[database]`

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `url` | non impostato | URL di connessione: `postgres://…`, `mysql://…` (MySQL e MariaDB) o `sqlite://…`. Obbligatorio; di solito impostato tramite `VERDIN_DATABASE_URL`. |
| `pool_max` | `10` | Numero massimo di connessioni nel pool. |

## `[schema]`

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `path` | `"schema"` | Directory dello schema, relativa al file di configurazione. |

## `[api]`

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `prefix` | `"/api"` | Path sotto cui viene servita la content API. Deve iniziare con `/` e non terminare con esso. |
| `default_page_size` | `25` | Dimensione della pagina quando una richiesta non ne imposta una. Tra 1 e `max_page_size`. |
| `max_page_size` | `100` | Dimensione massima della pagina che una richiesta può chiedere. |
| `decimal_as_string` | `false` | Serializza i decimali come stringhe (esatte) invece che come numeri (compatibile con Strapi). |
| `public_rate_limit` | `0` | Richieste al minuto per IP del client senza token (`0`: illimitate). |
| `token_rate_limit` | `0` | Richieste al minuto per token API o utente finale (`0`: illimitate). |
| `cache_ttl_secs` | `0` | Tiene in memoria le letture anonime per questo tempo (`0`: nessuna cache); le modifiche svuotano la cache. |
| `cache_entries` | `1000` | Numero massimo di risposte in cache. |
| `cors_origins` | `[]` | Origini dei browser autorizzate a chiamare la content API e GraphQL da un altro sito (`["https://www.example.com"]`: schema, host e porta, senza path), o `["*"]` per tutte (da solo: `*` non si può combinare con altre origini). Vuoto: solo le pagine della stessa origine possono chiamarle da un browser. L'API admin non accetta mai chiamate cross-origin. |

## `[admin]`

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `path` | `"/admin"` | Path sotto cui viene servito il pannello di amministrazione; la sua API vive su `{path}/api`. |
| `secure_cookies` | non impostato | Segna il cookie di refresh come `Secure`. Non impostato significa sì in `verdin start` e no in `verdin dev` (sviluppo locale su HTTP semplice). |
| `auth_rate_limit` | `20` | Tentativi di login, registrazione e refresh per IP del client al minuto. |
| `assets_dir` | non impostato | Serve il pannello di amministrazione da questa directory (relativa al file di configurazione) invece che dalla copia incorporata nel binario. |

### `[admin.branding]`

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `title` | `"Verdin"` | Mostrato nella barra laterale, nella pagina di accesso e nella scheda del browser. |
| `logo` | non impostato | File immagine (SVG, PNG, WebP), relativo al file di configurazione. |
| `favicon` | non impostato | File icona (ICO, PNG, SVG), relativo al file di configurazione. |
| `accent` | non impostato | Colore `#rrggbb` di pulsanti, link e anelli di focus. |
| `translations` | `{}` | Testi dell'admin sostituiti per lingua, per esempio `[admin.branding.translations.en]` con `"auth.login.title" = "Welcome to ACME"`. Le chiavi sono quelle di `admin/public/i18n/en.json`. |

## `[upload]`

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `provider` | `{ name = "local", dir = "public/uploads" }` | Dove vengono memorizzati i file; vedi sotto. |
| `max_file_size` | `209715200` | File più grande accettato, in byte (200 MB). |
| `responsive_formats` | `true` | Genera i formati responsive per le immagini raster. |
| `breakpoints` | large 1000, medium 750, small 500 | Formati responsive come tabelle `{ name, width }` (i `breakpoints` di Strapi). I formati più larghi dell'immagine vengono saltati. |
| `max_image_megapixels` | `100` | Limite di decodifica contro le decompression bomb, in megapixel. |
| `max_original_size` | non impostato | Gli originali raster più grandi di questo numero di pixel (su un lato qualsiasi) vengono ridimensionati al caricamento, il che elimina anche i loro metadati (EXIF, GPS). Non impostato mantiene gli originali come inviati. |

```toml
[upload]
breakpoints = [{ name = "large", width = 1000 }, { name = "small", width = 500 }]
```

### Provider locale

File sotto `dir` (relativo al progetto), serviti da Verdin su `/uploads`.

```toml
[upload]
provider = { name = "local", dir = "public/uploads" }
```

### `[upload.transforms]`

Trasformazioni delle immagini dei file locali: `/uploads/<file>?preset=thumb`, o
`?w=&h=&fit=&format=&q=` con una firma. Le versioni generate vengono messe in cache su disco
ed eliminate quando il file cambia (compreso il suo punto focale). I ritagli cover mantengono
visibile il punto focale del file; le immagini non vengono mai ingrandite. Si possono
trasformare JPEG, PNG, WebP, TIFF e BMP (non le GIF, che potrebbero essere animate).

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `enabled` | `true` | Serve le trasformazioni. |
| `presets` | `{}` | Trasformazioni con nome, sempre consentite: `{ w, h, fit, format, q }`. |
| `allow_arbitrary` | `false` | Accetta qualsiasi parametro senza firma. Ogni URL distinto viene generato e messo in cache, quindi solo per reti affidabili. |
| `max_size` | `4096` | `w` o `h` massimo, in pixel. |
| `cache_dir` | `".cache/transforms"` | Dove vengono tenute le versioni generate (relativo al progetto; si può eliminare senza rischi). |

Parametri: `w`, `h` (pixel), `fit` (`cover`, il default, ritaglia al riquadro; `inside` fa
stare nel riquadro; `fill` stira), `format` (`jpeg`, `png`, `webp`; l'output WebP è lossless) e
`q` (qualità JPEG, 1–100, default 80).

```toml
[upload.transforms.presets]
thumb = { w = 300, h = 300 }
hero = { w = 1600, h = 600, format = "webp" }
```

**URL firmati.** Con `VERDIN_IMAGE_SECRET` impostato, `s` è l'HMAC-SHA256 esadecimale di
`<file>?<canonical query>`, dove la query canonica elenca i parametri non di default ordinati
per nome (`fit`, `format`, `h`, `q`, `w`; `fit=cover` omesso):

```js
import { createHmac } from 'node:crypto';
const s = createHmac('sha256', process.env.VERDIN_IMAGE_SECRET)
  .update('photo_1a2b.jpg?format=webp&w=800')
  .digest('hex');
const url = `/uploads/photo_1a2b.jpg?format=webp&w=800&s=${s}`;
```

### Provider S3

Qualsiasi servizio compatibile S3 (AWS, Cloudflare R2, MinIO, Backblaze B2…). Le credenziali
arrivano dalle variabili d'ambiente standard `AWS_*` (`AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`).

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `bucket` | obbligatorio | Nome del bucket. |
| `region` | non impostato | Regione del bucket. |
| `endpoint` | non impostato | Endpoint personalizzato per servizi non AWS, ad es. `https://<account>.r2.cloudflarestorage.com`. |
| `public_url` | obbligatorio | URL di base pubblico del bucket o della sua CDN; i file vengono collegati come `{public_url}/{key}`. |
| `prefix` | `""` | Prefisso delle chiavi dentro il bucket. |
| `path_style` | `false` | Richieste path-style (MinIO e la maggior parte dei servizi self-hosted). |

```toml
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

## `[webhooks]`

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `allow_private_networks` | non impostato | Consente URL dei webhook su indirizzi di loopback, privati e link-local; si applica anche alle destinazioni di deploy e al webhook di `[cdn]`. Non impostato significa no in `verdin start` (altrimenti un admin potrebbe raggiungere servizi interni) e sì in `verdin dev`. |
| `timeout_secs` | `10` | Limite di tempo di ogni invio. |
| `retention_days` | `30` | Giorni di conservazione del registro degli invii. |

Vedi [Webhook](/it/guides/integrations/webhooks/).

## `[history]`

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `max_versions` | `50` | Versioni conservate per documento (le più vecchie vengono rimosse). |

## `[email]`

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `provider` | `"log"` | `log` (scrive le email nel log), `smtp`, `resend` o `postmark`. |
| `from` | `"Verdin <no-reply@localhost>"` | Mittente. |
| `reply_to` | non impostato | Indirizzo di risposta. |

### `[email.smtp]`

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `host` | `"localhost"` | Server SMTP. |
| `port` | `587` | Porta SMTP. |
| `username` | non impostato | Utente SMTP; la password arriva da `VERDIN_EMAIL_SMTP_PASSWORD`. |
| `security` | `"starttls"` | `starttls`, `tls` (implicito, di solito porta 465) o `none` (relay locali). |

## `[plugins]`

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `path` | `"plugins"` | Directory dei plugin (una sottodirectory ciascuno), relativa al file di configurazione. |
| `run_jobs` | `true` | Esegue i job pianificati dei plugin su questa istanza (una sola istanza quando ce ne sono più). |

Vedi [Plugin](/it/extending/plugins/).

## `[audit]`

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `retention_days` | `90` | Giorni di conservazione delle voci del log di audit. |

## `[digest]`

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `enabled` | `true` | Invia il digest giornaliero da questa istanza (una sola istanza quando ce ne sono più). |
| `hour_utc` | `8` | Ora (UTC, 0–23) in cui parte il digest giornaliero delle modifiche non viste. |

## `[log]`

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `format` | `"pretty"` | `pretty` o `json`. |
| `level` | non impostato (`info`) | Filtro di default; `RUST_LOG` ha la precedenza quando è impostato. |

## `[metrics]`

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `enabled` | `false` | Serve le metriche Prometheus su `/_metrics`: richieste HTTP per area (`api`, `admin_api`, `graphql`, `mcp`, `uploads`…), metodo e classe di stato con istogrammi di latenza, invii di webhook in attesa, stream realtime aperti, traffico del bus di eventi e uptime. |
| `token` | non impostato | Gli scrape richiedono `Authorization: Bearer <token>`. `VERDIN_METRICS_TOKEN` prevale su di esso. Senza token, chiunque raggiunga la porta può leggere le metriche. |

## `[telemetry]`

Tracce e segnalazioni di errori, entrambe disattivate di default e usate solo da
`verdin start` e `verdin dev` (vedi [Monitoraggio](/it/deploy/monitoring/#tracce-opentelemetry)).

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `enabled` | `false` | Esporta tracce OpenTelemetry delle richieste HTTP e delle loro query al database tramite OTLP/HTTP (protobuf). `OTEL_SDK_DISABLED=true` lo disattiva. |
| `endpoint` | non impostato (`http://localhost:4318`) | URL base del collector; viene aggiunto `/v1/traces`. Prevalgono `OTEL_EXPORTER_OTLP_ENDPOINT` (URL base) e `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (URL completo). |
| `service_name` | `"verdin"` | `service.name` delle tracce. Prevale `OTEL_SERVICE_NAME`. |
| `sample_ratio` | `1.0` | Quota di tracce conservate, da `0.0` a `1.0`. Una richiesta che porta un header `traceparent` segue la decisione del chiamante. |
| `sentry_dsn` | non impostato | Segnala panic e risposte 5xx a Sentry. Prevale `SENTRY_DSN`. |
| `sentry_environment` | non impostato | Ambiente Sentry. Prevale `SENTRY_ENVIRONMENT`; se non impostato, `production` in `verdin start` e `development` in `verdin dev`. |

## `[ai]`

Azioni IA nell'admin (con la funzionalità **Azioni IA** attiva in Impostazioni →
Funzionalità): tradurre una voce in un'altra lingua, scrivere il testo alternativo delle
immagini, riassumere testo, suggerire metadati SEO. Restituiscono suggerimenti; nulla viene
salvato senza il redattore. La chiave viene letta da `VERDIN_AI_KEY` (i server locali non ne
hanno bisogno).

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `provider` | `"none"` | `anthropic`, `openai` o `openai-compatible` (Ollama, LM Studio, vLLM…). |
| `model` | `claude-sonnet-5` per `anthropic` | Il modello; obbligatorio per gli altri provider. |
| `base_url` | quello del provider | Un altro endpoint, ad es. `http://localhost:11434/v1`. |
| `max_tokens` | `2048` | Risposta più lunga. |

```toml
[ai]
provider = "anthropic"
```

Ogni admin può fare 30 richieste all'IA al minuto. Contenuti e immagini vengono inviati al
provider: scegline uno che la tua organizzazione consente.

## `[cdn]`

Svuota le cache della CDN quando i contenuti cambiano pubblicamente. Le risposte della content
API sono etichettate `vd` e `vd-<singularName>` (header `Cache-Tag` e `Surrogate-Key`).

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `provider` | `"none"` | `cloudflare`, `fastly` o `webhook`. |
| `zone_id` | non impostato | Zona Cloudflare (purge per tag). |
| `service_id` | non impostato | Servizio Fastly (purge per surrogate key). |
| `url` | non impostato | `webhook`: riceve `POST { "tags": [...] }`. |
| `debounce_ms` | `1000` | Modifiche raccolte prima della purge. |

Il token API viene letto da `VERDIN_CDN_TOKEN` (inviato come bearer token ai webhook).

## `[search]`

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `enabled` | `false` | Ordina `_q` con un indice full-text (Tantivy) invece di `$containsi`. |
| `dir` | `"data/search"` | Directory dell'indice, relativa al progetto. Eliminarla ricostruisce l'indice al prossimo avvio. |
| `memory_mb` | `50` | Budget di memoria per l'indicizzazione. |

L'indice vive sul disco dell'istanza. Con più istanze, attiva il [bus di eventi](#cluster)
così che ogni indice segua le scritture di tutte.

## `[cluster]`

Il bus di eventi condiviso, per più istanze dello stesso progetto (vedi
[Eseguire più istanze](/it/deploy/scaling/#bus-di-eventi-condiviso)).

| Chiave | Default | Descrizione |
| --- | --- | --- |
| `bus` | `"none"` | `none`: eventi realtime, presenza, invalidazione della cache e aggiornamenti della ricerca restano in ogni istanza. `database`: raggiungono ogni istanza tramite il database del progetto (`LISTEN/NOTIFY` su PostgreSQL, polling su MySQL, MariaDB e SQLite). |
| `poll_interval_ms` | `1000` | Ogni quanto MySQL, MariaDB e SQLite leggono gli eventi delle altre istanze. PostgreSQL viene svegliato da `NOTIFY` e usa questo ritmo solo finché non riesce ad ascoltare. |
| `instance_id` | non impostato (casuale a ogni avvio) | Il nome di questa istanza sul bus e nei log. |

```toml
[cluster]
bus = "database"
```

Impostalo su ogni istanza, o con `VERDIN_CLUSTER__BUS=database`.

## Variabili d'ambiente

Oltre agli override `VERDIN_<SECTION>__<KEY>`, Verdin legge queste variabili:

| Variabile | Descrizione |
| --- | --- |
| `VERDIN_CONFIG` | Path del file di configurazione (come `--config`). |
| `VERDIN_DATABASE_URL` | Scorciatoia per `database.url`. |
| `VERDIN_ADMIN_JWT_SECRET` | Firma i token di sessione admin. Obbligatorio, almeno 32 byte; generalo con `verdin secrets`. |
| `VERDIN_TOKEN_PEPPER` | Chiave dell'hash dei token memorizzati. Obbligatorio, almeno 32 byte; generalo con `verdin secrets`. |
| `VERDIN_ADMIN_PASSWORD` | Password per `verdin admin create` e `verdin admin reset-password` (altrimenti letta dallo stdin); vedi il [riferimento della riga di comando](/it/reference/cli/). |
| `VERDIN_EMAIL_SMTP_PASSWORD` | Password SMTP. |
| `VERDIN_EMAIL_API_KEY` | Chiave API dei provider Resend e Postmark. |
| `VERDIN_SSO_<ID>_SECRET` | Client secret di un provider SSO; `<ID>` è l'id del provider in maiuscolo con `-` come `_` (vedi [Single sign-on](/it/guides/auth/sso/)). |
| `VERDIN_OAUTH_<PROVIDER>_SECRET` | Client secret di un provider OAuth per gli utenti finali, con lo stesso schema di nomi di quelli SSO (vedi [Utenti finali](/it/guides/auth/end-users/)). |
| `VERDIN_AI_KEY` | Chiave API del provider `[ai]`. |
| `VERDIN_CDN_TOKEN` | Token API del provider `[cdn]`. |
| `VERDIN_IMAGE_SECRET` | Firma gli URL delle trasformazioni delle immagini (vedi [`[upload.transforms]`](#uploadtransforms)). |
| `VERDIN_METRICS_TOKEN` | Bearer token per gli scrape di `/_metrics` quando `[metrics].enabled`; prevale su `[metrics].token`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Collector per le tracce di [`[telemetry]`](#telemetry); prevalgono su `[telemetry].endpoint`. Si applicano anche le altre variabili standard `OTEL_EXPORTER_OTLP_*` (header, timeout, compressione). |
| `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` | Risorsa delle tracce esportate; `OTEL_SERVICE_NAME` prevale su `[telemetry].service_name`. |
| `OTEL_SDK_DISABLED` | `true` disattiva l'esportazione delle tracce anche con `[telemetry].enabled`. |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | Segnalazione degli errori a Sentry; prevalgono su `[telemetry].sentry_dsn` e `sentry_environment`. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Credenziali del provider di upload S3. |
| `RUST_LOG` | Filtro dei log; ha la precedenza su `[log].level`. |
