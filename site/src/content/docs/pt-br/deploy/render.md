---
title: Render
description: Faça o deploy do Verdin no Render com um Blueprint — um web service Docker construído a partir do seu repositório, um banco de dados PostgreSQL do Render e a mídia em um armazenamento compatível com S3 ou em um disco.
sidebar:
  order: 5
---

Esta página faz o deploy de um projeto Verdin no [Render](https://render.com) com um Blueprint
(`render.yaml`): um web service construído a partir de um pequeno Dockerfile no seu repositório
e um banco de dados PostgreSQL do Render. O sistema de arquivos do Render é efêmero, então a
mídia vai para um armazenamento compatível com S3, ou para um disco persistente se você rodar
uma única instância.

:::note
O formato do Blueprint foi conferido na [referência de Blueprint do Render](https://render.com/docs/blueprint-spec)
em 2026-09-29; ele não foi implantado em uma conta real do Render. Os valores marcados com
`# yours` você deve preencher.
:::

Pré-requisitos: o seu projeto Verdin (com `schema/`) em um repositório Git que o Render consiga
ler.

## 1. Adicione um Dockerfile e uma configuração

```dockerfile title="Dockerfile"
FROM ghcr.io/verdin-cms/verdin:0.10
COPY verdin.toml /app/verdin.toml
COPY schema /app/schema
```

```toml title="verdin.toml"
[server]
host = "0.0.0.0"
port = 1337

[schema]
path = "schema"

[log]
format = "json"

[upload]
# Cloudflare R2 as an example; any S3-compatible service works.
provider = { name = "s3", bucket = "media", region = "auto",             # yours
             endpoint = "https://<account>.r2.cloudflarestorage.com",    # yours
             public_url = "https://media.example.com" }                  # yours
```

Mantenha o `.env` fora do repositório e fora da imagem (`.dockerignore`).

## 2. Escreva o `render.yaml`

```yaml title="render.yaml"
services:
  - type: web
    name: verdin
    runtime: docker
    repo: https://github.com/<you>/<your-project>   # yours
    branch: main
    dockerfilePath: ./Dockerfile
    region: frankfurt                               # yours
    healthCheckPath: /_ready
    envVars:
      - key: VERDIN_DATABASE_URL
        fromDatabase:
          name: verdin-db
          property: connectionString
      - key: VERDIN_ADMIN_JWT_SECRET
        generateValue: true
      - key: VERDIN_TOKEN_PEPPER
        generateValue: true
      - key: VERDIN_SERVER__PUBLIC_URL
        value: https://verdin.onrender.com          # yours: the service URL or your domain
      - key: AWS_ACCESS_KEY_ID
        sync: false                                 # asked for when you create the Blueprint
      - key: AWS_SECRET_ACCESS_KEY
        sync: false

databases:
  - name: verdin-db
    databaseName: verdin
    user: verdin
    region: frankfurt                               # yours: the same region
    postgresMajorVersion: "17"
```

Adicione um `plan` ao serviço e ao banco de dados para escolher um tipo de instância (veja a
página de preços do Render); sem ele, o Render usa o seu padrão.

`generateValue: true` cria cada segredo uma única vez, quando o Blueprint é aplicado pela
primeira vez, e o mantém depois. Não os gere de novo: um novo `VERDIN_TOKEN_PEPPER` faz todos os
tokens de API pararem de funcionar.

## 3. Faça o deploy

1. No dashboard do Render, crie um **Blueprint** a partir do repositório e informe os valores
   das variáveis `sync: false`.
2. Espere o primeiro deploy. O comando padrão da imagem, `start --migrate`, cria as tabelas na
   primeira inicialização e aplica as migrações seguras nos deploys seguintes.
3. Abra `https://<service>.onrender.com/admin/` e cadastre o primeiro administrador.

O Render envia `SIGTERM` antes de parar uma instância; o Verdin termina o que está fazendo e
encerra ao recebê-lo.

## Variante: mídia em um disco

Para uma única instância, você pode armazenar os uploads em um disco persistente do Render em vez
do S3. Defina o provedor local no `verdin.toml`:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

e adicione um disco ao serviço:

```yaml title="render.yaml"
    disk:
      name: verdin-data
      mountPath: /data
      sizeGB: 5
```

Com um disco, o Render não permite escalar o serviço para várias instâncias, e os deploys param
a instância antiga antes de a nova iniciar, então cada deploy tem uma breve indisponibilidade. O
mesmo disco pode guardar um banco de dados SQLite (`sqlite:///data/verdin.db`) se você não
quiser um banco de dados do Render. Verifique se o usuário da imagem (uid `65532`) consegue
gravar no disco; se a inicialização falhar com um erro de permissão em `/data`, adicione
`USER root` ao seu `Dockerfile`.

## Endereços dos clientes

O proxy do Render fica na frente do serviço. A sua faixa de endereços não foi verificada para
este guia, então `[server].trusted_proxies` fica vazio: todos os visitantes passam a contar como
o mesmo endereço para os limites de taxa, então mantenha `[api].public_rate_limit` em `0`, a
menos que você descubra e confie na faixa do proxy.
