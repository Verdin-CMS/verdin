---
title: ストレージ
description: Verdin がコンテンツをデータベースにどう配置するか。テーブル名とシステムのカラムから、下書きと公開の行、リレーションのリンク、コンポーネントの JSON、プラットフォームのテーブルまでを説明します。
sidebar:
  order: 2
---

このページでは、Verdin がスキーマから導き出すテーブルと、属性の種類ごとの保存方法を説明します。`crates/verdin-migrate/src/derive.rs` や Document Service を変更する前や、データベースに直接問い合わせる必要があるときに読んでください。各属性の型が受け付けるものは[属性の型](/ja/reference/attribute-types/)を参照してください。

これらのテーブルを手で書くことはありません。[マイグレーションエンジン](/ja/internals/migrations/)がスキーマから作成し、発展させます。

## 命名規則

| オブジェクト | 名前 |
|---|---|
| コンテンツタイプのテーブル | `collectionName`。デフォルトは、`pluralName` のダッシュをアンダースコアにしたもの（`blog-posts` → `blog_posts`） |
| カラム | スネークケースにした属性名（`metaTitle` → `meta_title`） |
| リレーションのリンク | `{table}_{column}_lnk` |
| ポリモーフィックリレーションのリンク | `{table}_{column}_mph` |
| メディアのリンク | `{table}_{column}_mda` |
| インデックス | 一意インデックスは `{table}_{part}_uq`、それ以外は `{table}_{part}_idx` |
| プラットフォームのテーブル | `vd_` のプレフィックス（`vd_admin_users`、`vd_schema_snapshots` など） |

スキーマのバリデーターが強制するルール（`crates/verdin-schema/src/naming.rs` と `validate.rs`）:

- `collectionName` は `^[a-z][a-z0-9_]*$` に一致し、最大 50 文字で、`vd_` で始められません。
- `singularName` と `pluralName` はケバブケースです（`^[a-z][a-z0-9-]*$`、先頭、末尾、連続のダッシュは不可）。`upload`、`uploads`、`auth`、`users`、`connect` は、コンテンツ API がそれらのルートを使うので予約されています。
- 属性名は英字で始まり、英字、数字、アンダースコアが続き（Strapi のルール）、最大 50 文字です。
- コンテンツタイプでは、`id`、`documentId`、`locale`、`publicationState`、`publishedAt`、`createdAt`、`updatedAt`、`createdBy`、`updatedBy` が予約されており、スネークケースにしたときにそれらと衝突する名前も予約されています。コンポーネントでは `id` が予約されています。
- 生成される識別子は最大 60 文字です（PostgreSQL は 63、MySQL は 64 まで許可）。それより長い名前は切り詰められ、完全な名前の 8 文字のハッシュが付くので、異なる長い名前は区別されたままで、結果は決定的です。

生成される SQL ではすべての識別子が引用符で囲まれるので、SQL の予約語も属性名として使えます。

## システムのカラム

すべてのコンテンツタイプのテーブルは、次のカラムで始まります。

```sql
id                 BIGINT       primary key, auto-increment
document_id        CHAR(26)     NOT NULL           -- ULID, shared by every version of a document
locale             VARCHAR(16)  NOT NULL DEFAULT '' -- '' for types that are not localized
publication_state  SMALLINT     NOT NULL           -- 0 = draft, 1 = published
published_at       <datetime>   NULL
created_at         <datetime>   NOT NULL
updated_at         <datetime>   NOT NULL
created_by_id      BIGINT       NULL               -- vd_admin_users.id
updated_by_id      BIGINT       NULL
UNIQUE (document_id, locale, publication_state)
INDEX  (publication_state, locale)
```

- `document_id` は、作成時に生成される小文字の ULID です。下書き、公開バージョン、すべてのロケールで同じままです。
- 多言語化されていない型では、`NULL` ではなく `locale = ''` を使います。どのエンジンでも一意インデックスで NULL 同士は衝突しないので、`(document_id, locale, publication_state)` の制約が壊れてしまうためです。
- 状態のカラムは `state` ではなく `publication_state` です。`state` はよくある属性名だからです。

その後に、スカラー属性ごとに 1 つの属性カラムが続きます。**すべての属性カラムは NULL を許容します。** Strapi v5 と同様に、下書きは未完成でもよいので、`required` はデータベースではなく、バージョンの公開時（または下書きと公開を使わない型への書き込みのたび）に確認されます。これにより、必須の属性の追加も安全なマイグレーションになります。

`unique` の属性とすべての `uid` には、`(column, locale, publication_state)` の一意インデックスが付きます。下書きとその公開バージョンは値を共有できますが、2 つの公開されたドキュメントは共有できず、データベースが競合なしにそれを強制します。違反は、そのフィールドの `ValidationError` として報告されます。

