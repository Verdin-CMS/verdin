---
title: 管理后台
description: Verdin 的 Angular 管理后台是如何组织的、它如何根据 schema 构建表单和列表，以及它如何构建、嵌入二进制文件并进行翻译。
sidebar:
  order: 6
  label: 管理后台
---

本页面向 `admin/` 中管理后台的贡献者：这个 Angular 应用如何组织、它如何把内容 schema 转换为表单和列表，以及它如何最终进入 `verdin` 二进制文件。如何使用管理后台请参见各篇指南；管理 API 服务端的工作方式请参见[管理 API 参考](/zh-cn/api/admin/)。

管理后台是一个 Angular 22 单页应用：standalone 组件、zoneless 变更检测、signal、懒加载路由，以及基于 Tailwind CSS v4 的 spartan/ui 组件。

## 结构

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

**状态**保存在 `core/` 中可注入服务内部的 signal 里（`Auth`、`Schema`、`I18n`、`Theme`……）。没有使用状态管理库。

**API 访问**通过 `core/api.ts` 进行，它是对 Angular `HttpClient` 的一个基于 Promise 的小型封装，类型则手写在 `core/types.ts` 中。运行时配置（管理后台路径、API 前缀、运行模式、品牌信息）来自服务器注入的 `<meta name="verdin-config">` 标签。

**会话。** 访问令牌只保存在内存中；刷新令牌是一个作用域限定于认证路由的 `HttpOnly` cookie。一个 HTTP 拦截器会添加 bearer 令牌，并在收到 `401` 时刷新一次后重试；如果刷新失败，就把用户送到登录页。刷新和退出登录请求会带上服务器要求的 `X-Verdin-CSRF` 请求头。路由守卫会在页面加载时根据 cookie 恢复会话。如果收到提示角色要求双因素认证的 `403`，就会把用户送去设置。

## 由 schema 驱动的表单

条目编辑器（`features/content/edit.ts`）没有针对具体类型的代码。它从 `GET /admin/api/content-types` 和 `GET /admin/api/components` 读取内容类型和组件，从编辑视图设置中读取编辑器布局，并在运行时用 **Signal Forms**（`@angular/forms/signals`）构建表单：

- 文档模型是一个包装普通对象的 signal（`fields/model.ts` 中的 `FormModel`）；字段树及其校验器由 schema 推导而来。
- 一个递归的 `vd-fields` 组件（`fields/fields.ts`）根据字段树渲染任意属性映射。文本、日期和时间使用以 `[formField]` 绑定的原生输入控件。自定义的 `FormValueControl` 负责处理数字（可为空；大整数保持为字符串）、开关、枚举、日期时间（输入框中为本地时间，模型中为 UTC）、JSON、Markdown、`blocks`（TipTap）、媒体、关联（边输入边搜索的选择器，支持排序）以及多态关联。
- 组件是嵌套的 fieldset；可重复组件和动态区域是可重新排序的列表。插件可以注册自定义字段类型，以自定义元素的形式渲染。
- `toModel` 把一个已 populate 的文档转换为表单模型（关联变为 `documentId`，文件变为 id），`toPayload` 则把它转换回 `data` 负载：空字符串变为 `null`，渲染用的键（`__key`）和只读的一侧（`mappedBy`、`morphOne`、`morphMany`）会被丢弃。两者都在 `fields/model.spec.ts` 中有单元测试。
- 由 schema 推导的校验会给出即时反馈。条件字段（`conditions.visible`）由服务器 JSON Logic 求值器的移植版本（`core/logic.ts`）在浏览器中求值。跨字段校验规则只由服务器检查。服务器始终是最终权威：其 `details.errors[].path` 条目会被映射回对应的字段。
- 保存是显式的，带有修改跟踪和离开页面警告（一个路由守卫加上 `beforeunload`）。**发布**、**取消发布** 和 **放弃更改** 按钮会根据文档的状态出现。管理后台只保存草稿；发布始终是一个单独的操作。

编辑器的布局（字段顺序、宽度、标签、描述、只读字段、用于命名关联条目的字段）由所有管理员共享，存储在服务器的 `vd_settings` 中，拥有 `views.manage` 权限的管理员可以在 **配置视图** 页面中修改它。

