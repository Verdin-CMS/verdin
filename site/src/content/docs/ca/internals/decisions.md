---
title: Registre de decisions
description: Les decisions de disseny que hi ha darrere de Verdin, numerades en l'ordre en què es van prendre, amb el resultat i el motiu de cadascuna.
sidebar:
  order: 8
---

Aquest registre recull les decisions de disseny que han donat forma a Verdin, en l'ordre en què es
van prendre, perquè puguis veure per què el codi és com és abans de proposar canviar-lo. Les
entrades es conserven tal com es van escriure, noms de fites inclosos (M2–M4 són les fites
anteriors a les primeres versions); una entrada posterior pot matisar-ne una d'anterior, com fa la
28 amb la 1. Afegeix una fila nova quan prenguis una decisió que, si no, algú hauria de deduir a
partir del codi.

| # | Decisió | Resultat | Motiu |
|---|---|---|---|
| 1 | Components: JSON o taules | **Columna JSON** ([emmagatzematge](/ca/internals/storage/#components-i-zones-dinàmiques-una-columna-json)) | Menys joins, publicació i versionat trivials, migracions més simples. Filtrar per components repetibles és poc habitual; es pot afegir més endavant amb funcions JSON |
| 2 | Codificació JSON de `decimal` | **number** per defecte, `api.decimal_as_string` opcional | La compatibilitat amb Strapi maximitza l'adopció; els valors exactes estan disponibles quan calen |
| 3 | Formularis de l'administració | **Signal Forms** | Encaixa amb una administració basada en signals i sense zones; arbres de formulari dinàmics derivats de l'esquema |
| 4 | Llengua | **Anglès** per al codi, la documentació i els commits | Abast del codi obert |
| 5 | Compatibilitat REST amb Strapi | **Mateixos paràmetres i forma de resposta**; extensions pròpies de Verdin sota `actions/` | Els frontends migren amb canvis mínims |
| 6 | Algorisme del JWT d'administració | HS256 | Un sol secret, simple; EdDSA si mai apareixen verificadors externs |
| 7 | IDs de document | ULID (26 caràcters) | Ordenables i portables; els ids propis de Strapi són cadenes opaques de 24 caràcters que els clients mai no analitzen |
| 8 | Contingut de la instantània | Model físic, no esquema | Les versions posteriors poden derivar taules noves a partir d'un esquema sense canvis |
| 9 | Nul·labilitat dels atributs | Sempre admeten nuls; `required` es comprova en publicar | Els esborranys poden estar incomplets (comportament de Strapi v5); afegir camps obligatoris és segur |
| 10 | Aplicació de `unique` | Índex únic sobre `(column, locale, publication_state)` | Sense condicions de carrera; els esborranys i la seva versió publicada comparteixen valors |
| 11 | Nom de la columna d'estat | `publication_state` | `state` és un nom d'atribut habitual |
| 12 | Paraules reservades d'SQL | Sempre posar els identificadors entre cometes | Sense cap llista arbitrària de noms d'atribut prohibits |
| 13 | Construcció de DML | Constructor propi en lloc de `sea-query` | Dominen els detalls de cada dialecte (NULL tipats, col·lacions, formats de SQLite); una abstracció menys |
| 14 | Escriptures sense `?status=draft` | Publicar (comportament REST de Strapi v5) | Compatibilitat directa per als clients existents |
| 15 | Comparació de text | Exacta per defecte a tots els motors; operadors `…i` per no distingir majúscules | Mateixos resultats a MySQL que a PostgreSQL |
| 16 | Control d'accés temporal (M2–M3) | Interruptor `[api].open_access`, eliminat a M4 | Segur per defecte fins que hi hagués permisos |
| 17 | «La destinació pertany a un document» | Es fa complir movent la destinació, per estat | Un índex únic impediria que un esborrany i la seva versió publicada compartissin una destinació |
| 18 | Costats inversos (`mappedBy`) | Només lectura | Escriure-hi és ambigu amb esborrany i publicació (quina versió del propietari?) |
| 19 | Posicions dels enllaços | Renumerades 1..n a cada escriptura | Sense esgotament de coma flotant; les llistes són petites |
| 20 | Files de les taules d'enllaç | Mantenir una clau primària `id` | Taules uniformes per al motor de migracions i les reconstruccions de SQLite |
| 21 | Biblioteca JWT | HS256 propi (HMAC-SHA256, verificació en temps constant, `alg` fixat) | `jsonwebtoken` 11 necessita un backend criptogràfic que arrossega RSA |
| 22 | Taules de la plataforma | Derivades amb el model de contingut | Un sol mecanisme de migració per a tot |
| 23 | Reutilització del token de refresc | Revocar tota la família, sense marge de gràcia | Simple i estricte; l'administrador torna a iniciar la sessió |
| 24 | Esborranys a l'API de contingut | Permís `readDrafts` separat | Els tokens que llegeixen contingut publicat no filtren esborranys |
| 25 | Ordre d'aplicació del constructor | Migrar, després escriure els fitxers, després substituir l'aplicació en calent | Una migració fallida deixa intactes els fitxers i l'aplicació en execució |
| 26 | Escriptures de l'administració | Només desar esborranys; publicar és una acció explícita | Coincideix amb el que esperen els editors; l'API de contingut manté la publicació per defecte de Strapi |
| 27 | Configuració en temps d'execució de l'administració | Etiqueta `<meta>`, no script en línia | Manté la CSP lliure de scripts `unsafe-inline` |
| 28 | Filtres sobre camps de components | Operadors de camí JSON per dialecte (`#>>`, `JSON_VALUE`, `json_extract`); `EXISTS` sobre els elements dels arrays per als components repetibles i les zones dinàmiques (0.8) | Zones dinàmiques només per `__component`: els seus elements tenen camps diferents |
| 29 | i18n de l'administració | Transloco amb catàlegs JSON plans (`admin/public/i18n`) i ICU MessageFormat mitjançant FormatJS (un transpilador personalitzat), darrere d'una petita façana `I18n`; no l'i18n en temps de compilació d'Angular | Canvi de llengua en temps d'execució; fitxers estàndard per a Weblate/Crowdin; FormatJS interpreta els missatges, de manera que la CSP estricta no necessita `unsafe-eval` (`@messageformat/core` compila amb `new Function`); claus tipades a partir d'`en.json`, completesa comprovada per `npm run i18n:check` |
| 30 | Inici de la setmana | `Intl.Locale#getWeekInfo` de l'etiqueta regional del navegador (en-GB ≠ en-US), taula de regions de reserva, possibilitat de canvi per usuari | Segueix la regió de cada usuari fins i tot quan la llengua de la interfície és compartida |
| 31 | Emmagatzematge de la disposició del tauler d'inici | Columna JSON `preferences` per usuari a `vd_admin_users` (≤ 64 KiB) | Segueix l'usuari entre navegadors; el tema i la llengua es queden a `localStorage` perquè s'apliquen abans de l'inici de sessió |
| 32 | `Secure` per defecte a la galeta de refresc | Activat a `start`, desactivat a `dev`, configurable | `verdin dev` per HTTP pla funciona a tots els navegadors; la producció es manté estricta |
| 33 | Perfil de release | Thin LTO, 1 unitat de codegen, sense símbols; es manté l'unwinding | Un gestor que fa pànic no ha de fer caure el servidor |
| 34 | Documents «no vistos» | Files `vd_document_views` per usuari, eliminades per a tothom excepte l'editor quan canvia un document; filtrades amb `NOT EXISTS` a l'SQL | La paginació i els recomptes es mantenen exactes; no cal comparar marques de temps per fila |
| 35 | Vots i enquestes | Taules de col·laboració només per a l'administració (`vd_document_votes`, `vd_polls`, `vd_poll_votes`), qualsevol tipus de contingut | Bústies de suggeriments i decisions d'equip sense modelar camps de vot a cada esquema |
| 36 | Emmagatzematge de multimèdia | `object_store` per a local i S3 | Un sol camí de codi; pujades multipart en streaming; RustFS a l'entorn de desenvolupament i a la CI |
| 37 | Enllaços de multimèdia | Taules d'enllaç per camp com les relacions | Mateixa semàntica d'esborrany i publicació que les relacions; les cascades mantenen els enllaços coherents |
| 38 | Actualitzacions dels permisos integrats | Marcador de versió a `vd_settings`, addicions aplicades un sol cop | Les instal·lacions existents guanyen permisos nous sense desfer les edicions posteriors d'un administrador |
| 39 | Funcionalitats en temps d'execució | Catàleg a `verdin-api`, interruptors a `vd_settings` (`features`), l'aplicació reconstruïda in situ (ArcSwap) en tots els modes | Interruptors de connectors a l'estil de Strapi sense reinicis; les funcionalitats no disponibles es llisten amb la versió prevista |
| 40 | Interfície de referència de l'API | Scalar (`scalar_api_reference`, paquet incrustat) a `{api}/docs`, només quan el document és públic; la CSP permet el seu arrencada en línia per hash | Autoallotjat (sense CDN, fonts, agent d'IA ni telemetria); el document continua sent només per a tokens per defecte |
| 41 | GraphQL | Esquema dinàmic d'`async-graphql` construït amb l'aplicació; els arguments i les seleccions es tradueixen a l'arbre de paràmetres REST i els analitza el mateix analitzador de consultes | Un sol conjunt de regles per a filtres, paginació, populate, validació i permisos entre REST i GraphQL; el populate derivat de la selecció manté la càrrega agrupada |
| 42 | Esdeveniments de document | Escoltadors al Document Service, cridats després del commit | Els efectes secundaris (marques de vist, futurs webhooks) s'apliquen a totes les API sense hooks per gestor |
