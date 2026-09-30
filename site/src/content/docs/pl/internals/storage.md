---
title: Przechowywanie
description: Jak Verdin układa treść w bazie danych, od nazw tabel i kolumn systemowych po wiersze szkiców i opublikowanych wersji, powiązania relacji, JSON komponentów i tabele platformy.
sidebar:
  order: 2
---

Ta strona opisuje tabele, które Verdin wyprowadza z twojego schematu, i sposób przechowywania każdego rodzaju atrybutu. Przeczytaj ją, zanim zmienisz cokolwiek w `crates/verdin-migrate/src/derive.rs` lub w Document Service, albo gdy musisz odpytywać bazę danych bezpośrednio. Co przyjmuje każdy typ atrybutu, opisują [typy atrybutów](/pl/reference/attribute-types/).

Nigdy nie piszesz tych tabel ręcznie: [silnik migracji](/pl/internals/migrations/) tworzy je i rozwija na podstawie schematu.

## Konwencje nazewnictwa

| Obiekt | Nazwa |
|---|---|
| Tabela typu zawartości | `collectionName`, domyślnie `pluralName` z myślnikami zamienionymi na podkreślenia (`blog-posts` → `blog_posts`) |
| Kolumna | Nazwa atrybutu w snake case (`metaTitle` → `meta_title`) |
| Powiązania relacji | `{table}_{column}_lnk` |
| Powiązania relacji polimorficznych | `{table}_{column}_mph` |
| Powiązania multimediów | `{table}_{column}_mda` |
| Indeks | `{table}_{part}_uq` dla indeksów unikalnych, `{table}_{part}_idx` dla pozostałych |
| Tabela platformy | Prefiks `vd_` (`vd_admin_users`, `vd_schema_snapshots`…) |

Reguły egzekwowane przez walidator schematu (`crates/verdin-schema/src/naming.rs` i `validate.rs`):

- `collectionName` pasuje do `^[a-z][a-z0-9_]*$`, ma najwyżej 50 znaków i nie może zaczynać się od `vd_`.
- `singularName` i `pluralName` są w kebab case (`^[a-z][a-z0-9-]*$`, bez myślników na początku, na końcu i podwójnych). `upload`, `uploads`, `auth`, `users` i `connect` są zarezerwowane, bo API treści używa tych tras.
- Nazwy atrybutów zaczynają się od litery i dalej mają litery, cyfry lub podkreślenia (reguła Strapi), najwyżej 50 znaków.
- W typach zawartości zarezerwowane są `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`, `updatedAt`, `createdBy` i `updatedBy`, a także każda nazwa, której snake case z nimi koliduje. W komponentach zarezerwowane jest `id`.
- Generowane identyfikatory mają najwyżej 60 znaków (PostgreSQL pozwala na 63, MySQL na 64). Dłuższa nazwa jest przycinana i dostaje 8-znakowy hash pełnej nazwy, więc różne długie nazwy pozostają różne, a wynik jest deterministyczny.

Każdy identyfikator jest cytowany w generowanym SQL, więc słowa zarezerwowane SQL są poprawnymi nazwami atrybutów.

## Kolumny systemowe

Każda tabela typu zawartości zaczyna się od tych kolumn:

```sql
id                 BIGINT       primary key, auto-increment
document_id        CHAR(26)     NOT NULL           -- ULID, shared by every version of a document
locale             VARCHAR(16)  NOT NULL DEFAULT '' -- '' for types that are not localized
publication_state  SMALLINT     NOT NULL           -- 0 = draft, 1 = published
published_at       <datetime>   NULL
created_at         <datetime>   NOT NULL
updated_at         <datetime>   NOT NULL
created_by_id      BIGINT       NULL               -- vd_admin_users.id
updated_by_id      BIGINT       NULL
UNIQUE (document_id, locale, publication_state)
INDEX  (publication_state, locale)
```

- `document_id` to ULID małymi literami generowany przy tworzeniu. Pozostaje ten sam dla szkicu, opublikowanej wersji i każdego języka.
- Typy nielokalizowane używają `locale = ''` zamiast `NULL`, bo NULL-e nigdy nie kolidują w unikalnych indeksach w żadnym silniku, co złamałoby ograniczenie `(document_id, locale, publication_state)`.
- Kolumna stanu to `publication_state`, a nie `state`, bo `state` to częsta nazwa atrybutu.

Dalej są kolumny atrybutów, po jednej na atrybut skalarny. **Każda kolumna atrybutu dopuszcza NULL.** Jak w Strapi v5, szkice mogą być niekompletne, więc `required` jest sprawdzane przy publikacji wersji (albo przy każdym zapisie do typów bez szkiców i publikacji), a nie przez bazę danych. Dzięki temu dodanie wymaganego atrybutu jest bezpieczną migracją.

Atrybuty `unique` i każdy `uid` dostają unikalny indeks na `(column, locale, publication_state)`. Szkic i jego opublikowana wersja mogą dzielić wartość, dwa opublikowane dokumenty nie mogą, a baza danych egzekwuje to bez wyścigów. Naruszenie jest zgłaszane jako `ValidationError` na tym polu.

