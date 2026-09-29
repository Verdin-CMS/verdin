---
title: Dokumentacja wiersza poleceń
description: Każde polecenie, podpolecenie i flaga binarki verdin, z tym, co czyta, zapisuje i wypisuje.
sidebar:
  order: 2
  label: Wiersz poleceń
---

<!-- Written from crates/verdin/src/cli.rs and crates/verdin/src/new.rs. `npm run check-cli`
(site/scripts/check-cli.mjs) fails when a subcommand or flag in cli.rs is missing here. -->

`verdin` to jedyna binarka: tworzy projekty, uruchamia serwer, stosuje migracje, zarządza
administratorami oraz wprowadza i wyprowadza treść. Ta strona wymienia każde polecenie
i flagę.

```text title="Terminal"
verdin [OPTIONS] <COMMAND>
```

| Polecenie | Co robi |
| --- | --- |
| [`verdin new`](#verdin-new) | Tworzy katalog projektu. |
| [`verdin dev`](#verdin-dev) | Uruchamia serwer w trybie deweloperskim. |
| [`verdin start`](#verdin-start) | Uruchamia serwer w trybie produkcyjnym. |
| [`verdin schema check`](#verdin-schema-check) | Waliduje pliki schematu. |
| [`verdin migrate plan`](#verdin-migrate-plan) | Pokazuje kroki migracji i ich SQL. |
| [`verdin migrate apply`](#verdin-migrate-apply) | Stosuje kroki migracji. |
| [`verdin admin create`](#verdin-admin-create) | Tworzy Super Admina. |
| [`verdin admin reset-password`](#verdin-admin-reset-password) | Ustawia hasło administratora. |
| [`verdin types`](#verdin-types) | Generuje definicje TypeScript API treści. |
| [`verdin import strapi`](#verdin-import-strapi) | Importuje eksport Strapi. |
| [`verdin import verdin`](#verdin-import-verdin) | Importuje eksport Verdin. |
| [`verdin export`](#verdin-export) | Zapisuje projekt do archiwum `.tar.gz`. |
| [`verdin healthcheck`](#verdin-healthcheck) | Sprawdza, czy lokalny serwer odpowiada. |
| [`verdin secrets`](#verdin-secrets) | Wypisuje nowe sekrety. |
| [`verdin version`](#verdin-version) | Wypisuje wersję. |

## Opcje globalne

| Opcja | Domyślnie | Opis |
| --- | --- | --- |
| `-c, --config <CONFIG>` | `verdin.toml` | Plik konfiguracyjny projektu. Odczytywany też z `VERDIN_CONFIG`. Katalog główny projektu to katalog tego pliku: schemat, wtyczki, przesłane pliki i względne ścieżki SQLite są rozwiązywane względem niego. |
| `-h, --help` | | Wypisuje pomoc polecenia. |
| `-V, --version` | | Wypisuje wersję. |

`verdin help <COMMAND>` wypisuje tę samą pomoc co `--help`.

Każde polecenie poza `new`, `secrets` i `version` najpierw wczytuje projekt:

1. Odczytuje plik `.env` obok pliku konfiguracyjnego, jeśli istnieje. Zmienne już ustawione
   w środowisku mają pierwszeństwo.
2. Wczytuje `verdin.toml` (opcjonalny) i nadpisania `VERDIN_*`. Zobacz
   [dokumentację konfiguracji](/pl/reference/configuration/).
3. Zaczyna logować na standardowe wyjście błędów, z `[log]` i `RUST_LOG`.

Polecenia, które otwierają bazę danych, potrzebują `VERDIN_DATABASE_URL` lub
`[database].url`. Polecenia, które dotykają kont administratorów lub uruchamiają serwer,
potrzebują też `VERDIN_ADMIN_JWT_SECRET` i `VERDIN_TOKEN_PEPPER`.

## `verdin new`

```text title="Terminal"
verdin new <DIR> [--database <DATABASE>]
```

Tworzy projekt w `DIR`, który nie może istnieć albo musi być pusty:

| Plik | Zawartość |
| --- | --- |
| `verdin.toml` | `[server]`, `[api]` i `[admin]` z wartościami domyślnymi. |
| `.env` | `VERDIN_DATABASE_URL` oraz nowe `VERDIN_ADMIN_JWT_SECRET` i `VERDIN_TOKEN_PEPPER`. Czytelny tylko dla ciebie (tryb `0600` w Unix). |
| `.gitignore` | `.env`, `data/`, pliki SQLite i `.cache/`. |
| `schema/content-types/`, `schema/components/` | Puste katalogi schematu. |
| `data/` | Na bazę SQLite (tylko SQLite). |

| Argument lub opcja | Domyślnie | Opis |
| --- | --- | --- |
| `<DIR>` | | Katalog do utworzenia. |
| `--database <DATABASE>` | `sqlite` | Baza danych, na którą wskazuje `.env`: `sqlite`, `postgres`, `mysql` lub `mariadb`. |

Z `sqlite` URL to `sqlite://data/verdin.db`. W pozostałych przypadkach to URL lokalnego
serwera z użytkownikiem `verdin`, hasłem `change-me` i bazą danych nazwaną od katalogu (małe
litery, cyfry i `_`): zmień go przed startem.

```text title="Terminal"
$ verdin new blog --database postgres
created blog

  cd blog
  verdin dev

then open http://localhost:1337/admin/ to register the first admin
```

## `verdin dev`

```text title="Terminal"
verdin dev
```

Uruchamia serwer w trybie deweloperskim. W porównaniu z `verdin start`:

- Oczekujące migracje z poziomem ryzyka `safe` są stosowane przy starcie. Bardziej ryzykowne
  kroki zatrzymują serwer; przejrzyj je przez [`verdin migrate plan`](#verdin-migrate-plan).
- **Kreator typów zawartości** w panelu edytuje pliki schematu, a serwer przeładowuje
  schemat.
- Ciasteczko odświeżania nie jest oznaczane jako `Secure` (chyba że `[admin].secure_cookies`
  mówi inaczej), więc możesz logować się przez zwykłe HTTP.
- Webhooki i cele wdrożeń mogą wywoływać adresy loopback i prywatne (chyba że
  `[webhooks].allow_private_networks` mówi inaczej).

Zatrzymuje się po Ctrl+C lub `SIGTERM`.

## `verdin start`

```text title="Terminal"
verdin start [--migrate]
```

Uruchamia serwer w trybie produkcyjnym. Odmawia startu, gdy baza danych jest w tyle za
schematem, więc wdrożenie nigdy nie zmienia tabel, których nie przejrzałeś.

| Opcja | Opis |
| --- | --- |
| `--migrate` | Stosuje oczekujące kroki migracji `safe` przed startem. Kroki ryzykowne i destrukcyjne nadal wymagają `verdin migrate apply`. |

Przed rozpoczęciem nasłuchiwania sprawdza konfigurację (`[api].prefix` i `[admin].path`
wyglądają jak `/api`, rozmiary stron są spójne, `[server].trusted_proxies`
i `[api].cors_origins` dają się sparsować) i tworzy wbudowane role. Loguje ostrzeżenie, gdy
`[admin].secure_cookies` to `false` albo `[email].provider` to `log`. Gdy nie ma jeszcze
administratora, loguje adres panelu, w którym pierwszy odwiedzający rejestruje pierwszego
Super Admina.

Zatrzymuje się po Ctrl+C lub `SIGTERM`.

## `verdin schema check`

```text title="Terminal"
verdin schema check
```

Waliduje pliki schematu (`[schema].path`) bez dotykania bazy danych. Wypisuje podsumowanie
albo kończy się błędami, każdym z plikiem i ścieżką atrybutu:

```text title="Terminal"
$ verdin schema check
schema ok: 4 content types, 3 components
```

Używaj go w CI przed wdrożeniem. Co przyjmuje każdy atrybut, opisują
[Typy atrybutów](/pl/reference/attribute-types/).

## `verdin migrate plan`

```text title="Terminal"
verdin migrate plan [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Porównuje bazę danych ze schematem i wypisuje, co zrobiłoby `verdin migrate apply`, niczego
nie zmieniając: ponumerowane kroki, każdy z poziomem ryzyka i SQL. Wypisuje
`database is up to date`, gdy nie ma nic do zrobienia.

| Opcja | Opis |
| --- | --- |
| `--rename-table <OLD=NEW>` | Traktuje tabelę `OLD` jako przemianowaną na `NEW` (zachowuje wiersze) zamiast usuwać jedną i tworzyć drugą. Można powtarzać. |
| `--rename-column <TABLE.OLD=NEW>` | Traktuje kolumnę `OLD` w `TABLE` jako przemianowaną na `NEW` (zachowuje wartości). `TABLE` to nowa nazwa tabeli. Można powtarzać. |

Poziomy ryzyka:

| Poziom | Znaczenie |
| --- | --- |
| `safe` | Nie może stracić danych ani się nie udać na istniejących wierszach: nowe tabele, nowe kolumny dopuszczające NULL lub z wartością domyślną, zmiany nazw, nieunikalne indeksy. |
| `risky` | Może się nie udać na istniejących wierszach lub konwertować wartości: zmiany typów kolumn, nowe kolumny bez NULL i bez wartości domyślnej, unikalne indeksy na istniejących tabelach. |
| `destructive` | Usuwa kolumny lub tabele. |

Gdy krok jest powyżej `safe`, plan kończy się wymaganą flagą
(`requires: verdin migrate apply --allow risky`). Gdy usunięta kolumna lub tabela wygląda na
przemianowaną, plan wymienia flagi zmiany nazwy do przekazania. Gdy poprzednia migracja
została przerwana, pokazuje, ile kroków zastosowano, i ostatni błąd.

```text title="Terminal"
verdin migrate plan --rename-column articles.summary=excerpt
```

Zobacz [Migracje schematu](/pl/concepts/schema-migrations/).

## `verdin migrate apply`

```text title="Terminal"
verdin migrate apply [--allow <ALLOW>] [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Stosuje plan. Przyjmuje te same opcje zmiany nazw co `verdin migrate plan`; przekaż te same,
które przejrzałeś.

| Opcja | Domyślnie | Opis |
| --- | --- | --- |
| `--allow <ALLOW>` | `safe` | Najwyższy stosowany poziom ryzyka: `safe`, `risky` lub `destructive`. Plan z krokiem powyżej niego jest odrzucany, zanim cokolwiek się wykona. |
| `--rename-table <OLD=NEW>` | | Jak w `verdin migrate plan`. |
| `--rename-column <TABLE.OLD=NEW>` | | Jak w `verdin migrate plan`. |

Wypisuje `applied N steps` lub `database is up to date`. Po przerwaniu (utracone połączenie,
nieudany krok) usuń przyczynę i uruchom ponownie: wznowi od kroku, który się nie zakończył.

## `verdin admin create`

```text title="Terminal"
verdin admin create --email <EMAIL>
```

Tworzy Super Admina. Hasło jest odczytywane z `VERDIN_ADMIN_PASSWORD` albo, gdy nie jest
ustawione, ze standardowego wejścia. Baza danych musi być aktualna względem schematu.

| Opcja | Opis |
| --- | --- |
| `--email <EMAIL>` | Adres e-mail nowego administratora. |

```text title="Terminal"
$ VERDIN_ADMIN_PASSWORD='a long passphrase' verdin admin create --email ada@example.com
created Super Admin ada@example.com (id 1)
```

Używaj go, aby utworzyć pierwszego administratora serwera, który nie jest jeszcze dostępny
w przeglądarce; w przeciwnym razie rejestruje go pierwszy odwiedzający panel.

## `verdin admin reset-password`

```text title="Terminal"
verdin admin reset-password --email <EMAIL>
```

Ustawia hasło administratora, odblokowuje konto po nieudanych logowaniach i kończy wszystkie
jego sesje. Hasło jest odczytywane jak w `verdin admin create`.

| Opcja | Opis |
| --- | --- |
| `--email <EMAIL>` | Adres e-mail administratora. |

Nie usuwa drugich składników; administrator z **Zarządzanie użytkownikami** może je
zresetować w **Ustawienia → Użytkownicy**.

## `verdin types`

```text title="Terminal"
verdin types [-o <OUT>]
```

Generuje ze schematu definicje TypeScript API treści (jeden interfejs na typ zawartości
i komponent) i wypisuje je na standardowe wyjście. Nie potrzebuje bazy danych.

| Opcja | Opis |
| --- | --- |
| `-o, --out <OUT>` | Zapisuje zamiast tego do tego pliku. |

```text title="Terminal"
verdin types --out ../web/src/verdin.d.ts
```

Zobacz [Typowany klient](/pl/guides/frontend/typed-client/).

## `verdin import strapi`

```text title="Terminal"
verdin import strapi <PATH> [--schema-only] [--force]
```

Importuje projekt Strapi v4 lub v5 z eksportu wykonanego przez
`strapi export --no-encrypt`: `.tar.gz`, `.tar` lub rozpakowanego katalogu. Zapisuje typy
zawartości i komponenty jako pliki schematu, a potem importuje wpisy, języki, multimedia,
relacje i foldery.

| Argument lub opcja | Opis |
| --- | --- |
| `<PATH>` | Plik lub katalog eksportu. |
| `--schema-only` | Zapisuje tylko pliki schematu. |
| `--force` | Nadpisuje istniejące pliki schematu i importuje do typów zawartości, które mają już wpisy. |

Wypisuje, co zapisał i zaimportował, z ostrzeżeniami o tym, czego nie mógł przenieść,
i zapisuje `strapi-id-map.json` w katalogu głównym projektu: identyfikatory Strapi i ich nowe
`documentId` oraz identyfikatory plików w Verdin, do poprawiania linków we frontendzie.

Zobacz [Migracja ze Strapi](/pl/migrate/from-strapi/).

## `verdin import verdin`

```text title="Terminal"
verdin import verdin <PATH> [--force]
```

Importuje archiwum zapisane przez `verdin export`: pliki schematu, języki, multimedia
i wpisy.

| Argument lub opcja | Opis |
| --- | --- |
| `<PATH>` | Plik `.tar.gz`. |
| `--force` | Nadpisuje różniące się pliki schematu i importuje do typów zawartości, które mają już wpisy. |

## `verdin export`

```text title="Terminal"
verdin export <OUTPUT> [--no-media]
```

Zapisuje schemat, treść i multimedia projektu do archiwum `.tar.gz`: kopii zapasowej albo
sposobu na przeniesienie projektu na inną instancję przez `verdin import verdin`. Archiwum
zawiera każdą wersję każdego wpisu (szkice, opublikowane wersje, języki) z relacjami. Konta
administratorów, tokeny API i ustawienia nie są zawarte.

| Argument lub opcja | Opis |
| --- | --- |
| `<OUTPUT>` | Archiwum do zapisania. |
| `--no-media` | Pomija bibliotekę multimediów: pliki, foldery i powiązania wpisów z nimi. |

```text title="Terminal"
$ verdin export backup.tar.gz
exported to backup.tar.gz: 42 documents (57 versions), 18 files, 3 folders, 2 locales
```

Zobacz [Kopie zapasowe](/pl/deploy/backups/).

## `verdin healthcheck`

```text title="Terminal"
verdin healthcheck [--port <PORT>]
```

Odpytuje `GET /_health` serwera na tej maszynie (`127.0.0.1`, `[server].port`
z konfiguracji) i kończy się statusem 0, gdy odpowiada on `200`, a 1 w przeciwnym razie,
wypisując przyczynę. Nie potrzebuje powłoki, `curl` ani klienta HTTP, więc obraz Docker
używa go jako `HEALTHCHECK`; używaj go tak samo w Compose lub dowolnym nadzorcy, który
uruchamia polecenie.

| Opcja | Opis |
| --- | --- |
| `--port <PORT>` | Sprawdza ten port zamiast `[server].port`. |

```text title="Terminal"
$ verdin healthcheck
ok
```

Zobacz [Monitoring](/pl/deploy/monitoring/).

## `verdin secrets`

```text title="Terminal"
verdin secrets
```

Wypisuje nowe `VERDIN_ADMIN_JWT_SECRET` i `VERDIN_TOKEN_PEPPER`, gotowe do pliku `.env` lub
magazynu sekretów twojej platformy. Nie czyta żadnego projektu.

Zmiana `VERDIN_ADMIN_JWT_SECRET` unieważnia krótkotrwałe tokeny dostępu administratorów
i użytkowników końcowych, otwarte linki podglądu i trwające logowania OAuth; panel
administracyjny i klienci używający tokenów odświeżania sami dostają nowe. Zmiana
`VERDIN_TOKEN_PEPPER` unieważnia przechowywane tokeny (w tym tokeny API), więc gdy jest już
w użyciu, nie zmieniaj go.

## `verdin version`

```text title="Terminal"
verdin version
```

Wypisuje `verdin` i wersję, jak `verdin --version`.
