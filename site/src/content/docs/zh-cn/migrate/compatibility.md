---
title: 与 Strapi 的兼容性
description: Verdin 支持、部分支持或不支持哪些 Strapi v5 功能和 API：REST、GraphQL、用户与权限、上传、i18n、草稿与发布、代码扩展、管理后台和企业版功能。
sidebar:
  order: 3
---

Verdin 保留了 Strapi v5 的内容模型和内容 API，以便前端和内容可以迁移过来（参见[从 Strapi 迁移](/zh-cn/migrate/from-strapi/)）。它并不能直接替代 Strapi 的*代码库*：没有 JavaScript 运行时，因此自定义代码需要重写为 WebAssembly 插件。本页按领域列出各项功能的状态，截至 Verdin 0.10.0。

**支持**表示与 Strapi v5 的行为相同（差异会注明）。**部分支持**涵盖常见场景；说明中会指出缺少什么。**不支持**表示没有对应功能。

## 内容模型

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 集合类型和单一类型 | 支持 | 与 Strapi 相近的 JSON schema 文件（`schema/content-types/*.json`）。参见[内容模型](/zh-cn/concepts/content-model/)。 |
| 标量属性类型 | 支持 | `string`、`text`、`richtext`（Markdown）、`blocks`、`email`、`uid`、`integer`、`biginteger`、`float`、`decimal`、`boolean`、`date`、`time`、`datetime`、`enumeration`、`json`、`password`。Strapi 的 `timestamp` 会作为 `datetime` 导入。 |
| 组件和动态区域 | 支持 | 包括组件内的媒体以及 `oneWay`/`manyWay` 关联。 |
| 关联 | 支持 | 一对一/一对多/多对一/多对多、单向和多向，以及多态的 `morphToOne`、`morphToMany`、`morphOne`、`morphMany`。 |
| 媒体字段 | 支持 | 单个或多个，`allowedTypes`。 |
| `unique` | 部分支持 | 不适用于 `text`、`richtext`、`blocks` 和 `json` 属性。 |
| 条件字段（`conditions`） | 支持 | Strapi 5.17 的 JSON Logic 条件；隐藏的字段不是必填的。 |
| 自定义字段 | 部分支持 | `customField` 属性可以使用；管理后台中的输入控件来自 Verdin [插件](/zh-cn/extending/plugins/)，而不是 Strapi 的 React 插件。 |
| 内容类型构建器 | 支持 | 与 Strapi 一样，仅在开发模式（`verdin dev`）下可用。 |

## REST API

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| CRUD 路由 | 支持 | `GET`/`POST /api/{pluralName}`、`GET`/`PUT`/`DELETE /api/{pluralName}/{documentId}`，单一类型位于 `/api/{singularName}`。响应带有 `data` 和 `meta`，错误使用 Strapi 的 `error` 对象。 |
| `filters` | 支持 | Strapi 的所有运算符：`$eq`、`$eqi`、`$ne`、`$nei`、`$lt`、`$lte`、`$gt`、`$gte`、`$in`、`$notIn`、`$contains`、`$notContains`、`$containsi`、`$notContainsi`、`$null`、`$notNull`、`$between`、`$startsWith(i)`、`$endsWith(i)`、`$and`、`$or`、`$not`；可通过关联、组件、可重复组件和动态区域（`__component`）过滤。 |
| `sort` | 支持 | 多个字段、`:asc`/`:desc`，以及对一关联的字段（`author.name:asc`）。 |
| `pagination` | 支持 | `page`/`pageSize` 或 `start`/`limit`、`withCount`。`pageSize` 的上限为 `[api].max_page_size`（100）。 |
| `fields` | 支持 | |
| `populate` | 支持 | `*`、列表、嵌套对象、用于动态区域的 `on`、`count`。深度最多 5 层；每个关联最多 populate 1,000 个条目。 |
| `status` | 支持 | `published`（默认）或 `draft`；读取草稿需要 `readDrafts` 权限。 |
| `locale` | 支持 | 参见下文的 i18n。 |
| `hasPublishedVersion` | 支持 | |
| `_q` 全文搜索 | 支持 | 与 Strapi 一样对文本字段执行 `$containsi`；启用 `[search]` 后按相关度排序。 |
| 关联写入 | 支持 | ID、`connect` / `disconnect` / `set`，以及 `position`（`before`、`after`、`start`、`end`）。 |
| 发布、取消发布、丢弃草稿 | 支持 | 与 Strapi v5 一样，除非带 `?status=draft`，否则写入会发布。Verdin 额外提供 `POST /api/{pluralName}/{documentId}/actions/{publish,unpublish,discard-draft}`。 |
| Strapi v4 响应格式和 `publicationState` | 不支持 | Verdin 只支持 v5：扁平属性、`documentId`、`status`。 |
| OpenAPI 文档 | 部分支持 | 位于 `/api/_openapi.json`（默认仅限令牌访问），交互式参考位于 `/api/docs`，取代 documentation 插件的 `/documentation`。 |

