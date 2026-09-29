---
title: Dokumentacja wtyczek
description: Manifest plugin.toml, uprawnienia (capabilities), hooki i ich payloady, funkcje hosta, trasy, zadania, pola GraphQL, punkty rozszerzeń panelu i limity.
sidebar:
  order: 3
---

<!-- Written from crates/verdin-plugins (lib.rs, manifest.rs), crates/verdin-api/src/plugins.rs,
plugins_admin.rs, crates/verdin-graphql/src/lib.rs and admin/src/app/core/plugin-extensions.ts. -->

Ta strona to pełny kontrakt między Verdin a wtyczką: manifest, co Verdin wysyła do każdej
eksportowanej funkcji i czego oczekuje w odpowiedzi, oraz funkcje hosta, które moduł może
wywoływać. Wprowadzenie znajdziesz w [Wtyczkach](/pl/extending/plugins/), a przykład krok po
kroku w [samouczku wtyczek](/pl/extending/plugin-tutorial/).

## Katalog wtyczki

Każda wtyczka to katalog w `[plugins].path` (domyślnie `plugins/`, obok `verdin.toml`):

| Plik | Wymagany | Zawartość |
| --- | --- | --- |
| `plugin.toml` | tak | Manifest. |
| `plugin.wasm` | tak | Moduł (inna ścieżka przez `wasm`). |
| `admin/` | nie | Pliki ładowane przez panel administracyjny: moduł `admin.script` i jego zasoby. |

Przy starcie Verdin ładuje każdy katalog z plikiem `plugin.toml`, w kolejności nazw. Katalog
jest pomijany i wymieniany z podaniem przyczyny w **Ustawienia → Wtyczki**, gdy jego manifest
jest niepoprawny, brakuje modułu albo inna wtyczka ma już tę samą `name`.

## Manifest

```toml title="plugins/slugs/plugin.toml"
name = "slugs"
version = "1.0.0"
description = "Slugs from titles, and a color field"

[capabilities]
read = ["api::article"]
write = ["api::tag"]
http = ["api.example.com"]
kv = true

[limits]
timeout_ms = 5000
memory_mb = 64

[[hooks]]
on = "beforeCreate"
uid = "api::article"
function = "before_write"

[routes]
function = "handle"

[[jobs]]
schedule = "*/15 * * * *"
function = "refresh"

[[graphql]]
name = "slugStats"
function = "stats"

[admin]
script = "index.js"

[[admin.widgets]]
id = "stats"
title = "Slug stats"
element = "slugs-stats"

[[admin.fields]]
id = "color"
title = "Color"
element = "slugs-color"
type = "string"

[[settings]]
key = "separator"
label = "Separator"
type = "select"
options = ["-", "_"]
default = "-"
```

Nieznane klucze są błędami, w każdej tabeli.

### Klucze najwyższego poziomu

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `name` | wymagany | Identyfikator wtyczki w URL-ach, ustawieniach i polach niestandardowych: małe litery, cyfry i `-`, zaczyna się od litery, najwyżej 64 znaki. |
| `version` | wymagany | Wyświetlany w panelu i w logu. |
| `description` | nieustawiony | Wyświetlany w **Ustawienia → Wtyczki**. |
| `wasm` | `"plugin.wasm"` | Moduł, względem katalogu wtyczki (bez `..`, nie bezwzględny). |
| `wasi` | `false` | Daje modułowi WASI: zegar i liczby losowe. W żadnym przypadku bez plików i gniazd. |

### `[capabilities]`

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `read` | `[]` | Typy zawartości, które `verdin_content` może czytać (`findMany`, `findOne`): UID-y takie jak `api::article` lub `"*"` dla wszystkich. |
| `write` | `[]` | Typy zawartości, na których może wykonywać `create`, `update`, `delete`, `publish` i `unpublish`. Obejmuje `read`. |
| `http` | `[]` | Hosty, do których moduł może wysyłać żądania HTTP: `api.example.com` lub `*.example.com`. |
| `kv` | `false` | Własny magazyn klucz-wartość wtyczki (`verdin_kv_get`, `verdin_kv_set`). |

Capabilities ograniczają tylko wywołania hosta. Hooki działają na wskazanych typach
niezależnie od `read`, a trasy są dostępne dla każdego.

### `[limits]`

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `timeout_ms` | `5000` | Limit czasu jednego wywołania, w milisekundach. |
| `memory_mb` | `64` | Największa pamięć modułu, w megabajtach. |

