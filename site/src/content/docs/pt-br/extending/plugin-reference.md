---
title: Referência de plugins
description: O manifesto plugin.toml, as capacidades, os hooks e os seus payloads, as funções do host, as rotas, os jobs, a função de inicialização, os campos GraphQL, os pontos de extensão da administração, os limites e as métricas.
sidebar:
  order: 3
---

<!-- Written from crates/verdin-plugins (lib.rs, manifest.rs), crates/verdin-api/src/plugins.rs,
plugins_admin.rs, crates/verdin-graphql/src/lib.rs, crates/verdin/src/metrics.rs and
admin/src/app/core/plugin-extensions.ts. -->

Esta página é o contrato completo entre o Verdin e um plugin: o manifesto, o que o Verdin envia
para cada função exportada e o que espera de volta, e as funções do host que um módulo pode
chamar. Para uma introdução, veja [Plugins](/pt-br/extending/plugins/); para um exemplo
completo, o [tutorial de plugin](/pt-br/extending/plugin-tutorial/).

## Diretório do plugin

Cada plugin é um diretório em `[plugins].path` (padrão `plugins/`, ao lado do `verdin.toml`):

| Arquivo | Obrigatório | Conteúdo |
| --- | --- | --- |
| `plugin.toml` | sim | O manifesto. |
| `plugin.wasm` | sim | O módulo (outro caminho com `wasm`). |
| `admin/` | não | Os arquivos que o painel de administração carrega: o módulo `admin.script` e os seus assets. |

Na inicialização, o Verdin carrega todos os diretórios que têm um `plugin.toml`, em ordem de
nome. Um diretório é ignorado, e listado com o motivo em **Configurações → Plugins**, quando o
seu manifesto é inválido, o seu módulo não existe ou outro plugin já usa o seu `name`.

## Manifesto

```toml title="plugins/slugs/plugin.toml"
name = "slugs"
version = "1.0.0"
description = "Slugs from titles, and a color field"

[capabilities]
read = ["api::article"]
write = ["api::tag"]
http = ["api.example.com"]
kv = true
public_permissions = true

[limits]
timeout_ms = 5000
memory_mb = 64

[[hooks]]
on = "beforeCreate"
uid = "api::article"
function = "before_write"

[routes]
function = "handle"

[[jobs]]
schedule = "*/15 * * * *"
function = "refresh"

[startup]
function = "seed"
timeout_ms = 30000

[[graphql]]
name = "slugStats"
function = "stats"

[admin]
script = "index.js"

[[admin.widgets]]
id = "stats"
title = "Slug stats"
element = "slugs-stats"

[[admin.fields]]
id = "color"
title = "Color"
element = "slugs-color"
type = "string"

[[settings]]
key = "separator"
label = "Separator"
type = "select"
options = ["-", "_"]
default = "-"
```

Chaves desconhecidas são erros, em todas as tabelas.

### Chaves de nível superior

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `name` | obrigatória | O id do plugin nas URLs, nas configurações e nos campos personalizados: letras minúsculas, dígitos e `-`, começando com uma letra, com no máximo 64 caracteres. |
| `version` | obrigatória | Exibida na administração e no log. |
| `description` | não definida | Exibida em **Configurações → Plugins**. |
| `wasm` | `"plugin.wasm"` | O módulo, relativo ao diretório do plugin (sem `..`, não absoluto). |
| `wasi` | `false` | Dá WASI ao módulo: um relógio e números aleatórios. Sem arquivos nem sockets em nenhum caso. |

### `[capabilities]`

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `read` | `[]` | Os tipos de conteúdo que o `verdin_content` pode ler (`findMany`, `findOne`): uids como `api::article`, ou `"*"` para todos. |
| `write` | `[]` | Os tipos de conteúdo que ele pode `create`, `update`, `delete`, `publish` e `unpublish`. Implica `read`. |
| `http` | `[]` | Os hosts para os quais o módulo pode enviar requisições HTTP: `api.example.com` ou `*.example.com`. |
| `kv` | `false` | O armazenamento chave-valor próprio do plugin (`verdin_kv_get`, `verdin_kv_set`). |
| `public_permissions` | `false` | Ler e substituir as permissões da API de conteúdo da função pública (`verdin_public_permissions`). |

