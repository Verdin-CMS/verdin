---
title: Configuratiereferentie
description: Elke sectie en sleutel van verdin.toml, met standaardwaarden, en de omgevingsvariabelen die Verdin leest.
sidebar:
  order: 1
  label: Configuratie
---

<!-- Written from crates/verdin/src/config.rs, crates/verdin-upload/src/config.rs and
crates/verdin-email/src/lib.rs, crates/verdin-upload/src/transform.rs,
crates/verdin-search/src/lib.rs, crates/verdin-api/src/cdn.rs and crates/verdin-api/src/ai.rs.
Keep it in step when keys change. -->

Configuratie werkt in lagen: **ingebouwde standaardwaarden ← `verdin.toml` ← omgeving**. Het
bestand is optioneel; elke sleutel heeft een standaardwaarde. Onbekende sleutels worden geweigerd,
dus een typfout faalt bij het starten in plaats van te worden genegeerd.

- Overschrijf elke sleutel met `VERDIN_<SECTION>__<KEY>` (twee underscores), bijvoorbeeld
  `VERDIN_SERVER__PORT=8080` of `VERDIN_ADMIN__SECURE_COOKIES=false`. Geneste tabellen krijgen
  nog een `__`: `VERDIN_ADMIN__BRANDING__TITLE=ACME`. Ook hier worden onbekende sleutels
  geweigerd, dus elke variabele die met `VERDIN_` begint en `__` bevat, moet een echte sleutel
  noemen.
- `VERDIN_DATABASE_URL` is een afkorting voor `database.url`.
- Het bestand is `verdin.toml` in de werkmap, of het pad dat is opgegeven met `-c, --config` of
  `VERDIN_CONFIG`. Relatieve paden erin (schema, plugins, uploads, SQLite-bestanden) worden
  opgelost ten opzichte van de map van het bestand.
- Een bestand `.env` naast de configuratie wordt eerst geladen; variabelen die al in de omgeving
  zijn ingesteld, winnen.

Geheimen worden nooit uit `verdin.toml` gelezen; zie [Omgevingsvariabelen](#omgevingsvariabelen).

## `[server]`

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `host` | `"0.0.0.0"` | Adres om op te luisteren. |
| `port` | `1337` | Poort om op te luisteren. |
| `public_url` | niet ingesteld | Waar browsers de server bereiken, bijv. `"https://cms.example.com"`. Gebruikt voor links in e-mails en SSO-callbacks; standaard `http://localhost:{port}`. |
| `body_limit` | `"1mb"` | Grootste request-body van gewone API-requests (uploads hebben een eigen limiet). Een aantal bytes of een string met `b`, `kb`, `mb` of `gb`. |
| `request_timeout_secs` | `30` | Tijdslimiet van gewone API-requests. |
| `sync_interval_secs` | `10` | Hoe vaak instellingen worden opgepikt die door andere instanties zijn gewijzigd (functies, pluginschakelaars, locales, reviewworkflows); `0` zet het uit (één instantie). |
| `trusted_proxies` | `[]` | Reverse proxy's (IP's of CIDR-bereiken, bijv. `["10.0.0.0/8"]`) waarvan `X-Forwarded-For` de client noemt. Rate limits en auditlogs gebruiken dat adres; zonder deze instelling delen alle clients achter de proxy er één. |

## `[database]`

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `url` | niet ingesteld | Verbindings-URL: `postgres://…`, `mysql://…` (MySQL en MariaDB) of `sqlite://…`. Verplicht; meestal ingesteld via `VERDIN_DATABASE_URL`. |
| `pool_max` | `10` | Maximaal aantal verbindingen in de pool. |

## `[schema]`

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `path` | `"schema"` | Schemamap, relatief ten opzichte van het configuratiebestand. |

## `[api]`

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `prefix` | `"/api"` | Pad waaronder de content-API wordt geserveerd. Moet met `/` beginnen en er niet mee eindigen. |
| `default_page_size` | `25` | Paginagrootte als een request er geen instelt. Tussen 1 en `max_page_size`. |
| `max_page_size` | `100` | Grootste paginagrootte waar een request om mag vragen. |
| `decimal_as_string` | `false` | Decimalen serialiseren als strings (exact) in plaats van getallen (compatibel met Strapi). |
| `public_rate_limit` | `0` | Requests per minuut per client-IP zonder token (`0`: onbeperkt). |
| `token_rate_limit` | `0` | Requests per minuut per API-token of eindgebruiker (`0`: onbeperkt). |
| `cache_ttl_secs` | `0` | Anonieme leesacties zo lang in het geheugen bewaren (`0`: geen cache); wijzigingen legen de cache. |
| `cache_entries` | `1000` | Maximaal aantal gecachte responses. |
| `cors_origins` | `[]` | Browserorigins die de content-API en GraphQL vanaf een andere site mogen aanroepen (`["https://www.example.com"]`: schema, host en poort, geen pad), of `["*"]` voor alle (alleen: `*` kan niet met origins worden gecombineerd). Leeg: alleen pagina's op dezelfde origin kunnen ze vanuit een browser aanroepen. De admin-API neemt nooit cross-origin aanroepen aan. |

