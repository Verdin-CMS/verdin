---
title: Monitoring
description: Obserwuj działającą instancję Verdin — kontrole /_health i /_ready, metryki Prometheus pod /_metrics i pulpit Grafana, ślady OpenTelemetry, raporty błędów Sentry, format logów, poziomy i identyfikatory żądań.
sidebar:
  order: 10
---

Instancja Verdin raportuje o sobie przez dwa endpointy stanu, opcjonalne metryki Prometheus,
opcjonalne ślady OpenTelemetry i raporty błędów Sentry oraz strukturalne logi. Ta strona
wymienia, co zwraca każdy z nich i jak go włączyć.

## Kontrole stanu

Oba endpointy są serwowane w katalogu głównym serwera, poza prefiksami API, i nie wymagają
uwierzytelniania.

| Endpoint | Odpowiada | Do czego |
| --- | --- | --- |
| `GET /_health` | Zawsze `200 {"status":"ok"}`, dopóki proces obsługuje HTTP. | Żywotność: zrestartuj proces, gdy przestanie odpowiadać. |
| `GET /_ready` | `200 {"status":"ready","database":"postgres"}`, gdy baza danych odpowiada na ping, `503 {"status":"unavailable"}`, gdy nie. | Gotowość i kontrole load balancera: kieruj ruch tylko do instancji, które odpowiadają 200. |

`database` to `postgres`, `mysql`, `mariadb` lub `sqlite`. `/_ready` nie sprawdza migracji:
`verdin start` odmawia startu, gdy migracje czekają (chyba że `--migrate` je zastosuje), więc
działający serwer nie ma żadnych oczekujących.

```sh frame="terminal"
curl -s localhost:1337/_ready
{"status":"ready","database":"sqlite"}
```

## Metryki Prometheus

Włącz metryki i ustaw token:

```toml title="verdin.toml"
[metrics]
enabled = true
```

```sh
VERDIN_METRICS_TOKEN=<a long random string>
```

`GET /_metrics` serwuje wtedy format tekstowy Prometheus (wersja 0.0.4). Z tokenem
(`VERDIN_METRICS_TOKEN`, który ma pierwszeństwo przed `[metrics].token`) scrape bez
`Authorization: Bearer <token>` dostaje `401`. Bez tokenu metryki może odczytać każdy, kto
dotrze do portu.

```yaml title="prometheus.yml"
scrape_configs:
  - job_name: verdin
    metrics_path: /_metrics
    authorization:
      type: Bearer
      credentials: <the token>
    static_configs:
      - targets: ["verdin:1337"]
```

Przy kilku instancjach scrapuj każdą z nich: każda instancja liczy własne żądania.

