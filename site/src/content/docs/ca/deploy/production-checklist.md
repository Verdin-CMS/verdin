---
title: Llista de comprovació per a producció
description: Què cal configurar abans que un projecte Verdin rebi trànsit real — secrets, base de dades, migracions, URL, proxies, galetes, CORS, emmagatzematge de multimèdia, correu, còpies de seguretat i monitoratge.
sidebar:
  order: 1
---

Repassa aquesta llista abans de posar un projecte Verdin davant d'usuaris reals. Cada element
enllaça amb la pàgina que l'explica. Les pàgines de plataformes ([Docker](/ca/deploy/docker/),
[Fly.io](/ca/deploy/fly/), [Render](/ca/deploy/render/), [Railway](/ca/deploy/railway/),
[Kubernetes](/ca/deploy/kubernetes/)) apliquen aquestes opcions per tu quan poden.

## Executa el servidor de producció

- [ ] **Fes servir `verdin start`, no `verdin dev`.** `dev` permet que el constructor de tipus de
      contingut reescrigui els fitxers d'esquema, aplica migracions a cada canvi i relaxa les
      regles de galetes i webhooks per al treball local. Canvia l'esquema en desenvolupament,
      confirma els fitxers i desplega'ls.
- [ ] **Aplica les migracions en desplegar.** `verdin start` es nega a executar-se mentre la base
      de dades va per darrere de l'esquema. `verdin start --migrate` aplica primer els passos
      *segurs* pendents (és l'ordre per defecte de la imatge Docker). Els passos arriscats o
      destructius (canvis de tipus, restriccions d'unicitat noves, columnes eliminades)
      necessiten `verdin migrate apply --allow risky|destructive`, que executes tu un cop.
      Consulta [Migracions d'esquema](/ca/concepts/schema-migrations/).
- [ ] **Distribueix l'esquema amb el servidor.** Munta el directori `schema/` en només lectura, o
      incorpora'l a la teva imatge, perquè el que s'executa sigui el que has confirmat.

## Secrets

- [ ] **Genera els dos secrets obligatoris un sol cop** amb `verdin secrets` i guarda'ls al
      magatzem de secrets de la teva plataforma: `VERDIN_ADMIN_JWT_SECRET` signa els tokens de
      sessió, i `VERDIN_TOKEN_PEPPER` és la clau dels hashes dels tokens d'API i d'altres
      secrets desats. `verdin start` falla si en falta algun o si fa menys de 32 bytes. Els
      secrets només es llegeixen de l'entorn, mai de `verdin.toml`.
- [ ] **Mantén-los estables.** Canviar `VERDIN_TOKEN_PEPPER` fa que tots els tokens d'API deixin
      de funcionar, i també els codis de l'app d'autenticació i els codis de recuperació dels
      administradors. Canviar `VERDIN_ADMIN_JWT_SECRET` anul·la els tokens d'accés de curta
      durada dels administradors i dels usuaris finals, els enllaços de previsualització oberts i
      els inicis de sessió OAuth en curs (el tauler d'administració i els clients amb tokens de
      renovació els renoven sols). Totes les instàncies d'un projecte necessiten els mateixos
      valors.
- [ ] Posa també a l'entorn els altres secrets que facis servir: `VERDIN_EMAIL_SMTP_PASSWORD`
      o `VERDIN_EMAIL_API_KEY`, `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`,
      `VERDIN_METRICS_TOKEN`, `VERDIN_SSO_<ID>_SECRET`, `VERDIN_IMAGE_SECRET`. La llista
      completa és a la [referència de configuració](/ca/reference/configuration/).

## Base de dades

- [ ] **Tria el motor.** PostgreSQL (14 o posterior) és l'opció habitual i la que cal triar si
      executaràs [diverses instàncies](/ca/deploy/scaling/). MySQL 8.4+ i MariaDB 10.11+
      funcionen igual. SQLite és adequat per a una sola instància amb un disc persistent.
- [ ] **Defineix `VERDIN_DATABASE_URL`**: `postgres://…`, `mysql://…` (MySQL i MariaDB) o
      `sqlite:///data/verdin.db`. Afegeix `?sslmode=require` per als servidors PostgreSQL que
      necessiten TLS.
- [ ] **Dimensiona el pool.** Cada instància obre fins a `[database].pool_max` connexions (10).
      Mantén `instances × pool_max` per sota del límit de connexions del servidor.

## URL, proxies i galetes

- [ ] **Serveix per HTTPS.** Verdin parla HTTP pla; termina el TLS en un proxy invers, un
      balancejador de càrrega o l'edge de la teva plataforma.
- [ ] **Defineix `[server].public_url`** (`VERDIN_SERVER__PUBLIC_URL`) amb l'adreça que fan
      servir els navegadors, com ara `https://cms.example.com`. Els enllaços dels correus, els
      callbacks d'SSO, el resum diari i les claus d'accés en depenen; les claus d'accés estan
      lligades al seu host.
- [ ] **Defineix `[server].trusted_proxies`** amb les adreces dels teus proxies inversos (IP o
      rangs CIDR). Només així Verdin llegeix l'adreça del client de `X-Forwarded-For`; sense
      això, tots els clients darrere del proxy comparteixen una adreça per als límits de
      freqüència i els registres d'auditoria.
- [ ] **Mantén activades les galetes segures.** A `verdin start`, la galeta de refresc de
      l'administració és `Secure` per defecte. Deixa `[admin].secure_cookies` sense definir;
      posar-la a `false` en producció registra un avís en iniciar.

## API

- [ ] **Concedeix només el que necessita el públic.** L'API de contingut està tancada fins que
      concedeixes permisos públics (**Configuració → Accés públic**) o crees tokens d'API.
      Consulta [Permisos](/ca/concepts/permissions/).
- [ ] **Defineix `[api].cors_origins`** si un navegador d'un altre origen crida l'API de
      contingut o GraphQL, per exemple `["https://www.example.com"]`. Sense això, només les
      pàgines del mateix origen les poden cridar des d'un navegador. L'API d'administració mai no
      respon peticions d'un altre origen.
- [ ] **Planteja't límits de freqüència** per al trànsit anònim: `[api].public_rate_limit` i
      `[api].token_rate_limit` (peticions per minut; `0`, el valor per defecte, vol dir sense
      límit).

## Multimèdia

- [ ] **Desa les pujades on sobrevisquin a un redesplegament.** El proveïdor local per defecte
      escriu al disc: dona-li un volum persistent, o fes servir el proveïdor S3 (AWS S3,
      Cloudflare R2, Backblaze B2, MinIO, Tigris…). A les plataformes amb discos efímers, i amb
      diverses instàncies, fes servir S3. Consulta [Multimèdia](/ca/concepts/media/).

## Correu electrònic

- [ ] **Configura un proveïdor real.** El valor per defecte `[email].provider = "log"` escriu els
      correus al registre, i `verdin start` en fa un avís. Les invitacions, els restabliments de
      contrasenya, les confirmacions d'usuaris finals, les mencions en comentaris i el resum
      necessiten `smtp`, `resend` o `postmark`, i `[email].from` amb una adreça que el teu
      proveïdor accepti.

## Còpies de seguretat i monitoratge

- [ ] **Fes còpies de seguretat de la base de dades i de l'emmagatzematge de multimèdia** de
      manera programada, i prova una restauració. Consulta [Còpies de seguretat](/ca/deploy/backups/).
- [ ] **Apunta les comprovacions de salut a `/_ready`** i les de disponibilitat a `/_health`.
- [ ] **Registra en JSON** (`[log].format = "json"`, el valor per defecte de la imatge Docker) i
      recull la sortida d'error estàndard.
- [ ] **Llegeix `/_metrics`** si fas servir Prometheus, amb un `VERDIN_METRICS_TOKEN`. Consulta
      [Monitoratge](/ca/deploy/monitoring/).

## Abans de sortir en producció

- [ ] Registra tu mateix el primer administrador just després del primer inici: fins que no hi
      hagi cap administrador, qualsevol que arribi a `/admin/` es pot registrar com a Super
      Admin. També el pots crear des de la línia d'ordres amb `verdin admin create --email …`.
- [ ] Revisa el [model de seguretat](/ca/deploy/security/) i activa
      l'[autenticació de dos factors](/ca/guides/auth/two-factor/) per als Super Admin.
