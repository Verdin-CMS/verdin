---
title: Docker Compose w produkcji
description: Produkcyjny przepis Compose dla jednego serwera — Verdin, PostgreSQL i Caddy z automatycznym HTTPS oraz opcjonalny RustFS dla multimediów zgodnych z S3.
sidebar:
  order: 3
---

[`deploy/compose/`](https://github.com/verdin-cms/verdin/tree/main/deploy/compose) to gotowa
konfiguracja dla jednego serwera: Verdin i PostgreSQL w sieci prywatnej oraz Caddy z przodu,
z certyfikatem, który sam pobiera i odnawia. Plik nadpisujący dodaje RustFS, magazyn zgodny
z S3 na tym samym hoście, dla multimediów. [Docker](/pl/deploy/docker/) wyjaśnia obraz,
którego używają te pliki.

Pliki sprawdzono przez `docker compose config` i `caddy validate` 2026-09-30.

## Pliki

| Plik | Co |
| --- | --- |
| `compose.yaml` | `verdin`, `db` (PostgreSQL 17) i `caddy`. Tylko Caddy publikuje porty (80, 443 i 443/udp dla HTTP/3). |
| `compose.s3.yaml` | Dodaje `rustfs` i jednorazowe zadanie tworzące bucket `media` z publicznym odczytem oraz przełącza na niego dostawcę przesyłania Verdin. |
| `Caddyfile` | TLS dla `$VERDIN_DOMAIN`, kompresja, `/media/*` do RustFS i wszystko inne do Verdin. |
| `.env.example` | Zmienne czytane przez Compose: domena, e-mail ACME, tag obrazu, hasła. |

## Konfiguracja

Wymagania wstępne: serwer z Dockerem, rekord DNS Twojej domeny wskazujący na niego oraz
otwarte porty 80 i 443.

1. Skopiuj katalog na serwer i uzupełnij `.env`:

   ```sh frame="terminal"
   cp .env.example .env                                  # VERDIN_DOMAIN, ACME_EMAIL
   echo "DB_PASSWORD=$(openssl rand -hex 24)" >> .env
   docker run --rm ghcr.io/verdin-cms/verdin:0.11 secrets > verdin.env
   ```

2. Umieść zatwierdzony schemat w `schema/` (`content-types/` i `components/`). Jest
   montowany tylko do odczytu w `/app/schema`.
3. Uruchom:

   ```sh frame="terminal"
   docker compose up -d
   docker compose logs -f verdin
   ```

4. Otwórz `https://<your domain>/admin/` i zarejestruj pierwszego administratora.

Trzymaj `.env` i `verdin.env` poza kontrolą wersji i rób ich kopie zapasowe: nowy
`VERDIN_TOKEN_PEPPER` unieważnia każdy token API.

## Multimedia w S3

Domyślnie przesłane pliki trafiają do wolumenu `verdin-data`. Aby zamiast tego przechowywać je
w RustFS:

```sh frame="terminal"
echo "S3_SECRET_KEY=$(openssl rand -hex 24)" >> .env
docker compose -f compose.yaml -f compose.s3.yaml up -d
```

Pliki serwuje wtedy Caddy pod `https://<your domain>/media/<key>`. Dla AWS S3, Cloudflare R2
lub innego dostawcy pomiń usługi RustFS i ustaw zmienne `VERDIN_UPLOAD__PROVIDER__*` oraz
poświadczenia `AWS_*` na wartości tego dostawcy (zobacz [Magazyn](/pl/internals/storage/)).
Przełączenie istniejącej witryny nie przenosi żadnych plików: nowe przesyłane pliki trafiają
do nowego dostawcy.

## Uwagi

- **Adresy klientów.** Verdin ufa `X-Forwarded-For` z sieci Compose (`172.30.0.0/24`,
  ustalonej w `compose.yaml`), w której Caddy jest jedynym proxy. Zmień oba, jeśli ten zakres
  koliduje z jedną z Twoich sieci.
- **Czas rzeczywisty.** Caddy strumieniuje odpowiedzi `text/event-stream` bez buforowania,
  więc [zdarzenia czasu rzeczywistego](/pl/guides/frontend/realtime/) działają za nim bez
  zmian.
- **Aktualizacje.** Zmień `VERDIN_VERSION` w `.env`, potem
  `docker compose pull && docker compose up -d`. Najpierw przeczytaj
  [Aktualizowanie](/pl/migrate/upgrading/).
- **Kopie zapasowe.** Zrzucaj PostgreSQL i zachowaj wolumen `verdin-data` (lub bucket); zobacz
  [Kopie zapasowe](/pl/deploy/backups/).
- **Polecenia administracyjne.** Obraz nie ma powłoki:
  `docker compose exec verdin verdin admin create --email you@example.com`.