## Szkice i publikacja

Verdin stosuje model Strapi v5. Widok użytkownika opisują [szkice i publikacja](/pl/concepts/draft-and-publish/); tutaj jest to, co dzieje się w tabeli.

- Dokument ma najwyżej jeden wiersz szkicu (`publication_state = 0`) i jeden opublikowany wiersz (`publication_state = 1`) na język.
- Zapisy z panelu administracyjnego trafiają do wiersza szkicu.
- **Publikacja** sprawdza na szkicu atrybuty `required` i reguły walidacji, a potem kopiuje wartości atrybutów szkicu do opublikowanego wiersza (aktualizując go albo za pierwszym razem wstawiając), w jednej transakcji. Razem z nimi kopiowane są powiązania relacji i multimediów szkicu.
- **Cofnięcie publikacji** usuwa opublikowany wiersz. Jego powiązania znikają razem z nim przez `ON DELETE CASCADE`.
- **Odrzucenie szkicu** nadpisuje szkic wartościami i powiązaniami opublikowanego wiersza.
- Typy zawartości bez szkiców i publikacji mają zawsze tylko opublikowany wiersz.
- W typach lokalizowanych atrybuty nielokalizowane są współdzielone: publikacja jednego języka kopiuje je do opublikowanych wierszy pozostałych języków.

## Relacje: powiązanie przez identyfikator dokumentu

**To główna różnica względem przechowywania w Strapi.** Strapi wiąże wiersze przez identyfikator wiersza i musi przepisywać powiązania przy publikacji. Verdin przechowuje relację jako *wiersz źródłowy → dokument docelowy*:

```sql
-- articles_category_lnk
id                  BIGINT   primary key, auto-increment
source_id           BIGINT   NOT NULL REFERENCES articles(id) ON DELETE CASCADE
target_document_id  CHAR(26) NOT NULL
position            DOUBLE   NOT NULL   -- 1..n, rewritten on every write
UNIQUE (source_id, target_document_id)
UNIQUE (source_id)                      -- to-one kinds only
INDEX  (target_document_id)
```

- Wiersz docelowy jest wybierany przy odczycie, w odczytywanej wersji: opublikowany artykuł widzi opublikowane kategorie, szkic widzi szkice. Jeśli publikacja kategorii zostanie cofnięta, znika ona z opublikowanych artykułów bez ruszania jakiegokolwiek powiązania.
- Publikacja kopiuje tylko własne powiązania wiersza źródłowego.
- Tylko strona **właścicielska** (atrybut z `inversedBy` albo relacja jednokierunkowa) ma tabelę powiązań. Strona odwrotna (`mappedBy`) czyta tę samą tabelę w odwrotnym kierunku i jest tylko do odczytu: zapis do niej to błąd walidacji wskazujący atrybut właścicielski.
- „Najwyżej jeden cel” (`oneToOne`, `manyToOne`, `oneWay`) to unikalny indeks na `source_id`. „Cel należy do jednego dokumentu źródłowego” (`oneToOne`, `oneToMany`) nie może być indeksem, bo szkic i jego opublikowana wersja zasadnie dzielą cele. Document Service egzekwuje to przez *przeniesienie* celu: powiązanie go usuwa powiązania, które mają do niego inne dokumenty w tym samym stanie, co odpowiada zachowaniu Strapi.
- Nie ma klucza obcego na `target_document_id`, bo `document_id` nie jest unikalne w tabeli docelowej. Document Service odrzuca powiązania do nieistniejących dokumentów, a gdy usuwana jest ostatnia wersja dokumentu, usuwa wskazujące go powiązania w tej samej transakcji.
- Wiersze powiązań zachowują klucz główny `id`, więc tabele powiązań wyglądają dla silnika migracji i przebudów tabel SQLite jak każda inna tabela.
- Zmiana nazwy tabeli zmienia też nazwy jej tabel powiązań. Migracje działają z wyłączonym `foreign_keys` w SQLite, więc przebudowa tabeli nie kaskaduje do jej tabel powiązań.

**Relacje polimorficzne** (`morphToOne`, `morphToMany`) wiążą dokumenty dowolnego typu zawartości. Ich powiązania są w `{table}_{column}_mph` z `source_id`, `target_type` (UID celu), `target_document_id` i `position`, unikalnym `(source_id, target_type, target_document_id)` i, dla `morphToOne`, unikalnym `source_id`. Strony odwrotne (`morphOne`, `morphMany`) nie mają tabeli: czytają powiązania właściciela, które na nie wskazują, i są tylko do odczytu. Usunięcie dokumentu usuwa powiązania polimorficzne do niego. Co można, a czego nie można z nimi robić, opisują [relacje](/pl/concepts/relations/).

## Komponenty i strefy dynamiczne: kolumna JSON

Atrybut komponentu lub strefa dynamiczna to **jedna kolumna JSON** w wierszu dokumentu (`jsonb` w PostgreSQL, `json` w MySQL i MariaDB, `text` w SQLite). Strapi przechowuje każdy komponent we własnej tabeli z polimorficznymi tabelami złączeń; kolumna unika tych złączeń i sprawia, że publikacja i historia są zwykłą kopią.

