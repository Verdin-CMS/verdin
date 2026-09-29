---
title: Segurança
description: Como o Verdin protege o painel de administração, a API de conteúdo e o servidor, quais configurações endurecem uma instância de produção e como relatar uma vulnerabilidade.
sidebar:
  order: 2
---

Esta página descreve o que o Verdin faz para proteger um projeto e as configurações que você
controla. Use-a com o [checklist de produção](/pt-br/deploy/production-checklist/) ao preparar
uma instância para tráfego real.

## O que vem fechado por padrão

- **A API de conteúdo.** As requisições anônimas não recebem nada até você conceder permissões
  públicas em **Configurações → Acesso público**. Um token desconhecido, expirado ou malformado
  é um `401`, nunca uma volta à função pública. Veja [Permissões](/pt-br/concepts/permissions/).
- **O documento OpenAPI** em `/api/_openapi.json` exige um token de API válido até você torná-lo
  público em **Configurações → Recursos → Documentação da API**.
- **Os recursos opcionais**, como GraphQL, usuários finais, SSO e o servidor MCP, ficam
  desativados até que um administrador com a permissão `features.manage` os ative em
  **Configurações → Recursos**.
- **Os plugins** ficam desativados até que um administrador ative cada um em
  **Configurações → Plugins**.
- **Chamadas cross-origin de navegadores.** Nenhuma origem pode chamar qualquer API a partir de
  um navegador até você listá-la em `[api].cors_origins`.

## Login na administração

| Proteção | Detalhes |
| --- | --- |
| Hash de senhas | Argon2id com os parâmetros da OWASP, refeito quando eles mudam. |
| Sessões | Um token de acesso de 15 minutos mantido na memória da página (nunca no `localStorage`) e um token de renovação de 30 dias em um cookie `HttpOnly`, `SameSite=Strict`, limitado a `/admin/api/auth`. O token de renovação é rotacionado a cada uso; apresentar um antigo encerra a sessão inteira. |
| Cookies seguros | O cookie de renovação é `Secure` com `verdin start`. `[admin].secure_cookies = false` desativa isso e registra um aviso no log. |
| CSRF | A renovação e o logout exigem um cabeçalho `X-Verdin-CSRF`, que um formulário de outro site não consegue enviar. |
| Bloqueio | Cinco tentativas com falha bloqueiam uma conta por 15 minutos. As falhas contam tanto na etapa da senha quanto na do segundo fator. E-mails desconhecidos e senhas erradas recebem a mesma resposta, no mesmo tempo. |
| Limite de taxa | Login, cadastro e renovação: `[admin].auth_rate_limit` requisições por minuto e por endereço de cliente (20). |
| Segundo fator | Aplicativos autenticadores (TOTP) e chaves de acesso, com códigos de recuperação. Uma função pode exigi-lo (`requireTwoFactor`). Veja [Autenticação de dois fatores](/pt-br/guides/auth/two-factor/). |
| Super Admins | Somente um Super Admin pode criar, editar, excluir ou redefinir um Super Admin, ou conceder essa função. O último Super Admin ativo não pode ser removido. |

O primeiro administrador é cadastrado pelo painel enquanto não existir nenhum administrador.
Faça isso logo após a primeira inicialização, ou crie-o com `verdin admin create --email …`
antes de expor o servidor.

## Painel de administração e API de administração

- A API de administração (`/admin/api`) não envia cabeçalhos CORS, diga o que disser
  `[api].cors_origins`: os navegadores só permitem que a própria origem do painel leia as suas
  respostas.
- O painel é servido com uma Content Security Policy estrita (scripts apenas da sua própria
  origem), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` e
  `Referrer-Policy: strict-origin-when-cross-origin`.
- O Verdin não envia `Strict-Transport-Security`. Adicione-o no proxy reverso que termina o TLS.

## API de conteúdo

- **Os tokens de API** são exibidos uma única vez. O Verdin armazena um HMAC-SHA256 de cada
  token, com `VERDIN_TOKEN_PEPPER` como chave, e guarda um prefixo de 10 caracteres para
  exibição. Os tokens podem expirar e podem ser regenerados.
- **As permissões de campo e de idioma** limitam o que uma função lê e escreve, e `populate`,
  filtros por relação e ordenações por relação só alcançam os tipos que o cliente pode ler.
- **Limites de consulta**: `pageSize` até `[api].max_page_size` (100), profundidade de
  `populate` até 5, no máximo 100 condições de filtro, query strings de até 16 KB e no máximo
  1.000 entradas populadas por relação. Campos desconhecidos ou privados em uma consulta são um
  `400`.
- **O GraphQL** tem os seus próprios limites de profundidade e de complexidade (`maxDepth`,
  `maxComplexity`) e um interruptor de introspecção nas configurações do recurso.
- **Limites de taxa**: `[api].public_rate_limit` por endereço de cliente sem token e
  `[api].token_rate_limit` por token de API ou usuário final, em requisições por minuto. Os dois
  vêm desativados (`0`) por padrão. As requisições com um bearer token desconhecido são
  limitadas por endereço.

### CORS

`[api].cors_origins` lista as origens de navegador autorizadas a chamar a API de conteúdo e o
GraphQL:

```toml title="verdin.toml"
[api]
cors_origins = ["https://www.example.com", "https://preview.example.com"]
```

Cada entrada é `scheme://host[:port]`, sem caminho nem barra final; `["*"]` permite qualquer
origem e não pode ser combinado com outras. Os métodos permitidos são `GET`, `POST`, `PUT` e
`DELETE`, e os cabeçalhos de requisição permitidos são `Authorization`, `Content-Type` e
`If-None-Match`. A inicialização falha com uma entrada que não seja uma origem.

