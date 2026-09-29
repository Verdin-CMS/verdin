---
title: 管理パネル
description: Verdin の Angular 製管理パネルの構成、スキーマからフォームと一覧を組み立てる方法、そしてビルド、バイナリへの埋め込み、翻訳の方法を説明します。
sidebar:
  order: 6
  label: 管理パネル
---

このページは、`admin/` にある管理パネルのコントリビューター向けです。Angular アプリの構成、コンテンツのスキーマをフォームと一覧に変える方法、そして `verdin` バイナリに組み込まれるまでを説明します。パネルの使い方はガイドで、Admin API のサーバー側の仕組みは [Admin API のリファレンス](/ja/api/admin/)で扱います。

パネルは Angular 22 のシングルページアプリです。スタンドアロンコンポーネント、zoneless の変更検知、シグナル、遅延読み込みのルート、そして Tailwind CSS v4 上の spartan/ui コンポーネントを使っています。

## 構成

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

**状態**は、`core/` にある注入可能なサービス（`Auth`、`Schema`、`I18n`、`Theme` など）の中のシグナルにあります。ストアのライブラリは使っていません。

**API へのアクセス**は、Angular の `HttpClient` を包む Promise ベースの小さなラッパー `core/api.ts` を通じて行い、型は `core/types.ts` に手で書いています。実行時の設定（管理画面のパス、API のプレフィックス、モード、ブランディング）は、サーバーが挿入する `<meta name="verdin-config">` タグから取得します。

**セッション。** アクセストークンはメモリにだけ保持され、リフレッシュトークンは認証のルートに限定された `HttpOnly` の Cookie です。HTTP インターセプターが Bearer トークンを付け、`401` の場合は一度だけリフレッシュして再試行します。リフレッシュに失敗すると、ユーザーをログインページに送ります。リフレッシュとログアウトのリクエストには、サーバーが求める `X-Verdin-CSRF` ヘッダーが付きます。ページの読み込み時には、ガードが Cookie からセッションを復元します。ロールで二段階認証が必須であることを示す `403` を受けると、ユーザーをその設定に送ります。

## スキーマ駆動のフォーム

エントリーエディター（`features/content/edit.ts`）には型ごとのコードがありません。コンテンツタイプとコンポーネントを `GET /admin/api/content-types` と `GET /admin/api/components` から、エディターのレイアウトを編集ビューの設定から読み、**Signal Forms**（`@angular/forms/signals`）で実行時にフォームを組み立てます。

- ドキュメントのモデルは、プレーンなオブジェクトのシグナル（`fields/model.ts` の `FormModel`）です。フィールドツリーとそのバリデーターはスキーマから導き出されます。
- 再帰的な `vd-fields` コンポーネント（`fields/fields.ts`）が、任意の属性のマップをフィールドツリーに沿って描画します。テキスト、日付、時刻は `[formField]` でバインドしたネイティブの入力欄を使います。独自の `FormValueControl` が、数値（NULL 許容で、大きな整数は文字列のまま）、スイッチ、enumeration、日時（入力欄ではローカル時刻、モデルでは UTC）、JSON、Markdown、`blocks`（TipTap）、メディア、リレーション（入力しながら検索できる、並べ替え可能なピッカー）、ポリモーフィックリレーションを扱います。
- コンポーネントはネストした fieldset で、繰り返し可能なコンポーネントとダイナミックゾーンは並べ替え可能なリストです。プラグインは、カスタム要素として描画される独自のフィールドの種類を登録できます。
- `toModel` は populate されたドキュメントをフォームのモデルに変換し（リレーションは `documentId` に、ファイルは ID になります）、`toPayload` は `data` のペイロードに戻します。空の文字列は `null` になり、描画用のキー（`__key`）と読み取り専用の側（`mappedBy`、`morphOne`、`morphMany`）は取り除かれます。どちらも `fields/model.spec.ts` でユニットテストされています。
- スキーマから導き出したバリデーションが、すぐにフィードバックを返します。条件付きフィールド（`conditions.visible`）は、サーバーの JSON Logic の評価器を移植したもの（`core/logic.ts`）でブラウザー内で評価されます。フィールド間のバリデーションのルールはサーバーだけが確認します。最終的な判断はサーバーが下し、その `details.errors[].path` のエントリーは対応するフィールドに対応付けられます。
- 保存は明示的で、変更の追跡とページ離脱時の警告（ルートガードと `beforeunload`）があります。ドキュメントの状態に応じて、**公開**、**非公開にする**、**変更を破棄**のボタンが表示されます。管理画面は下書きだけを保存し、公開は常に別のアクションです。

