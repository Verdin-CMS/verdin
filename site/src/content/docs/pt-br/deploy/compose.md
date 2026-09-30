---
title: Docker Compose em produção
description: Uma receita Compose de produção para um servidor — Verdin, PostgreSQL e Caddy com HTTPS automático, e RustFS opcional para mídia compatível com S3.
sidebar:
  order: 3
---

[`deploy/compose/`](https://github.com/verdin-cms/verdin/tree/main/deploy/compose) é uma
configuração pronta para um servidor: Verdin e PostgreSQL em uma rede privada, e o Caddy na
frente, com um certificado que ele mesmo obtém e renova. Um arquivo de override adiciona o
RustFS, um armazenamento compatível com S3 no mesmo host, para a mídia.
[Docker](/pt-br/deploy/docker/) explica a imagem que estes arquivos usam.

Os arquivos foram verificados com `docker compose config` e `caddy validate` em 2026-09-30.

## Arquivos

| Arquivo | O quê |
| --- | --- |
| `compose.yaml` | `verdin`, `db` (PostgreSQL 17) e `caddy`. Apenas o Caddy publica portas (80, 443 e 443/udp para HTTP/3). |
| `compose.s3.yaml` | Adiciona o `rustfs` e um job único que cria o bucket `media` de leitura pública, e troca o provedor de upload do Verdin para ele. |
| `Caddyfile` | TLS para `$VERDIN_DOMAIN`, compressão, `/media/*` para o RustFS e todo o resto para o Verdin. |
| `.env.example` | As variáveis que o Compose lê: domínio, e-mail do ACME, tag da imagem, senhas. |

## Configure

Pré-requisitos: um servidor com Docker, um registro DNS do seu domínio apontando para ele e as
portas 80 e 443 abertas.

1. Copie o diretório para o servidor e preencha o `.env`:

   ```sh frame="terminal"
   cp .env.example .env                                  # VERDIN_DOMAIN, ACME_EMAIL
   echo "DB_PASSWORD=$(openssl rand -hex 24)" >> .env
   docker run --rm ghcr.io/verdin-cms/verdin:0.11 secrets > verdin.env
   ```

2. Coloque o seu schema commitado em `schema/` (`content-types/` e `components/`). Ele é
   montado como somente leitura em `/app/schema`.
3. Inicie:

   ```sh frame="terminal"
   docker compose up -d
   docker compose logs -f verdin
   ```

4. Abra `https://<your domain>/admin/` e registre o primeiro administrador.

Mantenha o `.env` e o `verdin.env` fora do controle de versão e faça backup deles: um novo
`VERDIN_TOKEN_PEPPER` invalida todos os tokens de API.

## Mídia no S3

Por padrão, os uploads vão para o volume `verdin-data`. Para guardá-los no RustFS:

```sh frame="terminal"
echo "S3_SECRET_KEY=$(openssl rand -hex 24)" >> .env
docker compose -f compose.yaml -f compose.s3.yaml up -d
```

Os arquivos passam então a ser servidos pelo Caddy em `https://<your domain>/media/<key>`. Para
AWS S3, Cloudflare R2 ou outro provedor, deixe de fora os serviços do RustFS e defina as
variáveis `VERDIN_UPLOAD__PROVIDER__*` e as credenciais `AWS_*` com os valores desse provedor
(veja [Armazenamento](/pt-br/internals/storage/)). Trocar um site existente não move nenhum
arquivo: os novos uploads vão para o novo provedor.

## Notas

- **Endereços de clientes.** O Verdin confia no `X-Forwarded-For` vindo da rede do Compose
  (`172.30.0.0/24`, fixa no `compose.yaml`), onde o Caddy é o único proxy. Altere os dois se
  essa faixa colidir com uma das suas redes.
- **Tempo real.** O Caddy transmite as respostas `text/event-stream` sem buffer, então os
  [eventos de tempo real](/pt-br/guides/frontend/realtime/) funcionam atrás dele sem mudanças.
- **Atualizações.** Altere `VERDIN_VERSION` no `.env` e rode `docker compose pull && docker compose up -d`.
  Leia antes [Atualizando o Verdin](/pt-br/migrate/upgrading/).
- **Backups.** Faça o dump do PostgreSQL e guarde o volume `verdin-data` (ou o bucket); veja
  [Backups](/pt-br/deploy/backups/).
- **Comandos de administração.** A imagem não tem shell: `docker compose exec verdin verdin admin create --email you@example.com`.
