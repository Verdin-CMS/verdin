---
title: Konfigurationsreferenz
description: Jeder Abschnitt und jeder Schlüssel von verdin.toml, mit Standardwerten, und die Umgebungsvariablen, die Verdin liest.
sidebar:
  order: 1
  label: Konfiguration
---

<!-- Written from crates/verdin/src/config.rs, crates/verdin-upload/src/config.rs and
crates/verdin-email/src/lib.rs, crates/verdin-upload/src/transform.rs,
crates/verdin-search/src/lib.rs, crates/verdin-api/src/cdn.rs, crates/verdin-api/src/ai.rs
and crates/verdin/src/telemetry.rs.
Keep it in step when keys change. -->

Die Konfiguration ist geschichtet: **eingebaute Standardwerte ← `verdin.toml` ← Umgebung**. Die
Datei ist optional; jeder Schlüssel hat einen Standardwert. Unbekannte Schlüssel werden
abgelehnt, ein Tippfehler lässt den Start also scheitern, statt ignoriert zu werden.

- Überschreibe jeden Schlüssel mit `VERDIN_<SECTION>__<KEY>` (zwei Unterstriche), zum Beispiel
  `VERDIN_SERVER__PORT=8080` oder `VERDIN_ADMIN__SECURE_COOKIES=false`. Verschachtelte Tabellen
  bekommen ein weiteres `__`: `VERDIN_ADMIN__BRANDING__TITLE=ACME`. Auch hier werden unbekannte
  Schlüssel abgelehnt, jede Variable, die mit `VERDIN_` beginnt und `__` enthält, muss also einen
  echten Schlüssel benennen.
- `VERDIN_DATABASE_URL` ist eine Kurzform für `database.url`.
- Die Datei ist `verdin.toml` im Arbeitsverzeichnis oder der Pfad, der mit `-c, --config` oder
  `VERDIN_CONFIG` angegeben wird. Relative Pfade darin (Schema, Plugins, Uploads,
  SQLite-Dateien) werden gegen das Verzeichnis der Datei aufgelöst.
- Eine `.env`-Datei neben der Konfiguration wird zuerst geladen; Variablen, die schon in der
  Umgebung gesetzt sind, haben Vorrang.

