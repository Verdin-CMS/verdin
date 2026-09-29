---
title: Productiechecklist
description: Wat je instelt voordat een Verdin-project echt verkeer krijgt — geheimen, database, migraties, URL's, proxy's, cookies, CORS, mediaopslag, e-mail, back-ups en monitoring.
sidebar:
  order: 1
---

Loop deze lijst door voordat je een Verdin-project voor echte gebruikers zet. Elk punt linkt naar
de pagina die het uitlegt. De platformpagina's ([Docker](/nl/deploy/docker/),
[Fly.io](/nl/deploy/fly/), [Render](/nl/deploy/render/), [Railway](/nl/deploy/railway/),
[Kubernetes](/nl/deploy/kubernetes/)) passen deze instellingen waar mogelijk voor je toe.

## Draai de productieserver

- [ ] **Gebruik `verdin start`, niet `verdin dev`.** Met `dev` kan de contenttype-bouwer
      schemabestanden herschrijven, worden migraties bij elke wijziging toegepast en worden de
      regels voor cookies en webhooks versoepeld voor lokaal werk. Wijzig het schema in
      ontwikkeling, commit de bestanden en deploy ze.
- [ ] **Pas migraties toe bij het deployen.** `verdin start` weigert te draaien zolang de database
      achterloopt op het schema. `verdin start --migrate` past eerst de openstaande *veilige*
      stappen toe (dit is het standaardcommando van het Docker-image). Riskante of destructieve
      stappen (typewijzigingen, nieuwe uniciteitsbeperkingen, verwijderde kolommen) vereisen
      `verdin migrate apply --allow risky|destructive`, één keer door jou gedraaid. Zie
      [Schemamigraties](/nl/concepts/schema-migrations/).
- [ ] **Lever het schema mee met de server.** Mount de map `schema/` alleen-lezen, of bak hem in
      je image, zodat wat draait ook is wat je hebt gecommit.

## Geheimen

- [ ] **Genereer de twee verplichte geheimen één keer** met `verdin secrets` en bewaar ze in de
      secret store van je platform: `VERDIN_ADMIN_JWT_SECRET` ondertekent sessietokens, en
      `VERDIN_TOKEN_PEPPER` is de sleutel voor de hashes van API-tokens en andere opgeslagen
      geheimen. `verdin start` faalt als een van beide ontbreekt of korter is dan 32 bytes.
      Geheimen worden alleen uit de omgeving gelezen, nooit uit `verdin.toml`.
- [ ] **Houd ze stabiel.** Als je `VERDIN_TOKEN_PEPPER` wijzigt, werkt geen enkel API-token meer,
      en ook de codes van de authenticator-apps en de herstelcodes van beheerders niet. Als je
      `VERDIN_ADMIN_JWT_SECRET` wijzigt, worden de kortlevende access tokens van beheerders en
      eindgebruikers ongeldig, net als open voorbeeldlinks en OAuth-logins die nog bezig zijn
      (het beheerpaneel en clients met refresh tokens vernieuwen ze zelf). Elke instantie van
      een project heeft dezelfde waarden nodig.
- [ ] Zet de andere geheimen die je gebruikt ook in de omgeving: `VERDIN_EMAIL_SMTP_PASSWORD` of
      `VERDIN_EMAIL_API_KEY`, `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`,
      `VERDIN_METRICS_TOKEN`, `VERDIN_SSO_<ID>_SECRET`, `VERDIN_IMAGE_SECRET`. De volledige lijst
      staat in de [configuratiereferentie](/nl/reference/configuration/).

## Database

- [ ] **Kies de engine.** PostgreSQL (14 of later) is de gebruikelijke keuze, en de keuze als je
      [meerdere instanties](/nl/deploy/scaling/) gaat draaien. MySQL 8.4+ en MariaDB 10.11+ werken
      op dezelfde manier. SQLite past bij één instantie met een persistente schijf.
- [ ] **Stel `VERDIN_DATABASE_URL` in**: `postgres://…`, `mysql://…` (MySQL en MariaDB) of
      `sqlite:///data/verdin.db`. Voeg `?sslmode=require` toe voor PostgreSQL-servers die TLS
      vereisen.
