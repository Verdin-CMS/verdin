---
title: O que é o Verdin
description: O Verdin é um CMS headless open source escrito em Rust, com APIs de conteúdo compatíveis com o Strapi v5 e um painel de administração em um único binário.
sidebar:
  order: 1
  label: Introdução
---

O Verdin é um CMS headless open source escrito em Rust. Você modela os tipos de conteúdo, os
seus editores escrevem e publicam em um painel de administração, e os seus sites e apps leem o
conteúdo por uma API REST ou GraphQL. O Verdin não renderiza páginas: isso fica com o seu
frontend.

Ele é uma reescrita do [Strapi v5](https://strapi.io): o formato do schema e a API de conteúdo
têm o mesmo formato, então um projeto Strapi e o seu frontend podem ser migrados com poucas
mudanças.

## Para quem é

- **Desenvolvedores que constroem um site ou um app** e querem um CMS que possam rodar como um
  único processo, com o modelo de conteúdo no git e legível a partir de qualquer frontend: Astro,
  Next.js, um app mobile.
- **Equipes que usam o Strapi** e querem a mesma API com um consumo menor, ou precisam de
  recursos que o Strapi reserva aos planos pagos. O Verdin não tem edição enterprise: SSO, logs
  de auditoria, fluxos de revisão e lançamentos fazem parte do projeto open source.
- **Editores**, que ganham rascunhos, publicação, histórico e pré-visualizações em um painel de
  administração disponível em 18 idiomas.

## O que vem na caixa

Um único executável, o `verdin`, é o servidor, a ferramenta de linha de comando e o painel de
administração. Não há runtime Node.js nem `node_modules` em produção.

| Área | O que você ganha |
| --- | --- |
| Bancos de dados | PostgreSQL 14+, MySQL 8.4+, MariaDB 10.11+ e SQLite, cobertos pela mesma suíte de testes. |
| Modelo de conteúdo | Collection types, single types, componentes, zonas dinâmicas, relações, mídia, rich text em Markdown ou no formato de blocks do Strapi. O schema são arquivos JSON no seu projeto. |
| Alterações de schema | Cada alteração vira um plano de migração com um nível de risco e o SQL exato. Os passos destrutivos só rodam quando você permite. |
| APIs | REST em `/api` com os parâmetros do Strapi v5 (`filters`, `populate`, `sort`, `pagination`), um endpoint GraphQL opcional, um documento OpenAPI e um cliente TypeScript tipado. |
| Edição | Rascunho e publicação, conteúdo localizado, histórico de conteúdo, lançamentos, fluxos de revisão, comentários e tarefas, presença ao vivo, pré-visualização e edição visual no seu próprio site. |
| Acesso | Funções de administração que chegam a campos e idiomas, tokens de API, permissões de acesso público, SSO com OpenID Connect, login em dois fatores com chaves de acesso, logs de auditoria. |
| Recursos de site | Busca full-text, sitemap, redirecionamentos, menus e formulários, webhooks, atualizações em tempo real. |
| Extensão | Plugins WebAssembly que se conectam às escritas, adicionam rotas e jobs e trazem widgets de administração e campos personalizados, limitados às capacidades que declaram. |

## Como ele se relaciona com o Strapi v5

**Igual:**

- Os arquivos de schema usam o formato do Strapi: `schema/content-types/<singularName>.json` e
  `schema/components/<category>/<name>.json`.
- A API de conteúdo REST: as rotas, o formato de resposta plano com `documentId`, os parâmetros
  de consulta e os operadores, a semântica de escrita (um `POST` ou `PUT` publica, a menos que
  você passe `?status=draft`), os corpos de erro.
- O schema GraphQL tem o formato do plugin GraphQL do Strapi v5.
- Os usuários finais (cadastro, login, OAuth, funções) seguem a API do `users-permissions`.

**Diferente:**

- **As alterações de schema são migrações planejadas.** O Verdin compara os arquivos de schema
  com o banco de dados e mostra os passos antes de executá-los. O `verdin start` se recusa a
  rodar enquanto o banco de dados estiver atrás do schema.
- **O construtor de tipos de conteúdo roda apenas no modo de desenvolvimento.** Em produção, o
  schema vem do seu repositório.
- **Os plugins são WebAssembly, não JavaScript.** Os plugins do Strapi, e os controllers, services
  ou arquivos de lifecycle personalizados em `src/`, não rodam no Verdin.
- **O banco de dados não é compartilhado com o Strapi.** Você traz um projeto Strapi com
  `verdin import strapi`, que dá um novo id a cada documento.
- **Alguns extras em relação ao REST**: as ações de publicar e despublicar
  (`POST /api/<route>/<documentId>/actions/publish`), e um componente populado volta inteiro,
  com os componentes aninhados.

A [compatibilidade com o Strapi](/pt-br/migrate/compatibility/) lista as diferenças em detalhe.

## Quando não usá-lo

- **Você depende de plugins do Strapi ou de código de servidor personalizado em JavaScript.** O
  Verdin não consegue rodá-los; você teria que reescrevê-los como plugins WebAssembly ou mover a
  lógica para outro lugar.
- **Você precisa de uma 1.0 estável.** O Verdin está na 0.10: as versões minor ainda podem mudar a
  configuração e o comportamento. Leia [Atualização](/pt-br/migrate/upgrading/) antes de cada uma.
- **Você quer que o CMS renderize as suas páginas.** O Verdin é headless; combine-o com um
  framework de frontend ou um gerador de sites estáticos.
- **Você quer um serviço gerenciado.** O Verdin é auto-hospedado: você roda o binário ou a imagem
  Docker na sua própria infraestrutura.

## Próximos passos

- [Início rápido](/pt-br/start/quickstart/): rode o Verdin e leia a sua primeira entrada pela API.
- [Tutorial: um blog com Astro](/pt-br/start/tutorial-astro/) ou
  [com Next.js](/pt-br/start/tutorial-nextjs/): construa um frontend para o blog de exemplo.
- [Modelo de conteúdo](/pt-br/concepts/content-model/): os tipos de conteúdo, os campos e como são
  armazenados.
- [Importação de um projeto Strapi](/pt-br/migrate/from-strapi/): traga um projeto existente.
