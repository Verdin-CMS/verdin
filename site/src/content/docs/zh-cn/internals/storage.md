---
title: 存储
description: Verdin 如何在数据库中组织内容：从表名和系统列，到草稿行和已发布行、关联链接、组件 JSON 以及平台表。
sidebar:
  order: 2
---

本页介绍 Verdin 根据你的 schema 推导出的表，以及每种属性的存储方式。在修改 `crates/verdin-migrate/src/derive.rs` 或 Document Service 中的任何内容之前，或者需要直接查询数据库时，请先阅读本页。每种属性类型接受什么值，请参见[属性类型](/zh-cn/reference/attribute-types/)。

你永远不需要手动编写这些表：[迁移引擎](/zh-cn/internals/migrations/)会根据 schema 创建并演进它们。

## 命名约定

| 对象 | 名称 |
|---|---|
| 内容类型表 | `collectionName`，默认为把连字符替换为下划线后的 `pluralName`（`blog-posts` → `blog_posts`） |
| 列 | snake case 形式的属性名（`metaTitle` → `meta_title`） |
| 关联链接 | `{table}_{column}_lnk` |
| 多态关联链接 | `{table}_{column}_mph` |
| 媒体链接 | `{table}_{column}_mda` |
| 索引 | 唯一索引为 `{table}_{part}_uq`，其他索引为 `{table}_{part}_idx` |
| 平台表 | `vd_` 前缀（`vd_admin_users`、`vd_schema_snapshots`……） |

schema 校验器强制执行的规则（`crates/verdin-schema/src/naming.rs` 和 `validate.rs`）：

- `collectionName` 必须匹配 `^[a-z][a-z0-9_]*$`，最多 50 个字符，且不能以 `vd_` 开头。
- `singularName` 和 `pluralName` 为 kebab case（`^[a-z][a-z0-9-]*$`，不能以连字符开头或结尾，也不能有连续的连字符）。`upload`、`uploads`、`auth`、`users` 和 `connect` 是保留名，因为内容 API 使用了这些路由。
- 属性名以字母开头，之后是字母、数字或下划线（Strapi 的规则），最多 50 个字符。
- 在内容类型中，`id`、`documentId`、`locale`、`publicationState`、`publishedAt`、`createdAt`、`updatedAt`、`createdBy` 和 `updatedBy` 是保留名，snake case 形式与它们冲突的任何名称也是如此。在组件中，`id` 是保留名。
- 生成的标识符最长 60 个字符（PostgreSQL 允许 63 个，MySQL 允许 64 个）。更长的名称会被截断，并加上完整名称的 8 字符哈希，这样不同的长名称仍然保持不同，结果也是确定的。

生成的 SQL 中每个标识符都会加引号，因此 SQL 保留字也可以作为属性名。

## 系统列

每个内容类型表都以这些列开头：

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

- `document_id` 是创建时生成的小写 ULID。它在草稿、已发布版本和所有语言区域之间保持不变。
- 非本地化类型使用 `locale = ''` 而不是 `NULL`，因为在任何引擎上 NULL 在唯一索引中都不会冲突，这会破坏 `(document_id, locale, publication_state)` 约束。
- 状态列叫做 `publication_state` 而不是 `state`，因为 `state` 是一个常见的属性名。

之后是属性列，每个标量属性一列。**每个属性列都可以为空。** 与 Strapi v5 一样，草稿可以不完整，因此 `required` 在版本发布时（或者对未启用草稿与发布的类型的每次写入时）检查，而不是由数据库检查。这也让添加必填属性成为一次安全的迁移。

`unique` 属性以及每个 `uid` 都会在 `(column, locale, publication_state)` 上获得一个唯一索引。草稿及其已发布版本可以共享一个值，两个已发布的文档则不能，并且由数据库在没有竞态的情况下强制执行。冲突会以该字段上的 `ValidationError` 报告。

## 草稿与发布

