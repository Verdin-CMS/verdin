---
title: Bezpieczeństwo
description: Jak Verdin chroni panel administracyjny, API treści i serwer, które ustawienia utwardzają instancję produkcyjną i jak zgłosić podatność.
sidebar:
  order: 2
---

Ta strona opisuje, co Verdin robi, aby chronić projekt, i które ustawienia kontrolujesz.
Korzystaj z niej razem z [listą kontrolną produkcji](/pl/deploy/production-checklist/),
gdy przygotowujesz instancję na prawdziwy ruch.

## Co jest domyślnie zamknięte

- **API treści.** Anonimowe żądania nic nie dostają, dopóki nie przyznasz uprawnień
  publicznych w **Ustawienia → Dostęp publiczny**. Nieznany, wygasły lub niepoprawny token
  to `401`, nigdy przejście na rolę publiczną. Zobacz [Uprawnienia](/pl/concepts/permissions/).
- **Dokument OpenAPI** pod `/api/_openapi.json` wymaga poprawnego tokenu API, dopóki nie
  upublicznisz go w **Ustawienia → Funkcje → Dokumentacja API**.
- **Funkcje opcjonalne**, takie jak GraphQL, użytkownicy końcowi, SSO i serwer MCP, są
  wyłączone, dopóki administrator z uprawnieniem `features.manage` nie włączy ich
  w **Ustawienia → Funkcje**.
- **Wtyczki** są wyłączone, dopóki administrator nie włączy każdej z nich w
  **Ustawienia → Wtyczki**.
- **Wywołania cross-origin z przeglądarki.** Żaden origin nie może wywołać żadnego API
  z przeglądarki, dopóki nie wpiszesz go do `[api].cors_origins`.

## Logowanie administratorów

| Ochrona | Szczegóły |
| --- | --- |
| Hashowanie haseł | Argon2id z parametrami OWASP, z ponownym hashowaniem, gdy się zmienią. |
| Sesje | 15-minutowy token dostępu trzymany w pamięci strony (nigdy w `localStorage`) i 30-dniowy token odświeżania w ciasteczku `HttpOnly`, `SameSite=Strict` ograniczonym do `/admin/api/auth`. Token odświeżania jest rotowany przy każdym użyciu; przedstawienie starego kończy całą sesję. |
| Bezpieczne ciasteczka | Ciasteczko odświeżania jest `Secure` w `verdin start`. `[admin].secure_cookies = false` to wyłącza i zapisuje ostrzeżenie. |
| CSRF | Odświeżanie i wylogowanie wymagają nagłówka `X-Verdin-CSRF`, którego formularz z innej witryny nie może wysłać. |
| Blokada | Pięć nieudanych prób blokuje konto na 15 minut. Nieudane próby liczą się łącznie dla kroku hasła i drugiego składnika. Nieznane e-maile i złe hasła dostają tę samą odpowiedź, w tym samym czasie. |
| Limit żądań | Logowanie, rejestracja i odświeżanie: `[admin].auth_rate_limit` żądań na minutę i adres klienta (20). |
| Drugi składnik | Aplikacje uwierzytelniające (TOTP) i klucze dostępu, z kodami odzyskiwania. Rola może go wymagać (`requireTwoFactor`). Zobacz [Uwierzytelnianie dwuskładnikowe](/pl/guides/auth/two-factor/). |
| Super Admini | Tylko Super Admin może utworzyć, edytować, usunąć lub zresetować Super Admina albo nadać tę rolę. Ostatniego aktywnego Super Admina nie można usunąć. |

Pierwszy administrator jest rejestrowany przez panel, dopóki nie istnieje żaden
administrator. Zrób to zaraz po pierwszym uruchomieniu albo utwórz go przez
`verdin admin create --email …`, zanim wystawisz serwer.

## Panel administracyjny i API administracyjne

