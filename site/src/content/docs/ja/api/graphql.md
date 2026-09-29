---
title: "GraphQL API"
description: "Verdin の GraphQL エンドポイントの有効化、コンテンツタイプから生成されるスキーマ、クエリ、ミューテーション、コネクション、エラー、制限について説明します。"
sidebar:
  order: 2
  label: "GraphQL"
---

Verdin は、コンテンツタイプから生成した GraphQL API を提供できます。形は Strapi v5 の GraphQL プラグインに合わせています。権限、フィルター、ページネーション、バリデーションは REST API と共通で、GraphQL の引数は REST リクエストと同じクエリに変換されます。このページはリファレンスです。例では [ブログのサンプル](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog)を使います。

## 有効化

GraphQL はデフォルトでオフです。**設定 → 機能 → GraphQL**（権限 `features.manage`）でオンにします。変更は再起動なしですぐに反映され、エンドポイントは次のとおりです。

```
POST /graphql
```

REST のプレフィックス配下ではなく、サーバーのルートで提供されます。`{ "query", "variables", "operationName" }` を JSON で送ってください。`GET /graphql?query=…` でもクエリを実行できます（ミューテーションには `POST` が必要です）。

```sh title="Terminal"
curl -X POST 'https://cms.example.com/graphql' \
  -H "Authorization: Bearer $VERDIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ articles(sort: [\"publishedAt:desc\"]) { documentId title } }"}'
```

呼び出し元の認証は REST API と同じです。公開アクセスならヘッダーなし、または API トークンかエンドユーザーの JWT を使います。不正な形式の `Authorization` ヘッダーや不明なトークンには `401` を返します。[権限](/ja/concepts/permissions/)を参照してください。他のオリジンのブラウザーには `[api].cors_origins` が必要です。

### 設定

| 設定 | デフォルト | 場所 | 効果 |
| --- | --- | --- | --- |
| **GraphiQL プレイグラウンド** | `verdin dev` ではオン、`verdin start` ではオフ | 機能の設定 | ブラウザーが `GET /graphql` を開いたときに GraphiQL を提供します。unpkg.com から読み込みます。 |
| **イントロスペクション** | オン | 機能の設定 | クライアントやツールがスキーマを読めるようにします。一般にスキーマを見せたくない場合はオフにします。 |
| **無効化された操作** | なし | 機能の設定 | コンテンツタイプごとに、`find`、`findOne`、`create`、`update`、`delete`（またはすべてのクエリ、すべてのミューテーション、すべて）をスキーマから除外します。Strapi の shadow CRUD の切り替えと同様です。REST には影響しません。 |
| `maxDepth` | `10` | Admin API | 許可する選択の最大の深さ。 |
| `maxComplexity` | `1000` | Admin API | 許可するクエリの最大の複雑さ（おおよそ選択したフィールドの数）。 |

`maxDepth` と `maxComplexity` にはまだパネル上の入力欄がありません。[Admin API](/ja/api/admin/) で設定してください。`GET /admin/api/features` が現在の設定を返し、`PUT /admin/api/features/graphql` が設定を置き換えるので、残したい設定も一緒に送ります。

```json
{ "enabled": true, "settings": { "playground": false, "introspection": true, "maxDepth": 8, "maxComplexity": 500 } }
```

## スキーマ

スキーマには、コンテンツタイプごとに `singularName` を PascalCase にした名前のオブジェクト型（`article` → `Article`、`blog-post` → `BlogPost`）があり、次を含みます。

- `documentId: ID!`
- `private` でないすべての属性
- `DateTime` 型の `createdAt`、`updatedAt`、`publishedAt`
- 多言語化された型では `locale: String`

