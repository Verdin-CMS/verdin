---
title: Kubernetes
description: הריצו את Verdin על Kubernetes — Deployment עם probes, Secret ו-Service עבור PostgreSQL ו-S3, והתקנה עם רפליקה אחת ו-PersistentVolumeClaim עבור SQLite.
sidebar:
  order: 7
---

העמוד הזה מריץ פרויקט Verdin על Kubernetes. ההתקנה העיקרית היא stateless: PostgreSQL
(או MySQL/MariaDB) מחוץ ל-pods, מדיה באחסון תואם S3, וכמה רפליקות שתצטרכו. אחריה מופיעה
התקנה עם רפליקה אחת ו-volume עבור SQLite.

המניפסטים משתמשים ב-APIs יציבים (`apps/v1`, `v1`) ואומתו מול הסכמות של Kubernetes עם
`kubeconform -strict` ב-2026-09-29, ולא הורצו על cluster אמיתי. החליפו כל ערך שבסוגריים
משולשים.

## 1. בנו את האימג' שלכם

אפו את התצורה והסכמה שלכם לתוך אימג' שמבוסס על האימג' הרשמי, כך שכל גרסה תשלח את הסכמה
שאיתה בוצעה ההגירה (ראו [אימג' משלכם](/he/deploy/docker/)):

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337
public_url = "https://cms.example.com"
trusted_proxies = ["<pod CIDR of your ingress controller, e.g. 10.0.0.0/8>"]

[schema]
path = "schema"

[log]
format = "json"

[api]
cache_ttl_secs = 5         # short: each replica keeps its own cache

[metrics]
enabled = true             # token from VERDIN_METRICS_TOKEN

[upload]
provider = { name = "s3", bucket = "<bucket>", region = "<region>",
             public_url = "https://<bucket public URL or CDN>" }

[upload.transforms]
cache_dir = "/tmp/transforms"
```

דחפו אותו ל-registry שלכם כ-`<registry>/verdin-site:<version>`.

## 2. סודות

```yaml title="secret.yaml"
apiVersion: v1
kind: Secret
metadata:
  name: verdin
type: Opaque
stringData:
  VERDIN_ADMIN_JWT_SECRET: "<from verdin secrets>"
  VERDIN_TOKEN_PEPPER: "<from verdin secrets>"
  VERDIN_DATABASE_URL: "postgres://<user>:<password>@<host>:5432/<db>"
  VERDIN_METRICS_TOKEN: "<random token>"
  AWS_ACCESS_KEY_ID: "<key>"
  AWS_SECRET_ACCESS_KEY: "<secret>"
```

או צרו אותו מהפלט של `verdin secrets` עם
`kubectl create secret generic verdin --from-env-file=…`, והוסיפו את השאר.

## 3. Deployment ו-Service

```yaml title="verdin.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: verdin
spec:
  replicas: 2
  selector:
    matchLabels: { app: verdin }
  template:
    metadata:
      labels: { app: verdin }
    spec:
      terminationGracePeriodSeconds: 30
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
      containers:
        - name: verdin
          image: <registry>/verdin-site:<version>
          args: ["start", "--migrate"]
          ports:
            - { name: http, containerPort: 1337 }
          envFrom:
            - secretRef: { name: verdin }
          env:
            # Scheduled plugin jobs on one replica only (see below).
            - { name: VERDIN_PLUGINS__RUN_JOBS, value: "false" }
          startupProbe:
            httpGet: { path: /_ready, port: http }
            periodSeconds: 5
            failureThreshold: 60        # up to 5 minutes for migrations
          readinessProbe:
            httpGet: { path: /_ready, port: http }
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /_health, port: http }
            periodSeconds: 20
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits: { memory: 1Gi }
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          volumeMounts:
            - { name: tmp, mountPath: /tmp }
      volumes:
        - name: tmp
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: verdin
spec:
  selector: { app: verdin }
  ports:
    - { name: http, port: 80, targetPort: http }
```

חשפו את ה-Service דרך ה-Ingress או ה-Gateway שלכם עם TLS, כמו כל שירות HTTP. מספרי
המשאבים הם נקודת התחלה, לא מדידה.

הערות על המניפסט:

- **הגירות.** כל רפליקה מריצה `start --migrate`. הגירות לוקחות נעילה במסד הנתונים
  (advisory lock ב-PostgreSQL, `GET_LOCK` ב-MySQL/MariaDB), כך שרפליקות שעולות יחד מחילות
  אותן פעם אחת. שלבים מסוכנים או הרסניים אף פעם לא מוחלים בהפעלה: הריצו
  `verdin migrate apply --allow …` כ-Job חד-פעמי עם אותו אימג' לפני ה-rollout.
- **מערכת קבצים שורשית לקריאה בלבד.** העלאות מוזרמות דרך `/tmp`, ולכן הוא צריך `emptyDir`
  ניתן לכתיבה. גם המטמון של המרות התמונות ואינדקס החיפוש צריכים תיקיות ניתנות לכתיבה אם
  אתם משתמשים בהם (`/tmp/transforms` למעלה; הגדירו גם את `VERDIN_SEARCH__DIR`).
- **כיבוי.** Verdin נעצר ב-`SIGTERM`.
- **משימות תוספים.** משימות מתוזמנות של תוספים רצות בכל רפליקה שבה `[plugins].run_jobs`
  הוא true. הריצו Deployment נוסף אחד עם `replicas: 1` ו-`VERDIN_PLUGINS__RUN_JOBS=true`
  (אותן תוויות, כך שהוא גם מגיש תעבורה), או קבלו את זה שהמשימות רצות בכל רפליקה. webhooks,
  מהדורות מתוזמנות והתקציר היומי נלקחים דרך מסד הנתונים ורצים פעם אחת. ראו
  [הרצת כמה מופעים](/he/deploy/scaling/).
- **זמן אמת.** זרמי אירועים (`/api/_events`) נשארים ב-pod שאליו הם מתחברים. השתמשו ב-session
  affinity ב-Ingress אם אתם משתמשים ב[זמן אמת](/he/guides/frontend/realtime/).

## רפליקה אחת עם SQLite

SQLite והעלאות מקומיות צריכים pod אחד ו-volume קבוע:

```yaml title="verdin-sqlite.yaml"
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: verdin-data
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests: { storage: 5Gi }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: verdin
spec:
  replicas: 1
  strategy:
    type: Recreate              # never two pods on the same database file
  selector:
    matchLabels: { app: verdin }
  template:
    metadata:
      labels: { app: verdin }
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
        fsGroup: 65532          # lets the server write to the volume
      containers:
        - name: verdin
          image: <registry>/verdin-site:<version>
          ports:
            - { name: http, containerPort: 1337 }
          envFrom:
            - secretRef: { name: verdin }
          env:
            - { name: VERDIN_DATABASE_URL, value: "sqlite:///data/verdin.db" }
          readinessProbe:
            httpGet: { path: /_ready, port: http }
          livenessProbe:
            httpGet: { path: /_health, port: http }
          volumeMounts:
            - { name: data, mountPath: /data }
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: verdin-data }
```

כאן `verdin.toml` משתמש ב-`provider = { name = "local", dir = "/data/uploads" }`, ואין צורך
ב-`VERDIN_DATABASE_URL` שב-Secret (רשומת ה-`env` גוברת על `envFrom`). `StatefulSet` עם
רפליקה אחת ורשומת `volumeClaimTemplates` עובד באותה דרך. `Recreate` אומר השבתה קצרה בכל
rollout.

## פקודות ניהול

הריצו פקודות CLI ב-pod רץ; באימג' אין shell, אז קראו לקובץ הבינארי:

```sh frame="terminal"
kubectl exec -it deploy/verdin -- verdin admin create --email you@example.com
kubectl exec deploy/verdin -- verdin migrate plan
```
