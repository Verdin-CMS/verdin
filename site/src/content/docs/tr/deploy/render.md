---
title: Render
description: Verdin’i bir Blueprint ile Render’a dağıtın — deponuzdan derlenen bir Docker web servisi, bir Render PostgreSQL veritabanı ve S3 uyumlu depolamada ya da bir diskte medya.
sidebar:
  order: 5
---

Bu sayfa bir Verdin projesini bir Blueprint (`render.yaml`) ile [Render](https://render.com)’a
dağıtır: deponuzdaki küçük bir Dockerfile’dan derlenen bir web servisi ve bir Render PostgreSQL
veritabanı. Render’ın dosya sistemi geçicidir; bu yüzden medya S3 uyumlu depolamaya ya da tek bir
örnek çalıştırıyorsanız kalıcı bir diske gider.

:::note
Blueprint biçimi 2026-09-29 tarihinde [Render’ın Blueprint başvurusuna](https://render.com/docs/blueprint-spec)
karşı denetlendi; canlı bir Render hesabında dağıtılmadı. `# yours` ile işaretlenen değerleri
siz doldurmalısınız.
:::

Ön koşullar: Render’ın okuyabildiği bir Git deposunda Verdin projeniz (`schema/` ile birlikte).

## 1. Bir Dockerfile ve bir yapılandırma ekleyin

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337

[schema]
path = "schema"

[log]
format = "json"

[upload]
# Cloudflare R2 as an example; any S3-compatible service works.
provider = { name = "s3", bucket = "media", region = "auto",             # yours
             endpoint = "https://<account>.r2.cloudflarestorage.com",    # yours
             public_url = "https://media.example.com" }                  # yours
```

`.env` dosyasını deponun ve imajın dışında tutun (`.dockerignore`).

## 2. `render.yaml` yazın

```yaml title="render.yaml"
services:
  - type: web
    name: verdin
    runtime: docker
    repo: https://github.com/<you>/<your-project>   # yours
    branch: main
    dockerfilePath: ./Dockerfile
    region: frankfurt                               # yours
    healthCheckPath: /_ready
    envVars:
      - key: VERDIN_DATABASE_URL
        fromDatabase:
          name: verdin-db
          property: connectionString
      - key: VERDIN_ADMIN_JWT_SECRET
        generateValue: true
      - key: VERDIN_TOKEN_PEPPER
        generateValue: true
      - key: VERDIN_SERVER__PUBLIC_URL
        value: https://verdin.onrender.com          # yours: the service URL or your domain
      - key: AWS_ACCESS_KEY_ID
        sync: false                                 # asked for when you create the Blueprint
      - key: AWS_SECRET_ACCESS_KEY
        sync: false

databases:
  - name: verdin-db
    databaseName: verdin
    user: verdin
    region: frankfurt                               # yours: the same region
    postgresMajorVersion: "17"
```

Bir örnek tipi seçmek için servise ve veritabanına bir `plan` ekleyin (bkz. Render’ın fiyatlandırma
sayfası); plan olmadan Render kendi varsayılanını kullanır.

`generateValue: true`, Blueprint ilk uygulandığında her secret’ı bir kez oluşturur ve sonrasında
korur. Bunları yeniden oluşturmayın: yeni bir `VERDIN_TOKEN_PEPPER`, tüm API token’larının
çalışmamasına yol açar.

## 3. Dağıtın

1. Render panosunda depodan bir **Blueprint** oluşturun ve `sync: false` değişkenlerinin
   değerlerini girin.
2. İlk dağıtımı bekleyin. İmajın varsayılan komutu `start --migrate`, ilk başlatmada tabloları
   oluşturur ve sonraki dağıtımlarda güvenli migrasyonları uygular.
3. `https://<service>.onrender.com/admin/` adresini açın ve ilk admin’i kaydedin.

Render bir örneği durdurmadan önce `SIGTERM` gönderir; Verdin bunun üzerine işini bitirir ve
çıkar.

## Varyant: diskte medya

Tek bir örnek için yüklemeleri S3 yerine bir Render kalıcı diskinde saklayabilirsiniz.
`verdin.toml` içinde yerel sağlayıcıyı ayarlayın:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

ve servise bir disk ekleyin:

```yaml title="render.yaml"
    disk:
      name: verdin-data
      mountPath: /data
      sizeGB: 5
```

Diskle birlikte Render, servisi birden fazla örneğe ölçeklemenize izin vermez ve dağıtımlar
yenisi başlamadan önce eski örneği durdurur; bu yüzden her dağıtımda kısa bir kesinti olur. Bir
Render veritabanı istemiyorsanız aynı disk bir SQLite veritabanı da tutabilir
(`sqlite:///data/verdin.db`). İmajın kullanıcısının (uid `65532`) diske yazabildiğini denetleyin;
başlatma `/data` üzerinde bir izin hatasıyla başarısız olursa `Dockerfile`’ınıza `USER root`
ekleyin.

## İstemci adresleri

Render’ın proxy’si servisin önünde durur. Adres aralığı bu kılavuz için doğrulanmadı, bu yüzden
`[server].trusted_proxies` boş bırakılır: bu durumda her ziyaretçi hız sınırları için aynı adres
olarak sayılır; bu yüzden proxy’nin aralığını bulup ona güvenmedikçe `[api].public_rate_limit`
değerini `0`’da tutun.
