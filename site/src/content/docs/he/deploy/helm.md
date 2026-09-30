---
title: Helm chart
description: התקינו את Verdin על Kubernetes עם ה-Helm chart ב-deploy/helm/verdin — SQLite על volume עבור pod אחד, או כמה רפליקות עם מסד נתונים חיצוני, S3 ואפיק האירועים המשותף.
sidebar:
  order: 7
---

ה-chart ב-[`deploy/helm/verdin`](https://github.com/verdin-cms/verdin/tree/main/deploy/helm/verdin)
אורז את המניפסטים של [Kubernetes](/he/deploy/kubernetes/): Deployment עם probes, Service,
Ingress אופציונלי, PersistentVolumeClaim עבור `/data` ו-Secret עם סודות השרת. הוא עדיין לא
מפורסם למאגר charts; התקינו אותו משכפול של המאגר.

ה-chart נבדק עם `helm lint --strict` ועם `helm template` (Helm 3) ב-2026-09-30, ולא הותקן על
cluster אמיתי.

## pod אחד עם SQLite

ברירות המחדל מריצות רפליקה אחת עם SQLite, העלאות, מטמון התמונות ואינדקס החיפוש על volume של
5 GiB שמחובר ל-`/data`:

```sh frame="terminal"
git clone --depth 1 https://github.com/verdin-cms/verdin
helm install cms verdin/deploy/helm/verdin \
  --set publicUrl=https://cms.example.com \
  --set ingress.enabled=true --set ingress.hosts[0].host=cms.example.com \
  --set ingress.hosts[0].paths[0].path=/
```

ה-Deployment משתמש באסטרטגיה `Recreate`, כך ששני pods אף פעם לא פותחים את אותו קובץ מסד
נתונים; לכל שדרוג יש השבתה קצרה.

## כמה רפליקות

יותר מרפליקה אחת צריכה שלושה דברים, וה-chart מסרב לעבד (render) בלעדיהם:

- מסד נתונים חיצוני (`database.url` או `database.existingSecret`: PostgreSQL, MySQL או
  MariaDB);
- `cluster.bus: database`, כדי שאירועי זמן אמת, נוכחות, ביטול מטמון ועדכוני חיפוש יגיעו לכל
  pod (ראו [אפיק האירועים המשותף](/he/deploy/scaling/#אפיק-אירועים-משותף));
- בלי volume מסוג ReadWriteOnce על `/data`: מדיה ב-S3 עם `persistence.enabled: false`
  (כל pod שומר אז את מטמון התמונות ואת אינדקס החיפוש שלו ב-`emptyDir`), או storage class
  מסוג ReadWriteMany.

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

כל pod מריץ `start --migrate`; הגירות לוקחות נעילה במסד הנתונים, כך שהן רצות פעם אחת. שלבים
מסוכנים או הרסניים אף פעם לא רצים בהפעלה: החילו אותם עם
`kubectl exec deploy/cms-verdin -- verdin migrate apply --allow …` לפני שאתם מגלגלים את
הפריסה. משימות תוספים מתוזמנות רצות בכל pod שבו `plugins.runJobs` הוא true; ראו
[הרצת כמה מופעים](/he/deploy/scaling/).

## הסכמה

שרתי ייצור לא עורכים את הסכמה, ולכן ה-pods צריכים את הסכמה שעשיתם לה commit:

- **האימג' שלכם (מומלץ).** `FROM ghcr.io/verdin-cms/verdin:0.11` בתוספת
  `COPY schema /app/schema`, ו-`schema.path: /app/schema`. כל אימג' נושא אז את הסכמה שעברה
  איתו הגירה.
- **`schema.files`.** נתיבים יחסיים לתיקיית הסכמה וה-JSON שלהם, שמעובדים ל-ConfigMap
  ומחוברים ב-`/etc/verdin/schema`:

  ```yaml
  schema:
    files:
      content-types/article.json: |
        { "kind": "collectionType", "singularName": "article", … }
  ```

  `helm upgrade … --set-file 'schema.files.content-types/article\.json=schema/content-types/article.json'`
  קורא קובץ מהדיסק.

בלי אחד מהשניים, ה-pods קוראים את `/data/schema` שב-volume.

## סודות

כש-`secrets.existingSecret` ריק, ה-chart יוצר Secret עם `VERDIN_ADMIN_JWT_SECRET` ו-
`VERDIN_TOKEN_PEPPER` (אקראיים בהתקנה, נקראים חזרה ונשמרים בשדרוגים), בתוספת כתובת מסד
הנתונים, פרטי הגישה ל-S3 ואסימון המדדים שתעבירו ב-values. ל-Secret ול-volume יש
`helm.sh/resource-policy: keep`: `helm uninstall` משאיר אותם, כך שהתקנה מחדש מוצאת את
הנתונים שלה ואסימוני API עדיין עובדים. גבו את ה-Secret יחד עם מסד הנתונים.

כדי לנהל סודות בעצמכם (Sealed Secrets, External Secrets, Vault), צרו Secret עם המפתחות
האלה והגדירו `secrets.existingSecret`.

## ערכים

| ערך | ברירת מחדל | מה |
| --- | --- | --- |
| `image.repository`, `image.tag` | `ghcr.io/verdin-cms/verdin`, ה-`appVersion` של ה-chart | האימג'. |
| `replicaCount` | `1` | ראו [כמה רפליקות](#כמה-רפליקות). |
| `args` | `["start", "--migrate"]` | הפקודה של השרת. |
| `publicUrl` | | `VERDIN_SERVER__PUBLIC_URL`. |
| `trustedProxies` | `[]` | `VERDIN_SERVER__TRUSTED_PROXIES`. |
| `secrets.adminJwtSecret`, `secrets.tokenPepper`, `secrets.existingSecret` | נוצרים | ראו [סודות](#סודות). |
| `database.url`, `database.existingSecret`, `database.existingSecretKey` | SQLite על `/data` | מסד הנתונים. |
| `cluster.bus`, `cluster.pollIntervalMs` | `none`, `1000` | `[cluster]`. שם כל pod הוא ה-`instance_id` שלו. |
| `s3.*` | כבוי | ספק ההעלאות S3: `bucket`, `region`, `endpoint`, `publicUrl`, `prefix`, `pathStyle`, פרטי גישה או `existingSecret`. |
| `schema.path`, `schema.files` | | ראו [הסכמה](#הסכמה). |
| `configToml` | | `verdin.toml` שלם, שמחובר ב-`/app/verdin.toml`. משתני הסביבה של ה-chart עדיין גוברים. |
| `metrics.enabled`, `metrics.token` | כבוי | מדדי Prometheus ב-`/_metrics`. |
| `plugins.runJobs` | `true` | `[plugins].run_jobs`. |
| `extraEnv`, `extraEnvFrom` | `[]` | משתנים נוספים, למשל `VERDIN_TELEMETRY__ENABLED`. |
| `persistence.*` | פעיל, 5Gi, ReadWriteOnce | ה-volume של `/data` (`existingClaim`, `storageClass`, `accessModes`, `size`). |
| `service.*`, `ingress.*` | ClusterIP בפורט 80, בלי Ingress | רשת. |
| `probes.*` | | Startup ו-readiness על `/_ready`, liveness על `/_health`. |
| `resources`, `nodeSelector`, `tolerations`, `affinity`, `podAnnotations`, `podLabels` | | תזמון. |
| `podSecurityContext`, `securityContext` | uid 65532, שורש לקריאה בלבד, בלי capabilities | אבטחה. `/tmp` הוא `emptyDir`. |

`values.yaml` ב-chart מתעד כל מפתח.
