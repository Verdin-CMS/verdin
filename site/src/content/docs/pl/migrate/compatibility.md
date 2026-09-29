---
title: Zgodność ze Strapi
description: Które funkcje i API Strapi v5 Verdin obsługuje, obsługuje częściowo lub nie obsługuje — REST, GraphQL, użytkownicy i uprawnienia, przesyłanie plików, i18n, szkice i publikacja, rozszerzenia kodu, panel administracyjny i funkcje Enterprise.
sidebar:
  order: 2
---

Verdin zachowuje model treści i API treści ze Strapi v5, aby frontendy i treść mogły
przejść (zobacz [Migracja ze Strapi](/pl/migrate/from-strapi/)). Nie jest bezpośrednim
zamiennikiem *kodu* Strapi: nie ma runtime'u JavaScript, więc własny kod jest odtwarzany jako
wtyczki WebAssembly. Ta strona wymienia każdy obszar z jego statusem, według stanu na
Verdin 0.10.0.

**Obsługiwane** działa jak w Strapi v5 (różnice opisane). **Częściowo** obejmuje typowe
przypadki; uwaga mówi, czego brakuje. **Nieobsługiwane** nie ma odpowiednika.

## Model treści

| Funkcja | Status | Uwagi |
| --- | --- | --- |
| Typy kolekcji i pojedyncze typy | Obsługiwane | Pliki schematu JSON bliskie formatowi Strapi (`schema/content-types/*.json`). Zobacz [Model treści](/pl/concepts/content-model/). |
| Skalarne typy atrybutów | Obsługiwane | `string`, `text`, `richtext` (Markdown), `blocks`, `email`, `uid`, `integer`, `biginteger`, `float`, `decimal`, `boolean`, `date`, `time`, `datetime`, `enumeration`, `json`, `password`. `timestamp` ze Strapi jest importowany jako `datetime`. |
| Komponenty i strefy dynamiczne | Obsługiwane | Łącznie z multimediami i relacjami `oneWay`/`manyWay` wewnątrz komponentów. |
| Relacje | Obsługiwane | Jeden/wiele do jednego/wielu, jednokierunkowe i wielokierunkowe oraz polimorficzne `morphToOne`, `morphToMany`, `morphOne`, `morphMany`. |
| Pola multimediów | Obsługiwane | Pojedyncze lub wielokrotne, `allowedTypes`. |
| `unique` | Częściowo | Nie dla atrybutów `text`, `richtext`, `blocks` i `json`. |
| Pola warunkowe (`conditions`) | Obsługiwane | Warunki JSON Logic ze Strapi 5.17; ukryte pola nie są wymagane. |
| Pola niestandardowe | Częściowo | Atrybuty `customField` działają; pole w panelu pochodzi z [wtyczki](/pl/extending/plugins/) Verdin, a nie z wtyczek React ze Strapi. |
| Kreator typów zawartości | Obsługiwane | Tylko w trybie deweloperskim (`verdin dev`), jak w Strapi. |

## API REST

| Funkcja | Status | Uwagi |
| --- | --- | --- |
| Trasy CRUD | Obsługiwane | `GET`/`POST /api/{pluralName}`, `GET`/`PUT`/`DELETE /api/{pluralName}/{documentId}`, pojedyncze typy pod `/api/{singularName}`. Odpowiedzi mają `data` i `meta`, błędy obiekt `error` ze Strapi. |
| `filters` | Obsługiwane | Każdy operator Strapi: `$eq`, `$eqi`, `$ne`, `$nei`, `$lt`, `$lte`, `$gt`, `$gte`, `$in`, `$notIn`, `$contains`, `$notContains`, `$containsi`, `$notContainsi`, `$null`, `$notNull`, `$between`, `$startsWith(i)`, `$endsWith(i)`, `$and`, `$or`, `$not`; przez relacje, komponenty, komponenty powtarzalne i strefy dynamiczne (`__component`). |
| `sort` | Obsługiwane | Kilka pól, `:asc`/`:desc` i pole relacji do jednego (`author.name:asc`). |
| `pagination` | Obsługiwane | `page`/`pageSize` lub `start`/`limit`, `withCount`. `pageSize` jest ograniczone do `[api].max_page_size` (100). |
| `fields` | Obsługiwane | |
| `populate` | Obsługiwane | `*`, listy, zagnieżdżone obiekty, `on` dla stref dynamicznych, `count`. Głębokość do 5; najwyżej 1000 wypełnionych wpisów na relację. |
| `status` | Obsługiwane | `published` (domyślnie) lub `draft`; odczyt szkiców wymaga uprawnienia `readDrafts`. |
| `locale` | Obsługiwane | Zobacz i18n poniżej. |
| `hasPublishedVersion` | Obsługiwane | |
| Wyszukiwanie pełnotekstowe `_q` | Obsługiwane | `$containsi` po polach tekstowych, jak w Strapi; szeregowanie trafności z `[search]`. |
| Zapisy relacji | Obsługiwane | Identyfikatory, `connect` / `disconnect` / `set`, z `position` (`before`, `after`, `start`, `end`). |
| Publikacja, cofnięcie publikacji, odrzucenie szkicu | Obsługiwane | Zapisy publikują, chyba że `?status=draft`, jak w Strapi v5. Verdin dodaje `POST /api/{pluralName}/{documentId}/actions/{publish,unpublish,discard-draft}`. |
| Format odpowiedzi Strapi v4 i `publicationState` | Nieobsługiwane | Verdin mówi tylko v5: płaskie atrybuty, `documentId`, `status`. |
| Dokument OpenAPI | Częściowo | Pod `/api/_openapi.json` (domyślnie tylko z tokenem) i interaktywna dokumentacja pod `/api/docs`, zamiast `/documentation` z wtyczki documentation. |