## 列表

内容列表（`features/content/list.ts`）使用 spartan helm 表格，并在服务端进行分页、排序和过滤。过滤条件、搜索（`_q`）和页码都会同步到 URL 中，因此过滤后的列表就是一个可以分享的链接。每位管理员可以按类型选择可见列、默认排序和每页条数（`list-view.ts`）；这些选择保存在服务器上各自的偏好设置中，因此会跟随管理员跨浏览器使用。列表还会根据管理后台事件流实时更新。

## 内容类型构建器

**内容类型构建器** 只有在服务器以开发模式（`verdin dev`）运行，并且管理员拥有 `schema.manage` 时才可见。它以文件格式编辑内容类型和组件：字段、关联种类和目标（会在目标上创建反向属性）、组件、动态区域、长度、范围，以及 `required`、`unique` 和 `private` 标志。

每次变更都会先发送到 `POST /admin/api/schema/plan`，它会校验变更后的 schema，并返回迁移步骤及其风险、SQL 以及用户可以接受的重命名建议。确认后会以接受的风险等级和重命名调用 `POST /admin/api/schema/apply`。服务器执行迁移、写入 `schema/*.json`，并在不重启的情况下把正在运行的应用切换为新的 schema。服务器端的具体过程请参见[迁移引擎](/zh-cn/internals/migrations/)。

## 构建和分发

- `ng build` 把生产构建写入 `admin/dist/admin/browser`，并带有 `<base href="/admin/">`。
- 以 `embed-admin` feature 编译时，服务器会用 `rust-embed` 嵌入该文件夹，发布构建和 Docker 镜像都使用这种方式。没有该 feature，或者设置了 `[admin].assets_dir` 时，它会从磁盘提供这些文件。`assets_dir` 优先于嵌入的构建。
- 服务器会把 `<base href>` 重写为 `[admin].path`，并以 `<meta>` 标签（而不是内联脚本）的形式注入运行时配置。修改 `admin.path` 永远不需要重新构建管理后台。
- 没有文件扩展名的未知路径会回退到 `index.html`，以支持客户端路由。带指纹的打包文件（`main-ABC123.js`）以 `immutable` 缓存一年；其他所有文件都是 `no-cache`。
- 每个管理后台响应都带有严格的内容安全策略（`script-src 'self'`、`frame-ancestors 'none'`、`base-uri 'self'`……）、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff` 和 `Referrer-Policy: strict-origin-when-cross-origin`。`angular.json` 中关闭了 Angular 的关键 CSS 内联，因为它依赖于该策略所禁止的内联事件处理器。

进行前端开发时，先运行服务器，然后在 `admin/` 中运行 `npm start`：`ng serve` 会把 `/admin/api` 和 `/api` 代理到 `http://localhost:1337`（`admin/proxy.conf.json`）。

## 翻译

管理后台在运行时用 Transloco 翻译，而不是使用 Angular 的编译期 i18n，因此一次构建就能服务所有语言，用户切换语言也无需重新加载。

- 语言包是 `admin/public/i18n/` 中的扁平 JSON 文件（`en.json` 是源文件），按需加载。
- 消息使用 ICU MessageFormat（`{name}`、`{count, plural, one {# entry} other {# entries}}`），通过一个自定义的 Transloco 转译器由 FormatJS（`intl-messageformat`）解释。FormatJS 是解释消息而不是把它们编译为函数，因此 CSP 不需要 `unsafe-eval`。
- 消息键的类型由 `en.json` 生成（`core/i18n/keys.ts`）：使用不存在的键会导致编译错误。
- `npm run i18n:check` 会对照 `en.json` 检查每个语言包：相同的键、有效的 ICU 语法、相同的参数，以及该语言的每个复数类别。CI 会运行它。
- `I18n` 服务还提供感知语言区域的格式化以及一周的第一天，这些取自浏览器的区域设置，每个用户也可以自行覆盖。

如何添加或更新一种语言，请参见[翻译](/zh-cn/project/translating/)。
