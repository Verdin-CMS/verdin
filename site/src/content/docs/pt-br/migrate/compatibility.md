---
title: Compatibilidade com o Strapi
description: Quais recursos e APIs do Strapi v5 o Verdin suporta, suporta em parte ou não suporta — REST, GraphQL, usuários e permissões, uploads, i18n, rascunho e publicação, extensões de código, o painel de administração e os recursos Enterprise.
sidebar:
  order: 3
---

O Verdin mantém o modelo de conteúdo e as APIs de conteúdo do Strapi v5 para que os frontends e o
conteúdo possam ser migrados (veja [Migração a partir do Strapi](/pt-br/migrate/from-strapi/)).
Ele não é um substituto direto para uma *base de código* Strapi: não há runtime JavaScript, então
o código personalizado é reconstruído como plugins WebAssembly. Esta página lista cada área com o
seu status, conforme o Verdin 0.10.0.

**Suportado** funciona como no Strapi v5 (as diferenças são indicadas). **Parcial** cobre os
casos comuns; a observação diz o que falta. **Não suportado** não tem equivalente.

## Modelo de conteúdo

| Recurso | Status | Observações |
| --- | --- | --- |
| Collection types e single types | Suportado | Arquivos de schema JSON próximos dos do Strapi (`schema/content-types/*.json`). Veja [Modelo de conteúdo](/pt-br/concepts/content-model/). |
| Tipos de atributos escalares | Suportado | `string`, `text`, `richtext` (Markdown), `blocks`, `email`, `uid`, `integer`, `biginteger`, `float`, `decimal`, `boolean`, `date`, `time`, `datetime`, `enumeration`, `json`, `password`. O `timestamp` do Strapi é importado como `datetime`. |
| Componentes e zonas dinâmicas | Suportado | Incluindo mídia e relações `oneWay`/`manyWay` dentro de componentes. |
| Relações | Suportado | One/many-to-one/many, one-way e many-way, e as polimórficas `morphToOne`, `morphToMany`, `morphOne`, `morphMany`. |
| Campos de mídia | Suportado | Simples ou múltiplos, `allowedTypes`. |
| `unique` | Parcial | Não nos atributos `text`, `richtext`, `blocks` e `json`. |
| Campos condicionais (`conditions`) | Suportado | As condições JSON Logic do Strapi 5.17; os campos ocultos não são obrigatórios. |
| Campos personalizados | Parcial | Os atributos `customField` funcionam; o input da administração vem de um [plugin](/pt-br/extending/plugins/) do Verdin, não dos plugins React do Strapi. |
| Construtor de tipos de conteúdo | Suportado | Apenas no modo de desenvolvimento (`verdin dev`), como no Strapi. |

## API REST

| Recurso | Status | Observações |
| --- | --- | --- |
| Rotas CRUD | Suportado | `GET`/`POST /api/{pluralName}`, `GET`/`PUT`/`DELETE /api/{pluralName}/{documentId}`, single types em `/api/{singularName}`. As respostas trazem `data` e `meta`, e os erros o objeto `error` do Strapi. |
| `filters` | Suportado | Todos os operadores do Strapi: `$eq`, `$eqi`, `$ne`, `$nei`, `$lt`, `$lte`, `$gt`, `$gte`, `$in`, `$notIn`, `$contains`, `$notContains`, `$containsi`, `$notContainsi`, `$null`, `$notNull`, `$between`, `$startsWith(i)`, `$endsWith(i)`, `$and`, `$or`, `$not`; por relações, componentes, componentes repetíveis e zonas dinâmicas (`__component`). |
| `sort` | Suportado | Vários campos, `:asc`/`:desc` e o campo de uma relação to-one (`author.name:asc`). |
| `pagination` | Suportado | `page`/`pageSize` ou `start`/`limit`, `withCount`. O `pageSize` é limitado a `[api].max_page_size` (100). |
| `fields` | Suportado | |
| `populate` | Suportado | `*`, listas, objetos aninhados, `on` para as zonas dinâmicas, `count`. Profundidade até 5; no máximo 1.000 entradas populadas por relação. |
| `status` | Suportado | `published` (padrão) ou `draft`; ler rascunhos exige a permissão `readDrafts`. |
| `locale` | Suportado | Veja o i18n abaixo. |
| `hasPublishedVersion` | Suportado | |
| Busca full-text `_q` | Suportado | `$containsi` sobre os campos de texto, como no Strapi; busca ordenada por relevância com `[search]`. |
| Escritas de relações | Suportado | IDs, `connect` / `disconnect` / `set`, com `position` (`before`, `after`, `start`, `end`). |
| Publicar, despublicar, descartar rascunho | Suportado | As escritas publicam, a menos que `?status=draft`, como no Strapi v5. O Verdin adiciona `POST /api/{pluralName}/{documentId}/actions/{publish,unpublish,discard-draft}`. |
| Formato de resposta do Strapi v4 e `publicationState` | Não suportado | O Verdin fala apenas a v5: atributos planos, `documentId`, `status`. |
| Documento OpenAPI | Parcial | Em `/api/_openapi.json` (apenas com token por padrão) e uma referência interativa em `/api/docs`, em vez do `/documentation` do plugin de documentação. |

