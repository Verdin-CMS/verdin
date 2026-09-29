---
title: Backups
description: Faça backup de um projeto Verdin com dumps do banco de dados e cópias do armazenamento de mídia, ou mova-o com verdin export e verdin import verdin.
sidebar:
  order: 9
---

Os dados de um projeto Verdin ficam em dois lugares: o **banco de dados** (conteúdo,
administradores, funções, tokens, configurações, histórico, logs de auditoria) e o
**armazenamento de mídia** (os arquivos da biblioteca de mídia, em disco ou em um bucket). Os
arquivos de schema estão no seu repositório. Faça backup dos dois; o `verdin export` adiciona um
arquivo portátil do conteúdo.

| Método | Contém | Use para |
| --- | --- | --- |
| Dump do banco de dados + cópia da mídia | Tudo | Recuperação de desastres do mesmo projeto |
| `verdin export` | Schema, idiomas, mídia, todas as versões de todas as entradas | Mover o conteúdo para outra instância ou outro motor de banco de dados; uma cópia extra e portátil |

## Dumps do banco de dados

Use as ferramentas do próprio banco de dados ou os backups automáticos do seu provedor:

```sh frame="terminal"
# PostgreSQL
pg_dump --format=custom --file=verdin-$(date +%F).dump "$VERDIN_DATABASE_URL"

# MySQL / MariaDB
mysqldump --single-transaction --routines -h <host> -u <user> -p <database> > verdin-$(date +%F).sql

# SQLite: uma cópia consistente com o servidor rodando
sqlite3 /data/verdin.db ".backup '/backups/verdin-$(date +%F).db'"
```

Não copie um arquivo SQLite em uso com `cp`: use `.backup` (ou pare o servidor antes).

Um dump contém hashes de senhas, hashes de tokens de API e campos privados. Criptografe-o e
guarde-o longe dos servidores que ele protege. Para restaurá-lo, você também precisa dos mesmos
`VERDIN_TOKEN_PEPPER` e `VERDIN_ADMIN_JWT_SECRET`: sem o pepper, os tokens de API e os códigos
de aplicativo autenticador dos administradores param de funcionar.

## Armazenamento de mídia

- **Provedor local**: copie o diretório de uploads (`[upload].provider.dir`, `/data/uploads` na
  imagem Docker) com o seu backup de arquivos habitual, depois do dump do banco de dados, para
  que não falte nenhum arquivo referenciado pelo dump.
- **Provedor S3**: ative o versionamento ou a replicação no bucket, ou copie-o com as
  ferramentas do seu provedor.

O cache de transformação de imagens e o índice de busca podem ser reconstruídos e não precisam
de backup.

## `verdin export`

O `verdin export` grava o schema, o conteúdo e a mídia de um projeto em um único `.tar.gz`, e o
`verdin import verdin` os restaura no mesmo projeto ou em outra instância, em qualquer motor de
banco de dados.

```sh frame="terminal"
verdin export backup-2026-09-28.tar.gz            # schema, idiomas, mídia e entradas
verdin export content-only.tar.gz --no-media      # sem os arquivos de mídia
verdin import verdin backup-2026-09-28.tar.gz     # neste projeto
```

Rode-os com a configuração do projeto (o mesmo `verdin.toml` e o mesmo ambiente do servidor).
Em um contêiner: `docker compose exec verdin verdin export /data/backup.tar.gz`.

### O que está incluído

- **Arquivos de schema**, como estão.
- **Idiomas.** Um projeto vazio recebe todos, inclusive o padrão. Um projeto que já tem idiomas
  recebe apenas os que faltam.
- **Pastas e arquivos de mídia**, com os seus formatos responsivos. Os arquivos mantêm o seu
  `documentId`; os seus ids numéricos mudam.
- **Todas as versões de todas as entradas**: rascunhos, versões publicadas e todos os idiomas,
  com as suas datas, relações (por `documentId`) e mídia, incluindo relações e mídia dentro de
  componentes e zonas dinâmicas. Os campos privados e os hashes de senhas estão incluídos.

**Não incluídos**: usuários administradores, funções, tokens de API, webhooks, configurações de
recursos, fluxos de revisão e lançamentos. Recrie-os no destino ou restaure um dump do banco de
dados.

:::caution
Uma exportação contém campos privados e hashes de senhas. Guarde-a como um dump do banco de
dados.
:::

### Importação

1. A importação grava os arquivos de schema e migra o banco de dados apenas com passos seguros.
2. Arquivos de schema que já existem e são diferentes fazem a importação parar, a menos que você
   passe `--force`.
3. Tipos de conteúdo que já têm entradas também a fazem parar, a menos que você passe
   `--force`; as entradas são então adicionadas ao lado das existentes.
4. Os documentos importados mantêm o seu `documentId`, então importar em um projeto que já tem
   os mesmos documentos falha.

A importação não dispara webhooks nem hooks de plugins, e não grava histórico.

### Formato do arquivo

Um arquivo tar compactado com gzip:

| Caminho | Conteúdo |
| --- | --- |
| `manifest.json` | `format: "verdin-export"`, versão do formato, versão do Verdin, versões por tipo de conteúdo |
| `schema/…` | Os arquivos de schema |
| `locales.json` | `{ default, locales: [{ code, name }] }` |
| `folders.json`, `files.jsonl` | Pastas e arquivos de mídia, um objeto JSON por linha |
| `assets/{hash}{ext}` | Os objetos armazenados dos arquivos e dos seus formatos |
| `entries/{uid}.jsonl` | Uma versão por linha: `documentId`, `locale`, `published`, datas, `data`, `relations`, `media` |

Para trazer um projeto do Strapi, veja [Migração a partir do Strapi](/pt-br/migrate/from-strapi/).

## Teste as suas restaurações

De vez em quando, restaure em um banco de dados descartável, inicie o Verdin nele com
`verdin start` e verifique se você consegue fazer login e ler entradas e mídia.
