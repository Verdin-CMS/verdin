---
title: Armazenamento
description: Como o Verdin organiza o conteúdo no banco de dados, dos nomes das tabelas e colunas de sistema às linhas de rascunho e publicadas, aos vínculos das relações, ao JSON dos componentes e às tabelas da plataforma.
sidebar:
  order: 2
---

Esta página descreve as tabelas que o Verdin deriva do seu schema e como cada tipo de atributo é armazenado. Leia-a antes de alterar qualquer coisa em `crates/verdin-migrate/src/derive.rs` ou no Document Service, ou quando precisar consultar o banco de dados diretamente. Para o que cada tipo de atributo aceita, veja [tipos de atributos](/pt-br/reference/attribute-types/).

Você nunca escreve essas tabelas à mão: o [motor de migrações](/pt-br/internals/migrations/) as cria e as evolui a partir do schema.

## Convenções de nomenclatura

| Objeto | Nome |
|---|---|
| Tabela de tipo de conteúdo | `collectionName`, cujo padrão é o `pluralName` com os hífens trocados por underscores (`blog-posts` → `blog_posts`) |
| Coluna | O nome do atributo em snake case (`metaTitle` → `meta_title`) |
| Vínculos de relações | `{table}_{column}_lnk` |
| Vínculos de relações polimórficas | `{table}_{column}_mph` |
| Vínculos de mídia | `{table}_{column}_mda` |
| Índice | `{table}_{part}_uq` para os índices únicos, `{table}_{part}_idx` para os outros |
| Tabela da plataforma | Prefixo `vd_` (`vd_admin_users`, `vd_schema_snapshots`…) |

Regras que o validador de schema impõe (`crates/verdin-schema/src/naming.rs` e `validate.rs`):

- Um `collectionName` corresponde a `^[a-z][a-z0-9_]*$`, tem no máximo 50 caracteres e não pode começar com `vd_`.
- `singularName` e `pluralName` são kebab case (`^[a-z][a-z0-9-]*$`, sem hífens no início, no fim ou duplicados). `upload`, `uploads`, `auth`, `users` e `connect` são reservados porque a API de conteúdo usa essas rotas.
- Os nomes de atributos começam com uma letra e continuam com letras, dígitos ou underscores (a regra do Strapi), com no máximo 50 caracteres.
- Nos tipos de conteúdo, `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`, `updatedAt`, `createdBy` e `updatedBy` são reservados, assim como qualquer nome cujo snake case colida com eles. Nos componentes, `id` é reservado.
- Os identificadores gerados são limitados a 60 caracteres (o PostgreSQL permite 63, o MySQL 64). Um nome mais longo é cortado e recebe um hash de 8 caracteres do nome completo, para que nomes longos distintos continuem distintos e o resultado seja determinístico.

Todo identificador é colocado entre aspas no SQL gerado, então as palavras reservadas do SQL são nomes de atributos válidos.

## Colunas de sistema

Toda tabela de tipo de conteúdo começa com estas colunas:

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

- `document_id` é um ULID em minúsculas gerado na criação. Ele se mantém igual no rascunho, na versão publicada e em todos os idiomas.
- Os tipos não localizados usam `locale = ''` em vez de `NULL`, porque os NULLs nunca colidem em índices únicos em nenhum motor, o que quebraria a restrição `(document_id, locale, publication_state)`.
- A coluna de estado é `publication_state`, não `state`, porque `state` é um nome de atributo comum.

Em seguida vêm as colunas de atributos, uma por atributo escalar. **Toda coluna de atributo aceita nulo.** Como no Strapi v5, os rascunhos podem estar incompletos, então o `required` é verificado quando uma versão é publicada (ou em toda escrita nos tipos sem rascunho e publicação), não pelo banco de dados. Isso também torna a adição de um atributo obrigatório uma migração segura.

Os atributos `unique`, e todo `uid`, recebem um índice único em `(column, locale, publication_state)`. Um rascunho e a sua versão publicada podem ter o mesmo valor, dois documentos publicados não, e o banco de dados impõe isso sem condições de corrida. Uma violação é informada como um `ValidationError` nesse campo.

## Rascunho e publicação

O Verdin segue o modelo do Strapi v5. Veja [rascunho e publicação](/pt-br/concepts/draft-and-publish/) para a visão do usuário; isto é o que acontece na tabela.

