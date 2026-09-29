---
title: "Modelo de conteúdo"
description: "Como o Verdin descreve o seu conteúdo: collection types e single types, atributos, arquivos de schema no formato do Strapi e regras de validação."
sidebar:
  order: 1
---

O modelo de conteúdo é o conjunto de tipos de conteúdo e componentes que o seu projeto define.
O Verdin deriva todo o resto dele: as tabelas do banco de dados, as APIs REST e GraphQL, o
documento OpenAPI, a validação e os formulários do painel de administração. Esta página
explica as peças e as regras que se aplicam a elas.

## Tipos de conteúdo

Um tipo de conteúdo descreve um tipo de documento, como um artigo ou uma página inicial. Ele
tem um `kind`:

| Kind | Contém | Rotas REST (exemplo de blog) |
| --- | --- | --- |
| `collectionType` | Qualquer número de documentos | `/api/articles`, `/api/articles/{documentId}` |
| `singleType` | No máximo um documento | `/api/homepage` |

Os collection types são servidos no seu `pluralName`, os single types no seu `singularName`.
O primeiro `PUT` em um single type cria o seu documento. Veja a [API REST](/pt-br/api/rest/)
para todas as rotas.

Cada tipo de conteúdo tem um UID, `api::<singularName>` (`api::article`). O Strapi escreve o
mesmo UID como `api::article.article`; o Verdin aceita essa forma nos arquivos de schema e no
importador, e a normaliza para `api::article`.

Todo documento tem campos de sistema que você não declara: `id`, `documentId` (um ULID de 26
caracteres em minúsculas, estável entre rascunhos, versões publicadas e idiomas), `createdAt`,
`updatedAt`, `publishedAt` e `locale` nos [tipos localizados](/pt-br/concepts/internationalization/).

## Arquivos de schema

Os tipos de conteúdo e os componentes são arquivos JSON no diretório `schema/` do seu projeto
(`[schema].path` no `verdin.toml`). Você os versiona no git como código.

```
schema/
├── content-types/
│   ├── article.json
│   ├── category.json
│   ├── tag.json
│   └── homepage.json
└── components/
    ├── blocks/
    │   ├── hero.json
    │   └── quote.json
    └── shared/
        └── seo.json
```