## `[admin]`

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `path` | `"/admin"` | Pad waaronder het beheerpaneel wordt geserveerd; de API ervan staat op `{path}/api`. |
| `secure_cookies` | niet ingesteld | De refresh-cookie als `Secure` markeren. Niet ingesteld betekent ja in `verdin start` en nee in `verdin dev` (lokale ontwikkeling via gewoon HTTP). |
| `auth_rate_limit` | `20` | Pogingen tot inloggen, registreren en refresh per client-IP per minuut. |
| `assets_dir` | niet ingesteld | Het beheerpaneel vanuit deze map serveren (relatief ten opzichte van het configuratiebestand) in plaats van de kopie die in de binary is ingebed. |

### `[admin.branding]`

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `title` | `"Verdin"` | Getoond in de zijbalk, op de inlogpagina en in het browsertabblad. |
| `logo` | niet ingesteld | Afbeeldingsbestand (SVG, PNG, WebP), relatief ten opzichte van het configuratiebestand. |
| `favicon` | niet ingesteld | Iconbestand (ICO, PNG, SVG), relatief ten opzichte van het configuratiebestand. |
| `accent` | niet ingesteld | Kleur `#rrggbb` van knoppen, links en focusringen. |
| `translations` | `{}` | Teksten van het beheerpaneel die per taal worden vervangen, bijvoorbeeld `[admin.branding.translations.en]` met `"auth.login.title" = "Welcome to ACME"`. De sleutels zijn die van `admin/public/i18n/en.json`. |

## `[upload]`

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `provider` | `{ name = "local", dir = "public/uploads" }` | Waar bestanden worden opgeslagen; zie hieronder. |
| `max_file_size` | `209715200` | Grootste geaccepteerde bestand, in bytes (200 MB). |
| `responsive_formats` | `true` | Responsieve formaten genereren voor rasterafbeeldingen. |
| `breakpoints` | large 1000, medium 750, small 500 | Responsieve formaten als tabellen `{ name, width }` (de `breakpoints` van Strapi). Formaten die breder zijn dan de afbeelding, worden overgeslagen. |
| `max_image_megapixels` | `100` | Decodeerlimiet tegen decompressiebommen, in megapixels. |
| `max_original_size` | niet ingesteld | Rasteroriginelen die groter zijn dan dit aantal pixels (aan een van beide zijden), worden bij het uploaden verkleind, waarbij ook hun metadata (EXIF, GPS) verdwijnt. Niet ingesteld behoudt originelen zoals ze zijn verzonden. |

```toml
[upload]
breakpoints = [{ name = "large", width = 1000 }, { name = "small", width = 500 }]
```

### Lokale provider

Bestanden onder `dir` (relatief ten opzichte van het project), door Verdin geserveerd op
`/uploads`.

```toml
[upload]
provider = { name = "local", dir = "public/uploads" }
```

### `[upload.transforms]`

