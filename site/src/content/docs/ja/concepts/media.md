---
title: "メディア"
description: "メディアライブラリ、メディアフィールド、画像のフォーマット、ストレージプロバイダー（ローカルまたは S3）とフォルダー、そしてファイルをコンテンツにリンクする方法を説明します。"
sidebar:
  order: 8
---

メディアライブラリには、コンテンツで使う画像、動画、音声、その他のファイルが入っています。このページでは、ファイルの保存方法、記述方法、ドキュメントへのリンク方法を説明します。サイトでリサイズした画像を提供する方法は[画像](/ja/guides/frontend/images/)を参照してください。

## ファイル

各アップロードは Strapi と同じ形のファイルレコードなので、Strapi 向けに書かれたフロントエンドはそのまま読めます（`formats` は省略しています）。

```json
{
  "id": 5,
  "documentId": "v3k…",
  "name": "harbour.jpg",
  "alternativeText": "Boats in the harbour at dawn",
  "caption": null,
  "width": 2400,
  "height": 1600,
  "focalPoint": { "x": 0.4, "y": 0.6 },
  "formats": {
    "thumbnail": { "url": "/uploads/harbour_thumbnail_4f1c.jpg", "width": 234, "height": 156 },
    "large": { "url": "/uploads/harbour_large_4f1c.jpg", "width": 1000, "height": 667 }
  },
  "hash": "harbour_4f1c",
  "ext": ".jpg",
  "mime": "image/jpeg",
  "size": 812.4,
  "url": "/uploads/harbour_4f1c.jpg",
  "previewUrl": null,
  "provider": "local",
  "provider_metadata": null,
  "createdAt": "2026-09-25T09:00:00.000Z",
  "updatedAt": "2026-09-25T09:00:00.000Z",
  "publishedAt": "2026-09-25T09:00:00.000Z"
}
```

- `size` は Strapi と同様にキロバイト単位です。
- MIME タイプはファイルのバイト列から判定し、クライアントの申告は使いません。
- `focalPoint` は、画像をトリミングするときに残す部分を示します。

ファイルには下書きがありません。アップロードは保存された時点で使えるようになります。

## メディアライブラリ

管理パネルの**メディアライブラリ**は、検索、種類によるフィルター、フォルダー付きでファイルを一覧にします。管理者はファイルのアップロード、URL からのインポート、名前、代替テキスト、キャプション、フォーカルポイントの編集、ID を保ったままのファイル内容の置き換えができ、**どこで使われているか**も確認できます。対象は、メディアフィールド、コンポーネント内のメディア、リッチテキストのブロック、ファイルの URL を含む Markdown です。

**フォルダー**は、編集者のためにライブラリを整理します。API レスポンスのファイルオブジェクトにはフォルダーは表示されませんが、コンテンツ API からのアップロードでは `fileInfo` にフォルダー ID を指定できます。フォルダーを削除すると、その中のファイルも削除されます。

管理者のアクセスは、`media.read`、`media.create`、`media.update`、`media.delete` の権限で制御されます。組み込みの Author ロールは、自分がアップロードしたファイルだけを編集・削除できます。[権限](/ja/concepts/permissions/)を参照してください。

## メディアフィールド

コンテンツタイプは `media` 属性を通じてファイルをリンクします。

```json
"cover": { "type": "media", "allowedTypes": ["images"] },
"gallery": { "type": "media", "multiple": true, "allowedTypes": ["images", "videos"] }
```

| オプション | デフォルト | 説明 |
| --- | --- | --- |
| `multiple` | `false` | 1 つではなく、ファイルのリストを保持します。 |
| `allowedTypes` | すべてのファイル | `images`、`videos`、`audios`、`files`（それ以外すべて）のいずれか。書き込みのたびに、保存された MIME タイプで確認されます。 |

メディアフィールドはリレーションと同じように動きます。ドキュメントの各バージョンが独自のリンクを持ち、公開するとリンクがコピーされ、`required` は公開時に確認されます。リンクはフィールドごとのリンクテーブルに保存されます。[コンポーネント](/ja/concepts/components-and-dynamic-zones/)の中では、代わりにコンポーネントの JSON がファイル ID を保存します。