| 属性 | GraphQL の型 |
| --- | --- |
| `string`、`text`、`richtext`、`email`、`uid`、`enumeration` | `String` |
| `integer` | `Int` |
| `biginteger` | `Long`（REST と同様に文字列） |
| `float`、`decimal` | `Float` |
| `boolean` | `Boolean` |
| `date`、`time`、`datetime` | `Date`、`Time`、`DateTime` |
| `json`、`blocks` | `JSON` |
| 対一リレーション | 対象の型。例: `Category` |
| 対多リレーション | `[Tag!]!`。`filters`、`pagination`、`sort` 引数付き |
| `media` | `UploadFile`。`multiple` の場合は `[UploadFile!]!` |
| `component` | `ComponentSharedSeo`（UID `shared.seo` から）。繰り返し可能な場合はリスト |
| `dynamiczone` | `[ArticleBlocksDynamicZone!]!`。そのコンポーネントのユニオン |
| ポリモーフィックリレーション | `JSON`（`__type` 付きのドキュメント） |

ルートの `Query` には、サーバーのバージョンを返す `verdin: String!` もあります。

## クエリ

| コレクションタイプ `article` | 戻り値 |
| --- | --- |
| `articles(filters, pagination, sort, status, locale)` | `[Article!]!` |
| `articles_connection(filters, pagination, sort, status, locale)` | `nodes` と `pageInfo` を持つ `ArticleEntityResponseCollection` |
| `article(documentId: ID!, status, locale)` | `Article` または `null` |

| シングルタイプ `homepage` | 戻り値 |
| --- | --- |
| `homepage(status, locale)` | `Homepage` または `null` |

クエリ名とフィールド名は、`pluralName` と `singularName` を camelCase にしたものです（`blog-posts` → `blogPosts`）。

```graphql
query LatestArticles($page: Int) {
  articles_connection(
    filters: { category: { name: { eq: "News" } }, title: { containsi: "rust" } }
    sort: ["publishedAt:desc"]
    pagination: { page: $page, pageSize: 10 }
  ) {
    nodes {
      documentId
      title
      slug
      category { name }
      tags(sort: ["label:asc"]) { label }
      seo { metaTitle metaDescription }
      blocks {
        __typename
        ... on ComponentBlocksHero { title subtitle }
        ... on ComponentBlocksQuote { text author }
      }
    }
    pageInfo { page pageSize pageCount total }
  }
}
```

REST で同じリクエストを送ると次のようになります。

```http
GET /api/articles?filters[category][name][$eq]=News&filters[title][$containsi]=rust
  &sort=publishedAt:desc&pagination[page]=1&pagination[pageSize]=10
  &populate[category][fields][0]=name&populate[tags][sort]=label:asc&populate[0]=seo&populate[1]=blocks
```

### 引数

