---
title: Panel administracyjny
description: Jak zbudowany jest panel administracyjny Verdin w Angularze, jak buduje formularze i listy ze schematu oraz jak jest budowany, osadzany w binarce i tłumaczony.
sidebar:
  order: 6
  label: Panel administracyjny
---

Ta strona jest dla osób rozwijających panel administracyjny w `admin/`: jak zorganizowana jest aplikacja Angular, jak zamienia schemat treści w formularze i listy i jak trafia do binarki `verdin`. Korzystanie z panelu opisują przewodniki; działanie serwerowej strony API administracyjnego opisuje [dokumentacja API administracyjnego](/pl/api/admin/).

Panel to aplikacja jednostronicowa w Angular 22: komponenty standalone, detekcja zmian bez zone.js, sygnały, leniwie ładowane trasy i komponenty spartan/ui na Tailwind CSS v4.

## Struktura

```text
admin/
├── src/app/
│   ├── app.config.ts     # providers: router, HttpClient interceptors, Transloco, icons
│   ├── app.routes.ts     # lazy routes, guards (auth, permissions, unsaved changes)
│   ├── core/             # services and pure models: api, auth, schema, i18n, permissions…
│   ├── layout/           # the shell (sidebar, header), home, deploy button
│   ├── features/
│   │   ├── auth/         # login, first admin, invitations, password reset
│   │   ├── dashboard/    # home widgets
│   │   ├── content/      # lists, the entry editor, history, releases, review, import
│   │   │   ├── fields/   # schema-driven form controls and the form model
│   │   │   └── collab/   # comments and tasks
│   │   ├── builder/      # content-type builder (verdin dev only)
│   │   ├── media/        # media library
│   │   ├── releases/
│   │   ├── profile/      # own account, two-factor, passkeys, sessions
│   │   └── settings/     # users, roles, tokens, webhooks, locales, plugins, site features…
│   └── shared/
│       ├── ui/           # spartan helm components, owned by the project
│       └── components/   # app-level shared components (confirm dialog, page header…)
├── public/i18n/          # translation catalogs, one JSON file per language
├── scripts/check-i18n.mjs
└── e2e/                  # Playwright tests and the server they run against
```

**Stan** żyje w sygnałach wewnątrz wstrzykiwanych serwisów w `core/` (`Auth`, `Schema`, `I18n`, `Theme`…). Nie ma biblioteki store.

**Dostęp do API** przechodzi przez `core/api.ts`, mały wrapper na obietnicach nad `HttpClient` z Angulara, z ręcznie pisanymi typami w `core/types.ts`. Konfiguracja uruchomieniowa (ścieżka panelu, prefiks API, tryb, branding) pochodzi ze znacznika `<meta name="verdin-config">`, który wstrzykuje serwer.

**Sesja.** Token dostępu żyje tylko w pamięci; token odświeżania to ciasteczko `HttpOnly` ograniczone do tras uwierzytelniania. Interceptor HTTP dodaje token bearer, a po `401` raz odświeża i ponawia; jeśli odświeżenie się nie powiedzie, przenosi użytkownika na stronę logowania. Żądania odświeżania i wylogowania mają nagłówek `X-Verdin-CSRF`, którego wymaga serwer. Guardy przywracają sesję z ciasteczka przy ładowaniu strony. `403` mówiące, że rola wymaga uwierzytelniania dwuskładnikowego, przenosi użytkownika do jego konfiguracji.

## Formularze sterowane schematem

Edytor wpisu (`features/content/edit.ts`) nie ma kodu dla poszczególnych typów. Odczytuje typy zawartości i komponenty z `GET /admin/api/content-types` i `GET /admin/api/components`, a układ edytora z ustawień widoku edycji, i buduje formularz w czasie działania za pomocą **Signal Forms** (`@angular/forms/signals`):

- Model dokumentu to sygnał zwykłego obiektu (`FormModel` w `fields/model.ts`); drzewo pól i jego walidatory są wyprowadzane ze schematu.
- Rekurencyjny komponent `vd-fields` (`fields/fields.ts`) renderuje dowolną mapę atrybutów względem drzewa pól. Tekst, daty i godziny używają natywnych pól wejściowych wiązanych przez `[formField]`. Własne `FormValueControl` obsługują liczby (dopuszczające null; duże liczby całkowite pozostają stringami), przełączniki, wyliczenia, daty z godziną (czas lokalny w polu, UTC w modelu), JSON, Markdown, `blocks` (TipTap), multimedia, relacje (wybór z wyszukiwaniem w trakcie pisania i porządkowaniem) i relacje polimorficzne.
- Komponenty to zagnieżdżone fieldsety; komponenty powtarzalne i strefy dynamiczne to listy z możliwością zmiany kolejności. Wtyczki mogą rejestrować własne typy pól, renderowane jako elementy niestandardowe.
- `toModel` zamienia wypełniony dokument w model formularza (relacje stają się `documentId`, pliki identyfikatorami), a `toPayload` zamienia go z powrotem w payload `data`: puste stringi stają się `null`, klucze renderowania (`__key`) i strony tylko do odczytu (`mappedBy`, `morphOne`, `morphMany`) są pomijane. Oba mają testy jednostkowe w `fields/model.spec.ts`.
- Walidacja wyprowadzona ze schematu daje natychmiastową informację zwrotną. Pola warunkowe (`conditions.visible`) są obliczane w przeglądarce przez port ewaluatora JSON Logic z serwera (`core/logic.ts`). Reguły walidacji między polami sprawdza tylko serwer. Serwer pozostaje autorytetem: jego wpisy `details.errors[].path` są mapowane z powrotem na odpowiednie pole.
- Zapis jest jawny, ze śledzeniem zmian i ostrzeżeniem przy opuszczaniu strony (guard trasy plus `beforeunload`). Przyciski **Opublikuj**, **Cofnij publikację** i **Odrzuć zmiany** pojawiają się w zależności od stanu dokumentu. Panel zapisuje tylko szkice; publikacja jest zawsze osobną akcją.

