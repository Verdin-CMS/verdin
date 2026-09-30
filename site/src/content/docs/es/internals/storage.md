---
title: Almacenamiento
description: Cómo organiza Verdin el contenido en la base de datos, desde los nombres de las tablas y las columnas del sistema hasta las filas de borrador y publicadas, los enlaces de las relaciones, el JSON de los componentes y las tablas de la plataforma.
sidebar:
  order: 2
---

Esta página describe las tablas que Verdin deriva de tu esquema y cómo se almacena cada clase de atributo. Léela antes de cambiar nada en `crates/verdin-migrate/src/derive.rs` o en el Document Service, o cuando necesites consultar directamente la base de datos. Para saber qué acepta cada tipo de atributo, consulta [tipos de atributo](/es/reference/attribute-types/).

Nunca escribes estas tablas a mano: el [motor de migraciones](/es/internals/migrations/) las crea y las hace evolucionar a partir del esquema.

## Convenciones de nombres

| Objeto | Nombre |
|---|---|
| Tabla de un tipo de contenido | `collectionName`, que por defecto es el `pluralName` con los guiones convertidos en guiones bajos (`blog-posts` → `blog_posts`) |
| Columna | El nombre del atributo en snake case (`metaTitle` → `meta_title`) |
| Enlaces de relaciones | `{table}_{column}_lnk` |
| Enlaces de relaciones polimórficas | `{table}_{column}_mph` |
| Enlaces de medios | `{table}_{column}_mda` |
| Índice | `{table}_{part}_uq` para los índices únicos, `{table}_{part}_idx` para los demás |
| Tabla de la plataforma | Prefijo `vd_` (`vd_admin_users`, `vd_schema_snapshots`…) |

Reglas que aplica el validador del esquema (`crates/verdin-schema/src/naming.rs` y `validate.rs`):

- Un `collectionName` cumple `^[a-z][a-z0-9_]*$`, tiene como máximo 50 caracteres y no puede empezar por `vd_`.
- `singularName` y `pluralName` van en kebab case (`^[a-z][a-z0-9-]*$`, sin guiones al principio, al final ni dobles). `upload`, `uploads`, `auth`, `users` y `connect` están reservados porque la API de contenido usa esas rutas.
- Los nombres de atributo empiezan por una letra y siguen con letras, dígitos o guiones bajos (la regla de Strapi), y tienen como máximo 50 caracteres.
- En los tipos de contenido, `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`, `updatedAt`, `createdBy` y `updatedBy` están reservados, igual que cualquier nombre cuyo snake case coincida con ellos. En los componentes, `id` está reservado.
- Los identificadores generados se limitan a 60 caracteres (PostgreSQL permite 63 y MySQL 64). Un nombre más largo se recorta y recibe un hash de 8 caracteres del nombre completo, para que los nombres largos distintos sigan siendo distintos y el resultado sea determinista.

Todos los identificadores se entrecomillan en el SQL generado, así que las palabras reservadas de SQL son nombres de atributo válidos.

## Columnas del sistema

Toda tabla de un tipo de contenido empieza con estas columnas:

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

- `document_id` es un ULID en minúsculas generado al crear el documento. Se mantiene igual en el borrador, en la versión publicada y en todos los idiomas.
- Los tipos no localizados usan `locale = ''` en lugar de `NULL`, porque los NULL nunca colisionan en los índices únicos de ningún motor, lo que rompería la restricción `(document_id, locale, publication_state)`.
- La columna de estado es `publication_state`, no `state`, porque `state` es un nombre de atributo habitual.

Después vienen las columnas de los atributos, una por atributo escalar. **Todas las columnas de atributos admiten nulos.** Como en Strapi v5, los borradores pueden estar incompletos, así que `required` se comprueba cuando se publica una versión (o en cada escritura en los tipos sin borrador y publicación), no en la base de datos. Esto también hace que añadir un atributo obligatorio sea una migración segura.

Los atributos `unique`, y todos los `uid`, reciben un índice único sobre `(column, locale, publication_state)`. Un borrador y su versión publicada pueden compartir un valor, dos documentos publicados no, y la base de datos lo garantiza sin condiciones de carrera. Una violación se informa como `ValidationError` en ese campo.

## Borrador y publicación

Verdin sigue el modelo de Strapi v5. Consulta [borrador y publicación](/es/concepts/draft-and-publish/) para la visión del usuario; esto es lo que pasa en la tabla.

