---
title: Fly.io
description: Verdin’i Fly.io’ya kendi imajınız, PostgreSQL ve Tigris nesne depolamasıyla ya da bir volume üzerinde SQLite kullanan tek bir Machine ile dağıtın.
sidebar:
  order: 4
---

Bu sayfa bir Verdin projesini, resmi imajın üzerine kurulmuş küçük bir imaj olarak
[Fly.io](https://fly.io)’ya dağıtır. Önerilen kurulum Machine üzerinde hiçbir durum tutmaz:
veritabanı için PostgreSQL ve medya için Tigris (Fly’ın S3 uyumlu depolaması). Ardından bir
volume üzerinde SQLite kullanan bir varyant gelir.

:::note
Fly’ın biçimleri 2026-09-29 tarihinde [Fly’ın dokümantasyonuna](https://docs.fly.io/reference/configuration/)
karşı denetlendi; kurulum canlı bir Fly hesabında çalıştırılmadı. Köşeli parantez içindeki
değerleri ve `# yours` ile işaretlenenleri siz doldurmalısınız.
:::

Ön koşullar: oturum açılmış [`flyctl`](https://docs.fly.io/flyctl/install/) ve `schema/`
dizini commit edilmiş bir Verdin projesi.

## 1. Bir Dockerfile ve bir yapılandırma ekleyin

Proje dizininde, yapılandırmanızı ve şemanızı resmi imaja kopyalayan bir `Dockerfile` ekleyin
(bkz. [Kendi imajınız](/tr/deploy/docker/)):

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

ve Fly için bir `verdin.toml`:

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337
public_url = "https://my-verdin.fly.dev"       # yours: the app's URL or your domain

[schema]
path = "schema"

[log]
format = "json"

[upload]
provider = { name = "s3", bucket = "my-verdin-media",   # yours: the bucket name
             region = "auto", endpoint = "https://t3.storage.dev",
             public_url = "https://my-verdin-media.t3.tigrisfiles.io" }
```

`.env` dosyasının build bağlamının dışında kaldığından emin olun: onu `.dockerignore`’a ekleyin.

## 2. `fly.toml` yazın

```toml title="fly.toml"
app = "my-verdin"                # yours
primary_region = "fra"           # yours

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 1337
  force_https = true
  # Keep a Machine running: webhooks, scheduled releases, plugin jobs and the
  # daily digest run inside the server process.
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "30s"
    interval = "15s"
    method = "GET"
    timeout = "5s"
    path = "/_ready"

[[vm]]
  memory = "512mb"               # adjust to your content and traffic
```

İmajın varsayılan komutu `start --migrate`, her Machine başladığında güvenli migrasyonları
uygular; bu yüzden `release_command` gerekmez. (Fly, `release_command`’ı volume’süz geçici bir
Machine’de çalıştırır; bu zaten SQLite için çalışmazdı.)

## 3. Uygulamayı, veritabanını ve bucket’ı oluşturun

1. Uygulamayı dağıtmadan oluşturun. `--ha=false` tek bir Machine ile başlar; daha fazlasını
   eklemeden önce [Birden fazla örnek çalıştırma](/tr/deploy/scaling/) sayfasını okuyun.

   ```sh frame="terminal"
   fly launch --no-deploy --copy-config --ha=false
   ```

2. Örneğin [Fly Managed Postgres](https://docs.fly.io/mpg/) veya herhangi bir PostgreSQL
   sağlayıcısıyla bir PostgreSQL veritabanı oluşturun ve bağlantı URL’sini not edin.

3. Herkese açık bir Tigris bucket’ı oluşturun. Komut, uygulamanın secret’ları olarak
   `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3` ve `BUCKET_NAME`
   ayarlar; Verdin ilk ikisini okur. Bucket adını `verdin.toml`’a yazın.

   ```sh frame="terminal"
   fly storage create --public
   ```

4. Verdin’in secret’larını ve veritabanı URL’sini ayarlayın:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets | fly secrets import
   fly secrets set VERDIN_DATABASE_URL='postgres://<user>:<password>@<host>:5432/<db>?sslmode=require'
   ```

5. Dağıtın, ardından `https://<app>.fly.dev/admin/` adresini açın ve ilk admin’i kaydedin:

   ```sh frame="terminal"
   fly deploy
   ```

## İstemci adresleri ve hız sınırları

Fly’ın proxy’si istemciyi `X-Forwarded-For`’a ekler ve
[Fly’ın istek başlıkları dokümantasyonuna](https://docs.fly.io/networking/request-headers/)
göre en sağdaki adres uygulamanızın kendi IP’sidir. Verdin’in istemciyi bulması için proxy’nin
aralığına ve uygulamanızın adreslerine (`fly ips list`) güvenin:

```toml title="verdin.toml"
[server]
trusted_proxies = ["172.16.0.0/12", "<app IPv4>", "<app IPv6>"]
```

Bu, çalışan bir uygulamada doğrulanmadı. Siz denetleyene kadar `[api].public_rate_limit`
değerini `0`’da bırakın: doğru proxy’ler olmadan her ziyaretçi aynı adres olarak sayılır.

## Varyant: SQLite ile tek bir Machine

Küçük bir proje için veritabanını ve yüklemeleri bunun yerine bir Fly volume’ünde
tutabilirsiniz.

- `verdin.toml` içinde `[upload]` altında `provider = { name = "local", dir = "/data/uploads" }`
  ayarlayın (varsayılan dizin, sunucunun yazamadığı `/app`’e göredir) ve
  `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` değerini bir secret olarak ayarlayın.
- `/data` konumuna bir volume bağlayın:

  ```toml title="fly.toml"
  [mounts]
    source = "verdin_data"
    destination = "/data"
    initial_size = "1gb"
  ```

- Tam olarak bir Machine çalıştırın (`fly scale count 1`). Bir volume tek bir Machine’e
  bağlanır ve SQLite paylaşılamaz.
- Fly volume’leri root sahipliğinde oluşturur ve imaj uid `65532` olarak çalışır. Başlatma
  `/data` üzerinde bir izin hatasıyla başarısız olursa `Dockerfile`’ınıza `USER root` ekleyin.

Volume’ü yedekleyin: Fly günlük volume anlık görüntüleri tutar ve `verdin export` size
taşınabilir bir arşiv verir (bkz. [Yedekler](/tr/deploy/backups/)).
