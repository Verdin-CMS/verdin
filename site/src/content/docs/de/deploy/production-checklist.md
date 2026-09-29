---
title: Checkliste für die Produktion
description: Was du einstellen solltest, bevor ein Verdin-Projekt echten Traffic bekommt – Secrets, Datenbank, Migrationen, URLs, Proxys, Cookies, CORS, Medienspeicher, E-Mail, Backups und Monitoring.
sidebar:
  order: 1
---

Geh diese Liste durch, bevor du ein Verdin-Projekt vor echte Nutzer stellst. Jeder Punkt
verlinkt auf die Seite, die ihn erklärt. Die Plattformseiten ([Docker](/de/deploy/docker/),
[Fly.io](/de/deploy/fly/), [Render](/de/deploy/render/), [Railway](/de/deploy/railway/),
[Kubernetes](/de/deploy/kubernetes/)) übernehmen diese Einstellungen für dich, wo sie können.

## Den Produktionsserver betreiben

- [ ] **Nimm `verdin start`, nicht `verdin dev`.** `dev` lässt den Content-Type Builder
      Schemadateien umschreiben, wendet bei jeder Änderung Migrationen an und lockert Cookie-
      und Webhook-Regeln für die lokale Arbeit. Ändere das Schema in der Entwicklung, committe
      die Dateien und deploye sie.
- [ ] **Wende Migrationen beim Deploy an.** `verdin start` verweigert den Betrieb, solange die
      Datenbank hinter dem Schema zurückliegt. `verdin start --migrate` wendet vorher die
      ausstehenden *sicheren* Schritte an (das ist der Standardbefehl des Docker-Images).
      Riskante oder destruktive Schritte (Typänderungen, neue Unique-Constraints, entfernte
      Spalten) brauchen `verdin migrate apply --allow risky|destructive`, einmal von dir
      ausgeführt. Siehe [Schemamigrationen](/de/concepts/schema-migrations/).
- [ ] **Liefere das Schema mit dem Server aus.** Binde das Verzeichnis `schema/`
      schreibgeschützt ein oder back es in dein Image ein, damit läuft, was du committet hast.

## Secrets

- [ ] **Erzeuge die beiden Pflicht-Secrets einmalig** mit `verdin secrets` und leg sie im
      Secret-Store deiner Plattform ab: `VERDIN_ADMIN_JWT_SECRET` signiert Sitzungstokens, und
      `VERDIN_TOKEN_PEPPER` ist der Schlüssel für die Hashes der API-Tokens und anderer
      gespeicherter Geheimnisse. `verdin start` schlägt fehl, wenn eines fehlt oder kürzer als
      32 Bytes ist. Secrets werden nur aus der Umgebung gelesen, nie aus `verdin.toml`.
- [ ] **Halte sie stabil.** Eine Änderung von `VERDIN_TOKEN_PEPPER` macht jedes API-Token
      unbrauchbar, ebenso die Codes der Authenticator-Apps und die Wiederherstellungscodes der
      Admins. Eine Änderung von `VERDIN_ADMIN_JWT_SECRET` macht die kurzlebigen
      Access-Tokens von Admins und Endnutzern ungültig, ebenso offene Vorschaulinks und
      laufende OAuth-Anmeldungen (das Admin-Panel und Clients mit Refresh-Tokens erneuern sie
      von selbst). Jede Instanz eines Projekts braucht dieselben Werte.
- [ ] Leg auch die anderen Secrets, die du nutzt, in die Umgebung:
      `VERDIN_EMAIL_SMTP_PASSWORD` oder `VERDIN_EMAIL_API_KEY`, `AWS_ACCESS_KEY_ID` /
      `AWS_SECRET_ACCESS_KEY`, `VERDIN_METRICS_TOKEN`, `VERDIN_SSO_<ID>_SECRET`,
      `VERDIN_IMAGE_SECRET`. Die vollständige Liste steht in der
      [Konfigurationsreferenz](/de/reference/configuration/).

## Datenbank

- [ ] **Wähle die Engine.** PostgreSQL (14 oder neuer) ist die übliche Wahl und die richtige,
      wenn du [mehrere Instanzen](/de/deploy/scaling/) betreiben wirst. MySQL 8.4+ und
      MariaDB 10.11+ funktionieren genauso. SQLite passt zu einer einzelnen Instanz mit
      persistenter Festplatte.
- [ ] **Setze `VERDIN_DATABASE_URL`**: `postgres://…`, `mysql://…` (MySQL und MariaDB) oder
      `sqlite:///data/verdin.db`. Hänge `?sslmode=require` für PostgreSQL-Server an, die TLS
      verlangen.
