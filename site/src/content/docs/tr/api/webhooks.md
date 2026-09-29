---
title: "Webhook’lar"
description: "Webhook olayları, payload biçimleri, başlıklar, imza doğrulama, yeniden denemeler ve teslim günlüğü."
sidebar:
  order: 6
---

Bir webhook, içerik veya medya değiştiğinde URL’nize bir HTTP `POST` gönderir. Bu sayfa
alıcılar için başvuru kaynağıdır: olaylar, payload’lar, başlıklar, imzalar ve teslim. Yönetim
panelinde webhook oluşturmak ve yönetmek için bkz. [Webhook’lar](/tr/guides/integrations/webhooks/).

## Olaylar

| Olay | Ne zaman gönderilir |
| --- | --- |
| `entry.create` | Herhangi bir API’den bir belge oluşturulduğunda: REST, GraphQL, yönetim paneli veya bir eklenti. |
| `entry.update` | Bir belge kaydedildiğinde. |
| `entry.publish` | Bir belge yayınlandığında. REST veya GraphQL üzerinden `status=draft` olmadan bir belge oluşturmak ya da güncellemek onu yayınlar. |
| `entry.unpublish` | Bir belge yayından kaldırıldığında. |
| `entry.discard-draft` | Bir belgenin taslağı atıldığında. |
| `entry.delete` | Bir belge silindiğinde. |
| `media.create`, `media.update`, `media.delete` | Bir dosya yüklendiğinde, düzenlendiğinde veya silindiğinde. Bir klasörü silmek, içindeki her dosya için `media.delete` gönderir. |
| `releases.publish` | Bir [sürüm](/tr/guides/content/releases/) hemen veya belirlenen tarihinde çalıştığında. |
| `review-workflows.updateEntryStage` | Bir kayıt başka bir [inceleme aşamasına](/tr/guides/content/review-workflows/) taşındığında. |

Bir webhook bazı olaylara abone olur ve bazı içerik tipleriyle sınırlanabilir. Medya olayları
bir içerik tipine bağlı değildir.

## Payload’lar

Her payload’da `event` ve `createdAt` (olayın kuyruğa alındığı zaman) bulunur. Kayıt olayları
içerik tipini ve belgeyi ekler:

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

- `model` tipin `singularName` değeri, `uid` UID’si ve `locale` değişen sürümün dilidir
  (yerelleştirilmemiş tiplerde `null`).
- `entry`, REST API’nin döndürdüğü şekliyle, ilişkiler, medya, bileşenler veya `private`
  alanlar olmadan belgedir.
- `entry.publish` yayınlanan sürümü taşır. Diğer kayıt olayları taslağı ya da taslak ve
  yayınlama kullanmayan tiplerde tek sürümü taşır.
- `entry.delete` yalnızca `{ "documentId": … }` taşır.

Medya olayları dosya nesnesini `media` içinde gönderir; `model`, `uid` veya `entry` yoktur:

```json
{
  "event": "media.create",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "media": { "id": 5, "documentId": "v3k9…", "name": "harbour.jpg", "mime": "image/jpeg", "url": "/uploads/harbour_4f1c.jpg" }
}
```

`releases.publish`, `release` nesnesini eylemlerinin her birinin sonucuyla gönderir.
`review-workflows.updateEntryStage` şunu gönderir:

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

Kayıt olaylarında olduğu gibi `model` tekil ad, `uid` ise içerik tipinin UID’sidir (0.10’dan
önce burada `model` UID’yi tutuyordu).

**Test olayı gönder** düğmesi `{ "event": "trigger-test", "createdAt": … }` gönderir.

## Başlıklar

| Başlık | Değer |
| --- | --- |
| `content-type` | `application/json` |
| `x-verdin-event` | Olay adı. |
| `x-verdin-delivery` | Teslim kimliği. Yeniden denemelerde aynı kalır: yinelenenleri yok saymak için kullanın. |
| `x-verdin-signature` | Webhook imzalıysa `t=<unix seconds>,v1=<hex>`. |

Webhook’lar, uç noktanız için bir `authorization` token’ı gibi kendi başlıklarını ekleyebilir.
Yukarıdaki başlıklar geçersiz kılınamaz.

## İmzaları doğrulama