## GraphQL

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 查询 | 支持 | `articles`、带 `pageInfo` 的 `articles_connection`、`article(documentId)`、单一类型；`filters`、`sort`、`pagination`、`status`、`locale`。在你开启 **设置 → 功能 → GraphQL** 之前保持关闭。 |
| 变更 | 支持 | 带 `status` 和 `locale` 的 `create…`、`update…`、`delete…`。 |
| 组件、动态区域、媒体 | 支持 | 动态区域为联合类型，媒体为 `UploadFile`。 |
| 多态关联 | 部分支持 | 以 JSON 返回，而不是类型化的联合类型。 |
| Shadow CRUD（按类型禁用操作） | 支持 | 该功能的 `disabled` 设置。 |
| 自定义解析器和 schema 扩展 | 部分支持 | 由插件解析的根字段（`plugin.toml` 中的 `[[graphql]]`）；没有 `extensionService`。 |
| 用户与权限的变更（`login`、`register`、`me`……） | 不支持 | 请使用 REST 路由。 |
| 上传和 i18n 的查询/变更（`uploadFiles`、`i18NLocales`……） | 不支持 | 请使用 REST 路由（`GET /api/i18n/locales`）和管理后台。本地化类型上的 `localizations` 受支持。 |
| 限制、GraphiQL | 支持 | `maxDepth`、`maxComplexity`、内省和调试台开关。 |

## 用户与权限（终端用户）

开启 **设置 → 功能 → 用户与权限**。参见[终端用户](/zh-cn/guides/auth/end-users/)。

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| `POST /api/auth/local`、`/auth/local/register` | 支持 | 请求和响应格式相同。 |
| 邮箱确认、忘记/重置/修改密码 | 支持 | `/auth/email-confirmation`、`/auth/send-email-confirmation`、`/auth/forgot-password`、`/auth/reset-password`、`/auth/change-password`。 |
| 刷新令牌 | 支持 | `jwtManagement: "refresh"`、`/auth/refresh`、`/auth/logout`。 |
| `/api/users`、`/users/me`、`/users/count` | 支持 | 普通 JSON，权限位于 `plugin::users-permissions.user` 上。 |
| OAuth 提供商 | 部分支持 | GitHub、Google、Microsoft、Discord、Facebook、GitLab、LinkedIn 以及任何 OAuth 2 提供商；并非 Strapi 的所有预设。 |
| 角色和权限路由（`/api/users-permissions/roles`、`/permissions`） | 不支持 | 请在 **设置 → 终端用户** 中管理角色。 |
| 导入的用户 | 支持 | Bcrypt 哈希仍然有效；登录时会用 Argon2id 重新哈希。 |

## 媒体库和上传 API

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| `POST /api/upload` | 支持 | Multipart 的 `files` 和 `fileInfo`；`?id=` 更新文件的信息，发送了文件时则替换该文件。 |
| 上传时关联（`ref`、`refId`、`field`） | 不支持 | 先上传，再用文件 id 设置媒体字段。 |
| `GET /api/upload/files`、`/files/{id}`、`DELETE /files/{id}` | 部分支持 | 列表只接受 `pagination[page]`、`pagination[pageSize]`、`sort` 和 `filters[name][$containsi]`。 |
| 响应式格式、断点 | 支持 | `thumbnail` 加上 `[upload].breakpoints`。 |
| 文件夹、焦点、替代文本、说明文字 | 支持 | |
| 上传提供方 | 部分支持 | 本地磁盘和 S3 兼容存储（AWS、R2、B2、MinIO、Tigris……）。没有 Cloudinary 或其他提供方包。 |
| 图片转换 | Verdin 独有 | `/uploads/<file>?preset=…` 和签名 URL（本地提供方）。 |

## 国际化

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 本地化类型和非本地化字段 | 支持 | `pluginOptions.i18n.localized`，也可以按属性设置。 |
| REST 上的 `?locale=`，GraphQL 中的 `locale` | 支持 | 未知的语言区域返回 `400`。 |
| 响应中的 `localizations` | 支持 | 只在 populate 时返回（`populate=localizations`、`populate=*`），选项与关联相同。也是一个 GraphQL 字段。管理 API 不包含它。 |
| `GET /api/i18n/locales` | 支持 | Strapi 格式的普通数组。需要对 `plugin::i18n.locale` 拥有 `find`（权限网格的 **Locales** 行），与 Strapi 的 `listLocales` 相同。`documentId` 由语言区域代码派生。语言区域在管理后台中管理（**设置 → 国际化**）。 |