O formato é o `schema.json` do Strapi, então a maioria dos schemas do Strapi carrega sem
mudanças. Este é o tipo de artigo do
[exemplo de blog](https://github.com/Verdin-CMS/verdin/tree/main/examples/blog):

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
    "excerpt": { "type": "text", "maxLength": 500 },
    "body": { "type": "richtext" },
    "readingTime": { "type": "integer", "min": 0 },
    "featured": { "type": "boolean", "default": false },
    "category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
    "tags": { "type": "relation", "relation": "manyToMany", "target": "tag" },
    "seo": { "type": "component", "component": "shared.seo" },
    "blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"] }
  }
}
```

| Chave | Obrigatória | Descrição |
| --- | --- | --- |
| `kind` | sim | `collectionType` ou `singleType`. |
| `singularName` | sim | Kebab-case. Precisa corresponder ao nome do arquivo (`article.json`). |
| `pluralName` | sim | Kebab-case, diferente de `singularName`. |
| `displayName` | sim | O nome que o painel de administração mostra. |
| `description` | não | Exibida no painel de administração. |
| `collectionName` | não | Nome da tabela. O padrão é o `pluralName` em snake_case. |
| `options.draftAndPublish` | não | Mantém um rascunho e uma versão publicada de cada documento. O padrão é `false`. Veja [Rascunho e publicação](/pt-br/concepts/draft-and-publish/). |
| `pluginOptions.i18n.localized` | não | Uma versão por idioma. O padrão é `false`. Veja [Internacionalização](/pt-br/concepts/internationalization/). |
| `attributes` | não | Os campos, na ordem em que a API os retorna. |
| `validations` | não | Regras entre campos; veja [abaixo](#validações-entre-campos). |

Os schemas são estritos: uma chave desconhecida, uma opção que um tipo não aceita ou uma
referência a um tipo ou componente inexistente é um erro que nomeia o arquivo e o caminho, e o
servidor não inicia. Rode `verdin schema check` para validar os arquivos sem iniciá-lo.

Alguns nomes já estão ocupados:

- Os nomes de atributos começam com uma letra, seguida de letras, dígitos e underscores, com
  no máximo 50 caracteres. Eles viram colunas em snake_case (`metaTitle` → `meta_title`).
- `id`, `documentId`, `locale`, `publicationState`, `publishedAt`, `createdAt`,
  `updatedAt`, `createdBy` e `updatedBy` são reservados nos tipos de conteúdo, e `id` dentro de
  componentes.
- `upload`, `uploads`, `auth`, `users` e `connect` não podem ser um `singularName` nem um
  `pluralName`: essas rotas pertencem à API.
- Um tipo de conteúdo tem no máximo 60 atributos `string`, `email`, `uid` e `enumeration`, o
  que mantém as linhas dentro do limite de tamanho de linha do MySQL. Use `text` para alguns
  deles.

Você edita os arquivos no **Construtor de tipos de conteúdo** da administração, disponível
enquanto o servidor roda com `verdin dev`, ou à mão. De qualquer forma, uma alteração vira uma
[migração de schema](/pt-br/concepts/schema-migrations/). O layout do editor (ordem dos campos,
larguras, rótulos) não faz parte do schema: os administradores o configuram no painel, e ele é
armazenado no banco de dados.

## Componentes

Um componente é um grupo reutilizável de campos, como `shared.seo` (um meta título e uma meta
descrição). O seu UID é `<category>.<name>`, tirado do seu caminho:
`schema/components/shared/seo.json` é `shared.seo`. Um arquivo de componente tem `displayName`,
`description` e `icon` opcionais, e `attributes`.

Uma zona dinâmica é uma lista que mistura vários componentes, como o corpo de um artigo feito
de blocos de hero e de citação. Os dois são armazenados dentro do documento como JSON; veja
[Componentes e zonas dinâmicas](/pt-br/concepts/components-and-dynamic-zones/).

## Atributos

Cada atributo tem um `type` e opções que dependem dele. A lista completa de tipos, as suas
opções e os tipos de coluna por banco de dados estão na
[referência de tipos de atributos](/pt-br/reference/attribute-types/).

| Categoria | Tipos |
| --- | --- |
| Texto | `string`, `text`, `richtext` (Markdown), `blocks` (o rich text estruturado do Strapi), `email`, `uid`, `password`, `enumeration` |
| Números | `integer`, `biginteger`, `float`, `decimal` |
| Datas | `date`, `time`, `datetime` |
| Outros escalares | `boolean`, `json` |
| Vínculos | `relation` (veja [Relações](/pt-br/concepts/relations/)), `media` (veja [Mídia](/pt-br/concepts/media/)) |
| Estrutura | `component`, `dynamiczone` |

Opções comuns:

| Opção | Efeito |
| --- | --- |
| `required` | O valor precisa estar definido quando uma versão é publicada (ou em toda escrita, nos tipos sem rascunho e publicação). Os rascunhos podem estar incompletos. |
| `private` | Nunca é retornado, filtrado, ordenado nem populado pela API de conteúdo. Os atributos `password` são sempre privados. |
| `default` | Valor usado quando um novo documento omite o campo. É verificado contra as regras do próprio atributo. |
| `unique` | Dois documentos não podem ter o mesmo valor, por idioma e versão. Disponível nos tipos `string`, `email`, numéricos, de data e de hora; `uid` é sempre único. |
| `configurable` | `false` trava o atributo no construtor de tipos de conteúdo: ele não pode ser editado, renomeado nem excluído ali. |
| `pluginOptions.i18n.localized` | `false` compartilha o valor entre os idiomas. |

Toda coluna de atributo aceita nulo no banco de dados. Como no Strapi v5, o `required` é
imposto pelo Verdin ao publicar, não por uma restrição `NOT NULL`, então adicionar um atributo
obrigatório a um tipo que já tem linhas é uma alteração segura.

## Validação

Toda escrita é verificada contra o schema antes de qualquer coisa chegar ao banco de dados:

- **Tipos e restrições**, em toda escrita: tipos de valor, `minLength`/`maxLength`, `min`/`max`,
  `regex`, valores de `enum`, o número de itens em componentes repetíveis e zonas dinâmicas,
  os tipos de componente que uma zona dinâmica permite e os tipos de arquivo que um campo de
  mídia aceita. Chaves desconhecidas e campos de sistema na entrada são erros.
- **Campos obrigatórios e regras entre campos**, quando uma versão é publicada, e em toda
  escrita nos tipos sem rascunho e publicação. Eles também se aplicam dentro de componentes e
  zonas dinâmicas.
- **Unicidade**, por índices únicos no banco de dados, então duas escritas concorrentes não
  podem ter sucesso ao mesmo tempo.

Uma verificação que falha responde `400` com um `ValidationError` cujo `details.errors` lista
cada problema com o seu caminho, como `["seo", "metaTitle"]` ou `["blocks", 2, "text"]`. Veja
[Erros](/pt-br/api/rest/#erros).

### Validações entre campos

Um tipo de conteúdo pode declarar regras que comparam os seus próprios campos, escritas em
[JSON Logic](https://jsonlogic.com). Este tipo de evento exige que a data de término venha
depois da data de início e limita os ingressos vendidos ao número de lugares:

```json title="schema/content-types/event.json"
{
  "kind": "collectionType",
  "singularName": "event",
  "pluralName": "events",
  "displayName": "Event",
  "attributes": {
    "startDate": { "type": "date", "required": true },
    "endDate": { "type": "date" },
    "seats": { "type": "integer", "min": 0 },
    "sold": { "type": "integer", "min": 0 }
  },
  "validations": [
    {
      "rule": { "or": [{ "!": { "var": "endDate" } }, { "<=": [{ "var": "startDate" }, { "var": "endDate" }] }] },
      "message": "must be after the start date",
      "field": "endDate"
    },
    { "rule": { "<=": [{ "var": "sold" }, { "var": "seats" }] }, "message": "more tickets sold than seats" }
  ]
}
```

- Uma regra que não se cumpre é um erro de validação com `message`, em `field` quando
  informado, ou no documento (`path: []`).
- As regras rodam quando o `required` roda: ao publicar e em toda escrita nos tipos sem
  rascunho e publicação. Os rascunhos podem violá-las.
- `var` lê os campos do próprio documento, com caminhos com pontos para dentro dos componentes.
  Relações e mídia não estão disponíveis para as regras.
- As comparações são numéricas quando os dois lados são números e textuais quando os dois são
  strings, então datas, horas e datas com hora em ISO são comparadas corretamente. Um campo
  vazio é `null`: proteja os campos opcionais, como faz a primeira regra.
- Operadores permitidos: `var`, `==`, `!=`, `===`, `!==`, `<`, `>`, `<=`, `>=`, `!`, `!!`,
  `and`, `or`, `in`, `if`, `?:`, `+`, `-`, `*`, `/`, `%`, `min`, `max`, `cat`. Um operador
  desconhecido, um `field` desconhecido ou uma `message` vazia é um erro de schema.

O servidor verifica as regras; o painel de administração mostra as mensagens delas nos campos
que nomeiam quando uma publicação falha. O Strapi não tem equivalente. Os campos condicionais do
Strapi (`conditions`) são aceitos nos arquivos de schema e mantidos, mas ainda não são
aplicados.
