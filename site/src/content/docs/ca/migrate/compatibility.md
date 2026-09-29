---
title: Compatibilitat amb Strapi
description: Quines funcionalitats i API de Strapi v5 admet Verdin, admet en part o no admet — REST, GraphQL, usuaris i permisos, pujades, i18n, esborrany i publicació, extensions de codi, el tauler d'administració i les funcionalitats Enterprise.
sidebar:
  order: 2
---

Verdin conserva el model de contingut i les API de contingut de Strapi v5 perquè els frontends i el
contingut s'hi puguin traslladar (consulta [Migrar des de Strapi](/ca/migrate/from-strapi/)). No és
un substitut directe d'un *codi* de Strapi: no hi ha cap entorn d'execució JavaScript, de manera que
el codi personalitzat es refà com a connectors WebAssembly. Aquesta pàgina llista cada àrea amb el
seu estat, a data de Verdin 0.10.0.

**Admès** funciona com a Strapi v5 (amb les diferències indicades). **Parcial** cobreix els casos
habituals; la nota diu què hi falta. **No admès** no té cap equivalent.

## Model de contingut

| Funcionalitat | Estat | Notes |
| --- | --- | --- |
| Tipus de col·lecció i tipus únics | Admès | Fitxers d'esquema JSON molt semblants als de Strapi (`schema/content-types/*.json`). Consulta [Model de contingut](/ca/concepts/content-model/). |
| Tipus d'atribut escalars | Admès | `string`, `text`, `richtext` (Markdown), `blocks`, `email`, `uid`, `integer`, `biginteger`, `float`, `decimal`, `boolean`, `date`, `time`, `datetime`, `enumeration`, `json`, `password`. El `timestamp` de Strapi s'importa com a `datetime`. |
| Components i zones dinàmiques | Admès | Incloses la multimèdia i les relacions `oneWay`/`manyWay` dins de components. |
| Relacions | Admès | D'un/molts a un/molts, unidireccionals i many-way, i les polimòrfiques `morphToOne`, `morphToMany`, `morphOne`, `morphMany`. |
| Camps de multimèdia | Admès | Simples o múltiples, `allowedTypes`. |
| `unique` | Parcial | No als atributs `text`, `richtext`, `blocks` i `json`. |
| Camps condicionals (`conditions`) | Admès | Les condicions JSON Logic de Strapi 5.17; els camps amagats no són obligatoris. |
| Camps personalitzats | Parcial | Els atributs `customField` funcionen; el camp d'entrada de l'administració prové d'un [connector](/ca/extending/plugins/) de Verdin, no dels connectors React de Strapi. |
| Constructor de tipus de contingut | Admès | Només en mode de desenvolupament (`verdin dev`), com a Strapi. |

## API REST

| Funcionalitat | Estat | Notes |
| --- | --- | --- |
| Rutes CRUD | Admès | `GET`/`POST /api/{pluralName}`, `GET`/`PUT`/`DELETE /api/{pluralName}/{documentId}`, tipus únics a `/api/{singularName}`. Les respostes porten `data` i `meta`, i els errors l'objecte `error` de Strapi. |
| `filters` | Admès | Tots els operadors de Strapi: `$eq`, `$eqi`, `$ne`, `$nei`, `$lt`, `$lte`, `$gt`, `$gte`, `$in`, `$notIn`, `$contains`, `$notContains`, `$containsi`, `$notContainsi`, `$null`, `$notNull`, `$between`, `$startsWith(i)`, `$endsWith(i)`, `$and`, `$or`, `$not`; a través de relacions, components, components repetibles i zones dinàmiques (`__component`). |
| `sort` | Admès | Diversos camps, `:asc`/`:desc`, i el camp d'una relació a un (`author.name:asc`). |
| `pagination` | Admès | `page`/`pageSize` o `start`/`limit`, `withCount`. `pageSize` està limitat a `[api].max_page_size` (100). |
| `fields` | Admès | |
| `populate` | Admès | `*`, llistes, objectes imbricats, `on` per a les zones dinàmiques, `count`. Profunditat fins a 5; com a màxim 1.000 entrades poblades per relació. |
| `status` | Admès | `published` (per defecte) o `draft`; llegir esborranys necessita el permís `readDrafts`. |
| `locale` | Admès | Consulta i18n més avall. |
| `hasPublishedVersion` | Admès | |
| Cerca de text complet `_q` | Admès | `$containsi` sobre els camps de text, com a Strapi; cerca ordenada per rellevància amb `[search]`. |
| Escriptures de relacions | Admès | IDs, `connect` / `disconnect` / `set`, amb `position` (`before`, `after`, `start`, `end`). |
| Publicar, despublicar, descartar l'esborrany | Admès | Les escriptures publiquen tret de `?status=draft`, com a Strapi v5. Verdin hi afegeix `POST /api/{pluralName}/{documentId}/actions/{publish,unpublish,discard-draft}`. |
| Format de resposta de Strapi v4 i `publicationState` | No admès | Verdin només parla v5: atributs plans, `documentId`, `status`. |
| Document OpenAPI | Parcial | A `/api/_openapi.json` (només amb token per defecte) i una referència interactiva a `/api/docs`, en lloc del `/documentation` del connector de documentació. |

