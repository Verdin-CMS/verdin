---
title: İzleme
description: Çalışan bir Verdin örneğini izleyin — /_health ve /_ready denetimleri, /_metrics adresindeki Prometheus metrikleri ve token’ı, günlük biçimi, düzeyler ve istek kimlikleri.
sidebar:
  order: 10
---

Bir Verdin örneği kendisi hakkında iki sağlık uç noktası, isteğe bağlı Prometheus metrikleri ve
yapılandırılmış günlükler aracılığıyla rapor verir. Bu sayfa her birinin ne döndürdüğünü ve
nasıl açılacağını listeler.

## Sağlık denetimleri

Her iki uç nokta da API öneklerinin dışında, sunucunun kökünde sunulur ve kimlik doğrulama
gerektirmez.

| Uç nokta | Yanıt | Kullanım amacı |
| --- | --- | --- |
| `GET /_health` | Süreç HTTP sunduğu sürece her zaman `200 {"status":"ok"}`. | Canlılık: yanıt vermeyi bıraktığında süreci yeniden başlatın. |
| `GET /_ready` | Veritabanı bir ping’e yanıt verdiğinde `200 {"status":"ready","database":"postgres"}`, vermediğinde `503 {"status":"unavailable"}`. | Hazır olma ve yük dengeleyici denetimleri: trafiği yalnızca 200 yanıtı veren örneklere gönderin. |

`database` değeri `postgres`, `mysql`, `mariadb` veya `sqlite`’tır. `/_ready` migrasyonları
denetlemez: `verdin start`, migrasyonlar beklerken (`--migrate` onları uygulamadıkça) başlamayı
reddeder; bu yüzden çalışan bir sunucuda bekleyen migrasyon yoktur.

```sh frame="terminal"
curl -s localhost:1337/_ready
{"status":"ready","database":"sqlite"}
```

## Prometheus metrikleri

Metrikleri açın ve bir token ayarlayın:

```toml title="verdin.toml"
[metrics]
enabled = true
```

```sh
VERDIN_METRICS_TOKEN=<a long random string>
```

Ardından `GET /_metrics` Prometheus metin biçimini (sürüm 0.0.4) sunar. Bir token ile
(`[metrics].token`’a üstün gelen `VERDIN_METRICS_TOKEN`), `Authorization: Bearer <token>`
olmadan yapılan bir scrape `401` alır. Token olmadan porta ulaşan herkes metrikleri okuyabilir.

```yaml title="prometheus.yml"
scrape_configs:
  - job_name: verdin
    metrics_path: /_metrics
    authorization:
      type: Bearer
      credentials: <the token>
    static_configs:
      - targets: ["verdin:1337"]
```

Birden fazla örnekle her birini scrape edin: her örnek kendi isteklerini sayar.

| Metrik | Tip | Etiketler | Anlamı |
| --- | --- | --- | --- |
| `verdin_http_requests_total` | counter | `area`, `method`, `status` | Sunulan HTTP istekleri. |
| `verdin_http_request_duration_seconds` | histogram | `area`, `method`, `status` | İstekleri sunma süresi. 5 ms’den 10 sn’ye kadar bucket’lar. |
| `verdin_webhook_deliveries_pending` | gauge | | Gönderilmeyi bekleyen webhook teslimleri. |
| `verdin_realtime_subscribers` | gauge | | Açık gerçek zamanlı olay akışları. |
| `verdin_uptime_seconds` | gauge | | Süreç başladığından beri geçen saniye. |
| `verdin_build_info` | gauge | `version` | Her zaman 1; çalışan sürüm. |

`area`, sunucunun bölümüdür: `api` (içerik API’si), `admin_api`, `admin` (panelin dosyaları),
`graphql`, `mcp`, `uploads`, `internal` (`/_` ile başlayan yollar) veya `other`. `status`,
durum sınıfıdır: `2xx`, `3xx`, `4xx` veya `5xx`.

Yararlı uyarılar: `/_ready`’nin başarısız olması, `5xx` payının artması,
`verdin_webhook_deliveries_pending` değerinin büyümesi (bir webhook hedefi çökmüş) ve
`verdin_uptime_seconds` değerinin sıfırlanması (yeniden başlatmalar).

## Günlükler

Verdin günlükleri standart hataya (stderr) yazar.

| Ayar | Değerler | Varsayılan |
| --- | --- | --- |
| `[log].format` | `pretty` (terminaller için) veya `json` (satır başına bir nesne) | `pretty`; Docker imajında `json` |
| `[log].level` | Bir düzey veya filtre: `error`, `warn`, `info`, `debug`, `trace` ya da modül başına (`info,verdin_api=debug`) | `info` |
| `RUST_LOG` | Aynı sözdizimi; ayarlandığında `[log].level`’a üstün gelir | ayarlanmamış |

Üretimde `json` kullanın ve standart hatayı günlük sisteminize gönderin. Bir JSON satırı şöyle
görünür:

```json
{"timestamp":"2026-09-29T09:27:16.444598Z","level":"INFO","fields":{"message":"verdin listening","address":"0.0.0.0:1337","mode":"production","version":"0.10.0"},"target":"verdin::app"}
```

Başlangıçta `WARN` satırları, üretimde düzeltilmesi gereken ayarları gösterir; örneğin
`[email].provider is 'log'` veya kapatılmış güvenli çerezler.

### İstekler

Her istek bir istek kimliği alır: varsa gelen `X-Request-Id` başlığı, yoksa yeni bir UUID. Bu
kimlik `X-Request-Id` yanıt başlığında geri gönderilir ve istek sunulurken yazılan her günlük
satırına eklenir (`method` ve `uri` ile birlikte `request_id`). Bir isteği sistemler arasında
izlemek için başlığı proxy’nizden iletin.

İstekler `info` düzeyinde tek tek günlüğe yazılmaz. Her isteği durumu ve gecikmesiyle günlüğe
yazmak için HTTP katmanının düzeyini yükseltin:

```sh
RUST_LOG=info,tower_http=debug
```

Günlüğe yazılan URL’ler, adları gizli gibi görünen sorgu parametrelerinin (`token`, `code`,
`state`, `password`, `key`, `signature`, `jwt`…) değerlerini gizler; örneğin
`/api/connect/github/callback?code=[hidden]`.

## Yönetim panelinde

Sürümü, veritabanını ve şemayı bir bakışta görmek için ana sayfa panosuna **Sistem**
widget’ını ekleyin.