書き込みでは、ファイル ID を送ります: `5`、`{ "id": 5 }`、`[5, 6]`、フィールドを空にするには `null`。読み取りでは、メディアフィールドは populate した場合（`populate=cover`）にだけ、ファイルオブジェクトとして返されます。ファイルを削除すると、それを使っていたすべてのドキュメントから外れます。

## 画像のフォーマット

ラスター画像をアップロードすると、Verdin は EXIF の向きを反映したうえで、元画像と同じ形式で Strapi のフォーマットを生成します。

| フォーマット | サイズ |
| --- | --- |
| `thumbnail` | 245 × 156 に収まる |
| `large` | 幅 1000 px |
| `medium` | 幅 750 px |
| `small` | 幅 500 px |

元画像がフォーマットより大きくない場合、そのフォーマットはスキップされます。`[upload].breakpoints` で幅と名前を変更でき、`responsive_formats = false` でフォーマットの生成をオフにできます。`max_original_size` は、大きな元画像をアップロード時に縮小し、そのときメタデータ（EXIF、GPS）も削除します。`max_image_megapixels`（デフォルトは 100）は、デコードにメモリを使いすぎる画像を拒否します。ローカルプロバイダーでは、`/uploads` でリクエストに応じて画像をリサイズ・変換することもできます。[画像](/ja/guides/frontend/images/)を参照してください。

## ストレージプロバイダー

ファイルは、`[upload].provider` で設定したプロバイダーが保存します。

| プロバイダー | ファイルの保存先 | 提供元 |
| --- | --- | --- |
| `local`（デフォルト） | プロジェクトからの相対パス `public/uploads`（`dir` オプション） | Verdin サーバーの `/uploads` |
| `s3` | S3 互換の任意のバケット: AWS S3、Cloudflare R2、Backblaze B2、MinIO、RustFS など | バケットまたは CDN の `public_url` |

```toml title="verdin.toml"
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

S3 の認証情報は、`verdin.toml` ではなく、標準の `AWS_*` 環境変数から読み込まれます。すべてのオプションは[設定のリファレンス](/ja/reference/configuration/)にあります。

保存される名前は `{slug}_{random}{ext}` で、変わることがないので、URL は無期限にキャッシュできます。Verdin のインスタンスが複数ある場合は S3 を使ってください。ローカルのファイルは、それを受け取ったインスタンスにしか存在しません。

## 安全性

- アップロードはメモリに保持せず一時ファイルにストリーミングされ、`[upload].max_file_size`（デフォルトは 200 MB）で制限されます。1 リクエストあたりのファイルは最大 20 個です。
- `/uploads` から提供されるファイルには `Content-Security-Policy: sandbox` と `X-Content-Type-Options: nosniff` が付きます。画像、動画、音声、PDF、プレーンテキスト以外はダウンロードとして送られるので、アップロードされた HTML や SVG ファイルがあなたのドメインでスクリプトを実行することはできません。S3 でも、そのような種類のオブジェクトはダウンロードとして保存されます。

## コンテンツ API でのメディア

コンテンツ API には Strapi のアップロード用ルートがあり、**メディアライブラリ**（`plugin::upload`）の許可で確認されます。

| ルート | 許可 |
| --- | --- |
| `POST /api/upload`（マルチパートの `files`、任意の `fileInfo`） | `create` |
| `POST /api/upload?id={id}`（新しい `fileInfo`、任意で新しいファイル） | `update` |
| `GET /api/upload/files` | `find` |
| `GET /api/upload/files/{id}` | `findOne` |
| `DELETE /api/upload/files/{id}` | `delete` |

Strapi と同様に、これらは `data` のエンベロープなしで、プレーンなファイルオブジェクトや配列を返します。[REST API](/ja/api/rest/#メディアライブラリ) を参照してください。変更すると、`media.create`、`media.update`、`media.delete` の [Webhook](/ja/api/webhooks/) イベントと[リアルタイム](/ja/api/realtime/)イベントが送られます。
