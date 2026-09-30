---
title: Sürümler ve dokümantasyon barındırma
description: Sürüm iş akışının yayımladıkları (ikili dosyalar, sağlama toplamları, .deb paketleri, imaj, Homebrew, winget), her isteğe bağlı işin gerektirdiği secret’lar ve dokümantasyon sitesinin, alan adının ve pull request önizlemelerinin nasıl barındırıldığı.
sidebar:
  order: 9
---

Bu sayfa bakımcılar içindir: bir sürüm etiketi push’landığında ne olur, hangi parçalar bir secret veya
hesap gerektirir ve dokümantasyon sitesi nasıl yayımlanır.

## Sürüm iş akışı

Bir `vX.Y.Z` etiketi push’lamak `.github/workflows/release.yml` dosyasını çalıştırır:

| İş | Yayımladığı | Gerektirdiği |
| --- | --- | --- |
| `admin`, `binaries` | `x86_64`/`aarch64-unknown-linux-musl`, `x86_64`/`aarch64-apple-darwin` ve `x86_64-pc-windows-msvc` için `verdin-vX.Y.Z-<target>.tar.gz` (Windows’ta `.zip`). Her arşivde `verdin` ve lisanslarla tek bir klasör vardır. | Hiçbir şey |
| `deb` | musl ikili dosyalarından `cargo deb --no-build` ile derlenen `verdin_X.Y.Z-1_amd64.deb` ve `_arm64.deb`. | Hiçbir şey |
| `publish` | GitHub sürümü: arşivler, paketler ve `SHA256SUMS`, sürümün `CHANGELOG.md` bölümünün notlarıyla. | Hiçbir şey |
| `image` | amd64 ve arm64 için `ghcr.io/verdin-cms/verdin`. | Hiçbir şey |
| `npm` | `@verdin/client`. | `NPM_TOKEN` (yoksa atlanır) |
| `homebrew` | Tap içinde, `deploy/homebrew/verdin.rb.in` dosyasından `Formula/verdin.rb`. | `HOMEBREW_TAP_TOKEN` (yoksa atlanır) |
| `winget` | `deploy/winget/` manifest’leriyle `microsoft/winget-pkgs` deposuna bir pull request. | `WINGET_TOKEN` (yoksa atlanır) |

Varlık adları bir sözleşmedir: `install.sh`, `crates/verdin/Cargo.toml` içindeki `cargo binstall`
metaverisi, Homebrew formülü ve winget manifest’lerinin hepsi bunları sürümden ve hedeften kurar.
`deploy/render-template.sh`, Homebrew ve winget şablonlarını sürümle ve `SHA256SUMS` içindeki
sağlama toplamlarıyla doldurur ve biri eksikse başarısız olur.

## İsteğe bağlı işler için tek seferlik kurulum

| Ne | Nerede |
| --- | --- |
| **Homebrew tap.** `verdin-cms/homebrew-tap` herkese açık deposunu oluşturun (ad, `brew install verdin-cms/tap/verdin` komutunun çalışmasını sağlar). Üzerinde *Contents: read and write* yetkisi olan ayrıntılı bir token’ı `HOMEBREW_TAP_TOKEN` secret’ı olarak ekleyin. Başka bir depo: `HOMEBREW_TAP_REPOSITORY` değişkenini ayarlayın. | Depo secret’ları ve değişkenleri |
| **winget.** `VerdinCMS.Verdin`’in ilk gönderimi winget bakımcıları tarafından incelenir. `microsoft/winget-pkgs`’i gönderen hesapla fork’layın ve o hesabın `public_repo` kapsamlı klasik bir token’ını `WINGET_TOKEN` olarak ekleyin. | Depo secret’ları |
| **npm.** `NPM_TOKEN`, `@verdin` kapsamının bir otomasyon token’ı. | Depo secret’ları |
| **crates.io** (isteğe bağlı). `--git` olmadan `cargo binstall verdin`, crate’in crates.io’da olmasını gerektirir; o zamana kadar dokümanlar `--git` kullanır. | — |
| **Railway düğmesi** (isteğe bağlı). railway.com’da depodan bir şablon oluşturun (yapılandırma yolu `deploy/one-click/railway.json`, bir PostgreSQL servisi, `/data` yolunda bir volume) ve düğmesini README’ye ve [Tek tıkla dağıtımlar](/tr/deploy/one-click/) sayfasına ekleyin. | railway.com |

