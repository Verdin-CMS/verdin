---
title: Hostowany playground
description: Uruchom publiczne demo Verdin — przykład bloga na SQLite z treściami demo i kontem demo, czyszczone i zasilane od nowa co godzinę — z deploy/playground.
sidebar:
  order: 11
---

[`deploy/playground/`](https://github.com/verdin-cms/verdin/tree/main/deploy/playground)
buduje kontener dla publicznego dema: [przykład bloga](https://github.com/verdin-cms/verdin/tree/main/examples/blog)
na SQLite, z kilkoma opublikowanymi artykułami i kontem demo, na które mogą się zalogować
odwiedzający. Co godzinę wyrzuca bazę danych i zaczyna od nowa. Kontener nie potrzebuje
wolumenu, serwera bazy danych ani żadnych sekretów od Ciebie. Gdzie go hostować, zależy od
Ciebie; działa każda platforma, która uruchamia jeden kontener z publicznym adresem HTTPS.

Skrypty uruchomiono na lokalnej budowie 2026-09-30 (trzy cykle resetu); obraz zbudowano, ale
nie uruchamiano go z opublikowanego wydania.

## Co dostają odwiedzający

- Panel administracyjny pod `/admin/`, zalogowany jako **demo@example.com** /
  **verdin-demo-1234**. Konto ma rolę **Editor**: może tworzyć, edytować, publikować
  i usuwać treści oraz przesyłać multimedia, ale nie może zarządzać użytkownikami, rolami,
  tokenami API, webhookami ani ustawieniami.
- Publiczny dostęp do odczytu artykułów, kategorii, tagów i strony głównej przez REST
  (`/api/articles?populate=*`) i GraphQL.
- Dwa opublikowane artykuły, szkic, dwie kategorie, dwa tagi i strona główna.

Istnieje też Super Admin, z losowym hasłem, którego nikt nie zna.

## Jak to działa

`run.sh` działa w pętli:

1. Usuwa `/var/lib/verdin-playground` (baza danych, przesłane pliki, indeks wyszukiwania,
   cache obrazów) i generuje nowe sekrety, więc sesje z poprzedniego cyklu się kończą.
2. Uruchamia `verdin start --migrate` i czeka na `/_ready`.
3. Uruchamia `seed.sh`: tworzy konta przez CLI i API administracyjne, otwiera publiczny
   odczyt i tworzy treści.
4. Czeka `PLAYGROUND_RESET_SECONDS` (3600), zatrzymuje serwer i zaczyna od nowa. Jeśli
   serwer zatrzyma się sam, zaczyna od nowa od razu.

Konfiguracja (`deploy/playground/verdin.toml`) ogranicza przesyłane pliki do 2 MB, limituje
anonimowe żądania do 300 na minutę na adres, trzyma dostarczenia webhooków z dala od
adresów prywatnych i włącza wyszukiwanie.

## Zbuduj i uruchom

Z katalogu głównego repozytorium:

```sh frame="terminal"
docker build -f deploy/playground/Dockerfile -t verdin-playground .
docker run -p 1337:1337 --tmpfs /var/lib/verdin-playground:uid=65532,gid=65532 verdin-playground
```

Obraz to Alpine z `curl` i `jq` (skrypty potrzebują powłoki, której oficjalny obraz nie ma)
oraz statyczną binarką skopiowaną z `ghcr.io/verdin-cms/verdin`. Przekaż
`--build-arg VERDIN_IMAGE=ghcr.io/verdin-cms/verdin:<version>`, aby wybrać wydanie. `tmpfs`
trzyma dane w pamięci; bez niego dane żyją w systemie plików kontenera, co też działa.

| Zmienna | Domyślnie | Co |
| --- | --- | --- |
| `PLAYGROUND_RESET_SECONDS` | `3600` | Czas między resetami. |
| `PLAYGROUND_EMAIL`, `PLAYGROUND_PASSWORD` | `demo@example.com`, `verdin-demo-1234` | Konto demo. |
| `VERDIN_SERVER__PUBLIC_URL` | | Publiczny adres playgroundu. |
| `VERDIN_SERVER__TRUSTED_PROXIES` | | Zakres proxy platformy, aby limity żądań obowiązywały na odwiedzającego. |

## Hostowanie

Uruchom dokładnie jedną instancję (baza danych jest lokalna), utrzymuj ją uruchomioną (bez
skalowania do zera: licznik resetu żyje w procesie) i postaw z przodu HTTPS: ciasteczko sesji
panelu administracyjnego jest `Secure` w trybie `start`, więc logowanie wymaga HTTPS.
Każdy może przez godzinę zapisywać treści i przesyłać obrazy, więc na stronie, która do niego
linkuje, wskaż harmonogram resetów i trzymaj instancję na domenie oddzielnej od wszystkiego,
co współdzieli ciasteczka.
