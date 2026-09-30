---
title: Linux sunucusu
description: Verdin’i bir Debian veya Ubuntu sunucusunda .deb paketinden çalıştırın — bir systemd servisi, bir verdin sistem kullanıcısı, /var/lib/verdin içinde durum — bir ters proxy’nin arkasında.
sidebar:
  order: 3
---

Bu sayfa Verdin’i konteyner olmadan, her sürüme eklenen `.deb` paketinden doğrudan bir Debian veya
Ubuntu sunucusunda çalıştırır. Aynı düzen, [kurulum betiğinin](/tr/start/installation/) ikili dosyası
ve [`deploy/deb/`](https://github.com/verdin-cms/verdin/tree/main/deploy/deb) altındaki dosyaların
elle kopyalanmasıyla diğer dağıtımlarda da çalışır.

Paket 2026-09-30 tarihinde `cargo deb` ile derlendi ve incelendi; bu kılavuz için canlı bir
sunucuya kurulmadı.

## Paketin kurduğu şeyler

| Yol | Ne |
| --- | --- |
| `/usr/bin/verdin` | İkili dosya (statik, yönetim paneli yerleşik). |
| `/etc/verdin/verdin.toml` | Yapılandırma (bir conffile: yükseltmeler düzenlemelerinizi korur). |
| `/etc/verdin/verdin.env` | İlk kurulumda `0640` moduyla oluşturulur: yeni `VERDIN_ADMIN_JWT_SECRET` ve `VERDIN_TOKEN_PEPPER` ile `VERDIN_DATABASE_URL` (varsayılan olarak SQLite). |
| `/var/lib/verdin/` | `verdin` sistem kullanıcısının ev dizini: SQLite veritabanı, `schema/`, `uploads/`, arama dizini ve görsel önbelleği. |
| `/usr/lib/systemd/system/verdin.service` | Servis, kurulu ama etkinleştirilmemiş. |

Servis `verdin -c /etc/verdin/verdin.toml start --migrate` komutunu `verdin` kullanıcısı olarak,
systemd’nin sandbox’ıyla (salt okunur sistem, özel `/tmp`, yeni ayrıcalık yok) ve yalnızca
`/var/lib/verdin` için yazma erişimiyle çalıştırır. `127.0.0.1:1337` adresini dinler.

## 1. Kurun

```sh frame="terminal"
curl -fsSLO https://github.com/verdin-cms/verdin/releases/download/v0.11.0/verdin_0.11.0-1_amd64.deb
sudo apt install ./verdin_0.11.0-1_amd64.deb
```

ARM sunucularında dosya adında `arm64` kullanın.

## 2. Yapılandırın

1. Commit edilmiş şemanızı `verdin` sahipliğinde `/var/lib/verdin/schema/` dizinine
   (`content-types/` ve `components/`) kopyalayın:

   ```sh frame="terminal"
   sudo rsync -a --chown=verdin:verdin schema/ /var/lib/verdin/schema/
   ```

2. PostgreSQL, MySQL veya MariaDB için `/etc/verdin/verdin.env` içindeki `VERDIN_DATABASE_URL`’i
   düzenleyin. İki secret’ı koruyun: yeni bir `VERDIN_TOKEN_PEPPER` her API token’ını geçersiz
   kılar.
3. `/etc/verdin/verdin.toml` içinde `[server].public_url`’i tarayıcıların kullandığı adrese
   ayarlayın ve ters proxy aynı makinede çalışıyorsa `trusted_proxies = ["127.0.0.1"]` yapın.
   Diğer her anahtar [yapılandırma başvurusundadır](/tr/reference/configuration/).

## 3. Başlatın

```sh frame="terminal"
sudo systemctl enable --now verdin
journalctl -u verdin -f
```

İlk başlangıç tabloları oluşturur. İlk admin’i komut satırından oluşturun (servisin ortam dosyası
veritabanı URL’sini tutar):

```sh frame="terminal"
sudo -u verdin sh -c 'set -a; . /etc/verdin/verdin.env; verdin -c /etc/verdin/verdin.toml admin create --email you@example.com'
```

ya da yönetim panelini proxy’niz üzerinden açın ve orada kaydolun.

## 4. Önüne bir ters proxy koyun

Verdin loopback arayüzünde düz HTTP sunar. Sertifikayı kendi alan ve yenileyen Caddy ile:

```text title="/etc/caddy/Caddyfile"
cms.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:1337
}
```

nginx de çalışır; gerçek zamanlı olaylar geciktirilmesin diye `/api/_events` için tamponlamayı
kapatın (`proxy_buffering off;`).

## Yükseltmeler ve kaldırma

- **Yükseltme:** bir sonraki sürümün `.deb` dosyasını `apt install ./verdin_….deb` ile kurun.
  Çalışıyorsa servis yeniden başlar ve `start --migrate` güvenli migrasyonları uygular.
  Önce [Verdin’i yükseltme](/tr/migrate/upgrading/) sayfasını okuyun.
- **Kaldırma:** `apt remove verdin` servisi durdurur ve veriyi ve yapılandırmayı korur;
  `apt purge verdin` ayrıca `/etc/verdin/verdin.env` dosyasını (secret’lar) siler. `verdin`
  kullanıcısı ve `/var/lib/verdin` paket tarafından asla silinmez: bir [yedeğiniz](/tr/deploy/backups/)
  olduğunda kendiniz kaldırın.