- Un documento tiene como máximo una fila de borrador (`publication_state = 0`) y una fila publicada (`publication_state = 1`) por idioma.
- Las escrituras desde el panel de administración van a la fila del borrador.
- **Publicar** comprueba en el borrador los atributos `required` y las reglas de validación, y después copia los valores de los atributos del borrador en la fila publicada (actualizándola, o insertándola la primera vez), en una sola transacción. Los enlaces de relaciones y medios del borrador se copian con ellos.
- **Despublicar** elimina la fila publicada. Sus enlaces se van con ella mediante `ON DELETE CASCADE`.
- **Descartar el borrador** sobrescribe el borrador con los valores y los enlaces de la fila publicada.
- Los tipos de contenido sin borrador y publicación solo tienen una fila publicada.
- En los tipos localizados, los atributos no localizados se comparten: publicar un idioma los copia en las filas publicadas de los demás idiomas.

## Relaciones: enlazadas por id de documento

**Esta es la principal diferencia con el almacenamiento de Strapi.** Strapi enlaza filas por id de fila y tiene que reescribir los enlaces al publicar. Verdin guarda una relación como *fila de origen → documento de destino*:

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

- La fila de destino se elige al leer, en la versión que se está leyendo: un artículo publicado ve las categorías publicadas y un borrador ve los borradores. Si se despublica una categoría, desaparece de los artículos publicados sin tocar ningún enlace.
- Publicar solo copia los enlaces propios de la fila de origen.
- Solo el lado **propietario** (el atributo con `inversedBy`, o una relación unidireccional) tiene tabla de enlaces. El lado inverso (`mappedBy`) lee la misma tabla en sentido contrario y es de solo lectura: escribirlo es un error de validación que indica el atributo propietario.
- «Como máximo un destino» (`oneToOne`, `manyToOne`, `oneWay`) es el índice único sobre `source_id`. «Un destino pertenece a un solo documento de origen» (`oneToOne`, `oneToMany`) no puede ser un índice, porque un borrador y su versión publicada comparten destinos legítimamente. El Document Service lo garantiza *moviendo* el destino: enlazarlo elimina los enlaces que otros documentos tienen hacia él en el mismo estado, que es el comportamiento de Strapi.
- No hay clave foránea sobre `target_document_id`, porque `document_id` no es único en la tabla de destino. El Document Service rechaza los enlaces a documentos que no existen y, cuando se elimina la última versión de un documento, elimina en la misma transacción los enlaces que apuntan a él.
- Las filas de enlace conservan una clave primaria `id`, así que las tablas de enlaces se parecen a cualquier otra tabla para el motor de migraciones y para las reconstrucciones de tablas de SQLite.
- Renombrar una tabla renombra con ella sus tablas de enlaces. Las migraciones se ejecutan con `foreign_keys` de SQLite desactivado, así que reconstruir una tabla no se propaga en cascada a sus tablas de enlaces.

**Las relaciones polimórficas** (`morphToOne`, `morphToMany`) enlazan documentos de cualquier tipo de contenido. Sus enlaces viven en `{table}_{column}_mph` con `source_id`, `target_type` (el uid del destino), `target_document_id` y `position`, un único `(source_id, target_type, target_document_id)` y, en `morphToOne`, un `source_id` único. Los lados inversos (`morphOne`, `morphMany`) no tienen tabla: leen los enlaces del propietario que apuntan a ellos, y son de solo lectura. Eliminar un documento elimina los enlaces polimórficos hacia él. Consulta [relaciones](/es/concepts/relations/) para ver qué puedes y qué no puedes hacer con ellas.

## Componentes y zonas dinámicas: una columna JSON

Un atributo de componente o una zona dinámica es **una columna JSON** en la fila del documento (`jsonb` en PostgreSQL, `json` en MySQL y MariaDB, `text` en SQLite). Strapi guarda cada componente en su propia tabla con tablas de unión polimórficas; una columna evita esos joins y convierte la publicación y el historial en una simple copia.

```json
// "seo" column (a single component)
{ "id": 1, "metaTitle": "…", "metaDescription": "…" }

// "blocks" column (a dynamic zone)
[
  { "id": 1, "__component": "blocks.hero", "title": "…" },
  { "id": 2, "__component": "blocks.quote", "text": "…", "author": "…" }
]
```