## 草稿与发布

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 每个文档的草稿和已发布版本 | 支持 | 按语言区域。参见[草稿与发布](/zh-cn/concepts/draft-and-publish/)。 |
| 丢弃草稿 | 支持 | |
| 定时发布 | 支持 | 通过[发布计划](/zh-cn/guides/content/releases/)。 |

## 服务器定制

关于如何迁移其中每一项，参见[移植自定义代码](/zh-cn/migrate/porting-custom-code/)。

| Strapi | 状态 | Verdin |
| --- | --- | --- |
| 生命周期钩子、Document Service 中间件 | 部分支持 | WebAssembly 插件中的 before/after 钩子，可以修改或拒绝写入。没有 JavaScript。 |
| 自定义控制器、服务、路由 | 部分支持 | 位于 `/api/plugins/<name>/` 下的插件路由。 |
| 策略和中间件 | 不支持 | 权限和速率限制是内置的。 |
| `register` / `bootstrap` | 部分支持 | 插件的启动函数，在插件启动、被开启或其设置变更时运行；它可以填充内容并替换公开角色的权限。 |
| Cron 任务 | 部分支持 | 插件任务。 |
| JavaScript 中的 Document Service / Entity Service | 不支持 | 没有 JavaScript 运行时。 |
| Strapi 市场中的 npm 插件 | 不支持 | |
| Webhook | 支持 | 带签名、重试和日志；`entry.draft-discard` 改为 `entry.discard-draft`。参见 [Webhook](/zh-cn/guides/integrations/webhooks/)。 |
| API 令牌（只读、完全访问、自定义） | 支持 | 相同的种类，可选的过期时间，可以重新生成。 |
| 传输令牌、`strapi transfer` | 不支持 | 请使用 `verdin export` 和 `verdin import verdin`。 |
| `strapi export` 文件 | 支持（导入） | `verdin import strapi`；不读取加密的导出文件。 |
| `config/*.js`、`.env` | 部分支持 | `verdin.toml` 和环境变量。 |
| TypeScript 类型 | 支持 | `verdin types`。 |
| 邮件提供方 | 部分支持 | SMTP、Resend 和 Postmark。 |

## 管理后台

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 内容管理器、媒体库、内容类型构建器 | 支持 | 一个独立的 Angular 管理后台，而不是 Strapi 的 React 管理后台。 |
| 管理员用户、角色、自定义角色 | 支持 | 内置 Super Admin、Editor 和 Author，另外支持自定义角色。 |
| 字段级和语言区域权限 | 支持 | |
| RBAC 条件 | 部分支持 | 仅支持内置的 `is-creator` 条件；不支持自定义条件。 |
| 管理后台定制（`src/admin/app`） | 部分支持 | 在 `[admin.branding]` 中设置 logo、favicon、标题、强调色和文字；小组件和自定义字段来自插件。没有自定义页面、注入区域或 React 扩展。 |
| 管理 API（`/admin/…`） | 不支持 | Verdin 的管理 API 是独立的；不要基于 Strapi 的管理 API 进行开发。 |
| 编辑视图和列表视图配置 | 支持 | |

## 企业版功能

Verdin 中的一切都是开源的；以下这些在 Strapi 中是企业版或付费功能。

| Strapi 功能 | 状态 | 说明 |
| --- | --- | --- |
| SSO | 部分支持 | OpenID Connect 提供商，支持组到角色的映射。不支持 SAML 或其他 passport 策略。参见[单点登录](/zh-cn/guides/auth/sso/)。 |
| 审计日志 | 支持 | 参见[审计日志](/zh-cn/guides/content/audit-logs/)。 |
| 审核工作流 | 支持 | 每个阶段的角色限制谁可以把条目*移入*该阶段，发布所需阶段适用于所有 API。参见[审核工作流](/zh-cn/guides/content/review-workflows/)。 |
| 发布计划 | 支持 | 定时或立即执行。 |
| 内容历史 | 支持 | 每个文档保留 `[history].max_versions` 个版本。 |
| 预览和实时预览 | 支持 | 带短期令牌的预览 URL、并排预览以及[可视化编辑](/zh-cn/guides/frontend/visual-editing/)。 |
| 自定义管理员角色 | 支持 | 数量不限。 |