Secrets werden nie aus `verdin.toml` gelesen; siehe [Umgebungsvariablen](#umgebungsvariablen).

## `[server]`

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `host` | `"0.0.0.0"` | Adresse, auf der gelauscht wird. |
| `port` | `1337` | Port, auf dem gelauscht wird. |
| `public_url` | nicht gesetzt | Wo Browser den Server erreichen, z. B. `"https://cms.example.com"`. Genutzt für Links in E-Mails und SSO-Callbacks; standardmäßig `http://localhost:{port}`. |
| `body_limit` | `"1mb"` | Größter Request-Body regulärer API-Anfragen (Uploads haben ein eigenes Limit). Eine Zahl von Bytes oder ein String mit `b`, `kb`, `mb` oder `gb`. |
| `request_timeout_secs` | `30` | Zeitlimit regulärer API-Anfragen. |
| `sync_interval_secs` | `10` | Wie oft Einstellungen übernommen werden, die andere Instanzen geändert haben (Funktionen, Plugin-Schalter, Sprachen, Review-Workflows); `0` schaltet es ab (eine einzelne Instanz). |
| `trusted_proxies` | `[]` | Reverse Proxys (IPs oder CIDR-Bereiche, z. B. `["10.0.0.0/8"]`), deren `X-Forwarded-For` den Client nennt. Rate Limits und Audit-Logs nutzen diese Adresse; ohne die Einstellung teilen sich alle Clients hinter dem Proxy eine. |

## `[database]`

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `url` | nicht gesetzt | Verbindungs-URL: `postgres://…`, `mysql://…` (MySQL und MariaDB) oder `sqlite://…`. Pflicht; meist über `VERDIN_DATABASE_URL` gesetzt. |
| `pool_max` | `10` | Maximale Zahl der Verbindungen im Pool. |

## `[schema]`

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `path` | `"schema"` | Schemaverzeichnis, relativ zur Konfigurationsdatei. |

## `[api]`

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `prefix` | `"/api"` | Pfad, unter dem die Content-API bereitsteht. Muss mit `/` beginnen und darf nicht mit `/` enden. |
| `default_page_size` | `25` | Seitengröße, wenn eine Anfrage keine angibt. Zwischen 1 und `max_page_size`. |
| `max_page_size` | `100` | Größte Seitengröße, die eine Anfrage verlangen darf. |
| `decimal_as_string` | `false` | Dezimalzahlen als Strings (exakt) statt als Zahlen (kompatibel mit Strapi) serialisieren. |
| `public_rate_limit` | `0` | Anfragen pro Minute und Client-IP ohne Token (`0`: unbegrenzt). |
| `token_rate_limit` | `0` | Anfragen pro Minute und API-Token oder Endnutzer (`0`: unbegrenzt). |
| `cache_ttl_secs` | `0` | Anonyme Lesezugriffe so lange im Speicher halten (`0`: kein Cache); Änderungen leeren den Cache. |
| `cache_entries` | `1000` | Maximale Zahl gecachter Antworten. |
| `cors_origins` | `[]` | Browser-Origins, die Content-API und GraphQL von einer anderen Website aus aufrufen dürfen (`["https://www.example.com"]`: Schema, Host und Port, ohne Pfad), oder `["*"]` für alle (allein: `*` lässt sich nicht mit Origins kombinieren). Leer: Nur Seiten desselben Origins können sie aus dem Browser aufrufen. Die Admin-API nimmt nie Cross-Origin-Aufrufe an. |

## `[admin]`

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `path` | `"/admin"` | Pfad, unter dem das Admin-Panel bereitsteht; seine API liegt unter `{path}/api`. |
| `secure_cookies` | nicht gesetzt | Das Refresh-Cookie als `Secure` markieren. Nicht gesetzt bedeutet ja in `verdin start` und nein in `verdin dev` (lokale Entwicklung über reines HTTP). |
| `auth_rate_limit` | `20` | Versuche zur Anmeldung, Registrierung und zum Refresh pro Client-IP und Minute. |
| `assets_dir` | nicht gesetzt | Das Admin-Panel aus diesem Verzeichnis (relativ zur Konfigurationsdatei) statt aus der in die Binärdatei eingebetteten Kopie ausliefern. |

### `[admin.branding]`

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `title` | `"Verdin"` | Wird in der Seitenleiste, auf der Anmeldeseite und im Browser-Tab angezeigt. |
| `logo` | nicht gesetzt | Bilddatei (SVG, PNG, WebP), relativ zur Konfigurationsdatei. |
| `favicon` | nicht gesetzt | Icon-Datei (ICO, PNG, SVG), relativ zur Konfigurationsdatei. |
| `accent` | nicht gesetzt | `#rrggbb`-Farbe von Buttons, Links und Fokusringen. |
| `translations` | `{}` | Texte des Admin-Panels, pro Sprache ersetzt, zum Beispiel `[admin.branding.translations.en]` mit `"auth.login.title" = "Welcome to ACME"`. Die Schlüssel sind die aus `admin/public/i18n/en.json`. |

## `[upload]`

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `provider` | `{ name = "local", dir = "public/uploads" }` | Wo Dateien gespeichert werden; siehe unten. |
| `max_file_size` | `209715200` | Größte akzeptierte Datei, in Bytes (200 MB). |
| `responsive_formats` | `true` | Responsive Formate für Rasterbilder erzeugen. |
| `breakpoints` | large 1000, medium 750, small 500 | Responsive Formate als Tabellen `{ name, width }` (die `breakpoints` von Strapi). Formate, die breiter als das Bild sind, werden übersprungen. |
| `max_image_megapixels` | `100` | Dekodierlimit gegen Dekompressionsbomben, in Megapixeln. |
| `max_original_size` | nicht gesetzt | Raster-Originale, die (auf einer der Seiten) größer als so viele Pixel sind, werden beim Upload verkleinert, wodurch auch ihre Metadaten (EXIF, GPS) entfallen. Nicht gesetzt behält Originale, wie sie gesendet wurden. |

```toml
[upload]
breakpoints = [{ name = "large", width = 1000 }, { name = "small", width = 500 }]
```

### Lokaler Provider

Dateien unter `dir` (relativ zum Projekt), von Verdin unter `/uploads` ausgeliefert.

```toml
[upload]
provider = { name = "local", dir = "public/uploads" }
```

### `[upload.transforms]`

Bildtransformationen lokaler Dateien: `/uploads/<file>?preset=thumb` oder
`?w=&h=&fit=&format=&q=` mit Signatur. Renderings werden auf der Festplatte gecacht und
verworfen, wenn sich die Datei ändert (einschließlich ihres Fokuspunkts). Zuschnitte mit
`cover` halten den Fokuspunkt der Datei sichtbar; Bilder werden nie vergrößert. JPEG, PNG,
WebP, TIFF und BMP lassen sich transformieren (keine GIFs, die animiert sein können).

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `enabled` | `true` | Transformationen ausliefern. |
| `presets` | `{}` | Benannte Transformationen, immer erlaubt: `{ w, h, fit, format, q }`. |
| `allow_arbitrary` | `false` | Beliebige Parameter ohne Signatur akzeptieren. Jede unterschiedliche URL wird gerendert und gecacht, also nur für vertrauenswürdige Netze. |
| `max_size` | `4096` | Größtes `w` oder `h`, in Pixeln. |
| `cache_dir` | `".cache/transforms"` | Wo Renderings abgelegt werden (relativ zum Projekt; gefahrlos löschbar). |

Parameter: `w`, `h` (Pixel), `fit` (`cover`, der Standard, schneidet auf die Box zu; `inside`
passt in sie ein; `fill` streckt), `format` (`jpeg`, `png`, `webp`; WebP-Ausgabe ist
verlustfrei) und `q` (JPEG-Qualität, 1–100, Standard 80).

```toml
[upload.transforms.presets]
thumb = { w = 300, h = 300 }
hero = { w = 1600, h = 600, format = "webp" }
```

**Signierte URLs.** Mit gesetztem `VERDIN_IMAGE_SECRET` ist `s` der hexkodierte HMAC-SHA256 von
`<file>?<canonical query>`, wobei die kanonische Query die Parameter, die vom Standard
abweichen, nach Namen sortiert listet (`fit`, `format`, `h`, `q`, `w`; `fit=cover`
weggelassen):

```js
import { createHmac } from 'node:crypto';
const s = createHmac('sha256', process.env.VERDIN_IMAGE_SECRET)
  .update('photo_1a2b.jpg?format=webp&w=800')
  .digest('hex');
const url = `/uploads/photo_1a2b.jpg?format=webp&w=800&s=${s}`;
```

### S3-Provider

Jeder S3-kompatible Dienst (AWS, Cloudflare R2, MinIO, Backblaze B2…). Die Zugangsdaten kommen
aus den üblichen `AWS_*`-Umgebungsvariablen (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `bucket` | Pflicht | Name des Buckets. |
| `region` | nicht gesetzt | Region des Buckets. |
| `endpoint` | nicht gesetzt | Eigener Endpunkt für Dienste außerhalb von AWS, z. B. `https://<account>.r2.cloudflarestorage.com`. |
| `public_url` | Pflicht | Öffentliche Basis-URL des Buckets oder seines CDNs; Dateien werden als `{public_url}/{key}` verlinkt. |
| `prefix` | `""` | Schlüsselpräfix im Bucket. |
| `path_style` | `false` | Anfragen im Path-Style (MinIO und die meisten selbst gehosteten Dienste). |

```toml
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

## `[webhooks]`

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `allow_private_networks` | nicht gesetzt | Webhook-URLs auf Loopback-, privaten und Link-Local-Adressen erlauben; gilt auch für Deploy-Ziele und den `[cdn]`-Webhook. Nicht gesetzt bedeutet nein in `verdin start` (sonst könnte ein Admin interne Dienste erreichen) und ja in `verdin dev`. |
| `timeout_secs` | `10` | Zeitlimit jeder Zustellung. |
| `retention_days` | `30` | Tage, die das Zustellungsprotokoll aufbewahrt wird. |

Siehe [Webhooks](/de/guides/integrations/webhooks/).

## `[history]`

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `max_versions` | `50` | Aufbewahrte Versionen pro Dokument (ältere werden entfernt). |

## `[email]`

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `provider` | `"log"` | `log` (E-Mails ins Log schreiben), `smtp`, `resend` oder `postmark`. |
| `from` | `"Verdin <no-reply@localhost>"` | Absender. |
| `reply_to` | nicht gesetzt | Antwortadresse. |

### `[email.smtp]`

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `host` | `"localhost"` | SMTP-Server. |
| `port` | `587` | SMTP-Port. |
| `username` | nicht gesetzt | SMTP-Benutzer; das Passwort kommt aus `VERDIN_EMAIL_SMTP_PASSWORD`. |
| `security` | `"starttls"` | `starttls`, `tls` (implizit, meist Port 465) oder `none` (lokale Relays). |

## `[plugins]`

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `path` | `"plugins"` | Verzeichnis der Plugins (je ein Unterverzeichnis), relativ zur Konfigurationsdatei. |
| `run_jobs` | `true` | Die geplanten Jobs der Plugins auf dieser Instanz ausführen (auf einer Instanz, wenn es mehrere gibt). |

Siehe [Plugins](/de/extending/plugins/).

## `[audit]`

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `retention_days` | `90` | Tage, die Einträge des Audit-Logs aufbewahrt werden. |

## `[digest]`

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `enabled` | `true` | Den täglichen Digest von dieser Instanz aus verschicken (von einer Instanz, wenn es mehrere gibt). |
| `hour_utc` | `8` | Stunde (UTC, 0–23), zu der der tägliche Digest ungesehener Änderungen rausgeht. |

## `[log]`

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `format` | `"pretty"` | `pretty` oder `json`. |
| `level` | nicht gesetzt (`info`) | Standardfilter; `RUST_LOG` hat Vorrang, wenn gesetzt. |

## `[metrics]`

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `enabled` | `false` | Prometheus-Metriken unter `/_metrics` ausliefern: HTTP-Anfragen nach Bereich (`api`, `admin_api`, `graphql`, `mcp`, `uploads`…), Methode und Statusklasse mit Latenz-Histogrammen, ausstehende Webhook-Zustellungen, offene Echtzeit-Streams, Event-Bus-Verkehr und Uptime. |
| `token` | nicht gesetzt | Scrapes brauchen `Authorization: Bearer <token>`. `VERDIN_METRICS_TOKEN` hat Vorrang. Ohne Token kann jeder, der den Port erreicht, die Metriken lesen. |

## `[telemetry]`

Traces und Fehlerberichte, beide standardmäßig aus und nur von `verdin start` und `verdin dev`
genutzt (siehe [Monitoring](/de/deploy/monitoring/#traces-opentelemetry)).

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `enabled` | `false` | OpenTelemetry-Traces von HTTP-Anfragen und ihren Datenbankabfragen per OTLP/HTTP (Protobuf) exportieren. `OTEL_SDK_DISABLED=true` schaltet es aus. |
| `endpoint` | nicht gesetzt (`http://localhost:4318`) | Basis-URL des Collectors; `/v1/traces` wird angehängt. `OTEL_EXPORTER_OTLP_ENDPOINT` (Basis-URL) und `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (volle URL) haben Vorrang. |
| `service_name` | `"verdin"` | `service.name` der Traces. `OTEL_SERVICE_NAME` hat Vorrang. |
| `sample_ratio` | `1.0` | Anteil der behaltenen Traces, von `0.0` bis `1.0`. Eine Anfrage mit einem Header `traceparent` folgt der Entscheidung des Aufrufers. |
| `sentry_dsn` | nicht gesetzt | Panics und 5xx-Antworten an Sentry melden. `SENTRY_DSN` hat Vorrang. |
| `sentry_environment` | nicht gesetzt | Sentry-Umgebung. `SENTRY_ENVIRONMENT` hat Vorrang; nicht gesetzt, `production` in `verdin start` und `development` in `verdin dev`. |

## `[ai]`

KI-Aktionen im Admin-Panel (mit eingeschalteter Funktion **KI-Aktionen** unter Einstellungen →
Funktionen): einen Eintrag in eine andere Sprache übersetzen, Alternativtext für Bilder
schreiben, Text zusammenfassen, SEO-Metadaten vorschlagen. Sie liefern Vorschläge; ohne die
Redaktion wird nichts gespeichert. Der Schlüssel wird aus `VERDIN_AI_KEY` gelesen (lokale
Server brauchen keinen).

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `provider` | `"none"` | `anthropic`, `openai` oder `openai-compatible` (Ollama, LM Studio, vLLM…). |
| `model` | `claude-sonnet-5` für `anthropic` | Das Modell; Pflicht für die anderen Anbieter. |
| `base_url` | die des Anbieters | Ein anderer Endpunkt, z. B. `http://localhost:11434/v1`. |
| `max_tokens` | `2048` | Längste Antwort. |

```toml
[ai]
provider = "anthropic"
```

Jeder Admin darf 30 KI-Anfragen pro Minute stellen. Inhalte und Bilder werden an den Anbieter
geschickt: Wähle einen, den deine Organisation erlaubt.

## `[cdn]`

Leert CDN-Caches, wenn sich Inhalte öffentlich ändern. Antworten der Content-API tragen die Tags
`vd` und `vd-<singularName>` (Header `Cache-Tag` und `Surrogate-Key`).

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `provider` | `"none"` | `cloudflare`, `fastly` oder `webhook`. |
| `zone_id` | nicht gesetzt | Cloudflare-Zone (Purge nach Tag). |
| `service_id` | nicht gesetzt | Fastly-Service (Purge nach Surrogate Key). |
| `url` | nicht gesetzt | `webhook`: bekommt `POST { "tags": [...] }`. |
| `debounce_ms` | `1000` | Zeitraum, in dem Änderungen vor dem Purge gesammelt werden. |

Das API-Token wird aus `VERDIN_CDN_TOKEN` gelesen (an Webhooks als Bearer-Token gesendet).

## `[search]`

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `enabled` | `false` | `_q` mit einem Volltextindex (Tantivy) statt `$containsi` sortieren. |
| `dir` | `"data/search"` | Indexverzeichnis, relativ zum Projekt. Wird es gelöscht, wird der Index beim nächsten Start neu aufgebaut. |
| `memory_mb` | `50` | Speicherbudget fürs Indexieren. |

Der Index liegt auf der Festplatte der Instanz. Schalte bei mehreren Instanzen den
[Event-Bus](#cluster) ein, damit jeder Index den Schreibvorgängen aller folgt.

## `[cluster]`

Der gemeinsame Event-Bus für mehrere Instanzen eines Projekts (siehe
[Mehrere Instanzen betreiben](/de/deploy/scaling/#gemeinsamer-event-bus)).

| Schlüssel | Standard | Beschreibung |
| --- | --- | --- |
| `bus` | `"none"` | `none`: Echtzeit-Events, Präsenz, Cache-Invalidierung und Suchaktualisierungen bleiben in jeder Instanz. `database`: Sie erreichen jede Instanz über die Datenbank des Projekts (`LISTEN/NOTIFY` auf PostgreSQL, Polling auf MySQL, MariaDB und SQLite). |
| `poll_interval_ms` | `1000` | Wie oft MySQL, MariaDB und SQLite die Events anderer Instanzen lesen. PostgreSQL wird durch `NOTIFY` geweckt und nutzt dieses Tempo nur, solange es nicht lauschen kann. |
| `instance_id` | nicht gesetzt (bei jedem Start zufällig) | Der Name dieser Instanz auf dem Bus und in den Logs. |

```toml
[cluster]
bus = "database"
```

Setze es auf jeder Instanz, oder mit `VERDIN_CLUSTER__BUS=database`.

## Umgebungsvariablen

Neben den Überschreibungen `VERDIN_<SECTION>__<KEY>` liest Verdin diese Variablen:

| Variable | Beschreibung |
| --- | --- |
| `VERDIN_CONFIG` | Pfad der Konfigurationsdatei (wie `--config`). |
| `VERDIN_DATABASE_URL` | Kurzform für `database.url`. |
| `VERDIN_ADMIN_JWT_SECRET` | Signiert die Sitzungstokens der Admins. Pflicht, mindestens 32 Bytes; erzeuge es mit `verdin secrets`. |
| `VERDIN_TOKEN_PEPPER` | Schlüssel für die Hashes gespeicherter Tokens. Pflicht, mindestens 32 Bytes; erzeuge ihn mit `verdin secrets`. |
| `VERDIN_ADMIN_PASSWORD` | Passwort für `verdin admin create` und `verdin admin reset-password` (sonst von stdin gelesen); siehe die [Referenz der Kommandozeile](/de/reference/cli/). |
| `VERDIN_EMAIL_SMTP_PASSWORD` | SMTP-Passwort. |
| `VERDIN_EMAIL_API_KEY` | API-Schlüssel der Provider Resend und Postmark. |
| `VERDIN_SSO_<ID>_SECRET` | Client-Secret eines SSO-Anbieters; `<ID>` ist die ID des Anbieters in Großbuchstaben mit `_` statt `-` (siehe [Single Sign-on](/de/guides/auth/sso/)). |
| `VERDIN_OAUTH_<PROVIDER>_SECRET` | Client-Secret eines OAuth-Anbieters für Endnutzer, benannt wie die für SSO (siehe [Endnutzer](/de/guides/auth/end-users/)). |
| `VERDIN_AI_KEY` | API-Schlüssel des `[ai]`-Anbieters. |
| `VERDIN_CDN_TOKEN` | API-Token des `[cdn]`-Anbieters. |
| `VERDIN_IMAGE_SECRET` | Signiert die URLs von Bildtransformationen (siehe [`[upload.transforms]`](#uploadtransforms)). |
| `VERDIN_METRICS_TOKEN` | Bearer-Token für Scrapes von `/_metrics`, wenn `[metrics].enabled`; hat Vorrang vor `[metrics].token`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Collector für die Traces von [`[telemetry]`](#telemetry); haben Vorrang vor `[telemetry].endpoint`. Die anderen Standardvariablen `OTEL_EXPORTER_OTLP_*` (Header, Timeout, Kompression) gelten ebenfalls. |
| `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` | Ressource der exportierten Traces; `OTEL_SERVICE_NAME` hat Vorrang vor `[telemetry].service_name`. |
| `OTEL_SDK_DISABLED` | `true` schaltet den Trace-Export auch bei `[telemetry].enabled` aus. |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | Sentry-Fehlerberichte; haben Vorrang vor `[telemetry].sentry_dsn` und `sentry_environment`. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Zugangsdaten des S3-Upload-Providers. |
| `RUST_LOG` | Log-Filter; hat Vorrang vor `[log].level`. |
