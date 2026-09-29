---
title: Emmagatzematge
description: Com disposa Verdin el contingut a la base de dades, des dels noms de les taules i les columnes del sistema fins a les files d'esborrany i publicades, els enllaços de relacions, el JSON dels components i les taules de la plataforma.
sidebar:
  order: 2
---

Aquesta pàgina descriu les taules que Verdin deriva del teu esquema i com es desa cada tipus
d'atribut. Llegeix-la abans de canviar res a `crates/verdin-migrate/src/derive.rs` o al Document
Service, o quan necessitis consultar directament la base de dades. Per saber què accepta cada tipus
d'atribut, consulta [tipus d'atribut](/ca/reference/attribute-types/).

Mai no escrius aquestes taules a mà: el [motor de migracions](/ca/internals/migrations/) les crea i
les fa evolucionar a partir de l'esquema.

## Convencions de noms

| Objecte | Nom |
|---|---|
| Taula d'un tipus de contingut | `collectionName`, que per defecte és el `pluralName` amb els guions convertits en guions baixos (`blog-posts` → `blog_posts`) |
| Columna | El nom de l'atribut en snake case (`metaTitle` → `meta_title`) |
| Enllaços de relacions | `{table}_{column}_lnk` |
| Enllaços de relacions polimòrfiques | `{table}_{column}_mph` |
| Enllaços de multimèdia | `{table}_{column}_mda` |
| Índex | `{table}_{part}_uq` per als índexs únics, `{table}_{part}_idx` per als altres |
| Taula de la plataforma | Prefix `vd_` (`vd_admin_users`, `vd_schema_snapshots`…) |

Regles que fa complir el validador de l'esquema (`crates/verdin-schema/src/naming.rs` i
`validate.rs`):

- Un `collectionName` coincideix amb `^[a-z][a-z0-9_]*$`, té com a màxim 50 caràcters i no pot
  començar per `vd_`.
- `singularName` i `pluralName` són en kebab case (`^[a-z][a-z0-9-]*$`, sense guions al principi,
  al final ni duplicats). `upload`, `uploads`, `auth`, `users` i `connect` estan reservats perquè
  l'API de contingut fa servir aquestes rutes.
- Els noms d'atribut comencen per una lletra i continuen amb lletres, dígits o guions baixos (la
  regla de Strapi), i tenen com a màxim 50 caràcters.
- Als tipus de contingut, `id`, `documentId`, `locale`, `publicationState`, `publishedAt`,
  `createdAt`, `updatedAt`, `createdBy` i `updatedBy` estan reservats, i també qualsevol nom que en
  snake case hi col·lideixi. Als components, `id` està reservat.
- Els identificadors generats es limiten a 60 caràcters (PostgreSQL en permet 63, MySQL 64). Un nom
  més llarg es talla i s'hi afegeix un hash de 8 caràcters del nom complet, de manera que els noms
  llargs diferents continuen sent diferents i el resultat és determinista.

Tots els identificadors van entre cometes a l'SQL generat, de manera que les paraules reservades
d'SQL són noms d'atribut vàlids.

## Columnes del sistema

Totes les taules de tipus de contingut comencen amb aquestes columnes:

```sql
id                 BIGINT       primary key, auto-increment
document_id        CHAR(26)     NOT NULL           -- ULID, shared by every version of a document
locale             VARCHAR(16)  NOT NULL DEFAULT '' -- '' for types that are not localized
publication_state  SMALLINT     NOT NULL           -- 0 = draft, 1 = published
published_at       <datetime>   NULL
created_at         <datetime>   NOT NULL
updated_at         <datetime>   NOT NULL
created_by_id      BIGINT       NULL               -- vd_admin_users.id
updated_by_id      BIGINT       NULL
UNIQUE (document_id, locale, publication_state)
INDEX  (publication_state, locale)
```

- `document_id` és un ULID en minúscules generat en crear. Es manté igual entre l'esborrany, la
  versió publicada i tots els idiomes.
- Els tipus no localitzats fan servir `locale = ''` en lloc de `NULL`, perquè els NULL mai no
  col·lideixen als índexs únics de cap motor, cosa que trencaria la restricció
  `(document_id, locale, publication_state)`.
- La columna d'estat és `publication_state`, no `state`, perquè `state` és un nom d'atribut
  habitual.

Després vénen les columnes d'atribut, una per atribut escalar. **Totes les columnes d'atribut
admeten nuls.** Com a Strapi v5, els esborranys poden estar incomplets, de manera que `required` es
comprova quan es publica una versió (o a cada escriptura als tipus sense esborrany i publicació), no
a la base de dades. Això també fa que afegir un atribut obligatori sigui una migració segura.

Els atributs `unique`, i tots els `uid`, reben un índex únic sobre
`(column, locale, publication_state)`. Un esborrany i la seva versió publicada poden compartir un
valor, dos documents publicats no, i la base de dades ho fa complir sense condicions de carrera. Una
violació s'informa com a `ValidationError` sobre aquell camp.