Obie wartości muszą być dodatnie.

### `[[hooks]]`

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `on` | wymagany | Zdarzenie, poniżej. |
| `uid` | `"*"` | Typ zawartości (`api::article`) lub `"*"` dla wszystkich. |
| `function` | wymagany | Eksportowana funkcja do wywołania. |

Zdarzenia:

| Przed zapisem | Po zapisie |
| --- | --- |
| `beforeCreate` | `afterCreate` |
| `beforeUpdate` | `afterUpdate` |
| `beforeDelete` | `afterDelete` |
| `beforePublish` | `afterPublish` |
| `beforeUnpublish` | `afterUnpublish` |
| `beforeDiscardDraft` | `afterDiscardDraft` |

Nazwy to nazwy cyklu życia ze Strapi. Hooki działają przy zapisach z panelu
administracyjnego, API REST i GraphQL oraz wydań, ale nie przy zapisach wykonanych przez
wtyczki (zobacz [Zapisy wykonywane przez wtyczki](#zapisy-wykonywane-przez-wtyczki)) ani przez
polecenia `verdin import`.

### `[routes]`

| Klucz | Opis |
| --- | --- |
| `function` | Eksportowana funkcja, która obsługuje każde żądanie do `/api/plugins/<name>` i `/api/plugins/<name>/…`, dowolną metodą. |

Ścieżka podąża za `[api].prefix`.

### `[[jobs]]`

| Klucz | Opis |
| --- | --- |
| `schedule` | Wyrażenie cron, w UTC, z opcjonalnymi sekundami: `*/15 * * * *`, `0 0 3 * * *`. |
| `function` | Eksportowana funkcja do wywołania. |

### `[[graphql]]`

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `name` | wymagany | Nazwa pola: zaczyna się od małej litery, potem litery, cyfry i `_`. |
| `function` | wymagany | Eksportowana funkcja, która je rozwiązuje. |
| `mutation` | `false` | Dodaje pole do `Mutation` zamiast `Query`. |
| `description` | nieustawiony | Opis pola w schemacie. |

Każdy wpis dodaje `name(args: JSON): JSON`. Nazwa, której używa już typ zawartości albo
którą wcześniej zajęła inna wtyczka, jest pomijana z ostrzeżeniem w logu.

### `[admin]`

| Klucz | Opis |
| --- | --- |
| `script` | Moduł ES w `admin/`, który definiuje elementy niestandardowe (bez `..`, nie bezwzględny). |
| `[[admin.widgets]]` | Typy widżetów pulpitu: `id`, `title`, `element`, opcjonalnie `description`. |
| `[[admin.fields]]` | Pola niestandardowe: `id`, `title`, `element`, `type` (typ atrybutu, jako który wartość jest przechowywana, np. `string` lub `json`), opcjonalnie `description`. |

`element` to nazwa elementu niestandardowego: małe litery, cyfry i `-`, z co najmniej jednym
`-` (`slugs-color`).

### `[[settings]]`

Deklaruje formularz **Ustawienia → Wtyczki → Ustawienia**. Bez żadnego wpisu ustawienia są
dowolnym obiektem JSON.

| Klucz | Domyślnie | Opis |
| --- | --- | --- |
| `key` | wymagany | Klucz w obiekcie ustawień: litery, cyfry i `_`, nie zaczyna się od cyfry, unikalny. |
| `label` | wymagany | Etykieta w formularzu. |
| `type` | `"string"` | `string`, `text`, `url`, `number`, `integer`, `boolean` lub `select`. |
| `description` | nieustawiony | Tekst pomocy pod polem. |
| `required` | `false` | Wartość (niepusta dla tekstu) jest potrzebna, chyba że jest `default`. |
| `options` | `[]` | Opcje `select` (wymagane dla niego). |
| `default` | nieustawiony | Używany, gdy klucza brakuje lub jest `null`. Musi pasować do pola. |
| `min`, `max` | nieustawione | Granice wartości `number` i `integer`; granice długości `string` i `text`. |

Wartości `url` są puste albo są URL-ami `http(s)://`. Z formularzem serwer odrzuca ustawienia
z nieznanymi kluczami, złymi typami, wartościami poza granicami lub brakującymi wymaganymi
wartościami (400).

## Eksportowane funkcje

Każda eksportowana funkcja przyjmuje jeden dokument JSON i zwraca jeden (albo nic). Puste
wyjście liczy się jako `null`; wyjście, które nie jest JSON-em, liczy się jako błąd.

### Hooki „before”

Wejście:

```json
{
  "event": "beforeUpdate",
  "uid": "api::article",
  "documentId": "01m3p88ry359w82nsx496mep5t",
  "locale": "en",
  "data": { "title": "Hello" }
}
```

| Pole | Opis |
| --- | --- |
| `event` | Zdarzenie hooka. |
| `uid` | Typ zawartości. |
| `documentId` | Dokument albo `null` przy `beforeCreate`. |
| `locale` | W typach lokalizowanych zapisywany język (język domyślny, gdy żądanie go nie podało); `null` w pozostałych typach. |
| `data` | Zapisywane dane, tak jak wysłało je żądanie: przy tworzeniu i aktualizacji. `null` dla pozostałych zdarzeń. Przy aktualizacji tylko wysłane pola. |

Wyjście:

| Wyjście | Efekt |
| --- | --- |
| `{ "data": { … } }` | Zastępuje zapisywane dane. Są walidowane jak oryginał. |
| `{ "error": "message" }` | Odrzuca zapis: wywołujący dostaje 400 z komunikatem. |
| `{}` lub cokolwiek innego | Zapis przebiega bez zmian. |

Gdy pasuje kilka hooków, działają w kolejności wtyczek (nazw katalogów), a potem manifestu;
każdy widzi dane zwrócone przez poprzedni. Hook, który zawiedzie (trap, przekroczenie czasu,
niepoprawne wyjście), jest logowany i pomijany: zapis przebiega dalej.

### Hooki „after”

Wejście: `{ "event", "uid", "documentId", "locale" }`, wysyłane po zatwierdzeniu zapisu.
Wyjście jest ignorowane; błędy są logowane. Jeśli potrzebujesz pól wpisu, odczytaj go przez
`verdin_content` (z capability `read`).

### Trasy

Wejście:

```json
{
  "method": "GET",
  "path": "/stats",
  "query": "page=2&sort=title",
  "headers": { "accept": "application/json", "user-agent": "curl/8.7.1" },
  "body": "",
  "actor": { "kind": "public" }
}
```

| Pole | Opis |
| --- | --- |
| `method` | Metoda HTTP. |
| `path` | Ścieżka po `/api/plugins/<name>`, zaczynająca się od `/` (`/` dla katalogu głównego wtyczki). |
| `query` | Surowy query string, bez `?` (pusty, gdy go nie ma). |
| `headers` | Tylko `content-type`, `accept`, `user-agent` i `accept-language`, jeśli są obecne. |
| `body` | Treść żądania jako string (niepoprawne UTF-8 jest zastępowane). |
| `actor` | Kto wywołuje: `{ "kind": "public" }`, `{ "kind": "token", "id": 3 }` (token API) lub `{ "kind": "user", "id": 12 }` (zalogowany użytkownik końcowy). |

Nagłówek `Authorization` z niepoprawnym tokenem jest odrzucany z 401, zanim wtyczka zostanie
wywołana. Uprawnienia dostępu publicznego i tokenów API nie są stosowane: sprawdzaj `actor`
samodzielnie.

Wyjście:

| Pole | Domyślnie | Opis |
| --- | --- | --- |
| `status` | `200` | Status HTTP. |
| `headers` | brak | Nagłówki odpowiedzi. Zachowywane są tylko `content-type`, `cache-control`, `location`, `etag`, `last-modified` i `content-disposition`. |
| `body` | pusty | String jest wysyłany bez zmian (`text/plain`, chyba że ustawisz `content-type`); każda inna wartość JSON jest wysyłana jako `application/json`. |

Wyłączona lub nieznana wtyczka albo wtyczka bez `[routes]` odpowiada 404. Nieudane wywołanie
odpowiada 502 z `{ "data": null, "error": { "status": 502, "name": "PluginError", … } }`.
Trasy dzielą z API treści `[server].body_limit` i `[server].request_timeout_secs`.

### Zadania

Wejście: `{ "scheduledAt": "2026-09-29T03:00:00+00:00" }`, czyli czas, na który zaplanowano
uruchomienie. Wyjście jest ignorowane; błędy są logowane. Zadania działają tylko, gdy wtyczka
jest włączona, i tylko na instancjach z `[plugins].run_jobs = true`. Uruchomienie pominięte
podczas niedziałania serwera nie jest nadrabiane.

### Pola GraphQL

Wejście: `{ "args": …, "actor": … }`, gdzie `args` to argument `args` pola (dowolny JSON lub
`null`), a `actor` jak w trasach. Wyjście to wartość pola. Błąd albo wyłączona wtyczka daje
błąd GraphQL z kodem `PLUGIN_ERROR`. Tak jak w trasach, dostęp sprawdza wtyczka.

## Funkcje hosta

Importuj je z przestrzeni nazw `extism:host/user` (`extern "ExtismHost"` w Rust). Przyjmują
i zwracają JSON jako stringi; konwersję obsługuje `Json<Value>` w `extism-pdk`.

| Funkcja | Wejście | Wyjście |
| --- | --- | --- |
| `verdin_log` | `{ "level": "info" \| "warn" \| "error", "message": "…" }` | brak |
| `verdin_content` | Żądanie treści (poniżej) | Wynik lub `{ "error": "…" }` |
| `verdin_kv_get` | Klucz, jako zwykły string | Zapisana wartość JSON lub `null` |
| `verdin_kv_set` | `{ "key": "…", "value": … }` | brak |
| `verdin_config` | brak | Obiekt ustawień z uzupełnionymi zadeklarowanymi wartościami domyślnymi |

### `verdin_log`

Zapisuje do logu serwera (z nazwą wtyczki) i do logu wtyczki w **Ustawienia → Wtyczki →
Logi**. Inne poziomy liczą się jako `info`. Log wtyczki przechowuje w pamięci ostatnie 200
komunikatów, każdy przycięty do 2000 znaków.

### `verdin_content`

```json
{ "op": "findMany", "uid": "api::article", "query": { "filters": { "title": { "$eq": "x" } }, "sort": ["title"] } }
```

| Pole | Używane przez | Opis |
| --- | --- | --- |
| `op` | wszystkie | `findMany`, `findOne`, `create`, `update`, `delete`, `publish` lub `unpublish`. |
| `uid` | wszystkie | Typ zawartości. Musi być w capabilities. |
| `documentId` | `findOne`, `update`, `delete`, `publish`, `unpublish` | Dokument. |
| `query` | `findMany`, `findOne` | Parametry API REST jako obiekt JSON: `filters`, `sort`, `fields`, `populate`, `pagination`, `status`. |
| `data` | `create`, `update` | Pola do zapisania, jak w `data` żądania REST. |
| `status` | `create`, `update` | `"draft"` zapisuje szkic. W przeciwnym razie zapis jest publikowany, jak zapis REST bez `?status=draft`. |
| `locale` | wszystkie | Język do odczytu lub zapisu. |

Wyniki:

| `op` | Wynik |
| --- | --- |
| `findMany` | `{ "documents": [...], "meta": { "pagination": {…} } }` |
| `findOne` | `{ "document": {…} }` (`null`, gdy nie znaleziono) |
| `create`, `update` | `{ "documentId": "…" }` |
| `delete` | `{ "deleted": true }` |
| `publish` | `{ "published": true }` |
| `unpublish` | `{ "unpublished": true }` |

Wywołanie poza capabilities, nieznana operacja, błąd walidacji lub brakujący dokument dają
zamiast tego `{ "error": "…" }`. Odczyty zwracają opublikowane wersje, chyba że zapytanie
prosi o `"status": "draft"`.

#### Zapisy wykonywane przez wtyczki

Zapisy przez `verdin_content` pomijają hooki **before** wszystkich wtyczek, więc wtyczka nie
może tam zapętlić się na własnych zmianach. Wszystko inne obowiązuje: walidacja, etapy
recenzji, webhooki, historia, dziennik audytu i hooki **after** wszystkich wtyczek, łącznie
z tą, która zapisuje. Zabezpiecz hook after, który zapisuje typ, którego nasłuchuje.

### `verdin_kv_get` i `verdin_kv_set`

Magazyn klucz-wartość per wtyczka, w bazie danych Verdin, wspólny dla wszystkich instancji.
Klucze mają od 1 do 255 bajtów; wartości to dowolny JSON. Ustawienie `null` usuwa klucz. Bez
capability `kv` odczyty zwracają `null`, a zapisy są ignorowane.

### `verdin_config`

Zwraca ustawienia zapisane w **Ustawienia → Wtyczki**, z `default` każdego zadeklarowanego
ustawienia uzupełnionym dla brakujących kluczy. `{}`, gdy nic nie jest zapisane.

### HTTP

Z hostami wymienionymi w `http` używaj obsługi HTTP z Extism (`extism_pdk::http::request`
w Rust). Żądania do innych hostów się nie powiodą.

## Punkty rozszerzeń panelu

Panel administracyjny pyta serwer o rozszerzenia włączonych wtyczek i importuje każdy
`admin.script` raz, jako moduł ES, z `/admin/plugins/<name>/<script>` (pod `[admin].path`).
Pliki z katalogu `admin/` wtyczki są tam serwowane, gdy wtyczka jest włączona, z nagłówkami
`X-Content-Type-Options: nosniff` i `Cache-Control: no-cache`. Moduł musi definiować
elementy niestandardowe wskazane w manifeście; element niezdefiniowany w ciągu 3 sekund jest
pomijany.

### Widżety

Każdy wpis `[[admin.widgets]]` to typ widżetu, który administratorzy mogą dodać do pulpitu.
Element otrzymuje właściwość `context`:

| Właściwość | Opis |
| --- | --- |
| `apiBase` | Baza API treści, np. `/api`. |
| `adminApiBase` | Baza API administracyjnego, np. `/admin/api`. |
| `fetch(path, init)` | `fetch` z poświadczeniami zalogowanego administratora. Ścieżki względne są rozwiązywane względem `adminApiBase`; ścieżki pod którąkolwiek bazą i bezwzględne URL-e są zachowywane. |

```js title="plugins/slugs/admin/index.js"
class SlugStats extends HTMLElement {
  set context(context) {
    // Admin API, with the admin's session.
    context.fetch('auth/me').then((response) => response.json())
      .then(({ data }) => { this.textContent = `Hello ${data.firstname ?? data.email}`; });
    // The plugin's own route, on the content API: sent without the admin's session.
    context.fetch(`${context.apiBase}/plugins/slugs/stats`).then((response) => response.json())
      .then((stats) => { this.title = JSON.stringify(stats); });
  }
}
customElements.define('slugs-stats', SlugStats);
```

`context.fetch` wysyła sesję administratora tylko z żądaniami do API administracyjnego.
Ścieżki pod `context.apiBase` (API treści, łącznie z trasami twojej wtyczki) idą bez niej,
bo API treści nie akceptuje sesji administratorów; odpowiedzi są udzielane z uprawnieniami
roli publicznej. Przed 0.10 sesja była wysyłana również tam, a te żądania kończyły się
błędem; widżety napisane dla 0.9, które wywołują zwykłe `fetch`, nadal działają.

### Pola niestandardowe

Każdy wpis `[[admin.fields]]` to pole, którego atrybuty mogą używać przez
`"customField": "plugin::<name>.<id>"`; `type` atrybutu musi odpowiadać sposobowi, w jaki
pole przechowuje wartość. Oferuje je **Kreator typów zawartości**. Element otrzymuje:

| Właściwość | Opis |
| --- | --- |
| `value` | Bieżąca wartość. |
| `disabled` | Czy edycja jest wyłączona. |
| `attribute` | Definicja atrybutu ze schematu. |
| `locale` | Edytowany język. |

Nową wartość zgłasza zdarzeniem `change`, którego `detail` to wartość (albo, bez `detail`,
przez własną właściwość `value`). Gdy wtyczka jest wyłączona albo brakuje jej elementu,
edytor pokazuje zwykłe pole wejściowe dla typu przechowywania. Zobacz
[Typy atrybutów](/pl/reference/attribute-types/).

## Środowisko uruchomieniowe i limity

| Limit | Wartość |
| --- | --- |
| Czas na wywołanie | `[limits].timeout_ms`, domyślnie 5000 ms |
| Pamięć | `[limits].memory_mb`, domyślnie 64 MB |
| Współbieżność | Jedno wywołanie naraz na wtyczkę; wywołania czekają na siebie |
| Instancja modułu | Jedna na wtyczkę, tworzona przy pierwszym użyciu; odtwarzana po nieudanym wywołaniu (jej pamięć jest tracona) |
| Log | 200 komunikatów na wtyczkę, po 2000 znaków, w pamięci |
| Klucze KV | Od 1 do 255 bajtów |
| Nagłówki żądania trasy | `content-type`, `accept`, `user-agent`, `accept-language` |
| Nagłówki odpowiedzi trasy | `content-type`, `cache-control`, `location`, `etag`, `last-modified`, `content-disposition` |

Zmiany manifestu lub modułu działają po restarcie; przełączniki i ustawienia działają od
razu. Zarządzanie wtyczkami wymaga `plugins.manage` (zobacz
[dokumentację uprawnień](/pl/reference/permissions/)).
