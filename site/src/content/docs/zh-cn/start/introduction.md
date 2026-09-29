---
title: Verdin 是什么
description: Verdin 是一款用 Rust 编写的开源无头 CMS，内容 API 与 Strapi v5 兼容，服务端与管理后台集成在同一个二进制文件中。
sidebar:
  order: 1
  label: 简介
---

Verdin 是一款用 Rust 编写的开源无头（headless）CMS。你定义内容类型，编辑在管理后台中撰写和发布内容，你的网站和应用再通过 REST 或 GraphQL API 读取这些内容。Verdin 不负责渲染页面，页面由你的前端渲染。

它是 [Strapi v5](https://strapi.io) 的重写版本：schema 格式和内容 API 的结构与 Strapi 相同，因此 Strapi 项目及其前端只需少量改动即可迁移过来。

## 适用人群

- **构建网站或应用的开发者**：希望 CMS 以单个进程运行、内容模型纳入 git 管理，并且可以被任意前端读取，例如 Astro、Next.js 或移动应用。
- **正在使用 Strapi 的团队**：希望以更小的资源占用获得相同的 API，或者需要 Strapi 只在付费套餐中提供的功能。Verdin 没有企业版：SSO、审计日志、审核工作流和发布计划（releases）都属于开源项目的一部分。
- **内容编辑**：可以在支持 18 种语言的管理后台中使用草稿、发布、历史记录和预览功能。

## 包含哪些功能

一个可执行文件 `verdin` 同时是服务端、命令行工具和管理后台。生产环境中不需要 Node.js 运行时，也没有 `node_modules`。

| 领域 | 提供的功能 |
| --- | --- |
| 数据库 | PostgreSQL 14+、MySQL 8.4+、MariaDB 10.11+ 和 SQLite，全部由同一套测试覆盖。 |
| 内容模型 | 集合类型、单一类型、组件、动态区域、关联、媒体，以及 Markdown 或 Strapi blocks 格式的富文本。schema 以 JSON 文件的形式保存在你的项目中。 |
| schema 变更 | 每次变更都会生成一份迁移计划，附带风险等级和确切的 SQL。破坏性步骤只有在你明确允许时才会执行。 |
| API | 位于 `/api` 下的 REST，支持 Strapi v5 参数（`filters`、`populate`、`sort`、`pagination`）；可选的 GraphQL 端点、OpenAPI 文档，以及带类型的 TypeScript 客户端。 |
| 编辑 | 草稿与发布、本地化内容、内容历史、发布计划、审核工作流、评论和任务、实时在线状态，以及在你自己的网站上进行预览和可视化编辑。 |
| 访问控制 | 细化到字段和语言区域的管理员角色、API 令牌、公开访问授权、基于 OpenID Connect 的 SSO、支持通行密钥（passkey）的双因素登录、审计日志。 |
| 站点功能 | 全文搜索、站点地图、重定向、菜单和表单、webhook、实时更新。 |
| 扩展 | WebAssembly 插件：可以挂接写入操作、添加路由和任务，并提供管理后台小组件和自定义字段，其权限仅限于插件声明的能力。 |

## 与 Strapi v5 的关系

**相同之处：**

- schema 文件采用 Strapi 的格式：`schema/content-types/<singularName>.json` 和 `schema/components/<category>/<name>.json`。
- REST 内容 API：路由、带 `documentId` 的扁平响应格式、查询参数和运算符、写入语义（`POST` 或 `PUT` 会直接发布，除非传入 `?status=draft`），以及错误响应体。
- GraphQL schema 的结构与 Strapi v5 的 GraphQL 插件一致。
- 终端用户（注册、登录、OAuth、角色）遵循 `users-permissions` API。

**不同之处：**

- **schema 变更以迁移计划的方式执行。** Verdin 会对比 schema 文件与数据库，在执行之前先向你展示各个步骤。如果数据库落后于 schema，`verdin start` 会拒绝启动。
- **内容类型构建器只在开发模式下可用。** 在生产环境中，schema 来自你的代码仓库。
- **插件是 WebAssembly，而不是 JavaScript。** Strapi 插件，以及 `src/` 中的自定义控制器、服务或生命周期文件，都无法在 Verdin 中运行。
- **数据库不与 Strapi 共用。** 使用 `verdin import strapi` 导入 Strapi 项目，每个文档都会获得新的 id。
- **在 REST 之外的一些补充**：发布和取消发布操作（`POST /api/<route>/<documentId>/actions/publish`），以及被 populate 的组件会完整返回，包括其中嵌套的组件。

[与 Strapi 的兼容性](/zh-cn/migrate/compatibility/)详细列出了所有差异。

## 不适用的情况

- **你依赖 Strapi 插件或 JavaScript 编写的自定义服务端代码。** Verdin 无法运行它们，你需要把它们重写为 WebAssembly 插件，或者把相关逻辑移到别处。
- **你需要稳定的 1.0 版本。** Verdin 目前处于 0.9：次版本仍可能改变配置和行为。每次升级前请阅读[升级](/zh-cn/migrate/upgrading/)。
- **你希望由 CMS 渲染页面。** Verdin 是无头 CMS，需要搭配前端框架或静态站点生成器使用。
- **你需要托管服务。** Verdin 需要自行部署：在你自己的基础设施上运行二进制文件或 Docker 镜像。

## 下一步

- [快速开始](/zh-cn/start/quickstart/)：运行 Verdin，并从 API 读取第一条内容。
- [教程：用 Astro 搭建博客](/zh-cn/start/tutorial-astro/)或[用 Next.js 搭建](/zh-cn/start/tutorial-nextjs/)：基于示例博客构建前端。
- [内容模型](/zh-cn/concepts/content-model/)：内容类型、字段及其存储方式。
- [导入 Strapi 项目](/zh-cn/migrate/from-strapi/)：迁移现有项目。