Os frontends do lado do servidor (Astro, Next.js no servidor) chamam a API sem navegador e não
precisam de entrada de CORS.

## Requisições e uploads

| Configuração | Padrão | Protege contra |
| --- | --- | --- |
| `[server].body_limit` | `"1mb"` | Corpos de requisição grandes nas APIs normais. |
| `[server].request_timeout_secs` | `30` | Requisições lentas segurando conexões. |
| `[upload].max_file_size` | 200 MB | Uploads grandes (os uploads têm o seu próprio limite em vez de `body_limit`). |
| `[upload].max_image_megapixels` | `100` | Bombas de descompressão. |

O tipo de um arquivo enviado vem dos seus bytes, não do tipo que o cliente envia; o nome do
arquivo é só um último recurso, e nunca para os tipos que os navegadores executam ativamente
(esses arquivos são armazenados como `application/octet-stream`). Os links nos `blocks` de rich
text precisam ser `http(s)`, `mailto:` ou relativos.

## Endereços dos clientes atrás de um proxy

Os limites de taxa e os logs de auditoria usam o endereço do cliente. Atrás de um proxy reverso,
toda requisição vem do proxy, então liste o proxy em `[server].trusted_proxies`:

```toml title="verdin.toml"
[server]
trusted_proxies = ["10.0.0.0/8"]   # the proxies' IPs or CIDR ranges
```

O Verdin então lê o `X-Forwarded-For` da direita para a esquerda e pega o primeiro endereço que
não seja um proxy confiável. As requisições de qualquer outro endereço mantêm o endereço da
conexão, então um cliente não consegue forjar o seu endereço enviando ele mesmo o cabeçalho. Não
liste faixas a partir das quais clientes não confiáveis possam se conectar.

## Requisições de saída

Os webhooks, os deploy hooks, os webhooks de limpeza de CDN e os uploads a partir de uma URL
fazem requisições que um administrador escolhe. Com `verdin start`, eles recusam endereços de
loopback, privados e link-local (incluindo as formas IPv6 que embutem endereços IPv4 privados),
então um administrador não consegue usá-los para alcançar serviços da sua rede interna.
`[webhooks].allow_private_networks = true` remove essa restrição; faça isso apenas quando todos
os administradores forem de confiança em relação à rede interna.

## Segredos

`VERDIN_ADMIN_JWT_SECRET` e `VERDIN_TOKEN_PEPPER` são lidos apenas do ambiente e precisam ter,
cada um, pelo menos 32 bytes (`verdin secrets` imprime valores novos). O pepper também sela os
segredos TOTP dos administradores e deriva a chave que faz o hash dos endereços de quem envia
formulários. Guarde os dois no gerenciador de segredos da sua plataforma e nunca commite o
`.env`.

Os logs de requisições escondem os valores dos parâmetros de consulta cujos nomes parecem
secretos (`token`, `code`, `password`, `key`, `signature`…) e a parte secreta das URLs de
callback de deploy.

## Métricas

`/_metrics` fica desativado, a menos que `[metrics].enabled = true`. Quando está ativado e não há
token definido, qualquer pessoa que alcance a porta pode lê-lo. Defina `VERDIN_METRICS_TOKEN`
(ou `[metrics].token`) e faça o scrape com `Authorization: Bearer <token>`, ou bloqueie o caminho
no proxy. Veja [Monitoramento](/pt-br/deploy/monitoring/).

## Plugins

Os plugins são módulos WebAssembly executados pelo Extism em um sandbox. Um módulo não tem
sistema de arquivos, rede nem banco de dados próprios: tudo passa por funções do host limitadas
pelas capacidades declaradas no seu `plugin.toml` (os tipos de conteúdo que ele lê ou escreve,
os hosts HTTP, o seu próprio armazenamento chave-valor), com um limite de tempo e de memória por
chamada (`[limits]`, 5 s e 64 MB no manifesto de exemplo). Os administradores veem o que um
plugin pede antes de ativá-lo. Os scripts de administração dos plugins rodam na página do painel,
então instale apenas plugins em que você confia. Veja [Plugins](/pt-br/extending/plugins/).

## Exportações e backups

Os arquivos do `verdin export` contêm campos privados e hashes de senhas. Guarde-os como dumps
do banco de dados. Veja [Backups](/pt-br/deploy/backups/).

## Como relatar uma vulnerabilidade

Não abra uma issue pública para um problema de segurança. Siga a
[política de segurança](https://github.com/Verdin-CMS/verdin/blob/main/SECURITY.md) do
repositório: relate-o de forma privada pela aba **Security** do
[repositório](https://github.com/Verdin-CMS/verdin/security) (**Report a vulnerability**), com a
versão, os passos para reproduzir e o impacto que você observa. As correções de segurança são
listadas em **Security** no [changelog](/pt-br/project/changelog/).
