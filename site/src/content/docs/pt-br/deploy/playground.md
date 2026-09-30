---
title: Playground hospedado
description: Rode uma demo pública do Verdin — o exemplo blog em SQLite com conteúdo de demonstração e uma conta demo, apagado e populado de novo a cada hora — a partir de deploy/playground.
sidebar:
  order: 11
---

[`deploy/playground/`](https://github.com/verdin-cms/verdin/tree/main/deploy/playground)
constrói um contêiner para uma demo pública: o [exemplo blog](https://github.com/verdin-cms/verdin/tree/main/examples/blog)
em SQLite, com alguns artigos publicados e uma conta demo com a qual os visitantes podem entrar.
A cada hora ele descarta o banco de dados e começa de novo. O contêiner não precisa de volume,
de servidor de banco de dados nem de segredos seus. Onde hospedá-lo fica a seu critério; qualquer
plataforma que rode um contêiner com um endereço HTTPS público serve.

Os scripts foram rodados contra um build local em 2026-09-30 (três ciclos de reset); a imagem foi
construída, mas não rodada a partir de uma release publicada.

## O que os visitantes recebem

- O painel de administração em `/admin/`, com login como **demo@example.com** / **verdin-demo-1234**.
  A conta tem a função **Editor**: pode criar, editar, publicar e excluir conteúdo e enviar mídia,
  mas não pode gerenciar usuários, funções, tokens de API, webhooks nem configurações.
- Acesso público de leitura a artigos, categorias, tags e à página inicial por REST
  (`/api/articles?populate=*`) e GraphQL.
- Dois artigos publicados, um rascunho, duas categorias, duas tags e a página inicial.

Existe também um Super Admin, com uma senha aleatória que ninguém conhece.

## Como funciona

O `run.sh` faz um loop:

1. Apaga `/var/lib/verdin-playground` (banco de dados, uploads, índice de busca, cache de
   imagens) e gera novos segredos, então as sessões do ciclo anterior terminam.
2. Inicia `verdin start --migrate` e espera por `/_ready`.
3. Roda o `seed.sh`: cria as contas pela CLI e pela API de administração, abre o acesso público
   de leitura e cria o conteúdo.
4. Espera `PLAYGROUND_RESET_SECONDS` (3600), para o servidor e recomeça. Se o servidor parar por
   conta própria, recomeça na hora.

A configuração (`deploy/playground/verdin.toml`) limita os uploads a 2 MB, limita as requisições
anônimas a 300 por minuto por endereço, mantém os envios de webhook longe de endereços privados
e ativa a busca.

## Construa e rode

A partir da raiz do repositório:

```sh frame="terminal"
docker build -f deploy/playground/Dockerfile -t verdin-playground .
docker run -p 1337:1337 --tmpfs /var/lib/verdin-playground:uid=65532,gid=65532 verdin-playground
```

A imagem é Alpine com `curl` e `jq` (os scripts precisam de um shell, que a imagem oficial não
tem) e o binário estático copiado de `ghcr.io/verdin-cms/verdin`. Passe
`--build-arg VERDIN_IMAGE=ghcr.io/verdin-cms/verdin:<version>` para escolher a release. O
`tmpfs` mantém os dados em memória; sem ele, os dados ficam no sistema de arquivos do contêiner,
o que também funciona.

| Variável | Padrão | O quê |
| --- | --- | --- |
| `PLAYGROUND_RESET_SECONDS` | `3600` | O tempo entre os resets. |
| `PLAYGROUND_EMAIL`, `PLAYGROUND_PASSWORD` | `demo@example.com`, `verdin-demo-1234` | A conta demo. |
| `VERDIN_SERVER__PUBLIC_URL` | | O endereço público do playground. |
| `VERDIN_SERVER__TRUSTED_PROXIES` | | A faixa do proxy da plataforma, para que os limites de taxa valham por visitante. |

## Hospedagem

Rode exatamente uma instância (o banco de dados é local), mantenha-a rodando (sem scale to zero:
o temporizador de reset vive no processo) e coloque HTTPS na frente: o cookie de sessão do painel
de administração é `Secure` no modo `start`, então o login exige HTTPS. Qualquer pessoa pode
escrever conteúdo e enviar imagens por até uma hora, então aponte a página que leva até ele para
o cronograma de resets e mantenha a instância em um domínio separado de qualquer coisa que
compartilhe cookies.