## GraphQL

| Recurso | Status | Observações |
| --- | --- | --- |
| Queries | Suportado | `articles`, `articles_connection` com `pageInfo`, `article(documentId)`, single types; `filters`, `sort`, `pagination`, `status`, `locale`. Desativado até você ativar **Configurações → Recursos → GraphQL**. |
| Mutations | Suportado | `create…`, `update…`, `delete…` com `status` e `locale`. |
| Componentes, zonas dinâmicas, mídia | Suportado | As zonas dinâmicas como unions, a mídia como `UploadFile`. |
| Relações polimórficas | Parcial | Retornadas como JSON, não como unions tipadas. |
| Shadow CRUD (desativar operações por tipo) | Suportado | A configuração `disabled` do recurso. |
| Resolvers personalizados e extensões do schema | Parcial | Campos raiz resolvidos por plugins (`[[graphql]]` no `plugin.toml`); sem `extensionService`. |
| Mutations do Users & Permissions (`login`, `register`, `me`…) | Não suportado | Use as rotas REST. |
| Queries/mutations de upload e de i18n (`uploadFiles`, `i18NLocales`…) | Não suportado | Use as rotas REST (`GET /api/i18n/locales`) e o painel de administração. `localizations` nos tipos localizados é suportado. |
| Limites, GraphiQL | Suportado | Interruptores de `maxDepth`, `maxComplexity`, introspecção e playground. |

## Users & Permissions (usuários finais)

Ative **Configurações → Recursos → Usuários e permissões**. Veja
[Usuários finais](/pt-br/guides/auth/end-users/).

