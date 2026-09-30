---
title: "API administracyjne"
description: "API, na którym działa panel administracyjny Verdin, do automatyzacji: logowanie, sesje, konwencje i główne grupy tras."
sidebar:
  order: 4
  label: "Administracja"
---

Panel administracyjny jest klientem API administracyjnego, udostępnianego pod
`{admin.path}/api` (domyślnie `/admin/api`). Wszystko, co robi panel, może zrobić też skrypt:
tworzyć administratorów i tokeny API, konfigurować webhooki i funkcje, zarządzać wersjami
językowymi albo pracować ze szkicami i wydaniami. Ta strona wyjaśnia, jak się uwierzytelnić,
i wymienia grupy tras.

:::caution[Stabilność]
API administracyjne nie ma gwarancji stabilności przed Verdin 1.0: trasy i treści żądań mogą
się zmieniać w wydaniach minor, a changelog nie wymienia każdej zmiany. Do odczytu i zapisu
treści używaj raczej API [REST](/pl/api/rest/) lub [GraphQL](/pl/api/graphql/) z
[tokenem API](/pl/guides/auth/api-tokens/). Kontrakt stabilności dla wszystkich API jest
planowany na 1.0.
:::

## Logowanie

API administracyjne nie ma jeszcze tokenów API: skrypt loguje się jako administrator,
najlepiej taki, którego rola pozwala tylko na to, czego skrypt potrzebuje.

```sh title="Terminal"
curl -s -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"bot@example.com","password":"…"}'
```

```json
{
  "data": {
    "user": { "id": 3, "email": "bot@example.com", "…": "…" },
    "accessToken": "eyJhbGciOiJIUzI1NiIs…",
    "accessTokenExpiresAt": "2026-09-29T10:15:00.000Z"
  }
}
```

Wysyłaj token dostępu w każdym kolejnym żądaniu:

```sh title="Terminal"
curl -H "Authorization: Bearer $ACCESS_TOKEN" 'https://cms.example.com/admin/api/system/info'
```

| Poświadczenie | Ważność | Gdzie |
| --- | --- | --- |
| Token dostępu (JWT) | 15 minut | Treść odpowiedzi. Wysyłaj go jako `Authorization: Bearer …`. |
| Token odświeżania | 30 dni | Ciasteczko `verdin_refresh` (`HttpOnly`, `SameSite=Strict`, ścieżka `/admin/api/auth`, `Secure` pod `verdin start`). |

Aby uzyskać nowy token dostępu, wywołaj `POST /admin/api/auth/refresh` z ciasteczkiem
i nagłówkiem `X-Verdin-CSRF` (dowolna wartość). Odpowiedź wygląda jak przy logowaniu, a token
odświeżania jest rotowany: zapisz nowe ciasteczko, bo ponowne użycie zużytego tokenu
odświeżania kończy całą sesję. `POST /admin/api/auth/logout` z tym samym nagłówkiem kończy
sesję.

```sh title="Terminal"
curl -s -b cookies.txt -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/refresh' \
  -H 'X-Verdin-CSRF: 1'
```

- **Uwierzytelnianie dwuskładnikowe.** Dla konta z drugim składnikiem logowanie odpowiada
  `{ "data": { "twoFactorRequired": true, "twoFactorToken": "…", "methods": ["totp"] } }`.
  Dokończ je przez `POST /admin/api/auth/login/two-factor` z
  `{ "twoFactorToken": "…", "code": "123456" }` (kod TOTP albo kod odzyskiwania). Zobacz
  [Uwierzytelnianie dwuskładnikowe](/pl/guides/auth/two-factor/).
- **Limity żądań.** Logowanie i rejestracja są ograniczone per IP klienta przez
  `[admin].auth_rate_limit` (domyślnie 20 na minutę); odświeżanie ma większy limit.
- **Błędy.** Złe dane logowania, nieznane konta i zablokowane konta odpowiadają tak samo:
  `400 Invalid credentials`. Pięć błędnych haseł blokuje konto na 15 minut.
- **Pierwszy administrator.** Na świeżej instancji `POST /admin/api/auth/register-first-admin`
  tworzy Super Admina; działa tylko, dopóki nie istnieje żaden administrator.
  `verdin admin create` robi to samo z wiersza poleceń.

## Konwencje

- Treści żądań i odpowiedzi to JSON. Odpowiedzi opakowują wynik w `data`
  (`{ "data": … }`); trasy treści zwracają też `meta`, jak API REST.
- Trasy treści przyjmują treści `{ "data": { … } }`, jak API REST. Trasy ustawień przyjmują
  zwykłe obiekty JSON.