- Um documento tem no máximo uma linha de rascunho (`publication_state = 0`) e uma linha publicada (`publication_state = 1`) por idioma.
- As escritas feitas pelo painel de administração visam a linha de rascunho.
- **Publicar** verifica os atributos `required` e as regras de validação no rascunho e depois copia os valores dos atributos do rascunho para a linha publicada (atualizando-a, ou inserindo-a na primeira vez), em uma única transação. Os vínculos de relações e de mídia do rascunho são copiados junto.
- **Despublicar** exclui a linha publicada. Os seus vínculos vão junto por meio de `ON DELETE CASCADE`.
- **Descartar o rascunho** sobrescreve o rascunho com os valores e os vínculos da linha publicada.
- Os tipos de conteúdo sem rascunho e publicação só têm uma linha publicada.
- Nos tipos localizados, os atributos não localizados são compartilhados: publicar um idioma os copia para as linhas publicadas dos outros idiomas.

## Relações: vinculadas pelo id do documento

**Esta é a principal diferença em relação ao armazenamento do Strapi.** O Strapi vincula as linhas pelo id da linha e precisa reescrever os vínculos quando você publica. O Verdin armazena uma relação como *linha de origem → documento de destino*:

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

- A linha de destino é escolhida no momento da leitura, na versão que está sendo lida: um artigo publicado vê as categorias publicadas, um rascunho vê os rascunhos. Se uma categoria é despublicada, ela desaparece dos artigos publicados sem que nenhum vínculo seja tocado.
- Publicar copia apenas os vínculos da própria linha de origem.
- Apenas o lado **dono** (o atributo com `inversedBy`, ou uma relação de sentido único) tem uma tabela de vínculos. O lado inverso (`mappedBy`) lê a mesma tabela ao contrário e é somente leitura: escrevê-lo é um erro de validação que nomeia o atributo dono.
- "No máximo um destino" (`oneToOne`, `manyToOne`, `oneWay`) é o índice único em `source_id`. "Um destino pertence a um documento de origem" (`oneToOne`, `oneToMany`) não pode ser um índice, porque um rascunho e a sua versão publicada compartilham destinos legitimamente. O Document Service impõe isso *movendo* o destino: vinculá-lo remove os vínculos que outros documentos têm com ele no mesmo estado, que é o comportamento do Strapi.
- Não há chave estrangeira em `target_document_id`, porque `document_id` não é único na tabela de destino. O Document Service rejeita vínculos com documentos que não existem e, quando a última versão de um documento é excluída, remove na mesma transação os vínculos que apontam para ele.
- As linhas de vínculo mantêm uma chave primária `id`, para que as tabelas de vínculos pareçam com qualquer outra tabela para o motor de migrações e para as reconstruções de tabelas do SQLite.
- Renomear uma tabela renomeia as suas tabelas de vínculos junto. As migrações rodam com o `foreign_keys` do SQLite desativado, para que a reconstrução de uma tabela não se propague em cascata para as suas tabelas de vínculos.

**As relações polimórficas** (`morphToOne`, `morphToMany`) vinculam documentos de qualquer tipo de conteúdo. Os seus vínculos ficam em `{table}_{column}_mph` com `source_id`, `target_type` (o uid do destino), `target_document_id` e `position`, um único `(source_id, target_type, target_document_id)` e, para `morphToOne`, um `source_id` único. Os lados inversos (`morphOne`, `morphMany`) não têm tabela: eles leem os vínculos do dono que apontam para eles e são somente leitura. Excluir um documento remove os vínculos polimórficos para ele. Veja [relações](/pt-br/concepts/relations/) para o que você pode e não pode fazer com elas.

## Componentes e zonas dinâmicas: uma coluna JSON

Um atributo de componente ou uma zona dinâmica é **uma coluna JSON** na linha do documento (`jsonb` no PostgreSQL, `json` no MySQL e no MariaDB, `text` no SQLite). O Strapi armazena cada componente na sua própria tabela, com tabelas de junção polimórficas; uma coluna evita esses joins e torna a publicação e o histórico uma simples cópia.

```json
// "seo" column (a single component)
{ "id": 1, "metaTitle": "…", "metaDescription": "…" }

// "blocks" column (a dynamic zone)
[
  { "id": 1, "__component": "blocks.hero", "title": "…" },
  { "id": 2, "__component": "blocks.quote", "text": "…", "author": "…" }
]
```

