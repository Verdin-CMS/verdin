---
title: Railway
description: Verdin’i deponuzun Dockerfile’ından, Railway PostgreSQL ile ve medyayı S3 uyumlu depolamada ya da bir volume’de tutarak Railway’e dağıtın.
sidebar:
  order: 6
---

Bu sayfa bir Verdin projesini [Railway](https://railway.com)’e dağıtır: deponuzdaki küçük bir
Dockerfile’dan derlenen bir servis, bir Railway PostgreSQL veritabanı ve S3 uyumlu depolamada
medya (ya da tek bir örnek için bir volume).

:::note
Railway’in ayarları 2026-09-29 tarihinde [Railway’in dokümantasyonuna](https://docs.railway.com/reference/config-as-code)
karşı denetlendi; kurulum canlı bir Railway hesabında dağıtılmadı. `# yours` ile işaretlenen
veya köşeli parantez içindeki değerleri siz doldurmalısınız.
:::

## 1. Bir Dockerfile, bir yapılandırma ve `railway.json` ekleyin

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
provider = { name = "s3", bucket = "media", region = "auto",             # yours
             endpoint = "https://<account>.r2.cloudflarestorage.com",    # yours
             public_url = "https://media.example.com" }                  # yours
```

```json title="railway.json"
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "healthcheckPath": "/_ready",
    "healthcheckTimeout": 120,
    "restartPolicyType": "ON_FAILURE"
  }
}
```

Başlatma komutu gerekmez: imaj, sunmadan önce güvenli migrasyonları uygulayan
`start --migrate` komutunu çalıştırır. `.env` dosyasını deponun dışında tutun.

## 2. Projeyi oluşturun

1. Railway’de GitHub deponuzdan bir proje oluşturun. Railway `railway.json`’ı bulur ve
   Dockerfile’ı derler.
2. Projeye bir **PostgreSQL** veritabanı ekleyin.
3. Verdin servisinin **Variables** bölümüne şunları ekleyin:

   | Değişken | Değer |
   | --- | --- |
   | `VERDIN_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (veritabanı servisinin özel URL’si; veritabanı servisinizin adını kullanın) |
   | `VERDIN_ADMIN_JWT_SECRET` | `verdin secrets` çıktısından |
   | `VERDIN_TOKEN_PEPPER` | `verdin secrets` çıktısından |
   | `VERDIN_SERVER__PUBLIC_URL` | `https://<your-domain>` |
   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | S3 kimlik bilgileriniz |

   İki secret’ı yerelde oluşturun:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets
   ```

4. Servisin ağ ayarlarında **Generate Domain**’e tıklayın ve hedef portunu `1337` yapın.
   Verdin `[server].port` üzerinde dinler ve Railway’in `PORT` değişkenini okumaz.
5. Dağıtın, `https://<your-domain>/admin/` adresini açın ve ilk admin’i kaydedin.

## Varyant: volume üzerinde medya veya SQLite

Tek bir örnek için yüklemeleri, hatta veritabanını, `/data` konumuna bağlanan bir Railway
volume’ünde tutabilirsiniz:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

PostgreSQL’i atlarsanız `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` ile birlikte. Şunları
unutmayın:

- Volume’ü olan bir servisin replikaları olamaz ve her yeniden dağıtımda kısa bir kesinti olur.
- Railway volume’leri root sahipliğinde bağlar ve imaj uid `65532` olarak çalışır. Sunucunun
  volume’e yazabilmesi için servis değişkeni `RAILWAY_RUN_UID=0`’ı ayarlayın.

## İstemci adresleri

Railway’in edge proxy’si servisin önünde durur. Adres aralığı bu kılavuz için doğrulanmadı, bu
yüzden `[server].trusted_proxies` boş kalır: bu durumda her ziyaretçi hız sınırları için aynı
adres olarak sayılır; bu yüzden proxy’nin aralığını bulup ona güvenmedikçe
`[api].public_rate_limit` değerini `0`’da tutun.
