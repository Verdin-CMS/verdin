---
title: リリースとドキュメントのホスティング
description: リリースのワークフローが公開するもの（バイナリ、チェックサム、.deb パッケージ、イメージ、Homebrew、winget）、任意のジョブごとに必要なシークレット、そしてドキュメントサイトとそのドメイン、プルリクエストのプレビューのホスト方法を説明します。
sidebar:
  order: 9
---

このページはメンテナー向けです。バージョンのタグをプッシュしたときに何が起きるか、どの部分にシークレットやアカウントが必要か、そしてドキュメントサイトがどう公開されるかを説明します。

## リリースのワークフロー

タグ `vX.Y.Z` をプッシュすると、`.github/workflows/release.yml` が実行されます。

| ジョブ | 公開するもの | 必要なもの |
| --- | --- | --- |
| `admin`、`binaries` | `x86_64`/`aarch64-unknown-linux-musl`、`x86_64`/`aarch64-apple-darwin`、`x86_64-pc-windows-msvc` 向けの `verdin-vX.Y.Z-<target>.tar.gz`（Windows では `.zip`）。各アーカイブには、`verdin` とライセンスが入った 1 つのフォルダーがあります。 | なし |
| `deb` | `verdin_X.Y.Z-1_amd64.deb` と `_arm64.deb`。musl のバイナリから `cargo deb --no-build` でビルドします。 | なし |
| `publish` | GitHub のリリース。アーカイブ、パッケージ、`SHA256SUMS` と、そのバージョンの `CHANGELOG.md` のセクションのノート。 | なし |
| `image` | amd64 と arm64 向けの `ghcr.io/verdin-cms/verdin`。 | なし |
| `npm` | `@verdin/client`。 | `NPM_TOKEN`（なければスキップ） |
| `homebrew` | tap の `Formula/verdin.rb`。`deploy/homebrew/verdin.rb.in` から生成します。 | `HOMEBREW_TAP_TOKEN`（なければスキップ） |
| `winget` | `deploy/winget/` のマニフェストを持つ `microsoft/winget-pkgs` へのプルリクエスト。 | `WINGET_TOKEN`（なければスキップ） |

アセット名は取り決めです。`install.sh`、`crates/verdin/Cargo.toml` の `cargo binstall` のメタデータ、Homebrew の formula、winget のマニフェストは、すべてバージョンとターゲットからアセット名を組み立てます。`deploy/render-template.sh` は、Homebrew と winget のテンプレートに、バージョンと `SHA256SUMS` のチェックサムを埋め込み、どれかが欠けていると失敗します。

## 任意のジョブの初回セットアップ

| 内容 | 場所 |
| --- | --- |
| **Homebrew の tap。** 公開リポジトリ `verdin-cms/homebrew-tap` を作成します（この名前で `brew install verdin-cms/tap/verdin` が動作します）。そのリポジトリに *Contents: read and write* を持つ fine-grained トークンを、`HOMEBREW_TAP_TOKEN` シークレットとして追加します。別のリポジトリを使う場合は、`HOMEBREW_TAP_REPOSITORY` 変数を設定します。 | リポジトリのシークレットと変数 |
| **winget。** `VerdinCMS.Verdin` の最初の提出は、winget のメンテナーが審査します。提出するアカウントで `microsoft/winget-pkgs` をフォークし、そのアカウントの `public_repo` スコープを持つ classic トークンを `WINGET_TOKEN` として追加します。 | リポジトリのシークレット |
| **npm。** `NPM_TOKEN`。`@verdin` スコープの automation トークンです。 | リポジトリのシークレット |
| **crates.io**（任意）。`--git` なしの `cargo binstall verdin` には、クレートが crates.io にあることが必要です。それまでは、ドキュメントでは `--git` を使います。 | — |
| **Railway のボタン**（任意）。railway.com で、リポジトリからテンプレートを作成し（設定ファイルのパスは `deploy/one-click/railway.json`、PostgreSQL のサービス、`/data` のボリューム）、そのボタンを README と[ワンクリックデプロイ](/ja/deploy/one-click/)に追加します。 | railway.com |

