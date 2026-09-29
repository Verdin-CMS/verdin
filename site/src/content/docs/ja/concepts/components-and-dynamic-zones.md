---
title: "コンポーネントとダイナミックゾーン"
description: "再利用できるフィールドのグループと、種類の混在したブロックのリスト。Verdin がそれらをドキュメント上の JSON として保存する理由と、それがリレーション、メディア、フィルター、populate に与える影響を説明します。"
sidebar:
  order: 2
---

コンポーネントを使うと、フィールドのグループを複数のコンテンツタイプで再利用できます。ダイナミックゾーンを使うと、編集者はブロックのリストからページを組み立てられます。このページでは、両者のモデル化と保存の方法、そしてそれが読み取り、書き込み、フィルターにどう影響するかを説明します。スキーマの形式そのものは[コンテンツモデル](/ja/concepts/content-model/)にあります。

## コンポーネント

コンポーネントはフィールドのグループで、`schema/components/<category>/` 配下に専用のファイルを持ちます。ブログのサンプルの `shared.seo` は、メタタイトルとメタディスクリプションを持ちます。

```json title="schema/components/shared/seo.json"
{
  "displayName": "SEO",
  "attributes": {
    "metaTitle": { "type": "string", "maxLength": 60 },
    "metaDescription": { "type": "text", "maxLength": 160 }
  }
}
```

コンテンツタイプは `component` 属性を通じてコンポーネントを使います。`repeatable: true` にするとリストになり、`min` と `max` で項目数を制限することもできます。

```json
"seo": { "type": "component", "component": "shared.seo" },
"links": { "type": "component", "component": "shared.link", "repeatable": true, "max": 10 }
```

コンポーネントは他のコンポーネントを含められます。直接でも他のコンポーネントを介してでも、コンポーネントが自分自身を含むことはできません。スキーマのチェックがそのような循環を拒否します。

## ダイナミックゾーン

ダイナミックゾーンは、指定したコンポーネントのいずれかを項目にできるリストです。ブログの記事本文では、ヒーローと引用が混在しています。

```json
"blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"], "max": 20 }
```

各項目は、どのコンポーネントであるかを `__component` で示します。`min` と `max` で項目数を制限します。ダイナミックゾーンはコンテンツタイプにだけ置けます。コンポーネントの中には置けません。

## JSON として保存

Verdin は、コンポーネントやダイナミックゾーンの値を、ドキュメントの行にある 1 つの JSON カラムに保存します（PostgreSQL では `jsonb`、MySQL と MariaDB では `json`、SQLite ではテキスト）。

```json
// the "seo" column
{ "id": 1, "metaTitle": "Rust for CMS authors", "metaDescription": "…" }

// the "blocks" column
[
  { "__component": "blocks.hero", "id": 1, "title": "Hello", "subtitle": "…" },
  { "__component": "blocks.quote", "id": 2, "text": "…", "author": "Ferris" }
]
```

Strapi は各コンポーネントを専用のテーブルに保存し、ポリモーフィックなリンクテーブルで結合します。値をドキュメントと一緒に保存することで、次のようになります。

- コンポーネントを含むドキュメントの読み取りに、ネストがどれだけ深くても結合は不要です。
- 公開、下書きの破棄、[コンテンツ履歴](/ja/guides/content/content-history/)は、値をそのままコピーします。
- コンポーネントにフィールドを追加してもテーブルは変わらず、マイグレーションは空です。
- コンポーネントのフィールドでのフィルターには各データベースの JSON 関数を使い、使えないフィルターもあります（[フィルター](#フィルター)を参照）。

すべての項目は `id` を持ちます。これは属性の値の中で一意な正の整数です。Verdin は新しい項目に `id` を割り当てます。リストを更新するときは `id` を送り返すと、項目が安定して保たれます。

## コンポーネント内のリレーションとメディア

コンポーネントはリレーションとメディアを持つことができ、JSON 自体に保存されます。リレーションは `documentId`、メディアはファイル ID です。

- コンポーネント内のリレーションは `oneWay` か `manyWay` でなければなりません。対象を指すだけで、逆側はありません。[リレーション](/ja/concepts/relations/#コンポーネント内のリレーション)を参照してください。
- すべての参照は書き込み時に確認されます。対象のドキュメントやファイルが存在し、ファイルはフィールドの `allowedTypes` に合っている必要があります。
- コンポーネントを populate すると、参照はドキュメントと同じステータスとロケールで、バッチクエリによって解決されます。削除された対象や、読み取り中のバージョンを持たない対象は省かれます。
- ポリモーフィックリレーション（`morphToOne`、`morphToMany`）と `password` フィールドは、コンポーネントの中に置けません。

## 読み取り

コンポーネントとダイナミックゾーンは、Strapi と同様に、populate した場合にだけ返されます。

```http
GET /api/articles?populate[0]=seo&populate[1]=blocks
GET /api/articles?populate=*
```

populate したコンポーネントは、ネストしたコンポーネントや解決済みのリレーションとメディアを含めて丸ごと返されます。Strapi ではネストしたコンポーネントごとに `populate` の階層が必要ですが、Verdin は互換性のためにそのネストしたオプションを受け付け、無視します。ダイナミックゾーンの項目は保存された順序で、それぞれ `__component` 付きで返されます。

GraphQL では、コンポーネントは UID にちなんだ名前のオブジェクト型（`ComponentSharedSeo`）、ダイナミックゾーンはフラグメントでクエリするユニオン（`ArticleBlocksDynamicZone`）です。[GraphQL API](/ja/api/graphql/) を参照してください。

## 書き込み

属性の値全体を送ります。保存されていた値は置き換えられます。

```json
{
  "data": {
    "seo": { "metaTitle": "Rust for CMS authors" },
    "blocks": [
      { "__component": "blocks.hero", "title": "Hello" },
      { "__component": "blocks.quote", "text": "Fast and small.", "author": "Ferris" }
    ]
  }
}
```

値は書き込みのたびにコンポーネントのスキーマで検証されます。不明なキー、誤った型、ダイナミックゾーンが許可しない `__component` はエラーになり、`["blocks", 1, "text"]` のようなパスが示されます。コンポーネント内の `required` フィールドは、トップレベルのものと同様に、ドキュメントの公開時に確認されます。

## フィルター

| 対象 | 例 | 備考 |
| --- | --- | --- |
| コンポーネントのフィールド | `filters[seo][metaTitle][$containsi]=rust` | スカラーフィールド。ネストしたコンポーネントを含みます。 |
| 繰り返し可能なコンポーネントのフィールド | `filters[links][url][$contains]=github` | いずれかの項目が一致すれば一致します。 |
| ダイナミックゾーン | `filters[blocks][__component][$eq]=blocks.quote` | `__component` でのみ可能。コンポーネントが違えば項目のフィールドも違うためです。 |

コンポーネントのフィールドでソートすることはできず、コンポーネント内の `json` フィールドではフィルターできません。演算子は [REST API](/ja/api/rest/#フィルター) を参照してください。