## 下書きと公開

Verdin は Strapi v5 のモデルに従います。利用者から見た説明は[下書きと公開](/ja/concepts/draft-and-publish/)を参照してください。ここではテーブルで起きることを説明します。

- ドキュメントは、ロケールごとに最大 1 つの下書きの行（`publication_state = 0`）と 1 つの公開の行（`publication_state = 1`）を持ちます。
- 管理パネルからの書き込みは下書きの行を対象にします。
- **公開**は、下書きで `required` の属性とバリデーションのルールを確認してから、1 つのトランザクションで、下書きの属性の値を公開の行にコピーします（公開の行を更新するか、初回は挿入します）。下書きのリレーションとメディアのリンクも一緒にコピーされます。
- **非公開にする**は、公開の行を削除します。そのリンクも `ON DELETE CASCADE` で一緒に削除されます。
- **下書きの破棄**は、下書きを公開の行の値とリンクで上書きします。
- 下書きと公開を使わないコンテンツタイプには、公開の行しかありません。
- 多言語化された型では、多言語化されていない属性は共有されます。あるロケールを公開すると、それらが他のロケールの公開の行にコピーされます。

## リレーション: ドキュメント ID でリンク

**これが Strapi のストレージとの主な違いです。** Strapi は行を行 ID でリンクするので、公開するときにリンクを書き換える必要があります。Verdin は、リレーションを*元の行 → 対象のドキュメント*として保存します。

```sql
-- articles_category_lnk
id                  BIGINT   primary key, auto-increment
source_id           BIGINT   NOT NULL REFERENCES articles(id) ON DELETE CASCADE
target_document_id  CHAR(26) NOT NULL
position            DOUBLE   NOT NULL   -- 1..n, rewritten on every write
UNIQUE (source_id, target_document_id)
UNIQUE (source_id)                      -- to-one kinds only
INDEX  (target_document_id)
```

- 対象の行は、読み取り時に、読み取り中のバージョンで選ばれます。公開された記事は公開されたカテゴリーを、下書きは下書きを見ます。カテゴリーを非公開にすると、リンクに一切触れずに、公開された記事から消えます。
- 公開でコピーされるのは、元の行自身のリンクだけです。
- リンクテーブルを持つのは**所有**側（`inversedBy` を持つ属性、または一方向のリレーション）だけです。逆側（`mappedBy`）は同じテーブルを逆向きに読み、読み取り専用です。書き込むと、所有側の属性を示すバリデーションエラーになります。
- 「対象は最大 1 件」（`oneToOne`、`manyToOne`、`oneWay`）は `source_id` の一意インデックスです。「対象は 1 件の元ドキュメントに属する」（`oneToOne`、`oneToMany`）はインデックスにできません。下書きとその公開バージョンが正当に対象を共有するためです。Document Service は対象を*移動*させることでこれを強制します。対象をリンクすると、同じ状態の他のドキュメントが持つその対象へのリンクが削除されます。これは Strapi と同じ動作です。
- `document_id` は対象のテーブルで一意ではないので、`target_document_id` に外部キーはありません。Document Service は存在しないドキュメントへのリンクを拒否し、ドキュメントの最後のバージョンが削除されると、それを指すリンクを同じトランザクションで削除します。
- リンクの行は `id` の主キーを保つので、マイグレーションエンジンと SQLite のテーブルの再構築にとって、リンクテーブルは他のテーブルと同じように見えます。
- テーブルの名前を変えると、そのリンクテーブルの名前も一緒に変わります。マイグレーションは SQLite の `foreign_keys` をオフにして実行するので、テーブルを再構築してもそのリンクテーブルにカスケードしません。

**ポリモーフィックリレーション**（`morphToOne`、`morphToMany`）は、任意のコンテンツタイプのドキュメントをリンクします。そのリンクは `{table}_{column}_mph` にあり、`source_id`、`target_type`（対象の UID）、`target_document_id`、`position` を持ち、`(source_id, target_type, target_document_id)` が一意で、`morphToOne` では `source_id` も一意です。逆側（`morphOne`、`morphMany`）にはテーブルがありません。自分を指す所有側のリンクを読むだけで、読み取り専用です。ドキュメントを削除すると、それへのポリモーフィックなリンクも削除されます。できることとできないことは[リレーション](/ja/concepts/relations/)を参照してください。

## コンポーネントとダイナミックゾーン: JSON カラム

コンポーネントの属性やダイナミックゾーンは、ドキュメントの行にある **1 つの JSON カラム**です（PostgreSQL では `jsonb`、MySQL と MariaDB では `json`、SQLite では `text`）。Strapi は各コンポーネントを専用のテーブルに、ポリモーフィックな結合テーブルとともに保存します。カラムを使うことでそれらの結合を避け、公開と履歴を単純なコピーにできます。