- API administracyjne (`/admin/api`) nie wysyła nagłówków CORS, niezależnie od
  `[api].cors_origins`: przeglądarki pozwalają odczytać jego odpowiedzi tylko własnemu
  originowi panelu.
- Panel jest serwowany ze ścisłą polityką Content Security Policy (skrypty tylko z własnego
  originu), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`
  i `Referrer-Policy: strict-origin-when-cross-origin`.
- Verdin nie wysyła `Strict-Transport-Security`. Dodaj go na reverse proxy, które terminuje
  TLS.

## API treści

- **Tokeny API** są pokazywane raz. Verdin przechowuje HMAC-SHA256 każdego tokenu z kluczem
  `VERDIN_TOKEN_PEPPER` i zachowuje 10-znakowy prefiks do wyświetlania. Tokeny mogą wygasać
  i można je regenerować.
- **Uprawnienia do pól i języków** ograniczają, co rola czyta i zapisuje, a `populate`,
  filtry i sortowanie przez relacje docierają tylko do typów, które wywołujący może czytać.
- **Limity zapytań**: `pageSize` do `[api].max_page_size` (100), głębokość `populate` do 5,
  najwyżej 100 warunków filtrowania, query string do 16 KB i najwyżej 1000 wypełnionych
  wpisów na relację. Nieznane lub prywatne pola w zapytaniu to `400`.
- **GraphQL** ma własne limity głębokości i złożoności (`maxDepth`, `maxComplexity`)
  i przełącznik introspekcji w ustawieniach funkcji.
- **Limity żądań**: `[api].public_rate_limit` per adres klienta bez tokenu
  i `[api].token_rate_limit` per token API lub użytkownika końcowego, w żądaniach na minutę.
  Oba są domyślnie wyłączone (`0`). Żądania z nieznanym tokenem bearer są ograniczane per
  adres.

### CORS

`[api].cors_origins` wymienia originy przeglądarek, które mogą wywoływać API treści
i GraphQL:

```toml title="verdin.toml"
[api]
cors_origins = ["https://www.example.com", "https://preview.example.com"]
```

Każdy wpis to `scheme://host[:port]` bez ścieżki i końcowego ukośnika; `["*"]` pozwala na
dowolny origin i nie może być łączony z innymi. Dozwolone metody to `GET`, `POST`, `PUT`
i `DELETE`, a dozwolone nagłówki żądań `Authorization`, `Content-Type` i `If-None-Match`.
Start kończy się błędem przy wpisie, który nie jest originem.

Frontendy po stronie serwera (Astro, Next.js na serwerze) wywołują API bez przeglądarki i nie
potrzebują wpisu CORS.

## Żądania i przesyłanie plików

| Ustawienie | Domyślnie | Chroni przed |
| --- | --- | --- |
| `[server].body_limit` | `"1mb"` | Dużymi treściami żądań w zwykłych API. |
| `[server].request_timeout_secs` | `30` | Wolnymi żądaniami blokującymi połączenia. |
| `[upload].max_file_size` | 200 MB | Dużymi przesyłanymi plikami (przesyłanie ma własny limit zamiast `body_limit`). |
| `[upload].max_image_megapixels` | `100` | Bombami dekompresyjnymi. |

Typ przesłanego pliku pochodzi z jego bajtów, a nie z typu wysłanego przez klienta; nazwa
pliku jest tylko rozwiązaniem awaryjnym i nigdy nie dotyczy typów, które przeglądarki
aktywnie uruchamiają (takie pliki są zapisywane jako `application/octet-stream`). Linki
w rich text `blocks` muszą być `http(s)`, `mailto:` lub względne.

## Adresy klientów za proxy

Limity żądań i dzienniki audytu używają adresu klienta. Za reverse proxy każde żądanie
pochodzi od proxy, więc wpisz je do `[server].trusted_proxies`:

```toml title="verdin.toml"
[server]
trusted_proxies = ["10.0.0.0/8"]   # the proxies' IPs or CIDR ranges
```

