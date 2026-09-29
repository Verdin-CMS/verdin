---
title: "Webhooks"
description: "Eventos de webhook, formato dos payloads, cabeçalhos, verificação de assinatura, novas tentativas e o log de envios."
sidebar:
  order: 6
---

Um webhook envia um `POST` HTTP para a sua URL quando o conteúdo ou a mídia muda. Esta página
é a referência para quem recebe: eventos, payloads, cabeçalhos, assinaturas e entrega. Para
criar e gerenciar webhooks no painel de administração, veja
[Webhooks](/pt-br/guides/integrations/webhooks/).

## Eventos

| Evento | Enviado quando |
| --- | --- |
| `entry.create` | Um documento é criado, por qualquer API: REST, GraphQL, o painel de administração ou um plugin. |
| `entry.update` | Um documento é salvo. |
| `entry.publish` | Um documento é publicado. Criar ou atualizar um documento via REST ou GraphQL sem `status=draft` o publica. |
| `entry.unpublish` | Um documento é despublicado. |
| `entry.discard-draft` | O rascunho de um documento é descartado. |
| `entry.delete` | Um documento é excluído. |
| `media.create`, `media.update`, `media.delete` | Um arquivo é enviado, editado ou excluído. Excluir uma pasta envia `media.delete` para cada arquivo dentro dela. |
| `releases.publish` | Um [lançamento](/pt-br/guides/content/releases/) foi executado, agora ou na data dele. |
| `review-workflows.updateEntryStage` | Uma entrada passou para outra [etapa de revisão](/pt-br/guides/content/review-workflows/). |

Um webhook assina alguns eventos e pode ser limitado a alguns tipos de conteúdo. Os eventos
de mídia não estão ligados a um tipo de conteúdo.

## Payloads

Todo payload tem `event` e `createdAt` (quando o evento entrou na fila). Os eventos de entrada
adicionam o tipo de conteúdo e o documento:

```json
{
  "event": "entry.publish",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "model": "article",
  "uid": "api::article",
  "locale": null,
  "entry": {
    "id": 3,
    "documentId": "k2m7q4dx8n5t1v3b9c0e6a2wfr",
    "title": "Hello, Verdin",
    "slug": "hello-verdin",
    "createdAt": "2026-09-25T08:55:00.000Z",
    "updatedAt": "2026-09-25T09:00:00.000Z",
    "publishedAt": "2026-09-25T09:00:00.000Z"
  }
}
```

- `model` é o `singularName` do tipo, `uid` o seu UID e `locale` o idioma da versão que mudou
  (`null` em tipos não localizados).
- `entry` é o documento como a API REST o retorna, sem relações, mídia, componentes nem campos
  `private`.
- `entry.publish` traz a versão publicada. Os outros eventos de entrada trazem o rascunho, ou a
  única versão em tipos sem rascunho e publicação.
- `entry.delete` traz apenas `{ "documentId": … }`.

Os eventos de mídia enviam o objeto do arquivo em `media`, sem `model`, `uid` nem `entry`:

```json
{
  "event": "media.create",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "media": { "id": 5, "documentId": "v3k9…", "name": "harbour.jpg", "mime": "image/jpeg", "url": "/uploads/harbour_4f1c.jpg" }
}
```

`releases.publish` envia o `release` com o resultado de cada uma das suas ações.
`review-workflows.updateEntryStage` envia:

```json
{
  "event": "review-workflows.updateEntryStage",
  "createdAt": "2026-09-25T09:00:00.000Z",
  "model": "article",
  "uid": "api::article",
  "entry": { "documentId": "k2m7q4…", "locale": "en" },
  "workflow": { "id": 1, "name": "Editorial" },
  "stages": { "from": { "id": 1, "name": "To do" }, "to": { "id": 2, "name": "In review" } }
}
```

Como nos eventos de entrada, `model` é o nome no singular e `uid` o UID do tipo de conteúdo
(antes da 0.10, `model` continha o UID aqui).

O botão **Enviar evento de teste** envia `{ "event": "trigger-test", "createdAt": … }`.

## Cabeçalhos

| Cabeçalho | Valor |
| --- | --- |
| `content-type` | `application/json` |
| `x-verdin-event` | O nome do evento. |
| `x-verdin-delivery` | O id do envio. Ele se mantém entre as novas tentativas: use-o para ignorar duplicatas. |
| `x-verdin-signature` | `t=<unix seconds>,v1=<hex>`, quando o webhook é assinado. |

Os webhooks podem adicionar os seus próprios cabeçalhos, como um token `authorization` para o
seu endpoint. Os cabeçalhos acima não podem ser sobrescritos.

