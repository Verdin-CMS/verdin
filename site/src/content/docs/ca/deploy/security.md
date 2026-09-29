---
title: Seguretat
description: Com protegeix Verdin el tauler d'administració, l'API de contingut i el servidor, quines opcions reforcen una instància de producció i com informar d'una vulnerabilitat.
sidebar:
  order: 2
---

Aquesta pàgina descriu què fa Verdin per protegir un projecte i quines opcions controles tu.
Fes-la servir juntament amb la [llista de comprovació per a producció](/ca/deploy/production-checklist/)
quan preparis una instància per a trànsit real.

## Què està tancat per defecte

- **L'API de contingut.** Les peticions anònimes no reben res fins que concedeixes permisos
  públics a **Configuració → Accés públic**. Un token desconegut, caducat o mal format és un
  `401`, mai no torna al rol públic. Consulta [Permisos](/ca/concepts/permissions/).
- **El document OpenAPI** a `/api/_openapi.json` necessita un token d'API vàlid fins que el fas
  públic a **Configuració → Funcionalitats → Documentació de l’API**.
- **Les funcionalitats opcionals** com GraphQL, els usuaris finals, l'SSO i el servidor MCP es
  queden desactivades fins que un administrador amb el permís `features.manage` les activa a
  **Configuració → Funcionalitats**.
- **Els connectors** es queden desactivats fins que un administrador els activa un per un a
  **Configuració → Connectors**.
- **Les crides del navegador des d'altres orígens.** Cap origen no pot cridar cap API des d'un
  navegador fins que el llistes a `[api].cors_origins`.

## Inici de sessió d'administració

| Protecció | Detalls |
| --- | --- |
| Hash de contrasenyes | Argon2id amb els paràmetres d'OWASP, que es torna a calcular quan canvien. |
| Sessions | Un token d'accés de 15 minuts guardat a la memòria de la pàgina (mai a `localStorage`), i un token de refresc de 30 dies en una galeta `HttpOnly`, `SameSite=Strict` limitada a `/admin/api/auth`. El token de refresc es renova a cada ús; presentar-ne un d'antic tanca tota la sessió. |
| Galetes segures | La galeta de refresc és `Secure` a `verdin start`. `[admin].secure_cookies = false` ho desactiva i registra un avís. |
| CSRF | El refresc i el tancament de sessió necessiten una capçalera `X-Verdin-CSRF`, que un formulari d'un altre lloc no pot enviar. |
| Bloqueig | Cinc intents fallits bloquegen un compte durant 15 minuts. Els errors es compten entre els passos de contrasenya i de segon factor. Els correus desconeguts i les contrasenyes incorrectes reben la mateixa resposta, en el mateix temps. |
| Límit de freqüència | Inici de sessió, registre i refresc: `[admin].auth_rate_limit` peticions per minut i adreça de client (20). |
| Segon factor | Apps d'autenticació (TOTP) i claus d'accés, amb codis de recuperació. Un rol el pot exigir (`requireTwoFactor`). Consulta [Autenticació de dos factors](/ca/guides/auth/two-factor/). |
| Super Admin | Només un Super Admin pot crear, editar, eliminar o restablir un Super Admin, o concedir aquest rol. L'últim Super Admin actiu no es pot eliminar. |

El primer administrador es registra a través del tauler mentre no n'hi ha cap. Fes-ho just
després del primer inici, o crea'l amb `verdin admin create --email …` abans d'exposar el
servidor.

## Tauler d'administració i API d'administració

- L'API d'administració (`/admin/api`) no envia capçaleres CORS, digui el que digui
  `[api].cors_origins`: els navegadors només deixen que l'origen del mateix tauler en llegeixi
  les respostes.
- El tauler se serveix amb una Content Security Policy estricta (scripts només del seu propi
  origen), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` i
  `Referrer-Policy: strict-origin-when-cross-origin`.
- Verdin no envia `Strict-Transport-Security`. Afegeix-la al proxy invers que termina el TLS.

## API de contingut

- **Els tokens d'API** es mostren un sol cop. Verdin desa un HMAC-SHA256 de cada token, amb
  `VERDIN_TOKEN_PEPPER` com a clau, i en conserva un prefix de 10 caràcters per mostrar-lo. Els
  tokens poden caducar i es poden regenerar.
- **Els permisos per camp i per idioma** limiten el que llegeix i escriu un rol, i `populate`,
  els filtres de relació i les ordenacions per relació només arriben als tipus que el client pot
  llegir.
- **Límits de consulta**: `pageSize` fins a `[api].max_page_size` (100), profunditat de
  `populate` fins a 5, com a màxim 100 condicions de filtre, cadenes de consulta de fins a 16 KB
  i com a màxim 1.000 entrades poblades per relació. Els camps desconeguts o privats en una
  consulta són un `400`.
- **GraphQL** té els seus propis límits de profunditat i complexitat (`maxDepth`,
  `maxComplexity`) i un interruptor d'introspecció a la configuració de la funcionalitat.
- **Límits de freqüència**: `[api].public_rate_limit` per adreça de client sense token i
  `[api].token_rate_limit` per token d'API o usuari final, en peticions per minut. Tots dos estan
  desactivats (`0`) per defecte. Les peticions amb un token bearer desconegut es limiten per
  adreça.

### CORS

`[api].cors_origins` llista els orígens de navegador que poden cridar l'API de contingut i
GraphQL:

```toml title="verdin.toml"
[api]
cors_origins = ["https://www.example.com", "https://preview.example.com"]
```

Cada entrada és `scheme://host[:port]` sense camí ni barra final; `["*"]` permet qualsevol origen
i no es pot combinar amb d'altres. Els mètodes permesos són `GET`, `POST`, `PUT` i `DELETE`, i
les capçaleres de petició permeses, `Authorization`, `Content-Type` i `If-None-Match`. L'inici
falla amb una entrada que no sigui un origen.

