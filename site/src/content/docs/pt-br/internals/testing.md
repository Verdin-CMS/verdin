---
title: Testes
description: Como o Verdin é testado, dos testes unitários em Rust à suíte de conformidade que roda em seis bancos de dados, os testes unitários e Playwright do painel de administração e os jobs de CI que protegem cada alteração.
sidebar:
  order: 7
---

Esta página explica as suítes de testes, como rodar cada uma localmente e o que a CI verifica em todo pull request. A regra por trás de tudo: um recurso não está pronto até passar em todos os bancos de dados suportados.

## Testes em Rust

Rode tudo com:

```sh title="Terminal"
cargo test --workspace
```

Sem configuração, os testes usam SQLite. Há três tipos:

| Tipo | Onde | O quê |
|---|---|---|
| Testes unitários | Módulos `#[cfg(test)]` em cada crate | Interpretação e validação do schema, nomenclatura, diff e plan, interpretação das consultas, geração de SQL por dialeto, codificação dos valores, validação da entrada |
| Testes de integração dos crates | `crates/*/tests/` | Conexão e detecção de flavor (`verdin-db`), aplicação de migrações (`verdin-migrate`), fluxos de autenticação (`verdin-auth`), GraphQL, plugins, armazenamento S3 |
| Testes de API | `crates/verdin-api/tests/api/` | Requisições HTTP contra a API de conteúdo e a API de administração, incluindo a suíte de conformidade |