- **`filters`**: 属性ごとのフィールドに加え、`documentId`、タイムスタンプ、`and`、`or`、`not` を持つ `ArticleFiltersInput`。スカラーフィールドは `StringFilterInput` のような演算子の入力を受け取ります。演算子は `$` を除いた [REST の演算子](/ja/api/rest/#フィルター)で、`eq`、`ne`、`containsi`、`in`、`between`、`null` などです。リレーションは対象のフィルター入力を、繰り返し不可のコンポーネントはそのコンポーネントのフィルター入力を受け取ります。
- **`pagination`**: `{ page, pageSize }` または `{ start, limit }`。デフォルトと最大値は REST と同じです。
- **`sort`**: REST と同様、`"field"` または `"field:asc|desc"` の文字列のリスト。
- **`status`**: `PUBLISHED`（デフォルト）または `DRAFT`。`DRAFT` には `readDrafts` の許可が必要です。関連ドキュメントは常に親のステータスに従います。
- **`locale`**: 多言語化された型のロケールコード。指定しない場合はデフォルトのロケールです。

読み込まれるのは選択したものだけです。選択は REST の `populate` になり、リレーションの各階層は 1 回のバッチクエリになります。`articles_connection` の `pageInfo` は、一致したすべての件数（`total`）とページ数（`pageCount`）を数えます。

## ミューテーション

| コレクションタイプ `article` | 戻り値 |
| --- | --- |
| `createArticle(data: ArticleInput!, status, locale)` | `Article` |
| `updateArticle(documentId: ID!, data: ArticleInput!, status, locale)` | `Article` |
| `deleteArticle(documentId: ID!, locale)` | `DeleteMutationResponse`（`{ documentId }`） |

| シングルタイプ `homepage` | 戻り値 |
| --- | --- |
| `updateHomepage(data: HomepageInput!, status, locale)` | `Homepage`。最初の更新でドキュメントが作成されます |
| `deleteHomepage(locale)` | `DeleteMutationResponse` |

```graphql
mutation {
  createArticle(
    data: { title: "Hello, Verdin", slug: "hello-verdin", category: "k2m7q4…", tags: ["a7c1…"] }
    status: DRAFT
  ) {
    documentId
    publishedAt
  }
}
```

- REST と同様、`create` と `update` は `status: DRAFT` でない限り公開します。公開用の個別のミューテーションはありません。非公開にしたり下書きを破棄したりするには、REST の[アクション](/ja/api/rest/#アクション)を使ってください。
- 入力は属性に対応します。リレーションは `ID` または `[ID!]`（`documentId`）、メディアはファイル ID、コンポーネントはその `…Input` 型を受け取り、ダイナミックゾーンの項目は `__component` を持つ `JSON` オブジェクトです。逆側（`mappedBy`）のリレーションは入力に含まれません。
- `delete` ミューテーションは `locale` のバージョン（指定しない場合はデフォルトのロケール）を削除します。`DELETE /api/articles/{documentId}?locale=fr` と同じです。
- REST と同じバリデーションが実行されます。

## エラー

GraphQL のエラーは、`200` レスポンスの `errors` リストで返され、`extensions.code` にコードが入ります。

```json
{
  "data": { "createArticle": null },
  "errors": [
    {
      "message": "title is a required field",
      "path": ["createArticle"],
      "extensions": {
        "code": "BAD_USER_INPUT",
        "details": [{ "path": ["title"], "message": "title is a required field", "name": "ValidationError" }]
      }
    }
  ]
}
```

| コード | 発生条件 |
| --- | --- |
| `FORBIDDEN` | 呼び出し元にその操作の許可がない、または `status: DRAFT` に対する `readDrafts` がない。 |
| `BAD_USER_INPUT` | 引数またはコンテンツが無効。`details` にバリデーションの問題とそのパスが並びます。 |
| `NOT_FOUND` | ドキュメントが存在しない（更新と削除の場合）。 |
| `INTERNAL_SERVER_ERROR` | 予期しないエラー。サーバーでログに記録されます。 |

`maxDepth` より深いクエリや `maxComplexity` より複雑なクエリは、実行前に拒否されます。

## 制限

GraphQL には、REST API の制限に加えて独自の制限（`maxDepth`、`maxComplexity`）があります。リストあたり最大 `[api].max_page_size` 件のドキュメント、リレーションのネストは最大 5 階層、ドキュメントとリレーションごとに関連ドキュメントは最大 1,000 件、フィルター条件は最大 100 個です。[REST の制限](/ja/api/rest/#制限)を参照してください。

## プラグイン

[プラグイン](/ja/extending/plugins/)は、`name(args: JSON): JSON` 形式のルートクエリとミューテーションを追加できます。コンテンツタイプがすでに使っている名前はスキップされます。

## Strapi との比較

型、クエリ、ミューテーションの名前、`nodes` と `pageInfo` を持つ `_connection` クエリ、`documentId` 引数、`status`、`locale` は Strapi v5 の GraphQL プラグインに従っており、多言語化された型には `locale` フィールドがあります。型は `id` を公開せず、GraphQL のサブスクリプションもありません。ライブ更新には[リアルタイム API](/ja/api/realtime/) を使ってください。