- [ ] **Dimensioneer de pool.** Elke instantie opent tot `[database].pool_max` verbindingen (10).
      Houd `instances × pool_max` onder de verbindingslimiet van de server.

## URL's, proxy's en cookies

- [ ] **Serveer via HTTPS.** Verdin spreekt gewoon HTTP; laat TLS afhandelen door een reverse
      proxy, load balancer of de edge van je platform.
- [ ] **Stel `[server].public_url` in** (`VERDIN_SERVER__PUBLIC_URL`) op het adres dat browsers
      gebruiken, zoals `https://cms.example.com`. Links in e-mails, SSO-callbacks, de dagelijkse
      samenvatting en toegangssleutels zijn ervan afhankelijk; toegangssleutels zijn aan de host
      ervan gebonden.
- [ ] **Stel `[server].trusted_proxies` in** op de adressen van je reverse proxy's (IP's of
      CIDR-bereiken). Alleen dan leest Verdin het clientadres uit `X-Forwarded-For`; zonder
      deze instelling delen alle clients achter de proxy één adres voor rate limits en
      auditlogs.
- [ ] **Laat secure cookies aan.** In `verdin start` is de refresh-cookie van het beheerpaneel
      standaard `Secure`. Laat `[admin].secure_cookies` niet ingesteld; als je hem in productie op
      `false` zet, wordt bij het starten een waarschuwing gelogd.

## API's

- [ ] **Verleen alleen wat het publiek nodig heeft.** De content-API is dicht totdat je openbare
      rechten verleent (**Instellingen → Openbare toegang**) of API-tokens aanmaakt. Zie
      [Rechten](/nl/concepts/permissions/).
- [ ] **Stel `[api].cors_origins` in** als een browser op een andere origin de content-API of
      GraphQL aanroept, bijvoorbeeld `["https://www.example.com"]`. Zonder deze instelling kunnen
      alleen pagina's op dezelfde origin ze vanuit een browser aanroepen. De admin-API
      beantwoordt nooit cross-origin requests.
- [ ] **Overweeg rate limits** voor anoniem verkeer: `[api].public_rate_limit` en
      `[api].token_rate_limit` (requests per minuut; `0`, de standaard, is onbeperkt).

## Media

- [ ] **Sla uploads op waar ze een nieuwe deploy overleven.** De standaard lokale provider schrijft
      naar schijf: geef hem een persistent volume, of gebruik de S3-provider (AWS S3, Cloudflare
      R2, Backblaze B2, MinIO, Tigris…). Gebruik S3 op platforms met vluchtige schijven, en bij
      meerdere instanties. Zie [Media](/nl/concepts/media/).

## E-mail

- [ ] **Configureer een echte provider.** De standaard `[email].provider = "log"` schrijft e-mails
      naar het log, en `verdin start` waarschuwt daarvoor. Uitnodigingen, wachtwoordherstel,
      bevestigingen van eindgebruikers, vermeldingen in opmerkingen en de samenvatting hebben
      `smtp`, `resend` of `postmark` nodig, en `[email].from` ingesteld op een adres dat je
      provider accepteert.

## Back-ups en monitoring

- [ ] **Maak volgens een schema back-ups van de database en de mediaopslag**, en probeer een
      herstel. Zie [Back-ups](/nl/deploy/backups/).
- [ ] **Richt healthchecks op `/_ready`** en liveness-checks op `/_health`.
- [ ] **Log als JSON** (`[log].format = "json"`, de standaard van het Docker-image) en verzamel
      standard error.
- [ ] **Scrape `/_metrics`** als je Prometheus gebruikt, met een `VERDIN_METRICS_TOKEN`. Zie
      [Monitoring](/nl/deploy/monitoring/).

## Voordat je live gaat

- [ ] Registreer de eerste beheerder zelf, direct na de eerste start: zolang er geen beheerder
      bestaat, kan iedereen die `/admin/` bereikt zich als Super Admin registreren. Je kunt hem ook
      vanaf de opdrachtregel aanmaken met `verdin admin create --email …`.
- [ ] Bekijk het [beveiligingsmodel](/nl/deploy/security/) en zet
      [tweefactorauthenticatie](/nl/guides/auth/two-factor/) aan voor Super Admins.
