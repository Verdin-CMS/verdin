---
title: Releases e hospedagem da documentação
description: O que o workflow de release publica (binários, checksums, pacotes .deb, a imagem, Homebrew, winget), os segredos de que cada job opcional precisa, e como o site da documentação, o seu domínio e as prévias de pull requests são hospedados.
sidebar:
  order: 9
---

Esta página é para quem mantém o projeto: o que acontece quando uma tag de versão é enviada, quais
partes precisam de um segredo ou de uma conta, e como o site da documentação é publicado.

## O workflow de release

Enviar uma tag `vX.Y.Z` roda `.github/workflows/release.yml`:

| Job | Publica | Precisa de |
| --- | --- | --- |
| `admin`, `binaries` | `verdin-vX.Y.Z-<target>.tar.gz` (`.zip` no Windows) para `x86_64`/`aarch64-unknown-linux-musl`, `x86_64`/`aarch64-apple-darwin` e `x86_64-pc-windows-msvc`. Cada arquivo tem uma pasta com o `verdin` e as licenças. | Nada |
| `deb` | `verdin_X.Y.Z-1_amd64.deb` e `_arm64.deb`, construídos com `cargo deb --no-build` a partir dos binários musl. | Nada |
| `publish` | A release do GitHub: arquivos, pacotes e `SHA256SUMS`, com as notas da seção da versão no `CHANGELOG.md`. | Nada |
| `image` | `ghcr.io/verdin-cms/verdin` para amd64 e arm64. | Nada |
| `npm` | `@verdin/client`. | `NPM_TOKEN` (é ignorado sem ele) |
| `homebrew` | `Formula/verdin.rb` no tap, a partir de `deploy/homebrew/verdin.rb.in`. | `HOMEBREW_TAP_TOKEN` (é ignorado sem ele) |
| `winget` | Um pull request para `microsoft/winget-pkgs` com os manifestos de `deploy/winget/`. | `WINGET_TOKEN` (é ignorado sem ele) |

Os nomes dos assets são um contrato: o `install.sh`, os metadados do `cargo binstall` em
`crates/verdin/Cargo.toml`, a fórmula do Homebrew e os manifestos do winget os montam a partir da
versão e do alvo. O `deploy/render-template.sh` preenche os templates do Homebrew e do winget com a
versão e os checksums do `SHA256SUMS`, e falha se algum estiver faltando.

## Configuração única dos jobs opcionais

| O quê | Onde |
| --- | --- |
| **Tap do Homebrew.** Crie o repositório público `verdin-cms/homebrew-tap` (o nome faz o `brew install verdin-cms/tap/verdin` funcionar). Adicione a ele um token de granularidade fina com *Contents: read and write* como o segredo `HOMEBREW_TAP_TOKEN`. Outro repositório: defina a variável `HOMEBREW_TAP_REPOSITORY`. | Segredos e variáveis do repositório |
| **winget.** O primeiro envio de `VerdinCMS.Verdin` é revisado pelos mantenedores do winget. Faça um fork de `microsoft/winget-pkgs` com a conta que envia, e adicione um token clássico dessa conta com o escopo `public_repo` como `WINGET_TOKEN`. | Segredos do repositório |
| **npm.** `NPM_TOKEN`, um token de automação do escopo `@verdin`. | Segredos do repositório |
| **crates.io** (opcional). `cargo binstall verdin` sem `--git` precisa do crate no crates.io; até lá a documentação usa `--git`. | — |
| **Botão do Railway** (opcional). Crie um template no railway.com a partir do repositório (caminho de configuração `deploy/one-click/railway.json`, um serviço PostgreSQL, um volume em `/data`) e adicione o seu botão ao README e a [Deploys de um clique](/pt-br/deploy/one-click/). | railway.com |

Os botões do Render e do DigitalOcean não precisam de conta do lado do projeto: eles leem
`render.yaml` e `.do/deploy.template.yaml` da branch padrão.

Algumas versões são escritas em arquivos e mudam a cada release menor: a tag da imagem em
`deploy/one-click/Dockerfile`, `deploy/playground/Dockerfile`, `deploy/compose/` e na
documentação, e `version`/`appVersion` em `deploy/helm/verdin/Chart.yaml`.

## O site da documentação

O `.github/workflows/site.yml` constrói `site/` a cada push para `main` que o modifique e envia o
resultado para a raiz da branch `gh-pages`. O GitHub Pages serve essa branch
(Settings → Pages → Source: *Deploy from a branch*, `gh-pages`, `/`).

### O domínio

Onde o site fica é uma única variável do repositório, **`SITE_URL`**:

| `SITE_URL` | Site |
| --- | --- |
| não definida | `https://verdin-cms.github.io/verdin/` |
| `https://docs.example.com` | A raiz desse domínio |
| `https://example.com/verdin` | Sob `/verdin` nesse domínio |

O `site/scripts/repo.mjs` obtém dela o `site` e o `base` do Astro, então todos os links, assets e
o sitemap acompanham. `BASE_PATH` ainda substitui o caminho, se definido. Para um domínio
personalizado:

1. Aponte o DNS do domínio para o GitHub Pages (um registro `CNAME` para `verdin-cms.github.io`
   em um subdomínio).
2. Defina `SITE_URL` em Settings → Secrets and variables → Actions → Variables.
3. Rode o workflow Site (ou faça push para `main`). Ele grava o arquivo `CNAME` na branch, e o
   GitHub passa a usar o domínio; ative *Enforce HTTPS* quando o certificado for emitido.

Os links fora do site (o README, os metadados dos pacotes, o `home` do chart Helm) mantêm o
endereço `verdin-cms.github.io/verdin`, que o GitHub redireciona para o domínio personalizado.

### Prévias de pull requests

Cada pull request que modifica o site recebe uma prévia em
`<SITE_URL>/pr-preview/pr-<number>/`, com link em um comentário:

1. `site-preview.yml` roda em `pull_request`. Ele constrói o site com `SITE_URL` apontando para o
   endereço da prévia e o envia como artefato. Ele roda o código do pull request, então, como todo
   workflow `pull_request` vindo de um fork, tem um token somente leitura e nenhum segredo.
2. `site-preview-deploy.yml` roda em `workflow_run` quando esse build tem sucesso, no contexto
   deste repositório. Ele baixa o artefato, confere que o pull request está aberto e que o build
   foi do seu head atual, copia os arquivos para `pr-preview/pr-<number>/` em `gh-pages` e
   atualiza o comentário. Nunca faz checkout nem roda código do pull request.
3. Quando o pull request é fechado, o mesmo workflow (`pull_request_target`, que apenas clona
   `gh-pages`) apaga a pasta.

O deploy principal mantém o `pr-preview/`, e os três compartilham um único grupo de concorrência,
então apenas um job escreve em `gh-pages` por vez.

As prévias são servidas da mesma origem que a documentação. Isso é aceitável para um site
estático sem login, mas o pull request de um fork pode publicar qualquer HTML ali até ser
fechado; feche os pull requests que abusarem disso. Se as variáveis do repositório não estiverem
disponíveis para o workflow de um fork, a sua prévia é construída para o `SITE_URL` padrão e os
seus links quebram em um domínio personalizado; as prévias de pull requests de branches deste
repositório não são afetadas.

### O playground hospedado

A demo pública roda o contêiner de `deploy/playground/`; veja
[Playground hospedado](/pt-br/deploy/playground/). Hospedá-lo fica fora do repositório: qualquer
plataforma que mantenha um contêiner rodando atrás de HTTPS serve.