## Verificação de assinaturas

Os webhooks são assinados por padrão. `v1` é o HMAC-SHA256 em hexadecimal de `<t>.<raw body>`,
com o segredo do webhook (`whsec_…`) como chave. O segredo é exibido uma única vez, quando o
webhook é criado ou quando o segredo é rotacionado.

Para verificar um envio:

1. Separe o cabeçalho em `t` e `v1`.
2. Rejeite-o se `t` estiver a mais de alguns minutos do seu relógio.
3. Calcule o HMAC sobre `t`, um ponto e o corpo **bruto** da requisição. Não faça o parse e
   a reserialização do JSON antes: os bytes seriam diferentes.
4. Compare-o com `v1` em tempo constante.

```js title="verify.mjs"
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, header, rawBody, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=')));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const received = parts.v1 ?? '';
  return (
    received.length === expected.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  );
}
```

Com Express, leia o corpo bruto e verifique-o antes do parse:

```js title="server.mjs"
import express from 'express';
import { verify } from './verify.mjs';

const app = express();

app.post('/hooks/verdin', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body.toString('utf8');
  if (!verify(process.env.VERDIN_WEBHOOK_SECRET, req.get('x-verdin-signature') ?? '', rawBody)) {
    return res.sendStatus(401);
  }
  const payload = JSON.parse(rawBody);
  console.log(req.get('x-verdin-delivery'), payload.event, payload.entry?.documentId);
  res.sendStatus(204);
});

app.listen(3000);
```

Em Python:

```python title="verify.py"
import hashlib
import hmac
import time


def verify(secret: str, header: str, raw_body: bytes, tolerance: int = 300) -> bool:
    parts = dict(part.split("=", 1) for part in header.split(","))
    if abs(time.time() - int(parts["t"])) > tolerance:
        return False
    signed = parts["t"].encode() + b"." + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))
```

## Entrega e novas tentativas

Os envios entram em uma fila no banco de dados quando a alteração é confirmada, e um worker em
segundo plano os envia. Um endpoint lento ou com falhas nunca deixa os editores nem as escritas
da API mais lentos, e os envios sobrevivem a uma reinicialização.

- **Sucesso**: qualquer resposta `2xx`.
- **Falha**: qualquer outro status, incluindo redirecionamentos (que não são seguidos), um erro
  de conexão ou um timeout (`[webhooks].timeout_secs`, 10 segundos por padrão).
- **Novas tentativas**: um envio com falha é tentado de novo após 30 segundos, 2 minutos,
  10 minutos, 1 hora e 6 horas, seis tentativas no total. Depois disso, é marcado como falho.
- Desativar ou excluir um webhook interrompe as suas novas tentativas pendentes.
- Várias instâncias compartilham a fila; cada envio é assumido por uma delas.

Responda rápido com um `2xx` e faça o trabalho lento depois. Os envios podem chegar mais de uma
vez (uma nova tentativa após um timeout, por exemplo) e fora de ordem: use `x-verdin-delivery`
para ignorar duplicatas e busque o documento de novo quando a ordem importar.

## Log de envios

A página de cada webhook em **Configurações → Webhooks** tem um **Log de envios**, do mais
recente para o mais antigo. Para cada envio, ele mostra o status (**Pendente**, **Enviando**,
**Sucesso**, **Falha**), o status HTTP, os primeiros 2 KB do corpo da resposta, o erro, o
número de tentativas, o horário da próxima tentativa, a duração e o payload enviado. Um envio
com falha pode ser tentado de novo a partir do log.

Os envios concluídos são removidos após `[webhooks].retention_days` (30 por padrão).

Os mesmos dados estão disponíveis na [API de administração](/pt-br/api/admin/):
`GET /admin/api/webhooks/{id}/deliveries` e `POST /admin/api/webhooks/deliveries/{id}/retry`.

## Restrições de URL

Com `verdin start`, as URLs de webhook não podem apontar para endereços de loopback, privados,
link-local ou outros reservados, sejam escritos como endereços IP ou como nomes de host que
resolvem para eles. Um administrador não pode usar webhooks para alcançar serviços internos. O
`verdin dev` os permite, para que você possa testar contra `localhost`;
`[webhooks].allow_private_networks` substitui o padrão. URLs com credenciais
(`https://user:pass@…`) são recusadas: coloque-as em um cabeçalho.

## Comparação com o Strapi

Os payloads seguem os do Strapi (`event`, `createdAt`, `model`, `uid`, `entry`). O Verdin
adiciona assinaturas, novas tentativas, um log de envios e filtros por tipo de conteúdo. O
evento `entry.draft-discard` do Strapi se chama `entry.discard-draft`.
