---
title: "Permissões"
description: "A visão geral do controle de acesso no Verdin: funções de administração e RBAC com permissões de campo e de idioma, a função pública, os tokens de API e as funções de usuários finais."
sidebar:
  order: 6
---

O Verdin controla dois públicos separadamente: os **administradores**, que fazem login no
painel de administração, e os **clientes da API de conteúdo**, que leem e escrevem conteúdo a
partir dos seus sites e apps. Esta página explica como cada um é autorizado e como as peças se
encaixam. A lista completa de ações está na
[referência de permissões](/pt-br/reference/permissions/).

| Quem | Autentica-se com | As permissões vêm de | Vale para |
| --- | --- | --- | --- |
| Administrador | E-mail e senha (mais um segundo fator ou SSO) | As suas [funções](#funções-de-administração) | Painel de administração e [API de administração](/pt-br/api/admin/) |
| Cliente anônimo | Nenhum cabeçalho `Authorization` | [Acesso público](#acesso-público) | REST, GraphQL, tempo real |
| Servidor ou build | `Authorization: Bearer vd_…` | O tipo do [token de API](#tokens-de-api) | REST, GraphQL, tempo real |
| Usuário final com login | `Authorization: Bearer <JWT>` | A sua [função de usuário final](#usuários-finais) | REST, GraphQL, tempo real |

Tudo vem fechado por padrão: a API de conteúdo responde `403` até você conceder acesso, e um
administrador só pode fazer o que as suas funções permitem.

## Funções de administração

Um administrador tem uma ou mais funções; as permissões delas se somam. Três funções vêm
integradas:

| Função | Pode |
| --- | --- |
| **Super Admin** | Tudo, incluindo usuários, funções e tokens de API. Não pode ser editada. |
| **Editor** | Ler, criar, atualizar, excluir e publicar todo o conteúdo; usar a biblioteca de mídia; disparar deploys; gerenciar SEO, redirecionamentos, menus e formulários. |
| **Author** | Criar conteúdo e ler, atualizar e excluir apenas as entradas que criou. Não pode publicar. Envia arquivos e edita ou exclui apenas os seus. |

Você cria outras funções em **Configurações → Funções** (permissão `roles.manage`). O último
Super Admin ativo não pode ser desativado, excluído nem rebaixado, então a instância nunca fica
trancada. Uma função também pode exigir que os seus membros configurem a
[autenticação de dois fatores](/pt-br/guides/auth/two-factor/): até fazerem isso, eles só
conseguem acessar o seu perfil.

### O que é uma permissão

Uma permissão é uma **ação**, um **assunto** para as ações de conteúdo e **condições**
opcionais:

- **Ações de conteúdo**: `content.read`, `content.create`, `content.update`,
  `content.delete` e `content.publish`, em um tipo de conteúdo (`api::article`) ou em todos
  (`*`).
- **Ações de mídia**: `media.read`, `media.create`, `media.update` e `media.delete`, para a
  biblioteca de mídia.
- **Ações de configurações**, como `users.manage`, `tokens.manage`, `webhooks.manage` ou
  `features.manage`, que abrem as páginas correspondentes de **Configurações**.
- **Condições**: `is-creator` limita uma permissão de conteúdo ou de mídia ao que o
  administrador criou. É assim que a função Author funciona.

As condições passam a fazer parte da consulta ao banco de dados: uma lista filtrada por
`is-creator` conta e pagina corretamente, em vez de esconder linhas depois.

### Permissões de campo e de idioma

As permissões de conteúdo podem ser restringidas ainda mais:

- **Campos.** `content.read`, `content.create` e `content.update` podem listar os atributos que
  cobrem. Os campos fora da lista ficam ocultos nas leituras (incluindo busca, filtros,
  ordenação e entradas relacionadas) e são rejeitados nas escritas.
- **Idiomas.** Nos [tipos localizados](/pt-br/concepts/internationalization/), as permissões de
  conteúdo podem listar os idiomas que cobrem. As versões em outros idiomas não podem ser lidas
  nem alteradas.

As duas são definidas por tipo de conteúdo no editor da função, em **Campos** e **Idiomas**.

## API de conteúdo

Os clientes da API de conteúdo são verificados contra permissões: uma **ação** sobre um
**assunto**.

| Ação | Permite |
| --- | --- |
| `find` | Listar documentos (`GET /api/articles`) ou ler um single type. |
| `findOne` | Ler um documento (`GET /api/articles/{documentId}`). |
| `create` | `POST` |
| `update` | `PUT` |
| `delete` | `DELETE` |
| `publish` | As rotas `actions/publish`, `actions/unpublish` e `actions/discard-draft`. |
| `readDrafts` | Ler com `status=draft`. |

Os assuntos são os tipos de conteúdo, a biblioteca de mídia (`plugin::upload`) e as contas de
usuários finais (`plugin::users-permissions.user`) quando os
[usuários finais](/pt-br/guides/auth/end-users/) estão ativados.

Algumas regras valem para qualquer cliente:

- Ler rascunhos exige `readDrafts` além de `find` ou `findOne`. Uma permissão que lê o conteúdo
  do seu site não consegue ler trabalho não publicado por acidente.
- Popular, filtrar ou ordenar por uma relação exige acesso de leitura ao tipo de destino.
- Os campos `private` nunca são retornados, quaisquer que sejam as permissões.
- Uma escrita retorna o documento escrito mesmo sem `find`, como no Strapi.
- As mesmas permissões valem para o [GraphQL](/pt-br/api/graphql/) e para o
  [stream de tempo real](/pt-br/api/realtime/).

### Acesso público

As requisições sem cabeçalho `Authorization` recebem as permissões de
**Configurações → Acesso público**. Nada é concedido por padrão. As escolhas típicas são `find`
e `findOne` nos tipos que o seu site mostra.

### Tokens de API

Os tokens de API são para servidores, etapas de build e scripts. Crie-os em
**Configurações → Tokens de API** (permissão `tokens.manage`):

| Tipo | Permissões |
| --- | --- |
| **Somente leitura** | `find` e `findOne` em todos os tipos. Nunca rascunhos. |
| **Acesso total** | Todas as ações em todos os tipos, rascunhos incluídos. |
| **Personalizado** | As permissões que você escolher, como no acesso público. |

- Um token começa com `vd_`. O seu segredo é exibido uma única vez, quando é criado ou
  regenerado; o Verdin guarda apenas um hash com chave dele.
- Os tokens podem expirar. Um token desconhecido, expirado ou malformado é um `401`: ele nunca
  recai para o acesso público.
- Qualquer token válido pode ler o documento OpenAPI em `/api/_openapi.json`, a menos que você
  torne a documentação pública.

Veja [Tokens de API](/pt-br/guides/auth/api-tokens/) para criá-los e rotacioná-los.

### Usuários finais

Os usuários finais são as pessoas que fazem login no seu site ou app, como no plugin
users-permissions do Strapi. O recurso vem desativado por padrão. Cada conta tem uma função:

- **Public** é a função das requisições sem token: as suas permissões são as de
  **Configurações → Acesso público**.
- **Authenticated** é atribuída às novas contas por padrão.
- As funções personalizadas têm qualquer conjunto de permissões, com as mesmas ações acima.

Um usuário final envia o JWT que recebeu no login como `Authorization: Bearer <jwt>`. O Verdin
o distingue dos tokens de API pelo prefixo `vd_`. Veja
[Usuários finais](/pt-br/guides/auth/end-users/).

## Comparação com o Strapi

O modelo segue o Strapi v5: RBAC de administração com condições `is-creator` e uma API de
conteúdo com acesso público, tokens de API e funções do users-permissions. As diferenças:

- Todos os recursos estão disponíveis para todos os projetos: funções personalizadas,
  permissões de campo e de idioma, [SSO](/pt-br/guides/auth/sso/) e
  [logs de auditoria](/pt-br/guides/content/audit-logs/).
- Ler rascunhos pela API de conteúdo é uma permissão própria, `readDrafts`.
- Publicar via REST tem a sua própria permissão, `publish`, e as suas próprias rotas.
