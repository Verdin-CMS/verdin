---
title: "API de administração"
description: "A API por trás do painel de administração do Verdin, para automação: login, sessões, convenções e os principais grupos de rotas."
sidebar:
  order: 4
  label: "Administração"
---

O painel de administração é um cliente da API de administração, servida em `{admin.path}/api`
(`/admin/api` por padrão). Tudo o que o painel faz, um script também pode fazer: criar
administradores e tokens de API, configurar webhooks e recursos, gerenciar idiomas ou
trabalhar com rascunhos e lançamentos. Esta página explica como se autenticar e lista os
grupos de rotas.

:::caution[Estabilidade]
A API de administração não tem garantia de estabilidade antes do Verdin 1.0: rotas e corpos
podem mudar em versões minor, e o changelog não lista todas as mudanças. Para ler e escrever
conteúdo, prefira a API [REST](/pt-br/api/rest/) ou [GraphQL](/pt-br/api/graphql/) com um
[token de API](/pt-br/guides/auth/api-tokens/). Um contrato de estabilidade para todas as APIs
está planejado para a 1.0.
:::

## Login

A API de administração ainda não tem tokens de API: um script faz login como um usuário
administrador, de preferência um cuja função permita apenas o que o script precisa.

```sh title="Terminal"
curl -s -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"bot@example.com","password":"…"}'
```

```json
{
  "data": {
    "user": { "id": 3, "email": "bot@example.com", "…": "…" },
    "accessToken": "eyJhbGciOiJIUzI1NiIs…",
    "accessTokenExpiresAt": "2026-09-29T10:15:00.000Z"
  }
}
```

Envie o token de acesso em todas as outras requisições:

```sh title="Terminal"
curl -H "Authorization: Bearer $ACCESS_TOKEN" 'https://cms.example.com/admin/api/system/info'
```

| Credencial | Duração | Onde |
| --- | --- | --- |
| Token de acesso (JWT) | 15 minutos | O corpo da resposta. Envie-o como `Authorization: Bearer …`. |
| Token de renovação | 30 dias | O cookie `verdin_refresh` (`HttpOnly`, `SameSite=Strict`, caminho `/admin/api/auth`, `Secure` com `verdin start`). |

Para obter um novo token de acesso, chame `POST /admin/api/auth/refresh` com o cookie e um
cabeçalho `X-Verdin-CSRF` (qualquer valor). A resposta é igual à de um login e o token de
renovação é rotacionado: guarde o novo cookie, porque apresentar de novo um token de renovação
já usado encerra a sessão inteira. `POST /admin/api/auth/logout`, com o mesmo cabeçalho,
encerra a sessão.

```sh title="Terminal"
curl -s -b cookies.txt -c cookies.txt -X POST 'https://cms.example.com/admin/api/auth/refresh' \
  -H 'X-Verdin-CSRF: 1'
```

- **Autenticação de dois fatores.** Para uma conta com segundo fator, o login responde
  `{ "data": { "twoFactorRequired": true, "twoFactorToken": "…", "methods": ["totp"] } }`.
  Conclua com `POST /admin/api/auth/login/two-factor` e
  `{ "twoFactorToken": "…", "code": "123456" }` (um código TOTP ou de recuperação). Veja
  [Autenticação de dois fatores](/pt-br/guides/auth/two-factor/).
- **Limites de taxa.** Login e cadastro são limitados por IP do cliente por
  `[admin].auth_rate_limit` (20 por minuto por padrão); as renovações têm uma cota maior.
- **Falhas.** Credenciais erradas, contas desconhecidas e contas bloqueadas respondem todas
  `400 Invalid credentials`. Cinco senhas erradas bloqueiam a conta por 15 minutos.
- **Primeiro administrador.** Em uma instância nova, `POST /admin/api/auth/register-first-admin`
  cria o Super Admin; só funciona enquanto não existir nenhum administrador. `verdin admin create`
  faz o mesmo pela linha de comando.

## Convenções

- Corpos e respostas são JSON. As respostas envolvem o resultado em `data`
  (`{ "data": … }`); as rotas de conteúdo também retornam `meta`, como a API REST.
- As rotas de conteúdo recebem corpos `{ "data": { … } }`, como a API REST. As rotas de
  configurações recebem objetos JSON simples.
