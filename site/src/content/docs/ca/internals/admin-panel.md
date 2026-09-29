---
title: Tauler d'administració
description: Com s'estructura el tauler d'administració Angular de Verdin, com construeix formularis i llistes a partir de l'esquema, i com es compila, s'incrusta al binari i es tradueix.
sidebar:
  order: 6
  label: Tauler d'administració
---

Aquesta pàgina és per a qui contribueix al tauler d'administració a `admin/`: com s'organitza
l'aplicació Angular, com converteix l'esquema de contingut en formularis i llistes, i com acaba dins
del binari `verdin`. Com fer servir el tauler s'explica a les guies; com funciona la part del
servidor de l'API d'administració és a la [referència de l'API d'administració](/ca/api/admin/).

El tauler és una aplicació d'una sola pàgina en Angular 22: components standalone, detecció de
canvis sense zones, signals, rutes carregades de manera diferida i components de spartan/ui sobre
Tailwind CSS v4.

## Estructura

```text
admin/
├── src/app/
│   ├── app.config.ts     # providers: router, HttpClient interceptors, Transloco, icons
│   ├── app.routes.ts     # lazy routes, guards (auth, permissions, unsaved changes)
│   ├── core/             # services and pure models: api, auth, schema, i18n, permissions…
│   ├── layout/           # the shell (sidebar, header), home, deploy button
│   ├── features/
│   │   ├── auth/         # login, first admin, invitations, password reset
│   │   ├── dashboard/    # home widgets
│   │   ├── content/      # lists, the entry editor, history, releases, review, import
│   │   │   ├── fields/   # schema-driven form controls and the form model
│   │   │   └── collab/   # comments and tasks
│   │   ├── builder/      # content-type builder (verdin dev only)
│   │   ├── media/        # media library
│   │   ├── releases/
│   │   ├── profile/      # own account, two-factor, passkeys, sessions
│   │   └── settings/     # users, roles, tokens, webhooks, locales, plugins, site features…
│   └── shared/
│       ├── ui/           # spartan helm components, owned by the project
│       └── components/   # app-level shared components (confirm dialog, page header…)
├── public/i18n/          # translation catalogs, one JSON file per language
├── scripts/check-i18n.mjs
└── e2e/                  # Playwright tests and the server they run against
```

**L'estat** viu en signals dins de serveis injectables a `core/` (`Auth`, `Schema`, `I18n`,
`Theme`…). No hi ha cap biblioteca de store.

**L'accés a l'API** passa per `core/api.ts`, un petit embolcall basat en promeses sobre l'`HttpClient`
d'Angular, amb tipus escrits a mà a `core/types.ts`. La configuració en temps d'execució (camí de
l'administració, prefix de l'API, mode, marca) prové d'una etiqueta `<meta name="verdin-config">` que
injecta el servidor.

**Sessió.** El token d'accés només viu a la memòria; el token de refresc és una galeta `HttpOnly`
limitada a les rutes d'autenticació. Un interceptor HTTP afegeix el token bearer i, davant d'un
`401`, refresca un cop i torna a provar; si el refresc falla, envia l'usuari a la pàgina d'inici de
sessió. Les peticions de refresc i de tancament de sessió porten la capçalera `X-Verdin-CSRF` que
exigeix el servidor. Els guards restauren la sessió a partir de la galeta en carregar la pàgina. Un
`403` que diu que el rol requereix autenticació de dos factors envia l'usuari a configurar-la.

## Formularis basats en l'esquema

L'editor d'entrades (`features/content/edit.ts`) no té codi específic per tipus. Llegeix els tipus
de contingut i els components de `GET /admin/api/content-types` i `GET /admin/api/components`, i la
disposició de l'editor de la configuració de la vista d'edició, i construeix el formulari en temps
d'execució amb **Signal Forms** (`@angular/forms/signals`):

- El model del document és un signal d'un objecte simple (`FormModel` a `fields/model.ts`); l'arbre
  de camps i els seus validadors es deriven de l'esquema.
- Un component recursiu `vd-fields` (`fields/fields.ts`) mostra qualsevol mapa d'atributs contra un
  arbre de camps. El text, les dates i les hores fan servir camps d'entrada natius enllaçats amb
  `[formField]`. Uns `FormValueControl` personalitzats gestionen els nombres (admeten nul; els
  enters grans es mantenen com a cadenes), els interruptors, les enumeracions, les dates i hores
  (hora local al camp, UTC al model), el JSON, el Markdown, els `blocks` (TipTap), la multimèdia, les
  relacions (selector amb cerca mentre escrius i ordenació) i les relacions polimòrfiques.
- Els components són fieldsets imbricats; els components repetibles i les zones dinàmiques són
  llistes reordenables. Els connectors poden registrar tipus de camp personalitzats, que es mostren
  com a elements personalitzats.
- `toModel` converteix un document poblat en el model del formulari (les relacions es converteixen
  en `documentId`, els fitxers en ids), i `toPayload` fa la conversió inversa cap a la càrrega
  `data`: les cadenes buides es converteixen en `null`, i les claus de renderització (`__key`) i els
  costats de només lectura (`mappedBy`, `morphOne`, `morphMany`) es descarten. Tots dos tenen proves
  unitàries a `fields/model.spec.ts`.
