{{/* Names and labels. */}}
{{- define "verdin.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "verdin.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "verdin.selectorLabels" -}}
app.kubernetes.io/name: {{ include "verdin.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "verdin.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "verdin.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* The Secret holding the server secrets. */}}
{{- define "verdin.secretName" -}}
{{- default (include "verdin.fullname" .) .Values.secrets.existingSecret }}
{{- end }}

{{/* True when the database is SQLite on the pod's volume. */}}
{{- define "verdin.sqlite" -}}
{{- if and (not .Values.database.existingSecret) (or (not .Values.database.url) (hasPrefix "sqlite:" .Values.database.url)) -}}
true
{{- end }}
{{- end }}

{{/* True when /data is a volume only one pod can mount. */}}
{{- define "verdin.rwo" -}}
{{- if and .Values.persistence.enabled (not (has "ReadWriteMany" .Values.persistence.accessModes)) -}}
true
{{- end }}
{{- end }}

{{/*
Refuses settings that would corrupt data or split the instances: several replicas on
SQLite, on a ReadWriteOnce volume, or without the shared event bus.
*/}}
{{- define "verdin.validate" -}}
{{- if gt (int .Values.replicaCount) 1 }}
{{- if include "verdin.sqlite" . }}
{{- fail "replicaCount > 1 needs an external database: set database.url (or database.existingSecret) to PostgreSQL, MySQL or MariaDB. SQLite runs on one pod." }}
{{- end }}
{{- if ne .Values.cluster.bus "database" }}
{{- fail "replicaCount > 1 needs cluster.bus=database, so realtime events, presence, caches and search reach every replica." }}
{{- end }}
{{- if include "verdin.rwo" . }}
{{- fail "replicaCount > 1 cannot share a ReadWriteOnce volume on /data: set persistence.enabled=false and s3.enabled=true (or a ReadWriteMany storage class)." }}
{{- end }}
{{- end }}
{{- if and (include "verdin.sqlite" .) (not .Values.persistence.enabled) }}
{{- fail "SQLite without persistence loses the database on every restart: enable persistence or set database.url." }}
{{- end }}
{{- if not (has .Values.cluster.bus (list "none" "database")) }}
{{- fail "cluster.bus must be \"none\" or \"database\"." }}
{{- end }}
{{- if and .Values.s3.enabled (or (not .Values.s3.bucket) (not .Values.s3.publicUrl)) }}
{{- fail "s3.enabled needs s3.bucket and s3.publicUrl." }}
{{- end }}
{{- end }}

{{/* Schema path in the container. */}}
{{- define "verdin.schemaPath" -}}
{{- if .Values.schema.path }}
{{- .Values.schema.path }}
{{- else if .Values.schema.files }}
{{- "/etc/verdin/schema" }}
{{- end }}
{{- end }}

{{/* A ConfigMap key for a schema file path (keys cannot contain "/"). */}}
{{- define "verdin.schemaKey" -}}
{{- . | replace "/" "__" }}
{{- end }}
