---
title: Camada de banco de dados
description: Como o Verdin conversa com PostgreSQL, MySQL, MariaDB e SQLite por meio de um único tipo de conexão, um enum Flavor e os seus próprios builders de SQL, e como trata as diferenças de cada dialeto.
sidebar:
  order: 3
---

Esta página explica como o Verdin suporta quatro motores de banco de dados com um único caminho de código: o crate `verdin-db`, que conecta e executa, os builders de SQL que se ramificam conforme o motor e as diferenças de dialeto que eles tratam. Leia-a antes de escrever SQL em qualquer lugar do servidor. Como as tabelas são organizadas está em [armazenamento](/pt-br/internals/storage/).

## Versões mínimas

`Database::connect` detecta o motor e a sua versão e se recusa a iniciar abaixo destes mínimos (`Flavor::minimum_version` em `crates/verdin-db/src/lib.rs`):

| Motor | Mínimo | Motivo |
|---|---|---|
| PostgreSQL | 14 | A versão mais antiga ainda suportada pelo projeto |
| MySQL | 8.4 LTS | A 8.0 chegou ao fim da vida em abril de 2026 |
| MariaDB | 10.11 LTS | A versão de longo prazo atual mais antiga; collation `utf8mb4_uca1400_ai_ci`, JSON utilizável |
| SQLite | 3.35 | `ALTER TABLE … DROP COLUMN`; a biblioteca é compilada dentro do binário |

A CI roda todos os testes contra PostgreSQL 14 e 17, MySQL 8.4, MariaDB 10.11 e 11.4, e SQLite. Veja [testes](/pt-br/internals/testing/).

## Conexão

O `verdin-db` envolve um pool do `sqlx` por backend:

```rust
pub enum Pool { Postgres(PgPool), MySql(MySqlPool), Sqlite(SqlitePool) }

pub enum Flavor { Postgres, MySql, MariaDb, Sqlite }

pub struct Database { pool: Pool, flavor: Flavor, version: Version }
```

- Esquemas de URL: `postgres://` ou `postgresql://`, `mysql://`, `mariadb://` (um alias de `mysql://`) e `sqlite:`. O MySQL e o MariaDB compartilham o driver MySQL do `sqlx`; o flavor vem de `SELECT VERSION()`, que contém `MariaDB` no MariaDB.
- As conexões MySQL e MariaDB usam `utf8mb4` e definem o fuso horário da sessão como `+00:00`, então todos os timestamps são armazenados em UTC.
- As conexões SQLite ativam as chaves estrangeiras, usam journaling WAL e um busy timeout de 5 segundos, e criam o arquivo do banco de dados (e a sua pasta) se não existirem. Os bancos de dados em memória recebem uma única conexão, porque cada conexão com `:memory:` abriria um banco de dados diferente.
- `ConnectOptions` define o tamanho do pool (`[database].pool_max`, 10 por padrão) e o tempo de espera por uma conexão livre (10 segundos).

O `Flavor` carrega os poucos fatos pelos quais o resto do código se ramifica: `transactional_ddl()` (PostgreSQL e SQLite), `is_mysql_family()`, `quote(identifier)` (crases no MySQL e no MariaDB, aspas duplas nos outros) e `minimum_version()`.

Não há trait de dialeto. O código que monta SQL verifica o `Flavor` onde os motores diferem.

## Execução de instruções

Três executores compartilham os mesmos métodos (`execute`, `fetch_all`, `has_rows`, `insert_returning_id`):

| Executor | Uso |
|---|---|
| `db.queries()` | Uma instrução em qualquer conexão do pool |
| `db.acquire()` → `Conn` | Várias instruções em uma única conexão, como uma execução de migração que mantém um lock |
| `db.begin()` → `Tx` | Uma transação; descartada sem `commit()`, ela faz rollback |

As instruções são escritas com placeholders `?`, reescritos para `$1, $2…` no PostgreSQL. Os valores são `SqlValue`s, sempre vinculados como parâmetros. O texto SQL em si só pode conter identificadores que vêm do schema validado, e é por isso que ele é passado ao `sqlx` como `AssertSqlSafe`.

**Decodificação guiada pelo schema.** Uma leitura passa o `ColumnKind` de cada coluna selecionada, e os valores são decodificados por esse kind, não pelo tipo que o driver informa. É isso que faz o `JSON` do MariaDB (na verdade `LONGTEXT`), os booleanos `TINYINT(1)` do MySQL e as datas e decimais em texto do SQLite voltarem da mesma forma em todos os motores. Veja `crates/verdin-db/src/value.rs`.

**Ids inseridos.** `insert_returning_id` acrescenta `RETURNING id` no PostgreSQL e lê o id que o driver informa após a inserção no MySQL, no MariaDB (`LAST_INSERT_ID`) e no SQLite (`last_insert_rowid`).

**Violações de unicidade.** `DbError::unique_violation()` extrai o nome do índice (PostgreSQL, MySQL, MariaDB) ou a lista de colunas (SQLite) do erro do driver, para que o Document Service possa informar um `ValidationError` no atributo certo.

## Builders de SQL

O Verdin monta o SQL com os seus próprios pequenos builders em vez de um ORM ou do `sea-query`, porque as tabelas só existem em runtime (vêm do schema) e porque os detalhes de cada dialeto predominam: NULLs tipados, collations, funções JSON e os formatos de texto do SQLite.

