---
title: Opslag
description: Hoe Verdin content in de database indeelt, van tabelnamen en systeemkolommen tot concept- en gepubliceerde rijen, relatiekoppelingen, component-JSON en platformtabellen.
sidebar:
  order: 2
---

Deze pagina beschrijft de tabellen die Verdin uit je schema afleidt en hoe elke soort attribuut wordt opgeslagen. Lees haar voordat je iets wijzigt in `crates/verdin-migrate/src/derive.rs` of in de Document Service, of als je de database rechtstreeks moet bevragen. Voor wat elk attribuuttype accepteert, zie [attribuuttypes](/nl/reference/attribute-types/).

Je schrijft deze tabellen nooit met de hand: de [migratie-engine](/nl/internals/migrations/) maakt ze aan en ontwikkelt ze verder vanuit het schema.

## Naamgevingsconventies

| Object | Naam |
|---|---|
| Tabel van een contenttype | `collectionName`, standaard de `pluralName` met streepjes omgezet in underscores (`blog-posts` → `blog_posts`) |
| Kolom | De attribuutnaam in snake case (`metaTitle` → `meta_title`) |
| Relatiekoppelingen | `{table}_{column}_lnk` |
| Koppelingen van polymorfe relaties | `{table}_{column}_mph` |
| Mediakoppelingen | `{table}_{column}_mda` |
| Index | `{table}_{part}_uq` voor unieke indexen, `{table}_{part}_idx` voor andere |
| Platformtabel | Prefix `vd_` (`vd_admin_users`, `vd_schema_snapshots`…) |

Regels die de schemavalidator afdwingt (`crates/verdin-schema/src/naming.rs` en `validate.rs`):

- Een `collectionName` voldoet aan `^[a-z][a-z0-9_]*$`, heeft hoogstens 50 tekens, en kan niet met `vd_` beginnen.
- `singularName` en `pluralName` zijn kebab case (`^[a-z][a-z0-9-]*$`, geen streepjes aan het begin of einde of dubbele streepjes). `upload`, `uploads`, `auth`, `users` en `connect` zijn gereserveerd, omdat de content-API die routes gebruikt.
- Attribuutnamen beginnen met een letter en gaan verder met letters, cijfers of underscores (de regel van Strapi), en hebben hoogstens 50 tekens.
- Op contenttypes zijn `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`, `updatedAt`, `createdBy` en `updatedBy` gereserveerd, en ook elke naam waarvan de snake case ermee botst. Op componenten is `id` gereserveerd.
- Gegenereerde identifiers worden begrensd op 60 tekens (PostgreSQL staat 63 toe, MySQL 64). Een langere naam wordt afgekapt en krijgt een hash van 8 tekens van de volledige naam, zodat verschillende lange namen verschillend blijven en het resultaat deterministisch is.

Elke identifier wordt in de gegenereerde SQL gequote, dus gereserveerde SQL-woorden zijn geldige attribuutnamen.

## Systeemkolommen

Elke tabel van een contenttype begint met deze kolommen:

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

- `document_id` is een ULID in kleine letters die bij het aanmaken wordt gegenereerd. Hij blijft gelijk voor het concept, de gepubliceerde versie en elke locale.
- Types die niet gelokaliseerd zijn, gebruiken `locale = ''` in plaats van `NULL`, omdat NULLs op geen enkele engine botsen in unieke indexen, wat de constraint `(document_id, locale, publication_state)` zou breken.
- De statuskolom is `publication_state`, niet `state`, omdat `state` een veelgebruikte attribuutnaam is.

Daarna volgen de attribuutkolommen, één per scalair attribuut. **Elke attribuutkolom is nullable.** Net als in Strapi v5 mogen concepten onvolledig zijn, dus `required` wordt gecontroleerd wanneer een versie wordt gepubliceerd (of bij elke schrijfactie naar types zonder concept en publicatie), niet door de database. Daardoor is een verplicht attribuut toevoegen ook een veilige migratie.

`unique`-attributen, en elke `uid`, krijgen een unieke index op `(column, locale, publication_state)`. Een concept en zijn gepubliceerde versie kunnen een waarde delen, twee gepubliceerde documenten niet, en de database dwingt dat af zonder race conditions. Een schending wordt gemeld als een `ValidationError` op dat veld.

## Concept en publicatie

Verdin volgt het model van Strapi v5. Zie [concept en publicatie](/nl/concepts/draft-and-publish/) voor het gebruikersperspectief; dit is wat er in de tabel gebeurt.

