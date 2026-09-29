---
title: Què és Verdin
description: Verdin és un CMS headless de codi obert escrit en Rust, amb API de contingut compatibles amb Strapi v5 i un tauler d'administració en un sol binari.
sidebar:
  order: 1
  label: Introducció
---

Verdin és un CMS headless de codi obert escrit en Rust. Tu modeles els tipus de contingut, els teus
editors redacten i publiquen en un tauler d'administració, i els teus llocs i aplicacions llegeixen
el contingut a través d'una API REST o GraphQL. Verdin no renderitza pàgines: d'això se n'encarrega
el teu frontend.

És una reescriptura de [Strapi v5](https://strapi.io): el format de l'esquema i l'API de contingut
tenen la mateixa forma, de manera que un projecte de Strapi i el seu frontend es poden traslladar
amb pocs canvis.

## Per a qui és

- **Desenvolupadors que construeixen un lloc o una aplicació** i volen un CMS que puguin executar
  com un sol procés, amb el model de contingut a git, i que puguin llegir des de qualsevol
  frontend: Astro, Next.js, una aplicació mòbil.
- **Equips que fan servir Strapi** i volen la mateixa API amb un consum de recursos més petit, o
  necessiten funcionalitats que Strapi reserva als plans de pagament. Verdin no té edició
  enterprise: SSO, registres d'auditoria, fluxos de revisió i llançaments formen part del projecte
  de codi obert.
- **Editors**, que tenen esborranys, publicació, historial i previsualitzacions en un tauler
  d'administració disponible en 18 llengües.

## Què inclou

Un sol executable, `verdin`, és el servidor, l'eina de línia d'ordres i el tauler d'administració.
No hi ha cap entorn Node.js ni cap `node_modules` en producció.

| Àrea | Què hi tens |
| --- | --- |
| Bases de dades | PostgreSQL 14+, MySQL 8.4+, MariaDB 10.11+ i SQLite, cobertes pel mateix conjunt de proves. |
| Model de contingut | Tipus de col·lecció, tipus únics, components, zones dinàmiques, relacions, multimèdia, text enriquit en Markdown o en el format de blocs de Strapi. L'esquema són fitxers JSON al teu projecte. |
| Canvis d'esquema | Cada canvi es converteix en un pla de migració amb un nivell de risc i l'SQL exacte. Els passos destructius només s'executen quan els permets. |
| API | REST sota `/api` amb els paràmetres de Strapi v5 (`filters`, `populate`, `sort`, `pagination`), un endpoint GraphQL opcional, un document OpenAPI i un client TypeScript tipat. |
| Edició | Esborrany i publicació, contingut localitzat, historial de contingut, llançaments, fluxos de revisió, comentaris i tasques, presència en directe, previsualització i edició visual al teu propi lloc. |
| Accés | Rols d'administració fins al nivell de camps i idiomes, tokens d'API, permisos d'accés públic, SSO amb OpenID Connect, inici de sessió en dos factors amb claus d'accés, registres d'auditoria. |
| Funcionalitats de lloc | Cerca de text complet, mapa del lloc, redireccions, menús i formularis, webhooks, actualitzacions en temps real. |
| Extensió | Connectors WebAssembly que s'enganxen a les escriptures, afegeixen rutes i tasques, i aporten widgets d'administració i camps personalitzats, limitats a les capacitats que declaren. |

## Com es relaciona amb Strapi v5

**El mateix:**

- Els fitxers d'esquema fan servir el format de Strapi: `schema/content-types/<singularName>.json`
  i `schema/components/<category>/<name>.json`.
- L'API de contingut REST: rutes, el format de resposta pla amb `documentId`, paràmetres de
  consulta i operadors, la semàntica de les escriptures (un `POST` o `PUT` publica tret que passis
  `?status=draft`), els cossos d'error.
- L'esquema GraphQL té la forma del connector GraphQL de Strapi v5.
- Els usuaris finals (registre, inici de sessió, OAuth, rols) segueixen l'API `users-permissions`.

**Diferent:**

- **Els canvis d'esquema són migracions planificades.** Verdin compara els fitxers d'esquema amb
  la base de dades i et mostra els passos abans d'executar-los. `verdin start` es nega a executar-se
  mentre la base de dades va per darrere de l'esquema.
- **El constructor de tipus de contingut només funciona en mode de desenvolupament.** En producció,
  l'esquema prové del teu repositori.
- **Els connectors són WebAssembly, no JavaScript.** Els connectors de Strapi, i els controladors,
  serveis o fitxers de cicle de vida personalitzats de `src/`, no s'executen a Verdin.
- **La base de dades no es comparteix amb Strapi.** Portes un projecte de Strapi amb
  `verdin import strapi`, que dona un id nou a cada document.
- **Uns quants extres sobre REST**: accions de publicar i despublicar
  (`POST /api/<route>/<documentId>/actions/publish`), i un component poblat torna sencer, amb els
  components imbricats inclosos.

[Compatibilitat amb Strapi](/ca/migrate/compatibility/) llista les diferències amb detall.

## Quan no fer-lo servir

- **Depens de connectors de Strapi o de codi de servidor personalitzat en JavaScript.** Verdin no
  els pot executar; els hauries de reescriure com a connectors WebAssembly o moure la lògica a un
  altre lloc.
- **Necessites una 1.0 estable.** Verdin és a la 0.10: les versions menors encara poden canviar la
  configuració i el comportament. Llegeix [Actualitzar](/ca/migrate/upgrading/) abans de cadascuna.
- **Vols que el CMS renderitzi les teves pàgines.** Verdin és headless; combina'l amb un framework
  de frontend o un generador de llocs estàtics.
- **Vols un servei gestionat.** Verdin és autoallotjat: executes el binari o la imatge Docker a la
  teva pròpia infraestructura.

## On anar després

- [Inici ràpid](/ca/start/quickstart/): executa Verdin i llegeix la teva primera entrada des de l'API.
- [Tutorial: un blog amb Astro](/ca/start/tutorial-astro/) o
  [amb Next.js](/ca/start/tutorial-nextjs/): construeix un frontend contra el blog d'exemple.
- [Model de contingut](/ca/concepts/content-model/): tipus de contingut, camps i com es desen.
- [Importar un projecte de Strapi](/ca/migrate/from-strapi/): porta-hi un projecte existent.
