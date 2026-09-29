---
title: Monitoramento
description: Acompanhe uma instância Verdin em execução — as verificações /_health e /_ready, as métricas Prometheus em /_metrics e o seu token, o formato dos logs, os níveis e os ids de requisição.
sidebar:
  order: 10
---

Uma instância Verdin informa sobre si mesma por meio de dois endpoints de saúde, métricas
Prometheus opcionais e logs estruturados. Esta página lista o que cada um retorna e como
ativá-lo.

## Health checks

Os dois endpoints são servidos na raiz do servidor, fora dos prefixos das APIs, e não precisam
de autenticação.

| Endpoint | Responde | Use para |
| --- | --- | --- |
| `GET /_health` | Sempre `200 {"status":"ok"}` enquanto o processo serve HTTP. | Liveness: reinicie o processo quando ele parar de responder. |
| `GET /_ready` | `200 {"status":"ready","database":"postgres"}` quando o banco de dados responde a um ping, `503 {"status":"unavailable"}` quando não responde. | Verificações de readiness e do load balancer: envie tráfego apenas para as instâncias que respondem 200. |

`database` é `postgres`, `mysql`, `mariadb` ou `sqlite`. `/_ready` não verifica as migrações: o
`verdin start` se recusa a iniciar enquanto houver migrações pendentes (a menos que `--migrate`
as aplique), então um servidor em execução não tem nenhuma.

```sh frame="terminal"
curl -s localhost:1337/_ready
{"status":"ready","database":"sqlite"}
```

## Métricas Prometheus

Ative as métricas e defina um token:

```toml title="verdin.toml"
[metrics]
enabled = true
```

```sh
VERDIN_METRICS_TOKEN=<a long random string>
```

O `GET /_metrics` passa a servir o formato de texto do Prometheus (versão 0.0.4). Com um token
(`VERDIN_METRICS_TOKEN`, que prevalece sobre `[metrics].token`), um scrape sem
`Authorization: Bearer <token>` recebe `401`. Sem token, qualquer pessoa que alcance a porta
pode ler as métricas.

```yaml title="prometheus.yml"
scrape_configs:
  - job_name: verdin
    metrics_path: /_metrics
    authorization:
      type: Bearer
      credentials: <the token>
    static_configs:
      - targets: ["verdin:1337"]
```

Com várias instâncias, faça o scrape de cada uma: cada instância conta as suas próprias
requisições.

| Métrica | Tipo | Labels | Significado |
| --- | --- | --- | --- |
| `verdin_http_requests_total` | counter | `area`, `method`, `status` | Requisições HTTP servidas. |
| `verdin_http_request_duration_seconds` | histogram | `area`, `method`, `status` | Tempo para servir as requisições. Buckets de 5 ms a 10 s. |
| `verdin_webhook_deliveries_pending` | gauge | | Envios de webhook aguardando envio. |
| `verdin_realtime_subscribers` | gauge | | Streams de eventos de tempo real abertos. |
| `verdin_uptime_seconds` | gauge | | Segundos desde que o processo iniciou. |
| `verdin_build_info` | gauge | `version` | Sempre 1; a versão em execução. |

`area` é a parte do servidor: `api` (API de conteúdo), `admin_api`, `admin` (os arquivos do
painel), `graphql`, `mcp`, `uploads`, `internal` (caminhos que começam com `/_`) ou `other`.
`status` é a classe de status: `2xx`, `3xx`, `4xx` ou `5xx`.

Alertas úteis: `/_ready` falhando, uma proporção crescente de `5xx`, um
`verdin_webhook_deliveries_pending` crescente (um destino de webhook está fora do ar) e
`verdin_uptime_seconds` zerando (reinicializações).

## Logs

O Verdin grava os logs na saída de erro padrão.

| Configuração | Valores | Padrão |
| --- | --- | --- |
| `[log].format` | `pretty` (para terminais) ou `json` (um objeto por linha) | `pretty`; `json` na imagem Docker |
| `[log].level` | Um nível ou filtro: `error`, `warn`, `info`, `debug`, `trace`, ou por módulo (`info,verdin_api=debug`) | `info` |
| `RUST_LOG` | A mesma sintaxe; prevalece sobre `[log].level` quando definida | não definida |

Use `json` em produção e envie a saída de erro padrão para o seu sistema de logs. Uma linha JSON
se parece com:

```json
{"timestamp":"2026-09-29T09:27:16.444598Z","level":"INFO","fields":{"message":"verdin listening","address":"0.0.0.0:1337","mode":"production","version":"0.10.0"},"target":"verdin::app"}
```

Na inicialização, linhas `WARN` apontam configurações a corrigir em produção, como
`[email].provider is 'log'` ou cookies seguros desativados.

### Requisições

Cada requisição recebe um id de requisição: o cabeçalho `X-Request-Id` recebido, se houver, ou
um novo UUID. Ele é devolvido no cabeçalho de resposta `X-Request-Id` e anexado a cada linha de
log escrita enquanto a requisição é servida (`request_id`, com `method` e `uri`). Repasse o
cabeçalho a partir do seu proxy para acompanhar uma requisição entre sistemas.

As requisições não são registradas uma a uma no nível `info`. Para registrar cada requisição
com o seu status e a sua latência, aumente o nível da camada HTTP:

```sh
RUST_LOG=info,tower_http=debug
```

As URLs registradas escondem os valores dos parâmetros de consulta cujos nomes parecem secretos
(`token`, `code`, `state`, `password`, `key`, `signature`, `jwt`…), por exemplo
`/api/connect/github/callback?code=[hidden]`.

## No painel de administração

Adicione o widget **Sistema** ao painel inicial para ver de relance a versão, o banco de dados e
o schema.
