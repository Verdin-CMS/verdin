---
title: "API de tempo real"
description: "O protocolo Server-Sent Events do stream de tempo real do Verdin: endpoint, autenticação, nomes de eventos e formato das mensagens, e o protocolo de presença da administração."
sidebar:
  order: 5
  label: "Tempo real"
---

O Verdin transmite as alterações de conteúdo e de mídia assim que são confirmadas, via
[Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events) (SSE).
Cada assinante recebe apenas eventos sobre o que pode ler. Esta página descreve o protocolo;
para usá-lo em um frontend, veja [Atualizações em tempo real](/pt-br/guides/frontend/realtime/).

## Como ativar

O tempo real vem desativado por padrão. Ative-o em **Configurações → Recursos → Tempo real**
(permissão `features.manage`). Enquanto estiver desativado, os endpoints respondem `404`.

## Stream de conteúdo

```
GET /api/_events
GET /api/_events?types=api::article,api::category
```

| Parâmetro | Descrição |
| --- | --- |
| `types` | Opcional, UIDs de tipos de conteúdo separados por vírgula; `plugin::upload` é a biblioteca de mídia. A forma do Strapi `api::article.article` também funciona. Sem ele, você recebe todos os tipos que pode ler. |

Autentique-se como na API REST: um token de API ou o JWT de um usuário final em
`Authorization: Bearer …`, ou nenhum cabeçalho para acesso público. Um token inválido
responde `401` antes de o stream abrir.

```sh title="Terminal"
curl -N -H "Authorization: Bearer $VERDIN_TOKEN" \
  'https://cms.example.com/api/_events?types=api::article'
```

```text
event: ready
data: {}

event: entry.publish
data: {"event":"entry.publish","uid":"api::article","documentId":"k2m7q4dx8n5t1v3b9c0e6a2wfr","locale":"en"}

event: media.create
data: {"event":"media.create","uid":"plugin::upload","documentId":"v3k9…","fileId":5}
```

## Mensagens

O primeiro evento é sempre `ready`. Depois, cada alteração é um evento SSE com o nome dela,
cujo `data` é um objeto JSON:

| Campo | Presente | Descrição |
| --- | --- | --- |
| `event` | sempre | O nome do evento, como na linha `event:` do SSE. |
| `uid` | sempre | O UID do tipo de conteúdo, ou `plugin::upload` para mídia. |
| `documentId` | sempre | O documento ou arquivo alterado. |
| `locale` | tipos localizados | O idioma da versão que mudou. |
| `fileId` | eventos de mídia | O id numérico do arquivo, como usado nos campos de mídia. |
| `actorId` | stream de administração | O administrador que fez a alteração, quando foi um administrador. |

| Eventos | Enviados quando | Quem os recebe |
| --- | --- | --- |
| `entry.create`, `entry.update`, `entry.discard-draft` | Um documento é criado, salvo ou tem o rascunho descartado | Em tipos com rascunho e publicação, clientes com `readDrafts` (esses eventos só alteram rascunhos). Nos outros tipos, clientes com `find` ou `findOne`. |
| `entry.publish`, `entry.unpublish`, `entry.delete` | Um documento é publicado, despublicado ou excluído | Clientes com `find` ou `findOne` no tipo |
| `media.create`, `media.update`, `media.delete` | Um arquivo é enviado, editado ou excluído | Clientes com `find` ou `findOne` na biblioteca de mídia |

Os eventos levam ids, não conteúdo. Busque o documento ou arquivo com a API REST ou GraphQL
para lê-lo, com as permissões habituais do cliente. Os eventos vêm de todas as APIs: REST,
GraphQL, o painel de administração, os lançamentos e os plugins.

## Duração da conexão

- O servidor envia um comentário de keep-alive a cada 15 segundos.
- Um stream de conteúdo termina depois de uma hora. Reconecte (o `EventSource` dos
  navegadores faz isso sozinho), o que também verifica o token de novo.
- Um evento chamado `lagged`, com `data: {"missed": 12}`, significa que o cliente leu devagar
  demais e essa quantidade de eventos foi descartada. Busque de novo o que o cliente exibe.
- Não há replay: os eventos que acontecem enquanto um cliente está desconectado não são
  enviados depois.

O `EventSource` dos navegadores não consegue enviar um cabeçalho `Authorization`. Para acesso
público ele funciona como está; com um token, use `fetch` com um leitor de corpo em streaming,
ou um cliente SSE que aceite cabeçalhos.

## Stream de administração

O painel de administração abre o seu próprio stream com o token de acesso do administrador:

```
GET /admin/api/events?types=api::article
```

Ele traz os mesmos eventos de conteúdo e de mídia para os tipos que o administrador pode ler
(com `content.read` e `media.read`), rascunhos incluídos, além de:

- `actorId` nas alterações feitas por administradores;
- eventos `presence` (abaixo);
- `comment.create`, `comment.update`, `comment.delete`, `comment.resolve`,
  `comment.reopen`, `task.create`, `task.update` e `task.delete`, com `uid`,
  `documentId` e `locale` da entrada.

Um stream de administração termina depois de 15 minutos, a vida de um token de acesso:
reconecte com um novo.

### Presença

O editor de entradas informa ao servidor quem está em uma entrada:

```
POST /admin/api/presence
{ "uid": "api::article", "documentId": "k2m7q4…", "locale": "en", "editing": true }
```

- Envie a cada 20 segundos, aproximadamente, enquanto o editor estiver aberto. `editing: true`
  significa que o administrador tem alterações não salvas. Envie `"leave": true` quando o
  editor fechar.
- Uma presença expira 45 segundos depois do último heartbeat.
- A resposta lista quem está na entrada: `{ "data": [{ "userId": 3, "name": "Ada Lovelace", "editing": true, "holdsLock": true }] }`.
- `GET /admin/api/presence?uid=&documentId=&locale=` lê a mesma lista.
- Quando a lista muda, os streams de administração recebem um evento `presence` com `uid`,
  `documentId` e `locale` da entrada e a lista em `presence`.

O primeiro administrador que ainda está editando mantém um bloqueio leve (`holdsLock`). O
editor o mostra aos outros, mas ele não impede que salvem. Ler a presença exige `content.read`
no tipo.

## Várias instâncias

Os eventos e a presença são os da instância à qual o cliente está conectado. Atrás de um load
balancer, roteie `/api/_events` e `/admin/api/events` com sticky sessions, ou conecte os
clientes de tempo real a uma única instância. Veja [Escalabilidade](/pt-br/deploy/scaling/).
