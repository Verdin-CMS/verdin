---
title: 托管的演示环境
description: 运行 Verdin 的公开演示：基于 SQLite 的博客示例，带有演示内容和演示账户，每小时清空并重新填充，来自 deploy/playground。
sidebar:
  order: 11
---

[`deploy/playground/`](https://github.com/verdin-cms/verdin/tree/main/deploy/playground) 构建一个用于公开演示的容器：基于 SQLite 的[博客示例](https://github.com/verdin-cms/verdin/tree/main/examples/blog)，带有几篇已发布的文章和一个访客可以登录的演示账户。它每小时丢弃数据库并重新开始。该容器不需要卷、数据库服务器，也不需要你提供任何密钥。托管在哪里由你决定；任何能运行单个容器并带有公开 HTTPS 地址的平台都可以。

这些脚本已于 2026-09-30 针对本地构建运行过（三个重置周期）；镜像已构建，但没有从已发布的版本运行过。

## 访客能得到什么

- 位于 `/admin/` 的管理后台，以 **demo@example.com** / **verdin-demo-1234** 登录。该账户拥有 **Editor** 角色：可以创建、编辑、发布和删除内容并上传媒体，但不能管理用户、角色、API 令牌、webhook 或设置。
- 通过 REST（`/api/articles?populate=*`）和 GraphQL 对文章、分类、标签和首页的公开读取权限。
- 两篇已发布的文章、一篇草稿、两个分类、两个标签和首页。

同时还存在一个 Super Admin，密码是随机的，没有人知道。

## 工作方式

`run.sh` 循环执行：

1. 删除 `/var/lib/verdin-playground`（数据库、上传内容、搜索索引、图片缓存）并生成新的密钥，因此上一个周期的会话会结束。
2. 启动 `verdin start --migrate` 并等待 `/_ready`。
3. 运行 `seed.sh`：通过命令行和管理 API 创建账户，开放公开读取权限并创建内容。
4. 等待 `PLAYGROUND_RESET_SECONDS`（3600），停止服务器并重新开始。如果服务器自行停止，则立即重新开始。

配置（`deploy/playground/verdin.toml`）把上传限制为 2 MB，对匿名请求按每个地址每分钟 300 次限速，让 webhook 投递远离私有地址，并启用搜索。

## 构建并运行

在仓库根目录下：

```sh frame="terminal"
docker build -f deploy/playground/Dockerfile -t verdin-playground .
docker run -p 1337:1337 --tmpfs /var/lib/verdin-playground:uid=65532,gid=65532 verdin-playground
```

该镜像基于 Alpine，带有 `curl` 和 `jq`（脚本需要 shell，而官方镜像没有），静态二进制文件复制自 `ghcr.io/verdin-cms/verdin`。传入 `--build-arg VERDIN_IMAGE=ghcr.io/verdin-cms/verdin:<version>` 可选择发布版本。`tmpfs` 让数据保存在内存中；没有它时数据保存在容器的文件系统中，同样可行。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PLAYGROUND_RESET_SECONDS` | `3600` | 两次重置之间的时间。 |
| `PLAYGROUND_EMAIL`、`PLAYGROUND_PASSWORD` | `demo@example.com`、`verdin-demo-1234` | 演示账户。 |
| `VERDIN_SERVER__PUBLIC_URL` | | 演示环境的公开地址。 |
| `VERDIN_SERVER__TRUSTED_PROXIES` | | 平台代理的地址范围，使速率限制按每位访客生效。 |

## 托管

只运行一个实例（数据库是本地的），保持它一直运行（不要缩容到零：重置计时器存在于进程中），并在前面放置 HTTPS：管理后台的会话 cookie 在 `start` 模式下是 `Secure` 的，因此登录需要 HTTPS。任何人都可以在长达一小时内写入内容和上传图片，所以请让链接到它的页面说明重置时间表，并让该实例使用一个与任何共享 cookie 的站点相互独立的域名。
