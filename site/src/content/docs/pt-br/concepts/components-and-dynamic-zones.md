---
title: "Componentes e zonas dinâmicas"
description: "Grupos de campos reutilizáveis e listas mistas de blocos, por que o Verdin os armazena como JSON no documento e o que isso significa para relações, mídia, filtragem e populate."
sidebar:
  order: 2
---

Os componentes permitem reutilizar um grupo de campos em vários tipos de conteúdo, e as zonas
dinâmicas permitem que os editores montem uma página a partir de uma lista de blocos. Esta
página explica como os dois são modelados e armazenados, e como isso define a forma de lê-los,
escrevê-los e filtrá-los. O formato do schema em si está em
[Modelo de conteúdo](/pt-br/concepts/content-model/).

## Componentes

Um componente é um grupo de campos com o seu próprio arquivo em `schema/components/<category>/`.
O `shared.seo` do exemplo de blog guarda um meta título e uma descrição:

```json title="schema/components/shared/seo.json"
{
  "displayName": "SEO",
  "attributes": {
    "metaTitle": { "type": "string", "maxLength": 60 },
    "metaDescription": { "type": "text", "maxLength": 160 }
  }
}
```

Um tipo de conteúdo o usa por meio de um atributo `component`. `repeatable: true` o transforma
em uma lista, opcionalmente limitada com `min` e `max` itens:

```json
"seo": { "type": "component", "component": "shared.seo" },
"links": { "type": "component", "component": "shared.link", "repeatable": true, "max": 10 }
```

Os componentes podem conter outros componentes. Um componente não pode conter a si mesmo,
nem diretamente nem por meio de outros; a verificação do schema rejeita esses ciclos.

## Zonas dinâmicas

Uma zona dinâmica é uma lista cujos itens podem ser qualquer um dos componentes que ela
nomeia. O corpo do artigo do blog mistura heroes e citações:

```json
"blocks": { "type": "dynamiczone", "components": ["blocks.hero", "blocks.quote"], "max": 20 }
```

Cada item informa qual componente é em `__component`. `min` e `max` limitam o número de itens.
As zonas dinâmicas pertencem apenas aos tipos de conteúdo: um componente não pode conter uma.

## Armazenados como JSON

O Verdin armazena o valor de um componente ou de uma zona dinâmica em uma coluna JSON da linha
do documento (`jsonb` no PostgreSQL, `json` no MySQL e no MariaDB, texto no SQLite):

```json
// the "seo" column
{ "id": 1, "metaTitle": "Rust for CMS authors", "metaDescription": "…" }

// the "blocks" column
[
  { "__component": "blocks.hero", "id": 1, "title": "Hello", "subtitle": "…" },
  { "__component": "blocks.quote", "id": 2, "text": "…", "author": "Ferris" }
]
```

O Strapi mantém cada componente na sua própria tabela, unida por tabelas de vínculo
polimórficas. Armazenar o valor junto com o documento significa que:

- Ler um documento com os seus componentes não exige joins, por mais aninhados que estejam.
- Publicar, descartar um rascunho e o [histórico de conteúdo](/pt-br/guides/content/content-history/)
  copiam o valor como está.
- Adicionar um campo a um componente não altera nenhuma tabela: a migração é vazia.
- Filtrar por campos de componentes usa as funções JSON de cada banco de dados, e alguns filtros
  não estão disponíveis (veja [Filtragem](#filtragem)).

Todo item tem um `id`, um inteiro positivo único dentro do valor do atributo. O Verdin atribui
um aos itens novos; envie o `id` de volta ao atualizar uma lista para manter os itens estáveis.

## Relações e mídia dentro de componentes

Um componente pode conter relações e mídia, armazenadas no próprio JSON: `documentId`s para as
relações e ids de arquivo para a mídia.

- As relações dentro de componentes precisam ser `oneWay` ou `manyWay`: elas apontam para os
  seus destinos e não têm lado inverso. Veja
  [Relações](/pt-br/concepts/relations/#relações-dentro-de-componentes).
- Toda referência é verificada na escrita: o documento ou arquivo de destino precisa existir, e
  os arquivos precisam corresponder aos `allowedTypes` do campo.
- Quando o componente é populado, as referências são resolvidas com consultas em lote, no mesmo
  status e idioma do documento. Um destino que foi excluído, ou que não tem versão naquele que
  está sendo lido, fica de fora.
- Relações polimórficas (`morphToOne`, `morphToMany`) e campos `password` não podem ficar
  dentro de componentes.

## Leitura

Componentes e zonas dinâmicas só são retornados quando você os popula, como no Strapi:

```http
GET /api/articles?populate[0]=seo&populate[1]=blocks
GET /api/articles?populate=*
```

Um componente populado volta inteiro, com os componentes aninhados e as relações e a mídia
resolvidas. O Strapi precisa de um nível de `populate` para cada componente aninhado; o Verdin
aceita essas opções aninhadas por compatibilidade e as ignora. Os itens de zona dinâmica voltam
na ordem em que foram armazenados, cada um com o seu `__component`.

No GraphQL, um componente é um object type com o nome do seu UID (`ComponentSharedSeo`) e uma
zona dinâmica é uma union (`ArticleBlocksDynamicZone`) que você consulta com fragments. Veja
[API GraphQL](/pt-br/api/graphql/).

## Escrita

Envie o valor inteiro do atributo. Ele substitui o que estava armazenado:

```json
{
  "data": {
    "seo": { "metaTitle": "Rust for CMS authors" },
    "blocks": [
      { "__component": "blocks.hero", "title": "Hello" },
      { "__component": "blocks.quote", "text": "Fast and small.", "author": "Ferris" }
    ]
  }
}
```

O valor é validado contra o schema do componente em toda escrita: chaves desconhecidas, tipos
errados e um `__component` que a zona dinâmica não permite são erros com caminhos como
`["blocks", 1, "text"]`. Os campos `required` dentro de componentes são verificados quando o
documento é publicado, como os de nível superior.

## Filtragem

| O quê | Exemplo | Observações |
| --- | --- | --- |
| Campos de um componente | `filters[seo][metaTitle][$containsi]=rust` | Campos escalares, inclusive de componentes aninhados. |
| Campos de um componente repetível | `filters[links][url][$contains]=github` | Corresponde quando algum item corresponde. |
| Zonas dinâmicas | `filters[blocks][__component][$eq]=blocks.quote` | Apenas por `__component`: itens de componentes diferentes têm campos diferentes. |

Não é possível ordenar por campos de componentes, e os campos `json` dentro de componentes não
podem ser filtrados. Veja a [API REST](/pt-br/api/rest/#filtros) para os operadores.
