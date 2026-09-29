---
title: "コンテンツモデル"
description: "Verdin がコンテンツを記述する方法。コレクションタイプとシングルタイプ、属性、Strapi 形式のスキーマファイル、バリデーションのルールを説明します。"
sidebar:
  order: 1
---

コンテンツモデルとは、プロジェクトが定義するコンテンツタイプとコンポーネントの集まりです。Verdin は、データベースのテーブル、REST と GraphQL の API、OpenAPI ドキュメント、バリデーション、管理パネルのフォームなど、それ以外のすべてをここから導き出します。このページでは、その構成要素と適用されるルールを説明します。

## コンテンツタイプ

コンテンツタイプは、記事やホームページのような 1 種類のドキュメントを記述します。コンテンツタイプには `kind` があります。

| 種類 | 保持するもの | REST ルート（ブログのサンプル） |
| --- | --- | --- |
| `collectionType` | 任意の数のドキュメント | `/api/articles`、`/api/articles/{documentId}` |
| `singleType` | 最大 1 件のドキュメント | `/api/homepage` |

コレクションタイプは `pluralName` で、シングルタイプは `singularName` で提供されます。シングルタイプへの最初の `PUT` がそのドキュメントを作成します。すべてのルートは [REST API](/ja/api/rest/) を参照してください。

各コンテンツタイプには UID `api::<singularName>`（`api::article`）があります。Strapi は同じ UID を `api::article.article` と書きます。Verdin はスキーマファイルとインポーターでその形式も受け付け、`api::article` に正規化します。

すべてのドキュメントには、宣言しなくても存在するシステムフィールドがあります。`id`、`documentId`（26 文字の小文字の ULID で、下書き、公開バージョン、ロケールをまたいで変わりません）、`createdAt`、`updatedAt`、`publishedAt`、そして[多言語化された型](/ja/concepts/internationalization/)では `locale` です。

## スキーマファイル

コンテンツタイプとコンポーネントは、プロジェクトの `schema/` ディレクトリ（`verdin.toml` の `[schema].path`）にある JSON ファイルです。コードと同じように git でバージョン管理します。

```
schema/
├── content-types/
│   ├── article.json
│   ├── category.json
│   ├── tag.json
│   └── homepage.json
└── components/
    ├── blocks/
    │   ├── hero.json
    │   └── quote.json
    └── shared/
        └── seo.json
```

形式は Strapi の `schema.json` なので、Strapi のスキーマの多くはそのまま読み込めます。次は[ブログのサンプル](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog)の記事の型です。

```json title="schema/content-types/article.json"
{
  "kind": "collectionType",
  "singularName": "article",
  "pluralName": "articles",
  "displayName": "Article",
  "options": { "draftAndPublish": true },
  "attributes": {
    "title": { "type": "string", "required": true, "maxLength": 200 },
    "slug": { "type": "uid", "targetField": "title", "required": true },
    "excerpt": { "type": "text", "maxLength": 500 },
    "body": { "type": "richtext" },
    "readingTime": { "type": "integer", "min": 0 },
    "featured": { "type": "boolean", "default": false },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "tags": { "type": "relation", "relation": "manyToMany", "target": "tag" },
    "seo": { "type": "component", "component": "shared.seo" },
    "blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"] }
  }
}
```

