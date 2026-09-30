---
title: İzleme
description: Çalışan bir Verdin örneğini izleyin — /_health ve /_ready denetimleri, /_metrics adresindeki Prometheus metrikleri ve bir Grafana panosu, OpenTelemetry trace’leri, Sentry hata raporları, günlük biçimi, düzeyler ve istek kimlikleri.
sidebar:
  order: 10
---

Bir Verdin örneği kendisi hakkında iki sağlık uç noktası, isteğe bağlı Prometheus metrikleri,
isteğe bağlı OpenTelemetry trace’leri ve Sentry hata raporları ile yapılandırılmış günlükler
aracılığıyla rapor verir. Bu sayfa her birinin ne döndürdüğünü ve nasıl açılacağını listeler.

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
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`, `kind`, `function` | [Eklenti](/tr/extending/plugins/) fonksiyonlarının harcadığı süre. Aynı bucket’lar. |
| `verdin_plugin_call_errors_total` | counter | `plugin`, `kind`, `function` | Başarısız eklenti çağrıları: bir trap, zaman aşımı, JSON olmayan çıktı veya bir başlangıç fonksiyonunun `{ error }` değeri. |
| `verdin_webhook_deliveries_pending` | gauge | | Gönderilmeyi bekleyen webhook teslimleri. |
| `verdin_realtime_subscribers` | gauge | | Açık gerçek zamanlı olay akışları. |
| `verdin_cluster_events_total` | counter | `direction` | `[cluster].bus` ayarlıyken [paylaşılan olay veriyolundaki](/tr/deploy/scaling/#paylaşılan-olay-veriyolu) olaylar: diğer örneklere `sent`, onlardan `received`, `dropped` (dolu bir kuyruk veya başarısız bir yazma). |
| `verdin_uptime_seconds` | gauge | | Süreç başladığından beri geçen saniye. |
| `verdin_build_info` | gauge | `version` | Her zaman 1; çalışan sürüm. |

`area`, sunucunun bölümüdür: `api` (içerik API’si), `admin_api`, `admin` (panelin dosyaları),
`graphql`, `mcp`, `uploads`, `internal` (`/_` ile başlayan yollar) veya `other`. `status`,
durum sınıfıdır: `2xx`, `3xx`, `4xx` veya `5xx`.
Eklenti çağrılarında `kind` değeri `hook`, `route`, `job`, `startup` veya `graphql`’dir;
eklenti serileri ilk çağrıdan sonra görünür (bkz.
[eklenti başvurusu](/tr/extending/plugin-reference/#metrikler)).

Yararlı uyarılar: `/_ready`’nin başarısız olması, `5xx` payının artması,
`verdin_webhook_deliveries_pending` değerinin büyümesi (bir webhook hedefi çökmüş),
`verdin_plugin_call_errors_total` değerinin artması veya yavaş eklenti hook’ları (üzerinde
çalıştıkları yazmaları geciktirirler) ve `verdin_uptime_seconds` değerinin sıfırlanması
(yeniden başlatmalar).

### Grafana panosu

[`docker/grafana/verdin.json`](https://github.com/Verdin-CMS/verdin/blob/main/docker/grafana/verdin.json),
bu metrikler için bir panodur: istek hızı, `5xx` payı ve alana, metoda ve durum sınıfına göre
gecikme kuantilleri, bekleyen webhook teslimleri, gerçek zamanlı aboneler, olay veriyolu
trafiği ve eklenti fonksiyonu başına eklenti çağrı hızı, p95 ve hatalar. Grafana’da içe
aktarın (**Dashboards → New → Import**) ve Prometheus veri kaynağınızı seçin; en üstteki
`instance` ve `area` değişkenleri her paneli filtreler.

## Trace’ler (OpenTelemetry)

Verdin her isteğin izini, OTLP/HTTP üzerinden bir OpenTelemetry collector’a (OpenTelemetry
Collector, Grafana Alloy veya Tempo, Jaeger, Honeycomb, Datadog…) aktarabilir. Varsayılan
olarak kapalıdır:

```toml title="verdin.toml"
[telemetry]
enabled = true
endpoint = "http://otel-collector:4318"
```

Standart değişkenler de çalışır ve dosyaya üstün gelir:

```sh
VERDIN_TELEMETRY__ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<key>
OTEL_SERVICE_NAME=cms-production
```

Her iz şunları içerir:

- **Bir istek span’i** (tür `server`), metoddan ve id’lerin `{id}` ile değiştirildiği yoldan
  adlandırılır (`PUT /api/articles/{id}`); `http.response.status_code` ve `5xx`’te bir hata
  durumu taşır. W3C `traceparent` başlığı olan bir istek çağıranın izine katılır.
- **Veritabanı ifadesi başına bir span** (tür `client`), onun altında: `db.system.name`
  (`postgresql`, `mysql`, `mariadb` veya `sqlite`) ve `db.query.text`, yani `?`
  yer tutucularıyla SQL. Bağlanan değerler asla kaydedilmez; böylece içerik, parolalar ve
  token’lar izlerin dışında kalır. `COMMIT` ve `ROLLBACK`’in kendi span’leri vardır ve
  SQLite’ta bir `write lock` span’i, bir yazmanın önündeki yazarları ne kadar beklediğini
  gösterir.
- İstek sunulurken yazılan günlük olayları, span olayları olarak.

Bir istek dışında çalışan ifadeler (başlangıç, migrasyonlar, arka plan görevleri) izlenmez.
`[telemetry].sample_ratio` izlerin bir payını tutar (`0.1` ondan birini tutar); span’ler
gruplar hâlinde gönderilir ve sunucu durduğunda boşaltılır. Günlük düzeyi izleri
filtrelemez: `[log].level = "warn"` yine de her isteği aktarır.

## Hata raporlama (Sentry)

Panik’leri ve `5xx` yanıtlarını [Sentry](https://sentry.io)’ye (veya GlitchTip gibi Sentry
uyumlu bir servise) göndermek için bir DSN ayarlayın:

```sh
SENTRY_DSN=https://<key>@o0.ingest.sentry.io/<project>
```

`[telemetry].sentry_dsn` de çalışır; değişken üstün gelir. Bir `5xx`, `http.method`,
`http.status_code` ve `request_id` ile etiketlenmiş `POST /api/articles answered 500` hata
olayı olarak gelir; `request_id`, `X-Request-Id` başlığıyla ve o isteğin günlük satırlarıyla
eşleşir. Olaylar sürüm olarak Verdin sürümünü, ortam olarak `production` (`verdin start`)
veya `development` (`verdin dev`) değerini taşır; `SENTRY_ENVIRONMENT` veya
`[telemetry].sentry_environment` başka bir ad vermedikçe. URL’ler, günlüklerdeki gibi gizli
görünen sorgu değerleri gizlenerek raporlanır; istek gövdeleri ve başlıkları asla gönderilmez.

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
