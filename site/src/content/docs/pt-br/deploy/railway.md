---
title: Railway
description: Faça o deploy do Verdin no Railway a partir do Dockerfile do seu repositório, com o PostgreSQL do Railway e a mídia em um armazenamento compatível com S3 ou em um volume.
sidebar:
  order: 6
---

Esta página faz o deploy de um projeto Verdin no [Railway](https://railway.com): um serviço
construído a partir de um pequeno Dockerfile no seu repositório, um banco de dados PostgreSQL do
Railway e a mídia em um armazenamento compatível com S3 (ou em um volume, para uma única
instância).

:::note
As configurações do Railway foram conferidas na [documentação do Railway](https://docs.railway.com/reference/config-as-code)
em 2026-09-29; a configuração não foi implantada em uma conta real do Railway. Os valores
marcados com `# yours` ou entre sinais de menor e maior você deve preencher.
:::

## 1. Adicione um Dockerfile, uma configuração e o `railway.json`

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
provider = { name = "s3", bucket = "media", region = "auto",             # yours
             endpoint = "https://<account>.r2.cloudflarestorage.com",    # yours
             public_url = "https://media.example.com" }                  # yours
```

```json title="railway.json"
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "healthcheckPath": "/_ready",
    "healthcheckTimeout": 120,
    "restartPolicyType": "ON_FAILURE"
  }
}
```

Nenhum comando de inicialização é necessário: a imagem roda `start --migrate`, que aplica as
migrações seguras antes de servir. Mantenha o `.env` fora do repositório.

## 2. Crie o projeto

1. No Railway, crie um projeto a partir do seu repositório do GitHub. O Railway encontra o
   `railway.json` e constrói o Dockerfile.
2. Adicione um banco de dados **PostgreSQL** ao projeto.
3. Em **Variables** do serviço Verdin, adicione:

   | Variável | Valor |
   | --- | --- |
   | `VERDIN_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (a URL privada do serviço de banco de dados; use o nome do seu serviço de banco de dados) |
   | `VERDIN_ADMIN_JWT_SECRET` | do `verdin secrets` |
   | `VERDIN_TOKEN_PEPPER` | do `verdin secrets` |
   | `VERDIN_SERVER__PUBLIC_URL` | `https://<your-domain>` |
   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | as suas credenciais do S3 |

   Gere os dois segredos localmente:

   ```sh frame="terminal"
   docker run --rm ghcr.io/verdin-cms/verdin:0.10 secrets
   ```

4. Nas configurações de rede do serviço, clique em **Generate Domain** e defina a porta de
   destino como `1337`. O Verdin escuta em `[server].port` e não lê a variável `PORT` do
   Railway.
5. Faça o deploy, abra `https://<your-domain>/admin/` e cadastre o primeiro administrador.

## Variante: mídia ou SQLite em um volume

Para uma única instância, você pode manter os uploads, e até o banco de dados, em um volume do
Railway montado em `/data`:

```toml title="verdin.toml"
[upload]
provider = { name = "local", dir = "/data/uploads" }
```

com `VERDIN_DATABASE_URL=sqlite:///data/verdin.db` se você dispensar o PostgreSQL. Tenha em
mente:

- Um serviço com volume não pode ter réplicas, e cada novo deploy tem uma breve
  indisponibilidade.
- O Railway monta os volumes como pertencentes ao root, e a imagem roda como uid `65532`. Defina
  a variável de serviço `RAILWAY_RUN_UID=0` para que o servidor possa gravar no volume.

## Endereços dos clientes

O proxy de borda do Railway fica na frente do serviço. A sua faixa de endereços não foi
verificada para este guia, então `[server].trusted_proxies` fica vazio: todos os visitantes
passam a contar como o mesmo endereço para os limites de taxa, então mantenha
`[api].public_rate_limit` em `0`, a menos que você descubra e confie na faixa do proxy.