Verdin 遵循 Strapi v5 的模型。用户视角请参见[草稿与发布](/zh-cn/concepts/draft-and-publish/)；这里说明的是表中发生的事情。

- 一个文档在每个语言区域中最多有一个草稿行（`publication_state = 0`）和一个已发布行（`publication_state = 1`）。
- 来自管理后台的写入以草稿行为目标。
- **发布** 会在草稿上检查 `required` 属性和校验规则，然后在一个事务中把草稿的属性值复制到已发布行上（更新它，或者首次时插入它）。草稿的关联和媒体链接也会一并复制。
- **取消发布** 会删除已发布行。其链接会通过 `ON DELETE CASCADE` 一起删除。
- **丢弃草稿** 会用已发布行的值和链接覆盖草稿。
- 未启用草稿与发布的内容类型永远只有一个已发布行。
- 对于本地化类型，非本地化的属性是共享的：发布一个语言区域时，会把它们复制到其他语言区域的已发布行。

## 关联：按文档 id 链接

**这是与 Strapi 存储方式的主要区别。** Strapi 按行 id 链接行，因此在发布时必须重写链接。Verdin 把关联存储为*源行 → 目标文档*：

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

- 目标行在读取时、在正在读取的版本中确定：已发布的文章看到已发布的分类，草稿看到草稿。如果某个分类被取消发布，它就会从已发布的文章中消失，而不会触碰任何链接。
- 发布只会复制源行自己的链接。
- 只有**拥有方**（带有 `inversedBy` 的属性，或单向关联）才有链接表。反向一侧（`mappedBy`）反向读取同一张表，并且是只读的：写入它会产生一个指明拥有方属性的校验错误。
- “最多一个目标”（`oneToOne`、`manyToOne`、`oneWay`）由 `source_id` 上的唯一索引保证。“一个目标属于一个源文档”（`oneToOne`、`oneToMany`）无法用索引实现，因为草稿及其已发布版本本来就可以共享目标。Document Service 通过*移动*目标来强制执行这一点：链接某个目标时，会移除其他文档在相同状态下对它的链接，这与 Strapi 的行为一致。
- `target_document_id` 上没有外键，因为 `document_id` 在目标表中不是唯一的。Document Service 会拒绝指向不存在文档的链接，并在删除某个文档的最后一个版本时，在同一事务中移除指向它的链接。
- 链接行保留 `id` 主键，因此对于迁移引擎和 SQLite 表重建来说，链接表与其他表看起来没有区别。
- 重命名一张表时，其链接表也会随之重命名。迁移运行时会关闭 SQLite 的 `foreign_keys`，因此重建一张表不会级联影响其链接表。

**多态关联**（`morphToOne`、`morphToMany`）可以链接任何内容类型的文档。它们的链接存放在 `{table}_{column}_mph` 中，包含 `source_id`、`target_type`（目标的 uid）、`target_document_id` 和 `position`，带有唯一的 `(source_id, target_type, target_document_id)`，对于 `morphToOne` 还有唯一的 `source_id`。反向一侧（`morphOne`、`morphMany`）没有表：它们读取拥有方指向它们的链接，并且是只读的。删除一个文档会移除指向它的多态链接。能对它们做什么、不能做什么，请参见[关联](/zh-cn/concepts/relations/)。

## 组件和动态区域：一个 JSON 列

组件属性或动态区域是文档行上的**一个 JSON 列**（PostgreSQL 上为 `jsonb`，MySQL 和 MariaDB 上为 `json`，SQLite 上为 `text`）。Strapi 把每个组件存放在单独的表中，并使用多态连接表；而使用一个列可以避免这些 join，并让发布和历史记录变成简单的复制。

```json
// "seo" column (a single component)
{ "id": 1, "metaTitle": "…", "metaDescription": "…" }

// "blocks" column (a dynamic zone)
[
  { "id": 1, "__component": "blocks.hero", "title": "…" },
  { "id": 2, "__component": "blocks.quote", "text": "…", "author": "…" }
]
```

