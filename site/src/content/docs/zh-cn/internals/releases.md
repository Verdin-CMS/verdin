---
title: 发布与文档托管
description: 发布工作流会发布什么（二进制文件、校验和、.deb 软件包、镜像、Homebrew、winget），每个可选任务需要的密钥，以及文档站点、它的域名和拉取请求预览是如何托管的。
sidebar:
  order: 9
---

本页面向维护者：推送版本标签时会发生什么、哪些部分需要密钥或账户，以及文档站点是如何发布的。

## 发布工作流

推送标签 `vX.Y.Z` 会运行 `.github/workflows/release.yml`：

| 任务 | 发布内容 | 需要 |
| --- | --- | --- |
| `admin`、`binaries` | 适用于 `x86_64`/`aarch64-unknown-linux-musl`、`x86_64`/`aarch64-apple-darwin` 和 `x86_64-pc-windows-msvc` 的 `verdin-vX.Y.Z-<target>.tar.gz`（Windows 上为 `.zip`）。每个压缩包有一个文件夹，里面是 `verdin` 和许可证。 | 无 |
| `deb` | `verdin_X.Y.Z-1_amd64.deb` 和 `_arm64.deb`，由 musl 二进制文件用 `cargo deb --no-build` 构建。 | 无 |
| `publish` | GitHub 发布：压缩包、软件包和 `SHA256SUMS`，附带该版本在 `CHANGELOG.md` 中对应部分的说明。 | 无 |
| `image` | 适用于 amd64 和 arm64 的 `ghcr.io/verdin-cms/verdin`。 | 无 |
| `npm` | `@verdin/client`。 | `NPM_TOKEN`（没有则跳过） |
| `homebrew` | tap 中的 `Formula/verdin.rb`，来自 `deploy/homebrew/verdin.rb.in`。 | `HOMEBREW_TAP_TOKEN`（没有则跳过） |
| `winget` | 向 `microsoft/winget-pkgs` 提交的拉取请求，包含 `deploy/winget/` 的清单。 | `WINGET_TOKEN`（没有则跳过） |

资源名称是一种约定：`install.sh`、`crates/verdin/Cargo.toml` 中的 `cargo binstall` 元数据、Homebrew formula 和 winget 清单都根据版本和目标构造它们。`deploy/render-template.sh` 会用版本和 `SHA256SUMS` 中的校验和填充 Homebrew 和 winget 模板，缺少任何一项时会失败。

## 可选任务的一次性设置

| 内容 | 位置 |
| --- | --- |
| **Homebrew tap。** 创建公开仓库 `verdin-cms/homebrew-tap`（这个名称使 `brew install verdin-cms/tap/verdin` 可用）。添加一个对它拥有 *Contents: read and write* 权限的细粒度令牌，作为 `HOMEBREW_TAP_TOKEN` 密钥。使用其他仓库时：设置 `HOMEBREW_TAP_REPOSITORY` 变量。 | 仓库的 Secrets 和 Variables |
| **winget。** `VerdinCMS.Verdin` 的首次提交由 winget 维护者审核。用提交者的账户 fork `microsoft/winget-pkgs`，并把该账户带有 `public_repo` 范围的经典令牌添加为 `WINGET_TOKEN`。 | 仓库的 Secrets |
| **npm。** `NPM_TOKEN`，`@verdin` 范围的自动化令牌。 | 仓库的 Secrets |
| **crates.io**（可选）。不带 `--git` 的 `cargo binstall verdin` 需要该 crate 位于 crates.io；在此之前文档使用 `--git`。 | — |
| **Railway 按钮**（可选）。在 railway.com 上基于仓库创建模板（配置路径 `deploy/one-click/railway.json`、一个 PostgreSQL 服务、`/data` 上的一个卷），并把它的按钮添加到 README 和[一键部署](/zh-cn/deploy/one-click/)中。 | railway.com |

Render 和 DigitalOcean 的按钮不需要项目一侧的账户：它们从默认分支读取 `render.yaml` 和 `.do/deploy.template.yaml`。

有些版本号写在文件里，并随每个次版本发布而变化：`deploy/one-click/Dockerfile`、`deploy/playground/Dockerfile`、`deploy/compose/` 和文档中的镜像标签，以及 `deploy/helm/verdin/Chart.yaml` 中的 `version`/`appVersion`。

## 文档站点

`.github/workflows/site.yml` 会在每次涉及 `site/` 的 `main` 推送时构建它，并把结果推送到 `gh-pages` 分支的根目录。GitHub Pages 提供该分支的服务（Settings → Pages → Source：*Deploy from a branch*，`gh-pages`，`/`）。

### 域名

站点位于何处由一个仓库变量 **`SITE_URL`** 决定：

| `SITE_URL` | 站点 |
| --- | --- |
| 未设置 | `https://verdin-cms.github.io/verdin/` |
| `https://docs.example.com` | 该域名的根路径 |
| `https://example.com/verdin` | 该域名下的 `/verdin` 路径 |

`site/scripts/repo.mjs` 从中取得 Astro 的 `site` 和 `base`，因此所有链接、资源和站点地图都会随之变化。如果设置了 `BASE_PATH`，它仍然会覆盖路径。对于自定义域名：

1. 把域名的 DNS 指向 GitHub Pages（子域名使用指向 `verdin-cms.github.io` 的 `CNAME` 记录）。
2. 在 Settings → Secrets and variables → Actions → Variables 中设置 `SITE_URL`。
3. 运行 Site 工作流（或推送到 `main`）。它会把 `CNAME` 文件写入分支，GitHub 会识别该域名；证书签发后请启用 *Enforce HTTPS*。

站点之外的链接（README、软件包元数据、Helm chart 的 `home`）保持 `verdin-cms.github.io/verdin` 地址，GitHub 会把它重定向到自定义域名。

### 拉取请求预览

每个涉及站点的拉取请求都会在 `<SITE_URL>/pr-preview/pr-<number>/` 获得一个预览，并在评论中给出链接：

1. `site-preview.yml` 在 `pull_request` 时运行。它以预览地址作为 `SITE_URL` 构建站点，并将其作为 artifact 上传。它运行的是拉取请求的代码，因此与来自 fork 的每个 `pull_request` 工作流一样，它只有只读令牌，没有密钥。
2. `site-preview-deploy.yml` 在该构建成功后于 `workflow_run` 时运行，处于本仓库的上下文中。它下载 artifact，检查拉取请求仍处于打开状态且构建针对的是它当前的 head，把文件复制到 `gh-pages` 上的 `pr-preview/pr-<number>/`，并更新评论。它从不检出或运行拉取请求的代码。
3. 拉取请求关闭时，同一个工作流（`pull_request_target`，只克隆 `gh-pages`）会删除该文件夹。

主部署会保留 `pr-preview/`，并且三者共用一个并发组，因此同一时间只有一个任务写入 `gh-pages`。

预览与文档使用同一个源提供。对于没有登录功能的静态站点，这是可以接受的，但在拉取请求关闭之前，来自 fork 的拉取请求可以在那里发布任意 HTML；请关闭滥用它的拉取请求。如果 fork 的工作流无法使用仓库变量，它的预览会按默认的 `SITE_URL` 构建，在自定义域名下链接会失效；来自本仓库分支的拉取请求的预览不受影响。

### 托管的演示环境

公开演示运行的是 `deploy/playground/` 的容器；参见[托管的演示环境](/zh-cn/deploy/playground/)。托管它不在仓库范围之内：任何能在 HTTPS 之后保持一个容器运行的平台都可以。