As capacidades limitam apenas as chamadas ao host. Os hooks rodam nos tipos que nomeiam, diga o
que disser o `read`, e as rotas podem ser acessadas por qualquer pessoa.

### `[limits]`

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `timeout_ms` | `5000` | Limite de tempo de uma chamada, em milissegundos. |
| `memory_mb` | `64` | Memória máxima do módulo, em megabytes. |

Os dois precisam ser positivos.

### `[[hooks]]`

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `on` | obrigatória | O evento, abaixo. |
| `uid` | `"*"` | O tipo de conteúdo (`api::article`), ou `"*"` para todos. |
| `function` | obrigatória | A função exportada a chamar. |

Eventos:

| Antes da escrita | Depois da escrita |
| --- | --- |
| `beforeCreate` | `afterCreate` |
| `beforeUpdate` | `afterUpdate` |
| `beforeDelete` | `afterDelete` |
| `beforePublish` | `afterPublish` |
| `beforeUnpublish` | `afterUnpublish` |
| `beforeDiscardDraft` | `afterDiscardDraft` |

Os nomes são os nomes de lifecycle do Strapi. Os hooks rodam nas escritas feitas pelo painel de
administração, pelas APIs REST e GraphQL e pelos lançamentos, mas não nas escritas feitas pelos
comandos `verdin import`. As escritas feitas por plugins rodam os hooks after, mas não os hooks
before (veja [Escritas feitas por plugins](#escritas-feitas-por-plugins)).

### `[routes]`

| Chave | Descrição |
| --- | --- |
| `function` | A função exportada que serve todas as requisições para `/api/plugins/<name>` e `/api/plugins/<name>/…`, com qualquer método. |

O caminho segue `[api].prefix`.

### `[[jobs]]`

| Chave | Descrição |
| --- | --- |
| `schedule` | Expressão cron, em UTC, com segundos opcionais: `*/15 * * * *`, `0 0 3 * * *`. |
| `function` | A função exportada a chamar. |

### `[startup]`

Uma função executada quando o plugin inicia: o que um projeto Strapi faz no `bootstrap`
(popular conteúdo, configurar a função pública).

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `function` | obrigatória | A função exportada a chamar. |
| `timeout_ms` | `30000` | O seu próprio limite de tempo, em milissegundos (popular conteúdo pode levar mais que um hook). Precisa ser positivo. |

Veja [Função de inicialização](#função-de-inicialização) para saber quando ela roda.

### `[[graphql]]`

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `name` | obrigatória | O nome do campo: começa com uma letra minúscula, seguida de letras, dígitos e `_`. |
| `function` | obrigatória | A função exportada que o resolve. |
| `mutation` | `false` | Adiciona o campo a `Mutation` em vez de `Query`. |
| `description` | não definida | A descrição do campo no schema. |

Cada entrada adiciona `name(args: JSON): JSON`. Um nome que um tipo de conteúdo já usa, ou que
outro plugin pegou antes, é ignorado com um aviso no log.

### `[admin]`

| Chave | Descrição |
| --- | --- |
| `script` | Módulo ES em `admin/` que define os custom elements (sem `..`, não absoluto). |
| `[[admin.widgets]]` | Tipos de widget do dashboard: `id`, `title`, `element`, `description` opcional. |
| `[[admin.fields]]` | Campos personalizados: `id`, `title`, `element`, `type` (o tipo de atributo em que o valor é armazenado, como `string` ou `json`), `description` opcional. |

`element` é o nome de um custom element: letras minúsculas, dígitos e `-`, com pelo menos um
`-` (`slugs-color`).

### `[[settings]]`

Declara o formulário de **Configurações → Plugins → Configurações**. Sem nenhuma entrada, as
configurações são um objeto JSON livre.

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `key` | obrigatória | A chave no objeto de configurações: letras, dígitos e `_`, sem começar com dígito, única. |
| `label` | obrigatória | O rótulo no formulário. |
| `type` | `"string"` | `string`, `text`, `url`, `number`, `integer`, `boolean` ou `select`. |
| `description` | não definida | Texto de ajuda sob o campo. |
| `required` | `false` | É preciso um valor (não vazio, para texto), a menos que haja um `default`. |
| `options` | `[]` | As opções de um `select` (obrigatório para ele). |
| `default` | não definida | Usado quando a chave falta ou é `null`. Precisa ser válido para o campo. |
| `min`, `max` | não definida | Limites dos valores `number` e `integer`; limites de comprimento de `string` e `text`. |

Os valores `url` são vazios ou URLs `http(s)://`. Com um formulário, o servidor recusa
configurações com chaves desconhecidas, tipos errados, valores fora dos limites ou valores
obrigatórios ausentes (400).

## Funções exportadas

Toda função exportada recebe um documento JSON e retorna um (ou nada). Uma saída vazia conta
como `null`; uma saída que não é JSON conta como falha.

### Hooks before

Entrada:

```json
{
  "event": "beforeUpdate",
  "uid": "api::article",
  "documentId": "01m3p88ry359w82nsx496mep5t",
  "locale": "en",
  "data": { "title": "Hello" }
}
```

| Campo | Descrição |
| --- | --- |
| `event` | O evento do hook. |
| `uid` | O tipo de conteúdo. |
| `documentId` | O documento, ou `null` em `beforeCreate`. |
| `locale` | Nos tipos localizados, o idioma escrito (o idioma padrão quando a requisição não nomeou nenhum); `null` nos outros tipos. |
| `data` | Os dados sendo escritos, como a requisição os enviou: na criação e na atualização. `null` nos outros eventos. Na atualização, apenas os campos enviados. |

Saída:

| Saída | Efeito |
| --- | --- |
| `{ "data": { … } }` | Substitui os dados escritos. Eles são validados como os originais. |
| `{ "error": "message" }` | Recusa a escrita: o cliente recebe um 400 com a mensagem. |
| `{}` ou qualquer outra coisa | A escrita segue sem mudanças. |

Quando vários hooks correspondem, eles rodam na ordem dos plugins (nomes dos diretórios) e
depois na ordem do manifesto; cada um vê os dados que o anterior retornou. Um hook que falha
(trap, timeout, saída inválida) é registrado no log e ignorado: a escrita continua.

### Hooks after

Entrada: `{ "event", "uid", "documentId", "locale" }`, enviada depois que a escrita é
confirmada. A saída é ignorada; as falhas são registradas no log. Leia a entrada com
`verdin_content` se precisar dos seus campos (com a capacidade `read`).

### Rotas

Entrada:

```json
{
  "method": "GET",
  "path": "/stats",
  "query": "page=2&sort=title",
  "headers": { "accept": "application/json", "user-agent": "curl/8.7.1" },
  "body": "",
  "actor": { "kind": "public" }
}
```

| Campo | Descrição |
| --- | --- |
| `method` | O método HTTP. |
| `path` | O caminho depois de `/api/plugins/<name>`, começando com `/` (`/` para a raiz do plugin). |
| `query` | A query string bruta, sem `?` (vazia quando não há nenhuma). |
| `headers` | Apenas `content-type`, `accept`, `user-agent` e `accept-language`, quando presentes. |
| `body` | O corpo da requisição como string (UTF-8 inválido é substituído). |
| `actor` | Quem está chamando: `{ "kind": "public" }`, `{ "kind": "token", "id": 3 }` (um token de API) ou `{ "kind": "user", "id": 12 }` (um usuário final com login). |

Um cabeçalho `Authorization` com um token inválido é recusado com um 401 antes de o plugin ser
chamado. As permissões do acesso público e dos tokens de API não são aplicadas: verifique o
`actor` você mesmo.

Saída:

| Campo | Padrão | Descrição |
| --- | --- | --- |
| `status` | `200` | O status HTTP. |
| `headers` | nenhum | Cabeçalhos de resposta. Apenas `content-type`, `cache-control`, `location`, `etag`, `last-modified` e `content-disposition` são mantidos. |
| `body` | vazio | Uma string é enviada como está (`text/plain`, a menos que você defina `content-type`); qualquer outro valor JSON é enviado como `application/json`. |

Um plugin desativado ou desconhecido, ou um sem `[routes]`, responde 404. Uma chamada que falha
responde 502 com `{ "data": null, "error": { "status": 502, "name": "PluginError", … } }`. As
rotas compartilham o `[server].body_limit` e o `[server].request_timeout_secs` da API de
conteúdo.

### Jobs

Entrada: `{ "scheduledAt": "2026-09-29T03:00:00+00:00" }`, o horário para o qual a execução foi
agendada. A saída é ignorada; as falhas são registradas no log. Os jobs só rodam enquanto o
plugin está ativado, e apenas nas instâncias com `[plugins].run_jobs = true`. Uma execução
perdida enquanto o servidor estava fora do ar não é recuperada.

### Função de inicialização

Entrada: `{ "reason": "start" | "enabled" | "settings" }`:

| `reason` | Quando |
| --- | --- |
| `start` | O servidor iniciou com o plugin ativado. |
| `enabled` | O plugin foi ativado (aqui, ou em outra instância e percebido aqui). |
| `settings` | As suas configurações mudaram enquanto estava ativado (salvas aqui, ou percebidas de outra instância). |

Saída: `{ "error": "message" }` conta como falha; qualquer outra coisa (`{}`, vazia) conta como
sucesso. Uma falha (trap, time-out, `{ error }`) vai para o log do plugin e para o log do
servidor; o plugin continua ativado e a função roda de novo no próximo início, ativação ou
mudança de configurações.

A função roda em segundo plano, depois que o servidor está de pé, então as requisições são
atendidas enquanto isso. Ela roda em uma instância do módulo só sua, com `[startup].timeout_ms`,
então uma carga inicial lenta não segura os hooks e as rotas do plugin. Os hooks after
disparados pelas suas escritas rodam quando ela retorna (veja
[Escritas feitas por plugins](#escritas-feitas-por-plugins)). A memória do módulo não é
compartilhada com a instância regular do plugin: guarde o estado em `verdin_kv_set` ou no
conteúdo.

Com várias instâncias, apenas as que têm `[plugins].run_jobs = true` rodam as funções de
inicialização (uma instância, se você seguir o [conselho de escalabilidade](/pt-br/deploy/scaling/)):
elas agem sobre o banco de dados compartilhado, então uma vez basta. Escreva a função de modo
que rodá-la de novo seja inofensivo: procure o que você popula antes de criá-lo.

### Campos GraphQL

Entrada: `{ "args": …, "actor": … }`, com `args` sendo o argumento `args` do campo (qualquer
JSON, ou `null`) e `actor` como nas rotas. A saída é o valor do campo. Uma falha, ou um plugin
desativado, responde um erro GraphQL com o código `PLUGIN_ERROR`. Como nas rotas, é o plugin que
verifica o acesso.

## Funções do host

Importe-as do namespace `extism:host/user` (`extern "ExtismHost"` em Rust). Elas recebem e
retornam JSON como strings; o `Json<Value>` do `extism-pdk` cuida da conversão.

| Função | Entrada | Saída |
| --- | --- | --- |
| `verdin_log` | `{ "level": "info" \| "warn" \| "error", "message": "…" }` | nenhuma |
| `verdin_content` | Uma requisição de conteúdo (abaixo) | O resultado, ou `{ "error": "…" }` |
| `verdin_kv_get` | A chave, como string simples | O valor JSON armazenado, ou `null` |
| `verdin_kv_set` | `{ "key": "…", "value": … }` | nenhuma |
| `verdin_config` | nenhuma | O objeto de configurações, com os padrões declarados preenchidos |
| `verdin_public_permissions` | `{ "op": "get" }` ou `{ "op": "set", "permissions": [...] }` | `{ "permissions": [...] }`, ou `{ "error": "…" }` |

Um módulo que importa uma função do host que o servidor não tem (um Verdin mais antigo) não
pode ser carregado: toda chamada a ela falha com `unknown import` no log do servidor.

### `verdin_log`

Grava no log do servidor (com o nome do plugin) e no log do plugin em **Configurações →
Plugins → Logs**. Outros níveis contam como `info`. O log do plugin guarda as últimas 200
mensagens, cada uma cortada em 2.000 caracteres, em memória.

### `verdin_content`

```json
{ "op": "findMany", "uid": "api::article", "query": { "filters": { "title": { "$eq": "x" } }, "sort": ["title"] } }
```

| Campo | Usado por | Descrição |
| --- | --- | --- |
| `op` | todos | `findMany`, `findOne`, `create`, `update`, `delete`, `publish` ou `unpublish`. |
| `uid` | todos | O tipo de conteúdo. Precisa estar nas capacidades. |
| `documentId` | `findOne`, `update`, `delete`, `publish`, `unpublish` | O documento. |
| `query` | `findMany`, `findOne` | Os parâmetros da API REST como objeto JSON: `filters`, `sort`, `fields`, `populate`, `pagination`, `status`. |
| `data` | `create`, `update` | Os campos a escrever, como no `data` de uma requisição REST. |
| `status` | `create`, `update` | `"draft"` salva um rascunho. Caso contrário, a escrita é publicada, como uma escrita REST sem `?status=draft`. |
| `locale` | todos | O idioma a ler ou escrever. |

Resultados:

| `op` | Resultado |
| --- | --- |
| `findMany` | `{ "documents": [...], "meta": { "pagination": {…} } }` |
| `findOne` | `{ "document": {…} }` (`null` quando não encontrado) |
| `create`, `update` | `{ "documentId": "…" }` |
| `delete` | `{ "deleted": true }` |
| `publish` | `{ "published": true }` |
| `unpublish` | `{ "unpublished": true }` |

Uma chamada fora das capacidades, uma operação desconhecida, um erro de validação ou um
documento inexistente respondem `{ "error": "…" }`. As leituras retornam as versões publicadas,
a menos que a consulta peça `"status": "draft"`.

#### Escritas feitas por plugins

As escritas via `verdin_content` pulam os hooks **before** de todos os plugins, então um plugin
não consegue entrar em loop com as suas próprias alterações ali, e as regras que você coloca em
hooks before (padrões, verificações) não se aplicam a elas. Todo o resto se aplica: a validação,
as etapas de revisão, os webhooks, o histórico, o log de auditoria e os hooks **after** de todos
os plugins, inclusive o que está escrevendo.

Os hooks after disparados pelas escritas de um plugin não rodam dentro da escrita: ficam em fila
e rodam quando a chamada do plugin (rota, job, resolvedor GraphQL, hook ou função de
inicialização) retornou e liberou a instância do plugin, antes de a resposta da rota ser
enviada. Assim, um plugin pode escrever em um tipo no qual tem hooks after, e cadeias por vários
plugins funcionam.

- Os hooks que escrevem disparam outros hooks, **no máximo `4` níveis de profundidade** (uma
  escrita vinda de REST ou GraphQL é o nível 1). Os hooks mais profundos são ignorados com um
  aviso no log do plugin, o que impede que um hook que escreve no tipo que ele escuta entre em
  loop para sempre.
- As funções do host (`verdin_content`, `verdin_public_permissions`, o armazenamento
  chave-valor) param no limite de tempo da chamada e retornam um erro ao módulo, e quem chama
  espera no máximo o limite de tempo mais 10 segundos por um plugin ocupado. Uma chamada presa
  não pode segurar o plugin, nem uma parada graciosa, para sempre.

### `verdin_kv_get` e `verdin_kv_set`

Um armazenamento chave-valor por plugin, no banco de dados do Verdin, compartilhado por todas as
instâncias. As chaves têm de 1 a 255 bytes; os valores são qualquer JSON. Definir `null` exclui
a chave. Sem a capacidade `kv`, as leituras retornam `null` e as escritas são ignoradas.

### `verdin_config`

Retorna as configurações salvas em **Configurações → Plugins**, com o `default` de cada
configuração declarada preenchido para as chaves ausentes. `{}` quando nada foi salvo.

### `verdin_public_permissions`

Lê ou substitui as permissões da API de conteúdo da função pública, o que **Configurações →
Acesso público** edita. Exige a capacidade `public_permissions`; sem ela, toda chamada responde
`{ "error": "…" }`.

```json
{ "op": "set", "permissions": [
  { "subject": "api::article", "action": "find" },
  { "subject": "api::article", "action": "findOne" },
  { "subject": "api::comment", "action": "create" }
] }
```

| `op` | Efeito |
| --- | --- |
| `get` | Nada; retorna as permissões atuais. |
| `set` | Substitui **todas** as permissões públicas por `permissions` (uma lista vazia remove todas). |

Ambas respondem `{ "permissions": [{ "subject", "action" }, …] }`, ordenadas. `subject` é o uid
de um tipo de conteúdo, `plugin::upload` (a biblioteca de mídia), `plugin::users-permissions.user`
(usuários finais pela API de conteúdo) ou `plugin::i18n.locale` (apenas `find`). `action` é
`find`, `findOne`, `create`, `update`, `delete`, `publish` ou `readDrafts` (as duas últimas não
se aplicam a uploads nem a usuários finais). Elas são verificadas como a grade de permissões da
administração: um subject ou uma action desconhecidos, ou que não se aplicam, respondem
`{ "error": "…" }` e não alteram nada. Todo `set` é gravado no log do servidor.

### HTTP

Com hosts listados em `http`, use o suporte HTTP do Extism (`extism_pdk::http::request` em
Rust). As requisições para outros hosts falham.

## Pontos de extensão da administração

O painel de administração pede ao servidor as extensões dos plugins ativados e importa cada
`admin.script` uma única vez, como módulo ES, de `/admin/plugins/<name>/<script>` (sob
`[admin].path`). Os arquivos do diretório `admin/` do plugin são servidos ali enquanto o plugin
está ativado, com `X-Content-Type-Options: nosniff` e `Cache-Control: no-cache`. O módulo
precisa definir os custom elements que o manifesto nomeia; um elemento não definido em até 3
segundos fica de fora.

### Widgets

Cada entrada `[[admin.widgets]]` é um tipo de widget que os administradores podem adicionar ao
dashboard. O elemento recebe uma propriedade `context`:

| Propriedade | Descrição |
| --- | --- |
| `apiBase` | A base da API de conteúdo, como `/api`. |
| `adminApiBase` | A base da API de administração, como `/admin/api`. |
| `fetch(path, init)` | `fetch` com as credenciais do administrador logado. Os caminhos relativos são resolvidos a partir de `adminApiBase`; os caminhos sob qualquer uma das bases e as URLs absolutas são mantidos. |

```js title="plugins/slugs/admin/index.js"
class SlugStats extends HTMLElement {
  set context(context) {
    // Admin API, with the admin's session.
    context.fetch('auth/me').then((response) => response.json())
      .then(({ data }) => { this.textContent = `Hello ${data.firstname ?? data.email}`; });
    // The plugin's own route, on the content API: sent without the admin's session.
    context.fetch(`${context.apiBase}/plugins/slugs/stats`).then((response) => response.json())
      .then((stats) => { this.title = JSON.stringify(stats); });
  }
}
customElements.define('slugs-stats', SlugStats);
```

O `context.fetch` envia a sessão do administrador apenas nas requisições à API de
administração. Os caminhos sob `context.apiBase` (a API de conteúdo, inclusive as rotas do seu
plugin) vão sem ela, já que a API de conteúdo não aceita sessões de administração; eles são
respondidos com as permissões da função pública. Antes da 0.10, ele também enviava a sessão ali
e essas requisições falhavam; os widgets escritos para a 0.9 que chamam o `fetch` simples
continuam funcionando.

### Campos personalizados

Cada entrada `[[admin.fields]]` é um campo que os atributos podem usar com
`"customField": "plugin::<name>.<id>"`; o `type` do atributo precisa corresponder à forma como o
campo armazena o seu valor. O **Construtor de tipos de conteúdo** o oferece. O elemento recebe:

| Propriedade | Descrição |
| --- | --- |
| `value` | O valor atual. |
| `disabled` | Se a edição está desativada. |
| `attribute` | A definição do atributo no schema. |
| `locale` | O idioma sendo editado. |

Ele informa um novo valor com um evento `change` cujo `detail` é o valor (ou, sem `detail`, pela
sua própria propriedade `value`). Quando o plugin está desativado ou o seu elemento não existe, o
editor mostra o input normal do tipo de armazenamento. Veja
[Tipos de atributos](/pt-br/reference/attribute-types/).

## Runtime e limites

| Limite | Valor |
| --- | --- |
| Tempo por chamada | `[limits].timeout_ms`, padrão 5.000 ms (`[startup].timeout_ms`, padrão 30.000 ms, para a função de inicialização) |
| Memória | `[limits].memory_mb`, padrão 64 MB |
| Concorrência | Uma chamada por vez por plugin; as chamadas esperam umas pelas outras (a função de inicialização roda ao lado delas) |
| Instância do módulo | Uma por plugin, criada no primeiro uso; recriada depois que uma chamada falha (a sua memória é perdida). A função de inicialização recebe uma nova a cada execução |
| Log | 200 mensagens por plugin, 2.000 caracteres cada, em memória |
| Chaves KV | De 1 a 255 bytes |
| Cabeçalhos de requisição das rotas | `content-type`, `accept`, `user-agent`, `accept-language` |
| Cabeçalhos de resposta das rotas | `content-type`, `cache-control`, `location`, `etag`, `last-modified`, `content-disposition` |

As alterações em um manifesto ou em um módulo valem após uma reinicialização; os interruptores e
as configurações valem na hora. Gerenciar plugins exige `plugins.manage` (veja a
[referência de permissões](/pt-br/reference/permissions/)).

## Métricas

Com [`[metrics]`](/pt-br/deploy/monitoring/) ativado, `/_metrics` informa cada chamada que chegou
a uma função exportada:

| Métrica | Tipo | Labels | Significado |
| --- | --- | --- | --- |
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`, `kind`, `function` | Tempo que as funções dos plugins levaram. Buckets de 5 ms a 10 s. |
| `verdin_plugin_call_errors_total` | counter | `plugin`, `kind`, `function` | Chamadas que falharam: um trap, um time-out, uma saída que não é JSON ou o `{ error }` de uma função de inicialização. |

`kind` é `hook`, `route`, `job`, `startup` ou `graphql`. Um hook before que recusa uma escrita
com `{ error }` deu uma resposta, então não conta como falha. As chamadas a uma função que o
módulo não exporta não são registradas, então os labels ficam limitados pelos plugins
instalados. As séries aparecem após a primeira chamada de um plugin; cada instância conta as
suas próprias chamadas.
