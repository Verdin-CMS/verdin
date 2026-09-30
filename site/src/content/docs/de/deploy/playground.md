---
title: Gehostetes Playground
description: Eine öffentliche Demo von Verdin betreiben – das Blog-Beispiel auf SQLite mit Demo-Inhalten und einem Demo-Konto, jede Stunde gelöscht und neu befüllt – aus deploy/playground.
sidebar:
  order: 11
---

[`deploy/playground/`](https://github.com/verdin-cms/verdin/tree/main/deploy/playground) baut
einen Container für eine öffentliche Demo: das [Blog-Beispiel](https://github.com/verdin-cms/verdin/tree/main/examples/blog)
auf SQLite, mit ein paar veröffentlichten Artikeln und einem Demo-Konto, mit dem sich Besucher
anmelden können. Jede Stunde wirft er die Datenbank weg und beginnt von vorn. Der Container
braucht kein Volume, keinen Datenbankserver und keine Secrets von dir. Wo du ihn hostest, ist
dir überlassen; jede Plattform, die einen Container mit öffentlicher HTTPS-Adresse betreibt,
funktioniert.

Die Skripte liefen am 30.09.2026 gegen einen lokalen Build (drei Reset-Zyklen); das Image wurde
gebaut, aber nicht aus einem veröffentlichten Release betrieben.

## Was Besucher bekommen

- Das Admin-Panel unter `/admin/`, angemeldet als **demo@example.com** / **verdin-demo-1234**.
  Das Konto hat die Rolle **Editor**: Es kann Inhalte anlegen, bearbeiten, veröffentlichen und
  löschen sowie Medien hochladen, aber keine Benutzer, Rollen, API-Tokens, Webhooks oder
  Einstellungen verwalten.
- Öffentlichen Lesezugriff auf Artikel, Kategorien, Tags und die Startseite über REST
  (`/api/articles?populate=*`) und GraphQL.
- Zwei veröffentlichte Artikel, einen Entwurf, zwei Kategorien, zwei Tags und die Startseite.

Es gibt auch einen Super Admin, mit einem zufälligen Passwort, das niemand kennt.

## So funktioniert es

`run.sh` läuft in einer Schleife:

1. Löscht `/var/lib/verdin-playground` (Datenbank, Uploads, Suchindex, Bild-Cache) und erzeugt
   neue Secrets, sodass die Sitzungen des letzten Zyklus enden.
2. Startet `verdin start --migrate` und wartet auf `/_ready`.
3. Führt `seed.sh` aus: legt die Konten über die CLI und die Admin-API an, öffnet den
   öffentlichen Lesezugriff und erstellt die Inhalte.
4. Wartet `PLAYGROUND_RESET_SECONDS` (3600), stoppt den Server und beginnt von vorn. Stoppt der
   Server von selbst, beginnt er sofort von vorn.

Die Konfiguration (`deploy/playground/verdin.toml`) begrenzt Uploads auf 2 MB, begrenzt anonyme
Anfragen auf 300 pro Minute und Adresse, hält Webhook-Zustellungen von privaten Adressen fern und
aktiviert die Suche.

## Bauen und ausführen

Vom Wurzelverzeichnis des Repositorys aus:

```sh frame="terminal"
docker build -f deploy/playground/Dockerfile -t verdin-playground .
docker run -p 1337:1337 --tmpfs /var/lib/verdin-playground:uid=65532,gid=65532 verdin-playground
```

Das Image ist Alpine mit `curl` und `jq` (die Skripte brauchen eine Shell, die das offizielle
Image nicht hat) und der statischen Binärdatei, kopiert aus `ghcr.io/verdin-cms/verdin`. Gib
`--build-arg VERDIN_IMAGE=ghcr.io/verdin-cms/verdin:<version>` mit, um das Release zu wählen. Das
`tmpfs` hält die Daten im Arbeitsspeicher; ohne es liegen die Daten im Dateisystem des
Containers, was ebenfalls funktioniert.

| Variable | Standard | Was |
| --- | --- | --- |
| `PLAYGROUND_RESET_SECONDS` | `3600` | Zeit zwischen Resets. |
| `PLAYGROUND_EMAIL`, `PLAYGROUND_PASSWORD` | `demo@example.com`, `verdin-demo-1234` | Das Demo-Konto. |
| `VERDIN_SERVER__PUBLIC_URL` | | Die öffentliche Adresse des Playgrounds. |
| `VERDIN_SERVER__TRUSTED_PROXIES` | | Der Bereich des Plattform-Proxys, damit Rate Limits pro Besucher gelten. |

## Hosten

Betreibe genau eine Instanz (die Datenbank ist lokal), halte sie am Laufen (kein Scale-to-zero:
der Reset-Timer lebt im Prozess) und setze HTTPS davor: Das Session-Cookie des Admin-Panels ist
im Modus `start` `Secure`, die Anmeldung braucht also HTTPS. Jeder kann bis zu eine Stunde lang
Inhalte schreiben und Bilder hochladen, verweise die Seite, die darauf verlinkt, also auf den
Reset-Zeitplan, und halte die Instanz auf einer Domain, die getrennt ist von allem, was Cookies
teilt.