## Esborrany i publicació

Verdin segueix el model de Strapi v5. Consulta [esborrany i publicació](/ca/concepts/draft-and-publish/)
per a la visió de l'usuari; això és el que passa a la taula.

- Un document té com a màxim una fila d'esborrany (`publication_state = 0`) i una fila publicada
  (`publication_state = 1`) per idioma.
- Les escriptures del tauler d'administració van a la fila de l'esborrany.
- **Publicar** comprova els atributs `required` i les regles de validació sobre l'esborrany, i
  després copia els valors dels atributs de l'esborrany a la fila publicada (actualitzant-la, o
  inserint-la la primera vegada), en una sola transacció. Els enllaços de relacions i de multimèdia
  de l'esborrany es copien amb ella.
- **Despublicar** elimina la fila publicada. Els seus enllaços se'n van amb ella mitjançant
  `ON DELETE CASCADE`.
- **Descartar l'esborrany** sobreescriu l'esborrany amb els valors i els enllaços de la fila
  publicada.
- Els tipus de contingut sense esborrany i publicació només tenen mai una fila publicada.
- Als tipus localitzats, els atributs no localitzats es comparteixen: publicar un idioma els copia a
  les files publicades dels altres idiomes.

## Relacions: enllaçades per id de document

**Aquesta és la diferència principal respecte a l'emmagatzematge de Strapi.** Strapi enllaça files
per id de fila i ha de reescriure els enllaços quan publiques. Verdin desa una relació com a
*fila d'origen → document de destinació*:

```sql
-- articles_category_lnk
id                  BIGINT   primary key, auto-increment
source_id           BIGINT   NOT NULL REFERENCES articles(id) ON DELETE CASCADE
target_document_id  CHAR(26) NOT NULL
position            DOUBLE   NOT NULL   -- 1..n, rewritten on every write
UNIQUE (source_id, target_document_id)
UNIQUE (source_id)                      -- to-one kinds only
INDEX  (target_document_id)
```

- La fila de destinació es tria en temps de lectura, en la versió que s'està llegint: un article
  publicat veu categories publicades, un esborrany veu esborranys. Si es despublica una categoria,
  desapareix dels articles publicats sense tocar cap enllaç.
