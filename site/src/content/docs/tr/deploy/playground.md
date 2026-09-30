---
title: Barındırılan playground
description: Verdin’in herkese açık bir demosunu çalıştırın — SQLite üzerinde demo içeriği ve bir demo hesabıyla blog örneği, her saat silinip yeniden doldurulur — deploy/playground içinden.
sidebar:
  order: 11
---

[`deploy/playground/`](https://github.com/verdin-cms/verdin/tree/main/deploy/playground), herkese
açık bir demo için bir konteyner derler: SQLite üzerinde [blog örneği](https://github.com/verdin-cms/verdin/tree/main/examples/blog),
birkaç yayımlanmış makale ve ziyaretçilerin oturum açabileceği bir demo hesabıyla. Her saat
veritabanını atar ve baştan başlar. Konteyner bir volume, bir veritabanı sunucusu veya sizden hiçbir
secret gerektirmez. Nerede barındıracağınız size kalmış; herkese açık bir HTTPS adresiyle tek bir
konteyner çalıştıran her platform işe yarar.

Betikler 2026-09-30 tarihinde yerel bir derlemeye karşı çalıştırıldı (üç sıfırlama döngüsü); imaj
derlendi ama yayımlanmış bir sürümden çalıştırılmadı.

## Ziyaretçilerin aldıkları

- `/admin/` adresindeki yönetim paneli, **demo@example.com** / **verdin-demo-1234** ile oturum
  açılmış olarak. Hesabın **Editör** rolü vardır: içerik oluşturabilir, düzenleyebilir, yayımlayabilir
  ve silebilir ve medya yükleyebilir; ancak kullanıcıları, rolleri, API token’larını, webhook’ları
  veya ayarları yönetemez.
- REST (`/api/articles?populate=*`) ve GraphQL üzerinden makalelere, kategorilere, etiketlere ve
  ana sayfaya herkese açık okuma erişimi.
- İki yayımlanmış makale, bir taslak, iki kategori, iki etiket ve ana sayfa.

Rastgele ve kimsenin bilmediği bir parolayla bir Super Admin de vardır.

## Nasıl çalışır

`run.sh` döngüde çalışır:

1. `/var/lib/verdin-playground` dizinini (veritabanı, yüklemeler, arama dizini, görsel önbelleği)
   siler ve yeni secret’lar üretir; böylece son döngüdeki oturumlar biter.
2. `verdin start --migrate` başlatır ve `/_ready`’yi bekler.
3. `seed.sh` çalıştırır: hesapları CLI ve admin API üzerinden oluşturur, herkese açık okuma erişimini
   açar ve içeriği oluşturur.
4. `PLAYGROUND_RESET_SECONDS` (3600) kadar bekler, sunucuyu durdurur ve baştan başlar. Sunucu
   kendiliğinden durursa hemen baştan başlar.

Yapılandırma (`deploy/playground/verdin.toml`) yüklemeleri 2 MB ile sınırlar, anonim istekleri adres
başına dakikada 300 ile hız sınırına tabi tutar, webhook teslimlerini özel adreslerden uzak tutar ve
aramayı etkinleştirir.

## Derleyin ve çalıştırın

Depo kökünden:

```sh frame="terminal"
docker build -f deploy/playground/Dockerfile -t verdin-playground .
docker run -p 1337:1337 --tmpfs /var/lib/verdin-playground:uid=65532,gid=65532 verdin-playground
```

İmaj, `curl` ve `jq` içeren Alpine’dir (betikler bir kabuğa ihtiyaç duyar, resmi imajda yok) ve
`ghcr.io/verdin-cms/verdin` imajından kopyalanmış statik ikili dosyayı içerir. Sürümü seçmek için
`--build-arg VERDIN_IMAGE=ghcr.io/verdin-cms/verdin:<version>` verin. `tmpfs` veriyi bellekte tutar;
o olmadan veri konteynerin dosya sisteminde yaşar, bu da çalışır.

| Değişken | Varsayılan | Ne |
| --- | --- | --- |
| `PLAYGROUND_RESET_SECONDS` | `3600` | Sıfırlamalar arasındaki süre. |
| `PLAYGROUND_EMAIL`, `PLAYGROUND_PASSWORD` | `demo@example.com`, `verdin-demo-1234` | Demo hesabı. |
| `VERDIN_SERVER__PUBLIC_URL` | | Playground’un herkese açık adresi. |
| `VERDIN_SERVER__TRUSTED_PROXIES` | | Platform proxy’sinin aralığı; böylece hız sınırları ziyaretçi başına uygulanır. |

## Barındırma

Tam olarak bir örnek çalıştırın (veritabanı yereldir), çalışır durumda tutun (sıfıra ölçekleme yok:
sıfırlama zamanlayıcısı süreçte yaşar) ve önüne HTTPS koyun: yönetim panelinin oturum çerezi `start`
modunda `Secure`’dur, bu yüzden oturum açmak HTTPS gerektirir. Herkes bir saate kadar içerik yazabilir
ve görsel yükleyebilir; bu yüzden ona bağlanan sayfada sıfırlama takvimini belirtin ve örneği çerez
paylaşan her şeyden ayrı bir alan adında tutun.
