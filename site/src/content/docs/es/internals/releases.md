---
title: Releases y alojamiento de la documentación
description: Lo que publica el flujo de release (binarios, sumas de comprobación, paquetes .deb, la imagen, Homebrew, winget), los secretos que necesita cada trabajo opcional, y cómo se alojan el sitio de documentación, su dominio y las vistas previas de los pull requests.
sidebar:
  order: 9
---

Esta página es para los mantenedores: qué ocurre cuando se sube una etiqueta de versión, qué
partes necesitan un secreto o una cuenta, y cómo se publica el sitio de documentación.

## El flujo de release

Subir una etiqueta `vX.Y.Z` ejecuta `.github/workflows/release.yml`:

| Trabajo | Publica | Necesita |
| --- | --- | --- |
| `admin`, `binaries` | `verdin-vX.Y.Z-<target>.tar.gz` (`.zip` en Windows) para `x86_64`/`aarch64-unknown-linux-musl`, `x86_64`/`aarch64-apple-darwin` y `x86_64-pc-windows-msvc`. Cada archivo tiene una carpeta con `verdin` y las licencias. | Nada |
| `deb` | `verdin_X.Y.Z-1_amd64.deb` y `_arm64.deb`, construidos con `cargo deb --no-build` a partir de los binarios musl. | Nada |
| `publish` | La release de GitHub: archivos, paquetes y `SHA256SUMS`, con las notas de la sección de la versión en `CHANGELOG.md`. | Nada |
| `image` | `ghcr.io/verdin-cms/verdin` para amd64 y arm64. | Nada |
| `npm` | `@verdin/client`. | `NPM_TOKEN` (se omite sin él) |
| `homebrew` | `Formula/verdin.rb` en el tap, a partir de `deploy/homebrew/verdin.rb.in`. | `HOMEBREW_TAP_TOKEN` (se omite sin él) |
| `winget` | Un pull request a `microsoft/winget-pkgs` con los manifiestos de `deploy/winget/`. | `WINGET_TOKEN` (se omite sin él) |

Los nombres de los archivos son un contrato: `install.sh`, los metadatos de `cargo binstall` en
`crates/verdin/Cargo.toml`, la fórmula de Homebrew y los manifiestos de winget los construyen
todos a partir de la versión y el destino. `deploy/render-template.sh` rellena las plantillas de
Homebrew y winget con la versión y las sumas de comprobación de `SHA256SUMS`, y falla si falta
alguna.

## Configuración puntual de los trabajos opcionales

| Qué | Dónde |
| --- | --- |
| **Tap de Homebrew.** Crea el repositorio público `verdin-cms/homebrew-tap` (el nombre hace que funcione `brew install verdin-cms/tap/verdin`). Añade como secreto `HOMEBREW_TAP_TOKEN` un token de acceso de grano fino con *Contents: read and write* sobre él. Otro repositorio: define la variable `HOMEBREW_TAP_REPOSITORY`. | Secretos y variables del repositorio |
| **winget.** La primera propuesta de `VerdinCMS.Verdin` la revisan los mantenedores de winget. Haz un fork de `microsoft/winget-pkgs` con la cuenta que la envía, y añade como `WINGET_TOKEN` un token clásico de esa cuenta con el permiso `public_repo`. | Secretos del repositorio |
| **npm.** `NPM_TOKEN`, un token de automatización del ámbito `@verdin`. | Secretos del repositorio |
| **crates.io** (opcional). `cargo binstall verdin` sin `--git` necesita el crate en crates.io; hasta entonces la documentación usa `--git`. | — |
| **Botón de Railway** (opcional). Crea una plantilla en railway.com a partir del repositorio (ruta de configuración `deploy/one-click/railway.json`, un servicio de PostgreSQL, un volumen en `/data`) y añade su botón al README y a [Despliegues con un clic](/es/deploy/one-click/). | railway.com |

