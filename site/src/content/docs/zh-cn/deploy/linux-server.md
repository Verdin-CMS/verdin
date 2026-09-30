---
title: Linux 服务器
description: 使用 .deb 软件包在 Debian 或 Ubuntu 服务器上运行 Verdin：一个 systemd 服务、一个 verdin 系统用户、位于 /var/lib/verdin 的状态，并置于反向代理之后。
sidebar:
  order: 3
---

本页在 Debian 或 Ubuntu 服务器上直接运行 Verdin（不使用容器），使用每个发布都附带的 `.deb` 软件包。在其他发行版上，使用[安装脚本](/zh-cn/start/installation/)安装的二进制文件，并手动复制 [`deploy/deb/`](https://github.com/verdin-cms/verdin/tree/main/deploy/deb) 下的文件，也可以采用同样的布局。

该软件包已于 2026-09-30 用 `cargo deb` 构建并检查过；本指南没有把它安装到真实服务器上。

## 软件包会安装什么

| 路径 | 说明 |
| --- | --- |
| `/usr/bin/verdin` | 二进制文件（静态，内置管理后台）。 |
| `/etc/verdin/verdin.toml` | 配置（一个 conffile：升级时会保留你的修改）。 |
| `/etc/verdin/verdin.env` | 首次安装时创建，权限 `0640`：全新的 `VERDIN_ADMIN_JWT_SECRET` 和 `VERDIN_TOKEN_PEPPER`，以及 `VERDIN_DATABASE_URL`（默认为 SQLite）。 |
| `/var/lib/verdin/` | `verdin` 系统用户的主目录：SQLite 数据库、`schema/`、`uploads/`、搜索索引和图片缓存。 |
| `/usr/lib/systemd/system/verdin.service` | 服务，已安装但未启用。 |

该服务以 `verdin` 用户身份运行 `verdin -c /etc/verdin/verdin.toml start --migrate`，带有 systemd 的沙箱（只读系统、私有 `/tmp`、禁止获取新权限），并且只对 `/var/lib/verdin` 有写权限。它监听 `127.0.0.1:1337`。

## 1. 安装

```sh frame="terminal"
curl -fsSLO https://github.com/verdin-cms/verdin/releases/download/v0.11.0/verdin_0.11.0-1_amd64.deb
sudo apt install ./verdin_0.11.0-1_amd64.deb
```

在 ARM 服务器上，请在文件名中使用 `arm64`。

## 2. 配置

1. 把你已提交的 schema 复制到 `/var/lib/verdin/schema/`（`content-types/` 和 `components/`），所有者为 `verdin`：

   ```sh frame="terminal"
   sudo rsync -a --chown=verdin:verdin schema/ /var/lib/verdin/schema/
   ```

2. 如果使用 PostgreSQL、MySQL 或 MariaDB，请编辑 `/etc/verdin/verdin.env` 中的 `VERDIN_DATABASE_URL`。请保留那两个密钥：新的 `VERDIN_TOKEN_PEPPER` 会使所有 API 令牌失效。
3. 在 `/etc/verdin/verdin.toml` 中，把 `[server].public_url` 设置为浏览器使用的地址；当反向代理运行在同一台机器上时，设置 `trusted_proxies = ["127.0.0.1"]`。其他所有键都在[配置参考](/zh-cn/reference/configuration/)中。

## 3. 启动

```sh frame="terminal"
sudo systemctl enable --now verdin
journalctl -u verdin -f
```

首次启动会创建数据表。请在命令行中创建第一个管理员（服务的环境文件中保存着数据库 URL）：

```sh frame="terminal"
sudo -u verdin sh -c 'set -a; . /etc/verdin/verdin.env; verdin -c /etc/verdin/verdin.toml admin create --email you@example.com'
```

或者通过你的代理打开管理后台并在那里注册。

## 4. 在前面放置反向代理

Verdin 在回环接口上提供纯 HTTP。使用会自己获取并续期证书的 Caddy：

```text title="/etc/caddy/Caddyfile"
cms.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:1337
}
```

nginx 同样可以；请对 `/api/_events` 关闭缓冲，这样实时事件才不会被延迟（`proxy_buffering off;`）。

## 升级和移除

- **升级：** 用 `apt install ./verdin_….deb` 安装下一个发布的 `.deb`。如果服务正在运行，它会重启，并且 `start --migrate` 会应用安全的迁移。请先阅读[升级](/zh-cn/migrate/upgrading/)。
- **移除：** `apt remove verdin` 会停止服务，但保留数据和配置；`apt purge verdin` 还会删除 `/etc/verdin/verdin.env`（即密钥）。软件包从不删除 `verdin` 用户和 `/var/lib/verdin`：请在有了[备份](/zh-cn/deploy/backups/)之后自行移除它们。
