---
title: Referência de tipos de atributos
description: Todos os tipos de atributos de um arquivo de schema do Verdin, com as suas opções, validações, armazenamento no banco de dados e representação na API.
sidebar:
  order: 4
  label: Tipos de atributos
---

<!-- Written from crates/verdin-schema (convert.rs, validate.rs, model.rs),
crates/verdin-migrate/src/derive.rs and sql.rs (storage), and crates/verdin-content
(input.rs, output.rs, blocks.rs) (API). -->

Os atributos são os campos de um tipo de conteúdo ou de um componente, declarados em
`attributes` no seu arquivo de schema. Esta página lista cada `type`, as opções que ele aceita,
como o Verdin o valida e o armazena, e como ele aparece na API. O formato é o do Strapi v5; as
diferenças estão listadas [no final](#diferenças-em-relação-ao-strapi).

```json title="schema/content-types/article.json"
{
  "kind": "collectionType",
  "singularName": "article",
  "pluralName": "articles",
  "displayName": "Article",
  "options": { "draftAndPublish": true },
  "attributes": {
    "title": { "type": "string", "required": true, "maxLength": 200 },
    "slug": { "type": "uid", "targetField": "title", "required": true },
    "readingTime": { "type": "integer", "min": 0 },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "seo": { "type": "component", "component": "shared.seo" }
  }
}
```

Os arquivos de schema são estritos: uma chave desconhecida, ou uma opção que o tipo não aceita,
é um erro que o `verdin schema check` informa com o seu caminho (`attributes.title.maxLength`).

## Opções que todo atributo aceita

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `type` | obrigatória | Um dos tipos abaixo. |
| `required` | `false` | Um valor precisa estar presente. Verificado quando uma entrada é publicada (os rascunhos podem estar incompletos) e em toda escrita de um tipo sem rascunho e publicação. Também se aplica dentro de componentes e zonas dinâmicas. |
| `private` | `false` | Nunca é retornado pela API de conteúdo e não pode ser usado em `filters` nem em `sort`. Os atributos `password` são sempre privados. |
| `configurable` | `true` | A flag do Strapi para o construtor da administração; mantida como escrita. |
| `pluginOptions.i18n.localized` | `true` | Em um tipo de conteúdo localizado, `false` compartilha o valor entre os idiomas em vez de ter um valor por idioma. |
| `customField` | não definida | `plugin::<plugin>.<field>` (ou `global::<field>`): a administração edita o atributo com o campo personalizado de um plugin. O `type` é como o valor é armazenado. Veja [Plugins](/pt-br/extending/plugins/). |
| `conditions` | não definida | Os campos condicionais do Strapi (`{ "visible": <JSON Logic> }`). O editor oculta o campo enquanto a regra é falsa, e o servidor não exige um campo oculto. |
| `default` | não definida | O valor das novas entradas quando a escrita omite o atributo. Precisa ser válido para o tipo. Nem todo tipo aceita um (veja cada tipo). |

Os nomes de atributos começam com uma letra, seguida de letras, dígitos e `_`, com no máximo 50
caracteres. Nos tipos de conteúdo, `id`, `documentId`, `locale`, `publicationState`,
`publishedAt`, `createdAt`, `updatedAt`, `createdBy` e `updatedBy` são reservados; nos
componentes, `id`. Dois nomes que correspondem à mesma coluna (`metaTitle` e `meta_title`) são um
erro.

### Onde os valores são armazenados

Cada atributo de um tipo de conteúdo é uma coluna da tabela do tipo (`collectionName`, ou o nome
no plural), com o nome em `snake_case`. As relações e a mídia ficam em tabelas de vínculos. Um
rascunho e a sua versão publicada são duas linhas, uma por idioma nos tipos localizados.

Tipos de coluna por banco de dados:

| Coluna | PostgreSQL | MySQL e MariaDB | SQLite |
| --- | --- | --- | --- |
| varchar | `varchar(255)` | `varchar(255)` | `text` |
| text | `text` | `longtext` | `text` |
| integer | `integer` | `int` | `integer` |
| bigint | `bigint` | `bigint` | `integer` |
| double | `double precision` | `double` | `real` |
| decimal | `numeric(p,s)` | `decimal(p,s)` | `text` (exato) |
| boolean | `boolean` | `tinyint(1)` | `integer` |
| date | `date` | `date` | `text` |
| time | `time(3)` | `time(3)` | `text` |
| datetime | `timestamptz(3)` | `datetime(3)` | `text` |
| json | `jsonb` | `json` | `text` |

Um tipo de conteúdo pode ter no máximo 60 atributos `string`, `email`, `uid` e `enumeration` (o
limite de tamanho de linha do MySQL); use `text` para mais.

### `unique`

Os tipos que aceitam `unique: true` recebem um índice único em `(column, locale, publication_state)`:
duas entradas publicadas, ou dois rascunhos, no mesmo idioma não podem ter o mesmo valor,
enquanto um rascunho e a sua própria versão publicada podem. Uma escrita que viola isso falha com
um erro de validação no atributo. Dentro de componentes, `unique` é aceito mas não imposto (os
valores dos componentes são armazenados como JSON).

## Texto

### `string`

Uma única linha de texto.

| Opção | Descrição |
| --- | --- |
| `minLength`, `maxLength` | Limites de comprimento em caracteres. `maxLength` é no máximo 255. |
| `regex` | Um padrão ao qual o valor precisa corresponder. Sintaxe no estilo do JavaScript, incluindo look-around e backreferences. |
| `unique` | Veja [`unique`](#unique). |
| `default` | Uma string dentro dos limites que corresponde a `regex`. |

Armazenado como `varchar(255)`. API: uma string.

### `text`

Texto simples mais longo (uma textarea na administração).

| Opção | Descrição |
| --- | --- |
| `minLength`, `maxLength` | Limites de comprimento, sem limite superior. |
| `default` | Uma string dentro dos limites. |

Armazenado como `text` (`longtext` no MySQL). API: uma string.

### `richtext`

Texto em Markdown. As mesmas opções, o mesmo armazenamento e a mesma API de `text`; a
administração o edita com o editor de Markdown.

### `blocks`

Rich text como o JSON de blocks do Strapi: uma lista de blocos `paragraph`, `heading` (`level`
de 1 a 6), `list` (`format` `ordered` ou `unordered`, com filhos `list-item`, aninhados até 8
níveis), `quote`, `code` (`language` opcional) e `image`. Os filhos inline são nós `text`, com as
marcas `bold`, `italic`, `underline`, `strikethrough` e `code`, e nós `link`. No máximo 10.000
blocos.

Sem opções, sem `default`. Armazenado como JSON. API: a lista de blocos, como foi escrita.

```json
[
  { "type": "heading", "level": 2, "children": [{ "type": "text", "text": "Hello" }] },
  { "type": "paragraph", "children": [{ "type": "text", "text": "bold", "bold": true }] }
]
```

### `email`

Um endereço de e-mail (`name@domain.tld`, sem espaços).

| Opção | Descrição |
| --- | --- |
| `minLength`, `maxLength` | Limites de comprimento; `maxLength` no máximo 255. |
| `unique` | Veja [`unique`](#unique). |
| `default` | Um endereço de e-mail. |

Armazenado como `varchar(255)`. API: uma string.

### `password`

Um segredo, com hash feito na escrita com Argon2id.

| Opção | Descrição |
| --- | --- |
| `minLength`, `maxLength` | Limites de comprimento da senha como enviada. |

Sem `default`. Sempre privado: nunca é retornado, filtrado nem ordenado. Não é permitido dentro
de componentes. Armazenado como `varchar(255)` (o hash). As importações mantêm os hashes bcrypt e
Argon2 existentes como estão, para que as contas importadas ainda consigam fazer login.

### `uid`

Um identificador para URLs, como um slug. A administração o gera a partir de `targetField`.

| Opção | Descrição |
| --- | --- |
| `targetField` | Um atributo `string` ou `text` do mesmo tipo a partir do qual gerar o valor. |
| `minLength`, `maxLength` | Limites de comprimento; `maxLength` no máximo 255. |
| `regex` | O padrão ao qual os valores precisam corresponder; sem ele, `^[A-Za-z0-9\-_.~]*$`. |
| `default` | Um valor válido. |

Sempre único (veja [`unique`](#unique)). Armazenado como `varchar(255)`. API: uma string.

### `enumeration`

Um valor de uma lista fixa.

| Opção | Descrição |
| --- | --- |
| `enum` | Os valores: pelo menos um, cada um com de 1 a 255 caracteres, sem duplicatas. |
| `default` | Um dos valores. |

Armazenado como `varchar(255)`. API: uma string. As escritas com qualquer outro valor falham.

## Números

### `integer`

Um inteiro de 32 bits (−2.147.483.648 a 2.147.483.647).

| Opção | Descrição |
| --- | --- |
| `min`, `max` | Limites (inteiros). |
| `unique` | Veja [`unique`](#unique). |
| `default` | Um inteiro dentro dos limites. |

Armazenado como `integer`. API: um número. As escritas aceitam números e strings de inteiros.

### `biginteger`

Um inteiro de 64 bits. As mesmas opções de `integer`.

Armazenado como `bigint`. API: uma string (`"9007199254740993"`), como no Strapi, porque os
números do JavaScript perdem precisão além de 2⁵³. As escritas aceitam strings e números.

### `float`

Um número de ponto flutuante de precisão dupla. As mesmas opções de `integer`, com limites
numéricos.

Armazenado como `double precision` (`double`, `real`). API: um número.

### `decimal`

Um número decimal exato.

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `precision` | `10` | Total de dígitos, de 1 a 38. |
| `scale` | `2` | Dígitos depois da vírgula decimal, no máximo `precision`. |
| `min`, `max` | | Limites. |
| `unique` | | Veja [`unique`](#unique). |
| `default` | | Um número dentro dos limites. |

Os valores são arredondados para `scale` dígitos (metade para longe do zero, como fazem os bancos
de dados) e rejeitados quando têm mais de `precision - scale` dígitos antes da vírgula. As
escritas aceitam números e strings numéricas. Armazenado como `numeric(precision,scale)` (`text`
no SQLite, para que nada seja arredondado). API: um número, como o Strapi o retorna. Os valores
inteiros são inteiros (`25`, não `25.0`) e os demais são o menor float que lê de volta o mesmo
valor (`12.5`). Com [`[api].decimal_as_string`](/pt-br/reference/configuration/), a API retorna
uma string exata.

## Datas e booleanos

### `boolean`

`true` ou `false`. Aceita `default`. Armazenado como `boolean` (`tinyint(1)`, `integer`). API: um
booleano.

### `date`

Uma data do calendário, `YYYY-MM-DD`. Aceita `unique` e `default`. Armazenado como `date`. API:
`"2026-09-29"`.

### `time`

Uma hora do dia, `HH:MM`, `HH:MM:SS` ou `HH:MM:SS.mmm`. Aceita `unique` e `default`. Armazenado
com precisão de milissegundos. API: `"14:30:00.000"`.

### `datetime`

Um momento no tempo: um timestamp ISO 8601 com fuso (`Z` ou `+02:00`). Aceita `unique` e
`default`. Armazenado em UTC com precisão de milissegundos. API: `"2026-09-29T12:30:00.000Z"`.

## `json`

Qualquer valor JSON. Aceita `default` (qualquer JSON). Armazenado como `jsonb` (`json`, `text`).
API: o valor como foi escrito. Em `filters`, os atributos JSON só suportam `$null` e `$notNull`,
e não podem ser usados para ordenar.

## Mídia

### `media`

Arquivos da biblioteca de mídia.

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `multiple` | `false` | Guarda uma lista de arquivos em vez de um. |
| `allowedTypes` | qualquer | Tipos de arquivos: `images`, `videos`, `audios`, `files` (qualquer outro). |

Sem `default`. Armazenado em uma tabela de vínculos `{table}_{attribute}_mda`, em ordem. As
escritas recebem ids de arquivo: `12`, `{ "id": 12 }`, uma lista deles ou `null`. API: apenas com
`populate`; um objeto de arquivo (`url`, `mime`, `width`, `formats`…, como no Strapi), uma lista
deles ou `null`. Veja [Mídia](/pt-br/concepts/media/).

## Relações

### `relation`

Vínculos com documentos de outro tipo de conteúdo.

| Opção | Descrição |
| --- | --- |
| `relation` | `oneToOne`, `oneToMany`, `manyToOne`, `manyToMany`, `oneWay`, `manyWay` ou um tipo polimórfico (abaixo). |
| `target` | O tipo de conteúdo de destino: `article`, `api::article` ou `api::article.article`. |
| `inversedBy` | No lado dono de uma relação de mão dupla: o atributo do destino que a espelha. |
| `mappedBy` | No outro lado: o atributo dono do destino. |

Os dois lados de uma relação de mão dupla precisam concordar: `oneToMany` espelha `manyToOne`,
`oneToOne` e `manyToMany` espelham a si mesmos, e o lado `mappedBy` nomeia um atributo cujo
`inversedBy` aponta de volta. `oneWay` e `manyWay` não têm outro lado.

Os vínculos são armazenados em `{table}_{attribute}_lnk` no lado dono (o lado sem `mappedBy`),
apontando para o `documentId` do destino, em ordem. As escritas recebem `documentId`s:

| Escrita | Significado |
| --- | --- |
| `"d8f3…"`, `{ "documentId": "d8f3…" }`, uma lista deles | Substitui os vínculos. |
| `null` ou `[]` | Remove todos os vínculos. |
| `{ "set": [...] }` | Substitui os vínculos. |
| `{ "connect": [...], "disconnect": [...] }` | Adiciona e remove vínculos. Um item de `connect` pode levar `position`: `{ "before": id }`, `{ "after": id }`, `{ "start": true }` ou `{ "end": true }`. |

API: apenas com `populate`, como os documentos relacionados (no máximo 1.000 por entrada e
relação), ou `{ "count": n }` com `populate[tags][count]=true`. Veja
[Relações](/pt-br/concepts/relations/).

Dentro de componentes, apenas `oneWay` e `manyWay` são permitidas; o componente armazena os
`documentId`s.

### Relações polimórficas

`relation` também aceita os tipos polimórficos, que vinculam documentos de qualquer tipo de
conteúdo:

| `relation` | Opções | Descrição |
| --- | --- | --- |
| `morphToOne` | nenhuma | Vincula um documento de qualquer tipo. |
| `morphToMany` | nenhuma | Vincula documentos de quaisquer tipos. |
| `morphOne` | `target`, `morphBy` | Lado inverso: lê os vínculos do atributo `morphToOne` ou `morphToMany` `morphBy` de `target`. |
| `morphMany` | `target`, `morphBy` | O mesmo, para vários. |

Os donos armazenam pares `(type, documentId)` em `{table}_{attribute}_mph`. As escritas recebem
itens `{ "__type": "api::article", "documentId": "…" }` (um, uma lista, `null` ou
`{ "set": [...] }`). Os itens populados levam o seu tipo em `__type`. Não são permitidas dentro de
componentes.

## Componentes e zonas dinâmicas

### `component`

Um grupo de campos definido em `schema/components/<category>/<name>.json`.

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `component` | obrigatória | O uid do componente, `category.name` (`shared.seo`). |
| `repeatable` | `false` | Guarda uma lista de itens em vez de um. |
| `min`, `max` | | Número de itens; apenas com `repeatable`. |

Sem `default`: os novos itens recebem os padrões dos seus próprios atributos. Armazenado como JSON
na linha da entrada, cada item com um `id`. As escritas recebem o objeto do item (ou uma lista),
com `id` para manter um item existente. API: apenas com `populate`, o item ou a lista inteira. Em
`filters`, você pode filtrar pelos campos de um componente
(`filters[seo][metaTitle][$eq]=…`). Veja
[Componentes e zonas dinâmicas](/pt-br/concepts/components-and-dynamic-zones/).

### `dynamiczone`

Uma lista de itens, cada um de um entre vários componentes.

| Opção | Descrição |
| --- | --- |
| `components` | Os uids de componentes permitidos: pelo menos um, sem duplicatas. |
| `min`, `max` | Número de itens. |

Cada item leva `__component` com o seu uid. Armazenado como JSON na linha da entrada. API: apenas
com `populate`, a lista inteira. Filtre por componente com
`filters[blocks][__component][$eq]=blocks.hero`. As zonas dinâmicas não podem ser aninhadas
dentro de componentes.

## Validações entre campos

Além das opções por atributo, um tipo de conteúdo pode declarar regras sobre vários campos em
`validations`, verificadas sempre que o `required` é:

```json
"validations": [
  {
    "rule": { "<=": [{ "var": "startDate" }, { "var": "endDate" }] },
    "message": "The end date must be after the start date",
    "field": "endDate"
  }
]
```

`rule` é uma expressão JSON Logic sobre a entrada que precisa se cumprir. Ela pode usar `var`,
`==`, `!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`, `and`, `or`, `in`, `if`, `?:`, `+`,
`-`, `*`, `/`, `%`, `min`, `max` e `cat`. `message` é informada em `field` (um atributo do tipo)
ou na entrada. Esta é uma adição do Verdin; o Strapi não tem equivalente.

## Diferenças em relação ao Strapi

- **Os componentes são armazenados como JSON** na linha da entrada, não em tabelas de
  componentes com tabelas de junção. As leituras não precisam de joins; como consequência, os
  atributos `password`, as relações polimórficas e as relações de mão dupla não podem ficar
  dentro de componentes, e `unique` não é imposto ali.
- **Os componentes populados vêm inteiros.** O `populate` em um componente ou em uma zona dinâmica
  retorna todos os seus campos; não é possível escolher campos aninhados como no Strapi.
- **Arquivos de schema estritos.** Chaves desconhecidas e opções que um tipo não aceita são erros,
  enquanto o Strapi as ignora. Em `pluginOptions`, apenas `i18n.localized` é lido; o resto é
  ignorado.
- **`string`, `email` e `uid` são limitados a 255 caracteres**, o tamanho da coluna, em vez de
  falharem no banco de dados.
- **`conditions`** (campos condicionais) funcionam como no Strapi 5.17: campos ocultos não são obrigatórios.
- **`validations`** são próprias do Verdin.
- O resto corresponde ao Strapi v5: os nomes dos tipos, as suas opções, os valores `biginteger`
  como strings, as escritas de relações com `connect`, `disconnect`, `set` e `position`, e o
  formato de blocks.