- 每个组件项都有一个整数 `id`，在其属性内唯一。新项获得下一个可用的编号。
- 每次写入时，数据都会对照组件的 schema 进行校验。
- 发布和丢弃会原样复制 JSON。
- **组件内的关联和媒体**存储在 JSON 本身中：关联存 `documentId`（那里只允许 `oneWay` 和 `manyWay`），媒体存文件 id。它们在写入时检查，并在 populate 组件时通过批量查询解析。多态关联和 `password` 属性不能放在组件中。
- **过滤**需要特定于方言的 JSON 函数。单个组件的标量字段通过 JSON 路径读取（PostgreSQL 上为 `#>>`，MySQL 和 MariaDB 上为 `JSON_VALUE`，SQLite 上为 `json_extract`）。可重复组件对数组项使用 `EXISTS`（`jsonb_array_elements`、`JSON_TABLE`、`json_each`）。动态区域只能按 `__component` 过滤，因为其各项有不同的字段。

建模方面的内容请参见[组件和动态区域](/zh-cn/concepts/components-and-dynamic-zones/)。

## 平台表

平台表是每个推导模型的一部分，因此迁移引擎会像处理内容表一样创建和演进它们；它们在 `verdin migrate plan` 中显示为安全步骤。它们定义在 `crates/verdin-migrate/src/system.rs` 中。

| 领域 | 表 |
|---|---|
| 迁移 | `vd_schema_snapshots`、`vd_migrations_journal`（由迁移引擎拥有，首次使用时创建） |
| 管理员 | `vd_admin_users`、`vd_admin_roles`、`vd_admin_user_roles`、`vd_admin_permissions`、`vd_sessions`（刷新令牌）、`vd_admin_tokens`（邀请和重置链接）、`vd_admin_two_factor`、`vd_admin_passkeys`、`vd_spent_challenges` |
| 内容 API 访问 | `vd_api_tokens`、`vd_api_token_permissions`、`vd_public_permissions` |
| 终端用户 | `vd_users`、`vd_user_roles`、`vd_user_role_permissions`、`vd_end_user_sessions` |
| 实例 | `vd_settings`（功能开关、编辑视图布局、一次性升级标记）、`vd_locales`、`vd_cluster_events`（共享事件总线，参见[运行多个实例](/zh-cn/deploy/scaling/)） |
| 媒体 | `vd_files`、`vd_folders` |
| 内容工作流 | `vd_history_versions`、`vd_releases`、`vd_release_actions`、`vd_workflows`、`vd_workflow_stages`、`vd_document_stages` |
| 协作 | `vd_comments`、`vd_tasks`、`vd_document_views`、`vd_document_votes`、`vd_polls`、`vd_poll_votes` |
| 集成 | `vd_webhooks`、`vd_webhook_deliveries`、`vd_deploy_targets`、`vd_deployments`、`vd_plugin_kv`、`vd_audit_logs` |
| 站点功能 | `vd_redirects`、`vd_menus`、`vd_forms`、`vd_form_submissions` |

## 媒体表

文件是 `vd_files` 中采用 Strapi 格式的行（`name`、`alternative_text`、`caption`、`width`、`height`、`formats`、`hash`、`ext`、`mime`、`size`、`url`、`provider`……），另外还有 `focal_point`、`folder_id` 和 `folder_path`。文件夹（`vd_folders`）保留 Strapi 由 `path_id` 组成的 `path`，例如 `/1/4`。

媒体属性是一张链接表 `{table}_{column}_mda`，包含 `source_id`（内容行）、`file_id`（一个 `vd_files` 行）和 `position`。它带有唯一的 `(source_id, file_id)`，当属性不是 `multiple` 时还有唯一的 `source_id`。两列都是带有 `ON DELETE CASCADE` 的外键，因此删除文件或行会移除其链接。媒体链接遵循与关联链接相同的草稿与发布规则：每个版本拥有自己的链接，发布时会复制它们。

上传、格式和存储提供方的工作方式请参见[媒体](/zh-cn/concepts/media/)。
