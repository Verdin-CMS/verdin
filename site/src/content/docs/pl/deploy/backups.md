---
title: Kopie zapasowe
description: Twórz kopie zapasowe projektu Verdin przez zrzuty bazy danych i kopie magazynu multimediów albo przenoś go za pomocą verdin export i verdin import verdin.
sidebar:
  order: 9
---

Dane projektu Verdin znajdują się w dwóch miejscach: w **bazie danych** (treść,
administratorzy, role, tokeny, ustawienia, historia, dzienniki audytu) i w **magazynie
multimediów** (pliki biblioteki multimediów, na dysku lub w buckecie). Pliki schematu są
w twoim repozytorium. Twórz kopie zapasowe obu magazynów; `verdin export` dokłada przenośne
archiwum treści.

| Metoda | Zawiera | Do czego |
| --- | --- | --- |
| Zrzut bazy danych + kopia multimediów | Wszystko | Odtwarzanie po awarii tego samego projektu |
| `verdin export` | Schemat, języki, multimedia, każda wersja każdego wpisu | Przenoszenie treści na inną instancję lub silnik bazy danych; dodatkowa, przenośna kopia |

## Zrzuty bazy danych

Używaj narzędzi swojej bazy danych albo automatycznych kopii zapasowych swojego dostawcy:

```sh frame="terminal"
# PostgreSQL
pg_dump --format=custom --file=verdin-$(date +%F).dump "$VERDIN_DATABASE_URL"

# MySQL / MariaDB
mysqldump --single-transaction --routines -h <host> -u <user> -p <database> > verdin-$(date +%F).sql

# SQLite: spójna kopia w trakcie działania serwera
sqlite3 /data/verdin.db ".backup '/backups/verdin-$(date +%F).db'"
```

Nie kopiuj używanego pliku SQLite przez `cp`: użyj `.backup` (albo najpierw zatrzymaj
serwer).

Zrzut zawiera hashe haseł, hashe tokenów API i pola prywatne. Zaszyfruj go i trzymaj z dala
od serwerów, które chroni. Aby go odtworzyć, potrzebujesz też tych samych
`VERDIN_TOKEN_PEPPER` i `VERDIN_ADMIN_JWT_SECRET`: bez peppera tokeny API i kody aplikacji
uwierzytelniających administratorów przestają działać.

## Magazyn multimediów

- **Dostawca lokalny**: kopiuj katalog przesłanych plików (`[upload].provider.dir`,
  `/data/uploads` w obrazie Docker) swoją zwykłą kopią zapasową plików, po zrzucie bazy
  danych, aby nie brakowało żadnego pliku, do którego odwołuje się zrzut.
- **Dostawca S3**: włącz wersjonowanie lub replikację bucketu albo kopiuj go narzędziami
  swojego dostawcy.

Cache transformacji obrazów i indeks wyszukiwania można odbudować i nie wymagają kopii
zapasowej.

## `verdin export`

`verdin export` zapisuje schemat, treść i multimedia projektu do jednego pliku `.tar.gz`,
a `verdin import verdin` odtwarza je w tym samym projekcie lub na innej instancji, na
dowolnym silniku bazy danych.

```sh frame="terminal"
verdin export backup-2026-09-28.tar.gz            # schemat, języki, multimedia i wpisy
verdin export content-only.tar.gz --no-media      # bez plików multimediów
verdin import verdin backup-2026-09-28.tar.gz     # do tego projektu
```

Uruchamiaj je z konfiguracją projektu (tym samym `verdin.toml` i środowiskiem co serwer).
W kontenerze: `docker compose exec verdin verdin export /data/backup.tar.gz`.

### Co jest zawarte

- **Pliki schematu**, bez zmian.
- **Języki.** Pusty projekt przejmuje wszystkie, łącznie z domyślnym. Projekt, który ma już
  języki, dostaje tylko brakujące.
- **Foldery i pliki multimediów**, z ich formatami responsywnymi. Pliki zachowują
  `documentId`; ich identyfikatory liczbowe się zmieniają.
- **Każda wersja każdego wpisu**: szkice, opublikowane wersje i wszystkie języki, z datami,
  relacjami (przez `documentId`) i multimediami, łącznie z relacjami i multimediami wewnątrz
  komponentów i stref dynamicznych. Pola prywatne i hashe haseł są zawarte.

**Nie są zawarte**: administratorzy, role, tokeny API, webhooki, ustawienia funkcji,
przepływy recenzji i wydania. Odtwórz je w miejscu docelowym albo zamiast tego przywróć zrzut
bazy danych.

:::caution
Eksport zawiera pola prywatne i hashe haseł. Przechowuj go jak zrzut bazy danych.
:::

### Import

1. Import zapisuje pliki schematu i migruje bazę danych wyłącznie bezpiecznymi krokami.
2. Istniejące pliki schematu, które się różnią, zatrzymują import, chyba że przekażesz
   `--force`.
3. Typy zawartości, które mają już wpisy, też go zatrzymują, chyba że przekażesz `--force`;
   wpisy są wtedy dodawane obok istniejących.
4. Zaimportowane dokumenty zachowują `documentId`, więc import do projektu, który ma już te
   same dokumenty, się nie powiedzie.

Import nie uruchamia webhooków ani hooków wtyczek i nie zapisuje historii.

### Format archiwum

Archiwum tar skompresowane gzipem:

| Ścieżka | Zawartość |
| --- | --- |
| `manifest.json` | `format: "verdin-export"`, wersja formatu, wersja Verdin, liczba wersji na typ zawartości |
| `schema/…` | Pliki schematu |
| `locales.json` | `{ default, locales: [{ code, name }] }` |
| `folders.json`, `files.jsonl` | Foldery i pliki multimediów, jeden obiekt JSON na linię |
| `assets/{hash}{ext}` | Zapisane obiekty plików i ich formatów |
| `entries/{uid}.jsonl` | Jedna wersja na linię: `documentId`, `locale`, `published`, daty, `data`, `relations`, `media` |

Aby zamiast tego przenieść projekt Strapi, zobacz
[Migracja ze Strapi](/pl/migrate/from-strapi/).

## Testuj odtwarzanie

Od czasu do czasu odtwórz kopię do tymczasowej bazy danych, uruchom na niej Verdin przez
`verdin start` i sprawdź, czy możesz się zalogować oraz odczytać wpisy i multimedia.
