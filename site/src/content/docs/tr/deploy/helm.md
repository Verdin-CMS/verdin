---
title: Helm chart’ı
description: Verdin’i deploy/helm/verdin içindeki Helm chart’ıyla Kubernetes üzerine kurun — tek pod için volume üzerinde SQLite ya da harici veritabanı, S3 ve paylaşılan olay veriyoluyla birden fazla replika.
sidebar:
  order: 7
---

[`deploy/helm/verdin`](https://github.com/verdin-cms/verdin/tree/main/deploy/helm/verdin)
içindeki chart, [Kubernetes](/tr/deploy/kubernetes/) sayfasının manifest’lerini paketler:
probe’lu bir Deployment, bir Service, isteğe bağlı bir Ingress, `/data` için bir
PersistentVolumeClaim ve sunucu secret’larını içeren bir Secret. Henüz bir chart deposunda
yayımlanmadı; depo klonundan kurun.

Chart, 2026-09-30 tarihinde `helm lint --strict` ve `helm template` (Helm 3) ile denetlendi;
canlı bir cluster’a kurulmadı.

## SQLite ile tek pod

Varsayılanlar, SQLite, yüklemeler, görsel önbelleği ve arama dizinini `/data` yoluna bağlı 5 GiB’lik
bir volume üzerinde tutan tek bir replika çalıştırır:

```sh frame="terminal"
git clone --depth 1 https://github.com/verdin-cms/verdin
helm install cms verdin/deploy/helm/verdin \
  --set publicUrl=https://cms.example.com \
  --set ingress.enabled=true --set ingress.hosts[0].host=cms.example.com \
  --set ingress.hosts[0].paths[0].path=/
```

Deployment `Recreate` stratejisini kullanır; böylece iki pod hiçbir zaman aynı veritabanı
dosyasını açmaz; her yükseltmede kısa bir kesinti olur.

## Birden fazla replika

Birden fazla replika üç şey gerektirir ve chart onlar olmadan render etmeyi reddeder:

- harici bir veritabanı (`database.url` veya `database.existingSecret`: PostgreSQL, MySQL
  veya MariaDB);
- `cluster.bus: database`; böylece gerçek zamanlı olaylar, presence, önbellek geçersiz kılma ve
  arama güncellemeleri her pod’a ulaşır (bkz. [paylaşılan olay veriyolu](/tr/deploy/scaling/#paylaşılan-olay-veriyolu));
- `/data` üzerinde ReadWriteOnce volume olmaması: `persistence.enabled: false` ile S3’te medya
  (her pod o zaman görsel önbelleğini ve arama dizinini bir `emptyDir` içinde tutar) veya bir
  ReadWriteMany storage class.

```yaml title="values-production.yaml"
replicaCount: 3
image:
  repository: registry.example.com/verdin-site   # your image, schema baked in
  tag: "2026-09-30"
schema:
  path: /app/schema
publicUrl: https://cms.example.com
trustedProxies: ["10.0.0.0/8"]                    # the pod CIDR of your ingress controller
database:
  existingSecret: verdin-database                  # key VERDIN_DATABASE_URL
cluster:
  bus: database
persistence:
  enabled: false
s3:
  enabled: true
  bucket: media
  region: auto
  endpoint: https://<account>.r2.cloudflarestorage.com
  publicUrl: https://media.example.com
  existingSecret: verdin-s3                        # AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
metrics:
  enabled: true
  token: "<random token>"
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: cms.example.com
      paths: [{ path: /, pathType: Prefix }]
  tls:
    - secretName: cms-example-com-tls
      hosts: [cms.example.com]
```

```sh frame="terminal"
helm upgrade --install cms verdin/deploy/helm/verdin -f values-production.yaml
```

Her pod `start --migrate` çalıştırır; migrasyonlar veritabanında bir kilit alır, bu yüzden bir kez
çalışır. Riskli veya yıkıcı adımlar başlangıçta asla çalışmaz: yayına almadan önce bunları
`kubectl exec deploy/cms-verdin -- verdin migrate apply --allow …` ile uygulayın.
Zamanlanmış eklenti görevleri, `plugins.runJobs` değerinin true olduğu her pod’da çalışır; bkz.
[Birden fazla örnek çalıştırma](/tr/deploy/scaling/).

## Şema

Üretim sunucuları şemayı düzenlemez; bu yüzden pod’ların commit edilmiş şemanıza ihtiyacı vardır:

- **Kendi imajınız (önerilir).** `FROM ghcr.io/verdin-cms/verdin:0.11` artı
  `COPY schema /app/schema` ve `schema.path: /app/schema`. Her imaj böylece migre edildiği şemayı
  taşır.
- **`schema.files`.** Şema dizinine göre göreli yollar ve JSON’ları; bir ConfigMap’e render edilir
  ve `/etc/verdin/schema` yoluna bağlanır:

  ```yaml
  schema:
    files:
      content-types/article.json: |
        { "kind": "collectionType", "singularName": "article", … }
  ```

  `helm upgrade … --set-file 'schema.files.content-types/article\.json=schema/content-types/article.json'`
  diskten bir dosya okur.

İkisi de olmadan pod’lar volume üzerindeki `/data/schema`’yı okur.

## Secret’lar

`secrets.existingSecret` boşken chart, `VERDIN_ADMIN_JWT_SECRET` ve `VERDIN_TOKEN_PEPPER`
içeren (kurulumda rastgele, yükseltmelerde geri okunup korunur) ve ayrıca değerlerde verdiğiniz
veritabanı URL’sini, S3 kimlik bilgilerini ve metrik token’ını içeren bir Secret oluşturur.
Secret ve volume `helm.sh/resource-policy: keep` taşır: `helm uninstall` onları bırakır; böylece
yeniden kurulum verisini bulur ve API token’ları çalışmaya devam eder. Secret’ı veritabanınızla
birlikte yedekleyin.

Secret’ları kendiniz yönetmek için (Sealed Secrets, External Secrets, Vault) bu anahtarlarla bir
Secret oluşturun ve `secrets.existingSecret` ayarlayın.

## Değerler

| Değer | Varsayılan | Ne |
| --- | --- | --- |
| `image.repository`, `image.tag` | `ghcr.io/verdin-cms/verdin`, chart’ın `appVersion`’ı | İmaj. |
| `replicaCount` | `1` | Bkz. [Birden fazla replika](#birden-fazla-replika). |
| `args` | `["start", "--migrate"]` | Sunucunun komutu. |
| `publicUrl` | | `VERDIN_SERVER__PUBLIC_URL`. |
| `trustedProxies` | `[]` | `VERDIN_SERVER__TRUSTED_PROXIES`. |
| `secrets.adminJwtSecret`, `secrets.tokenPepper`, `secrets.existingSecret` | üretilir | Bkz. [Secret’lar](#secretlar). |
| `database.url`, `database.existingSecret`, `database.existingSecretKey` | `/data` üzerinde SQLite | Veritabanı. |
| `cluster.bus`, `cluster.pollIntervalMs` | `none`, `1000` | `[cluster]`. Her pod’un adı onun `instance_id`’sidir. |
| `s3.*` | kapalı | S3 yükleme sağlayıcısı: `bucket`, `region`, `endpoint`, `publicUrl`, `prefix`, `pathStyle`, kimlik bilgileri veya `existingSecret`. |
| `schema.path`, `schema.files` | | Bkz. [Şema](#şema). |
| `configToml` | | Tüm bir `verdin.toml`, `/app/verdin.toml` yoluna bağlanır. Chart’ın ortam değişkenleri yine de üstün gelir. |
| `metrics.enabled`, `metrics.token` | kapalı | `/_metrics` adresinde Prometheus metrikleri. |
| `plugins.runJobs` | `true` | `[plugins].run_jobs`. |
| `extraEnv`, `extraEnvFrom` | `[]` | Daha fazla değişken, ör. `VERDIN_TELEMETRY__ENABLED`. |
| `persistence.*` | açık, 5Gi, ReadWriteOnce | `/data` volume’ü (`existingClaim`, `storageClass`, `accessModes`, `size`). |
| `service.*`, `ingress.*` | 80 portunda ClusterIP, Ingress yok | Ağ. |
| `probes.*` | | `/_ready` üzerinde startup ve readiness, `/_health` üzerinde liveness. |
| `resources`, `nodeSelector`, `tolerations`, `affinity`, `podAnnotations`, `podLabels` | | Zamanlama. |
| `podSecurityContext`, `securityContext` | uid 65532, salt okunur kök, yetenek yok | Güvenlik. `/tmp` bir `emptyDir`’dir. |

Chart içindeki `values.yaml` her anahtarı belgeler.