## GraphQL

| Funkcja | Status | Uwagi |
| --- | --- | --- |
| Zapytania | Obsługiwane | `articles`, `articles_connection` z `pageInfo`, `article(documentId)`, pojedyncze typy; `filters`, `sort`, `pagination`, `status`, `locale`. Wyłączone, dopóki nie włączysz **Ustawienia → Funkcje → GraphQL**. |
| Mutacje | Obsługiwane | `create…`, `update…`, `delete…` ze `status` i `locale`. |
| Komponenty, strefy dynamiczne, multimedia | Obsługiwane | Strefy dynamiczne jako unie, multimedia jako `UploadFile`. |
| Relacje polimorficzne | Częściowo | Zwracane jako JSON, nie jako typowane unie. |
| Shadow CRUD (wyłączanie operacji per typ) | Obsługiwane | Ustawienie `disabled` funkcji. |
| Własne resolvery i rozszerzenia schematu | Częściowo | Pola główne rozwiązywane przez wtyczki (`[[graphql]]` w `plugin.toml`); brak `extensionService`. |
| Mutacje Users & Permissions (`login`, `register`, `me`…) | Nieobsługiwane | Użyj tras REST. |
| Zapytania/mutacje przesyłania i i18n (`uploadFiles`, `i18NLocales`…) | Nieobsługiwane | Użyj tras REST i panelu administracyjnego. |
| Limity, GraphiQL | Obsługiwane | `maxDepth`, `maxComplexity`, przełączniki introspekcji i playgroundu. |

## Users & Permissions (użytkownicy końcowi)

Włącz **Ustawienia → Funkcje → Użytkownicy i uprawnienia**. Zobacz [Użytkownicy końcowi](/pl/guides/auth/end-users/).