- [ ] **Dimensioniere den Pool.** Jede Instanz öffnet bis zu `[database].pool_max`
      Verbindungen (10). Halte `instances × pool_max` unter dem Verbindungslimit des Servers.

## URLs, Proxys und Cookies

- [ ] **Liefere über HTTPS aus.** Verdin spricht reines HTTP; terminiere TLS an einem Reverse
      Proxy, einem Load Balancer oder am Edge deiner Plattform.
- [ ] **Setze `[server].public_url`** (`VERDIN_SERVER__PUBLIC_URL`) auf die Adresse, die
      Browser verwenden, etwa `https://cms.example.com`. Links in E-Mails, SSO-Callbacks, der
      tägliche Digest und Passkeys hängen davon ab; Passkeys sind an ihren Host gebunden.
- [ ] **Setze `[server].trusted_proxies`** auf die Adressen deiner Reverse Proxys (IPs oder
      CIDR-Bereiche). Erst dann liest Verdin die Client-Adresse aus `X-Forwarded-For`; ohne
      die Einstellung teilen sich alle Clients hinter dem Proxy eine Adresse für Rate Limits
      und Audit-Logs.
- [ ] **Lass sichere Cookies eingeschaltet.** Unter `verdin start` ist das Refresh-Cookie des
      Admin-Panels standardmäßig `Secure`. Lass `[admin].secure_cookies` ungesetzt; wer es in
      Produktion auf `false` setzt, bekommt beim Start eine Warnung.

## APIs

- [ ] **Gib nur frei, was die Öffentlichkeit braucht.** Die Content-API ist geschlossen, bis
      du öffentliche Berechtigungen freigibst (**Einstellungen → Öffentlicher Zugriff**) oder
      API-Tokens anlegst. Siehe [Berechtigungen](/de/concepts/permissions/).
- [ ] **Setze `[api].cors_origins`**, wenn ein Browser auf einem anderen Origin die
      Content-API oder GraphQL aufruft, zum Beispiel `["https://www.example.com"]`. Ohne die
      Einstellung können nur Seiten desselben Origins sie aus dem Browser aufrufen. Die
      Admin-API beantwortet nie Cross-Origin-Anfragen.
- [ ] **Denk über Rate Limits** für anonymen Traffic nach: `[api].public_rate_limit` und
      `[api].token_rate_limit` (Anfragen pro Minute; `0`, der Standard, ist unbegrenzt).

## Medien

- [ ] **Speichere Uploads dort, wo sie ein Redeploy überstehen.** Der lokale
      Standard-Provider schreibt auf die Festplatte: Gib ihm ein persistentes Volume, oder
      nimm den S3-Provider (AWS S3, Cloudflare R2, Backblaze B2, MinIO, Tigris…). Auf
      Plattformen mit flüchtigen Festplatten und bei mehreren Instanzen nimm S3. Siehe
      [Medien](/de/concepts/media/).

## E-Mail

- [ ] **Konfiguriere einen echten Provider.** Der Standard `[email].provider = "log"` schreibt
      E-Mails ins Log, und `verdin start` warnt davor. Einladungen, Passwort-Resets,
      Bestätigungen für Endnutzer, Erwähnungen in Kommentaren und der Digest brauchen `smtp`,
      `resend` oder `postmark` sowie ein `[email].from` mit einer Adresse, die dein Provider
      akzeptiert.

## Backups und Monitoring

- [ ] **Sichere Datenbank und Medienspeicher** nach Zeitplan, und probiere eine
      Wiederherstellung aus. Siehe [Backups](/de/deploy/backups/).
- [ ] **Richte Health Checks auf `/_ready`** und Liveness-Checks auf `/_health`.
- [ ] **Logge als JSON** (`[log].format = "json"`, der Standard des Docker-Images) und sammle
      Standard Error ein.
- [ ] **Scrape `/_metrics`**, wenn du Prometheus nutzt, mit einem `VERDIN_METRICS_TOKEN`. Siehe
      [Monitoring](/de/deploy/monitoring/).

## Vor dem Go-live

- [ ] Registriere den ersten Admin selbst, gleich nach dem ersten Start: Solange kein Admin
      existiert, kann sich jeder, der `/admin/` erreicht, als Super Admin registrieren. Du
      kannst ihn auch auf der Kommandozeile mit `verdin admin create --email …` anlegen.
- [ ] Lies das [Sicherheitsmodell](/de/deploy/security/) und schalte
      [Zwei-Faktor-Authentifizierung](/de/guides/auth/two-factor/) für Super Admins ein.