- La validació derivada de l'esquema dona una resposta immediata. Els camps condicionals
  (`conditions.visible`) s'avaluen al navegador amb un port de l'avaluador de JSON Logic del
  servidor (`core/logic.ts`). Les regles de validació entre camps només les comprova el servidor. El
  servidor continua sent l'autoritat: les entrades `details.errors[].path` es tornen a associar al
  camp corresponent.
- Desar és explícit, amb seguiment de canvis i un avís en sortir de la pàgina (un guard de ruta més
  `beforeunload`). Els botons **Publica**, **Despublica** i **Descarta els canvis** apareixen
  segons l'estat del document. L'administració només desa esborranys; publicar és sempre una acció
  separada.

La disposició de l'editor (ordre dels camps, amplades, etiquetes, descripcions, camps de només
lectura, el camp que dona nom a les entrades relacionades) és compartida per tots els administradors
i es desa al servidor a `vd_settings`; es canvia des de la pàgina **Configura la vista** amb el
permís `views.manage`.

## Llistes

Les llistes de contingut (`features/content/list.ts`) fan servir la taula de spartan helm amb
paginació, ordenació i filtres al servidor. Els filtres, la cerca (`_q`) i la pàgina es reflecteixen a
l'URL, de manera que una llista filtrada és un enllaç que es pot compartir. Cada administrador tria
les columnes visibles, l'ordenació per defecte i la mida de pàgina per tipus (`list-view.ts`); aquestes
tries es desen a les seves pròpies preferències al servidor, de manera que el segueixen entre
navegadors. Les llistes també s'actualitzen en directe a partir del flux d'esdeveniments de
l'administració.

## Constructor de tipus de contingut

El **Constructor de tipus de contingut** només és visible quan el servidor s'executa en mode de
desenvolupament (`verdin dev`) i l'administrador té `schema.manage`. Edita els tipus de contingut i
els components en el seu format de fitxer: camps, tipus i destinacions de relacions (creant l'atribut
invers a la destinació), components, zones dinàmiques, longituds, intervals i els indicadors
`required`, `unique` i `private`.

Cada canvi s'envia primer a `POST /admin/api/schema/plan`, que valida l'esquema resultant i retorna
els passos de migració amb el seu risc, el seu SQL i els suggeriments de canvi de nom que l'usuari
pot acceptar. Confirmar crida `POST /admin/api/schema/apply` amb el nivell de risc i els canvis de
nom acceptats. El servidor migra, escriu `schema/*.json` i substitueix l'aplicació en execució per la
de l'esquema nou sense reiniciar. Consulta el [motor de migracions](/ca/internals/migrations/) per
saber què passa al servidor.

## Compilació i distribució

- `ng build` escriu la compilació de producció a `admin/dist/admin/browser`, amb
  `<base href="/admin/">`.
- El servidor incrusta aquesta carpeta amb `rust-embed` quan es compila amb la funcionalitat
  `embed-admin`, que fan servir les compilacions de versió i la imatge Docker. Sense aquesta
  funcionalitat, o quan `[admin].assets_dir` està definit, serveix els fitxers des del disc.
  `assets_dir` té prioritat sobre la compilació incrustada.
- El servidor reescriu `<base href>` amb `[admin].path` i injecta la configuració en temps
  d'execució com una etiqueta `<meta>`, no com un script en línia. Canviar `admin.path` mai no
  requereix tornar a compilar el tauler.
- Els camins desconeguts sense extensió de fitxer tornen a `index.html` per a l'encaminament al
  client. Els paquets amb empremta (`main-ABC123.js`) es desen a la memòria cau com a `immutable`
  durant un any; tota la resta és `no-cache`.
- Cada resposta de l'administració porta una Content Security Policy estricta
  (`script-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`…), `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff` i `Referrer-Policy: strict-origin-when-cross-origin`. La
  inserció en línia del CSS crític d'Angular està desactivada a `angular.json` perquè depèn de
  gestors d'esdeveniments en línia que la política prohibeix.

Per treballar en el frontend, executa el servidor i després `npm start` a `admin/`: `ng serve` fa de
proxy de `/admin/api` i `/api` cap a `http://localhost:1337` (`admin/proxy.conf.json`).

## Traduccions

El tauler es tradueix en temps d'execució amb Transloco, no amb l'i18n en temps de compilació
d'Angular, de manera que una sola compilació serveix totes les llengües i els usuaris poden canviar
de llengua sense recarregar.

- Els catàlegs són fitxers JSON plans a `admin/public/i18n/` (`en.json` és l'origen), que es
  carreguen sota demanda.
- Els missatges fan servir ICU MessageFormat (`{name}`, `{count, plural, one {# entry} other {# entries}}`),
  interpretat per FormatJS (`intl-messageformat`) mitjançant un transpilador personalitzat de
  Transloco. FormatJS interpreta els missatges en lloc de compilar-los en funcions, de manera que la
  CSP no necessita `unsafe-eval`.
- Les claus dels missatges es tipen a partir d'`en.json` (`core/i18n/keys.ts`): fer servir una clau
  que no existeix és un error de compilació.
- `npm run i18n:check` comprova cada catàleg contra `en.json`: les mateixes claus, sintaxi ICU
  vàlida, els mateixos arguments i totes les categories de plural de la llengua. La CI l'executa.
- El servei `I18n` també proporciona format segons la configuració regional i el primer dia de la
  setmana, obtinguts de la configuració regional del navegador amb la possibilitat que cada usuari
  els canviï.

Com afegir o actualitzar una llengua s'explica a [traduir](/ca/project/translating/).
