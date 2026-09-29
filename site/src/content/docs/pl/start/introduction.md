---
title: Czym jest Verdin
description: Verdin to headless CMS o otwartym kodzie napisany w Rust, z API treści zgodnymi ze Strapi v5 i panelem administracyjnym w jednej binarce.
sidebar:
  order: 1
  label: Wprowadzenie
---

Verdin to headless CMS o otwartym kodzie napisany w Rust. Modelujesz typy zawartości, twoi
redaktorzy piszą i publikują w panelu administracyjnym, a twoje witryny i aplikacje czytają
treść przez API REST lub GraphQL. Verdin nie renderuje stron: robi to twój frontend.

To przepisanie [Strapi v5](https://strapi.io): format schematu i API treści mają ten sam
kształt, więc projekt Strapi i jego frontend mogą przejść z niewielkimi zmianami.

## Dla kogo

- **Deweloperzy budujący witrynę lub aplikację**, którzy chcą CMS działającego jako jeden
  proces, modelu treści w git i odczytu z dowolnego frontendu: Astro, Next.js, aplikacji
  mobilnej.
- **Zespoły na Strapi**, które chcą tego samego API przy mniejszym zużyciu zasobów albo
  potrzebują funkcji, które Strapi rezerwuje dla płatnych planów. Verdin nie ma wersji
  enterprise: SSO, dzienniki audytu, przepływy recenzji i wydania są częścią projektu open
  source.
- **Redaktorzy**, którzy dostają szkice, publikację, historię i podglądy w panelu
  administracyjnym dostępnym w 18 językach.

## Co jest w pudełku

Jeden plik wykonywalny, `verdin`, to serwer, narzędzie wiersza poleceń i panel
administracyjny. W produkcji nie ma runtime'u Node.js ani `node_modules`.

| Obszar | Co dostajesz |
| --- | --- |
| Bazy danych | PostgreSQL 14+, MySQL 8.4+, MariaDB 10.11+ i SQLite, objęte tym samym zestawem testów. |
| Model treści | Typy kolekcji, pojedyncze typy, komponenty, strefy dynamiczne, relacje, multimedia, rich text w Markdown lub formacie bloków Strapi. Schemat to pliki JSON w twoim projekcie. |
| Zmiany schematu | Każda zmiana staje się planem migracji z poziomem ryzyka i dokładnym SQL. Kroki destrukcyjne wykonują się tylko wtedy, gdy na nie pozwolisz. |
| API | REST pod `/api` z parametrami Strapi v5 (`filters`, `populate`, `sort`, `pagination`), opcjonalny endpoint GraphQL, dokument OpenAPI i typowany klient TypeScript. |
| Edycja | Szkice i publikacja, treść lokalizowana, historia treści, wydania, przepływy recenzji, komentarze i zadania, obecność na żywo, podgląd i edycja wizualna we własnej witrynie. |
| Dostęp | Role administratorów aż do poziomu pól i języków, tokeny API, uprawnienia dostępu publicznego, SSO z OpenID Connect, logowanie dwuskładnikowe z kluczami dostępu, dzienniki audytu. |
| Funkcje witryny | Wyszukiwanie pełnotekstowe, mapa witryny, przekierowania, menu i formularze, webhooki, aktualizacje w czasie rzeczywistym. |
| Rozszerzanie | Wtyczki WebAssembly, które podpinają się pod zapisy, dodają trasy i zadania oraz dostarczają widżety panelu i pola niestandardowe, ograniczone do zadeklarowanych capabilities. |

## Związek ze Strapi v5

**To samo:**

- Pliki schematu używają formatu Strapi: `schema/content-types/<singularName>.json`
  i `schema/components/<category>/<name>.json`.
- API treści REST: trasy, płaski format odpowiedzi z `documentId`, parametry zapytania
  i operatory, semantyka zapisów (`POST` lub `PUT` publikuje, chyba że przekażesz
  `?status=draft`), treści błędów.
- Schemat GraphQL ma kształt wtyczki GraphQL ze Strapi v5.
- Użytkownicy końcowi (rejestracja, logowanie, OAuth, role) działają według API
  `users-permissions`.

**Inaczej:**

- **Zmiany schematu to planowane migracje.** Verdin porównuje pliki schematu z bazą danych
  i pokazuje kroki, zanim je wykona. `verdin start` odmawia działania, gdy baza danych jest
  w tyle za schematem.
- **Kreator typów zawartości działa tylko w trybie deweloperskim.** W produkcji schemat
  pochodzi z twojego repozytorium.
- **Wtyczki to WebAssembly, nie JavaScript.** Wtyczki Strapi oraz własne kontrolery, serwisy
  czy pliki cyklu życia w `src/` nie działają w Verdin.
- **Baza danych nie jest współdzielona ze Strapi.** Projekt Strapi przenosisz przez
  `verdin import strapi`, co nadaje każdemu dokumentowi nowy identyfikator.
- **Kilka dodatków względem REST**: akcje publikacji i cofnięcia publikacji
  (`POST /api/<route>/<documentId>/actions/publish`), a wypełniony komponent wraca
  w całości, łącznie z zagnieżdżonymi komponentami.

[Zgodność ze Strapi](/pl/migrate/compatibility/) szczegółowo wymienia różnice.

## Kiedy go nie używać

- **Zależysz od wtyczek Strapi lub własnego kodu serwera w JavaScript.** Verdin nie może ich
  uruchomić; trzeba by je przepisać jako wtyczki WebAssembly albo przenieść logikę gdzie
  indziej.
- **Potrzebujesz stabilnej wersji 1.0.** Verdin jest w wersji 0.10: wydania minor wciąż mogą
  zmieniać konfigurację i zachowanie. Przed każdym przeczytaj
  [Aktualizację](/pl/migrate/upgrading/).
- **Chcesz, żeby CMS renderował twoje strony.** Verdin jest headless; połącz go z frameworkiem
  frontendowym lub generatorem stron statycznych.
- **Chcesz usługi zarządzanej.** Verdin jest self-hosted: uruchamiasz binarkę lub obraz
  Docker na własnej infrastrukturze.

## Co dalej

- [Szybki start](/pl/start/quickstart/): uruchom Verdin i odczytaj pierwszy wpis z API.
- [Samouczek: blog z Astro](/pl/start/tutorial-astro/) lub
  [z Next.js](/pl/start/tutorial-nextjs/): zbuduj frontend dla przykładowego bloga.
- [Model treści](/pl/concepts/content-model/): typy zawartości, pola i sposób ich
  przechowywania.
- [Import projektu Strapi](/pl/migrate/from-strapi/): przenieś istniejący projekt.