Els frontends del costat del servidor (Astro, Next.js al servidor) criden l'API sense navegador i
no necessiten cap entrada CORS.

## Peticions i pujades

| Opció | Per defecte | Protegeix contra |
| --- | --- | --- |
| `[server].body_limit` | `"1mb"` | Cossos de petició grans a les API normals. |
| `[server].request_timeout_secs` | `30` | Peticions lentes que retenen connexions. |
| `[upload].max_file_size` | 200 MB | Pujades grans (les pujades tenen el seu propi límit en lloc de `body_limit`). |
| `[upload].max_image_megapixels` | `100` | Bombes de descompressió. |

El tipus d'un fitxer pujat surt dels seus bytes, no del tipus que envia el client; el nom del
fitxer només és un últim recurs, i mai per als tipus que els navegadors executen activament
(aquests fitxers es desen com a `application/octet-stream`). Els enllaços del text enriquit
`blocks` han de ser `http(s)`, `mailto:` o relatius.

## Adreces dels clients darrere d'un proxy

Els límits de freqüència i els registres d'auditoria fan servir l'adreça del client. Darrere d'un
proxy invers, totes les peticions vénen del proxy, així que indica el proxy a
`[server].trusted_proxies`:

```toml title="verdin.toml"
[server]
trusted_proxies = ["10.0.0.0/8"]   # the proxies' IPs or CIDR ranges
```

Aleshores Verdin llegeix `X-Forwarded-For` de dreta a esquerra i agafa la primera adreça que no
és un proxy de confiança. Les peticions de qualsevol altra adreça conserven la seva adreça de
connexió, de manera que un client no pot falsificar la seva adreça enviant ell mateix la
capçalera. No hi incloguis rangs des dels quals es puguin connectar clients que no són de
confiança.

## Peticions sortints

Els webhooks, els hooks de desplegament, els webhooks de purga de CDN i les pujades des d'una URL
fan peticions que tria un administrador. A `verdin start` rebutgen les adreces de loopback,
privades i d'enllaç local (incloses les formes IPv6 que contenen adreces IPv4 privades), de manera
que un administrador no les pot fer servir per arribar a serveis de la teva xarxa interna.
`[webhooks].allow_private_networks = true` treu aquesta restricció; fes-ho només quan tots els
administradors siguin de confiança respecte a la xarxa interna.

## Secrets

`VERDIN_ADMIN_JWT_SECRET` i `VERDIN_TOKEN_PEPPER` només es llegeixen de l'entorn i cadascun ha de
tenir com a mínim 32 bytes (`verdin secrets` n'imprimeix de nous). El pepper també segella els
secrets TOTP dels administradors i en deriva la clau que fa el hash de les adreces de qui envia
formularis. Guarda'ls tots dos al gestor de secrets de la teva plataforma i no confirmis mai
`.env`.

Els registres de peticions amaguen els valors dels paràmetres de consulta amb noms que semblen
secrets (`token`, `code`, `password`, `key`, `signature`…) i la part secreta de les URL de
callback de desplegament.

## Mètriques

`/_metrics` està desactivat tret que `[metrics].enabled = true`. Quan està activat i no hi ha cap
token definit, qualsevol que arribi al port el pot llegir. Defineix `VERDIN_METRICS_TOKEN` (o
`[metrics].token`) i llegeix-lo amb `Authorization: Bearer <token>`, o bloqueja el camí al proxy.
Consulta [Monitoratge](/ca/deploy/monitoring/).

## Connectors

Els connectors són mòduls WebAssembly que Extism executa en un sandbox. Un mòdul no té sistema de
fitxers, xarxa ni base de dades propis: tot passa per funcions de l'amfitrió limitades per les
capacitats del seu `plugin.toml` (tipus de contingut que llegeix o escriu, hosts HTTP, el seu
propi magatzem clau-valor), amb un límit de temps i de memòria per crida (`[limits]`, 5 s i 64 MB
al manifest d'exemple). Els administradors veuen què demana un connector abans d'activar-lo. Els
scripts d'administració dels connectors s'executen a la pàgina del tauler, així que instal·la
només connectors en què confiïs. Consulta [Connectors](/ca/extending/plugins/).

## Exportacions i còpies de seguretat

Els arxius de `verdin export` contenen camps privats i hashes de contrasenyes. Guarda'ls com els
bolcats de la base de dades. Consulta [Còpies de seguretat](/ca/deploy/backups/).

## Informar d'una vulnerabilitat

No obris una incidència pública per a un problema de seguretat. Segueix la
[política de seguretat](https://github.com/Verdin-CMS/verdin/blob/main/SECURITY.md) del
repositori: informa'n en privat a través de la pestanya **Security** del
[repositori](https://github.com/Verdin-CMS/verdin/security) (**Report a vulnerability**), amb la
versió, els passos per reproduir-lo i l'impacte que hi veus. Les correccions de seguretat es
llisten a **Security** al [registre de canvis](/ca/project/changelog/).