```json
// "seo" column (a single component)
{ "id": 1, "metaTitle": "…", "metaDescription": "…" }

// "blocks" column (a dynamic zone)
[
  { "id": 1, "__component": "blocks.hero", "title": "…" },
  { "id": 2, "__component": "blocks.quote", "text": "…", "author": "…" }
]
```

- Każdy element komponentu ma całkowite `id`, unikalne w obrębie atrybutu. Nowe elementy dostają następny wolny numer.
- Dane są walidowane względem schematu komponentu przy każdym zapisie.
- Publikacja i odrzucenie kopiują JSON bez zmian.
- **Relacje i multimedia wewnątrz komponentów** są przechowywane w samym JSON: `documentId` dla relacji (dozwolone są tam tylko `oneWay` i `manyWay`) i identyfikatory plików dla multimediów. Są sprawdzane przy zapisie i rozwiązywane zbiorczymi zapytaniami, gdy komponent jest wypełniany. Relacje polimorficzne i atrybuty `password` nie mogą być wewnątrz komponentów.
- **Filtrowanie** wymaga funkcji JSON specyficznych dla dialektu. Pola skalarne pojedynczych komponentów są czytane przez ścieżkę JSON (`#>>` w PostgreSQL, `JSON_VALUE` w MySQL i MariaDB, `json_extract` w SQLite). Komponenty powtarzalne używają `EXISTS` po elementach tablicy (`jsonb_array_elements`, `JSON_TABLE`, `json_each`). Strefy dynamiczne można filtrować tylko po `__component`, bo ich elementy mają różne pola.

Stronę modelowania opisują [komponenty i strefy dynamiczne](/pl/concepts/components-and-dynamic-zones/).

## Tabele platformy

Tabele platformy są częścią każdego wyprowadzonego modelu, więc silnik migracji tworzy je i rozwija dokładnie tak jak tabele treści; pojawiają się jako bezpieczne kroki w `verdin migrate plan`. Są zdefiniowane w `crates/verdin-migrate/src/system.rs`.

| Obszar | Tabele |
|---|---|
| Migracje | `vd_schema_snapshots`, `vd_migrations_journal` (należą do silnika migracji, tworzone przy pierwszym użyciu) |
| Administratorzy | `vd_admin_users`, `vd_admin_roles`, `vd_admin_user_roles`, `vd_admin_permissions`, `vd_sessions` (tokeny odświeżania), `vd_admin_tokens` (linki zaproszeń i resetu), `vd_admin_two_factor`, `vd_admin_passkeys`, `vd_spent_challenges` |
| Dostęp do API treści | `vd_api_tokens`, `vd_api_token_permissions`, `vd_public_permissions` |
| Użytkownicy końcowi | `vd_users`, `vd_user_roles`, `vd_user_role_permissions`, `vd_end_user_sessions` |
| Instancja | `vd_settings` (przełączniki funkcji, układy widoków edycji, jednorazowe znaczniki aktualizacji), `vd_locales`, `vd_cluster_events` (wspólna szyna zdarzeń, zobacz [Kilka instancji](/pl/deploy/scaling/)) |
| Multimedia | `vd_files`, `vd_folders` |
| Przepływ treści | `vd_history_versions`, `vd_releases`, `vd_release_actions`, `vd_workflows`, `vd_workflow_stages`, `vd_document_stages` |
| Współpraca | `vd_comments`, `vd_tasks`, `vd_document_views`, `vd_document_votes`, `vd_polls`, `vd_poll_votes` |
| Integracje | `vd_webhooks`, `vd_webhook_deliveries`, `vd_deploy_targets`, `vd_deployments`, `vd_plugin_kv`, `vd_audit_logs` |
| Funkcje witryny | `vd_redirects`, `vd_menus`, `vd_forms`, `vd_form_submissions` |

## Tabele multimediów

Pliki to wiersze `vd_files` w formacie Strapi (`name`, `alternative_text`, `caption`, `width`, `height`, `formats`, `hash`, `ext`, `mime`, `size`, `url`, `provider`…), plus `focal_point`, `folder_id` i `folder_path`. Foldery (`vd_folders`) zachowują ze Strapi `path` złożone z `path_id`, np. `/1/4`.

Atrybut multimediów to tabela powiązań `{table}_{column}_mda` z `source_id` (wiersz treści), `file_id` (wiersz `vd_files`) i `position`. Ma unikalne `(source_id, file_id)` i, gdy atrybut nie jest `multiple`, unikalne `source_id`. Obie kolumny to klucze obce z `ON DELETE CASCADE`, więc usunięcie pliku lub wiersza usuwa jego powiązania. Powiązania multimediów podlegają tym samym regułom szkiców i publikacji co powiązania relacji: każda wersja ma własne powiązania, a publikacja je kopiuje.

Jak działają przesyłanie, formaty i dostawcy przechowywania, opisują [multimedia](/pl/concepts/media/).
