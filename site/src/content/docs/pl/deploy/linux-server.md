---
title: Serwer Linux
description: Uruchom Verdin na serwerze Debian lub Ubuntu z pakietu .deb — usługa systemd, użytkownik systemowy verdin, stan w /var/lib/verdin — za reverse proxy.
sidebar:
  order: 3
---

Ta strona uruchamia Verdin bezpośrednio na serwerze Debian lub Ubuntu, bez kontenerów, z
pakietu `.deb` dołączonego do każdego wydania. Ten sam układ działa w innych dystrybucjach
z binarką ze [skryptu instalacyjnego](/pl/start/installation/) i ręcznie skopiowanymi plikami
z [`deploy/deb/`](https://github.com/verdin-cms/verdin/tree/main/deploy/deb).

Pakiet zbudowano i sprawdzono przez `cargo deb` 2026-09-30; na potrzeby tego przewodnika nie
był instalowany na działającym serwerze.

## Co instaluje pakiet

| Ścieżka | Co |
| --- | --- |
| `/usr/bin/verdin` | Binarka (statyczna, z wbudowanym panelem administracyjnym). |
| `/etc/verdin/verdin.toml` | Konfiguracja (conffile: aktualizacje zachowują Twoje zmiany). |
| `/etc/verdin/verdin.env` | Tworzony przy pierwszej instalacji, tryb `0640`: świeże `VERDIN_ADMIN_JWT_SECRET` i `VERDIN_TOKEN_PEPPER` oraz `VERDIN_DATABASE_URL` (domyślnie SQLite). |
| `/var/lib/verdin/` | Katalog domowy użytkownika systemowego `verdin`: baza SQLite, `schema/`, `uploads/`, indeks wyszukiwania i cache obrazów. |
| `/usr/lib/systemd/system/verdin.service` | Usługa, zainstalowana, ale niewłączona. |

Usługa uruchamia `verdin -c /etc/verdin/verdin.toml start --migrate` jako użytkownik
`verdin`, z piaskownicą systemd (system tylko do odczytu, prywatne `/tmp`, brak nowych
uprawnień) i dostępem do zapisu tylko w `/var/lib/verdin`. Nasłuchuje na `127.0.0.1:1337`.

## 1. Instalacja

```sh frame="terminal"
curl -fsSLO https://github.com/verdin-cms/verdin/releases/download/v0.11.0/verdin_0.11.0-1_amd64.deb
sudo apt install ./verdin_0.11.0-1_amd64.deb
```

Na serwerach ARM użyj `arm64` w nazwie pliku.

## 2. Konfiguracja

1. Skopiuj zatwierdzony schemat do `/var/lib/verdin/schema/` (`content-types/` i
   `components/`), z właścicielem `verdin`:

   ```sh frame="terminal"
   sudo rsync -a --chown=verdin:verdin schema/ /var/lib/verdin/schema/
   ```

2. Dla PostgreSQL, MySQL lub MariaDB edytuj `VERDIN_DATABASE_URL` w
   `/etc/verdin/verdin.env`. Zachowaj oba sekrety: nowy `VERDIN_TOKEN_PEPPER` unieważnia
   każdy token API.
3. W `/etc/verdin/verdin.toml` ustaw `[server].public_url` na adres używany przez
   przeglądarki oraz `trusted_proxies = ["127.0.0.1"]`, gdy reverse proxy działa na tej
   samej maszynie. Każdy inny klucz jest w [dokumentacji konfiguracji](/pl/reference/configuration/).

## 3. Start

```sh frame="terminal"
sudo systemctl enable --now verdin
journalctl -u verdin -f
```

Pierwszy start tworzy tabele. Utwórz pierwszego administratora z wiersza poleceń (plik
środowiskowy usługi zawiera adres URL bazy danych):

```sh frame="terminal"
sudo -u verdin sh -c 'set -a; . /etc/verdin/verdin.env; verdin -c /etc/verdin/verdin.toml admin create --email you@example.com'
```

albo otwórz panel administracyjny przez proxy i zarejestruj się tam.

## 4. Postaw reverse proxy z przodu

Verdin serwuje zwykły HTTP na interfejsie loopback. Z Caddy, który sam pobiera i odnawia
certyfikat:

```text title="/etc/caddy/Caddyfile"
cms.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:1337
}
```

nginx też działa; wyłącz buforowanie dla `/api/_events`, aby zdarzenia czasu rzeczywistego
nie były wstrzymywane (`proxy_buffering off;`).

## Aktualizacje i usuwanie

- **Aktualizacja:** zainstaluj `.deb` następnego wydania przez `apt install ./verdin_….deb`.
  Usługa restartuje się, jeśli działała, a `start --migrate` stosuje bezpieczne migracje.
  Najpierw przeczytaj [Aktualizowanie](/pl/migrate/upgrading/).
- **Usuwanie:** `apt remove verdin` zatrzymuje usługę i zachowuje dane oraz konfigurację;
  `apt purge verdin` usuwa też `/etc/verdin/verdin.env` (sekrety). Użytkownik `verdin`
  i `/var/lib/verdin` nigdy nie są usuwane przez pakiet: usuń je sam, gdy będziesz mieć
  [kopię zapasową](/pl/deploy/backups/).
