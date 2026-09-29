---
title: Referència de configuració
description: Totes les seccions i claus de verdin.toml, amb els seus valors per defecte, i les variables d'entorn que llegeix Verdin.
sidebar:
  order: 1
  label: Configuració
---

<!-- Written from crates/verdin/src/config.rs, crates/verdin-upload/src/config.rs and
crates/verdin-email/src/lib.rs, crates/verdin-upload/src/transform.rs,
crates/verdin-search/src/lib.rs, crates/verdin-api/src/cdn.rs and crates/verdin-api/src/ai.rs.
Keep it in step when keys change. -->

La configuració es fa per capes: **valors per defecte integrats ← `verdin.toml` ← entorn**. El
fitxer és opcional; totes les claus tenen un valor per defecte. Les claus desconegudes es
rebutgen, de manera que un error tipogràfic falla en iniciar en lloc de ser ignorat.

- Sobreescriu qualsevol clau amb `VERDIN_<SECTION>__<KEY>` (dos guions baixos), per exemple
  `VERDIN_SERVER__PORT=8080` o `VERDIN_ADMIN__SECURE_COOKIES=false`. Les taules imbricades porten un
  `__` més: `VERDIN_ADMIN__BRANDING__TITLE=ACME`. Aquí també es rebutgen les claus desconegudes, de
  manera que qualsevol variable que comenci per `VERDIN_` i contingui `__` ha d'anomenar una clau
  real.
- `VERDIN_DATABASE_URL` és una abreviatura de `database.url`.
- El fitxer és `verdin.toml` al directori de treball, o el camí indicat amb `-c, --config` o
  `VERDIN_CONFIG`. Els camins relatius que conté (esquema, connectors, pujades, fitxers SQLite) es
  resolen a partir del directori del fitxer.
- Primer es carrega un fitxer `.env` que hi hagi al costat de la configuració; les variables ja
  definides a l'entorn tenen prioritat.