- Een document heeft per locale hoogstens één conceptrij (`publication_state = 0`) en één gepubliceerde rij (`publication_state = 1`).
- Schrijfacties vanuit het beheerpaneel gaan naar de conceptrij.
- **Publiceren** controleert `required`-attributen en validatieregels op het concept, en kopieert daarna de attribuutwaarden van het concept naar de gepubliceerde rij (die wordt bijgewerkt, of de eerste keer ingevoegd), in één transactie. De relatie- en mediakoppelingen van het concept worden meegekopieerd.
- **Publicatie ongedaan maken** verwijdert de gepubliceerde rij. De koppelingen ervan verdwijnen mee via `ON DELETE CASCADE`.
- **Concept verwerpen** overschrijft het concept met de waarden en koppelingen van de gepubliceerde rij.
- Contenttypes zonder concept en publicatie hebben alleen ooit een gepubliceerde rij.
- Bij gelokaliseerde types worden attributen die niet gelokaliseerd zijn gedeeld: één locale publiceren kopieert ze naar de gepubliceerde rijen van de andere locales.

## Relaties: gekoppeld via document-id

**Dit is het belangrijkste verschil met de opslag van Strapi.** Strapi koppelt rijen via rij-id en moet koppelingen herschrijven als je publiceert. Verdin slaat een relatie op als *bronrij → doeldocument*:

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

- De doelrij wordt bij het lezen gekozen, in de versie die gelezen wordt: een gepubliceerd artikel ziet gepubliceerde categorieën, een concept ziet concepten. Als de publicatie van een categorie ongedaan wordt gemaakt, verdwijnt ze uit gepubliceerde artikelen zonder dat er een koppeling wordt aangeraakt.
- Publiceren kopieert alleen de eigen koppelingen van de bronrij.
- Alleen de **eigenaarskant** (het attribuut met `inversedBy`, of een relatie in één richting) heeft een koppeltabel. De inverse kant (`mappedBy`) leest dezelfde tabel in omgekeerde richting en is alleen-lezen: hem schrijven is een validatiefout die het attribuut van de eigenaar noemt.
- "Hoogstens één doel" (`oneToOne`, `manyToOne`, `oneWay`) is de unieke index op `source_id`. "Een doel hoort bij één brondocument" (`oneToOne`, `oneToMany`) kan geen index zijn, omdat een concept en zijn gepubliceerde versie terecht doelen delen. De Document Service dwingt het af door het doel te *verplaatsen*: het koppelen haalt de koppelingen weg die andere documenten in dezelfde status ernaar hebben, en dat is het gedrag van Strapi.
- Er is geen foreign key op `target_document_id`, omdat `document_id` in de doeltabel niet uniek is. De Document Service weigert koppelingen naar documenten die niet bestaan en verwijdert, wanneer de laatste versie van een document wordt verwijderd, in dezelfde transactie de koppelingen die ernaar wijzen.
- Koppelrijen behouden een primaire sleutel `id`, zodat koppeltabellen er voor de migratie-engine en voor de herbouw van SQLite-tabellen uitzien als elke andere tabel.
- Een tabel hernoemen hernoemt zijn koppeltabellen mee. Migraties draaien met `foreign_keys` van SQLite uit, zodat het herbouwen van een tabel niet doorwerkt in zijn koppeltabellen.

**Polymorfe relaties** (`morphToOne`, `morphToMany`) koppelen documenten van elk contenttype. Hun koppelingen staan in `{table}_{column}_mph` met `source_id`, `target_type` (de uid van het doel), `target_document_id` en `position`, een unieke `(source_id, target_type, target_document_id)`, en bij `morphToOne` een unieke `source_id`. De inverse kanten (`morphOne`, `morphMany`) hebben geen tabel: ze lezen de koppelingen van de eigenaar die naar hen wijzen, en zijn alleen-lezen. Een document verwijderen verwijdert de polymorfe koppelingen ernaartoe. Zie [relaties](/nl/concepts/relations/) voor wat je er wel en niet mee kunt.

## Componenten en dynamische zones: een JSON-kolom

Een componentattribuut of een dynamische zone is **één JSON-kolom** op de rij van het document (`jsonb` op PostgreSQL, `json` op MySQL en MariaDB, `text` op SQLite). Strapi slaat elke component op in een eigen tabel met polymorfe jointabellen; een kolom vermijdt die joins en maakt van publiceren en geschiedenis een gewone kopie.

```json
// "seo" column (a single component)
{ "id": 1, "metaTitle": "…", "metaDescription": "…" }

// "blocks" column (a dynamic zone)
[
  { "id": 1, "__component": "blocks.hero", "title": "…" },
  { "id": 2, "__component": "blocks.quote", "text": "…", "author": "…" }
]
```

