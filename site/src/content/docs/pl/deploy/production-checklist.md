---
title: Lista kontrolna produkcji
description: Co ustawić, zanim projekt Verdin przyjmie prawdziwy ruch — sekrety, baza danych, migracje, URL-e, proxy, ciasteczka, CORS, magazyn multimediów, e-mail, kopie zapasowe i monitoring.
sidebar:
  order: 1
---

Przejdź przez tę listę, zanim udostępnisz projekt Verdin prawdziwym użytkownikom. Każdy punkt
prowadzi do strony, która go wyjaśnia. Strony platform ([Docker](/pl/deploy/docker/),
[Fly.io](/pl/deploy/fly/), [Render](/pl/deploy/render/), [Railway](/pl/deploy/railway/),
[Kubernetes](/pl/deploy/kubernetes/)) stosują te ustawienia za ciebie tam, gdzie to możliwe.

## Uruchom serwer produkcyjny

- [ ] **Używaj `verdin start`, nie `verdin dev`.** `dev` pozwala kreatorowi typów zawartości
      przepisywać pliki schematu, stosuje migracje przy każdej zmianie i łagodzi reguły
      ciasteczek i webhooków na potrzeby pracy lokalnej. Zmieniaj schemat w środowisku
      deweloperskim, zatwierdzaj pliki i je wdrażaj.
- [ ] **Stosuj migracje przy wdrożeniu.** `verdin start` odmawia działania, gdy baza danych
      jest w tyle za schematem. `verdin start --migrate` najpierw stosuje oczekujące
      *bezpieczne* kroki (to domyślne polecenie obrazu Docker). Kroki ryzykowne lub
      destrukcyjne (zmiany typów, nowe ograniczenia unikalności, usunięte kolumny) wymagają
      `verdin migrate apply --allow risky|destructive`, uruchomionego raz przez ciebie.
      Zobacz [Migracje schematu](/pl/concepts/schema-migrations/).
- [ ] **Dostarczaj schemat razem z serwerem.** Zamontuj katalog `schema/` tylko do odczytu
      albo wbuduj go w obraz, aby działało dokładnie to, co zatwierdziłeś.

## Sekrety

- [ ] **Wygeneruj raz dwa wymagane sekrety** przez `verdin secrets` i trzymaj je
      w magazynie sekretów swojej platformy: `VERDIN_ADMIN_JWT_SECRET` podpisuje tokeny
      sesji, a `VERDIN_TOKEN_PEPPER` jest kluczem hashy tokenów API i innych
      przechowywanych sekretów. `verdin start` kończy się błędem, jeśli któregoś brakuje
      albo jest krótszy niż 32 bajty. Sekrety są odczytywane tylko ze środowiska, nigdy
      z `verdin.toml`.
- [ ] **Nie zmieniaj ich.** Zmiana `VERDIN_TOKEN_PEPPER` sprawia, że przestaje działać każdy
      token API, a także kody aplikacji uwierzytelniających i kody odzyskiwania
      administratorów. Zmiana `VERDIN_ADMIN_JWT_SECRET` unieważnia krótkotrwałe tokeny
      dostępu administratorów i użytkowników końcowych, otwarte linki podglądu i trwające
      logowania OAuth (panel administracyjny i klienci z tokenami odświeżania odnawiają je
      sami). Każda instancja projektu potrzebuje tych samych wartości.
- [ ] Pozostałe używane sekrety też umieść w środowisku: `VERDIN_EMAIL_SMTP_PASSWORD` lub
      `VERDIN_EMAIL_API_KEY`, `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`,
      `VERDIN_METRICS_TOKEN`, `VERDIN_SSO_<ID>_SECRET`, `VERDIN_IMAGE_SECRET`. Pełna lista
      jest w [dokumentacji konfiguracji](/pl/reference/configuration/).

## Baza danych

- [ ] **Wybierz silnik.** PostgreSQL (14 lub nowszy) to zwykły wybór i ten, który warto
      wziąć, jeśli uruchomisz [kilka instancji](/pl/deploy/scaling/). MySQL 8.4+ i MariaDB
      10.11+ działają tak samo. SQLite pasuje do jednej instancji z trwałym dyskiem.
- [ ] **Ustaw `VERDIN_DATABASE_URL`**: `postgres://…`, `mysql://…` (MySQL i MariaDB) lub
      `sqlite:///data/verdin.db`. Dodaj `?sslmode=require` dla serwerów PostgreSQL, które
      wymagają TLS.