Els secrets mai no es llegeixen de `verdin.toml`; consulta [Variables d'entorn](#variables-dentorn).

## `[server]`

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `host` | `"0.0.0.0"` | Adreça on escoltar. |
| `port` | `1337` | Port on escoltar. |
| `public_url` | sense definir | On arriben els navegadors al servidor, p. ex. `"https://cms.example.com"`. Es fa servir per als enllaços dels correus i els callbacks d'SSO; per defecte és `http://localhost:{port}`. |
| `body_limit` | `"1mb"` | Cos de petició més gran de les peticions normals a les API (les pujades tenen el seu propi límit). Un nombre de bytes o una cadena amb `b`, `kb`, `mb` o `gb`. |
| `request_timeout_secs` | `30` | Límit de temps de les peticions normals a les API. |
| `sync_interval_secs` | `10` | Cada quant es recull la configuració canviada per altres instàncies (funcionalitats, interruptors de connectors, idiomes, fluxos de revisió); `0` ho desactiva (una sola instància). |
| `trusted_proxies` | `[]` | Proxies inversos (IP o rangs CIDR, p. ex. `["10.0.0.0/8"]`) el `X-Forwarded-For` dels quals identifica el client. Els límits de freqüència i els registres d'auditoria fan servir aquesta adreça; sense això, tots els clients darrere del proxy en comparteixen una. |

## `[database]`

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `url` | sense definir | URL de connexió: `postgres://…`, `mysql://…` (MySQL i MariaDB) o `sqlite://…`. Obligatòria; normalment es defineix amb `VERDIN_DATABASE_URL`. |
| `pool_max` | `10` | Connexions màximes del pool. |

## `[schema]`

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `path` | `"schema"` | Directori de l'esquema, relatiu al fitxer de configuració. |

## `[api]`

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `prefix` | `"/api"` | Camí sota el qual se serveix l'API de contingut. Ha de començar per `/` i no pot acabar-hi. |
| `default_page_size` | `25` | Mida de pàgina quan una petició no n'indica cap. Entre 1 i `max_page_size`. |
| `max_page_size` | `100` | La mida de pàgina més gran que pot demanar una petició. |
| `decimal_as_string` | `false` | Serialitza els decimals com a cadenes (exactes) en lloc de nombres (compatible amb Strapi). |
| `public_rate_limit` | `0` | Peticions per minut i IP del client sense token (`0`: sense límit). |
| `token_rate_limit` | `0` | Peticions per minut i token d'API o usuari final (`0`: sense límit). |
| `cache_ttl_secs` | `0` | Temps durant el qual es guarden a la memòria les lectures anònimes (`0`: sense memòria cau); els canvis buiden la memòria cau. |
| `cache_entries` | `1000` | Nombre màxim de respostes a la memòria cau. |
| `cors_origins` | `[]` | Orígens de navegador que poden cridar l'API de contingut i GraphQL des d'un altre lloc (`["https://www.example.com"]`: esquema, host i port, sense camí), o `["*"]` per a qualsevol (sol: `*` no es pot combinar amb orígens). Buit: només les pàgines del mateix origen les poden cridar des d'un navegador. L'API d'administració mai no accepta crides d'un altre origen. |

## `[admin]`

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `path` | `"/admin"` | Camí sota el qual se serveix el tauler d'administració; la seva API és a `{path}/api`. |
| `secure_cookies` | sense definir | Marca la galeta de refresc com a `Secure`. Sense definir vol dir sí a `verdin start` i no a `verdin dev` (desenvolupament local per HTTP pla). |
| `auth_rate_limit` | `20` | Intents d'inici de sessió, registre i refresc per IP del client i per minut. |
| `assets_dir` | sense definir | Serveix el tauler d'administració des d'aquest directori (relatiu al fitxer de configuració) en lloc de la còpia incrustada al binari. |

### `[admin.branding]`

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `title` | `"Verdin"` | Es mostra a la barra lateral, a la pàgina d'inici de sessió i a la pestanya del navegador. |
| `logo` | sense definir | Fitxer d'imatge (SVG, PNG, WebP), relatiu al fitxer de configuració. |
| `favicon` | sense definir | Fitxer d'icona (ICO, PNG, SVG), relatiu al fitxer de configuració. |
| `accent` | sense definir | Color `#rrggbb` dels botons, els enllaços i els anells de focus. |
| `translations` | `{}` | Textos de l'administració substituïts per llengua, per exemple `[admin.branding.translations.en]` amb `"auth.login.title" = "Welcome to ACME"`. Les claus són les d'`admin/public/i18n/en.json`. |

## `[upload]`

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `provider` | `{ name = "local", dir = "public/uploads" }` | On es desen els fitxers; consulta més avall. |
| `max_file_size` | `209715200` | Fitxer acceptat més gran, en bytes (200 MB). |
| `responsive_formats` | `true` | Genera formats responsius per a les imatges ràster. |
| `breakpoints` | large 1000, medium 750, small 500 | Formats responsius com a taules `{ name, width }` (els `breakpoints` de Strapi). Els formats més amples que la imatge s'ometen. |
| `max_image_megapixels` | `100` | Límit de descodificació contra les bombes de descompressió, en megapíxels. |
| `max_original_size` | sense definir | Els originals ràster més grans que aquest nombre de píxels (en qualsevol costat) es redueixen en pujar-los, cosa que també n'elimina les metadades (EXIF, GPS). Sense definir, es conserven els originals tal com s'envien. |

```toml
[upload]
breakpoints = [{ name = "large", width = 1000 }, { name = "small", width = 500 }]
```

### Proveïdor local

Fitxers dins de `dir` (relatiu al projecte), servits per Verdin a `/uploads`.

```toml
[upload]
provider = { name = "local", dir = "public/uploads" }
```

### `[upload.transforms]`

Transformacions d'imatge dels fitxers locals: `/uploads/<file>?preset=thumb`, o
`?w=&h=&fit=&format=&q=` amb una signatura. Les versions generades es desen a la memòria cau al
disc i es descarten quan canvia el fitxer (inclòs el seu punt focal). Els retalls cover mantenen
visible el punt focal del fitxer; les imatges mai no s'amplien. Es poden transformar JPEG, PNG,
WebP, TIFF i BMP (no els GIF, que poden ser animats).

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `enabled` | `true` | Serveix les transformacions. |
| `presets` | `{}` | Transformacions amb nom, sempre permeses: `{ w, h, fit, format, q }`. |
| `allow_arbitrary` | `false` | Accepta qualsevol paràmetre sense signatura. Cada URL diferent es genera i es desa a la memòria cau, així que només per a xarxes de confiança. |
| `max_size` | `4096` | `w` o `h` més gran, en píxels. |
| `cache_dir` | `".cache/transforms"` | On es guarden les versions generades (relatiu al projecte; es pot eliminar sense risc). |

Paràmetres: `w`, `h` (píxels), `fit` (`cover`, per defecte, retalla fins al requadre; `inside`
l'encaixa a dins; `fill` l'estira), `format` (`jpeg`, `png`, `webp`; la sortida WebP és sense
pèrdua) i `q` (qualitat JPEG, 1–100, per defecte 80).

```toml
[upload.transforms.presets]
thumb = { w = 300, h = 300 }
hero = { w = 1600, h = 600, format = "webp" }
```

**URL signats.** Amb `VERDIN_IMAGE_SECRET` definit, `s` és l'HMAC-SHA256 en hexadecimal de
`<file>?<canonical query>`, on la consulta canònica llista els paràmetres que no són per defecte
ordenats per nom (`fit`, `format`, `h`, `q`, `w`; sense `fit=cover`):

```js
import { createHmac } from 'node:crypto';
const s = createHmac('sha256', process.env.VERDIN_IMAGE_SECRET)
  .update('photo_1a2b.jpg?format=webp&w=800')
  .digest('hex');
const url = `/uploads/photo_1a2b.jpg?format=webp&w=800&s=${s}`;
```

### Proveïdor S3

Qualsevol servei compatible amb S3 (AWS, Cloudflare R2, MinIO, Backblaze B2…). Les credencials
surten de les variables d'entorn estàndard `AWS_*` (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `bucket` | obligatòria | Nom del bucket. |
| `region` | sense definir | Regió del bucket. |
| `endpoint` | sense definir | Endpoint personalitzat per a serveis que no són d'AWS, p. ex. `https://<account>.r2.cloudflarestorage.com`. |
| `public_url` | obligatòria | URL base pública del bucket o de la seva CDN; els fitxers s'enllacen com a `{public_url}/{key}`. |
| `prefix` | `""` | Prefix de clau dins del bucket. |
| `path_style` | `false` | Peticions en estil de camí (MinIO i la majoria de serveis autoallotjats). |

```toml
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

## `[webhooks]`

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `allow_private_networks` | sense definir | Permet URL de webhooks en adreces de loopback, privades i d'enllaç local; també s'aplica als destins de desplegament i al webhook de `[cdn]`. Sense definir vol dir no a `verdin start` (si no, un administrador podria arribar a serveis interns) i sí a `verdin dev`. |
| `timeout_secs` | `10` | Límit de temps de cada enviament. |
| `retention_days` | `30` | Dies que es conserva el registre d'enviaments. |

Consulta [Webhooks](/ca/guides/integrations/webhooks/).

## `[history]`

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `max_versions` | `50` | Versions conservades per document (les més antigues s'eliminen). |

## `[email]`

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `provider` | `"log"` | `log` (escriu els correus al registre), `smtp`, `resend` o `postmark`. |
| `from` | `"Verdin <no-reply@localhost>"` | Remitent. |
| `reply_to` | sense definir | Adreça de resposta. |

### `[email.smtp]`

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `host` | `"localhost"` | Servidor SMTP. |
| `port` | `587` | Port SMTP. |
| `username` | sense definir | Usuari SMTP; la contrasenya surt de `VERDIN_EMAIL_SMTP_PASSWORD`. |
| `security` | `"starttls"` | `starttls`, `tls` (implícit, normalment al port 465) o `none` (relays locals). |

## `[plugins]`

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `path` | `"plugins"` | Directori de connectors (un subdirectori per connector), relatiu al fitxer de configuració. |
| `run_jobs` | `true` | Executa les tasques programades dels connectors en aquesta instància (una sola instància quan n'hi ha diverses). |

Consulta [Connectors](/ca/extending/plugins/).

## `[audit]`

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `retention_days` | `90` | Dies que es conserven les entrades del registre d'auditoria. |

## `[digest]`

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `enabled` | `true` | Envia el resum diari des d'aquesta instància (una sola instància quan n'hi ha diverses). |
| `hour_utc` | `8` | Hora (UTC, 0–23) en què surt el resum diari de canvis no vistos. |

## `[log]`

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `format` | `"pretty"` | `pretty` o `json`. |
| `level` | sense definir (`info`) | Filtre per defecte; `RUST_LOG` té prioritat quan està definit. |

## `[metrics]`

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `enabled` | `false` | Serveix mètriques de Prometheus a `/_metrics`: peticions HTTP per àrea (`api`, `admin_api`, `graphql`, `mcp`, `uploads`…), mètode i classe d'estat amb histogrames de latència, enviaments de webhooks pendents, fluxos en temps real oberts i temps en funcionament. |
| `token` | sense definir | Les lectures necessiten `Authorization: Bearer <token>`. `VERDIN_METRICS_TOKEN` hi té prioritat. Sense token, qualsevol que arribi al port pot llegir les mètriques. |

## `[ai]`

Accions d'IA a l'administració (amb la funcionalitat **Accions d’IA** activada a Configuració →
Funcionalitats): traduir una entrada a un altre idioma, escriure text alternatiu per a imatges,
resumir text, suggerir metadades SEO. Retornen suggeriments; no es desa res sense l'editor. La
clau es llegeix de `VERDIN_AI_KEY` (els servidors locals no en necessiten).

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `provider` | `"none"` | `anthropic`, `openai` o `openai-compatible` (Ollama, LM Studio, vLLM…). |
| `model` | `claude-sonnet-5` per a `anthropic` | El model; obligatori per als altres proveïdors. |
| `base_url` | el del proveïdor | Un altre endpoint, p. ex. `http://localhost:11434/v1`. |
| `max_tokens` | `2048` | Resposta més llarga. |

```toml
[ai]
provider = "anthropic"
```

Cada administrador pot fer 30 peticions d'IA per minut. El contingut i les imatges s'envien al
proveïdor: tria'n un que la teva organització permeti.

## `[cdn]`

Purga les memòries cau de la CDN quan el contingut canvia públicament. Les respostes de l'API de
contingut s'etiqueten amb `vd` i `vd-<singularName>` (capçaleres `Cache-Tag` i `Surrogate-Key`).

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `provider` | `"none"` | `cloudflare`, `fastly` o `webhook`. |
| `zone_id` | sense definir | Zona de Cloudflare (purga per etiqueta). |
| `service_id` | sense definir | Servei de Fastly (purga per clau surrogate). |
| `url` | sense definir | `webhook`: rep `POST { "tags": [...] }`. |
| `debounce_ms` | `1000` | Canvis que s'agrupen abans de purgar. |

El token d'API es llegeix de `VERDIN_CDN_TOKEN` (s'envia com a token bearer als webhooks).