| Recurso | Status | Observações |
| --- | --- | --- |
| `POST /api/auth/local`, `/auth/local/register` | Suportado | Os mesmos formatos de requisição e de resposta. |
| Confirmação de e-mail, esqueci/redefinir/mudar a senha | Suportado | `/auth/email-confirmation`, `/auth/send-email-confirmation`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/change-password`. |
| Tokens de renovação | Suportado | `jwtManagement: "refresh"`, `/auth/refresh`, `/auth/logout`. |
| `/api/users`, `/users/me`, `/users/count` | Suportado | JSON simples, permissões em `plugin::users-permissions.user`. |
| Provedores OAuth | Parcial | GitHub, Google, Microsoft, Discord, Facebook, GitLab, LinkedIn e qualquer provedor OAuth 2; nem todos os presets do Strapi. |
| Rotas de funções e permissões (`/api/users-permissions/roles`, `/permissions`) | Não suportado | Gerencie as funções em **Configurações → Usuários finais**. |
| Usuários importados | Suportado | Os hashes bcrypt continuam funcionando; eles são refeitos com Argon2id no login. |

## Biblioteca de mídia e API de upload

| Recurso | Status | Observações |
| --- | --- | --- |
| `POST /api/upload` | Suportado | `files` e `fileInfo` em multipart; `?id=` atualiza as informações de um arquivo, ou substitui o arquivo quando um é enviado. |
| Vínculo no upload (`ref`, `refId`, `field`) | Não suportado | Envie o arquivo e depois defina o campo de mídia com o id do arquivo. |
| `GET /api/upload/files`, `/files/{id}`, `DELETE /files/{id}` | Parcial | A listagem aceita apenas `pagination[page]`, `pagination[pageSize]`, `sort` e `filters[name][$containsi]`. |
| Formatos responsivos, breakpoints | Suportado | `thumbnail` mais `[upload].breakpoints`. |
| Pastas, pontos focais, texto alternativo, legendas | Suportado | |
| Provedores de upload | Parcial | Disco local e armazenamento compatível com S3 (AWS, R2, B2, MinIO, Tigris…). Sem Cloudinary nem outros pacotes de provedores. |
| Transformações de imagem | Apenas no Verdin | `/uploads/<file>?preset=…` e URLs assinadas (provedor local). |

## Internacionalização

| Recurso | Status | Observações |
| --- | --- | --- |
| Tipos localizados e campos não localizados | Suportado | `pluginOptions.i18n.localized`, também por atributo. |
| `?locale=` no REST, `locale` no GraphQL | Suportado | Um idioma desconhecido é um `400`. |
| `localizations` nas respostas | Suportado | Apenas quando populado (`populate=localizations`, `populate=*`), com as mesmas opções de uma relação. Também é um campo GraphQL. A API de administração não o inclui. |
| `GET /api/i18n/locales` | Suportado | Um array simples no formato do Strapi. Exige `find` em `plugin::i18n.locale` (linha **Idiomas** da grade de permissões), como o `listLocales` do Strapi. O `documentId` é derivado do código do idioma. Os idiomas são gerenciados na administração (**Configurações → Internacionalização**). |

## Rascunho e publicação

| Recurso | Status | Observações |
| --- | --- | --- |
| Versões de rascunho e publicada por documento | Suportado | Por idioma. Veja [Rascunho e publicação](/pt-br/concepts/draft-and-publish/). |
| Descartar rascunho | Suportado | |
| Publicação agendada | Suportado | Por meio dos [Lançamentos](/pt-br/guides/content/releases/). |

## Personalização do servidor

Veja [Portar código personalizado](/pt-br/migrate/porting-custom-code/) para saber como mover cada um destes.

| Strapi | Status | Verdin |
| --- | --- | --- |
| Lifecycle hooks, middlewares do Document Service | Parcial | Hooks before/after em plugins WebAssembly, que podem alterar ou recusar uma escrita. Sem JavaScript. |
| Controllers, services e rotas personalizados | Parcial | Rotas de plugins em `/api/plugins/<name>/`. |
| Policies e middlewares | Não suportado | As permissões e os limites de taxa vêm integrados. |
| `register` / `bootstrap` | Parcial | A função de inicialização de um plugin, executada quando o plugin inicia, é ativado ou tem as configurações alteradas; pode popular conteúdo e substituir as permissões da função pública. |
| Tarefas cron | Parcial | Jobs de plugins. |
| Document Service / Entity Service em JavaScript | Não suportado | Sem runtime JavaScript. |
| Plugins npm do marketplace do Strapi | Não suportado | |
| Webhooks | Suportado | Assinados, tentados de novo e registrados; `entry.draft-discard` é `entry.discard-draft`. Veja [Webhooks](/pt-br/guides/integrations/webhooks/). |
| Tokens de API (somente leitura, acesso total, personalizado) | Suportado | Os mesmos tipos, expiração opcional, regeneração. |
| Transfer tokens, `strapi transfer` | Não suportado | Use `verdin export` e `verdin import verdin`. |
| Arquivos do `strapi export` | Suportado (importação) | `verdin import strapi`; as exportações criptografadas não são lidas. |
| `config/*.js`, `.env` | Parcial | `verdin.toml` e variáveis de ambiente. |
| Tipos TypeScript | Suportado | `verdin types`. |
| Provedores de e-mail | Parcial | SMTP, Resend e Postmark. |

## Painel de administração

| Recurso | Status | Observações |
| --- | --- | --- |
| Gerenciador de conteúdo, biblioteca de mídia, construtor de tipos de conteúdo | Suportado | Um painel Angular próprio, não o admin React do Strapi. |
| Usuários administradores, funções, funções personalizadas | Suportado | Super Admin, Editor e Author integrados, mais as funções personalizadas. |
| Permissões por campo e por idioma | Suportado | |
| Condições de RBAC | Parcial | Apenas a condição integrada `is-creator`; sem condições personalizadas. |
| Personalização da administração (`src/admin/app`) | Parcial | Logo, favicon, título, cor de destaque e textos em `[admin.branding]`; widgets e campos personalizados a partir de plugins. Sem páginas personalizadas, injection zones nem extensões React. |
| API de administração (`/admin/…`) | Não suportado | A API de administração do Verdin é própria; não construa sobre a do Strapi. |
| Configuração da tela de edição e da visualização em lista | Suportado | |

## Recursos Enterprise

Tudo no Verdin é open source; estes são recursos Enterprise ou pagos no Strapi.

| Recurso do Strapi | Status | Observações |
| --- | --- | --- |
| SSO | Parcial | Provedores OpenID Connect, com mapeamento de grupos para funções. Sem SAML nem outras estratégias do passport. Veja [Login único](/pt-br/guides/auth/sso/). |
| Logs de auditoria | Suportado | Veja [Logs de auditoria](/pt-br/guides/content/audit-logs/). |
| Fluxos de revisão | Suportado | As funções por etapa limitam quem move as entradas *para dentro de* uma etapa, e uma etapa de publicação exigida vale para todas as APIs. Veja [Fluxos de revisão](/pt-br/guides/content/review-workflows/). |
| Lançamentos | Suportado | Agendados ou imediatos. |
| Histórico de conteúdo | Suportado | `[history].max_versions` versões por documento. |
| Pré-visualização e pré-visualização ao vivo | Suportado | URLs de pré-visualização com tokens de curta duração, pré-visualização lado a lado e [edição visual](/pt-br/guides/frontend/visual-editing/). |
| Funções de administração personalizadas | Suportado | Sem limite de quantidade. |