Los botones de Render y DigitalOcean no necesitan ninguna cuenta por parte del proyecto: leen
`render.yaml` y `.do/deploy.template.yaml` de la rama por defecto.

Algunas versiones están escritas en archivos y cambian con cada release menor: la etiqueta de la
imagen en `deploy/one-click/Dockerfile`, `deploy/playground/Dockerfile`, `deploy/compose/` y la
documentación, y `version`/`appVersion` en `deploy/helm/verdin/Chart.yaml`.

## El sitio de documentación

`.github/workflows/site.yml` construye `site/` en cada push a `main` que lo toque y sube el
resultado a la raíz de la rama `gh-pages`. GitHub Pages sirve esa rama (Settings → Pages →
Source: *Deploy from a branch*, `gh-pages`, `/`).

### El dominio

Dónde vive el sitio es una variable del repositorio, **`SITE_URL`**:

| `SITE_URL` | Sitio |
| --- | --- |
| sin definir | `https://verdin-cms.github.io/verdin/` |
| `https://docs.example.com` | La raíz de ese dominio |
| `https://example.com/verdin` | Bajo `/verdin` en ese dominio |

`site/scripts/repo.mjs` toma de ella el `site` y el `base` de Astro, así que siguen todos los
enlaces, los recursos y el sitemap. `BASE_PATH` sigue sobrescribiendo la ruta si está definida.
Para un dominio propio:

1. Apunta el DNS del dominio a GitHub Pages (un registro `CNAME` a `verdin-cms.github.io` para
   un subdominio).
2. Define `SITE_URL` en Settings → Secrets and variables → Actions → Variables.
3. Ejecuta el flujo Site (o haz push a `main`). Escribe el archivo `CNAME` en la rama, y GitHub
   recoge el dominio; activa *Enforce HTTPS* cuando se haya emitido el certificado.

Los enlaces fuera del sitio (el README, los metadatos de los paquetes, el `home` del chart de
Helm) mantienen la dirección `verdin-cms.github.io/verdin`, que GitHub redirige al dominio
propio.

### Vistas previas de los pull requests

Cada pull request que toca el sitio recibe una vista previa en
`<SITE_URL>/pr-preview/pr-<number>/`, enlazada en un comentario:

1. `site-preview.yml` se ejecuta con `pull_request`. Construye el sitio con `SITE_URL` definida
   con la dirección de la vista previa y lo sube como artefacto. Ejecuta el código del pull
   request, así que, como todo flujo `pull_request` de un fork, tiene un token de solo lectura y
   ningún secreto.
2. `site-preview-deploy.yml` se ejecuta con `workflow_run` cuando esa compilación tiene éxito, en
   el contexto de este repositorio. Descarga el artefacto, comprueba que el pull request está
   abierto y que la compilación era de su head actual, copia los archivos a
   `pr-preview/pr-<number>/` en `gh-pages` y actualiza el comentario. Nunca descarga ni ejecuta
   código del pull request.
3. Cuando se cierra el pull request, el mismo flujo (`pull_request_target`, que solo clona
   `gh-pages`) borra la carpeta.

El despliegue principal conserva `pr-preview/`, y los tres comparten un grupo de concurrencia,
así que solo un trabajo escribe en `gh-pages` a la vez.

Las vistas previas se sirven desde el mismo origen que la documentación. Es aceptable para un
sitio estático sin inicio de sesión, pero el pull request de un fork puede publicar ahí
cualquier HTML hasta que se cierre; cierra los pull requests que abusen de ello. Si las
variables del repositorio no están disponibles para el flujo de un fork, su vista previa se
construye con la `SITE_URL` por defecto y sus enlaces se rompen con un dominio propio; las
vistas previas de pull requests de ramas de este repositorio no se ven afectadas.

### El playground alojado

La demo pública ejecuta el contenedor de `deploy/playground/`; consulta
[Playground alojado](/es/deploy/playground/). Alojarlo queda fuera del repositorio: sirve
cualquier plataforma que mantenga un contenedor en marcha detrás de HTTPS.