- [ ] **Dobierz rozmiar puli.** Każda instancja otwiera do `[database].pool_max` połączeń
      (10). Utrzymuj `instances × pool_max` poniżej limitu połączeń serwera.

## URL-e, proxy i ciasteczka

- [ ] **Serwuj przez HTTPS.** Verdin mówi zwykłym HTTP; terminuj TLS na reverse proxy,
      load balancerze lub na krawędzi swojej platformy.
- [ ] **Ustaw `[server].public_url`** (`VERDIN_SERVER__PUBLIC_URL`) na adres używany przez
      przeglądarki, np. `https://cms.example.com`. Zależą od niego linki w e-mailach,
      callbacki SSO, codzienne podsumowanie i klucze dostępu; klucze dostępu są powiązane
      z jego hostem.
- [ ] **Ustaw `[server].trusted_proxies`** na adresy swoich reverse proxy (IP lub zakresy
      CIDR). Dopiero wtedy Verdin odczytuje adres klienta z `X-Forwarded-For`; bez tego
      wszyscy klienci za proxy dzielą jeden adres w limitach żądań i dziennikach audytu.
- [ ] **Nie wyłączaj bezpiecznych ciasteczek.** W `verdin start` ciasteczko odświeżania
      administratora jest domyślnie `Secure`. Nie ustawiaj `[admin].secure_cookies`;
      ustawienie go na `false` w produkcji zapisuje ostrzeżenie przy starcie.

## API

- [ ] **Przyznawaj tylko to, czego potrzebuje publiczność.** API treści jest zamknięte,
      dopóki nie przyznasz uprawnień publicznych (**Ustawienia → Dostęp publiczny**) albo
      nie utworzysz tokenów API. Zobacz [Uprawnienia](/pl/concepts/permissions/).
- [ ] **Ustaw `[api].cors_origins`**, jeśli przeglądarka z innego originu wywołuje API
      treści lub GraphQL, np. `["https://www.example.com"]`. Bez tego z przeglądarki mogą je
      wywoływać tylko strony z tego samego originu. API administracyjne nigdy nie odpowiada
      na żądania cross-origin.
- [ ] **Rozważ limity żądań** dla ruchu anonimowego: `[api].public_rate_limit`
      i `[api].token_rate_limit` (żądania na minutę; `0`, wartość domyślna, oznacza brak
      limitu).

## Multimedia

- [ ] **Przechowuj przesłane pliki tam, gdzie przetrwają ponowne wdrożenie.** Domyślny
      dostawca lokalny zapisuje na dysk: daj mu trwały wolumen albo użyj dostawcy S3 (AWS S3,
      Cloudflare R2, Backblaze B2, MinIO, Tigris…). Na platformach z ulotnymi dyskami i przy
      kilku instancjach używaj S3. Zobacz [Multimedia](/pl/concepts/media/).

## E-mail

- [ ] **Skonfiguruj prawdziwego dostawcę.** Domyślne `[email].provider = "log"` zapisuje
      e-maile do logu, a `verdin start` ostrzega o tym. Zaproszenia, resety haseł,
      potwierdzenia użytkowników końcowych, wzmianki w komentarzach i podsumowanie wymagają
      `smtp`, `resend` lub `postmark` oraz `[email].from` ustawionego na adres akceptowany
      przez twojego dostawcę.

## Kopie zapasowe i monitoring

- [ ] **Regularnie twórz kopie zapasowe bazy danych i magazynu multimediów** i wypróbuj
      odtwarzanie. Zobacz [Kopie zapasowe](/pl/deploy/backups/).
- [ ] **Kieruj kontrole gotowości na `/_ready`**, a kontrole żywotności na `/_health`.
- [ ] **Loguj w JSON** (`[log].format = "json"`, domyślnie w obrazie Docker) i zbieraj
      standardowe wyjście błędów.
- [ ] **Scrapuj `/_metrics`**, jeśli używasz Prometheus, z `VERDIN_METRICS_TOKEN`. Zobacz
      [Monitoring](/pl/deploy/monitoring/).

## Przed startem

- [ ] Zarejestruj pierwszego administratora samodzielnie zaraz po pierwszym uruchomieniu:
      dopóki nie istnieje żaden administrator, każdy, kto dotrze do `/admin/`, może
      zarejestrować się jako Super Admin. Możesz też utworzyć go z wiersza poleceń przez
      `verdin admin create --email …`.
- [ ] Przejrzyj [model bezpieczeństwa](/pl/deploy/security/) i włącz
      [uwierzytelnianie dwuskładnikowe](/pl/guides/auth/two-factor/) dla Super Adminów.