Verdin odczytuje wtedy `X-Forwarded-For` od prawej do lewej i bierze pierwszy adres, który
nie jest zaufanym proxy. Żądania z każdego innego adresu zachowują adres połączenia, więc
klient nie może podrobić swojego adresu, wysyłając nagłówek samodzielnie. Nie wpisuj
zakresów, z których mogą łączyć się niezaufani klienci.

## Żądania wychodzące

Webhooki, hooki wdrożeń, webhooki czyszczenia CDN i przesyłanie z URL wykonują żądania,
które wybiera administrator. W `verdin start` odrzucają adresy loopback, prywatne
i link-local (łącznie z formami IPv6 zawierającymi prywatne adresy IPv4), więc administrator
nie może ich użyć, aby dostać się do usług w twojej sieci wewnętrznej.
`[webhooks].allow_private_networks = true` znosi to ograniczenie; rób to tylko wtedy, gdy
każdemu administratorowi ufasz w kwestii sieci wewnętrznej.

## Sekrety

`VERDIN_ADMIN_JWT_SECRET` i `VERDIN_TOKEN_PEPPER` są odczytywane tylko ze środowiska i każdy
musi mieć co najmniej 32 bajty (`verdin secrets` wypisuje nowe). Pepper szyfruje też sekrety
TOTP administratorów i jest źródłem klucza, który hashuje adresy osób wysyłających
formularze. Przechowuj oba w menedżerze sekretów swojej platformy i nigdy nie zatwierdzaj
`.env`.

Logi żądań ukrywają wartości parametrów zapytania, których nazwy wyglądają na sekretne
(`token`, `code`, `password`, `key`, `signature`…), oraz sekretną część URL-i callbacków
wdrożeń.

## Metryki

`/_metrics` jest wyłączone, chyba że `[metrics].enabled = true`. Gdy jest włączone, a token
nie jest ustawiony, może je odczytać każdy, kto dotrze do portu. Ustaw
`VERDIN_METRICS_TOKEN` (lub `[metrics].token`) i scrapuj z `Authorization: Bearer <token>`
albo zablokuj ścieżkę na proxy. Zobacz [Monitoring](/pl/deploy/monitoring/).

## Wtyczki

Wtyczki to moduły WebAssembly uruchamiane przez Extism w piaskownicy. Moduł nie ma własnego
systemu plików, sieci ani bazy danych: wszystko przechodzi przez funkcje hosta ograniczone
uprawnieniami z jego `plugin.toml` (typy zawartości, które czyta lub zapisuje, hosty HTTP,
własny magazyn klucz-wartość), z limitem czasu i pamięci na wywołanie (`[limits]`, 5 s
i 64 MB w przykładowym manifeście). Administratorzy widzą, o co prosi wtyczka, zanim ją
włączą. Skrypty administracyjne wtyczek działają na stronie panelu, więc instaluj tylko
wtyczki, którym ufasz. Zobacz [Wtyczki](/pl/extending/plugins/).

## Eksporty i kopie zapasowe

Archiwa `verdin export` zawierają pola prywatne i hashe haseł. Przechowuj je jak zrzuty bazy
danych. Zobacz [Kopie zapasowe](/pl/deploy/backups/).

## Zgłaszanie podatności

Nie otwieraj publicznego zgłoszenia w sprawie problemu bezpieczeństwa. Postępuj zgodnie
z [polityką bezpieczeństwa](https://github.com/Verdin-CMS/verdin/blob/main/SECURITY.md)
repozytorium: zgłoś go prywatnie przez zakładkę **Security**
[repozytorium](https://github.com/Verdin-CMS/verdin/security) (**Report a vulnerability**),
podając wersję, kroki do odtworzenia i obserwowany wpływ. Poprawki bezpieczeństwa są
wymienione w sekcji **Security** w [changelogu](/pl/project/changelog/).