| Metryka | Typ | Etykiety | Znaczenie |
| --- | --- | --- | --- |
| `verdin_http_requests_total` | counter | `area`, `method`, `status` | Obsłużone żądania HTTP. |
| `verdin_http_request_duration_seconds` | histogram | `area`, `method`, `status` | Czas obsługi żądań. Przedziały od 5 ms do 10 s. |
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`, `kind`, `function` | Czas działania funkcji [wtyczek](/pl/extending/plugins/). Te same przedziały. |
| `verdin_plugin_call_errors_total` | counter | `plugin`, `kind`, `function` | Wywołania wtyczek, które się nie powiodły: trap, przekroczenie czasu, wyjście niebędące JSON lub `{ error }` funkcji startowej. |
| `verdin_webhook_deliveries_pending` | gauge | | Dostarczenia webhooków czekające na wysłanie. |
| `verdin_realtime_subscribers` | gauge | | Otwarte strumienie zdarzeń czasu rzeczywistego. |
| `verdin_cluster_events_total` | counter | `direction` | Zdarzenia na [wspólnej szynie zdarzeń](/pl/deploy/scaling/#wspólna-szyna-zdarzeń), przy ustawionym `[cluster].bus`: `sent` do innych instancji, `received` od nich, `dropped` (pełna kolejka lub nieudany zapis). |
| `verdin_uptime_seconds` | gauge | | Sekundy od startu procesu. |
| `verdin_build_info` | gauge | `version` | Zawsze 1; działająca wersja. |

`area` to część serwera: `api` (API treści), `admin_api`, `admin` (pliki panelu), `graphql`,
`mcp`, `uploads`, `internal` (ścieżki zaczynające się od `/_`) lub `other`. `status` to klasa
statusu: `2xx`, `3xx`, `4xx` lub `5xx`.
Dla wywołań wtyczek `kind` to `hook`, `route`, `job`, `startup` lub `graphql`; serie wtyczek
pojawiają się po pierwszym wywołaniu (zobacz
[dokumentację wtyczek](/pl/extending/plugin-reference/#metryki)).

Przydatne alerty: nieudane `/_ready`, rosnący udział `5xx`, rosnące
`verdin_webhook_deliveries_pending` (cel webhooka nie działa), rosnące
`verdin_plugin_call_errors_total` lub wolne hooki wtyczek (opóźniają zapisy, na których
działają) i resetujące się `verdin_uptime_seconds` (restarty).

### Pulpit Grafana

[`docker/grafana/verdin.json`](https://github.com/Verdin-CMS/verdin/blob/main/docker/grafana/verdin.json)
to pulpit dla tych metryk: tempo żądań, udział `5xx` i kwantyle opóźnień według obszaru,
metody i klasy statusu, oczekujące dostarczenia webhooków, subskrybenci czasu rzeczywistego,
ruch szyny zdarzeń oraz tempo wywołań wtyczek, p95 i błędy na funkcję wtyczki. Zaimportuj go
w Grafanie (**Dashboards → New → Import**) i wybierz źródło danych Prometheus; zmienne
`instance` i `area` u góry filtrują każdy panel.

## Ślady (OpenTelemetry)

Verdin może eksportować ślad każdego żądania do kolektora OpenTelemetry (OpenTelemetry
Collector, Grafana Alloy lub Tempo, Jaeger, Honeycomb, Datadog…) przez OTLP/HTTP. Domyślnie
jest wyłączony:

```toml title="verdin.toml"
[telemetry]
enabled = true
endpoint = "http://otel-collector:4318"
```

Działają też zmienne standardowe i mają pierwszeństwo przed plikiem:

```sh
VERDIN_TELEMETRY__ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<key>
OTEL_SERVICE_NAME=cms-production
```

Każdy ślad zawiera:

- **Span żądania** (rodzaj `server`), nazwany od metody i ścieżki z identyfikatorami
  zastąpionymi przez `{id}` (`PUT /api/articles/{id}`), z `http.response.status_code`
  i statusem błędu przy `5xx`. Żądanie z nagłówkiem W3C `traceparent` dołącza do śladu
  wywołującego.
- **Span na każde polecenie bazy danych** (rodzaj `client`) pod nim: `db.system.name`
  (`postgresql`, `mysql`, `mariadb` lub `sqlite`) i `db.query.text`, czyli SQL z jego
  placeholderami `?`. Przekazane wartości nigdy nie są zapisywane, więc treści, hasła i tokeny
  nie trafiają do śladów. `COMMIT` i `ROLLBACK` mają własne spany, a w SQLite span `write lock`
  pokazuje, jak długo zapis czekał na poprzedzające go zapisy.
- Zdarzenia logów zapisane podczas obsługi żądania, jako zdarzenia spanu.

Polecenia wykonywane poza żądaniem (start, migracje, zadania w tle) nie są śledzone.
`[telemetry].sample_ratio` zachowuje część śladów (`0.1` zachowuje jeden na dziesięć); spany
są wysyłane partiami i opróżniane przy zatrzymaniu serwera. Poziom logów nie filtruje śladów:
`[log].level = "warn"` nadal eksportuje każde żądanie.

## Raportowanie błędów (Sentry)

Ustaw DSN, aby wysyłać paniki i odpowiedzi `5xx` do [Sentry](https://sentry.io) (lub usługi
zgodnej z Sentry, jak GlitchTip):

```sh
SENTRY_DSN=https://<key>@o0.ingest.sentry.io/<project>
```

Działa też `[telemetry].sentry_dsn`; zmienna ma pierwszeństwo. `5xx` trafia jako zdarzenie
błędu `POST /api/articles answered 500`, z tagami `http.method`, `http.status_code`
i `request_id`, który odpowiada nagłówkowi `X-Request-Id` i liniom logów tego żądania.
Zdarzenia niosą wersję Verdin jako release oraz `production` (`verdin start`) lub
`development` (`verdin dev`) jako środowisko, chyba że `SENTRY_ENVIRONMENT` albo
`[telemetry].sentry_environment` podaje inne. URL-e są raportowane z ukrytymi wartościami
zapytania wyglądającymi na sekrety, jak w logach; treści żądań i nagłówki nigdy nie są
wysyłane.

## Logi

Verdin zapisuje logi na standardowe wyjście błędów.

| Ustawienie | Wartości | Domyślnie |
| --- | --- | --- |
| `[log].format` | `pretty` (dla terminali) lub `json` (jeden obiekt na linię) | `pretty`; `json` w obrazie Docker |
| `[log].level` | Poziom lub filtr: `error`, `warn`, `info`, `debug`, `trace` albo per moduł (`info,verdin_api=debug`) | `info` |
| `RUST_LOG` | Ta sama składnia; gdy ustawiona, ma pierwszeństwo przed `[log].level` | nieustawiona |

W produkcji używaj `json` i wysyłaj standardowe wyjście błędów do swojego systemu logów.
Linia JSON wygląda tak:

```json
{"timestamp":"2026-09-29T09:27:16.444598Z","level":"INFO","fields":{"message":"verdin listening","address":"0.0.0.0:1337","mode":"production","version":"0.10.0"},"target":"verdin::app"}
```

Przy starcie linie `WARN` wskazują ustawienia do poprawienia w produkcji, np.
`[email].provider is 'log'` albo wyłączone bezpieczne ciasteczka.

### Żądania

Każde żądanie dostaje identyfikator: przychodzący nagłówek `X-Request-Id`, jeśli jest, albo
nowy UUID. Jest odsyłany w nagłówku odpowiedzi `X-Request-Id` i dołączany do każdej linii
logu zapisanej podczas obsługi żądania (`request_id`, z `method` i `uri`). Przekazuj ten
nagłówek z proxy, aby śledzić żądanie między systemami.

Żądania nie są logowane pojedynczo na poziomie `info`. Aby logować każde żądanie z jego
statusem i opóźnieniem, podnieś poziom warstwy HTTP:

```sh
RUST_LOG=info,tower_http=debug
```

Logowane URL-e ukrywają wartości parametrów zapytania, których nazwy wyglądają na sekretne
(`token`, `code`, `state`, `password`, `key`, `signature`, `jwt`…), np.
`/api/connect/github/callback?code=[hidden]`.

## W panelu administracyjnym

Dodaj widżet **System** do pulpitu strony głównej, aby od razu widzieć wersję, bazę danych
i schemat.
