---
title: Referência da linha de comando
description: Todos os comandos, subcomandos e flags do binário verdin, com o que eles leem, gravam e imprimem.
sidebar:
  order: 2
  label: Linha de comando
---

<!-- Written from crates/verdin/src/cli.rs and crates/verdin/src/new.rs. `npm run check-cli`
(site/scripts/check-cli.mjs) fails when a subcommand or flag in cli.rs is missing here. -->

O `verdin` é o único binário: ele cria projetos, roda o servidor, aplica migrações, gerencia os
usuários administradores e move o conteúdo para dentro e para fora. Esta página lista todos os
comandos e flags.

```text title="Terminal"
verdin [OPTIONS] <COMMAND>
```

| Comando | O que faz |
| --- | --- |
| [`verdin new`](#verdin-new) | Cria um diretório de projeto. |
| [`verdin dev`](#verdin-dev) | Roda o servidor no modo de desenvolvimento. |
| [`verdin start`](#verdin-start) | Roda o servidor no modo de produção. |
| [`verdin schema check`](#verdin-schema-check) | Valida os arquivos de schema. |
| [`verdin migrate plan`](#verdin-migrate-plan) | Mostra os passos da migração e o seu SQL. |
| [`verdin migrate apply`](#verdin-migrate-apply) | Aplica os passos da migração. |
| [`verdin admin create`](#verdin-admin-create) | Cria um Super Admin. |
| [`verdin admin reset-password`](#verdin-admin-reset-password) | Define a senha de um administrador. |
| [`verdin types`](#verdin-types) | Gera definições TypeScript da API de conteúdo. |
| [`verdin import strapi`](#verdin-import-strapi) | Importa uma exportação do Strapi. |
| [`verdin import verdin`](#verdin-import-verdin) | Importa uma exportação do Verdin. |
| [`verdin export`](#verdin-export) | Grava o projeto em um arquivo `.tar.gz`. |
| [`verdin healthcheck`](#verdin-healthcheck) | Verifica se o servidor local responde. |
| [`verdin secrets`](#verdin-secrets) | Imprime novos segredos. |
| [`verdin version`](#verdin-version) | Imprime a versão. |

## Opções globais

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `-c, --config <CONFIG>` | `verdin.toml` | O arquivo de configuração do projeto. Também é lido de `VERDIN_CONFIG`. A raiz do projeto é o diretório do arquivo: o schema, os plugins, os uploads e os caminhos relativos do SQLite são resolvidos a partir dele. |
| `-h, --help` | | Imprime a ajuda do comando. |
| `-V, --version` | | Imprime a versão. |

`verdin help <COMMAND>` imprime a mesma ajuda que `--help`.

Todo comando, exceto `new`, `secrets` e `version`, carrega o projeto primeiro:

1. Ele lê o arquivo `.env` ao lado do arquivo de configuração, se houver um. As variáveis já
   definidas no ambiente prevalecem.
2. Ele carrega o `verdin.toml` (opcional) e as substituições `VERDIN_*`. Veja a
   [referência de configuração](/pt-br/reference/configuration/).
3. Ele começa a registrar os logs na saída de erro padrão, com `[log]` e `RUST_LOG`.

Os comandos que abrem o banco de dados precisam de `VERDIN_DATABASE_URL` ou de
`[database].url`. Os comandos que mexem nas contas de administração ou que rodam o servidor
também precisam de `VERDIN_ADMIN_JWT_SECRET` e de `VERDIN_TOKEN_PEPPER`.

## `verdin new`

```text title="Terminal"
verdin new <DIR> [--database <DATABASE>]
```

Cria um projeto em `DIR`, que não pode existir ou precisa estar vazio:

| Arquivo | Conteúdo |
| --- | --- |
| `verdin.toml` | `[server]`, `[api]` e `[admin]` com os seus padrões. |
| `.env` | `VERDIN_DATABASE_URL`, e `VERDIN_ADMIN_JWT_SECRET` e `VERDIN_TOKEN_PEPPER` novos. Legível apenas por você (modo `0600` no Unix). |
| `.gitignore` | `.env`, `data/`, os arquivos do SQLite e `.cache/`. |
| `schema/content-types/`, `schema/components/` | Diretórios de schema vazios. |
| `data/` | Para o banco de dados SQLite (apenas SQLite). |

| Argumento ou opção | Padrão | Descrição |
| --- | --- | --- |
| `<DIR>` | | O diretório a criar. |
| `--database <DATABASE>` | `sqlite` | O banco de dados para o qual o `.env` aponta: `sqlite`, `postgres`, `mysql` ou `mariadb`. |

Com `sqlite`, a URL é `sqlite://data/verdin.db`. Com os outros, é a URL de um servidor local com
o usuário `verdin`, a senha `change-me` e um banco de dados com o nome do diretório (letras
minúsculas, dígitos e `_`): edite-a antes de iniciar.

```text title="Terminal"
$ verdin new blog --database postgres
created blog

  cd blog
  verdin dev

then open http://localhost:1337/admin/ to register the first admin
```

## `verdin dev`

```text title="Terminal"
verdin dev
```

Roda o servidor no modo de desenvolvimento. Em comparação com o `verdin start`:

- As migrações pendentes com o nível de risco `safe` são aplicadas na inicialização. Os passos
  mais arriscados param o servidor; revise-os com [`verdin migrate plan`](#verdin-migrate-plan).
- O **Construtor de tipos de conteúdo** do painel de administração edita os arquivos de schema, e
  o servidor recarrega o schema.
- O cookie de renovação não é marcado como `Secure` (a menos que `[admin].secure_cookies` diga o
  contrário), então você pode fazer login via HTTP simples.
- Os webhooks e os destinos de deploy podem chamar endereços de loopback e privados (a menos que
  `[webhooks].allow_private_networks` diga o contrário).

Ele para com Ctrl+C ou `SIGTERM`.

## `verdin start`

```text title="Terminal"
verdin start [--migrate]
```

Roda o servidor no modo de produção. Ele se recusa a iniciar quando o banco de dados está atrás
do schema, para que um deploy nunca altere tabelas que você não revisou.

| Opção | Descrição |
| --- | --- |
| `--migrate` | Aplica os passos de migração `safe` pendentes antes de iniciar. Os passos arriscados e destrutivos continuam precisando de `verdin migrate apply`. |

Antes de escutar, ele verifica a configuração (`[api].prefix` e `[admin].path` têm a forma de
`/api`, os tamanhos de página são consistentes, `[server].trusted_proxies` e `[api].cors_origins`
são interpretáveis) e cria as funções integradas. Ele registra um aviso quando
`[admin].secure_cookies` é `false` ou `[email].provider` é `log`. Quando ainda não há
administrador, ele registra o endereço do painel de administração, onde o primeiro visitante
cadastra o primeiro Super Admin.

Ele para com Ctrl+C ou `SIGTERM`.

## `verdin schema check`

```text title="Terminal"
verdin schema check
```

Valida os arquivos de schema (`[schema].path`) sem tocar no banco de dados. Ele imprime um resumo,
ou falha com os erros, cada um com o seu arquivo e o caminho do atributo:

```text title="Terminal"
$ verdin schema check
schema ok: 4 content types, 3 components
```

Use-o na CI antes de um deploy. Veja [Tipos de atributos](/pt-br/reference/attribute-types/) para
o que cada atributo aceita.

## `verdin migrate plan`

```text title="Terminal"
verdin migrate plan [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Compara o banco de dados com o schema e imprime o que o `verdin migrate apply` faria, sem mudar
nada: passos numerados, cada um com o seu nível de risco e o seu SQL. Ele imprime
`database is up to date` quando não há nada a fazer.

| Opção | Descrição |
| --- | --- |
| `--rename-table <OLD=NEW>` | Trata a tabela `OLD` como renomeada para `NEW` (mantém as suas linhas), em vez de remover uma e criar a outra. Pode ser repetida. |
| `--rename-column <TABLE.OLD=NEW>` | Trata a coluna `OLD` de `TABLE` como renomeada para `NEW` (mantém os seus valores). `TABLE` é o novo nome da tabela. Pode ser repetida. |

Níveis de risco:

| Nível | Significado |
| --- | --- |
| `safe` | Não pode perder dados nem falhar nas linhas existentes: novas tabelas, novas colunas que aceitam nulo ou têm valor padrão, renomeações, índices que não são únicos. |
| `risky` | Pode falhar nas linhas existentes ou converter valores: mudanças de tipo de coluna, novas colunas que não aceitam nulo e não têm valor padrão, índices únicos em tabelas existentes. |
| `destructive` | Remove colunas ou tabelas. |

Quando um passo está acima de `safe`, o plano termina com a flag de que ele precisa
(`requires: verdin migrate apply --allow risky`). Quando uma coluna ou uma tabela removida
parece ter sido renomeada, ele lista as flags de renomeação a passar. Quando uma migração
anterior foi interrompida, ele mostra quantos passos foram aplicados e o último erro.

```text title="Terminal"
verdin migrate plan --rename-column articles.summary=excerpt
```

Veja [Migrações de schema](/pt-br/concepts/schema-migrations/).

## `verdin migrate apply`

```text title="Terminal"
verdin migrate apply [--allow <ALLOW>] [--rename-table <OLD=NEW>]... [--rename-column <TABLE.OLD=NEW>]...
```

Aplica o plano. Ele aceita as mesmas opções de renomeação do `verdin migrate plan`; passe as
mesmas que você revisou.

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `--allow <ALLOW>` | `safe` | O nível de risco mais alto a aplicar: `safe`, `risky` ou `destructive`. Um plano com um passo acima dele é recusado antes de qualquer coisa rodar. |
| `--rename-table <OLD=NEW>` | | Como no `verdin migrate plan`. |
| `--rename-column <TABLE.OLD=NEW>` | | Como no `verdin migrate plan`. |

Ele imprime `applied N steps`, ou `database is up to date`. Depois de uma interrupção (uma
conexão perdida, um passo que falhou), corrija a causa e rode-o de novo: ele retoma a partir do
passo que não foi concluído.

## `verdin admin create`

```text title="Terminal"
verdin admin create --email <EMAIL>
```

Cria um Super Admin. A senha é lida de `VERDIN_ADMIN_PASSWORD`, ou da entrada padrão quando essa
variável não está definida. O banco de dados precisa estar atualizado com o schema.

| Opção | Descrição |
| --- | --- |
| `--email <EMAIL>` | O endereço de e-mail do novo administrador. |

```text title="Terminal"
$ VERDIN_ADMIN_PASSWORD='a long passphrase' verdin admin create --email ada@example.com
created Super Admin ada@example.com (id 1)
```

Use-o para criar o primeiro administrador de um servidor que ainda não está acessível em um
navegador; caso contrário, o primeiro visitante do painel de administração o cadastra.

## `verdin admin reset-password`

```text title="Terminal"
verdin admin reset-password --email <EMAIL>
```

Define a senha de um administrador, desbloqueia a conta após logins com falha e encerra todas as
suas sessões. A senha é lida como no `verdin admin create`.

| Opção | Descrição |
| --- | --- |
| `--email <EMAIL>` | O endereço de e-mail do administrador. |

Ele não remove os segundos fatores; um administrador com **Gerenciar usuários** pode
redefini-los em **Configurações → Usuários**.

## `verdin types`

```text title="Terminal"
verdin types [-o <OUT>]
```

Gera definições TypeScript da API de conteúdo (uma interface por tipo de conteúdo e por
componente) a partir do schema e as imprime na saída padrão. Ele não precisa do banco de dados.

| Opção | Descrição |
| --- | --- |
| `-o, --out <OUT>` | Grava neste arquivo. |

```text title="Terminal"
verdin types --out ../web/src/verdin.d.ts
```

Veja [Cliente tipado](/pt-br/guides/frontend/typed-client/).

## `verdin import strapi`

```text title="Terminal"
verdin import strapi <PATH> [--schema-only] [--force]
```

Importa um projeto Strapi v4 ou v5 a partir de uma exportação feita com
`strapi export --no-encrypt`: um `.tar.gz`, um `.tar` ou um diretório descompactado. Ele grava os
tipos de conteúdo e os componentes como arquivos de schema e depois importa as entradas, os
idiomas, a mídia, as relações e as pastas.

| Argumento ou opção | Descrição |
| --- | --- |
| `<PATH>` | O arquivo ou o diretório da exportação. |
| `--schema-only` | Grava apenas os arquivos de schema. |
| `--force` | Sobrescreve os arquivos de schema existentes e importa em tipos de conteúdo que já têm entradas. |

Ele imprime o que gravou e importou, com avisos para o que não conseguiu trazer, e grava o
`strapi-id-map.json` na raiz do projeto: os ids do Strapi e os seus novos `documentId`s e ids de
arquivo no Verdin, para corrigir os links no seu frontend.

Veja [Migração a partir do Strapi](/pt-br/migrate/from-strapi/).

## `verdin import verdin`

```text title="Terminal"
verdin import verdin <PATH> [--force]
```

Importa um arquivo gravado pelo `verdin export`: arquivos de schema, idiomas, mídia e entradas.

| Argumento ou opção | Descrição |
| --- | --- |
| `<PATH>` | O arquivo `.tar.gz`. |
| `--force` | Sobrescreve os arquivos de schema diferentes e importa em tipos de conteúdo que já têm entradas. |

## `verdin export`

```text title="Terminal"
verdin export <OUTPUT> [--no-media]
```

Grava o schema, o conteúdo e a mídia do projeto em um arquivo `.tar.gz`: um backup, ou uma forma
de mover um projeto para outra instância com `verdin import verdin`. O arquivo contém todas as
versões de todas as entradas (rascunhos, versões publicadas, idiomas) com as suas relações. As
contas de administração, os tokens de API e as configurações não estão incluídos.

| Argumento ou opção | Descrição |
| --- | --- |
| `<OUTPUT>` | O arquivo a gravar. |
| `--no-media` | Deixa de fora a biblioteca de mídia: os arquivos, as pastas e os vínculos das entradas com eles. |

```text title="Terminal"
$ verdin export backup.tar.gz
exported to backup.tar.gz: 42 documents (57 versions), 18 files, 3 folders, 2 locales
```

Veja [Backups](/pt-br/deploy/backups/).

## `verdin healthcheck`

```text title="Terminal"
verdin healthcheck [--port <PORT>]
```

Consulta `GET /_health` do servidor nesta máquina (`127.0.0.1`, a `[server].port` da
configuração) e sai com o status 0 quando ele responde `200`, e 1 caso contrário, imprimindo o
motivo. Ele não precisa de shell, de `curl` nem de cliente HTTP, então a imagem Docker o usa como
o seu `HEALTHCHECK`; use-o da mesma forma no Compose ou em qualquer supervisor que rode um
comando.

| Opção | Descrição |
| --- | --- |
| `--port <PORT>` | Verifica esta porta em vez de `[server].port`. |

```text title="Terminal"
$ verdin healthcheck
ok
```

Veja [Monitoramento](/pt-br/deploy/monitoring/).

## `verdin secrets`

```text title="Terminal"
verdin secrets
```

Imprime um `VERDIN_ADMIN_JWT_SECRET` e um `VERDIN_TOKEN_PEPPER` novos, prontos para um arquivo
`.env` ou para o cofre de segredos da sua plataforma. Ele não lê nenhum projeto.

Mudar o `VERDIN_ADMIN_JWT_SECRET` invalida os tokens de acesso de curta duração dos
administradores e dos usuários finais, os links de pré-visualização abertos e os logins OAuth em
andamento; o painel de administração e os clientes que usam tokens de renovação obtêm novos
sozinhos. Mudar o `VERDIN_TOKEN_PEPPER` invalida os tokens armazenados (entre eles os tokens de
API), então mantenha-o depois que ele estiver em uso.

## `verdin version`

```text title="Terminal"
verdin version
```

Imprime `verdin` e a versão, como `verdin --version`.
