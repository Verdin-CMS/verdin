---
title: "Uprawnienia"
description: "Ogólny obraz kontroli dostępu w Verdin: role administratorów i RBAC z uprawnieniami do pól i języków, rola publiczna, tokeny API i role użytkowników końcowych."
sidebar:
  order: 6
---

Verdin kontroluje osobno dwie grupy: **administratorów**, którzy logują się do panelu
administracyjnego, oraz **wywołujących API treści**, którzy czytają i zapisują treść z twoich
witryn i aplikacji. Ta strona wyjaśnia, jak każda z nich jest autoryzowana i jak elementy do
siebie pasują. Pełna lista akcji jest w
[dokumentacji uprawnień](/pl/reference/permissions/).

| Kto | Uwierzytelnia się przez | Uprawnienia pochodzą z | Dotyczy |
| --- | --- | --- | --- |
| Administrator | E-mail i hasło (plus drugi składnik lub SSO) | Jego [ról](#role-administratorów) | Panelu administracyjnego i [API administracyjnego](/pl/api/admin/) |
| Anonimowy wywołujący | Brak nagłówka `Authorization` | [Dostępu publicznego](#dostęp-publiczny) | REST, GraphQL, czasu rzeczywistego |
| Serwer lub build | `Authorization: Bearer vd_…` | Typu [tokenu API](#tokeny-api) | REST, GraphQL, czasu rzeczywistego |
| Zalogowany użytkownik końcowy | `Authorization: Bearer <JWT>` | Jego [roli użytkownika końcowego](#użytkownicy-końcowi) | REST, GraphQL, czasu rzeczywistego |

Domyślnie wszystko jest zamknięte: API treści odpowiada `403`, dopóki nie przyznasz dostępu,
a administrator może robić tylko to, na co pozwalają jego role.

## Role administratorów

Administrator ma jedną lub więcej ról; ich uprawnienia się sumują. Wbudowane są trzy role:

| Rola | Może |
| --- | --- |
| **Super Admin** | Wszystko, łącznie z użytkownikami, rolami i tokenami API. Nie można jej edytować. |
| **Editor** | Czytać, tworzyć, aktualizować, usuwać i publikować całą treść; korzystać z biblioteki multimediów; uruchamiać wdrożenia; zarządzać SEO, przekierowaniami, menu i formularzami. |
| **Author** | Tworzyć treść oraz czytać, aktualizować i usuwać tylko utworzone przez siebie wpisy. Nie może publikować. Przesyła pliki i edytuje lub usuwa tylko własne. |

Inne role tworzysz w **Ustawienia → Role** (uprawnienie `roles.manage`). Ostatniego
aktywnego Super Admina nie można dezaktywować, usunąć ani zdegradować, więc instancja nigdy
nie zablokuje sama siebie. Rola może też wymagać od swoich członków skonfigurowania
[uwierzytelniania dwuskładnikowego](/pl/guides/auth/two-factor/): dopóki tego nie zrobią,
mają dostęp tylko do swojego profilu.

### Czym jest uprawnienie

Uprawnienie to **akcja**, **podmiot** w przypadku akcji na treści i opcjonalne **warunki**:

- **Akcje na treści**: `content.read`, `content.create`, `content.update`,
  `content.delete` i `content.publish`, na jednym typie zawartości (`api::article`) albo na
  wszystkich (`*`).
- **Akcje na multimediach**: `media.read`, `media.create`, `media.update` i `media.delete`,
  dla biblioteki multimediów.
- **Akcje ustawień**, np. `users.manage`, `tokens.manage`, `webhooks.manage` czy
  `features.manage`, które otwierają odpowiednie strony **Ustawień**.
- **Warunki**: `is-creator` ogranicza uprawnienie do treści lub multimediów do tego, co
  utworzył administrator. Tak działa rola Author.

Warunki stają się częścią zapytania do bazy danych: lista filtrowana przez `is-creator`
poprawnie liczy i stronicuje, zamiast ukrywać wiersze po fakcie.

### Uprawnienia do pól i języków

Uprawnienia do treści można dalej zawęzić:

- **Pola.** `content.read`, `content.create` i `content.update` mogą wymieniać atrybuty,
  których dotyczą. Pola spoza listy są ukryte przy odczytach (łącznie z wyszukiwaniem,
  filtrami, sortowaniem i powiązanymi wpisami) i odrzucane przy zapisach.
- **Języki.** W [typach lokalizowanych](/pl/concepts/internationalization/) uprawnienia do
  treści mogą wymieniać języki, których dotyczą. Wersji w innych językach nie można czytać
  ani zmieniać.

Oba ustawia się dla każdego typu zawartości w edytorze roli, w sekcjach **Pola** i **Języki**.

## API treści

Wywołujący API treści są sprawdzani względem uprawnień: **akcja** na **podmiocie**.

| Akcja | Pozwala na |
| --- | --- |
| `find` | Wyświetlanie listy dokumentów (`GET /api/articles`) lub odczyt pojedynczego typu. |
| `findOne` | Odczyt jednego dokumentu (`GET /api/articles/{documentId}`). |
| `create` | `POST` |
| `update` | `PUT` |
| `delete` | `DELETE` |
| `publish` | Trasy `actions/publish`, `actions/unpublish` i `actions/discard-draft`. |
| `readDrafts` | Odczyt z `status=draft`. |

Podmioty to typy zawartości, biblioteka multimediów (`plugin::upload`) i konta
użytkowników końcowych (`plugin::users-permissions.user`), gdy
[użytkownicy końcowi](/pl/guides/auth/end-users/) są włączeni.

Kilka reguł obowiązuje każdego wywołującego:

- Odczyt szkiców wymaga `readDrafts` oprócz `find` lub `findOne`. Uprawnienie do czytania
  treści witryny nie może przypadkiem czytać nieopublikowanej pracy.
- Populate, filtrowanie lub sortowanie przez relację wymaga dostępu do odczytu typu
  docelowego.
- Pola `private` nigdy nie są zwracane, niezależnie od uprawnień.
- Zapis zwraca zapisany dokument nawet bez `find`, jak w Strapi.
- Te same uprawnienia obowiązują w [GraphQL](/pl/api/graphql/) i w
  [strumieniu czasu rzeczywistego](/pl/api/realtime/).

### Dostęp publiczny

Żądania bez nagłówka `Authorization` dostają uprawnienia z **Ustawienia → Dostęp
publiczny**. Domyślnie nic nie jest przyznane. Typowy wybór to `find` i `findOne` na typach,
które pokazuje twoja witryna.

### Tokeny API

Tokeny API są dla serwerów, kroków buildu i skryptów. Tworzysz je w
**Ustawienia → Tokeny API** (uprawnienie `tokens.manage`):

| Typ | Uprawnienia |
| --- | --- |
| **Tylko odczyt** | `find` i `findOne` na każdym typie. Nigdy szkice. |
| **Pełny dostęp** | Każda akcja na każdym typie, łącznie ze szkicami. |
| **Niestandardowy** | Wybrane przez ciebie uprawnienia, jak dostęp publiczny. |

- Token zaczyna się od `vd_`. Jego sekret jest pokazywany raz, przy utworzeniu lub
  regeneracji; Verdin przechowuje tylko jego hash z kluczem.
- Tokeny mogą wygasać. Nieznany, wygasły lub niepoprawny token to `401`: nigdy nie przechodzi
  na dostęp publiczny.
- Każdy poprawny token może czytać dokument OpenAPI pod `/api/_openapi.json`, chyba że
  upublicznisz dokumentację.

Tworzenie i rotację tokenów opisuje strona [Tokeny API](/pl/guides/auth/api-tokens/).

### Użytkownicy końcowi

Użytkownicy końcowi to osoby, które logują się do twojej witryny lub aplikacji, jak we
wtyczce users-permissions w Strapi. Funkcja jest domyślnie wyłączona. Każde konto ma jedną
rolę:

- **Public** to rola żądań bez tokenu: jej uprawnienia to te z **Ustawienia → Dostęp
  publiczny**.
- **Authenticated** jest domyślnie przypisywana nowym kontom.
- Role niestandardowe mają dowolny zestaw uprawnień, z tymi samymi akcjami co powyżej.

Użytkownik końcowy wysyła JWT otrzymany przy logowaniu jako `Authorization: Bearer <jwt>`.
Verdin odróżnia go od tokenów API po prefiksie `vd_`. Zobacz
[Użytkownicy końcowi](/pl/guides/auth/end-users/).

## Porównanie ze Strapi

Model jest zgodny ze Strapi v5: RBAC administratorów z warunkami `is-creator` oraz API
treści z dostępem publicznym, tokenami API i rolami users-permissions. Różnice:

- Każda funkcja jest dostępna w każdym projekcie: role niestandardowe, uprawnienia do pól
  i języków, [SSO](/pl/guides/auth/sso/) i [dzienniki audytu](/pl/guides/content/audit-logs/).
- Odczyt szkiców przez API treści to osobne uprawnienie, `readDrafts`.
- Publikacja przez REST ma własne uprawnienie, `publish`, i własne trasy.
