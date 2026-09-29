---
title: "权限"
description: "Verdin 访问控制的全貌：管理员角色和 RBAC（包括字段和语言区域权限）、公开角色、API 令牌以及终端用户角色。"
sidebar:
  order: 6
---

Verdin 分别管理两类访问者：**管理员**，他们登录管理后台；以及**内容 API 调用方**，他们从你的网站和应用读写内容。本页说明两者各自如何授权，以及各部分如何协同工作。完整的操作列表请参见[权限参考](/zh-cn/reference/permissions/)。

| 谁 | 身份验证方式 | 权限来源 | 适用范围 |
| --- | --- | --- | --- |
| 管理员 | 邮箱和密码（外加第二因素或 SSO） | 其[角色](#管理员角色) | 管理后台和[管理 API](/zh-cn/api/admin/) |
| 匿名调用方 | 不带 `Authorization` 请求头 | [公开访问](#公开访问) | REST、GraphQL、实时 |
| 服务器或构建过程 | `Authorization: Bearer vd_…` | [API 令牌](#api-令牌)的类型 | REST、GraphQL、实时 |
| 已登录的终端用户 | `Authorization: Bearer <JWT>` | 其[终端用户角色](#终端用户) | REST、GraphQL、实时 |

默认情况下一切都是关闭的：在你授予访问权限之前，内容 API 一律返回 `403`，管理员也只能执行其角色允许的操作。

## 管理员角色

一个管理员拥有一个或多个角色，各角色的权限叠加。内置三个角色：

| 角色 | 可以 |
| --- | --- |
| **Super Admin** | 一切操作，包括用户、角色和 API 令牌。不可编辑。 |
| **Editor** | 读取、创建、更新、删除和发布所有内容；使用媒体库；触发部署；管理 SEO、重定向、菜单和表单。 |
| **Author** | 创建内容，只能读取、更新和删除自己创建的条目。不能发布。可以上传文件，只能编辑或删除自己的文件。 |

其他角色在 **设置 → 角色** 中创建（需要 `roles.manage` 权限）。最后一个处于活动状态的 Super Admin 不能被停用、删除或降级，因此实例永远不会把自己锁在门外。角色还可以要求其成员设置[双因素认证](/zh-cn/guides/auth/two-factor/)：在完成设置之前，他们只能访问自己的个人资料。

### 权限是什么

一个权限由一个**操作**、（对内容操作而言）一个**对象**以及可选的**条件**组成：

- **内容操作**：`content.read`、`content.create`、`content.update`、`content.delete` 和 `content.publish`，作用于某个内容类型（`api::article`）或全部内容类型（`*`）。
- **媒体操作**：`media.read`、`media.create`、`media.update` 和 `media.delete`，作用于媒体库。
- **设置操作**，例如 `users.manage`、`tokens.manage`、`webhooks.manage` 或 `features.manage`，用于打开 **设置** 中的对应页面。
- **条件**：`is-creator` 把内容或媒体权限限定于该管理员自己创建的内容。Author 角色就是这样实现的。

条件会成为数据库查询的一部分：按 `is-creator` 过滤的列表能正确计数和分页，而不是事后再隐藏行。

### 字段和语言区域权限

内容权限还可以进一步收窄：

- **字段。** `content.read`、`content.create` 和 `content.update` 可以列出它们涵盖的属性。列表之外的字段在读取时会被隐藏（包括搜索、过滤、排序和关联条目），在写入时会被拒绝。
- **语言区域。** 在[本地化类型](/zh-cn/concepts/internationalization/)上，内容权限可以列出它们涵盖的语言区域。其他语言区域的版本无法读取或修改。

两者都在角色编辑器中按内容类型设置，分别位于 **字段** 和 **语言** 下。

## 内容 API

内容 API 调用方按授权进行检查：授权即某个**对象**上的一个**操作**。

| 操作 | 允许 |
| --- | --- |
| `find` | 列出文档（`GET /api/articles`），或读取单一类型。 |
| `findOne` | 读取一个文档（`GET /api/articles/{documentId}`）。 |
| `create` | `POST` |
| `update` | `PUT` |
| `delete` | `DELETE` |
| `publish` | `actions/publish`、`actions/unpublish` 和 `actions/discard-draft` 路由。 |
| `readDrafts` | 以 `status=draft` 读取。 |

对象包括内容类型、媒体库（`plugin::upload`），以及启用[终端用户](/zh-cn/guides/auth/end-users/)时的终端用户账户（`plugin::users-permissions.user`）。

有几条规则对所有调用方都成立：

- 读取草稿除了 `find` 或 `findOne` 之外还需要 `readDrafts`。用于读取网站内容的授权不会意外读取到未发布的内容。
- 通过关联进行 populate、过滤或排序，需要对其目标类型的读取权限。
- 无论授权如何，`private` 字段都不会返回。
- 与 Strapi 一样，即使没有 `find`，写入也会返回写入后的文档。
- 同样的授权适用于 [GraphQL](/zh-cn/api/graphql/) 和[实时事件流](/zh-cn/api/realtime/)。

### 公开访问

不带 `Authorization` 请求头的请求获得 **设置 → 公开访问** 中的授权。默认不授予任何权限。常见的做法是对网站展示的类型授予 `find` 和 `findOne`。

### API 令牌

API 令牌供服务器、构建步骤和脚本使用。在 **设置 → API 令牌** 中创建（需要 `tokens.manage` 权限）：

| 类型 | 授权 |
| --- | --- |
| **只读** | 所有类型上的 `find` 和 `findOne`。从不读取草稿。 |
| **完全访问** | 所有类型上的所有操作，包括草稿。 |
| **自定义** | 你选择的授权，与公开访问的设置方式相同。 |

- 令牌以 `vd_` 开头。其密文只在创建或重新生成时显示一次；Verdin 只存储它的带密钥哈希。
- 令牌可以设置过期时间。未知、过期或格式错误的令牌返回 `401`：它绝不会回退为公开访问。
- 任何有效的令牌都可以读取 `/api/_openapi.json` 上的 OpenAPI 文档，除非你把文档设为公开。

如何创建和轮换令牌，请参见 [API 令牌](/zh-cn/guides/auth/api-tokens/)。

### 终端用户

终端用户是登录你的网站或应用的人，与 Strapi 的 users-permissions 插件相同。该功能默认关闭。每个账户有一个角色：

- **Public** 是不带令牌的请求所用的角色：其授权就是 **设置 → 公开访问** 中的授权。
- **Authenticated** 默认授予新账户。
- 自定义角色可以包含任意一组授权，使用与上文相同的操作。

终端用户以 `Authorization: Bearer <jwt>` 的形式发送登录时获得的 JWT。Verdin 通过 `vd_` 前缀将其与 API 令牌区分开来。参见[终端用户](/zh-cn/guides/auth/end-users/)。

## 与 Strapi 对比

该模型遵循 Strapi v5：带有 `is-creator` 条件的管理员 RBAC，以及带有公开访问、API 令牌和 users-permissions 角色的内容 API。不同之处：

- 所有功能对所有项目开放：自定义角色、字段和语言区域权限、[SSO](/zh-cn/guides/auth/sso/) 以及[审计日志](/zh-cn/guides/content/audit-logs/)。
- 通过内容 API 读取草稿有独立的授权 `readDrafts`。
- 通过 REST 发布有独立的授权 `publish` 和独立的路由。
