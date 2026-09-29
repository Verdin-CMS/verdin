---
title: Dokumentacja konfiguracji
description: Każda sekcja i każdy klucz verdin.toml, z wartościami domyślnymi, oraz zmienne środowiskowe, które czyta Verdin.
sidebar:
  order: 1
  label: Konfiguracja
---

<!-- Written from crates/verdin/src/config.rs, crates/verdin-upload/src/config.rs and
crates/verdin-email/src/lib.rs, crates/verdin-upload/src/transform.rs,
crates/verdin-search/src/lib.rs, crates/verdin-api/src/cdn.rs and crates/verdin-api/src/ai.rs.
Keep it in step when keys change. -->

Konfiguracja jest warstwowa: **wbudowane wartości domyślne ← `verdin.toml` ← środowisko**.
Plik jest opcjonalny; każdy klucz ma wartość domyślną. Nieznane klucze są odrzucane, więc
literówka kończy się błędem przy starcie, zamiast zostać zignorowana.

- Nadpisz dowolny klucz przez `VERDIN_<SECTION>__<KEY>` (dwa podkreślenia), np.
  `VERDIN_SERVER__PORT=8080` lub `VERDIN_ADMIN__SECURE_COOKIES=false`. Zagnieżdżone tabele
  dostają kolejne `__`: `VERDIN_ADMIN__BRANDING__TITLE=ACME`. Nieznane klucze są odrzucane
  także tutaj, więc każda zmienna zaczynająca się od `VERDIN_` i zawierająca `__` musi
  wskazywać istniejący klucz.
- `VERDIN_DATABASE_URL` to skrót dla `database.url`.
- Plik to `verdin.toml` w katalogu roboczym albo ścieżka podana przez `-c, --config` lub
  `VERDIN_CONFIG`. Ścieżki względne w nim (schemat, wtyczki, przesłane pliki, pliki SQLite)
  są rozwiązywane względem katalogu pliku.
- Plik `.env` obok konfiguracji jest wczytywany najpierw; zmienne już ustawione
  w środowisku mają pierwszeństwo.