- Błędy mają [format błędów REST](/pl/api/rest/#błędy). Trasa wyłączonej funkcji odpowiada
  `404`. Administrator, którego rola wymaga uwierzytelniania dwuskładnikowego, dostaje
  `403 TwoFactorRequiredError`, dopóki go nie skonfiguruje.
- Każda trasa sprawdza [uprawnienia](/pl/concepts/permissions/) administratora: trasy treści
  sprawdzają akcje na treści danego typu, trasy ustawień swoją akcję ustawień.
- API administracyjne nigdy nie odpowiada na żądania cross-origin: wywołuj je z serwera lub
  skryptu, a nie ze stron innej witryny.
- Udane zmiany trafiają do [dziennika audytu](/pl/guides/content/audit-logs/).

## Listy

Listy ustawień są stronicowane parametrami `page` (od 1) i `pageSize`. Odpowiadają wierszami
strony i licznikami:

```json
{ "data": [ … ], "meta": { "pagination": { "page": 2, "pageSize": 25, "total": 60, "pageCount": 3 } } }
```

| Lista | Domyślny rozmiar strony (maksimum) | Kolejność | Inne parametry |
| --- | --- | --- | --- |
| `GET /users`, `GET /roles`, `GET /api-tokens` | 25 (100) | Od najstarszych | |
| `GET /webhooks` | 25 (100) | Od najstarszych | `meta.events` wymienia zdarzenia, które może subskrybować webhook |
| `GET /webhooks/{id}/deliveries` | 25 (100) | Od najnowszych | |
| `GET /releases` | 25 (100) | Od najnowszych | `status` (`pending`, `running`, `done`, `failed`) |
| `GET /site/redirects` | 25 (100) | Według źródła | `search` dopasowuje źródło lub cel |
| `GET /site/menus`, `GET /site/forms` | 25 (100) | Według nazwy | |
| `GET /site/forms/{id}/submissions` | 25 (100) | Od najnowszych | |
| `GET /deploy/targets` | 25 (100) | Od najstarszych | |
| `GET /deploy/deployments` | 25 (100) | Od najnowszych | `targetId`; `limit` to przestarzały alias `pageSize` |
| `GET /end-users` | 25 (100) | Od najnowszych | `search` dopasowuje nazwę użytkownika lub e-mail |
| `GET /audit-logs` | 50 (200) | Od najnowszych | Zobacz [Dzienniki audytu](/pl/guides/content/audit-logs/) |

Większy `pageSize` jest obniżany do maksimum. Aby odczytać całą listę, żądaj kolejnych stron,
aż `page` osiągnie `pageCount`:

```sh title="Terminal"
curl 'https://cms.example.com/admin/api/site/redirects?page=1&pageSize=100' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Trasy treści stronicują jak API REST, przez `pagination[page]` i `pagination[pageSize]`.

## Grupy tras

Ścieżki są względne wobec `/admin/api`. Routery znajdują się w
[`crates/verdin-api/src/admin.rs`](https://github.com/Verdin-CMS/verdin/blob/main/crates/verdin-api/src/admin.rs)
i w modułach `*_admin.rs` obok niego.

| Grupa | Trasy | Uprawnienie |
| --- | --- | --- |
| Logowanie i konto | `GET /auth/status`, `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `GET\|PUT /users/me`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, zaproszenia i reset hasła pod `/auth/*` | Zalogowany (trasy logowania są publiczne) |
| Dwa składniki | `/auth/two-factor/*`, `POST /auth/login/two-factor`, `POST /auth/login/passkey/options`, `DELETE /users/{id}/two-factor` | Zalogowany; `users.manage`, aby zresetować innego administratora |
| SSO | `GET /auth/sso`, `GET /auth/sso/{id}`, `GET /auth/sso/{id}/callback` | Publiczne |
| Administratorzy | `GET\|POST /users`, `GET\|PUT\|DELETE /users/{id}`, `POST /users/{id}/invite` | `users.manage` |
| Role i dostęp publiczny | `GET\|POST /roles`, `GET\|PUT\|DELETE /roles/{id}`, `GET\|PUT /public-permissions` | `roles.manage` |
| Tokeny API | `GET\|POST /api-tokens`, `GET\|PUT\|DELETE /api-tokens/{id}`, `POST /api-tokens/{id}/regenerate` | `tokens.manage` |
| Schemat | `GET /content-types`, `GET /components`, `GET\|PUT\|DELETE /content-types/{uid}/edit-view`; `GET /schema`, `POST /schema/plan`, `POST /schema/apply` tylko w `verdin dev` | Zalogowany; `views.manage` dla widoków edycji; `schema.manage` dla kreatora |
| Treść | `GET\|POST /content/{uid}`, `GET\|PUT\|DELETE /content/{uid}/{documentId}`, `POST /content/{uid}/{documentId}/actions/{publish\|unpublish\|discard-draft}`, `POST …/clone`, `GET …/locales`, `GET …/usage`, `GET /content/{uid}/uid-available`, `GET /content/{uid}/stats` | Akcje na treści `{uid}` |
| Import i eksport | `GET /content/{uid}/export`, `POST /content/{uid}/import` | Akcje na treści `{uid}` |
| Historia | `GET /history/{uid}/{documentId}`, `GET /history/versions/{id}`, `POST /history/versions/{id}/restore` | Akcje na treści danego typu |
| Wydania | `GET\|POST /releases`, `GET\|PUT\|DELETE /releases/{id}`, `POST /releases/{id}/actions`, `DELETE /releases/{id}/actions/{actionId}`, `POST /releases/{id}/publish` | `releases.manage` |
| Przepływy recenzji | `GET\|POST /review-workflows`, `GET\|PUT\|DELETE /review-workflows/{id}`, `GET\|PUT /content/{uid}/{documentId}/review`, `GET /review/*` | `workflows.manage` do konfiguracji |
| Multimedia | `POST /upload`, `POST /upload/from-url`, `GET /upload/files`, `GET\|PUT\|DELETE /upload/files/{id}`, `POST /upload/files/{id}/replace`, `GET /upload/files/{id}/usage`, `/upload/folders…` | `media.*` |
| Wersje językowe | `GET\|POST /i18n/locales`, `PUT\|DELETE /i18n/locales/{code}` | `locales.manage` do zmian |
| Webhooki | `GET\|POST /webhooks`, `GET\|PUT\|DELETE /webhooks/{id}`, `POST\|DELETE /webhooks/{id}/secret`, `POST /webhooks/{id}/trigger`, `GET /webhooks/{id}/deliveries`, `POST /webhooks/deliveries/{id}/retry` | `webhooks.manage` |
| Użytkownicy końcowi | `GET\|POST /end-users`, `GET\|PUT\|DELETE /end-users/{id}`, `GET\|POST /end-user-roles`, `PUT\|DELETE /end-user-roles/{id}` | `endusers.manage` |
| Funkcje | `GET /features`, `PUT /features/{id}`, `POST /email/test` | `features.manage` do zmian |
| Wtyczki | `GET /plugins`, `GET /plugins/extensions`, `PUT /plugins/{name}`, `GET /plugins/{name}/logs` | `plugins.manage` |
| Wdrożenia i CDN | `/deploy/targets…`, `GET /deploy/deployments`, `GET /deploy/cdn`, `POST /deploy/cdn/purge` | `deploy.manage`; `deploy.trigger`, aby uruchomić |
| Witryna | `/site/redirects…`, `/site/menus…`, `/site/forms…` oraz zgłoszenia formularzy | `site.manage` |
| Współpraca | `/comments…`, `/tasks…`, `/engagement/*`, `/polls…` | Dostęp do odczytu typu wpisu |
| Czas rzeczywisty | `GET /events`, `GET\|POST /presence` | Zobacz [API czasu rzeczywistego](/pl/api/realtime/#strumień-administracyjny) |
| AI | `GET /ai`, `POST /ai/translate`, `/ai/alt-text`, `/ai/summarize`, `/ai/seo` | Zobacz [Działania AI](/pl/guides/integrations/ai-actions/) |
| Dzienniki audytu | `GET /audit-logs` | `audit.read` |
| System | `GET /system/info` (wersja, baza danych i tryb) | Zalogowany |

## Trasy treści

Trasy treści korzystają z tego samego Document Service co API REST, z regułami
administracyjnymi:

- `{uid}` to UID typu zawartości, np. `api::article`.
- Odczyty zwracają **szkice**, chyba że przekażesz `status=published`. Przyjmują
  [parametry zapytania](/pl/api/rest/#parametry-zapytania) REST oraz `unseen=true` dla
  dokumentów, których administrator nie otworzył od ich ostatniej zmiany.
- Zapisy zapisują tylko szkic. Publikacja jest zawsze osobną, jawną akcją.
- Zapisy rejestrują administratora jako twórcę lub ostatniego edytującego. Ograniczenia ról
  administratora dotyczące pól, wersji językowych i `is-creator` obowiązują przy odczytach
  i zapisach.

```sh title="Terminal"
curl -X PUT 'https://cms.example.com/admin/api/content/api::article/k2m7q4…?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"data":{"title":"Bonjour, Verdin"}}'
curl -X POST 'https://cms.example.com/admin/api/content/api::article/k2m7q4…/actions/publish?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```