## GraphQL

| Funcionalitat | Estat | Notes |
| --- | --- | --- |
| Consultes | Admès | `articles`, `articles_connection` amb `pageInfo`, `article(documentId)`, tipus únics; `filters`, `sort`, `pagination`, `status`, `locale`. Desactivat fins que actives **Configuració → Funcionalitats → GraphQL**. |
| Mutacions | Admès | `create…`, `update…`, `delete…` amb `status` i `locale`. |
| Components, zones dinàmiques, multimèdia | Admès | Les zones dinàmiques com a unions, la multimèdia com a `UploadFile`. |
| Relacions polimòrfiques | Parcial | Es retornen com a JSON, no com a unions tipades. |
| Shadow CRUD (desactivar operacions per tipus) | Admès | L'opció `disabled` de la funcionalitat. |
| Resolvers personalitzats i extensions de l'esquema | Parcial | Camps arrel resolts per connectors (`[[graphql]]` a `plugin.toml`); sense `extensionService`. |
| Mutacions de Users & Permissions (`login`, `register`, `me`…) | No admès | Fes servir les rutes REST. |
| Consultes i mutacions d'upload i i18n (`uploadFiles`, `i18NLocales`…) | No admès | Fes servir les rutes REST i el tauler d'administració. |
| Límits, GraphiQL | Admès | Interruptors de `maxDepth`, `maxComplexity`, introspecció i entorn de proves. |

## Users & Permissions (usuaris finals)

Activa **Configuració → Funcionalitats → Usuaris i permisos**. Consulta
[Usuaris finals](/ca/guides/auth/end-users/).