- Elk componentitem heeft een geheel getal als `id`, uniek binnen zijn attribuut. Nieuwe items krijgen het volgende vrije nummer.
- Gegevens worden bij elke schrijfactie tegen het schema van de component gevalideerd.
- Publiceren en verwerpen kopiëren de JSON zoals hij is.
- **Relaties en media in componenten** worden in de JSON zelf opgeslagen: `documentId`s voor relaties (alleen `oneWay` en `manyWay` zijn daar toegestaan) en bestands-id's voor media. Ze worden bij het schrijven gecontroleerd en met gebundelde queries opgelost wanneer de component wordt gepopuleerd. Polymorfe relaties en `password`-attributen kunnen niet in componenten staan.
- **Filteren** vereist JSON-functies per dialect. Scalaire velden van enkelvoudige componenten worden gelezen via een JSON-pad (`#>>` op PostgreSQL, `JSON_VALUE` op MySQL en MariaDB, `json_extract` op SQLite). Herhaalbare componenten gebruiken `EXISTS` over de array-items (`jsonb_array_elements`, `JSON_TABLE`, `json_each`). Dynamische zones kunnen alleen op `__component` worden gefilterd, omdat hun items verschillende velden hebben.

Zie [componenten en dynamische zones](/nl/concepts/components-and-dynamic-zones/) voor de modelleringskant.

## Platformtabellen

De platformtabellen horen bij elk afgeleid model, dus de migratie-engine maakt ze aan en ontwikkelt ze precies zoals contenttabellen; ze verschijnen als veilige stappen in `verdin migrate plan`. Ze zijn gedefinieerd in `crates/verdin-migrate/src/system.rs`.

| Gebied | Tabellen |
|---|---|
| Migraties | `vd_schema_snapshots`, `vd_migrations_journal` (eigendom van de migratie-engine, aangemaakt bij het eerste gebruik) |
| Beheerders | `vd_admin_users`, `vd_admin_roles`, `vd_admin_user_roles`, `vd_admin_permissions`, `vd_sessions` (refresh tokens), `vd_admin_tokens` (uitnodigings- en herstellinks), `vd_admin_two_factor`, `vd_admin_passkeys`, `vd_spent_challenges` |
| Toegang tot de content-API | `vd_api_tokens`, `vd_api_token_permissions`, `vd_public_permissions` |
| Eindgebruikers | `vd_users`, `vd_user_roles`, `vd_user_role_permissions`, `vd_end_user_sessions` |
| Instantie | `vd_settings` (functieschakelaars, lay-outs van bewerkweergaven, eenmalige upgrademarkeringen), `vd_locales`, `vd_cluster_events` (de gedeelde eventbus, zie [Meerdere instanties](/nl/deploy/scaling/)) |
| Media | `vd_files`, `vd_folders` |
| Contentworkflow | `vd_history_versions`, `vd_releases`, `vd_release_actions`, `vd_workflows`, `vd_workflow_stages`, `vd_document_stages` |
| Samenwerking | `vd_comments`, `vd_tasks`, `vd_document_views`, `vd_document_votes`, `vd_polls`, `vd_poll_votes` |
| Integraties | `vd_webhooks`, `vd_webhook_deliveries`, `vd_deploy_targets`, `vd_deployments`, `vd_plugin_kv`, `vd_audit_logs` |
| Sitefuncties | `vd_redirects`, `vd_menus`, `vd_forms`, `vd_form_submissions` |

## Mediatabellen

Bestanden zijn rijen van `vd_files` in de vorm van Strapi (`name`, `alternative_text`, `caption`, `width`, `height`, `formats`, `hash`, `ext`, `mime`, `size`, `url`, `provider`…), plus `focal_point`, `folder_id` en `folder_path`. Mappen (`vd_folders`) behouden de `path` van Strapi uit `path_id`s, zoals `/1/4`.

Een media-attribuut is een koppeltabel `{table}_{column}_mda` met `source_id` (de contentrij), `file_id` (een rij van `vd_files`) en `position`. Hij heeft een unieke `(source_id, file_id)` en, als het attribuut niet `multiple` is, een unieke `source_id`. Beide kolommen zijn foreign keys met `ON DELETE CASCADE`, dus een bestand of een rij verwijderen haalt de koppelingen ervan weg. Mediakoppelingen volgen dezelfde regels voor concept en publicatie als relatiekoppelingen: elke versie heeft haar eigen koppelingen en publiceren kopieert ze.

Hoe uploads, formaten en opslagproviders werken, staat in [media](/nl/concepts/media/).
