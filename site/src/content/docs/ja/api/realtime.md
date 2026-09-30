---
title: "リアルタイム API"
description: "Verdin のリアルタイムストリームで使う Server-Sent Events のプロトコル。エンドポイント、認証、イベント名とメッセージの形、管理画面のプレゼンスプロトコルを説明します。"
sidebar:
  order: 5
  label: "リアルタイム"
---

Verdin は、コンテンツとメディアの変更をコミットされた時点で [Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events)（SSE）で配信します。各購読者には、読み取りが許可されたものに関するイベントだけが届きます。このページではプロトコルを説明します。フロントエンドでの使い方は[リアルタイム更新](/ja/guides/frontend/realtime/)を参照してください。

## 有効化

リアルタイムはデフォルトでオフです。**設定 → 機能 → リアルタイム**（権限 `features.manage`）でオンにします。オフの間、エンドポイントは `404` を返します。

## コンテンツストリーム

```
GET /api/_events
GET /api/_events?types=api::article,api::category
```

| パラメーター | 説明 |
| --- | --- |
| `types` | 任意。カンマ区切りのコンテンツタイプ UID。`plugin::upload` はメディアライブラリです。Strapi 形式の `api::article.article` も使えます。指定しない場合は、読み取りが許可されたすべての型のイベントを受け取ります。 |

認証は REST API と同じです。`Authorization: Bearer …` に API トークンかエンドユーザーの JWT を入れるか、公開アクセスならヘッダーを付けません。無効なトークンには、ストリームを開く前に `401` を返します。

```sh title="Terminal"
curl -N -H "Authorization: Bearer $VERDIN_TOKEN" \
  'https://cms.example.com/api/_events?types=api::article'
```

```text
event: ready
data: {}

event: entry.publish
data: {"event":"entry.publish","uid":"api::article","documentId":"k2m7q4dx8n5t1v3b9c0e6a2wfr","locale":"en"}

event: media.create
data: {"event":"media.create","uid":"plugin::upload","documentId":"v3k9…","fileId":5}
```

## メッセージ

最初のイベントは常に `ready` です。その後、変更ごとにその名前の SSE イベントが届き、`data` は JSON オブジェクトです。

| フィールド | 含まれる場合 | 説明 |
| --- | --- | --- |
| `event` | 常に | イベント名。SSE の `event:` 行と同じです。 |
| `uid` | 常に | コンテンツタイプの UID。メディアの場合は `plugin::upload`。 |
| `documentId` | 常に | 変更されたドキュメントまたはファイル。 |
| `locale` | 多言語化された型 | 変更されたバージョンのロケール。 |
| `fileId` | メディアのイベント | メディアフィールドで使う、ファイルの数値 ID。 |
| `actorId` | 管理画面ストリーム | 管理者が変更した場合の、その管理者。 |

| イベント | 送られるタイミング | 受け取る相手 |
| --- | --- | --- |
| `entry.create`、`entry.update`、`entry.discard-draft` | ドキュメントの作成、保存、下書きの破棄 | 下書きと公開を使う型では `readDrafts` を持つ呼び出し元（これらのイベントは下書きだけを変更するため）。それ以外の型では `find` または `findOne` を持つ呼び出し元。 |
| `entry.publish`、`entry.unpublish`、`entry.delete` | ドキュメントの公開、非公開、削除 | その型に `find` または `findOne` を持つ呼び出し元 |
| `media.create`、`media.update`、`media.delete` | ファイルのアップロード、編集、削除 | メディアライブラリに `find` または `findOne` を持つ呼び出し元 |

イベントが運ぶのは ID だけで、コンテンツは含みません。内容を読むには、呼び出し元の通常の権限で REST または GraphQL API からドキュメントやファイルを取得してください。イベントは REST、GraphQL、管理パネル、リリース、プラグインなど、すべての API から発生します。

## 接続の有効期間

- サーバーは 15 秒ごとにキープアライブのコメントを送ります。
- コンテンツストリームは 1 時間で終了します。再接続してください（ブラウザーの `EventSource` は自動で再接続します）。再接続時にはトークンも再確認されます。
- `data: {"missed": 12}` を持つ `lagged` という名前のイベントは、クライアントの読み取りが遅すぎて、その数のイベントが破棄されたことを意味します。クライアントが表示している内容を取得し直してください。
- 再送はありません。クライアントが切断されている間に起きたイベントは、後から送られません。

ブラウザーの `EventSource` は `Authorization` ヘッダーを送れません。公開アクセスならそのまま使えます。トークンを使う場合は、ストリーミングでボディを読む `fetch` か、ヘッダーに対応した SSE クライアントを使ってください。

## 管理画面ストリーム

管理パネルは、管理者のアクセストークンを使って専用のストリームを開きます。

```
GET /admin/api/events?types=api::article
```

このストリームは、管理者が読み取れる型（`content.read` と `media.read` による）について、下書きを含む同じコンテンツとメディアのイベントを運び、さらに次のものを含みます。

- 管理者による変更の `actorId`
- `presence` イベント（後述）
- エントリーの `uid`、`documentId`、`locale` を持つ `comment.create`、`comment.update`、`comment.delete`、`comment.resolve`、`comment.reopen`、`task.create`、`task.update`、`task.delete`

管理画面ストリームは、アクセストークンの有効期間である 15 分で終了します。新しいトークンで再接続してください。

### プレゼンス

エントリーエディターは、誰がそのエントリーを開いているかをサーバーに伝えます。

```
POST /admin/api/presence
{ "uid": "api::article", "documentId": "k2m7q4…", "locale": "en", "editing": true }
```

- エディターが開いている間、約 20 秒ごとに送ってください。`editing: true` は、管理者に未保存の変更があることを意味します。エディターを閉じるときは `"leave": true` を送ります。
- プレゼンスは、最後のハートビートから 45 秒で期限切れになります。
- 応答には、そのエントリーを開いている人の一覧が入ります: `{ "data": [{ "userId": 3, "name": "Ada Lovelace", "editing": true, "holdsLock": true }] }`。
- `GET /admin/api/presence?uid=&documentId=&locale=` で同じ一覧を読めます。
- 一覧が変わると、管理画面ストリームはエントリーの `uid`、`documentId`、`locale` と、`presence` に入った一覧を持つ `presence` イベントを受け取ります。

まだ編集中の最初の管理者がソフトロック（`holdsLock`）を持ちます。エディターは他の管理者にそれを表示しますが、保存を妨げることはありません。プレゼンスを読むには、その型に対する `content.read` が必要です。

## 複数のインスタンス

共有イベントバス（`[cluster].bus = "database"`）を使うと、すべてのインスタンスのストリームに全インスタンスのイベントが流れ、プレゼンスとソフトロックもどのインスタンスでも同じになります。他のインスタンスのイベントは、`[cluster].poll_interval_ms` 以内（MySQL、MariaDB、SQLite）、または即座に（PostgreSQL、`LISTEN/NOTIFY`）届きます。バスがない場合、イベントとプレゼンスは、クライアントが接続しているインスタンスのものです。`/api/_events` と `/admin/api/events` をスティッキーセッションでルーティングするか、リアルタイムのクライアントを 1 つのインスタンスに接続してください。[スケーリング](/ja/deploy/scaling/#共有イベントバス)を参照してください。