| Funkcja | Status | Uwagi |
| --- | --- | --- |
| `POST /api/auth/local`, `/auth/local/register` | Obsługiwane | Te same formaty żądań i odpowiedzi. |
| Potwierdzanie e-maila, zapomniane/reset/zmiana hasła | Obsługiwane | `/auth/email-confirmation`, `/auth/send-email-confirmation`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/change-password`. |
| Tokeny odświeżania | Obsługiwane | `jwtManagement: "refresh"`, `/auth/refresh`, `/auth/logout`. |
| `/api/users`, `/users/me`, `/users/count` | Obsługiwane | Zwykły JSON, uprawnienia na `plugin::users-permissions.user`. |
| Dostawcy OAuth | Częściowo | GitHub, Google, Microsoft, Discord, Facebook, GitLab, LinkedIn i dowolny dostawca OAuth 2; nie każdy preset ze Strapi. |
| Trasy ról i uprawnień (`/api/users-permissions/roles`, `/permissions`) | Nieobsługiwane | Zarządzaj rolami w **Ustawienia → Użytkownicy końcowi**. |
| Zaimportowani użytkownicy | Obsługiwane | Hashe bcrypt nadal działają; przy logowaniu są ponownie hashowane Argon2id. |

## Biblioteka multimediów i API przesyłania

| Funkcja | Status | Uwagi |
| --- | --- | --- |
| `POST /api/upload` | Obsługiwane | Multipart `files` i `fileInfo`; `?id=` aktualizuje informacje o pliku albo zastępuje plik, gdy zostanie wysłany. |
| Wiązanie przy przesyłaniu (`ref`, `refId`, `field`) | Nieobsługiwane | Prześlij plik, a potem ustaw pole multimediów identyfikatorem pliku. |
| `GET /api/upload/files`, `/files/{id}`, `DELETE /files/{id}` | Częściowo | Listowanie przyjmuje tylko `pagination[page]`, `pagination[pageSize]`, `sort` i `filters[name][$containsi]`. |
| Formaty responsywne, breakpoints | Obsługiwane | `thumbnail` plus `[upload].breakpoints`. |
| Foldery, punkty centralne, teksty alternatywne, podpisy | Obsługiwane | |
| Dostawcy przesyłania | Częściowo | Lokalny dysk i magazyn zgodny z S3 (AWS, R2, B2, MinIO, Tigris…). Brak Cloudinary i innych pakietów dostawców. |
| Transformacje obrazów | Tylko Verdin | `/uploads/<file>?preset=…` i podpisane URL-e (dostawca lokalny). |

## Internacjonalizacja

| Funkcja | Status | Uwagi |
| --- | --- | --- |
| Typy lokalizowane i pola nielokalizowane | Obsługiwane | `pluginOptions.i18n.localized`, także per atrybut. |
| `?locale=` w REST, `locale` w GraphQL | Obsługiwane | Nieznany język to `400`. |
| `localizations` w odpowiedziach | Nieobsługiwane | Odczytaj inny język z tym samym `documentId` i `?locale=`. |
| `GET /api/i18n/locales` | Nieobsługiwane | Językami zarządza się w panelu (**Ustawienia → Internacjonalizacja**). |

## Szkice i publikacja

| Funkcja | Status | Uwagi |
| --- | --- | --- |
| Szkic i opublikowana wersja każdego dokumentu | Obsługiwane | Per język. Zobacz [Szkice i publikacja](/pl/concepts/draft-and-publish/). |
| Odrzucenie szkicu | Obsługiwane | |
| Zaplanowana publikacja | Obsługiwane | Przez [Wydania](/pl/guides/content/releases/). |

## Dostosowywanie serwera

| Strapi | Status | Verdin |
| --- | --- | --- |
| Hooki cyklu życia, middleware Document Service | Częściowo | Hooki before/after we wtyczkach WebAssembly, które mogą zmienić lub odrzucić zapis. Bez JavaScriptu. |
| Własne kontrolery, serwisy, trasy | Częściowo | Trasy wtyczek pod `/api/plugins/<name>/`. |
| Polityki i middleware | Nieobsługiwane | Uprawnienia i limity żądań są wbudowane. |
| Zadania cron | Częściowo | Zadania wtyczek. |
| Document Service / Entity Service w JavaScript | Nieobsługiwane | Brak runtime'u JavaScript. |
| Wtyczki npm z marketplace Strapi | Nieobsługiwane | |
| Webhooki | Obsługiwane | Podpisywane, ponawiane i logowane; `entry.draft-discard` to `entry.discard-draft`. Zobacz [Webhooki](/pl/guides/integrations/webhooks/). |
| Tokeny API (tylko odczyt, pełny dostęp, niestandardowe) | Obsługiwane | Te same rodzaje, opcjonalne wygasanie, regeneracja. |
| Tokeny transferu, `strapi transfer` | Nieobsługiwane | Użyj `verdin export` i `verdin import verdin`. |
| Pliki `strapi export` | Obsługiwane (import) | `verdin import strapi`; zaszyfrowane eksporty nie są odczytywane. |
| `config/*.js`, `.env` | Częściowo | `verdin.toml` i zmienne środowiskowe. |
| Typy TypeScript | Obsługiwane | `verdin types`. |
| Dostawcy e-mail | Częściowo | SMTP, Resend i Postmark. |

## Panel administracyjny

| Funkcja | Status | Uwagi |
| --- | --- | --- |
| Menedżer treści, biblioteka multimediów, kreator typów zawartości | Obsługiwane | Własny panel w Angularze, a nie panel React ze Strapi. |
| Administratorzy, role, role niestandardowe | Obsługiwane | Wbudowane Super Admin, Editor i Author oraz role niestandardowe. |
| Uprawnienia do pól i języków | Obsługiwane | |
| Warunki RBAC | Częściowo | Tylko wbudowany warunek `is-creator`; brak własnych warunków. |
| Dostosowanie panelu (`src/admin/app`) | Częściowo | Logo, favicon, tytuł, kolor akcentu i teksty w `[admin.branding]`; widżety i pola niestandardowe z wtyczek. Brak własnych stron, stref wstrzykiwania i rozszerzeń React. |
| API administracyjne (`/admin/…`) | Nieobsługiwane | API administracyjne Verdin jest własne; nie buduj na tym ze Strapi. |
| Konfiguracja widoku edycji i widoku listy | Obsługiwane | |

## Funkcje Enterprise

Wszystko w Verdin jest open source; w Strapi to funkcje Enterprise lub płatne.

| Funkcja Strapi | Status | Uwagi |
| --- | --- | --- |
| SSO | Częściowo | Dostawcy OpenID Connect, z mapowaniem grup na role. Brak SAML i innych strategii passport. Zobacz [Logowanie jednokrotne](/pl/guides/auth/sso/). |
| Dzienniki audytu | Obsługiwane | Zobacz [Dzienniki audytu](/pl/guides/content/audit-logs/). |
| Przepływy recenzji | Obsługiwane | Role per etap ograniczają, kto przenosi wpisy *do* etapu, a wymagany etap publikacji dotyczy każdego API. Zobacz [Przepływy recenzji](/pl/guides/content/review-workflows/). |
| Wydania | Obsługiwane | Zaplanowane lub natychmiastowe. |
| Historia treści | Obsługiwane | `[history].max_versions` wersji na dokument. |
| Podgląd i podgląd na żywo | Obsługiwane | URL-e podglądu z krótkotrwałymi tokenami, podgląd obok siebie i [edycja wizualna](/pl/guides/frontend/visual-editing/). |
| Niestandardowe role administratorów | Obsługiwane | Bez limitu liczby. |
