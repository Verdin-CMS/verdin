---
title: "Internacionalização"
description: "Como o Verdin mantém uma versão de um documento por idioma, quais campos são localizados ou compartilhados e como as APIs escolhem um idioma."
sidebar:
  order: 5
---

A internacionalização (i18n) mantém o conteúdo de um documento em vários idiomas. Esta página
explica o modelo: idiomas, campos localizados e compartilhados, e como leituras e escritas
escolhem um idioma. Para o fluxo de trabalho do editor, veja
[Localização de conteúdo](/pt-br/guides/content/localizing-content/).

## Idiomas

Os idiomas do projeto estão listados em **Configurações → Internacionalização** (permissão
`locales.manage`). A primeira inicialização adiciona o inglês (`en`) como idioma padrão.

- Um idioma é sempre o padrão. As requisições que não nomeiam um idioma o usam, e ele não pode
  ser excluído.
- Os códigos são um idioma de duas ou três letras minúsculas, opcionalmente seguido de
  subtags: `en`, `fr`, `pt-BR`, `zh-Hans`.

:::caution
Excluir um idioma também exclui todas as versões escritas nele.
:::

## Tipos de conteúdo localizados

Um tipo de conteúdo é localizado quando o seu schema diz isso. Cada documento passa a ter uma
versão por idioma, e todas compartilham o `documentId`:

```json title="schema/content-types/article.json (excerpt)"
{
  "kind": "collectionType",
  "singularName": "article",
  "pluralName": "articles",
  "displayName": "Article",
  "options": { "draftAndPublish": true },
  "pluginOptions": { "i18n": { "localized": true } },
  "attributes": {
    "title": { "type": "string", "required": true },
    "readingTime": { "type": "integer", "pluginOptions": { "i18n": { "localized": false } } }
  }
}
```

Com [rascunho e publicação](/pt-br/concepts/draft-and-publish/), cada idioma tem o seu próprio
rascunho e a sua própria versão publicada, então uma tradução em francês pode ser publicada
antes ou depois do texto em inglês. Os tipos sem `pluginOptions.i18n.localized` não são
localizados e ignoram os parâmetros `locale`.

## O que é localizado

Em um tipo localizado, todo atributo é localizado, a menos que diga
`"pluginOptions": { "i18n": { "localized": false } }`. Esse campo **compartilhado** tem um único
valor para o documento inteiro:

- Salvar um campo compartilhado em um idioma o escreve nos rascunhos de todos os idiomas.
- Publicar um idioma copia os seus campos compartilhados para as versões publicadas dos outros
  idiomas.
- Isso também vale para relações e mídia: uma relação compartilhada vincula os mesmos
  documentos em todos os idiomas.

Os campos de sistema seguem a versão: cada idioma tem os seus próprios `createdAt`, `updatedAt`
e `publishedAt`. Os valores `unique` e `uid` são únicos por idioma, então duas traduções podem
ter o mesmo slug.

## Relações entre tipos localizados

As relações vinculam documentos, não versões (veja
[Relações](/pt-br/concepts/relations/#vinculadas-pelo-documento-não-pela-linha)), então o idioma
é escolhido na leitura:

- Quando os dois tipos são localizados, o artigo em francês mostra a versão em francês da sua
  categoria. Os filtros pela relação correspondem no mesmo idioma.
- Quando o tipo de destino não é localizado, todos os idiomas veem o mesmo destino.

## Como escolher um idioma nas APIs

O REST e a API de administração recebem `locale` como parâmetro de consulta, no formato do
Strapi v5; o GraphQL recebe um argumento `locale`:

```http
GET /api/articles?locale=fr
PUT /api/articles/{documentId}?locale=fr
DELETE /api/articles/{documentId}?locale=fr
```

```graphql
query {
  articles(locale: "fr") {
    documentId
    title
  }
}
```

- Sem `locale`, as requisições leem e escrevem no idioma padrão.
- Um `PUT` em um idioma que o documento ainda não tem cria essa versão.
- Um `DELETE` remove apenas a versão no idioma solicitado. Os vínculos que apontam para o
  documento são removidos quando não resta nenhum idioma.
- As respostas REST dos tipos localizados incluem `locale`. Um idioma desconhecido é um erro
  `400`.
- Os payloads de webhook, os eventos de tempo real e o histórico de conteúdo registram o idioma
  da versão que mudou.

## Permissões por idioma

As funções de administração podem limitar as permissões de conteúdo a alguns idiomas, para que
um editor de francês só possa ler ou alterar as versões em francês. Veja
[Permissões](/pt-br/concepts/permissions/#permissões-de-campo-e-de-idioma). As permissões da API
de conteúdo (acesso público, tokens de API, funções de usuários finais) valem para todos os
idiomas.

## Comparação com o Strapi

O modelo e os parâmetros correspondem ao i18n do Strapi v5: tipos localizados, campos
`localized: false`, `?locale=` e o idioma padrão. No Verdin, o i18n faz parte do núcleo e está
sempre ativo: você o ativa por tipo de conteúdo no schema.
