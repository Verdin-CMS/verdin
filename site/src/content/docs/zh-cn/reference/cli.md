---
title: 命令行参考
description: verdin 二进制文件的每个命令、子命令和参数，以及它们读取、写入和输出的内容。
sidebar:
  order: 2
  label: 命令行
---

<!-- Written from crates/verdin/src/cli.rs and crates/verdin/src/new.rs. `npm run check-cli`
(site/scripts/check-cli.mjs) fails when a subcommand or flag in cli.rs is missing here. -->

`verdin` 是唯一的二进制文件：它可以创建项目、运行服务器、执行迁移、管理管理员用户以及导入导出内容。本页列出每个命令和参数。

```text title="Terminal"
verdin [OPTIONS] <COMMAND>
```

| 命令 | 作用 |
| --- | --- |
| [`verdin new`](#verdin-new) | 创建一个项目目录。 |
| [`verdin dev`](#verdin-dev) | 以开发模式运行服务器。 |
| [`verdin start`](#verdin-start) | 以生产模式运行服务器。 |
| [`verdin schema check`](#verdin-schema-check) | 校验 schema 文件。 |
| [`verdin migrate plan`](#verdin-migrate-plan) | 显示迁移步骤及其 SQL。 |
| [`verdin migrate apply`](#verdin-migrate-apply) | 执行迁移步骤。 |
| [`verdin admin create`](#verdin-admin-create) | 创建一个 Super Admin。 |
| [`verdin admin reset-password`](#verdin-admin-reset-password) | 设置某个管理员的密码。 |
| [`verdin types`](#verdin-types) | 生成内容 API 的 TypeScript 定义。 |
| [`verdin import strapi`](#verdin-import-strapi) | 导入 Strapi 导出文件。 |
| [`verdin import verdin`](#verdin-import-verdin) | 导入 Verdin 导出文件。 |
| [`verdin export`](#verdin-export) | 把项目写入一个 `.tar.gz` 归档。 |
| [`verdin healthcheck`](#verdin-healthcheck) | 检查本地服务器是否响应。 |
| [`verdin secrets`](#verdin-secrets) | 输出新的密钥。 |
| [`verdin version`](#verdin-version) | 输出版本号。 |

## 全局选项

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `-c, --config <CONFIG>` | `verdin.toml` | 项目的配置文件。也可以从 `VERDIN_CONFIG` 读取。项目根目录就是该文件所在的目录：schema、插件、上传文件以及相对的 SQLite 路径都相对于它解析。 |
| `-h, --help` | | 输出该命令的帮助。 |
| `-V, --version` | | 输出版本号。 |

`verdin help <COMMAND>` 输出的帮助与 `--help` 相同。

除 `new`、`secrets` 和 `version` 之外，每个命令都会先加载项目：

1. 读取配置文件旁边的 `.env` 文件（如果存在）。环境中已设置的变量优先。
2. 加载 `verdin.toml`（可选）以及 `VERDIN_*` 覆盖项。参见[配置参考](/zh-cn/reference/configuration/)。
3. 按照 `[log]` 和 `RUST_LOG` 开始向标准错误输出写日志。

打开数据库的命令需要 `VERDIN_DATABASE_URL` 或 `[database].url`。涉及管理员账户或运行服务器的命令还需要 `VERDIN_ADMIN_JWT_SECRET` 和 `VERDIN_TOKEN_PEPPER`。

## `verdin new`

```text title="Terminal"
verdin new <DIR> [--database <DATABASE>]
```

在 `DIR` 中创建一个项目，该目录必须不存在或为空：

| 文件 | 内容 |
| --- | --- |
| `verdin.toml` | 带有默认值的 `[server]`、`[api]` 和 `[admin]`。 |
| `.env` | `VERDIN_DATABASE_URL`，以及新生成的 `VERDIN_ADMIN_JWT_SECRET` 和 `VERDIN_TOKEN_PEPPER`。只有你可以读取（Unix 上为 `0600` 模式）。 |
| `.gitignore` | `.env`、`data/`、SQLite 文件和 `.cache/`。 |
| `schema/content-types/`、`schema/components/` | 空的 schema 目录。 |
| `data/` | 用于存放 SQLite 数据库（仅限 SQLite）。 |

| 参数或选项 | 默认值 | 说明 |
| --- | --- | --- |
| `<DIR>` | | 要创建的目录。 |
| `--database <DATABASE>` | `sqlite` | `.env` 所指向的数据库：`sqlite`、`postgres`、`mysql` 或 `mariadb`。 |

使用 `sqlite` 时，URL 为 `sqlite://data/verdin.db`。使用其他数据库时，URL 指向本地服务器，用户为 `verdin`，密码为 `change-me`，数据库以目录名命名（小写字母、数字和 `_`）：启动之前请修改它。

```text title="Terminal"
$ verdin new blog --database postgres
created blog

  cd blog
  verdin dev

then open http://localhost:1337/admin/ to register the first admin
```

## `verdin dev`

```text title="Terminal"
verdin dev
```

以开发模式运行服务器。与 `verdin start` 相比：

- 风险等级为 `safe` 的待处理迁移会在启动时执行。风险更高的步骤会让服务器停止；请用 [`verdin migrate plan`](#verdin-migrate-plan) 审查它们。
- 管理后台的 **内容类型构建器** 可以编辑 schema 文件，服务器会重新加载 schema。
- 刷新 cookie 不会标记为 `Secure`（除非 `[admin].secure_cookies` 另有设置），因此你可以通过普通 HTTP 登录。
- webhook 和部署目标可以调用回环地址和私有地址（除非 `[webhooks].allow_private_networks` 另有设置）。

按 Ctrl+C 或收到 `SIGTERM` 时停止。

## `verdin start`

```text title="Terminal"
verdin start [--migrate]
```

以生产模式运行服务器。数据库落后于 schema 时它会拒绝启动，因此部署永远不会修改你未审查过的表。

| 选项 | 说明 |
| --- | --- |
| `--migrate` | 启动前执行待处理的 `safe` 迁移步骤。有风险和破坏性的步骤仍然需要 `verdin migrate apply`。 |

开始监听之前，它会检查配置（`[api].prefix` 和 `[admin].path` 形如 `/api`、每页大小的设置彼此一致、`[server].trusted_proxies` 和 `[api].cors_origins` 可以解析），并创建内置角色。当 `[admin].secure_cookies` 为 `false` 或 `[email].provider` 为 `log` 时，它会记录一条警告。还没有任何管理员时，它会记录管理后台的地址，第一个访问者会在那里注册第一个 Super Admin。

按 Ctrl+C 或收到 `SIGTERM` 时停止。

## `verdin schema check`

```text title="Terminal"
verdin schema check
```

校验 schema 文件（`[schema].path`），不触碰数据库。它会输出一份摘要，或者以错误失败，每个错误都带有其文件和属性路径：

```text title="Terminal"
$ verdin schema check
schema ok: 4 content types, 3 components
```

请在部署前的 CI 中使用它。每种属性接受什么，请参见[属性类型](/zh-cn/reference/attribute-types/)。

## `verdin migrate plan`

```text title="Terminal"
verdin migrate plan [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

比较数据库与 schema，并输出 `verdin migrate apply` 将要做的事情，不做任何修改：编号的步骤，每个步骤带有其风险等级和 SQL。无事可做时输出 `database is up to date`。

| 选项 | 说明 |
| --- | --- |
| `--rename-table <OLD=NEW>` | 把表 `OLD` 视为重命名为 `NEW`（保留其行），而不是删除一张表再创建另一张。可重复使用。 |
| `--rename-column <TABLE.OLD=NEW>` | 把 `TABLE` 的列 `OLD` 视为重命名为 `NEW`（保留其值）。`TABLE` 是表的新名称。可重复使用。 |

风险等级：

| 等级 | 含义 |
| --- | --- |
| `safe` | 不会丢失数据，也不会因现有行而失败：新表、可为空或带默认值的新列、重命名、非唯一索引。 |
| `risky` | 可能因现有行而失败或转换值：列类型变更、不可为空且没有默认值的新列、已有表上的唯一索引。 |
| `destructive` | 删除列或表。 |

当某个步骤高于 `safe` 时，计划末尾会给出所需的参数（`requires: verdin migrate apply --allow risky`）。当被删除的列或表看起来像是被重命名时，它会列出需要传入的重命名参数。当上一次迁移被中断时，它会显示已应用了多少步骤以及最后一个错误。

```text title="Terminal"
verdin migrate plan --rename-column articles.summary=excerpt
```

参见 [Schema 迁移](/zh-cn/concepts/schema-migrations/)。

## `verdin migrate apply`

```text title="Terminal"
verdin migrate apply [--allow <ALLOW>] [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

执行计划。它接受与 `verdin migrate plan` 相同的重命名选项；请传入你审查过的那些。

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `--allow <ALLOW>` | `safe` | 要执行的最高风险等级：`safe`、`risky` 或 `destructive`。包含高于该等级的步骤的计划会在执行任何操作之前被拒绝。 |
| `--rename-table <OLD=NEW>` | | 与 `verdin migrate plan` 中相同。 |
| `--rename-column <TABLE.OLD=NEW>` | | 与 `verdin migrate plan` 中相同。 |

它会输出 `applied N steps` 或 `database is up to date`。发生中断后（连接丢失、某个步骤失败），修复原因后再次运行：它会从未完成的步骤继续。

## `verdin admin create`

```text title="Terminal"
verdin admin create --email <EMAIL>
```

创建一个 Super Admin。密码从 `VERDIN_ADMIN_PASSWORD` 读取，未设置时从标准输入读取。数据库必须与 schema 保持同步。

| 选项 | 说明 |
| --- | --- |
| `--email <EMAIL>` | 新管理员的邮箱地址。 |

```text title="Terminal"
$ VERDIN_ADMIN_PASSWORD='a long passphrase' verdin admin create --email ada@example.com
created Super Admin ada@example.com (id 1)
```

在服务器还无法通过浏览器访问时，可以用它创建第一个管理员；否则，管理后台的第一个访问者会注册它。

## `verdin admin reset-password`

```text title="Terminal"
verdin admin reset-password --email <EMAIL>
```

设置某个管理员的密码，解锁因登录失败而被锁定的账户，并结束其所有会话。密码的读取方式与 `verdin admin create` 相同。

| 选项 | 说明 |
| --- | --- |
| `--email <EMAIL>` | 该管理员的邮箱地址。 |

它不会移除第二因素；拥有 **管理用户** 的管理员可以在 **设置 → 用户** 中重置它们。

## `verdin types`

```text title="Terminal"
verdin types [-o <OUT>]
```

根据 schema 生成内容 API 的 TypeScript 定义（每个内容类型和组件一个接口），并输出到标准输出。它不需要数据库。

| 选项 | 说明 |
| --- | --- |
| `-o, --out <OUT>` | 改为写入该文件。 |

```text title="Terminal"
verdin types --out ../web/src/verdin.d.ts
```

参见[类型化客户端](/zh-cn/guides/frontend/typed-client/)。

## `verdin import strapi`

```text title="Terminal"
verdin import strapi <PATH> [--schema-only] [--force]
```

从用 `strapi export --no-encrypt` 生成的导出文件导入 Strapi v4 或 v5 项目：`.tar.gz`、`.tar` 或解包后的目录。它会把内容类型和组件写为 schema 文件，然后导入条目、语言区域、媒体、关联和文件夹。

| 参数或选项 | 说明 |
| --- | --- |
| `<PATH>` | 导出文件或目录。 |
| `--schema-only` | 只写入 schema 文件。 |
| `--force` | 覆盖已有的 schema 文件，并导入到已有条目的内容类型中。 |

它会输出写入和导入的内容，对无法迁移的内容给出警告，并在项目根目录中写入 `strapi-id-map.json`：Strapi 的 id 以及它们对应的新 Verdin `documentId` 和文件 id，用于修正前端中的链接。

参见[从 Strapi 迁移](/zh-cn/migrate/from-strapi/)。

## `verdin import verdin`

```text title="Terminal"
verdin import verdin <PATH> [--force]
```

导入由 `verdin export` 写出的归档：schema 文件、语言区域、媒体和条目。

| 参数或选项 | 说明 |
| --- | --- |
| `<PATH>` | `.tar.gz` 文件。 |
| `--force` | 覆盖内容不同的 schema 文件，并导入到已有条目的内容类型中。 |

## `verdin export`

```text title="Terminal"
verdin export <OUTPUT> [--no-media]
```

把项目的 schema、内容和媒体写入一个 `.tar.gz` 归档：可以作为备份，也可以用 `verdin import verdin` 把项目迁移到另一个实例。归档包含每个条目的每个版本（草稿、已发布版本、各语言区域）及其关联。不包含管理员账户、API 令牌和设置。

| 参数或选项 | 说明 |
| --- | --- |
| `<OUTPUT>` | 要写入的归档。 |
| `--no-media` | 不包含媒体库：文件、文件夹以及条目指向它们的链接。 |

```text title="Terminal"
$ verdin export backup.tar.gz
exported to backup.tar.gz: 42 documents (57 versions), 18 files, 3 folders, 2 locales
```

参见[备份](/zh-cn/deploy/backups/)。

## `verdin healthcheck`

```text title="Terminal"
verdin healthcheck [--port <PORT>]
```

向本机上的服务器（`127.0.0.1`，配置中的 `[server].port`）请求 `GET /_health`，响应为 `200` 时以状态码 0 退出，否则以 1 退出并输出原因。它不需要 shell、`curl` 或 HTTP 客户端，因此 Docker 镜像将其用作 `HEALTHCHECK`；在 Compose 或任何运行命令的进程管理器中也可以同样使用。

| 选项 | 说明 |
| --- | --- |
| `--port <PORT>` | 检查该端口，而不是 `[server].port`。 |

```text title="Terminal"
$ verdin healthcheck
ok
```

参见[监控](/zh-cn/deploy/monitoring/)。

## `verdin secrets`

```text title="Terminal"
verdin secrets
```

输出新生成的 `VERDIN_ADMIN_JWT_SECRET` 和 `VERDIN_TOKEN_PEPPER`，可直接用于 `.env` 文件或平台的密钥存储。它不读取任何项目。

更换 `VERDIN_ADMIN_JWT_SECRET` 会使管理员和终端用户的短期访问令牌、已打开的预览链接以及正在进行的 OAuth 登录失效；管理后台和使用刷新令牌的客户端会自动获取新的令牌。更换 `VERDIN_TOKEN_PEPPER` 会使已存储的令牌（包括 API 令牌）失效，因此一旦投入使用就请保持不变。

## `verdin version`

```text title="Terminal"
verdin version
```

输出 `verdin` 和版本号，与 `verdin --version` 相同。