## `[search]`

| Clau | Per defecte | Descripció |
| --- | --- | --- |
| `enabled` | `false` | Ordena `_q` amb un índex de text complet (Tantivy) en lloc de `$containsi`. |
| `dir` | `"data/search"` | Directori de l'índex, relatiu al projecte. Eliminar-lo reconstrueix l'índex al següent inici. |
| `memory_mb` | `50` | Memòria disponible per indexar. |

L'índex viu al disc de la instància i segueix les escriptures d'aquesta instància: amb diverses
instàncies, mantén la cerca en una (o reconstrueix-lo després d'un desplegament).

## Variables d'entorn

A més dels valors `VERDIN_<SECTION>__<KEY>`, Verdin llegeix aquestes variables:

| Variable | Descripció |
| --- | --- |
| `VERDIN_CONFIG` | Camí del fitxer de configuració (igual que `--config`). |
| `VERDIN_DATABASE_URL` | Abreviatura de `database.url`. |
| `VERDIN_ADMIN_JWT_SECRET` | Signa els tokens de sessió de l'administració. Obligatòria, com a mínim 32 bytes; genera-la amb `verdin secrets`. |
| `VERDIN_TOKEN_PEPPER` | Hash amb clau per als tokens desats. Obligatòria, com a mínim 32 bytes; genera-la amb `verdin secrets`. |
| `VERDIN_ADMIN_PASSWORD` | Contrasenya per a `verdin admin create` i `verdin admin reset-password` (si no, es llegeix de stdin); consulta la [referència de la línia d'ordres](/ca/reference/cli/). |
| `VERDIN_EMAIL_SMTP_PASSWORD` | Contrasenya SMTP. |
| `VERDIN_EMAIL_API_KEY` | Clau d'API dels proveïdors Resend i Postmark. |
| `VERDIN_SSO_<ID>_SECRET` | Secret de client d'un proveïdor SSO; `<ID>` és l'id del proveïdor en majúscules amb `-` com a `_` (consulta [Inici de sessió únic](/ca/guides/auth/sso/)). |
| `VERDIN_OAUTH_<PROVIDER>_SECRET` | Secret de client d'un proveïdor OAuth d'usuaris finals, amb nom com els d'SSO (consulta [Usuaris finals](/ca/guides/auth/end-users/)). |
| `VERDIN_AI_KEY` | Clau d'API del proveïdor d'`[ai]`. |
| `VERDIN_CDN_TOKEN` | Token d'API del proveïdor de `[cdn]`. |
| `VERDIN_IMAGE_SECRET` | Signa els URL de transformació d'imatges (consulta [`[upload.transforms]`](#uploadtransforms)). |
| `VERDIN_METRICS_TOKEN` | Token bearer per a les lectures de `/_metrics` quan `[metrics].enabled`; té prioritat sobre `[metrics].token`. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Credencials del proveïdor de pujades S3. |
| `RUST_LOG` | Filtre de registre; té prioritat sobre `[log].level`. |