```json
// "seo" column (a single component)
{ "id": 1, "metaTitle": "…", "metaDescription": "…" }

// "blocks" column (a dynamic zone)
[
  { "id": 1, "__component": "blocks.hero", "title": "…" },
  { "id": 2, "__component": "blocks.quote", "text": "…", "author": "…" }
]
```

- コンポーネントの各項目は、その属性内で一意な整数の `id` を持ちます。新しい項目には次の空いている番号が付きます。
- データは書き込みのたびにコンポーネントのスキーマで検証されます。
- 公開と破棄は JSON をそのままコピーします。
- **コンポーネント内のリレーションとメディア**は JSON 自体に保存されます。リレーションは `documentId`（そこで使えるのは `oneWay` と `manyWay` だけ）、メディアはファイル ID です。書き込み時に確認され、コンポーネントを populate したときにバッチクエリで解決されます。ポリモーフィックリレーションと `password` の属性はコンポーネントの中に置けません。
- **フィルター**には方言ごとの JSON 関数が必要です。単一のコンポーネントのスカラーフィールドは JSON パス（PostgreSQL では `#>>`、MySQL と MariaDB では `JSON_VALUE`、SQLite では `json_extract`）で読みます。繰り返し可能なコンポーネントは配列の項目に対する `EXISTS`（`jsonb_array_elements`、`JSON_TABLE`、`json_each`）を使います。ダイナミックゾーンは、項目ごとにフィールドが異なるので、`__component` でのみフィルターできます。

モデル化の側面は[コンポーネントとダイナミックゾーン](/ja/concepts/components-and-dynamic-zones/)を参照してください。

## プラットフォームのテーブル

プラットフォームのテーブルは導き出されるすべてのモデルの一部なので、マイグレーションエンジンはコンテンツのテーブルとまったく同じように作成・発展させます。`verdin migrate plan` では安全なステップとして表示されます。定義は `crates/verdin-migrate/src/system.rs` にあります。

| 領域 | テーブル |
|---|---|
| マイグレーション | `vd_schema_snapshots`、`vd_migrations_journal`（マイグレーションエンジンが所有し、初回使用時に作成） |
| 管理者 | `vd_admin_users`、`vd_admin_roles`、`vd_admin_user_roles`、`vd_admin_permissions`、`vd_sessions`（リフレッシュトークン）、`vd_admin_tokens`（招待と再設定のリンク）、`vd_admin_two_factor`、`vd_admin_passkeys`、`vd_spent_challenges` |
| コンテンツ API へのアクセス | `vd_api_tokens`、`vd_api_token_permissions`、`vd_public_permissions` |
| エンドユーザー | `vd_users`、`vd_user_roles`、`vd_user_role_permissions`、`vd_end_user_sessions` |
| インスタンス | `vd_settings`（機能の切り替え、編集ビューのレイアウト、一回限りのアップグレードの印）、`vd_locales` |
| メディア | `vd_files`、`vd_folders` |
| コンテンツのワークフロー | `vd_history_versions`、`vd_releases`、`vd_release_actions`、`vd_workflows`、`vd_workflow_stages`、`vd_document_stages` |
| コラボレーション | `vd_comments`、`vd_tasks`、`vd_document_views`、`vd_document_votes`、`vd_polls`、`vd_poll_votes` |
| 連携 | `vd_webhooks`、`vd_webhook_deliveries`、`vd_deploy_targets`、`vd_deployments`、`vd_plugin_kv`、`vd_audit_logs` |
| サイトの機能 | `vd_redirects`、`vd_menus`、`vd_forms`、`vd_form_submissions` |

## メディアのテーブル

ファイルは Strapi と同じ形の `vd_files` の行（`name`、`alternative_text`、`caption`、`width`、`height`、`formats`、`hash`、`ext`、`mime`、`size`、`url`、`provider` など）で、さらに `focal_point`、`folder_id`、`folder_path` を持ちます。フォルダー（`vd_folders`）は、`/1/4` のような `path_id` の並びである Strapi の `path` を保ちます。

メディアの属性は、`source_id`（コンテンツの行）、`file_id`（`vd_files` の行）、`position` を持つリンクテーブル `{table}_{column}_mda` です。`(source_id, file_id)` が一意で、属性が `multiple` でない場合は `source_id` も一意です。どちらのカラムも `ON DELETE CASCADE` の外部キーなので、ファイルや行を削除するとそのリンクも削除されます。メディアのリンクはリレーションのリンクと同じ下書きと公開のルールに従います。各バージョンが独自のリンクを持ち、公開するとそれがコピーされます。

アップロード、フォーマット、ストレージプロバイダーの仕組みは[メディア](/ja/concepts/media/)にあります。
