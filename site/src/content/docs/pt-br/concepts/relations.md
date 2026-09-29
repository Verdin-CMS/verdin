---
title: "Relações"
description: "Os tipos de relação, como o Verdin vincula documentos pelo documentId, a ordenação, as relações polimórficas e o que oneWay e manyWay significam dentro de componentes."
sidebar:
  order: 3
---

Uma relação vincula documentos de dois tipos de conteúdo, como um artigo e a sua categoria.
Esta página explica os tipos de relação, como os vínculos são armazenados e resolvidos, e as
regras para escrevê-los, ordená-los e lê-los. Para a sintaxe das requisições, veja a
[API REST](/pt-br/api/rest/#escrita).

## Tipos

Uma relação é um atributo de `type: "relation"` com um tipo `relation` e um tipo de conteúdo
`target`:

| Tipo | Um documento aponta para | Um destino é apontado por | Lado inverso |
| --- | --- | --- | --- |
| `oneWay` | um destino | qualquer número de documentos | nenhum |
| `manyWay` | vários destinos | qualquer número de documentos | nenhum |
| `manyToOne` | um destino | qualquer número de documentos | `oneToMany` |
| `oneToMany` | vários destinos | um documento | `manyToOne` |
| `oneToOne` | um destino | um documento | `oneToOne` |
| `manyToMany` | vários destinos | qualquer número de documentos | `manyToMany` |

O exemplo de blog vincula os artigos a uma categoria (com lado inverso) e a tags (sem lado
inverso):

```json title="schema/content-types/article.json (excerpt)"
"category": { "type": "relation", "relation": "manyToOne", "target": "category", "inversedBy": "articles" },
"tags": { "type": "relation", "relation": "manyToMany", "target": "tag" }
```

```json title="schema/content-types/category.json (excerpt)"
"articles": { "type": "relation", "relation": "oneToMany", "target": "article", "mappedBy": "category" }
```

- O lado com `inversedBy` (ou sem nenhuma das duas chaves) é o lado **dono**: ele armazena os
  vínculos e é o que você escreve.
- O lado com `mappedBy` é o lado **inverso**: ele lê os vínculos do dono ao contrário e é
  somente leitura. Escrevê-lo é um erro de validação que nomeia o atributo dono.
- Os dois lados precisam concordar: `mappedBy` nomeia um atributo do destino que aponta de
  volta com `inversedBy`, com o tipo inverso correspondente da tabela.
- `oneWay` e `manyWay` nunca têm lado inverso.

O construtor de tipos de conteúdo cria o atributo inverso no destino para você.

## Vinculadas pelo documento, não pela linha

Um documento tem várias linhas: um rascunho e uma versão publicada, e uma de cada por idioma.
O Verdin armazena uma relação como um vínculo da **linha** de origem para o **documento** de
destino (o seu `documentId`), em uma tabela de vínculos chamada `{table}_{field}_lnk`. A linha
de destino é escolhida quando a relação é lida:

- Um artigo publicado vê a versão publicada da sua categoria; o seu rascunho vê o rascunho da
  categoria. Os tipos sem rascunho e publicação têm uma única versão, que todo leitor vê.
- Quando o destino também é localizado, as leituras o resolvem no mesmo idioma. Um tipo de
  destino não localizado é compartilhado por todos os idiomas.
- Despublicar uma categoria a esconde dos artigos publicados sem tocar em nenhum vínculo;
  publicá-la de novo a traz de volta.
- Publicar um artigo copia apenas os seus próprios vínculos para a versão publicada.

O Strapi vincula ids de linha, então precisa reescrever os vínculos sempre que um rascunho é
publicado. O Verdin nunca faz isso, o que mantém a publicação como uma simples cópia da linha
do rascunho.

A integridade é mantida pelo Verdin, e não por chaves estrangeiras: vincular um documento que
não existe é um erro de validação, e excluir um documento remove, na mesma transação, os
vínculos que apontam para ele.

### Um documento por destino

Em `oneToOne` e `oneToMany`, um destino pertence a no máximo um documento de origem. Vincular
um destino que outro documento já tem o **move**: o vínculo do outro documento é removido na
mesma escrita. É o comportamento do Strapi. Isso é imposto por versão: um rascunho e a sua
versão publicada podem ter o mesmo destino.

## Escrita

No lado dono, `data` recebe um `documentId`, uma lista deles ou um objeto que descreve uma
alteração:

| Entrada | Efeito |
| --- | --- |
| `"k2m…"` ou `{ "documentId": "k2m…" }` | Vincula um destino (relações to-one). |
| `["k2m…", "p9x…"]` | Substitui todos os vínculos, nesta ordem. |
| `null` ou `[]` | Remove todos os vínculos. |
| `{ "set": ["k2m…"] }` | Substitui todos os vínculos. |
| `{ "connect": [...], "disconnect": [...] }` | Adiciona e remove vínculos, mantendo os outros. |

Conectar um novo destino a uma relação to-one substitui o anterior. `set` não pode ser
combinado com `connect` nem com `disconnect`.

No painel de administração, um campo de relação lista as entradas vinculadas. **Vincular uma
entrada** (ou **Vincular entradas** nas relações to-many) abre uma caixa de diálogo que busca
as entradas do tipo de destino, nos seus campos de texto, e no idioma da entrada quando o
destino é localizado. Escolha uma entrada, ou marque várias e adicione-as; as entradas já
vinculadas ficam marcadas.

## Ordenação

As relações to-many mantêm a ordem dos seus vínculos. Uma lista ou um `set` armazena a ordem
que você envia. Os itens de `connect` podem dizer onde entram:

```json
{
  "data": {
    "tags": {
      "connect": [
        { "documentId": "k2m…", "position": { "before": "p9x…" } },
        { "documentId": "a7c…", "position": { "end": true } }
      ]
    }
  }
}
```

`position` é `{ "before": documentId }`, `{ "after": documentId }`, `{ "start": true }` ou
`{ "end": true }`. As posições são renumeradas a cada escrita. As leituras retornam os
documentos relacionados na ordem dos vínculos, a menos que o populate peça um `sort`.

## Leitura

As relações só são retornadas quando você as popula:

```http
GET /api/articles?populate[category][fields][0]=name&populate[tags][sort]=label:asc
```

Uma relação to-one é um objeto ou `null`; uma relação to-many é um array. Cada relação
populada pode receber os seus próprios `fields`, `filters`, `sort`, `populate` e `count`, até
cinco níveis de profundidade. Cada nível é uma consulta em lote por relação
(`WHERE … IN (…)`), não um join, então populates profundos não multiplicam as linhas. No
máximo 1.000 documentos relacionados são retornados por documento e relação; `count` dá o
número exato.

Você pode filtrar pelas relações (`filters[category][name][$eq]=News`), em qualquer lado, e
ordenar por um campo de uma relação to-one (`sort=category.name:asc`). Popular, filtrar ou
ordenar por uma relação com um tipo que o cliente não pode ler é recusado (`populate=*` o
ignora), então as relações nunca revelam conteúdo que as
[permissões](/pt-br/concepts/permissions/) do cliente escondem.

## Relações dentro de componentes

Um [componente](/pt-br/concepts/components-and-dynamic-zones/) pode conter relações, mas apenas
`oneWay` e `manyWay`:

```json title="schema/components/shared/related.json"
{
  "displayName": "Related",
  "attributes": {
    "label": { "type": "string" },
    "articles": { "type": "relation", "relation": "manyWay", "target": "article" }
  }
}
```

O JSON do componente armazena os próprios `documentId`s: uma string para `oneWay`, um array
para `manyWay`. É por isso que os outros tipos não são permitidos ali:

- Um lado inverso teria que buscar no JSON de todos os documentos para descobrir quem aponta
  para ele.
- "Um documento por destino" (`oneToOne`, `oneToMany`) também não pode ser imposto sem essa
  busca.

Dentro de componentes, a ordem de uma lista `manyWay` é a ordem do array. As referências são
verificadas na escrita e resolvidas quando o componente é populado, no status e no idioma do
documento; os destinos que não existem mais ficam de fora. Não é possível filtrar por elas.

## Relações polimórficas

`morphToOne` e `morphToMany` vinculam documentos de qualquer tipo de conteúdo. Os seus
vínculos armazenam o tipo do destino ao lado do seu `documentId`, e as escritas informam os
dois:

```json
{ "data": { "related": [{ "__type": "api::article", "documentId": "k2m…" }, { "__type": "api::page", "documentId": "p9x…" }] } }
```

Os itens populados são os documentos de destino com o seu `__type`, lidos no status e no idioma
da requisição. Os lados inversos `morphOne` e `morphMany` nomeiam o tipo dono (`target`) e o
seu atributo (`morphBy`), e são somente leitura. Não é possível filtrar nem ordenar por
relações polimórficas, e elas não podem ficar dentro de componentes.
