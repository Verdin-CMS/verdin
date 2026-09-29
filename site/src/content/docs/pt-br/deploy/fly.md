---
title: Fly.io
description: Faça o deploy do Verdin no Fly.io com a sua própria imagem, PostgreSQL e o armazenamento de objetos Tigris, ou em uma única Machine com SQLite em um volume.
sidebar:
  order: 4
---

Esta página faz o deploy de um projeto Verdin no [Fly.io](https://fly.io) como uma pequena
imagem construída sobre a oficial. A configuração recomendada não mantém estado na Machine:
PostgreSQL para o banco de dados e Tigris (o armazenamento compatível com S3 do Fly) para a
mídia. Em seguida vem uma variante com SQLite em um volume.

:::note
Os formatos do Fly foram conferidos na [documentação do Fly](https://docs.fly.io/reference/configuration/)
em 2026-09-29; a configuração não foi executada em uma conta real do Fly. Os valores entre
sinais de menor e maior e os marcados com `# yours` você deve preencher.
:::

Pré-requisitos: o [`flyctl`](https://docs.fly.io/flyctl/install/) com login feito e um projeto
Verdin com o seu diretório `schema/` commitado.

## 1. Adicione um Dockerfile e uma configuração

No diretório do projeto, adicione um `Dockerfile` que copie a sua configuração e o seu schema
para a imagem oficial (veja [A sua própria imagem](/pt-br/deploy/docker/)):

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

e um `verdin.toml` para o Fly:

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337
public_url = "https://my-verdin.fly.dev"       # yours: the app's URL or your domain

[schema]
path = "schema"

[log]
format = "json"

[upload]
provider = { name = "s3", bucket = "my-verdin-media",   # yours: the bucket name
             region = "auto", endpoint = "https://t3.storage.dev",
             public_url = "https://my-verdin-media.t3.tigrisfiles.io" }
```

Garanta que o `.env` fique fora do contexto de build: adicione-o ao `.dockerignore`.

## 2. Escreva o `fly.toml`

```toml title="fly.toml"
app = "my-verdin"                # yours
primary_region = "fra"           # yours

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 1337
  force_https = true
  # Keep a Machine running: webhooks, scheduled releases, plugin jobs and the
  # daily digest run inside the server process.
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "30s"
    interval = "15s"
    method = "GET"
    timeout = "5s"
    path = "/_ready"

[[vm]]
  memory = "512mb"               # adjust to your content and traffic
```

O comando padrão da imagem, `start --migrate`, aplica as migrações seguras quando cada Machine
inicia, então nenhum `release_command` é necessário. (O Fly roda o `release_command` em uma
Machine temporária sem volumes, o que de qualquer forma não funcionaria com SQLite.)

## 3. Crie o app, o banco de dados e o bucket

1. Crie o app sem fazer o deploy. `--ha=false` começa com uma Machine; leia
   [Como rodar várias instâncias](/pt-br/deploy/scaling/) antes de adicionar mais.

   ```sh frame="terminal"
   fly launch --no-deploy --copy-config --ha=false
   ```

2. Crie um banco de dados PostgreSQL, por exemplo com o
   [Fly Managed Postgres](https://docs.fly.io/mpg/) ou qualquer provedor de PostgreSQL, e anote
   a sua URL de conexão.

3. Crie um bucket Tigris público. O comando define `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3` e `BUCKET_NAME` como secrets do app; o Verdin
   lê os dois primeiros. Coloque o nome do bucket no `verdin.toml`.

   ```sh frame="terminal"
   fly storage create --public
   ```

4. Defina os segredos do Verdin e a URL do banco de dados:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets | fly secrets import
   fly secrets set VERDIN_DATABASE_URL='postgres://<user>:<password>@<host>:5432/<db>?sslmode=require'
   ```

5. Faça o deploy, depois abra `https://<app>.fly.dev/admin/` e cadastre o primeiro
   administrador:

   ```sh frame="terminal"
   fly deploy
   ```

## Endereços dos clientes e limites de taxa

O proxy do Fly adiciona o cliente ao `X-Forwarded-For` e, segundo a
[documentação de cabeçalhos de requisição do Fly](https://docs.fly.io/networking/request-headers/),
o endereço mais à direita é o próprio IP do seu app. Para o Verdin encontrar o cliente, confie
na faixa do proxy e nos endereços do seu app (`fly ips list`):

```toml title="verdin.toml"
[server]
trusted_proxies = ["172.16.0.0/12", "<app IPv4>", "<app IPv6>"]
```

Isso não foi verificado em um app em execução. Até você conferir, deixe
`[api].public_rate_limit` em `0`: sem os proxies certos, todos os visitantes contam como o
mesmo endereço.

## Variante: uma Machine com SQLite

Para um projeto pequeno, você pode manter o banco de dados e os uploads em um volume do Fly.

- No `verdin.toml`, defina `provider = { name = "local", dir = "/data/uploads" }` em
  `[upload]` (o diretório padrão é relativo a `/app`, onde o servidor não pode gravar) e defina
  `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` como secret.
- Monte um volume em `/data`:

  ```toml title="fly.toml"
  [mounts]
    source = "verdin_data"
    destination = "/data"
    initial_size = "1gb"
  ```

- Rode exatamente uma Machine (`fly scale count 1`). Um volume se conecta a uma única Machine, e
  o SQLite não pode ser compartilhado.
- O Fly cria volumes pertencentes ao root, e a imagem roda como uid `65532`. Se a inicialização
  falhar com um erro de permissão em `/data`, adicione `USER root` ao seu `Dockerfile`.

Faça backup do volume: o Fly mantém snapshots diários dos volumes, e o `verdin export` dá a você
um arquivo portátil (veja [Backups](/pt-br/deploy/backups/)).