Układ edytora (kolejność pól, szerokości, etykiety, opisy, pola tylko do odczytu, pole, które nazywa powiązane wpisy) jest wspólny dla wszystkich administratorów i przechowywany na serwerze w `vd_settings`, a zmienia się go na stronie **Skonfiguruj widok** z uprawnieniem `views.manage`.

## Listy

Listy treści (`features/content/list.ts`) używają tabeli spartan helm z paginacją, sortowaniem i filtrami po stronie serwera. Filtry, wyszukiwanie (`_q`) i strona są odzwierciedlane w URL, więc przefiltrowana lista to link, który można udostępnić. Każdy administrator wybiera widoczne kolumny, domyślne sortowanie i rozmiar strony dla każdego typu (`list-view.ts`); te wybory są zapisywane w jego własnych preferencjach na serwerze, więc podążają za nim między przeglądarkami. Listy aktualizują się też na żywo ze strumienia zdarzeń panelu.

## Kreator typów zawartości

**Kreator typów zawartości** jest widoczny tylko wtedy, gdy serwer działa w trybie deweloperskim (`verdin dev`), a administrator ma `schema.manage`. Edytuje typy zawartości i komponenty w ich formacie plikowym: pola, rodzaje i cele relacji (tworząc atrybut odwrotny w celu), komponenty, strefy dynamiczne, długości, zakresy oraz flagi `required`, `unique` i `private`.

Każda zmiana jest najpierw wysyłana do `POST /admin/api/schema/plan`, który waliduje przyszły schemat i zwraca kroki migracji z ich ryzykiem, SQL i sugestiami zmian nazw, które użytkownik może zaakceptować. Potwierdzenie wywołuje `POST /admin/api/schema/apply` z akceptowanym poziomem ryzyka i zmianami nazw. Serwer migruje, zapisuje `schema/*.json` i podmienia działającą aplikację na nowy schemat bez restartu. Co dzieje się na serwerze, opisuje [silnik migracji](/pl/internals/migrations/).

## Build i dystrybucja

- `ng build` zapisuje build produkcyjny do `admin/dist/admin/browser`, z `<base href="/admin/">`.
- Serwer osadza ten folder przez `rust-embed`, gdy jest kompilowany z funkcją `embed-admin`, której używają buildy wydań i obraz Docker. Bez tej funkcji albo gdy ustawiono `[admin].assets_dir`, serwuje pliki z dysku. `assets_dir` ma pierwszeństwo przed osadzonym buildem.
- Serwer przepisuje `<base href>` na `[admin].path` i wstrzykuje konfigurację uruchomieniową jako znacznik `<meta>`, a nie skrypt inline. Zmiana `admin.path` nigdy nie wymaga przebudowy panelu.
- Nieznane ścieżki bez rozszerzenia pliku wracają do `index.html` na potrzeby routingu po stronie klienta. Bundle z odciskiem (`main-ABC123.js`) są cache'owane jako `immutable` przez rok; wszystko inne ma `no-cache`.
- Każda odpowiedź panelu ma ścisłą politykę Content Security Policy (`script-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`…), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` i `Referrer-Policy: strict-origin-when-cross-origin`. Wstawianie krytycznego CSS inline w Angularze jest wyłączone w `angular.json`, bo opiera się na inline'owych handlerach zdarzeń, których polityka zabrania.

Przy pracy nad frontendem uruchom serwer, a potem `npm start` w `admin/`: `ng serve` przekazuje `/admin/api` i `/api` do `http://localhost:1337` (`admin/proxy.conf.json`).

## Tłumaczenia

Panel jest tłumaczony w czasie działania przez Transloco, a nie przez i18n Angulara w czasie kompilacji, więc jeden build obsługuje wszystkie języki, a użytkownicy mogą je przełączać bez przeładowania.

- Katalogi to płaskie pliki JSON w `admin/public/i18n/` (`en.json` jest źródłem), ładowane na żądanie.
- Komunikaty używają ICU MessageFormat (`{name}`, `{count, plural, one {# entry} other {# entries}}`), interpretowanego przez FormatJS (`intl-messageformat`) poprzez własny transpiler Transloco. FormatJS interpretuje komunikaty zamiast kompilować je do funkcji, więc CSP nie potrzebuje `unsafe-eval`.
- Klucze komunikatów są typowane na podstawie `en.json` (`core/i18n/keys.ts`): użycie nieistniejącego klucza to błąd kompilacji.
- `npm run i18n:check` sprawdza każdy katalog względem `en.json`: te same klucze, poprawna składnia ICU, te same argumenty i każda kategoria liczby mnogiej danego języka. CI go uruchamia.
- Serwis `I18n` zapewnia też formatowanie zależne od języka i pierwszy dzień tygodnia, brane z ustawień regionalnych przeglądarki, z możliwością nadpisania przez użytkownika.

Jak dodać lub zaktualizować język, opisuje [tłumaczenie](/pl/project/translating/).