- Os erros têm o [formato de erro do REST](/pt-br/api/rest/#erros). Uma rota de um recurso
  desativado responde `404`. Um administrador cuja função exige autenticação de dois fatores
  recebe `403 TwoFactorRequiredError` até configurá-la.
- Cada rota verifica as [permissões](/pt-br/concepts/permissions/) do administrador: as rotas
  de conteúdo verificam as ações de conteúdo sobre o tipo; as rotas de configurações, a ação de
  configurações correspondente.
- A API de administração nunca responde a requisições cross-origin: chame-a de um servidor ou
  de um script, não das páginas de outro site.
- As alterações bem-sucedidas ficam registradas no [log de auditoria](/pt-br/guides/content/audit-logs/).

## Grupos de rotas

Os caminhos são relativos a `/admin/api`. Os routers estão em
[`crates/verdin-api/src/admin.rs`](https://github.com/Verdin-CMS/verdin/blob/main/crates/verdin-api/src/admin.rs)
e nos módulos `*_admin.rs` ao lado.

| Grupo | Rotas | Permissão |
| --- | --- | --- |
| Login e conta | `GET /auth/status`, `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `GET\|PUT /users/me`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, convites e redefinição de senha em `/auth/*` | Com login (as rotas de login são públicas) |
| Dois fatores | `/auth/two-factor/*`, `POST /auth/login/two-factor`, `POST /auth/login/passkey/options`, `DELETE /users/{id}/two-factor` | Com login; `users.manage` para redefinir outro administrador |
| SSO | `GET /auth/sso`, `GET /auth/sso/{id}`, `GET /auth/sso/{id}/callback` | Pública |
| Usuários administradores | `GET\|POST /users`, `GET\|PUT\|DELETE /users/{id}`, `POST /users/{id}/invite` | `users.manage` |
| Funções e acesso público | `GET\|POST /roles`, `GET\|PUT\|DELETE /roles/{id}`, `GET\|PUT /public-permissions` | `roles.manage` |
| Tokens de API | `GET\|POST /api-tokens`, `GET\|PUT\|DELETE /api-tokens/{id}`, `POST /api-tokens/{id}/regenerate` | `tokens.manage` |
| Schema | `GET /content-types`, `GET /components`, `GET\|PUT\|DELETE /content-types/{uid}/edit-view`; `GET /schema`, `POST /schema/plan`, `POST /schema/apply` apenas em `verdin dev` | Com login; `views.manage` para as telas de edição; `schema.manage` para o construtor |
| Conteúdo | `GET\|POST /content/{uid}`, `GET\|PUT\|DELETE /content/{uid}/{documentId}`, `POST /content/{uid}/{documentId}/actions/{publish\|unpublish\|discard-draft}`, `POST …/clone`, `GET …/locales`, `GET …/usage`, `GET /content/{uid}/uid-available`, `GET /content/{uid}/stats` | Ações de conteúdo sobre `{uid}` |
| Importação e exportação | `GET /content/{uid}/export`, `POST /content/{uid}/import` | Ações de conteúdo sobre `{uid}` |
| Histórico | `GET /history/{uid}/{documentId}`, `GET /history/versions/{id}`, `POST /history/versions/{id}/restore` | Ações de conteúdo sobre o tipo |
| Lançamentos | `GET\|POST /releases`, `GET\|PUT\|DELETE /releases/{id}`, `POST /releases/{id}/actions`, `DELETE /releases/{id}/actions/{actionId}`, `POST /releases/{id}/publish` | `releases.manage` |
| Fluxos de revisão | `GET\|POST /review-workflows`, `GET\|PUT\|DELETE /review-workflows/{id}`, `GET\|PUT /content/{uid}/{documentId}/review`, `GET /review/*` | `workflows.manage` para configurar |
| Mídia | `POST /upload`, `POST /upload/from-url`, `GET /upload/files`, `GET\|PUT\|DELETE /upload/files/{id}`, `POST /upload/files/{id}/replace`, `GET /upload/files/{id}/usage`, `/upload/folders…` | `media.*` |
| Idiomas | `GET\|POST /i18n/locales`, `PUT\|DELETE /i18n/locales/{code}` | `locales.manage` para alterar |
| Webhooks | `GET\|POST /webhooks`, `GET\|PUT\|DELETE /webhooks/{id}`, `POST\|DELETE /webhooks/{id}/secret`, `POST /webhooks/{id}/trigger`, `GET /webhooks/{id}/deliveries`, `POST /webhooks/deliveries/{id}/retry` | `webhooks.manage` |
| Usuários finais | `GET\|POST /end-users`, `GET\|PUT\|DELETE /end-users/{id}`, `GET\|POST /end-user-roles`, `PUT\|DELETE /end-user-roles/{id}` | `endusers.manage` |
| Recursos | `GET /features`, `PUT /features/{id}`, `POST /email/test` | `features.manage` para alterar |
| Plugins | `GET /plugins`, `GET /plugins/extensions`, `PUT /plugins/{name}`, `GET /plugins/{name}/logs` | `plugins.manage` |
| Deploys e CDN | `/deploy/targets…`, `GET /deploy/deployments`, `GET /deploy/cdn`, `POST /deploy/cdn/purge` | `deploy.manage`; `deploy.trigger` para disparar |
| Site | `/site/redirects…`, `/site/menus…`, `/site/forms…` e envios de formulários | `site.manage` |
| Colaboração | `/comments…`, `/tasks…`, `/engagement/*`, `/polls…` | Acesso de leitura ao tipo da entrada |
| Tempo real | `GET /events`, `GET\|POST /presence` | Veja [API de tempo real](/pt-br/api/realtime/#stream-de-administração) |
| IA | `GET /ai`, `POST /ai/translate`, `/ai/alt-text`, `/ai/summarize`, `/ai/seo` | Veja [Ações de IA](/pt-br/guides/integrations/ai-actions/) |
| Logs de auditoria | `GET /audit-logs` | `audit.read` |
| Sistema | `GET /system/info` (versão, banco de dados e modo) | Com login |

## Rotas de conteúdo

As rotas de conteúdo executam o mesmo Document Service da API REST, com regras de
administração:

- `{uid}` é o UID do tipo de conteúdo, como `api::article`.
- As leituras retornam **rascunhos**, a menos que você passe `status=published`. Elas aceitam os
  [parâmetros de consulta](/pt-br/api/rest/#parâmetros-de-consulta) do REST, além de `unseen=true`
  para documentos que o administrador não abriu desde a última alteração.
- As escritas salvam apenas o rascunho. Publicar é sempre uma ação explícita.
- As escritas registram o administrador como criador ou último editor. As restrições de campo,
  de idioma e `is-creator` das funções do administrador se aplicam a leituras e escritas.

```sh title="Terminal"
curl -X PUT 'https://cms.example.com/admin/api/content/api::article/k2m7q4…?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"data":{"title":"Bonjour, Verdin"}}'
curl -X POST 'https://cms.example.com/admin/api/content/api::article/k2m7q4…/actions/publish?locale=fr' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```