Webhook’lar varsayılan olarak imzalanır. `v1`, webhook’un secret’ı (`whsec_…`) ile anahtarlanmış
`<t>.<raw body>` değerinin hex HMAC-SHA256’sıdır. Secret, webhook oluşturulduğunda veya
secret’ı yenilendiğinde bir kez gösterilir.

Bir teslimi denetlemek için:

1. Başlığı `t` ve `v1` olarak ayırın.
2. `t` saatinizden birkaç dakikadan fazla uzaktaysa reddedin.
3. HMAC’i `t`, bir nokta ve **ham** istek gövdesi üzerinden hesaplayın. JSON’u önce ayrıştırıp
   yeniden serileştirmeyin: baytlar farklı olur.
4. Onu sabit zamanlı olarak `v1` ile karşılaştırın.

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

Express ile ham gövdeyi okuyun ve ayrıştırmadan önce doğrulayın:

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

Python’da:

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

## Teslim ve yeniden denemeler

Teslimler, değişiklik commit edildiğinde veritabanında kuyruğa alınır ve bir arka plan
worker’ı onları gönderir. Yavaş veya hata veren bir uç nokta editörleri ya da API yazmalarını
asla yavaşlatmaz ve teslimler yeniden başlatmadan etkilenmez.

- **Başarı**: herhangi bir `2xx` yanıtı.
- **Hata**: yönlendirmeler (izlenmez), bağlantı hatası veya zaman aşımı
  (`[webhooks].timeout_secs`, varsayılan 10 saniye) dâhil diğer tüm durumlar.
- **Yeniden denemeler**: başarısız bir teslim 30 saniye, 2 dakika, 10 dakika, 1 saat ve 6 saat
  sonra, toplamda altı denemeyle yeniden denenir. Ardından başarısız olarak işaretlenir.
- Bir webhook’u devre dışı bırakmak veya silmek bekleyen yeniden denemelerini durdurur.
- Birden fazla örnek kuyruğu paylaşır; her teslimi bunlardan biri üstlenir.

Hızlıca bir `2xx` ile yanıt verin ve yavaş işleri sonra yapın. Teslimler birden fazla kez
(örneğin bir zaman aşımından sonraki yeniden denemede) ve sırasız gelebilir: yinelenenleri
atlamak için `x-verdin-delivery` kullanın ve sıra önemliyse belgeyi yeniden getirin.

## Teslim günlüğü

**Ayarlar → Webhook’lar** içindeki her webhook sayfasında, en yeniden başlayan bir **Teslim
günlüğü** bulunur. Her teslim için durumu (**Beklemede**, **Gönderiliyor**, **Başarılı**,
**Başarısız**), HTTP durumunu, yanıt gövdesinin ilk 2 KB’ını, hatayı, deneme sayısını, sonraki
deneme zamanını, süreyi ve gönderilen payload’ı gösterir. Başarısız bir teslim günlükten
yeniden denenebilir.

Tamamlanan teslimler `[webhooks].retention_days` (varsayılan 30) sonra kaldırılır.

Aynı veriler [admin API](/tr/api/admin/) üzerinden de erişilebilir:
`GET /admin/api/webhooks/{id}/deliveries` ve `POST /admin/api/webhooks/deliveries/{id}/retry`.

## URL kısıtlamaları

`verdin start` altında webhook URL’leri; ister IP adresi ister bunlara çözümlenen host adı
olarak yazılsın, loopback, özel, link-local veya diğer ayrılmış adreslere işaret edemez. Bir
admin, webhook’ları iç servislere ulaşmak için kullanamaz. `verdin dev` bunlara izin verir,
böylece `localhost`’a karşı test yapabilirsiniz; `[webhooks].allow_private_networks`
varsayılanı geçersiz kılar. Kimlik bilgisi içeren URL’ler (`https://user:pass@…`) reddedilir:
bunları bir başlığa koyun.

## Strapi ile karşılaştırma

Payload’lar Strapi’ninkileri izler (`event`, `createdAt`, `model`, `uid`, `entry`). Verdin
imzalar, yeniden denemeler, bir teslim günlüğü ve içerik tipi başına filtreler ekler.
Strapi’nin `entry.draft-discard` olayının adı `entry.discard-draft`’tır.