**Snapshots de DDL.** O `crates/verdin-migrate/tests/sql_snapshots.rs` gera o DDL de um schema de exemplo para cada dialeto e o compara com os snapshots do [`insta`](https://insta.rs) em `crates/verdin-migrate/tests/snapshots/`. Quando você altera o DDL de propósito, revise e aceite os novos snapshots com `cargo insta review` (do `cargo-insta`) e commite-os.

**Os testes de API** ficam em um único binário de teste (`tests/api/main.rs`, um módulo por área) para reduzir o tempo de link e o tamanho de `target/`. O harness em `tests/api/common/mod.rs` monta a API de conteúdo em `/api` e a API de administração em `/admin/api` sobre um banco de dados novo e migrado por teste. As requisições levam um token de API de acesso total, a menos que o teste passe outro, ou nenhum.

## A matriz de seis bancos de dados

Todo teste que toca um banco de dados lê `VERDIN_TEST_DATABASE_URL` e usa por padrão o SQLite em memória. O `verdin-testkit` dá a cada teste um banco de dados próprio: um arquivo SQLite temporário, ou um banco de dados `vd_test_…` novo criado no servidor e removido depois.

A CI roda o workspace inteiro uma vez por motor:

| Motor | Imagem |
|---|---|
| SQLite | embutido |
| PostgreSQL 14 | `postgres:14-alpine` |
| PostgreSQL 17 | `postgres:17-alpine` |
| MySQL 8.4 | `mysql:8.4` |
| MariaDB 10.11 | `mariadb:10.11` |
| MariaDB 11.4 | `mariadb:11.4` |

Estas são as [versões mínimas](/pt-br/internals/database/#versões-mínimas), mais as mais recentes em que o Verdin é testado. A CI também define `VERDIN_TEST_EXPECT_FLAVOR`, para que o `crates/verdin-db/tests/connect.rs` confirme que o motor foi detectado corretamente (o MariaDB é acessado com uma URL `mysql://` e ainda assim precisa ser detectado como MariaDB).

Para rodar a matriz localmente, inicie os bancos de dados com o Docker:

```sh title="Terminal"
docker compose -f docker/compose.dev.yml up -d
```

Depois, rode os testes contra cada motor. Os testes criam um banco de dados por teste, então no MySQL e no MariaDB eles se conectam como `root`:

```sh title="Terminal"
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5414/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=postgres://verdin:verdin@localhost:5417/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3384/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3311/verdin cargo test --workspace
VERDIN_TEST_DATABASE_URL=mysql://root:verdin@localhost:3314/verdin cargo test --workspace
```

As portas correspondem ao PostgreSQL 14 e 17, ao MySQL 8.4 e ao MariaDB 10.11 e 11.4. O mesmo arquivo compose inicia o RustFS (armazenamento compatível com S3 na porta 9000) e o Mailpit (SMTP na porta 1025, caixa de entrada na porta 8025) para o trabalho com mídia e e-mail.

## Suíte de conformidade

O `crates/verdin-api/tests/api/conformance.rs` envia as mesmas requisições HTTP para a API de conteúdo em todos os motores e verifica as respostas: idas e voltas de criação, leitura, atualização e exclusão, validação da entrada, rascunho e publicação, os filtros e as suas regras de correspondência de texto, ordenação e paginação, tipos de campos e populate, valores únicos, single types, regras de acesso da API de conteúdo, o documento OpenAPI e os filtros em campos de componentes. Os outros módulos em `tests/api/` (`filters.rs`, `populate.rs`, `relations.rs`, `components.rs`, `morph.rs`, `i18n.rs`…) cobrem as suas áreas da mesma forma, então o binário de teste `verdin-api` inteiro é, na prática, a suíte de conformidade.

Quando você corrigir uma diferença de dialeto, adicione o caso aqui: o teste que passa no PostgreSQL e falha no MySQL é exatamente o que a suíte existe para pegar.

## Testes do painel de administração

**Os testes unitários** são arquivos `*.spec.ts` ao lado do código em `admin/src/app`, executados com o Vitest pelo builder de testes unitários do Angular no jsdom. Eles cobrem os modelos puros: conversão do modelo do formulário, regras dos campos, filtros e visualizações das listas, permissões, o transpiler ICU, o início da semana e mais.

```sh title="Terminal"
cd admin
npx ng test --watch=false
```

**Os testes de ponta a ponta** são specs do Playwright em `admin/e2e/`. O `e2e/serve.sh` cria um projeto descartável (com um plugin WebAssembly de exemplo) e inicia o `verdin dev` na porta 1393 com SQLite, servindo a administração a partir de `admin/dist/admin/browser`. Os testes rodam um por vez no Chromium, com a interface em inglês.

```sh title="Terminal"
cd admin
npx ng build
cargo build -p verdin
npx playwright install chromium
npx playwright test
```

Os specs cobrem o login e os dois fatores, o editor de entradas, as relações polimórficas, os fluxos de revisão, os recursos de equipe e de governança, as menções, a importação e a exportação, as telas de edição e as proteções contra alterações não salvas.

## CI

O `.github/workflows/ci.yml` roda a cada push em `main` e em todo pull request. Todos os jobs Rust compilam com `RUSTFLAGS=-D warnings`.

| Job | Verifica |
|---|---|
| `lint` | `cargo fmt --all --check`, `cargo clippy --workspace --all-targets`, `cargo deny` (licenças e avisos de segurança) |
| `test (sqlite)` | `cargo test --workspace` no SQLite em memória |
| `test (…)` | `cargo test --workspace` no PostgreSQL 14 e 17, no MySQL 8.4 e no MariaDB 10.11 e 11.4, um job cada, como serviços Docker |
| `test (s3 storage, RustFS)` | `cargo test -p verdin-upload --test s3` contra um contêiner RustFS |
| `admin` | Verificação do Prettier, `npm run i18n:check`, `npm audit --audit-level=high`, testes unitários, `ng build`, `cargo build -p verdin --features embed-admin`, Playwright |
| `client` | O `packages/client` tem a mesma versão do workspace, depois verificação de tipos, testes e build |
| `site` | `npm audit` e o build da documentação, que falha com qualquer link interno quebrado |

As execuções do Playwright que falham enviam os seus traces como artefato, mantido por sete dias.
