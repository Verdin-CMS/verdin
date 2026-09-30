---
title: Üretimde Docker Compose
description: Tek bir sunucu için üretim Compose tarifi — Verdin, PostgreSQL ve otomatik HTTPS’li Caddy ile isteğe bağlı olarak S3 uyumlu medya için RustFS.
sidebar:
  order: 3
---

[`deploy/compose/`](https://github.com/verdin-cms/verdin/tree/main/deploy/compose), tek bir sunucu
için hazır bir kurulumdur: özel bir ağda Verdin ve PostgreSQL, önlerinde kendi aldığı ve yenilediği
bir sertifikayla Caddy. Bir override dosyası, medya için aynı makinede S3 uyumlu bir depo olan
RustFS’i ekler. [Docker](/tr/deploy/docker/) sayfası bu dosyaların kullandığı imajı açıklar.

Dosyalar 2026-09-30 tarihinde `docker compose config` ve `caddy validate` ile denetlendi.

## Dosyalar

| Dosya | Ne |
| --- | --- |
| `compose.yaml` | `verdin`, `db` (PostgreSQL 17) ve `caddy`. Yalnızca Caddy port yayımlar (80, 443 ve HTTP/3 için 443/udp). |
| `compose.s3.yaml` | `rustfs` ve herkese açık okunabilir `media` bucket’ını oluşturan tek seferlik bir iş ekler ve Verdin’in yükleme sağlayıcısını ona çevirir. |
| `Caddyfile` | `$VERDIN_DOMAIN` için TLS, sıkıştırma, `/media/*` için RustFS ve geri kalan her şey için Verdin. |
| `.env.example` | Compose’un okuduğu değişkenler: alan adı, ACME e-postası, imaj etiketi, parolalar. |

## Kurulum

Ön koşullar: Docker’lı bir sunucu, alan adınız için ona işaret eden bir DNS kaydı ve açık 80 ile
443 portları.

1. Dizini sunucuya kopyalayın ve `.env` dosyasını doldurun:

   ```sh frame="terminal"
   cp .env.example .env                                  # VERDIN_DOMAIN, ACME_EMAIL
   echo "DB_PASSWORD=$(openssl rand -hex 24)" >> .env
   docker run --rm ghcr.io/verdin-cms/verdin:0.11 secrets > verdin.env
   ```

2. Commit edilmiş şemanızı `schema/` içine koyun (`content-types/` ve `components/`). Salt okunur
   olarak `/app/schema` yoluna bağlanır.
3. Başlatın:

   ```sh frame="terminal"
   docker compose up -d
   docker compose logs -f verdin
   ```

4. `https://<your domain>/admin/` adresini açın ve ilk admin’i kaydedin.

`.env` ve `verdin.env` dosyalarını sürüm kontrolünün dışında tutun ve yedekleyin: yeni bir
`VERDIN_TOKEN_PEPPER` her API token’ını geçersiz kılar.

## S3’te medya

Varsayılan olarak yüklemeler `verdin-data` volume’üne gider. Bunun yerine RustFS’te saklamak için:

```sh frame="terminal"
echo "S3_SECRET_KEY=$(openssl rand -hex 24)" >> .env
docker compose -f compose.yaml -f compose.s3.yaml up -d
```

Dosyalar o zaman Caddy tarafından `https://<your domain>/media/<key>` adresinde sunulur. AWS S3,
Cloudflare R2 veya başka bir sağlayıcı için RustFS servislerini dışarıda bırakın ve
`VERDIN_UPLOAD__PROVIDER__*` değişkenlerini ile `AWS_*` kimlik bilgilerini o sağlayıcının
değerlerine ayarlayın (bkz. [Depolama](/tr/internals/storage/)). Mevcut bir siteyi geçirmek hiçbir
dosyayı taşımaz: yeni yüklemeler yeni sağlayıcıya gider.

## Notlar

- **İstemci adresleri.** Verdin, Caddy’nin tek proxy olduğu Compose ağından (`172.30.0.0/24`,
  `compose.yaml` içinde sabit) gelen `X-Forwarded-For`’a güvenir. Bu aralık ağlarınızdan biriyle
  çakışıyorsa ikisini de değiştirin.
- **Gerçek zamanlı.** Caddy `text/event-stream` yanıtlarını tamponlamadan akıtır; böylece
  [gerçek zamanlı olaylar](/tr/guides/frontend/realtime/) arkasında değişmeden çalışır.
- **Yükseltmeler.** `.env` içinde `VERDIN_VERSION`’ı değiştirin, ardından
  `docker compose pull && docker compose up -d`. Önce [Verdin’i yükseltme](/tr/migrate/upgrading/)
  sayfasını okuyun.
- **Yedekler.** PostgreSQL’in dökümünü alın ve `verdin-data` volume’ünü (veya bucket’ı) saklayın;
  bkz. [Yedekler](/tr/deploy/backups/).
- **Admin komutları.** İmajda kabuk yok: `docker compose exec verdin verdin admin create --email you@example.com`.