- Todo item de componente tem um `id` inteiro, único dentro do seu atributo. Os novos itens recebem o próximo número livre.
- Os dados são validados contra o schema do componente em toda escrita.
- Publicar e descartar copiam o JSON como está.
- **As relações e a mídia dentro de componentes** são armazenadas no próprio JSON: `documentId`s para as relações (apenas `oneWay` e `manyWay` são permitidas ali) e ids de arquivo para a mídia. Elas são verificadas na escrita e resolvidas com consultas em lote quando o componente é populado. As relações polimórficas e os atributos `password` não podem ficar dentro de componentes.
- **A filtragem** precisa de funções JSON específicas de cada dialeto. Os campos escalares dos componentes simples são lidos por um caminho JSON (`#>>` no PostgreSQL, `JSON_VALUE` no MySQL e no MariaDB, `json_extract` no SQLite). Os componentes repetíveis usam `EXISTS` sobre os itens do array (`jsonb_array_elements`, `JSON_TABLE`, `json_each`). As zonas dinâmicas só podem ser filtradas por `__component`, porque os seus itens têm campos diferentes.

Veja [componentes e zonas dinâmicas](/pt-br/concepts/components-and-dynamic-zones/) para o lado da modelagem.

## Tabelas da plataforma

As tabelas da plataforma fazem parte de todo modelo derivado, então o motor de migrações as cria e as evolui exatamente como as tabelas de conteúdo; elas aparecem como passos seguros no `verdin migrate plan`. Elas são definidas em `crates/verdin-migrate/src/system.rs`.

| Área | Tabelas |
|---|---|
| Migrações | `vd_schema_snapshots`, `vd_migrations_journal` (pertencem ao motor de migrações, criadas no primeiro uso) |
| Administradores | `vd_admin_users`, `vd_admin_roles`, `vd_admin_user_roles`, `vd_admin_permissions`, `vd_sessions` (tokens de renovação), `vd_admin_tokens` (links de convite e de redefinição), `vd_admin_two_factor`, `vd_admin_passkeys`, `vd_spent_challenges` |
| Acesso à API de conteúdo | `vd_api_tokens`, `vd_api_token_permissions`, `vd_public_permissions` |
| Usuários finais | `vd_users`, `vd_user_roles`, `vd_user_role_permissions`, `vd_end_user_sessions` |
| Instância | `vd_settings` (interruptores de recursos, layouts das telas de edição, marcadores de atualizações únicas), `vd_locales`, `vd_cluster_events` (o barramento de eventos compartilhado, veja [Várias instâncias](/pt-br/deploy/scaling/)) |
| Mídia | `vd_files`, `vd_folders` |
| Fluxo de conteúdo | `vd_history_versions`, `vd_releases`, `vd_release_actions`, `vd_workflows`, `vd_workflow_stages`, `vd_document_stages` |
| Colaboração | `vd_comments`, `vd_tasks`, `vd_document_views`, `vd_document_votes`, `vd_polls`, `vd_poll_votes` |
| Integrações | `vd_webhooks`, `vd_webhook_deliveries`, `vd_deploy_targets`, `vd_deployments`, `vd_plugin_kv`, `vd_audit_logs` |
| Recursos de site | `vd_redirects`, `vd_menus`, `vd_forms`, `vd_form_submissions` |

## Tabelas de mídia

Os arquivos são linhas de `vd_files` no formato do Strapi (`name`, `alternative_text`, `caption`, `width`, `height`, `formats`, `hash`, `ext`, `mime`, `size`, `url`, `provider`…), além de `focal_point`, `folder_id` e `folder_path`. As pastas (`vd_folders`) mantêm o `path` de `path_id`s do Strapi, como `/1/4`.

Um atributo de mídia é uma tabela de vínculos `{table}_{column}_mda` com `source_id` (a linha de conteúdo), `file_id` (uma linha de `vd_files`) e `position`. Ela tem um `(source_id, file_id)` único e, quando o atributo não é `multiple`, um `source_id` único. As duas colunas são chaves estrangeiras com `ON DELETE CASCADE`, então excluir um arquivo ou uma linha remove os seus vínculos. Os vínculos de mídia seguem as mesmas regras de rascunho e publicação dos vínculos de relações: cada versão tem os seus vínculos e a publicação os copia.

Como funcionam os uploads, os formatos e os provedores de armazenamento está em [mídia](/pt-br/concepts/media/).