| キー | 必須 | 説明 |
| --- | --- | --- |
| `kind` | はい | `collectionType` または `singleType`。 |
| `singularName` | はい | ケバブケース。ファイル名（`article.json`）と一致する必要があります。 |
| `pluralName` | はい | ケバブケースで、`singularName` とは異なる名前。 |
| `displayName` | はい | 管理パネルに表示される名前。 |
| `description` | いいえ | 管理パネルに表示されます。 |
| `collectionName` | いいえ | テーブル名。デフォルトは `pluralName` をスネークケースにしたもの。 |
| `options.draftAndPublish` | いいえ | 各ドキュメントに下書きと公開バージョンを持たせます。デフォルトは `false`。[下書きと公開](/ja/concepts/draft-and-publish/)を参照してください。 |
| `pluginOptions.i18n.localized` | いいえ | ロケールごとに 1 つのバージョンを持たせます。デフォルトは `false`。[国際化](/ja/concepts/internationalization/)を参照してください。 |
| `attributes` | いいえ | フィールド。API が返す順序で並べます。 |
| `validations` | いいえ | フィールド間のルール。[後述](#フィールド間のバリデーション)を参照してください。 |

スキーマは厳密です。不明なキー、型が対応していないオプション、存在しない型やコンポーネントへの参照はエラーになり、ファイルとパスが示され、サーバーは起動しません。サーバーを起動せずにファイルを検証するには `verdin schema check` を実行してください。

いくつかの名前は使えません。

- 属性名は英字で始まり、その後に英字、数字、アンダースコアが続き、最大 50 文字です。スネークケースのカラムになります（`metaTitle` → `meta_title`）。
- `id`、`documentId`、`locale`、`publicationState`、`publishedAt`、`createdAt`、`updatedAt`、`createdBy`、`updatedBy` はコンテンツタイプで予約されており、コンポーネント内では `id` が予約されています。
- `upload`、`uploads`、`auth`、`users`、`connect` は `singularName` や `pluralName` にできません。これらのルートは API が使います。
- 1 つのコンテンツタイプが持てる `string`、`email`、`uid`、`enumeration` 属性は最大 60 個です。これで行が MySQL の行サイズの上限に収まります。一部には `text` を使ってください。

ファイルは、サーバーを `verdin dev` で起動している間に使える管理画面の**コンテンツタイプビルダー**で編集するか、手で編集します。どちらの方法でも、変更は[スキーマのマイグレーション](/ja/concepts/schema-migrations/)になります。エディターのレイアウト（フィールドの順序、幅、ラベル）はスキーマの一部ではありません。管理者がパネルで設定し、データベースに保存されます。

## コンポーネント

コンポーネントは再利用できるフィールドのグループで、たとえば `shared.seo`（メタタイトルとメタディスクリプション）です。UID は `<category>.<name>` で、パスから決まります。`schema/components/shared/seo.json` は `shared.seo` です。コンポーネントのファイルには `displayName`、任意の `description` と `icon`、そして `attributes` があります。

ダイナミックゾーンは、複数のコンポーネントを混在させたリストで、たとえばヒーローと引用のブロックでできた記事本文です。どちらもドキュメント内に JSON として保存されます。[コンポーネントとダイナミックゾーン](/ja/concepts/components-and-dynamic-zones/)を参照してください。

## 属性

各属性には `type` と、それに応じたオプションがあります。型、そのオプション、データベースごとのカラム型の完全な一覧は、[属性の型のリファレンス](/ja/reference/attribute-types/)にあります。

| 分類 | 型 |
| --- | --- |
| テキスト | `string`、`text`、`richtext`（Markdown）、`blocks`（Strapi の構造化リッチテキスト）、`email`、`uid`、`password`、`enumeration` |
| 数値 | `integer`、`biginteger`、`float`、`decimal` |
| 日付 | `date`、`time`、`datetime` |
| その他のスカラー | `boolean`、`json` |
| リンク | `relation`（[リレーション](/ja/concepts/relations/)を参照）、`media`（[メディア](/ja/concepts/media/)を参照） |
| 構造 | `component`、`dynamiczone` |

共通のオプション:

| オプション | 効果 |
| --- | --- |
| `required` | バージョンを公開するとき（下書きと公開を使わない型では書き込みのたび）に値が必要です。下書きは未完成でもかまいません。 |
| `private` | コンテンツ API で返されず、フィルター、ソート、populate もされません。`password` 属性は常に private です。 |
| `default` | 新しいドキュメントでフィールドが省略されたときに使う値。属性自身のルールで検証されます。 |
| `unique` | ロケールとバージョンごとに、同じ値を持つドキュメントは 2 つ存在できません。`string`、`email`、数値、日付、時刻の型で使えます。`uid` は常に一意です。 |
| `configurable` | `false` にすると、コンテンツタイプビルダーで属性がロックされ、そこで編集、名前の変更、削除ができなくなります。 |
| `pluginOptions.i18n.localized` | `false` にすると、値がロケール間で共有されます。 |

データベースでは、すべての属性カラムが NULL を許容します。Strapi v5 と同様に、`required` は `NOT NULL` 制約ではなく、公開時に Verdin が強制します。そのため、すでに行がある型に必須属性を追加しても安全な変更です。

## バリデーション

すべての書き込みは、データベースに届く前にスキーマと照合されます。

- **型と制約**は、書き込みのたびに確認されます。値の型、`minLength`/`maxLength`、`min`/`max`、`regex`、`enum` の値、繰り返し可能なコンポーネントとダイナミックゾーンの項目数、ダイナミックゾーンが許可するコンポーネントの種類、メディアフィールドが受け付けるファイルの種類です。入力に含まれる不明なキーやシステムフィールドはエラーになります。
- **必須フィールドとフィールド間のルール**は、バージョンの公開時と、下書きと公開を使わない型への書き込みのたびに確認されます。コンポーネントとダイナミックゾーンの中にも適用されます。
- **一意性**は、データベースの一意インデックスで確認されるので、同時に行われた 2 つの書き込みが両方とも成功することはありません。

チェックに失敗すると、`400` と `ValidationError` を返します。その `details.errors` には、`["seo", "metaTitle"]` や `["blocks", 2, "text"]` のようなパス付きで各問題が並びます。[エラー](/ja/api/rest/#エラー)を参照してください。

### フィールド間のバリデーション

コンテンツタイプは、自分のフィールド同士を比較するルールを [JSON Logic](https://jsonlogic.com) で宣言できます。次のイベントの型では、終了日が開始日より後であることを求め、販売済みチケットの数を座席数以下に抑えます。

```json title="schema/content-types/event.json"
{
  "kind": "collectionType",
  "singularName": "event",
  "pluralName": "events",
  "displayName": "Event",
  "attributes": {
    "startDate": { "type": "date", "required": true },
    "endDate": { "type": "date" },
    "seats": { "type": "integer", "min": 0 },
    "sold": { "type": "integer", "min": 0 }
  },
  "validations": [
    {
      "rule": { "or": [{ "!": { "var": "endDate" } }, { "<=": [{ "var": "startDate" }, { "var": "endDate" }] }] },
      "message": "must be after the start date",
      "field": "endDate"
    },
    { "rule": { "<=": [{ "var": "sold" }, { "var": "seats" }] }, "message": "more tickets sold than seats" }
  ]
}
```

- 成り立たないルールは、`message` を持つバリデーションエラーになります。`field` を指定した場合はそのフィールドに、指定しない場合はドキュメント（`path: []`）に付きます。
- ルールは `required` と同じタイミングで実行されます。公開時と、下書きと公開を使わない型への書き込みのたびです。下書きはルールに反していてもかまいません。
- `var` はドキュメント自身のフィールドを読み、ドット区切りのパスでコンポーネントの中も読めます。リレーションとメディアはルールから使えません。
- 両辺が数値なら数値として、両辺が文字列なら文字列として比較するので、ISO 形式の日付、時刻、日時は正しく比較されます。空のフィールドは `null` です。最初のルールのように、任意のフィールドはガードしてください。
- 使える演算子: `var`、`==`、`!=`、`===`、`!==`、`<`、`>`、`<=`、`>=`、`!`、`!!`、`and`、`or`、`in`、`if`、`?:`、`+`、`-`、`*`、`/`、`%`、`min`、`max`、`cat`。不明な演算子、不明な `field`、空の `message` はスキーマのエラーになります。

ルールはサーバーが確認し、公開に失敗すると、管理パネルはルールが指定したフィールドにそのメッセージを表示します。Strapi には対応する機能がありません。Strapi の条件付きフィールド（`conditions`）はスキーマファイルで受け付けられ保持されますが、まだ適用されません。