- Cada elemento de un componente tiene un `id` entero, único dentro de su atributo. Los elementos nuevos reciben el siguiente número libre.
- Los datos se validan contra el esquema del componente en cada escritura.
- Publicar y descartar copian el JSON tal cual.
- **Las relaciones y los medios dentro de los componentes** se guardan en el propio JSON: `documentId`s para las relaciones (ahí solo se permiten `oneWay` y `manyWay`) e ids de archivo para los medios. Se comprueban al escribir y se resuelven con consultas agrupadas cuando se popula el componente. Las relaciones polimórficas y los atributos `password` no pueden estar dentro de componentes.
- **El filtrado** necesita funciones JSON específicas de cada dialecto. Los campos escalares de los componentes simples se leen mediante una ruta JSON (`#>>` en PostgreSQL, `JSON_VALUE` en MySQL y MariaDB, `json_extract` en SQLite). Los componentes repetibles usan `EXISTS` sobre los elementos del array (`jsonb_array_elements`, `JSON_TABLE`, `json_each`). Las zonas dinámicas solo se pueden filtrar por `__component`, porque sus elementos tienen campos distintos.

Consulta [componentes y zonas dinámicas](/es/concepts/components-and-dynamic-zones/) para la parte de modelado.

## Tablas de la plataforma

Las tablas de la plataforma forman parte de todo modelo derivado, así que el motor de migraciones las crea y las hace evolucionar exactamente igual que las tablas de contenido; aparecen como pasos seguros en `verdin migrate plan`. Están definidas en `crates/verdin-migrate/src/system.rs`.

| Área | Tablas |
|---|---|
| Migraciones | `vd_schema_snapshots`, `vd_migrations_journal` (propiedad del motor de migraciones, creadas en el primer uso) |
| Administradores | `vd_admin_users`, `vd_admin_roles`, `vd_admin_user_roles`, `vd_admin_permissions`, `vd_sessions` (tokens de refresco), `vd_admin_tokens` (enlaces de invitación y de restablecimiento), `vd_admin_two_factor`, `vd_admin_passkeys`, `vd_spent_challenges` |
| Acceso a la API de contenido | `vd_api_tokens`, `vd_api_token_permissions`, `vd_public_permissions` |
| Usuarios finales | `vd_users`, `vd_user_roles`, `vd_user_role_permissions`, `vd_end_user_sessions` |
| Instancia | `vd_settings` (interruptores de funcionalidades, disposiciones de las vistas de edición, marcadores de actualizaciones puntuales), `vd_locales`, `vd_cluster_events` (el bus de eventos compartido, consulta [Varias instancias](/es/deploy/scaling/)) |
| Medios | `vd_files`, `vd_folders` |
| Flujo de contenido | `vd_history_versions`, `vd_releases`, `vd_release_actions`, `vd_workflows`, `vd_workflow_stages`, `vd_document_stages` |
| Colaboración | `vd_comments`, `vd_tasks`, `vd_document_views`, `vd_document_votes`, `vd_polls`, `vd_poll_votes` |
| Integraciones | `vd_webhooks`, `vd_webhook_deliveries`, `vd_deploy_targets`, `vd_deployments`, `vd_plugin_kv`, `vd_audit_logs` |
| Funcionalidades para el sitio | `vd_redirects`, `vd_menus`, `vd_forms`, `vd_form_submissions` |

## Tablas de medios

Los archivos son filas de `vd_files` con la forma de Strapi (`name`, `alternative_text`, `caption`, `width`, `height`, `formats`, `hash`, `ext`, `mime`, `size`, `url`, `provider`…), además de `focal_point`, `folder_id` y `folder_path`. Las carpetas (`vd_folders`) conservan el `path` de `path_id`s de Strapi, como `/1/4`.

Un atributo de medios es una tabla de enlaces `{table}_{column}_mda` con `source_id` (la fila de contenido), `file_id` (una fila de `vd_files`) y `position`. Tiene un `(source_id, file_id)` único y, cuando el atributo no es `multiple`, un `source_id` único. Las dos columnas son claves foráneas con `ON DELETE CASCADE`, así que eliminar un archivo o una fila elimina sus enlaces. Los enlaces de medios siguen las mismas reglas de borrador y publicación que los enlaces de relaciones: cada versión tiene sus propios enlaces y publicar los copia.

Cómo funcionan las subidas, los formatos y los proveedores de almacenamiento está en [medios](/es/concepts/media/).
