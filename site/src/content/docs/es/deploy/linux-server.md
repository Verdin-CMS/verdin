---
title: Servidor Linux
description: Ejecuta Verdin en un servidor Debian o Ubuntu con el paquete .deb — un servicio de systemd, un usuario de sistema verdin, el estado en /var/lib/verdin — detrás de un proxy inverso.
sidebar:
  order: 3
---

Esta página ejecuta Verdin directamente en un servidor Debian o Ubuntu, sin contenedores, con el
paquete `.deb` adjunto a cada release. La misma disposición funciona en otras distribuciones con
el binario del [script de instalación](/es/start/installation/) y los archivos de
[`deploy/deb/`](https://github.com/verdin-cms/verdin/tree/main/deploy/deb) copiados a mano.

El paquete se construyó e inspeccionó con `cargo deb` el 2026-09-30; no se instaló en un
servidor real para esta guía.

## Qué instala el paquete

| Ruta | Qué es |
| --- | --- |
| `/usr/bin/verdin` | El binario (estático, con el panel de administración incluido). |
| `/etc/verdin/verdin.toml` | La configuración (un conffile: las actualizaciones conservan tus cambios). |
| `/etc/verdin/verdin.env` | Se crea en la primera instalación, con modo `0640`: un `VERDIN_ADMIN_JWT_SECRET` y un `VERDIN_TOKEN_PEPPER` nuevos, y `VERDIN_DATABASE_URL` (SQLite por defecto). |
| `/var/lib/verdin/` | El directorio personal del usuario de sistema `verdin`: la base de datos SQLite, `schema/`, `uploads/`, el índice de búsqueda y la caché de imágenes. |
| `/usr/lib/systemd/system/verdin.service` | El servicio, instalado pero sin activar. |

El servicio ejecuta `verdin -c /etc/verdin/verdin.toml start --migrate` como el usuario
`verdin`, con el aislamiento de systemd (sistema de solo lectura, `/tmp` privado, sin nuevos
privilegios) y acceso de escritura solo a `/var/lib/verdin`. Escucha en `127.0.0.1:1337`.

## 1. Instala

```sh frame="terminal"
curl -fsSLO https://github.com/verdin-cms/verdin/releases/download/v0.11.0/verdin_0.11.0-1_amd64.deb
sudo apt install ./verdin_0.11.0-1_amd64.deb
```

Usa `arm64` en el nombre del archivo en servidores ARM.

## 2. Configura

1. Copia tu esquema confirmado a `/var/lib/verdin/schema/` (`content-types/` y
   `components/`), con `verdin` como propietario:

   ```sh frame="terminal"
   sudo rsync -a --chown=verdin:verdin schema/ /var/lib/verdin/schema/
   ```

2. Para PostgreSQL, MySQL o MariaDB, edita `VERDIN_DATABASE_URL` en
   `/etc/verdin/verdin.env`. Conserva los dos secretos: un `VERDIN_TOKEN_PEPPER` nuevo
   invalida todos los tokens de API.
3. En `/etc/verdin/verdin.toml`, define `[server].public_url` con la dirección que usan los
   navegadores, y `trusted_proxies = ["127.0.0.1"]` cuando el proxy inverso se ejecuta en la
   misma máquina. Todas las demás claves están en la
   [referencia de configuración](/es/reference/configuration/).

## 3. Arranca

```sh frame="terminal"
sudo systemctl enable --now verdin
journalctl -u verdin -f
```

El primer arranque crea las tablas. Crea el primer administrador desde la línea de comandos (el
archivo de entorno del servicio contiene la URL de la base de datos):

```sh frame="terminal"
sudo -u verdin sh -c 'set -a; . /etc/verdin/verdin.env; verdin -c /etc/verdin/verdin.toml admin create --email you@example.com'
```

o abre el panel de administración a través de tu proxy y regístrate allí.

## 4. Pon un proxy inverso delante

Verdin sirve HTTP plano en la interfaz de loopback. Con Caddy, que obtiene y renueva el
certificado por sí mismo:

```text title="/etc/caddy/Caddyfile"
cms.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:1337
}
```

nginx también funciona; desactiva el búfer para `/api/_events` para que los eventos en tiempo
real no se retengan (`proxy_buffering off;`).

## Actualizaciones y desinstalación

- **Actualizar:** instala el `.deb` de la siguiente release con `apt install ./verdin_….deb`. El
  servicio se reinicia si estaba en marcha, y `start --migrate` aplica las migraciones seguras.
  Lee antes [Actualizar](/es/migrate/upgrading/).
- **Desinstalar:** `apt remove verdin` detiene el servicio y conserva los datos y la
  configuración; `apt purge verdin` también borra `/etc/verdin/verdin.env` (los secretos). El
  paquete nunca borra el usuario `verdin` ni `/var/lib/verdin`: elimínalos tú mismo cuando tengas
  una [copia de seguridad](/es/deploy/backups/).