Sekrety nigdy nie są odczytywane z `verdin.toml`; zobacz
[Zmienne środowiskowe](#zmienne-środowiskowe).

## `[server]`

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `host` | `"0.0.0.0"` | Adres nasłuchiwania. |
| `port` | `1337` | Port nasłuchiwania. |
| `public_url` | nieustawiony | Adres, pod którym przeglądarki docierają do serwera, np. `"https://cms.example.com"`. Używany w linkach w e-mailach i callbackach SSO; domyślnie `http://localhost:{port}`. |
| `body_limit` | `"1mb"` | Największa treść zwykłych żądań API (przesyłanie ma własny limit). Liczba bajtów lub string z `b`, `kb`, `mb` lub `gb`. |
| `request_timeout_secs` | `30` | Limit czasu zwykłych żądań API. |
| `sync_interval_secs` | `10` | Jak często przejmować ustawienia zmienione przez inne instancje (funkcje, przełączniki wtyczek, języki, przepływy recenzji); `0` to wyłącza (jedna instancja). |
| `trusted_proxies` | `[]` | Reverse proxy (IP lub zakresy CIDR, np. `["10.0.0.0/8"]`), których `X-Forwarded-For` wskazuje klienta. Limity żądań i dzienniki audytu używają tego adresu; bez tego wszyscy klienci za proxy dzielą jeden. |

## `[database]`

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `url` | nieustawiony | URL połączenia: `postgres://…`, `mysql://…` (MySQL i MariaDB) lub `sqlite://…`. Wymagany; zwykle ustawiany przez `VERDIN_DATABASE_URL`. |
| `pool_max` | `10` | Maksymalna liczba połączeń w puli. |

## `[schema]`

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `path` | `"schema"` | Katalog schematu, względem pliku konfiguracyjnego. |

## `[api]`

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `prefix` | `"/api"` | Ścieżka, pod którą serwowane jest API treści. Musi zaczynać się od `/` i nie kończyć na nim. |
| `default_page_size` | `25` | Rozmiar strony, gdy żądanie go nie ustawia. Od 1 do `max_page_size`. |
| `max_page_size` | `100` | Największy rozmiar strony, o jaki może prosić żądanie. |
| `decimal_as_string` | `false` | Serializuje liczby dziesiętne jako stringi (dokładnie) zamiast liczb (zgodnie ze Strapi). |
| `public_rate_limit` | `0` | Żądania na minutę i IP klienta bez tokenu (`0`: bez limitu). |
| `token_rate_limit` | `0` | Żądania na minutę i token API lub użytkownika końcowego (`0`: bez limitu). |
| `cache_ttl_secs` | `0` | Jak długo trzymać anonimowe odczyty w pamięci (`0`: bez cache); zmiany opróżniają cache. |
| `cache_entries` | `1000` | Maksymalna liczba odpowiedzi w cache. |
| `cors_origins` | `[]` | Originy przeglądarek, które mogą wywoływać API treści i GraphQL z innej witryny (`["https://www.example.com"]`: schemat, host i port, bez ścieżki), albo `["*"]` dla dowolnego (samodzielnie: `*` nie może być łączone z originami). Puste: z przeglądarki mogą je wywoływać tylko strony z tego samego originu. API administracyjne nigdy nie przyjmuje wywołań cross-origin. |

## `[admin]`

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `path` | `"/admin"` | Ścieżka, pod którą serwowany jest panel administracyjny; jego API jest pod `{path}/api`. |
| `secure_cookies` | nieustawiony | Oznacza ciasteczko odświeżania jako `Secure`. Nieustawione oznacza tak w `verdin start` i nie w `verdin dev` (lokalna praca przez zwykłe HTTP). |
| `auth_rate_limit` | `20` | Próby logowania, rejestracji i odświeżenia na IP klienta na minutę. |
| `assets_dir` | nieustawiony | Serwuje panel administracyjny z tego katalogu (względem pliku konfiguracyjnego) zamiast kopii osadzonej w binarce. |

### `[admin.branding]`

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `title` | `"Verdin"` | Wyświetlany w pasku bocznym, na stronie logowania i w karcie przeglądarki. |
| `logo` | nieustawiony | Plik obrazu (SVG, PNG, WebP), względem pliku konfiguracyjnego. |
| `favicon` | nieustawiony | Plik ikony (ICO, PNG, SVG), względem pliku konfiguracyjnego. |
| `accent` | nieustawiony | Kolor `#rrggbb` przycisków, linków i obwódek fokusu. |
| `translations` | `{}` | Teksty panelu zastępowane per język, np. `[admin.branding.translations.en]` z `"auth.login.title" = "Welcome to ACME"`. Klucze to klucze z `admin/public/i18n/en.json`. |

## `[upload]`

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `provider` | `{ name = "local", dir = "public/uploads" }` | Gdzie przechowywane są pliki; zobacz niżej. |
| `max_file_size` | `209715200` | Największy akceptowany plik, w bajtach (200 MB). |
| `responsive_formats` | `true` | Generuje formaty responsywne dla obrazów rastrowych. |
| `breakpoints` | large 1000, medium 750, small 500 | Formaty responsywne jako tabele `{ name, width }` (`breakpoints` ze Strapi). Formaty szersze niż obraz są pomijane. |
| `max_image_megapixels` | `100` | Limit dekodowania chroniący przed bombami dekompresyjnymi, w megapikselach. |
| `max_original_size` | nieustawiony | Oryginały rastrowe większe niż tyle pikseli (dowolny bok) są zmniejszane przy przesyłaniu, co usuwa też ich metadane (EXIF, GPS). Nieustawione zachowuje oryginały w przesłanej postaci. |

```toml
[upload]
breakpoints = [{ name = "large", width = 1000 }, { name = "small", width = 500 }]
```

### Dostawca lokalny

Pliki w `dir` (względem projektu), serwowane przez Verdin pod `/uploads`.

```toml
[upload]
provider = { name = "local", dir = "public/uploads" }
```

### `[upload.transforms]`

Transformacje obrazów plików lokalnych: `/uploads/<file>?preset=thumb` albo
`?w=&h=&fit=&format=&q=` z podpisem. Renderingi są cache'owane na dysku i usuwane, gdy plik
się zmienia (łącznie z jego punktem centralnym). Przycięcia cover utrzymują punkt centralny
pliku w kadrze; obrazy nigdy nie są powiększane. Transformować można JPEG, PNG, WebP, TIFF
i BMP (nie GIF-y, które mogą być animowane).

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `enabled` | `true` | Serwuje transformacje. |
| `presets` | `{}` | Nazwane transformacje, zawsze dozwolone: `{ w, h, fit, format, q }`. |
| `allow_arbitrary` | `false` | Akceptuje dowolne parametry bez podpisu. Każdy odrębny URL jest renderowany i cache'owany, więc tylko dla zaufanych sieci. |
| `max_size` | `4096` | Największe `w` lub `h`, w pikselach. |
| `cache_dir` | `".cache/transforms"` | Gdzie trzymane są renderingi (względem projektu; można bezpiecznie usunąć). |

Parametry: `w`, `h` (piksele), `fit` (`cover`, domyślnie, przycina do obszaru; `inside`
mieści w nim; `fill` rozciąga), `format` (`jpeg`, `png`, `webp`; wyjście WebP jest
bezstratne) i `q` (jakość JPEG, 1–100, domyślnie 80).

```toml
[upload.transforms.presets]
thumb = { w = 300, h = 300 }
hero = { w = 1600, h = 600, format = "webp" }
```

**Podpisane URL-e.** Z ustawionym `VERDIN_IMAGE_SECRET` `s` to szesnastkowy HMAC-SHA256
z `<file>?<canonical query>`, gdzie kanoniczne zapytanie wymienia niedomyślne parametry
posortowane po nazwie (`fit`, `format`, `h`, `q`, `w`; `fit=cover` pomijane):

```js
import { createHmac } from 'node:crypto';
const s = createHmac('sha256', process.env.VERDIN_IMAGE_SECRET)
  .update('photo_1a2b.jpg?format=webp&w=800')
  .digest('hex');
const url = `/uploads/photo_1a2b.jpg?format=webp&w=800&s=${s}`;
```

### Dostawca S3

Dowolna usługa zgodna z S3 (AWS, Cloudflare R2, MinIO, Backblaze B2…). Poświadczenia
pochodzą ze standardowych zmiennych środowiskowych `AWS_*` (`AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`).

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `bucket` | wymagany | Nazwa bucketu. |
| `region` | nieustawiony | Region bucketu. |
| `endpoint` | nieustawiony | Własny endpoint dla usług spoza AWS, np. `https://<account>.r2.cloudflarestorage.com`. |
| `public_url` | wymagany | Publiczny bazowy URL bucketu lub jego CDN; pliki są linkowane jako `{public_url}/{key}`. |
| `prefix` | `""` | Prefiks kluczy wewnątrz bucketu. |
| `path_style` | `false` | Żądania w stylu ścieżki (MinIO i większość usług self-hosted). |

```toml
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

## `[webhooks]`

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `allow_private_networks` | nieustawiony | Pozwala na URL-e webhooków na adresach loopback, prywatnych i link-local; dotyczy też celów wdrożeń i webhooka `[cdn]`. Nieustawione oznacza nie w `verdin start` (inaczej administrator mógłby dotrzeć do usług wewnętrznych) i tak w `verdin dev`. |
| `timeout_secs` | `10` | Limit czasu każdego dostarczenia. |
| `retention_days` | `30` | Liczba dni przechowywania dziennika dostarczeń. |

Zobacz [Webhooki](/pl/guides/integrations/webhooks/).

## `[history]`

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `max_versions` | `50` | Wersje przechowywane na dokument (starsze są usuwane). |

## `[email]`

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `provider` | `"log"` | `log` (zapisuje e-maile do logu), `smtp`, `resend` lub `postmark`. |
| `from` | `"Verdin <no-reply@localhost>"` | Nadawca. |
| `reply_to` | nieustawiony | Adres odpowiedzi. |

### `[email.smtp]`

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `host` | `"localhost"` | Serwer SMTP. |
| `port` | `587` | Port SMTP. |
| `username` | nieustawiony | Użytkownik SMTP; hasło pochodzi z `VERDIN_EMAIL_SMTP_PASSWORD`. |
| `security` | `"starttls"` | `starttls`, `tls` (niejawne, zwykle port 465) lub `none` (lokalne relaye). |

## `[plugins]`

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `path` | `"plugins"` | Katalog wtyczek (po jednym podkatalogu na wtyczkę), względem pliku konfiguracyjnego. |
| `run_jobs` | `true` | Uruchamia zaplanowane zadania wtyczek na tej instancji (na jednej instancji, gdy jest ich kilka). |

Zobacz [Wtyczki](/pl/extending/plugins/).

## `[audit]`

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `retention_days` | `90` | Liczba dni przechowywania wpisów dziennika audytu. |

## `[digest]`

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `enabled` | `true` | Wysyła codzienne podsumowanie z tej instancji (z jednej instancji, gdy jest ich kilka). |
| `hour_utc` | `8` | Godzina (UTC, 0–23), o której wychodzi codzienne podsumowanie nieprzejrzanych zmian. |

## `[log]`

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `format` | `"pretty"` | `pretty` lub `json`. |
| `level` | nieustawiony (`info`) | Domyślny filtr; `RUST_LOG` ma pierwszeństwo, gdy jest ustawione. |

## `[metrics]`

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `enabled` | `false` | Serwuje metryki Prometheus pod `/_metrics`: żądania HTTP według obszaru (`api`, `admin_api`, `graphql`, `mcp`, `uploads`…), metody i klasy statusu z histogramami opóźnień, oczekujące dostarczenia webhooków, otwarte strumienie czasu rzeczywistego i czas działania. |
| `token` | nieustawiony | Scrape'y wymagają `Authorization: Bearer <token>`. `VERDIN_METRICS_TOKEN` ma pierwszeństwo. Bez tokenu metryki może odczytać każdy, kto dotrze do portu. |

## `[ai]`

Działania AI w panelu (z włączoną funkcją **Działania AI** w Ustawienia → Funkcje):
tłumaczenie wpisu na inny język, pisanie tekstu alternatywnego obrazów, streszczanie tekstu,
proponowanie metadanych SEO. Zwracają sugestie; nic nie jest zapisywane bez redaktora. Klucz
jest odczytywany z `VERDIN_AI_KEY` (serwery lokalne go nie potrzebują).

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `provider` | `"none"` | `anthropic`, `openai` lub `openai-compatible` (Ollama, LM Studio, vLLM…). |
| `model` | `claude-sonnet-5` dla `anthropic` | Model; wymagany dla pozostałych dostawców. |
| `base_url` | dostawcy | Inny endpoint, np. `http://localhost:11434/v1`. |
| `max_tokens` | `2048` | Najdłuższa odpowiedź. |

```toml
[ai]
provider = "anthropic"
```

Każdy administrator może wykonać 30 żądań AI na minutę. Treść i obrazy są wysyłane do
dostawcy: wybierz takiego, na którego pozwala twoja organizacja.

## `[cdn]`

Czyści cache CDN, gdy treść zmienia się publicznie. Odpowiedzi API treści mają tagi `vd`
i `vd-<singularName>` (nagłówki `Cache-Tag` i `Surrogate-Key`).

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `provider` | `"none"` | `cloudflare`, `fastly` lub `webhook`. |
| `zone_id` | nieustawiony | Strefa Cloudflare (czyszczenie po tagu). |
| `service_id` | nieustawiony | Usługa Fastly (czyszczenie po surrogate key). |
| `url` | nieustawiony | `webhook`: odbiera `POST { "tags": [...] }`. |
| `debounce_ms` | `1000` | Czas zbierania zmian przed czyszczeniem. |

Token API jest odczytywany z `VERDIN_CDN_TOKEN` (wysyłany do webhooków jako token bearer).

## `[search]`

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `enabled` | `false` | Szereguje `_q` indeksem pełnotekstowym (Tantivy) zamiast `$containsi`. |
| `dir` | `"data/search"` | Katalog indeksu, względem projektu. Jego usunięcie powoduje odbudowę indeksu przy następnym starcie. |
| `memory_mb` | `50` | Budżet pamięci indeksowania. |

Indeks znajduje się na dysku instancji i śledzi zapisy tej instancji: przy kilku instancjach
trzymaj wyszukiwanie na jednej (albo przebudowuj po wdrożeniu).

## Zmienne środowiskowe

Oprócz nadpisań `VERDIN_<SECTION>__<KEY>` Verdin czyta te zmienne:

| Zmienna | Opis |
| --- | --- |
| `VERDIN_CONFIG` | Ścieżka pliku konfiguracyjnego (to samo co `--config`). |
| `VERDIN_DATABASE_URL` | Skrót dla `database.url`. |
| `VERDIN_ADMIN_JWT_SECRET` | Podpisuje tokeny sesji administratorów. Wymagany, co najmniej 32 bajty; wygeneruj go przez `verdin secrets`. |
| `VERDIN_TOKEN_PEPPER` | Klucz hashy przechowywanych tokenów. Wymagany, co najmniej 32 bajty; wygeneruj go przez `verdin secrets`. |
| `VERDIN_ADMIN_PASSWORD` | Hasło dla `verdin admin create` i `verdin admin reset-password` (w przeciwnym razie odczytywane ze stdin); zobacz [dokumentację wiersza poleceń](/pl/reference/cli/). |
| `VERDIN_EMAIL_SMTP_PASSWORD` | Hasło SMTP. |
| `VERDIN_EMAIL_API_KEY` | Klucz API dostawców Resend i Postmark. |
| `VERDIN_SSO_<ID>_SECRET` | Sekret klienta dostawcy SSO; `<ID>` to identyfikator dostawcy wielkimi literami z `-` jako `_` (zobacz [Logowanie jednokrotne](/pl/guides/auth/sso/)). |
| `VERDIN_OAUTH_<PROVIDER>_SECRET` | Sekret klienta dostawcy OAuth dla użytkowników końcowych, nazywany jak w SSO (zobacz [Użytkownicy końcowi](/pl/guides/auth/end-users/)). |
| `VERDIN_AI_KEY` | Klucz API dostawcy `[ai]`. |
| `VERDIN_CDN_TOKEN` | Token API dostawcy `[cdn]`. |
| `VERDIN_IMAGE_SECRET` | Podpisuje URL-e transformacji obrazów (zobacz [`[upload.transforms]`](#uploadtransforms)). |
| `VERDIN_METRICS_TOKEN` | Token bearer dla scrape'ów `/_metrics` przy `[metrics].enabled`; ma pierwszeństwo przed `[metrics].token`. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Poświadczenia dostawcy przesyłania S3. |
| `RUST_LOG` | Filtr logów; ma pierwszeństwo przed `[log].level`. |
