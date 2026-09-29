---
title: 备份
description: 通过数据库转储和媒体存储副本备份 Verdin 项目，或者用 verdin export 和 verdin import verdin 迁移项目。
sidebar:
  order: 9
---

Verdin 项目的数据存放在两个地方：**数据库**（内容、管理员、角色、令牌、设置、历史记录、审计日志）和**媒体存储**（媒体库中的文件，位于磁盘或存储桶中）。schema 文件在你的代码仓库中。请同时备份这两处存储；`verdin export` 还能额外生成一份可移植的内容归档。

| 方式 | 包含 | 用途 |
| --- | --- | --- |
| 数据库转储 + 媒体副本 | 全部内容 | 同一项目的灾难恢复 |
| `verdin export` | schema、语言区域、媒体、每个条目的每个版本 | 把内容迁移到另一个实例或另一种数据库引擎；一份额外的可移植副本 |

## 数据库转储

使用数据库自带的工具，或者服务商提供的自动备份：

```sh frame="terminal"
# PostgreSQL
pg_dump --format=custom --file=verdin-$(date +%F).dump "$VERDIN_DATABASE_URL"

# MySQL / MariaDB
mysqldump --single-transaction --routines -h <host> -u <user> -p <database> > verdin-$(date +%F).sql

# SQLite：在服务器运行时获得一致的副本
sqlite3 /data/verdin.db ".backup '/backups/verdin-$(date +%F).db'"
```

不要用 `cp` 复制正在使用的 SQLite 文件：请使用 `.backup`（或者先停止服务器）。

转储中包含密码哈希、API 令牌哈希和 private 字段。请对其加密，并存放在远离它所保护的服务器的地方。恢复转储时，还需要相同的 `VERDIN_TOKEN_PEPPER` 和 `VERDIN_ADMIN_JWT_SECRET`：没有 pepper，API 令牌和管理员的身份验证器应用验证码都将失效。

## 媒体存储

- **本地提供方**：在数据库转储之后，用常规的文件备份方式复制上传目录（`[upload].provider.dir`，Docker 镜像中为 `/data/uploads`），这样转储所引用的文件就不会缺失。
- **S3 提供方**：在存储桶上开启版本控制或复制，或者用服务商的工具复制它。

图片转换缓存和搜索索引可以重建，无需备份。

## `verdin export`

`verdin export` 把项目的 schema、内容和媒体写入一个 `.tar.gz`，`verdin import verdin` 则可以把它恢复到同一个项目或另一个实例中，适用于任何数据库引擎。

```sh frame="terminal"
verdin export backup-2026-09-28.tar.gz            # schema、语言区域、媒体和条目
verdin export content-only.tar.gz --no-media      # 不含媒体文件
verdin import verdin backup-2026-09-28.tar.gz     # 导入到当前项目
```

请使用项目的配置运行它们（与服务器相同的 `verdin.toml` 和环境变量）。在容器中：`docker compose exec verdin verdin export /data/backup.tar.gz`。

### 包含哪些内容

- **schema 文件**，原样包含。
- **语言区域。** 空项目会获得全部语言区域，包括默认语言区域。已有语言区域的项目只会获得缺少的那些。
- **媒体文件夹和文件**，以及它们的响应式格式。文件保留其 `documentId`；数字 id 会改变。
- **每个条目的每个版本**：草稿、已发布版本和所有语言区域，以及它们的日期、关联（按 `documentId`）和媒体，包括组件和动态区域内的关联和媒体。private 字段和密码哈希也包含在内。

**不包含**：管理员用户、角色、API 令牌、webhook、功能设置、审核工作流和发布计划。请在目标上重新创建它们，或者改为恢复数据库转储。

:::caution
导出文件包含 private 字段和密码哈希。请像对待数据库转储一样存放它。
:::

### 导入

1. 导入会写入 schema 文件，并只用安全步骤迁移数据库。
2. 如果已存在内容不同的 schema 文件，导入会停止，除非传入 `--force`。
3. 如果内容类型中已有条目，导入同样会停止，除非传入 `--force`；此时条目会被添加到现有条目旁边。
4. 导入的文档保留其 `documentId`，因此导入到已包含相同文档的项目会失败。

导入不会触发 webhook 或插件钩子，也不会写入历史记录。

### 归档格式

一个 gzip 压缩的 tar 归档：

| 路径 | 内容 |
| --- | --- |
| `manifest.json` | `format: "verdin-export"`、格式版本、Verdin 版本、各内容类型的版本 |
| `schema/…` | schema 文件 |
| `locales.json` | `{ default, locales: [{ code, name }] }` |
| `folders.json`、`files.jsonl` | 媒体文件夹和文件，每行一个 JSON 对象 |
| `assets/{hash}{ext}` | 文件及其各格式的存储对象 |
| `entries/{uid}.jsonl` | 每行一个版本：`documentId`、`locale`、`published`、日期、`data`、`relations`、`media` |

如果要导入 Strapi 项目，请参见[从 Strapi 迁移](/zh-cn/migrate/from-strapi/)。

## 测试恢复

时不时地恢复到一个临时数据库中，用 `verdin start` 在其上启动 Verdin，检查能否登录以及能否读取条目和媒体。