Afbeeldingstransformaties van lokale bestanden: `/uploads/<file>?preset=thumb`, of
`?w=&h=&fit=&format=&q=` met een handtekening. Renderingen worden op schijf gecachet en vervallen
als het bestand verandert (zijn focuspunt inbegrepen). Uitsneden met cover houden het focuspunt
van het bestand in beeld; afbeeldingen worden nooit vergroot. JPEG, PNG, WebP, TIFF en BMP kunnen
worden getransformeerd (geen GIF's, die geanimeerd kunnen zijn).

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `enabled` | `true` | Transformaties serveren. |
| `presets` | `{}` | Benoemde transformaties, altijd toegestaan: `{ w, h, fit, format, q }`. |
| `allow_arbitrary` | `false` | Alle parameters accepteren zonder handtekening. Elke afzonderlijke URL wordt gerenderd en gecachet, dus alleen voor vertrouwde netwerken. |
| `max_size` | `4096` | Grootste `w` of `h`, in pixels. |
| `cache_dir` | `".cache/transforms"` | Waar renderingen worden bewaard (relatief ten opzichte van het project; kan veilig worden verwijderd). |

Parameters: `w`, `h` (pixels), `fit` (`cover`, de standaard, snijdt bij tot het kader; `inside`
past erbinnen; `fill` rekt uit), `format` (`jpeg`, `png`, `webp`; WebP-uitvoer is lossless) en `q`
(JPEG-kwaliteit, 1–100, standaard 80).

```toml
[upload.transforms.presets]
thumb = { w = 300, h = 300 }
hero = { w = 1600, h = 600, format = "webp" }
```

**Ondertekende URL's.** Met `VERDIN_IMAGE_SECRET` ingesteld is `s` de hex-HMAC-SHA256 van
`<file>?<canonical query>`, waarbij de canonieke query de parameters die niet de standaard zijn
op naam gesorteerd opsomt (`fit`, `format`, `h`, `q`, `w`; `fit=cover` weggelaten):

```js
import { createHmac } from 'node:crypto';
const s = createHmac('sha256', process.env.VERDIN_IMAGE_SECRET)
  .update('photo_1a2b.jpg?format=webp&w=800')
  .digest('hex');
const url = `/uploads/photo_1a2b.jpg?format=webp&w=800&s=${s}`;
```

### S3-provider

Elke S3-compatibele dienst (AWS, Cloudflare R2, MinIO, Backblaze B2…). Inloggegevens komen uit de
standaard omgevingsvariabelen `AWS_*` (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `bucket` | verplicht | Naam van de bucket. |
| `region` | niet ingesteld | Regio van de bucket. |
| `endpoint` | niet ingesteld | Eigen endpoint voor diensten buiten AWS, bijv. `https://<account>.r2.cloudflarestorage.com`. |
| `public_url` | verplicht | Openbare basis-URL van de bucket of zijn CDN; bestanden worden gelinkt als `{public_url}/{key}`. |
| `prefix` | `""` | Sleutelprefix binnen de bucket. |
| `path_style` | `false` | Requests in padstijl (MinIO en de meeste self-hosted diensten). |

```toml
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

## `[webhooks]`

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `allow_private_networks` | niet ingesteld | Webhook-URL's toestaan op loopback-, privé- en link-local-adressen; geldt ook voor deploydoelen en de webhook van `[cdn]`. Niet ingesteld betekent nee in `verdin start` (een beheerder zou anders interne services kunnen bereiken) en ja in `verdin dev`. |
| `timeout_secs` | `10` | Tijdslimiet van elke aflevering. |
| `retention_days` | `30` | Aantal dagen dat het afleveringslogboek wordt bewaard. |

Zie [Webhooks](/nl/guides/integrations/webhooks/).

## `[history]`

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `max_versions` | `50` | Versies die per document worden bewaard (oudere worden verwijderd). |

## `[email]`

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `provider` | `"log"` | `log` (e-mails naar het log schrijven), `smtp`, `resend` of `postmark`. |
| `from` | `"Verdin <no-reply@localhost>"` | Afzender. |
| `reply_to` | niet ingesteld | Antwoordadres. |

### `[email.smtp]`

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `host` | `"localhost"` | SMTP-server. |
| `port` | `587` | SMTP-poort. |
| `username` | niet ingesteld | SMTP-gebruiker; het wachtwoord komt uit `VERDIN_EMAIL_SMTP_PASSWORD`. |
| `security` | `"starttls"` | `starttls`, `tls` (impliciet, meestal poort 465) of `none` (lokale relays). |

## `[plugins]`

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `path` | `"plugins"` | Map van plugins (elk een eigen submap), relatief ten opzichte van het configuratiebestand. |
| `run_jobs` | `true` | De geplande jobs van de plugins op deze instantie draaien (één instantie als er meerdere zijn). |

Zie [Plugins](/nl/extending/plugins/).

## `[audit]`

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `retention_days` | `90` | Aantal dagen dat regels van de auditlog worden bewaard. |

## `[digest]`

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `enabled` | `true` | De dagelijkse samenvatting vanaf deze instantie versturen (één instantie als er meerdere zijn). |
| `hour_utc` | `8` | Uur (UTC, 0–23) waarop de dagelijkse samenvatting van ongeziene wijzigingen uitgaat. |

## `[log]`

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `format` | `"pretty"` | `pretty` of `json`. |
| `level` | niet ingesteld (`info`) | Standaardfilter; `RUST_LOG` gaat voor als die is ingesteld. |

## `[metrics]`

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `enabled` | `false` | Prometheus-metrics serveren op `/_metrics`: HTTP-requests per gebied (`api`, `admin_api`, `graphql`, `mcp`, `uploads`…), methode en statusklasse met latentiehistogrammen, openstaande webhook-afleveringen, open realtime-streams en uptime. |
| `token` | niet ingesteld | Scrapes vereisen `Authorization: Bearer <token>`. `VERDIN_METRICS_TOKEN` wint ervan. Zonder token kan iedereen die de poort bereikt de metrics lezen. |

## `[ai]`

AI-acties in het beheerpaneel (met de functie **AI-acties** aan in Instellingen → Functies): een
item naar een andere locale vertalen, alt-tekst voor afbeeldingen schrijven, tekst samenvatten,
SEO-metadata voorstellen. Ze geven suggesties terug; er wordt niets opgeslagen zonder de
redacteur. De sleutel wordt gelezen uit `VERDIN_AI_KEY` (lokale servers hebben er geen nodig).

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `provider` | `"none"` | `anthropic`, `openai` of `openai-compatible` (Ollama, LM Studio, vLLM…). |
| `model` | `claude-sonnet-5` voor `anthropic` | Het model; verplicht voor de andere providers. |
| `base_url` | die van de provider | Een ander endpoint, bijv. `http://localhost:11434/v1`. |
| `max_tokens` | `2048` | Langste antwoord. |

```toml
[ai]
provider = "anthropic"
```

Elke beheerder mag 30 AI-requests per minuut doen. Content en afbeeldingen worden naar de provider
gestuurd: kies er een die je organisatie toestaat.

## `[cdn]`

Wist CDN-caches als content publiek verandert. Responses van de content-API krijgen de tags `vd`
en `vd-<singularName>` (headers `Cache-Tag` en `Surrogate-Key`).

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `provider` | `"none"` | `cloudflare`, `fastly` of `webhook`. |
| `zone_id` | niet ingesteld | Cloudflare-zone (purge op tag). |
| `service_id` | niet ingesteld | Fastly-service (purge op surrogate key). |
| `url` | niet ingesteld | `webhook`: ontvangt `POST { "tags": [...] }`. |
| `debounce_ms` | `1000` | Wijzigingen die worden verzameld vóór het wissen. |

Het API-token wordt gelezen uit `VERDIN_CDN_TOKEN` (naar webhooks verzonden als bearer-token).

## `[search]`

| Sleutel | Standaard | Beschrijving |
| --- | --- | --- |
| `enabled` | `false` | `_q` rangschikken met een full-text-index (Tantivy) in plaats van `$containsi`. |
| `dir` | `"data/search"` | Map van de index, relatief ten opzichte van het project. Als je hem verwijdert, wordt de index bij de volgende start opnieuw opgebouwd. |
| `memory_mb` | `50` | Geheugenbudget voor het indexeren. |

De index staat op de schijf van de instantie en volgt de schrijfacties van die instantie: houd
zoeken bij meerdere instanties op één instantie (of bouw hem na een deploy opnieuw op).

## Omgevingsvariabelen

Naast de overschrijvingen `VERDIN_<SECTION>__<KEY>` leest Verdin deze variabelen:

| Variabele | Beschrijving |
| --- | --- |
| `VERDIN_CONFIG` | Pad van het configuratiebestand (hetzelfde als `--config`). |
| `VERDIN_DATABASE_URL` | Afkorting voor `database.url`. |
| `VERDIN_ADMIN_JWT_SECRET` | Ondertekent sessietokens van beheerders. Verplicht, minstens 32 bytes; genereer hem met `verdin secrets`. |
| `VERDIN_TOKEN_PEPPER` | Sleutel voor de hash van opgeslagen tokens. Verplicht, minstens 32 bytes; genereer hem met `verdin secrets`. |
| `VERDIN_ADMIN_PASSWORD` | Wachtwoord voor `verdin admin create` en `verdin admin reset-password` (anders gelezen van stdin); zie de [referentie van de opdrachtregel](/nl/reference/cli/). |
| `VERDIN_EMAIL_SMTP_PASSWORD` | SMTP-wachtwoord. |
| `VERDIN_EMAIL_API_KEY` | API-sleutel van de providers Resend en Postmark. |
| `VERDIN_SSO_<ID>_SECRET` | Clientgeheim van een SSO-provider; `<ID>` is het id van de provider in hoofdletters met `-` als `_` (zie [Single sign-on](/nl/guides/auth/sso/)). |
| `VERDIN_OAUTH_<PROVIDER>_SECRET` | Clientgeheim van een OAuth-provider voor eindgebruikers, genoemd zoals die voor SSO (zie [Eindgebruikers](/nl/guides/auth/end-users/)). |
| `VERDIN_AI_KEY` | API-sleutel van de provider van `[ai]`. |
| `VERDIN_CDN_TOKEN` | API-token van de provider van `[cdn]`. |
| `VERDIN_IMAGE_SECRET` | Ondertekent URL's van afbeeldingstransformaties (zie [`[upload.transforms]`](#uploadtransforms)). |
| `VERDIN_METRICS_TOKEN` | Bearer-token voor scrapes van `/_metrics` als `[metrics].enabled`; wint van `[metrics].token`. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Inloggegevens van de S3-uploadprovider. |
| `RUST_LOG` | Logfilter; gaat voor op `[log].level`. |
