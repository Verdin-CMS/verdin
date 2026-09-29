---
title: Dziennik decyzji
description: Decyzje projektowe stojące za Verdin, ponumerowane w kolejności ich podjęcia, z wynikiem i uzasadnieniem każdej.
sidebar:
  order: 8
---

Ten dziennik zapisuje wybory projektowe, które ukształtowały Verdin, w kolejności ich podjęcia, abyś mógł zobaczyć, dlaczego kod jest taki, jaki jest, zanim zaproponujesz zmianę. Wpisy są zachowane w oryginalnej postaci, łącznie z nazwami kamieni milowych (M2–M4 to kamienie milowe przed pierwszymi wydaniami); późniejszy wpis może doprecyzować wcześniejszy, jak 28 robi to z 1. Dodaj nowy wiersz, gdy podejmiesz decyzję, którą ktoś inny musiałby odtwarzać z kodu.

| # | Decyzja | Wynik | Uzasadnienie |
|---|---|---|---|
| 1 | Komponenty: JSON czy tabele | **Kolumna JSON** ([przechowywanie](/pl/internals/storage/#komponenty-i-strefy-dynamiczne-kolumna-json)) | Mniej złączeń, trywialna publikacja/wersjonowanie, prostsze migracje. Filtrowanie po komponentach powtarzalnych jest rzadkie; można je dodać później funkcjami JSON |
| 2 | Kodowanie `decimal` w JSON | Domyślnie **liczba**, opcjonalnie `api.decimal_as_string` | Zgodność ze Strapi maksymalizuje adopcję; dokładne wartości dostępne w razie potrzeby |
| 3 | Formularze panelu | **Signal Forms** | Pasuje do panelu opartego na sygnałach, bez zone.js; dynamiczne drzewa formularzy wyprowadzane ze schematu |
| 4 | Język | **Angielski** dla kodu, dokumentacji i commitów | Zasięg open source |
| 5 | Zgodność z REST Strapi | **Te same parametry i format odpowiedzi**; rozszerzenia tylko w Verdin pod `actions/` | Frontendy migrują z minimalnymi zmianami |
| 6 | Algorytm JWT panelu | HS256 | Jeden sekret, prosto; EdDSA, jeśli kiedyś pojawią się zewnętrzni weryfikatorzy |
| 7 | Identyfikatory dokumentów | ULID (26 znaków) | Sortowalne i przenośne; własne identyfikatory Strapi to nieprzezroczyste 24-znakowe stringi, klienci nigdy ich nie parsują |
| 8 | Zawartość snapshotu | Model fizyczny, nie schemat | Późniejsze wersje mogą wyprowadzać nowe tabele z niezmienionego schematu |
| 9 | Dopuszczanie NULL w atrybutach | Zawsze dopuszczalne; `required` sprawdzane przy publikacji | Szkice mogą być niekompletne (zachowanie Strapi v5); dodawanie wymaganych pól jest bezpieczne |
| 10 | Egzekwowanie `unique` | Unikalny indeks na `(column, locale, publication_state)` | Bez wyścigów; szkice i ich opublikowane wersje dzielą wartości |
| 11 | Nazwa kolumny stanu | `publication_state` | `state` to częsta nazwa atrybutu |
| 12 | Zarezerwowane słowa SQL | Zawsze cytuj identyfikatory | Bez arbitralnej czarnej listy nazw atrybutów |
| 13 | Budowanie DML | Własny builder zamiast `sea-query` | Dominują szczegóły dialektów (typowane NULL-e, kolacje, formaty SQLite); o jedną abstrakcję mniej |
| 14 | Zapisy bez `?status=draft` | Publikują (zachowanie REST w Strapi v5) | Bezpośrednia zgodność z istniejącymi klientami |
| 15 | Porównywanie tekstu | Domyślnie dokładne w każdym silniku; operatory `…i` bez rozróżniania wielkości liter | Te same wyniki w MySQL co w PostgreSQL |
| 16 | Tymczasowa kontrola dostępu (M2–M3) | Przełącznik `[api].open_access`, usunięty w M4 | Bezpieczne domyślnie, dopóki nie było uprawnień |
| 17 | „Cel należy do jednego dokumentu” | Egzekwowane przez przeniesienie celu, per stan | Unikalny indeks zabroniłby szkicowi i jego opublikowanej wersji dzielenia celu |
| 18 | Strony odwrotne (`mappedBy`) | Tylko do odczytu | Zapis przez nie jest niejednoznaczny przy szkicach i publikacji (która wersja właściciela?) |
| 19 | Pozycje powiązań | Numerowane od nowa 1..n przy każdym zapisie | Bez wyczerpywania liczb zmiennoprzecinkowych; listy są małe |
| 20 | Wiersze tabel powiązań | Zachowują klucz główny `id` | Jednolite tabele dla silnika migracji i przebudów SQLite |
| 21 | Biblioteka JWT | Własne HS256 (HMAC-SHA256, weryfikacja w czasie stałym, przypięty `alg`) | `jsonwebtoken` 11 wymaga backendu kryptograficznego, który ciągnie RSA |
| 22 | Tabele platformy | Wyprowadzane razem z modelem treści | Jeden mechanizm migracji dla wszystkiego |
| 23 | Ponowne użycie tokenu odświeżania | Unieważnienie całej rodziny, bez okna tolerancji | Prosto i ściśle; administrator loguje się ponownie |
| 24 | Szkice przez API treści | Osobne uprawnienie `readDrafts` | Tokeny czytające opublikowaną treść nie ujawniają szkiców |
| 25 | Kolejność stosowania w kreatorze | Migracja, potem zapis plików, potem podmiana aplikacji na gorąco | Nieudana migracja zostawia pliki i działającą aplikację nietknięte |
| 26 | Zapisy w panelu | Tylko zapis szkiców; publikacja jest jawną akcją | Odpowiada oczekiwaniom redaktorów; API treści zachowuje domyślną publikację ze Strapi |
| 27 | Konfiguracja uruchomieniowa panelu | Znacznik `<meta>`, nie skrypt inline | Utrzymuje CSP bez skryptów `unsafe-inline` |
| 28 | Filtry po polach komponentów | Operatory ścieżek JSON per dialekt (`#>>`, `JSON_VALUE`, `json_extract`); `EXISTS` po elementach tablicy dla komponentów powtarzalnych i stref dynamicznych (0.8) | Strefy dynamiczne tylko po `__component`: ich elementy mają różne pola |
| 29 | i18n panelu | Transloco z płaskimi katalogami JSON (`admin/public/i18n`) i ICU MessageFormat przez FormatJS (własny transpiler), za małą fasadą `I18n`; nie i18n Angulara w czasie kompilacji | Przełączanie języka w czasie działania; standardowe pliki dla Weblate/Crowdin; FormatJS interpretuje komunikaty, więc ścisłe CSP nie potrzebuje `unsafe-eval` (`@messageformat/core` kompiluje przez `new Function`); klucze typowane z `en.json`, kompletność sprawdzana przez `npm run i18n:check` |
| 30 | Początek tygodnia | `Intl.Locale#getWeekInfo` z regionalnego tagu przeglądarki (en-GB ≠ en-US), awaryjnie tabela regionów, nadpisanie przez użytkownika | Podąża za regionem każdego użytkownika, nawet gdy język interfejsu jest wspólny |
| 31 | Przechowywanie układu pulpitu | Kolumna JSON `preferences` per użytkownik w `vd_admin_users` (≤ 64 KiB) | Podąża za użytkownikiem między przeglądarkami; motyw i język zostają w `localStorage`, bo działają przed logowaniem |
| 32 | Domyślne `Secure` ciasteczka odświeżania | Włączone w `start`, wyłączone w `dev`, do nadpisania | `verdin dev` przez zwykłe HTTP działa w każdej przeglądarce; produkcja pozostaje ścisła |
| 33 | Profil release | Thin LTO, 1 codegen unit, strip; unwinding zachowany | Handler, który spanikuje, nie może położyć serwera |
| 34 | Dokumenty „nieprzejrzane” | Wiersze `vd_document_views` per użytkownik, usuwane dla wszystkich poza edytującym, gdy dokument się zmienia; filtrowane przez `NOT EXISTS` w SQL | Paginacja i liczniki pozostają dokładne; brak znaczników czasu do porównywania per wiersz |
| 35 | Głosy i ankiety | Tabele współpracy tylko dla administratorów (`vd_document_votes`, `vd_polls`, `vd_poll_votes`), dowolny typ zawartości | Skrzynki sugestii i decyzje zespołu bez modelowania pól głosowania w każdym schemacie |
| 36 | Przechowywanie multimediów | `object_store` dla lokalnego i S3 | Jedna ścieżka kodu; strumieniowe przesyłanie multipart; RustFS w stosie deweloperskim i CI |
| 37 | Powiązania multimediów | Tabele powiązań per pole, jak relacje | Ta sama semantyka szkiców i publikacji co relacje; kaskady utrzymują spójność powiązań |
| 38 | Aktualizacje wbudowanych uprawnień | Znacznik wersji w `vd_settings`, dodatki stosowane raz | Istniejące instalacje dostają nowe uprawnienia bez cofania późniejszych zmian administratora |
| 39 | Funkcje w czasie działania | Katalog w `verdin-api`, przełączniki w `vd_settings` (`features`), aplikacja przebudowywana w miejscu (ArcSwap) w każdym trybie | Przełączniki wtyczek jak w Strapi bez restartów; niedostępne funkcje są wymieniane z planowaną wersją |
| 40 | Interfejs dokumentacji API | Scalar (`scalar_api_reference`, bundle osadzony) pod `{api}/docs`, tylko gdy dokument jest publiczny; CSP dopuszcza jego inline bootstrap przez hash | Hostowane samodzielnie (bez CDN, fontów, agenta AI i telemetrii); dokument domyślnie pozostaje tylko dla tokenów |
| 41 | GraphQL | Dynamiczny schemat `async-graphql` budowany razem z aplikacją; argumenty i selekcje są tłumaczone na drzewo parametrów REST i parsowane tym samym parserem zapytań | Jeden zestaw reguł dla filtrów, paginacji, populate, walidacji i uprawnień w REST i GraphQL; populate wyprowadzane z selekcji zachowuje zbiorcze ładowanie |
| 42 | Zdarzenia dokumentów | Listenery w Document Service, wywoływane po commicie | Efekty uboczne (znaczniki przejrzenia, przyszłe webhooki) dotyczą każdego API bez hooków w poszczególnych handlerach |
