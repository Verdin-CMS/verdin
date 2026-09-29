---
title: 属性の型のリファレンス
description: Verdin のスキーマファイルのすべての属性の型を、そのオプション、バリデーション、データベースでの保存、API での表現とともに説明します。
sidebar:
  order: 4
  label: 属性の型
---

<!-- Written from crates/verdin-schema (convert.rs, validate.rs, model.rs),
crates/verdin-migrate/src/derive.rs and sql.rs (storage), and crates/verdin-content
(input.rs, output.rs, blocks.rs) (API). -->

属性はコンテンツタイプやコンポーネントのフィールドで、スキーマファイルの `attributes` に宣言します。このページでは、すべての `type`、それが受け付けるオプション、Verdin での検証と保存の方法、API での見え方を一覧にします。形式は Strapi v5 のもので、違いは[最後](#strapi-との違い)にまとめています。

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
    "readingTime": { "type": "integer", "min": 0 },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "seo": { "type": "component", "component": "shared.seo" }
  }
}
```

スキーマファイルは厳密です。不明なキーや、型が受け付けないオプションはエラーになり、`verdin schema check` がそのパス（`attributes.title.maxLength`）とともに報告します。

## すべての属性が受け付けるオプション

| オプション | デフォルト | 説明 |
| --- | --- | --- |
| `type` | 必須 | 下記の型のいずれか。 |
| `required` | `false` | 値が必要です。エントリーの公開時（下書きは未完成でもよい）と、下書きと公開を使わない型への書き込みのたびに確認されます。コンポーネントとダイナミックゾーンの中にも適用されます。 |
| `private` | `false` | コンテンツ API で返されず、`filters` や `sort` でも使えません。`password` の属性は常に private です。 |
| `configurable` | `true` | 管理画面のビルダー用の Strapi のフラグ。書かれたとおりに保たれます。 |
| `pluginOptions.i18n.localized` | `true` | 多言語化されたコンテンツタイプで `false` にすると、ロケールごとの値ではなく、ロケール間で共有される値になります。 |
| `customField` | 未設定 | `plugin::<plugin>.<field>`（または `global::<field>`）: 管理画面は、プラグインのカスタムフィールドでこの属性を編集します。`type` は値の保存方法です。[プラグイン](/ja/extending/plugins/)を参照してください。 |
| `conditions` | 未設定 | Strapi の条件付きフィールド（`{ "visible": <JSON Logic> }`）。ルールが偽の間、エディターはフィールドを隠し、サーバーは隠れたフィールドを必須にしません。 |
| `default` | 未設定 | 書き込みで属性が省略されたときの、新しいエントリーの値。型に対して有効である必要があります。受け付けない型もあります（各型を参照）。 |

属性名は英字で始まり、英字、数字、`_` が続き、最大 50 文字です。コンテンツタイプでは `id`、`documentId`、`locale`、`publicationState`、`publishedAt`、`createdAt`、`updatedAt`、`createdBy`、`updatedBy` が、コンポーネントでは `id` が予約されています。同じカラムに対応する 2 つの名前（`metaTitle` と `meta_title`）はエラーです。

### 値の保存場所

コンテンツタイプの各属性は、その型のテーブル（`collectionName`、または複数形の名前）のカラムで、`snake_case` の名前です。リレーションとメディアは代わりにリンクテーブルにあります。下書きとその公開バージョンは 2 つの行で、多言語化された型ではロケールごとに 1 つずつです。

データベースごとのカラムの型:

| カラム | PostgreSQL | MySQL と MariaDB | SQLite |
| --- | --- | --- | --- |
| varchar | `varchar(255)` | `varchar(255)` | `text` |
| text | `text` | `longtext` | `text` |
| integer | `integer` | `int` | `integer` |
| bigint | `bigint` | `bigint` | `integer` |
| double | `double precision` | `double` | `real` |
| decimal | `numeric(p,s)` | `decimal(p,s)` | `text`（正確） |
| boolean | `boolean` | `tinyint(1)` | `integer` |
| date | `date` | `date` | `text` |
| time | `time(3)` | `time(3)` | `text` |
| datetime | `timestamptz(3)` | `datetime(3)` | `text` |
| json | `jsonb` | `json` | `text` |

1 つのコンテンツタイプが持てる `string`、`email`、`uid`、`enumeration` の属性は最大 60 個です（MySQL の行サイズの上限）。それ以上には `text` を使ってください。

### `unique`

`unique: true` を受け付ける型には、`(column, locale, publication_state)` の一意インデックスが付きます。同じロケールの 2 つの公開されたエントリー、または 2 つの下書きは値を共有できませんが、下書きとその公開バージョンは共有できます。これに反する書き込みは、その属性のバリデーションエラーで失敗します。コンポーネント内では、`unique` は受け付けられますが強制されません（コンポーネントの値は JSON として保存されるため）。

## テキスト

### `string`

1 行のテキスト。

| オプション | 説明 |
| --- | --- |
| `minLength`、`maxLength` | 文字数の範囲。`maxLength` は最大 255。 |
| `regex` | 値が一致する必要があるパターン。先読み・後読みや後方参照を含む、JavaScript 風の構文。 |
| `unique` | [`unique`](#unique) を参照。 |
| `default` | 範囲内で `regex` に一致する文字列。 |

`varchar(255)` として保存されます。API: 文字列。

### `text`

より長いプレーンテキスト（管理画面ではテキストエリア）。

| オプション | 説明 |
| --- | --- |
| `minLength`、`maxLength` | 長さの範囲。上限はありません。 |
| `default` | 範囲内の文字列。 |

`text`（MySQL では `longtext`）として保存されます。API: 文字列。

### `richtext`

Markdown のテキスト。オプション、保存、API は `text` と同じで、管理画面では Markdown エディターで編集します。

### `blocks`

Strapi の blocks の JSON としてのリッチテキスト。`paragraph`、`heading`（`level` は 1〜6）、`list`（`format` は `ordered` または `unordered`、`list-item` の子を持ち、最大 8 階層までネスト）、`quote`、`code`（任意の `language`）、`image` のブロックのリストです。インラインの子は、`bold`、`italic`、`underline`、`strikethrough`、`code` のマークを持つ `text` ノードと、`link` ノードです。ブロックは最大 10,000 個です。

オプションも `default` もありません。JSON として保存されます。API: 書かれたとおりのブロックのリスト。

```json
[
  { "type": "heading", "level": 2, "children": [{ "type": "text", "text": "Hello" }] },
  { "type": "paragraph", "children": [{ "type": "text", "text": "bold", "bold": true }] }
]
```

### `email`

メールアドレス（`name@domain.tld`、空白なし）。

| オプション | 説明 |
| --- | --- |
| `minLength`、`maxLength` | 長さの範囲。`maxLength` は最大 255。 |
| `unique` | [`unique`](#unique) を参照。 |
| `default` | メールアドレス。 |

`varchar(255)` として保存されます。API: 文字列。

### `password`

書き込み時に Argon2id でハッシュされるシークレット。

| オプション | 説明 |
| --- | --- |
| `minLength`、`maxLength` | 送られたパスワードの長さの範囲。 |

`default` はありません。常に private で、返されることも、フィルターやソートに使われることもありません。コンポーネント内には置けません。`varchar(255)`（ハッシュ）として保存されます。インポートでは既存の bcrypt と Argon2 のハッシュがそのまま保たれるので、インポートしたアカウントもログインできます。

### `uid`

スラッグのような、URL 用の識別子。管理画面は `targetField` から生成します。

| オプション | 説明 |
| --- | --- |
| `targetField` | 値を生成する元になる、同じ型の `string` または `text` の属性。 |
| `minLength`、`maxLength` | 長さの範囲。`maxLength` は最大 255。 |
| `regex` | 値が一致する必要があるパターン。指定しない場合は `^[A-Za-z0-9\-_.~]*$`。 |
| `default` | 有効な値。 |

常に一意です（[`unique`](#unique) を参照）。`varchar(255)` として保存されます。API: 文字列。

### `enumeration`

固定のリストの中の 1 つの値。

| オプション | 説明 |
| --- | --- |
| `enum` | 値。少なくとも 1 つで、それぞれ 1〜255 文字、重複なし。 |
| `default` | 値の 1 つ。 |

`varchar(255)` として保存されます。API: 文字列。それ以外の値の書き込みは失敗します。

## 数値

### `integer`

32 ビットの整数（−2,147,483,648〜2,147,483,647）。

| オプション | 説明 |
| --- | --- |
| `min`、`max` | 範囲（整数）。 |
| `unique` | [`unique`](#unique) を参照。 |
| `default` | 範囲内の整数。 |

`integer` として保存されます。API: 数値。書き込みでは数値と整数の文字列を受け付けます。

### `biginteger`

64 ビットの整数。オプションは `integer` と同じです。

`bigint` として保存されます。API: Strapi と同様に文字列（`"9007199254740993"`）。JavaScript の数値は 2⁵³ を超えると精度を失うためです。書き込みでは文字列と数値を受け付けます。

### `float`

倍精度の浮動小数点数。オプションは `integer` と同じで、範囲は数値です。

`double precision`（`double`、`real`）として保存されます。API: 数値。

### `decimal`

正確な小数。

| オプション | デフォルト | 説明 |
| --- | --- | --- |
| `precision` | `10` | 全体の桁数。1〜38。 |
| `scale` | `2` | 小数点以下の桁数。最大 `precision`。 |
| `min`、`max` | | 範囲。 |
| `unique` | | [`unique`](#unique) を参照。 |
| `default` | | 範囲内の数値。 |

値は `scale` 桁に丸められ（データベースと同じく、0 から遠ざかる方向への四捨五入）、小数点より前の桁が `precision - scale` 桁を超えると拒否されます。書き込みでは数値と数値の文字列を受け付けます。`numeric(precision,scale)`（SQLite では何も丸めないよう `text`）として保存されます。API: 数値、または [`[api].decimal_as_string`](/ja/reference/configuration/) を使えば正確な文字列。

## 日付とブール値

### `boolean`

`true` または `false`。`default` を受け付けます。`boolean`（`tinyint(1)`、`integer`）として保存されます。API: ブール値。

### `date`

暦の日付、`YYYY-MM-DD`。`unique` と `default` を受け付けます。`date` として保存されます。API: `"2026-09-29"`。

### `time`

時刻、`HH:MM`、`HH:MM:SS`、`HH:MM:SS.mmm`。`unique` と `default` を受け付けます。ミリ秒の精度で保存されます。API: `"14:30:00.000"`。

### `datetime`

ある時点。ゾーン（`Z` または `+02:00`）付きの ISO 8601 のタイムスタンプです。`unique` と `default` を受け付けます。ミリ秒の精度で UTC で保存されます。API: `"2026-09-29T12:30:00.000Z"`。

## `json`

任意の JSON の値。`default`（任意の JSON）を受け付けます。`jsonb`（`json`、`text`）として保存されます。API: 書かれたとおりの値。`filters` では JSON の属性は `$null` と `$notNull` だけに対応し、ソートには使えません。

## メディア

### `media`

メディアライブラリのファイル。

| オプション | デフォルト | 説明 |
| --- | --- | --- |
| `multiple` | `false` | 1 つではなく、ファイルのリストを保持します。 |
| `allowedTypes` | すべて | ファイルの種類: `images`、`videos`、`audios`、`files`（それ以外すべて）。 |

`default` はありません。リンクテーブル `{table}_{attribute}_mda` に順序付きで保存されます。書き込みではファイル ID を受け取ります: `12`、`{ "id": 12 }`、それらのリスト、または `null`。API: `populate` した場合のみ。ファイルオブジェクト（Strapi と同じく `url`、`mime`、`width`、`formats` など）、そのリスト、または `null`。[メディア](/ja/concepts/media/)を参照してください。

## リレーション

### `relation`

別のコンテンツタイプのドキュメントへのリンク。

| オプション | 説明 |
| --- | --- |
| `relation` | `oneToOne`、`oneToMany`、`manyToOne`、`manyToMany`、`oneWay`、`manyWay`、またはポリモーフィックな種類（下記）。 |
| `target` | 対象のコンテンツタイプ: `article`、`api::article`、`api::article.article`。 |
| `inversedBy` | 双方向のリレーションの所有側で、それを映す対象の属性。 |
| `mappedBy` | 反対側で、対象の所有側の属性。 |

双方向のリレーションの両側は整合している必要があります。`oneToMany` は `manyToOne` を映し、`oneToOne` と `manyToMany` は自分自身を映し、`mappedBy` の側は、`inversedBy` で指し返す属性を指定します。`oneWay` と `manyWay` に反対側はありません。

リンクは所有側（`mappedBy` のない側）の `{table}_{attribute}_lnk` に、対象の `documentId` を指して順序付きで保存されます。書き込みでは `documentId` を受け取ります。

| 書き込み | 意味 |
| --- | --- |
| `"d8f3…"`、`{ "documentId": "d8f3…" }`、それらのリスト | リンクを置き換えます。 |
| `null` または `[]` | すべてのリンクを削除します。 |
| `{ "set": [...] }` | リンクを置き換えます。 |
| `{ "connect": [...], "disconnect": [...] }` | リンクを追加・削除します。`connect` の項目には `position` を付けられます: `{ "before": id }`、`{ "after": id }`、`{ "start": true }`、`{ "end": true }`。 |

API: `populate` した場合のみ。関連ドキュメント（エントリーとリレーションごとに最大 1,000 件）、または `populate[tags][count]=true` で `{ "count": n }`。[リレーション](/ja/concepts/relations/)を参照してください。

コンポーネント内では `oneWay` と `manyWay` だけが使え、コンポーネントが `documentId` を保存します。

### ポリモーフィックリレーション

`relation` は、任意のコンテンツタイプのドキュメントをリンクするポリモーフィックな種類も受け付けます。

| `relation` | オプション | 説明 |
| --- | --- | --- |
| `morphToOne` | なし | 任意の型の 1 件のドキュメントをリンクします。 |
| `morphToMany` | なし | 任意の型の複数のドキュメントをリンクします。 |
| `morphOne` | `target`、`morphBy` | 逆側: `target` の `morphToOne` または `morphToMany` の属性 `morphBy` のリンクを読みます。 |
| `morphMany` | `target`、`morphBy` | 同上、複数。 |

所有側は `(type, documentId)` の組を `{table}_{attribute}_mph` に保存します。書き込みでは `{ "__type": "api::article", "documentId": "…" }` の項目（1 つ、リスト、`null`、または `{ "set": [...] }`）を受け取ります。populate された項目は `__type` に型を持ちます。コンポーネント内には置けません。

## コンポーネントとダイナミックゾーン

### `component`

`schema/components/<category>/<name>.json` で定義したフィールドのグループ。

| オプション | デフォルト | 説明 |
| --- | --- | --- |
| `component` | 必須 | コンポーネントの UID、`category.name`（`shared.seo`）。 |
| `repeatable` | `false` | 1 つではなく、項目のリストを保持します。 |
| `min`、`max` | | 項目の数。`repeatable` の場合のみ。 |

`default` はありません。新しい項目には、その属性自身のデフォルトが入ります。エントリーの行に JSON として保存され、各項目は `id` を持ちます。書き込みでは項目のオブジェクト（またはリスト）を受け取り、既存の項目を保つには `id` を付けます。API: `populate` した場合のみ、項目やリスト全体。`filters` ではコンポーネントのフィールドでフィルターできます（`filters[seo][metaTitle][$eq]=…`）。[コンポーネントとダイナミックゾーン](/ja/concepts/components-and-dynamic-zones/)を参照してください。

### `dynamiczone`

各項目が複数のコンポーネントのいずれかである、項目のリスト。

| オプション | 説明 |
| --- | --- |
| `components` | 許可するコンポーネントの UID。少なくとも 1 つで、重複なし。 |
| `min`、`max` | 項目の数。 |

各項目は、その UID を持つ `__component` を持ちます。エントリーの行に JSON として保存されます。API: `populate` した場合のみ、リスト全体。コンポーネントでのフィルターは `filters[blocks][__component][$eq]=blocks.hero` です。ダイナミックゾーンはコンポーネントの中にネストできません。

## フィールド間のバリデーション

属性ごとのオプションに加えて、コンテンツタイプは `validations` で複数のフィールドにまたがるルールを宣言でき、`required` と同じタイミングで確認されます。

```json
"validations": [
  {
    "rule": { "<=": [{ "var": "startDate" }, { "var": "endDate" }] },
    "message": "The end date must be after the start date",
    "field": "endDate"
  }
]
```

`rule` は、エントリーに対して成り立つ必要がある JSON Logic の式です。`var`、`==`、`!=`、`===`、`!==`、`<`、`>`、`<=`、`>=`、`!`、`!!`、`and`、`or`、`in`、`if`、`?:`、`+`、`-`、`*`、`/`、`%`、`min`、`max`、`cat` を使えます。`message` は `field`（その型の属性）またはエントリーに対して報告されます。これは Verdin 独自の機能で、Strapi には対応するものがありません。

## Strapi との違い

- **コンポーネントは、結合テーブルを持つコンポーネントのテーブルではなく、エントリーの行に JSON として保存されます。** 読み取りに結合が要りません。その結果、`password` の属性、ポリモーフィックリレーション、双方向のリレーションはコンポーネントの中に置けず、`unique` もそこでは強制されません。
- **populate したコンポーネントは丸ごと返されます。** コンポーネントやダイナミックゾーンに対する `populate` は、そのすべてのフィールドを返します。Strapi のようにネストしたフィールドを選ぶことはできません。
- **スキーマファイルは厳密です。** Strapi が無視する不明なキーや、型が受け付けないオプションはエラーになります。`pluginOptions` で読まれるのは `i18n.localized` だけで、残りは無視されます。
- **`string`、`email`、`uid` はカラムのサイズである 255 文字が上限で**、データベースで失敗するのではありません。
- **`conditions`** （条件付きフィールド）は Strapi 5.17 と同じように動作します。隠れたフィールドは必須になりません。
- **`validations`** は Verdin 独自のものです。
- それ以外は Strapi v5 と同じです。型の名前、そのオプション、文字列としての `biginteger` の値、`connect`、`disconnect`、`set`、`position` によるリレーションの書き込み、そして blocks の形式です。