エディターのレイアウト（フィールドの順序、幅、ラベル、説明、読み取り専用のフィールド、関連エントリーの名前に使うフィールド）はすべての管理者で共有され、サーバーの `vd_settings` に保存されます。`views.manage` の権限を持つ管理者が**表示を設定**のページで変更します。

## 一覧

コンテンツの一覧（`features/content/list.ts`）は、サーバー側のページネーション、ソート、フィルター付きの spartan helm のテーブルを使います。フィルター、検索（`_q`）、ページは URL に反映されるので、絞り込んだ一覧を共有できるリンクになります。各管理者は、型ごとに表示する列、デフォルトのソート、ページサイズを選びます（`list-view.ts`）。その選択はサーバー上の本人の環境設定に保存されるので、ブラウザーが変わっても引き継がれます。一覧は管理画面のイベントストリームからライブでも更新されます。

## コンテンツタイプビルダー

**コンテンツタイプビルダー**は、サーバーが開発モード（`verdin dev`）で動いていて、管理者が `schema.manage` を持つ場合にだけ表示されます。コンテンツタイプとコンポーネントをそのファイル形式で編集します。フィールド、リレーションの種類と対象（対象側に逆側の属性を作成）、コンポーネント、ダイナミックゾーン、長さ、範囲、そして `required`、`unique`、`private` のフラグです。

すべての変更はまず `POST /admin/api/schema/plan` に送られます。これは変更後のスキーマを検証し、マイグレーションのステップを、そのリスク、SQL、ユーザーが受け入れられる名前変更の提案とともに返します。確認すると、受け入れたリスクレベルと名前変更を付けて `POST /admin/api/schema/apply` が呼ばれます。サーバーはマイグレーションを行い、`schema/*.json` を書き込み、再起動なしで実行中のアプリを新しいスキーマのものに置き換えます。サーバーで起きることは[マイグレーションエンジン](/ja/internals/migrations/)を参照してください。

## ビルドと配布

- `ng build` は、`<base href="/admin/">` 付きで本番用のビルドを `admin/dist/admin/browser` に書き出します。
- `embed-admin` フィーチャーを付けてコンパイルすると、サーバーはそのフォルダーを `rust-embed` で埋め込みます。リリースビルドと Docker イメージはこれを使います。フィーチャーがない場合や `[admin].assets_dir` が設定されている場合は、ディスクからファイルを提供します。`assets_dir` は埋め込まれたビルドより優先されます。
- サーバーは `<base href>` を `[admin].path` に書き換え、実行時の設定をインラインスクリプトではなく `<meta>` タグとして挿入します。`admin.path` を変えても、パネルをビルドし直す必要はありません。
- ファイル拡張子のない不明なパスは、クライアント側のルーティングのために `index.html` にフォールバックします。フィンガープリント付きのバンドル（`main-ABC123.js`）は `immutable` として 1 年間キャッシュされ、それ以外はすべて `no-cache` です。
- 管理画面のすべてのレスポンスには、厳格な Content Security Policy（`script-src 'self'`、`frame-ancestors 'none'`、`base-uri 'self'` など）、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin` が付きます。Angular のクリティカル CSS のインライン化は、ポリシーが禁じるインラインのイベントハンドラーに依存するので、`angular.json` でオフにしています。

フロントエンドの作業では、サーバーを起動してから `admin/` で `npm start` を実行します。`ng serve` は `/admin/api` と `/api` を `http://localhost:1337` にプロキシします（`admin/proxy.conf.json`）。

## 翻訳

パネルは、Angular のコンパイル時の i18n ではなく Transloco で実行時に翻訳されるので、1 つのビルドですべての言語を提供でき、ユーザーは再読み込みなしで言語を切り替えられます。

- カタログは `admin/public/i18n/` にあるフラットな JSON ファイル（元は `en.json`）で、必要に応じて読み込まれます。
- メッセージは ICU MessageFormat（`{name}`、`{count, plural, one {# entry} other {# entries}}`）を使い、独自の Transloco のトランスパイラーを通じて FormatJS（`intl-messageformat`）が解釈します。FormatJS はメッセージを関数にコンパイルせずに解釈するので、CSP に `unsafe-eval` は不要です。
- メッセージのキーは `en.json` から型付けされる（`core/i18n/keys.ts`）ので、存在しないキーを使うとコンパイルエラーになります。
- `npm run i18n:check` は、すべてのカタログを `en.json` と照合します。同じキー、有効な ICU の構文、同じ引数、そしてその言語のすべての複数形のカテゴリーです。CI で実行されます。
- `I18n` サービスは、ロケールに応じた書式と週の最初の曜日も提供します。これはブラウザーの地域設定から取得し、ユーザーごとに上書きできます。

言語を追加・更新する方法は[翻訳](/ja/project/translating/)にあります。