| Funcionalitat | Estat | Notes |
| --- | --- | --- |
| `POST /api/auth/local`, `/auth/local/register` | Admès | Mateixa forma de petició i resposta. |
| Confirmació per correu, contrasenya oblidada/restabliment/canvi | Admès | `/auth/email-confirmation`, `/auth/send-email-confirmation`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/change-password`. |
| Tokens de renovació | Admès | `jwtManagement: "refresh"`, `/auth/refresh`, `/auth/logout`. |
| `/api/users`, `/users/me`, `/users/count` | Admès | JSON simple, permisos sobre `plugin::users-permissions.user`. |
| Proveïdors OAuth | Parcial | GitHub, Google, Microsoft, Discord, Facebook, GitLab, LinkedIn i qualsevol proveïdor OAuth 2; no totes les configuracions predefinides de Strapi. |
| Rutes de rols i permisos (`/api/users-permissions/roles`, `/permissions`) | No admès | Gestiona els rols a **Configuració → Usuaris finals**. |
| Usuaris importats | Admès | Els hashes bcrypt continuen funcionant; es tornen a calcular amb Argon2id en iniciar la sessió. |

## Mediateca i API de pujades

| Funcionalitat | Estat | Notes |
| --- | --- | --- |
| `POST /api/upload` | Admès | `files` i `fileInfo` multipart; `?id=` actualitza la informació d'un fitxer, o substitueix el fitxer quan se n'envia un. |
| Enllaç en pujar (`ref`, `refId`, `field`) | No admès | Puja i després defineix el camp de multimèdia amb l'id del fitxer. |
| `GET /api/upload/files`, `/files/{id}`, `DELETE /files/{id}` | Parcial | El llistat només accepta `pagination[page]`, `pagination[pageSize]`, `sort` i `filters[name][$containsi]`. |
| Formats responsius, breakpoints | Admès | `thumbnail` més `[upload].breakpoints`. |
| Carpetes, punts focals, text alternatiu, llegendes | Admès | |
| Proveïdors de pujades | Parcial | Disc local i emmagatzematge compatible amb S3 (AWS, R2, B2, MinIO, Tigris…). Sense Cloudinary ni altres paquets de proveïdors. |
| Transformacions d'imatge | Només Verdin | `/uploads/<file>?preset=…` i URL signats (proveïdor local). |

## Internacionalització

| Funcionalitat | Estat | Notes |
| --- | --- | --- |
| Tipus localitzats i camps no localitzats | Admès | `pluginOptions.i18n.localized`, també per atribut. |
| `?locale=` a REST, `locale` a GraphQL | Admès | Un idioma desconegut és un `400`. |
| `localizations` a les respostes | No admès | Llegeix un altre idioma amb el mateix `documentId` i `?locale=`. |
| `GET /api/i18n/locales` | No admès | Els idiomes es gestionen a l'administració (**Configuració → Internacionalització**). |

## Esborrany i publicació

| Funcionalitat | Estat | Notes |
| --- | --- | --- |
| Versions d'esborrany i publicada per document | Admès | Per idioma. Consulta [Esborrany i publicació](/ca/concepts/draft-and-publish/). |
| Descartar l'esborrany | Admès | |
| Publicació programada | Admès | A través dels [llançaments](/ca/guides/content/releases/). |

## Personalització del servidor

| Strapi | Estat | Verdin |
| --- | --- | --- |
| Lifecycle hooks, middlewares del Document Service | Parcial | Hooks previs i posteriors en connectors WebAssembly, que poden canviar o rebutjar una escriptura. Sense JavaScript. |
| Controladors, serveis i rutes personalitzats | Parcial | Rutes de connectors sota `/api/plugins/<name>/`. |
| Policies i middlewares | No admès | Els permisos i els límits de freqüència són integrats. |
| Tasques cron | Parcial | Tasques de connectors. |
| Document Service / Entity Service en JavaScript | No admès | No hi ha entorn d'execució JavaScript. |
| Connectors npm del marketplace de Strapi | No admès | |
| Webhooks | Admès | Signats, reintentats i registrats; `entry.draft-discard` és `entry.discard-draft`. Consulta [Webhooks](/ca/guides/integrations/webhooks/). |
| Tokens d'API (només lectura, accés complet, personalitzats) | Admès | Els mateixos tipus, caducitat opcional, regeneració. |
| Transfer tokens, `strapi transfer` | No admès | Fes servir `verdin export` i `verdin import verdin`. |
| Fitxers de `strapi export` | Admès (importació) | `verdin import strapi`; les exportacions xifrades no es llegeixen. |
| `config/*.js`, `.env` | Parcial | `verdin.toml` i variables d'entorn. |
| Tipus TypeScript | Admès | `verdin types`. |
| Proveïdors de correu | Parcial | SMTP, Resend i Postmark. |

## Tauler d'administració

| Funcionalitat | Estat | Notes |
| --- | --- | --- |
| Gestor de contingut, mediateca, constructor de tipus de contingut | Admès | Un tauler Angular propi, no l'administració React de Strapi. |
| Usuaris administradors, rols, rols personalitzats | Admès | Super Admin, Editor i Author integrats, més rols personalitzats. |
| Permisos per camp i per idioma | Admès | |
| Condicions RBAC | Parcial | Només la condició integrada `is-creator`; sense condicions personalitzades. |
| Personalització de l'administració (`src/admin/app`) | Parcial | Logotip, favicon, títol, color d'accent i textos a `[admin.branding]`; widgets i camps personalitzats dels connectors. Sense pàgines personalitzades, zones d'injecció ni extensions React. |
| API d'administració (`/admin/…`) | No admès | L'API d'administració de Verdin és pròpia; no construeixis sobre la de Strapi. |
| Configuració de la vista d'edició i de la vista de llista | Admès | |

## Funcionalitats Enterprise

Tot a Verdin és de codi obert; aquestes són funcionalitats Enterprise o de pagament a Strapi.

| Funcionalitat de Strapi | Estat | Notes |
| --- | --- | --- |
| SSO | Parcial | Proveïdors OpenID Connect, amb assignació de grups a rols. Sense SAML ni altres estratègies de passport. Consulta [Inici de sessió únic](/ca/guides/auth/sso/). |
| Registres d'auditoria | Admès | Consulta [Registres d'auditoria](/ca/guides/content/audit-logs/). |
| Fluxos de revisió | Admès | Els rols per etapa limiten qui mou entrades *cap a* una etapa, i una etapa de publicació obligatòria s'aplica a totes les API. Consulta [Fluxos de revisió](/ca/guides/content/review-workflows/). |
| Llançaments | Admès | Programats o immediats. |
| Historial de contingut | Admès | `[history].max_versions` versions per document. |
| Previsualització i previsualització en directe | Admès | URL de previsualització amb tokens de curta durada, previsualització costat a costat i [edició visual](/ca/guides/frontend/visual-editing/). |
| Rols d'administració personalitzats | Admès | Sense límit de nombre. |