| Crate | Monta |
|---|---|
| `verdin-migrate` (`sql.rs`, `Dialect`) | DDL: tipos de coluna, `CREATE TABLE`, `ALTER TABLE`, índices, reconstruções de tabelas do SQLite |
| `verdin-query` (`sql.rs`, `SqlBuilder`) | Cláusulas `WHERE` para os filtros (incluindo subqueries `EXISTS` de relações e caminhos JSON) e `ORDER BY` |
| `verdin-content` (`service.rs`) | Leituras, inserções, atualizações, exclusões, escritas nas tabelas de vínculos e consultas de populate em lote |

Um builder acrescenta texto SQL e nomes `ident()` (com as aspas do flavor) e coleta os parâmetros com `param()`, então montar o SQL e vincular os valores acontecem em um único lugar.

### Tipos de coluna por dialeto

| Tipo do modelo | PostgreSQL | MySQL / MariaDB | SQLite |
|---|---|---|---|
| id | `bigint` identity | `bigint AUTO_INCREMENT` | `integer PRIMARY KEY AUTOINCREMENT` |
| integer, bigint, smallint | `integer`, `bigint`, `smallint` | `int`, `bigint`, `smallint` | `integer` |
| double | `double precision` | `double` | `real` |
| decimal | `numeric(p,s)` | `decimal(p,s)` | `text` |
| boolean | `boolean` | `tinyint(1)` | `integer` |
| char, varchar | `char(n)`, `varchar(n)` | `char(n)`, `varchar(n)` | `text` |
| text | `text` | `longtext` | `text` |
| date, time, datetime | `date`, `time(3)`, `timestamptz(3)` | `date`, `time(3)`, `datetime(3)` | `text` |
| json | `jsonb` | `json` | `text` |

O SQLite armazena decimais, datas e horas como texto de formato fixo, para que nada seja arredondado e a ordem do texto corresponda à ordem numérica e cronológica. Qual atributo corresponde a qual tipo do modelo está em [tipos de atributos](/pt-br/reference/attribute-types/).

As tabelas do MySQL e do MariaDB são criadas com `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` e uma collation que ignora acentos e maiúsculas: `utf8mb4_0900_ai_ci` no MySQL, `utf8mb4_uca1400_ai_ci` no MariaDB.

## Diferenças de dialeto

| Tema | PostgreSQL | MySQL 8.4 | MariaDB | SQLite | Como o Verdin trata |
|---|---|---|---|---|---|
| Id inserido | `RETURNING` | sem `RETURNING` | id do driver | id do driver | `insert_returning_id()` |
| DDL transacional | sim | não (commit implícito) | não | sim | Journal de passos no MySQL e no MariaDB (veja [migrações](/pt-br/internals/migrations/)) |
| JSON | `jsonb` | `json` | alias de `LONGTEXT` | texto | Decodificação guiada pelo schema |
| Booleanos | `boolean` | `tinyint(1)` | `tinyint(1)` | integer | Decodificação guiada pelo schema |
| Data e hora | `timestamptz` | `datetime(3)` | `datetime(3)` | texto ISO | Sempre UTC; as sessões da família MySQL usam o fuso horário `+00:00` |
| Charset e collation | UTF-8 | `utf8mb4`, `utf8mb4_0900_ai_ci` | `utf8mb4`, `utf8mb4_uca1400_ai_ci` | UTF-8, binária | Definidos explicitamente por tabela |
| Correspondência exata de texto (`$eq`, `$in`…) | `=` | `COLLATE utf8mb4_bin` | igual | `=` | Os mesmos resultados em todos os motores |
| `$contains`, `$startsWith`, `$endsWith` | `LIKE` | `LIKE … COLLATE utf8mb4_bin` | igual | `instr()` / `substr()` | O `LIKE` do SQLite ignora maiúsculas ASCII, então não é usado para correspondências que diferenciam maiúsculas |
| `$containsi` e os outros operadores `…i` | `ILIKE` | `LIKE` (collation insensível) | igual | `LIKE` | O SQLite só normaliza maiúsculas ASCII |
| Filtros por caminho JSON | `#>>` | `JSON_VALUE` | igual | `json_extract` | Operando por dialeto |
| Filtros em arrays JSON | `jsonb_array_elements` | `JSON_TABLE` | igual | `json_each` | `EXISTS` sobre os itens |
| `ALTER COLUMN` | completo | `MODIFY COLUMN` | igual | não suportado | SQLite: reconstruir a tabela (criar, copiar, remover, renomear) |
| Locks de linha | `FOR UPDATE` | `FOR UPDATE` | `FOR UPDATE` | nenhum | Omitidos no SQLite, cujas transações de escrita travam o banco de dados |
| Comprimento de índice único de texto | — | 3.072 bytes | igual | — | `varchar(255)` em `utf8mb4` tem 1.020 bytes; `text` não pode ser único |
| Tamanho da linha | — | 65.535 bytes | igual | — | No máximo 60 atributos `string`, `email`, `uid` ou `enumeration` por tipo |

Os padrões `LIKE` escapam `%`, `_` e o próprio caractere de escape (`!`) na entrada do usuário. As collations padrão do MySQL e do MariaDB ignoram maiúsculas e acentos, e é por isso que os operadores exatos adicionam uma collation binária: `$eq` significa a mesma coisa no MySQL e no PostgreSQL. Com caminhos JSON, o `JSON_VALUE` retorna uma string com collation binária, então os operadores insensíveis a maiúsculas ali comparam `LOWER()` dos dois lados.

O `ORDER BY` coloca os NULLs por último nas duas direções e sempre termina com `id`, então a paginação é estável em todos os motores.