Render と DigitalOcean のボタンには、プロジェクト側のアカウントは不要です。デフォルトブランチの `render.yaml` と `.do/deploy.template.yaml` を読み込みます。

一部のバージョンはファイルに書き込まれていて、マイナーリリースごとに更新します。`deploy/one-click/Dockerfile`、`deploy/playground/Dockerfile`、`deploy/compose/`、ドキュメントのイメージのタグと、`deploy/helm/verdin/Chart.yaml` の `version`/`appVersion` です。

## ドキュメントサイト

`.github/workflows/site.yml` は、`site/` に触れる `main` へのプッシュのたびに `site/` をビルドし、結果を `gh-pages` ブランチのルートにプッシュします。GitHub Pages がそのブランチを提供します（Settings → Pages → Source: *Deploy from a branch*、`gh-pages`、`/`）。

### ドメイン

サイトの場所は、リポジトリの変数 **`SITE_URL`** 1 つで決まります。

| `SITE_URL` | サイト |
| --- | --- |
| 未設定 | `https://verdin-cms.github.io/verdin/` |
| `https://docs.example.com` | そのドメインのルート |
| `https://example.com/verdin` | そのドメインの `/verdin` 配下 |

`site/scripts/repo.mjs` が、ここから Astro の `site` と `base` を取るので、すべてのリンク、アセット、サイトマップが追従します。`BASE_PATH` が設定されていれば、引き続きパスを上書きします。独自ドメインの場合は次のようにします。

1. ドメインの DNS を GitHub Pages に向けます（サブドメインなら `verdin-cms.github.io` への `CNAME` レコード）。
2. Settings → Secrets and variables → Actions → Variables で `SITE_URL` を設定します。
3. Site のワークフローを実行します（または `main` にプッシュします）。ブランチに `CNAME` ファイルが書き込まれ、GitHub がドメインを認識します。証明書が発行されたら、*Enforce HTTPS* を有効にしてください。

サイトの外のリンク（README、パッケージのメタデータ、Helm チャートの `home`）は `verdin-cms.github.io/verdin` のアドレスのままで、GitHub が独自ドメインにリダイレクトします。

### プルリクエストのプレビュー

サイトに触れる各プルリクエストには、`<SITE_URL>/pr-preview/pr-<number>/` にプレビューが作られ、コメントでリンクされます。

1. `site-preview.yml` は `pull_request` で実行されます。`SITE_URL` をプレビューのアドレスに設定してサイトをビルドし、アーティファクトとしてアップロードします。プルリクエストのコードを実行するので、フォークからの `pull_request` のワークフローすべてと同様に、読み取り専用のトークンで、シークレットはありません。
2. `site-preview-deploy.yml` は、そのビルドが成功したときに `workflow_run` で、このリポジトリのコンテキストで実行されます。アーティファクトをダウンロードし、プルリクエストが開いていて、ビルドがその現在の head のものであることを確認し、ファイルを `gh-pages` の `pr-preview/pr-<number>/` にコピーして、コメントを更新します。プルリクエストのコードをチェックアウトしたり実行したりすることはありません。
3. プルリクエストが閉じられると、同じワークフロー（`pull_request_target`。`gh-pages` をクローンするだけです）が、そのフォルダーを削除します。

メインのデプロイは `pr-preview/` を保持し、3 つとも同じ concurrency グループを共有するので、`gh-pages` に書き込むジョブは一度に 1 つだけです。

プレビューは、ドキュメントと同じオリジンから提供されます。サインインのない静的なサイトでは許容できますが、フォークからのプルリクエストは、閉じられるまで任意の HTML をそこに公開できます。悪用するプルリクエストは閉じてください。リポジトリの変数がフォークのワークフローで使えない場合、そのプレビューはデフォルトの `SITE_URL` でビルドされ、独自ドメインではリンクが壊れます。このリポジトリのブランチからのプルリクエストのプレビューには影響しません。

### ホスト型プレイグラウンド

公開デモは、`deploy/playground/` のコンテナを実行します。[ホスト型プレイグラウンド](/ja/deploy/playground/)を参照してください。ホストはリポジトリの外で行います。HTTPS の背後で 1 つのコンテナを動かし続けるプラットフォームなら、どれでも使えます。
