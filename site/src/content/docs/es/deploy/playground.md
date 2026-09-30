---
title: Playground alojado
description: Ejecuta una demo pública de Verdin — el ejemplo del blog en SQLite con contenido de demostración y una cuenta de demo, borrado y sembrado de nuevo cada hora — desde deploy/playground.
sidebar:
  order: 11
---

[`deploy/playground/`](https://github.com/verdin-cms/verdin/tree/main/deploy/playground)
construye un contenedor para una demo pública: el [ejemplo del blog](https://github.com/verdin-cms/verdin/tree/main/examples/blog)
en SQLite, con unos cuantos artículos publicados y una cuenta de demo con la que los visitantes
pueden iniciar sesión. Cada hora tira la base de datos y empieza de nuevo. El contenedor no
necesita volumen, ni servidor de base de datos, ni secretos por tu parte. Dónde alojarlo depende
de ti; vale cualquier plataforma que ejecute un contenedor con una dirección HTTPS pública.

Los scripts se ejecutaron contra una compilación local el 2026-09-30 (tres ciclos de reinicio);
la imagen se construyó pero no se ejecutó desde una release publicada.

## Qué obtienen los visitantes

- El panel de administración en `/admin/`, con la sesión iniciada como **demo@example.com** /
  **verdin-demo-1234**. La cuenta tiene el rol **Editor**: puede crear, editar, publicar y
  eliminar contenido y subir medios, pero no puede gestionar usuarios, roles, tokens de API,
  webhooks ni ajustes.
- Acceso público de lectura a artículos, categorías, etiquetas y la página de inicio por REST
  (`/api/articles?populate=*`) y GraphQL.
- Dos artículos publicados, un borrador, dos categorías, dos etiquetas y la página de inicio.

También existe un Super Admin, con una contraseña aleatoria que nadie conoce.

## Cómo funciona

`run.sh` hace un bucle:

1. Borra `/var/lib/verdin-playground` (base de datos, subidas, índice de búsqueda, caché de
   imágenes) y genera secretos nuevos, así que las sesiones del ciclo anterior terminan.
2. Arranca `verdin start --migrate` y espera a `/_ready`.
3. Ejecuta `seed.sh`: crea las cuentas mediante la CLI y la API de administración, abre el
   acceso público de lectura y crea el contenido.
4. Espera `PLAYGROUND_RESET_SECONDS` (3600), detiene el servidor y empieza de nuevo. Si el
   servidor se detiene por sí solo, empieza de nuevo al instante.

La configuración (`deploy/playground/verdin.toml`) limita las subidas a 2 MB, limita las
peticiones anónimas a 300 por minuto y dirección, mantiene los envíos de webhooks lejos de las
direcciones privadas y activa la búsqueda.

## Constrúyelo y ejecútalo

Desde la raíz del repositorio:

```sh frame="terminal"
docker build -f deploy/playground/Dockerfile -t verdin-playground .
docker run -p 1337:1337 --tmpfs /var/lib/verdin-playground:uid=65532,gid=65532 verdin-playground
```

La imagen es Alpine con `curl` y `jq` (los scripts necesitan un shell, que la imagen oficial no
tiene) y el binario estático copiado de `ghcr.io/verdin-cms/verdin`. Pasa
`--build-arg VERDIN_IMAGE=ghcr.io/verdin-cms/verdin:<version>` para elegir la release. El
`tmpfs` mantiene los datos en memoria; sin él los datos viven en el sistema de archivos del
contenedor, que también funciona.

| Variable | Por defecto | Qué es |
| --- | --- | --- |
| `PLAYGROUND_RESET_SECONDS` | `3600` | Tiempo entre reinicios. |
| `PLAYGROUND_EMAIL`, `PLAYGROUND_PASSWORD` | `demo@example.com`, `verdin-demo-1234` | La cuenta de demo. |
| `VERDIN_SERVER__PUBLIC_URL` | | La dirección pública del playground. |
| `VERDIN_SERVER__TRUSTED_PROXIES` | | El rango del proxy de la plataforma, para que los límites de peticiones se apliquen por visitante. |

## Alojarlo

Ejecuta exactamente una instancia (la base de datos es local), mantenla en marcha (sin escalar a
cero: el temporizador de reinicio vive en el proceso) y pon HTTPS delante: la cookie de sesión
del panel de administración es `Secure` en el modo `start`, así que iniciar sesión necesita
HTTPS. Cualquiera puede escribir contenido y subir imágenes durante hasta una hora, así que
indica en la página que enlaza a él el calendario de reinicios, y mantén la instancia en un
dominio separado de cualquier otro que comparta cookies.
