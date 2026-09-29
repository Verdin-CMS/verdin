---
title: "Webhook"
description: "Webhook のイベント、ペイロードの形、ヘッダー、署名の検証、再試行、配信ログについて説明します。"
sidebar:
  order: 6
---

Webhook は、コンテンツやメディアが変わったときに、あなたの URL へ HTTP `POST` を送ります。このページは受信側のためのリファレンスで、イベント、ペイロード、ヘッダー、署名、配信を扱います。管理パネルで Webhook を作成・管理する方法は [Webhook](/ja/guides/integrations/webhooks/) を参照してください。

## イベント

| イベント | 送られるタイミング |
| --- | --- |
| `entry.create` | ドキュメントが作成されたとき。REST、GraphQL、管理パネル、プラグインなど、どの API からでも送られます。 |
| `entry.update` | ドキュメントが保存されたとき。 |
| `entry.publish` | ドキュメントが公開されたとき。REST や GraphQL で `status=draft` なしに作成・更新すると公開されます。 |
| `entry.unpublish` | ドキュメントが非公開にされたとき。 |
| `entry.discard-draft` | ドキュメントの下書きが破棄されたとき。 |
| `entry.delete` | ドキュメントが削除されたとき。 |
| `media.create`、`media.update`、`media.delete` | ファイルがアップロード、編集、削除されたとき。フォルダーを削除すると、その中の各ファイルについて `media.delete` が送られます。 |
| `releases.publish` | [リリース](/ja/guides/content/releases/)が、即時または指定日時に実行されたとき。 |
| `review-workflows.updateEntryStage` | エントリーが別の[レビューの段階](/ja/guides/content/review-workflows/)に移ったとき。 |

Webhook は一部のイベントを購読し、一部のコンテンツタイプに限定することもできます。メディアのイベントはコンテンツタイプに結び付きません。

## ペイロード

すべてのペイロードには `event` と `createdAt`（イベントがキューに入った時刻）があります。エントリーのイベントには、コンテンツタイプとドキュメントが加わります。

```json
{
  "event": "entry.publish",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "model": "article",
  "uid": "api::article",
  "locale": null,
  "entry": {
    "id": 3,
    "documentId": "k2m7q4dx8n5t1v3b9c0e6a2wfr",
    "title": "Hello, Verdin",
    "slug": "hello-verdin",
    "createdAt": "2026-09-25T08:55:00.000Z",
    "updatedAt": "2026-09-25T09:00:00.000Z",
    "publishedAt": "2026-09-25T09:00:00.000Z"
  }
}
```

- `model` は型の `singularName`、`uid` はその UID、`locale` は変更されたバージョンのロケールです（多言語化されていない型では `null`）。
- `entry` は REST API が返すとおりのドキュメントで、リレーション、メディア、コンポーネント、`private` なフィールドは含みません。
- `entry.publish` は公開バージョンを運びます。その他のエントリーのイベントは、下書きを運びます（下書きと公開を使わない型では唯一のバージョン）。
- `entry.delete` は `{ "documentId": … }` だけを運びます。

メディアのイベントは `media` にファイルオブジェクトを入れて送り、`model`、`uid`、`entry` はありません。

```json
{
  "event": "media.create",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "media": { "id": 5, "documentId": "v3k9…", "name": "harbour.jpg", "mime": "image/jpeg", "url": "/uploads/harbour_4f1c.jpg" }
}
```

`releases.publish` は、各アクションの結果を含む `release` を送ります。`review-workflows.updateEntryStage` は次を送ります。

```json
{
  "event": "review-workflows.updateEntryStage",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "model": "article",
  "uid": "api::article",
  "entry": { "documentId": "k2m7q4…", "locale": "en" },
  "workflow": { "id": 1, "name": "Editorial" },
  "stages": { "from": { "id": 1, "name": "To do" }, "to": { "id": 2, "name": "In review" } }
}
```

エントリーのイベントと同様に、`model` は単数形の名前、`uid` はコンテンツタイプの UID です（0.10 より前は、ここの `model` に UID が入っていました）。

**テストイベントを送信**ボタンは `{ "event": "trigger-test", "createdAt": … }` を送ります。

## ヘッダー

| ヘッダー | 値 |
| --- | --- |
| `content-type` | `application/json` |
| `x-verdin-event` | イベント名。 |
| `x-verdin-delivery` | 配信 ID。再試行しても変わらないので、重複を無視するのに使います。 |
| `x-verdin-signature` | Webhook が署名されている場合は `t=<unix seconds>,v1=<hex>`。 |