- Publicar només copia els enllaços propis de la fila d'origen.
- Només el costat **propietari** (l'atribut amb `inversedBy`, o una relació unidireccional) té taula
  d'enllaç. El costat invers (`mappedBy`) llegeix la mateixa taula a la inversa, i és de només
  lectura: escriure-hi és un error de validació que indica l'atribut propietari.
- «Com a màxim una destinació» (`oneToOne`, `manyToOne`, `oneWay`) és l'índex únic sobre
  `source_id`. «Una destinació pertany a un sol document d'origen» (`oneToOne`, `oneToMany`) no pot
  ser un índex, perquè un esborrany i la seva versió publicada comparteixen destinacions de manera
  legítima. El Document Service ho fa complir *movent* la destinació: enllaçar-la elimina els
  enllaços que altres documents hi tenen en el mateix estat, que és el comportament de Strapi.
- No hi ha cap clau forana sobre `target_document_id`, perquè `document_id` no és únic a la taula de
  destinació. El Document Service rebutja els enllaços a documents que no existeixen i, quan
  s'elimina l'última versió d'un document, elimina en la mateixa transacció els enllaços que hi
  apunten.
- Les files d'enllaç conserven una clau primària `id`, de manera que les taules d'enllaç semblen com
  qualsevol altra taula per al motor de migracions i per a les reconstruccions de taules de SQLite.
- Canviar el nom d'una taula canvia el nom de les seves taules d'enllaç amb ella. Les migracions
  s'executen amb les `foreign_keys` de SQLite desactivades, de manera que reconstruir una taula no es
  propaga en cascada a les seves taules d'enllaç.

**Les relacions polimòrfiques** (`morphToOne`, `morphToMany`) enllacen documents de qualsevol tipus
de contingut. Els seus enllaços viuen a `{table}_{column}_mph` amb `source_id`, `target_type` (l'uid
de la destinació), `target_document_id` i `position`, un únic `(source_id, target_type,
target_document_id)` i, per a `morphToOne`, un `source_id` únic. Els costats inversos (`morphOne`,
`morphMany`) no tenen taula: llegeixen els enllaços del propietari que hi apunten, i són de només
lectura. Eliminar un document elimina els enllaços polimòrfics cap a ell. Consulta
[relacions](/ca/concepts/relations/) per saber què pots fer i què no amb elles.

## Components i zones dinàmiques: una columna JSON

Un atribut de component o una zona dinàmica és **una columna JSON** a la fila del document
(`jsonb` a PostgreSQL, `json` a MySQL i MariaDB, `text` a SQLite). Strapi desa cada component a la
seva pròpia taula amb taules d'unió polimòrfiques; una columna evita aquests joins i fa que la
publicació i l'historial siguin una simple còpia.

```json
// "seo" column (a single component)
{ "id": 1, "metaTitle": "…", "metaDescription": "…" }

// "blocks" column (a dynamic zone)
[
  { "id": 1, "__component": "blocks.hero", "title": "…" },
  { "id": 2, "__component": "blocks.quote", "text": "…", "author": "…" }
]
```

- Cada element de component té un `id` enter, únic dins del seu atribut. Els elements nous reben el
  següent número lliure.
- Les dades es validen contra l'esquema del component a cada escriptura.
- Publicar i descartar copien el JSON tal qual.
- **Les relacions i la multimèdia dins de components** es desen al mateix JSON: `documentId` per a
  les relacions (només s'hi permeten `oneWay` i `manyWay`) i ids de fitxer per a la multimèdia. Es
  comproven en escriure i es resolen amb consultes agrupades quan es pobla el component. Les
  relacions polimòrfiques i els atributs `password` no poden estar dins de components.
- **El filtratge** necessita funcions JSON específiques de cada dialecte. Els camps escalars dels
  components simples es llegeixen amb un camí JSON (`#>>` a PostgreSQL, `JSON_VALUE` a MySQL i
  MariaDB, `json_extract` a SQLite). Els components repetibles fan servir `EXISTS` sobre els
  elements de l'array (`jsonb_array_elements`, `JSON_TABLE`, `json_each`). Les zones dinàmiques només
  es poden filtrar per `__component`, perquè els seus elements tenen camps diferents.

Consulta [components i zones dinàmiques](/ca/concepts/components-and-dynamic-zones/) per a la part
de modelatge.

## Taules de la plataforma

Les taules de la plataforma formen part de tots els models derivats, de manera que el motor de
migracions les crea i les fa evolucionar exactament igual que les taules de contingut; apareixen com
a passos segurs a `verdin migrate plan`. Estan definides a `crates/verdin-migrate/src/system.rs`.

| Àrea | Taules |
|---|---|
| Migracions | `vd_schema_snapshots`, `vd_migrations_journal` (propietat del motor de migracions, creades en el primer ús) |
| Administradors | `vd_admin_users`, `vd_admin_roles`, `vd_admin_user_roles`, `vd_admin_permissions`, `vd_sessions` (tokens de refresc), `vd_admin_tokens` (enllaços d'invitació i de restabliment), `vd_admin_two_factor`, `vd_admin_passkeys`, `vd_spent_challenges` |
| Accés a l'API de contingut | `vd_api_tokens`, `vd_api_token_permissions`, `vd_public_permissions` |
| Usuaris finals | `vd_users`, `vd_user_roles`, `vd_user_role_permissions`, `vd_end_user_sessions` |
| Instància | `vd_settings` (interruptors de funcionalitats, disposicions de les vistes d'edició, marcadors d'actualitzacions puntuals), `vd_locales` |
| Multimèdia | `vd_files`, `vd_folders` |
| Flux de treball del contingut | `vd_history_versions`, `vd_releases`, `vd_release_actions`, `vd_workflows`, `vd_workflow_stages`, `vd_document_stages` |
| Col·laboració | `vd_comments`, `vd_tasks`, `vd_document_views`, `vd_document_votes`, `vd_polls`, `vd_poll_votes` |
| Integracions | `vd_webhooks`, `vd_webhook_deliveries`, `vd_deploy_targets`, `vd_deployments`, `vd_plugin_kv`, `vd_audit_logs` |
| Funcionalitats de lloc | `vd_redirects`, `vd_menus`, `vd_forms`, `vd_form_submissions` |

## Taules de multimèdia

Els fitxers són files de `vd_files` amb la forma de Strapi (`name`, `alternative_text`, `caption`,
`width`, `height`, `formats`, `hash`, `ext`, `mime`, `size`, `url`, `provider`…), més `focal_point`,
`folder_id` i `folder_path`. Les carpetes (`vd_folders`) conserven el `path` de `path_id` de Strapi,
com ara `/1/4`.

Un atribut de multimèdia és una taula d'enllaç `{table}_{column}_mda` amb `source_id` (la fila de
contingut), `file_id` (una fila de `vd_files`) i `position`. Té un `(source_id, file_id)` únic i,
quan l'atribut no és `multiple`, un `source_id` únic. Totes dues columnes són claus foranes amb
`ON DELETE CASCADE`, de manera que eliminar un fitxer o una fila n'elimina els enllaços. Els enllaços
de multimèdia segueixen les mateixes regles d'esborrany i publicació que els enllaços de relacions:
cada versió té els seus enllaços i publicar-la els copia.

Com funcionen les pujades, els formats i els proveïdors d'emmagatzematge és a
[multimèdia](/ca/concepts/media/).