Render ve DigitalOcean düğmeleri projenin tarafında hesap gerektirmez: `render.yaml` ve
`.do/deploy.template.yaml` dosyalarını varsayılan daldan okurlar.

Bazı sürümler dosyalara yazılıdır ve her minor sürümle birlikte değişir: `deploy/one-click/Dockerfile`,
`deploy/playground/Dockerfile`, `deploy/compose/` ve dokümanlardaki imaj etiketi ile
`deploy/helm/verdin/Chart.yaml` içindeki `version`/`appVersion`.

## Dokümantasyon sitesi

`.github/workflows/site.yml`, `main`’e yapılan ve `site/`’a dokunan her push’ta `site/`’ı derler ve
sonucu `gh-pages` dalının köküne push’lar. GitHub Pages o dalı sunar (Settings → Pages → Source:
*Deploy from a branch*, `gh-pages`, `/`).

### Alan adı

Sitenin nerede yaşadığı tek bir depo değişkenidir, **`SITE_URL`**:

| `SITE_URL` | Site |
| --- | --- |
| ayarlanmamış | `https://verdin-cms.github.io/verdin/` |
| `https://docs.example.com` | O alan adının kökü |
| `https://example.com/verdin` | O alan adında `/verdin` altında |

`site/scripts/repo.mjs` Astro’nun `site` ve `base` değerlerini ondan alır; böylece her bağlantı,
varlık ve site haritası onu izler. `BASE_PATH` ayarlanmışsa yolu yine de geçersiz kılar. Özel bir
alan adı için:

1. Alan adının DNS’ini GitHub Pages’e yönlendirin (bir alt alan adı için `verdin-cms.github.io`’ya
   bir `CNAME` kaydı).
2. Settings → Secrets and variables → Actions → Variables içinde `SITE_URL`’i ayarlayın.
3. Site iş akışını çalıştırın (ya da `main`’e push’layın). `CNAME` dosyasını dala yazar ve GitHub alan
   adını devralır; sertifika verildiğinde *Enforce HTTPS*’i etkinleştirin.

Sitenin dışındaki bağlantılar (README, paket metaverisi, Helm chart’ının `home`’u)
`verdin-cms.github.io/verdin` adresini korur; GitHub onu özel alan adına yönlendirir.

### Pull request önizlemeleri

Siteye dokunan her pull request, bir yorumda bağlantısı verilen `<SITE_URL>/pr-preview/pr-<number>/`
adresinde bir önizleme alır:

1. `site-preview.yml`, `pull_request` üzerinde çalışır. Siteyi `SITE_URL` önizlemenin adresine
   ayarlı olarak derler ve bir artifact olarak yükler. Pull request’in kodunu çalıştırır; bu yüzden,
   bir fork’tan gelen her `pull_request` iş akışında olduğu gibi, salt okunur bir token’ı vardır ve
   secret’ı yoktur.
2. `site-preview-deploy.yml`, bu derleme başarılı olduğunda `workflow_run` üzerinde, bu deponun
   bağlamında çalışır. Artifact’ı indirir, pull request’in açık olduğunu ve derlemenin geçerli head’i
   için yapıldığını denetler, dosyaları `gh-pages` üzerinde `pr-preview/pr-<number>/` klasörüne kopyalar
   ve yorumu günceller. Pull request kodunu asla checkout etmez veya çalıştırmaz.
3. Pull request kapandığında aynı iş akışı (yalnızca `gh-pages`’i klonlayan `pull_request_target`)
   klasörü siler.

Ana dağıtım `pr-preview/`’ı korur ve üçü de tek bir concurrency grubunu paylaşır; böylece aynı anda
yalnızca bir iş `gh-pages`’e yazar.

Önizlemeler dokümantasyonla aynı origin’den sunulur. Bu, oturum açma olmayan statik bir site için
kabul edilebilir; ancak bir fork’un pull request’i kapanana kadar oraya herhangi bir HTML
yayımlayabilir; kötüye kullananların pull request’lerini kapatın. Depo değişkenleri bir fork’un iş
akışında kullanılamıyorsa önizlemesi varsayılan `SITE_URL` için derlenir ve bağlantıları özel bir alan
adı altında bozulur; bu deponun dallarından gelen pull request’lerin önizlemeleri etkilenmez.

### Barındırılan playground

Herkese açık demo, `deploy/playground/` konteynerini çalıştırır; bkz.
[Barındırılan playground](/tr/deploy/playground/). Barındırmak deponun dışındadır: HTTPS arkasında tek
bir konteyneri çalışır durumda tutan her platform.