Webhook には、エンドポイント用の `authorization` トークンなど、独自のヘッダーを追加できます。上のヘッダーは上書きできません。

## 署名の検証

Webhook はデフォルトで署名されます。`v1` は、Webhook のシークレット（`whsec_…`）を鍵にした `<t>.<raw body>` の HMAC-SHA256 の 16 進表記です。シークレットは、Webhook を作成したときとシークレットを更新したときに一度だけ表示されます。

配信を確認する手順は次のとおりです。

1. ヘッダーを `t` と `v1` に分けます。
2. `t` が自分の時計から数分以上ずれていれば拒否します。
3. `t`、ドット、そして**生の**リクエストボディに対して HMAC を計算します。先に JSON をパースして再シリアライズしないでください。バイト列が変わってしまいます。
4. `v1` と定数時間で比較します。

```js title="verify.mjs"
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, header, rawBody, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=')));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const received = parts.v1 ?? '';
  return (
    received.length === expected.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  );
}
```

Express では、生のボディを読み、パースする前に検証します。

```js title="server.mjs"
import express from 'express';
import { verify } from './verify.mjs';

const app = express();

app.post('/hooks/verdin', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body.toString('utf8');
  if (!verify(process.env.VERDIN_WEBHOOK_SECRET, req.get('x-verdin-signature') ?? '', rawBody)) {
    return res.sendStatus(401);
  }
  const payload = JSON.parse(rawBody);
  console.log(req.get('x-verdin-delivery'), payload.event, payload.entry?.documentId);
  res.sendStatus(204);
});

app.listen(3000);
```

Python の場合:

```python title="verify.py"
import hashlib
import hmac
import time


def verify(secret: str, header: str, raw_body: bytes, tolerance: int = 300) -> bool:
    parts = dict(part.split("=", 1) for part in header.split(","))
    if abs(time.time() - int(parts["t"])) > tolerance:
        return False
    signed = parts["t"].encode() + b"." + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))
```

## 配信と再試行

配信は変更がコミットされた時点でデータベースのキューに入り、バックグラウンドのワーカーが送信します。遅いエンドポイントや失敗するエンドポイントが編集者や API の書き込みを遅くすることはなく、配信は再起動後も残ります。

- **成功**: `2xx` の応答すべて。
- **失敗**: それ以外のステータス（リダイレクトを含み、リダイレクトは追いかけません）、接続エラー、タイムアウト（`[webhooks].timeout_secs`、デフォルトは 10 秒）。
- **再試行**: 失敗した配信は 30 秒後、2 分後、10 分後、1 時間後、6 時間後に再試行され、合計 6 回試みます。その後は失敗として記録されます。
- Webhook を無効化または削除すると、保留中の再試行は止まります。
- 複数のインスタンスはキューを共有し、各配信はそのうちの 1 つが担当します。

すばやく `2xx` で応答し、時間のかかる処理はその後で行ってください。配信は複数回届くことがあり（タイムアウト後の再試行など）、順序が入れ替わることもあります。`x-verdin-delivery` で重複をスキップし、順序が重要な場合はドキュメントを取得し直してください。

## 配信ログ

**設定 → Webhook** の各 Webhook のページには、新しい順に並んだ**配信ログ**があります。配信ごとに、状態（**保留中**、**送信中**、**成功**、**失敗**）、HTTP ステータス、レスポンスボディの先頭 2 KB、エラー、試行回数、次回の試行時刻、所要時間、送信したペイロードが表示されます。失敗した配信はログから再試行できます。

完了した配信は `[webhooks].retention_days`（デフォルトは 30）日後に削除されます。

同じデータは [Admin API](/ja/api/admin/) からも取得できます: `GET /admin/api/webhooks/{id}/deliveries` と `POST /admin/api/webhooks/deliveries/{id}/retry`。

## URL の制限

`verdin start` では、Webhook の URL にループバック、プライベート、リンクローカル、その他の予約済みアドレスは使えません。IP アドレスで書いた場合も、それらに解決されるホスト名で書いた場合も同じです。管理者が Webhook を使って内部サービスに到達することはできません。`verdin dev` では許可されるので、`localhost` に向けてテストできます。`[webhooks].allow_private_networks` でデフォルトを上書きできます。認証情報を含む URL（`https://user:pass@…`）は拒否されるので、ヘッダーに入れてください。

## Strapi との比較

ペイロードは Strapi に従っています（`event`、`createdAt`、`model`、`uid`、`entry`）。Verdin は、署名、再試行、配信ログ、コンテンツタイプごとのフィルターを追加しています。Strapi の `entry.draft-discard` イベントは `entry.discard-draft` という名前です。
