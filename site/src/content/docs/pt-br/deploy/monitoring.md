---
title: Monitoramento
description: Acompanhe uma instância Verdin em execução — as verificações /_health e /_ready, as métricas Prometheus em /_metrics e um painel Grafana, os traces OpenTelemetry, os relatórios de erro do Sentry, o formato dos logs, os níveis e os ids de requisição.
sidebar:
  order: 10
---

Uma instância Verdin informa sobre si mesma por meio de dois endpoints de saúde, métricas
Prometheus opcionais, traces OpenTelemetry e relatórios de erro do Sentry opcionais, e logs
estruturados. Esta página lista o que cada um retorna e como ativá-lo.

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
| `verdin_plugin_call_duration_seconds` | histogram | `plugin`, `kind`, `function` | Tempo que as funções dos [plugins](/pt-br/extending/plugins/) levaram. Mesmos buckets. |
| `verdin_plugin_call_errors_total` | counter | `plugin`, `kind`, `function` | Chamadas de plugin que falharam: um trap, um time-out, uma saída que não é JSON ou o `{ error }` de uma função de inicialização. |
| `verdin_webhook_deliveries_pending` | gauge | | Envios de webhook aguardando envio. |
| `verdin_realtime_subscribers` | gauge | | Streams de eventos de tempo real abertos. |
| `verdin_cluster_events_total` | counter | `direction` | Eventos no [barramento de eventos compartilhado](/pt-br/deploy/scaling/#barramento-de-eventos-compartilhado), com `[cluster].bus` definido: `sent` para as outras instâncias, `received` delas, `dropped` (uma fila cheia ou uma escrita que falhou). |
| `verdin_uptime_seconds` | gauge | | Segundos desde que o processo iniciou. |
| `verdin_build_info` | gauge | `version` | Sempre 1; a versão em execução. |

`area` é a parte do servidor: `api` (API de conteúdo), `admin_api`, `admin` (os arquivos do
painel), `graphql`, `mcp`, `uploads`, `internal` (caminhos que começam com `/_`) ou `other`.
`status` é a classe de status: `2xx`, `3xx`, `4xx` ou `5xx`.
Nas chamadas de plugin, `kind` é `hook`, `route`, `job`, `startup` ou `graphql`; as séries dos
plugins aparecem após a primeira chamada (veja a
[referência de plugins](/pt-br/extending/plugin-reference/#métricas)).

Alertas úteis: `/_ready` falhando, uma proporção crescente de `5xx`, um
`verdin_webhook_deliveries_pending` crescente (um destino de webhook está fora do ar), um
`verdin_plugin_call_errors_total` crescente ou hooks de plugin lentos (eles atrasam as
escritas em que rodam) e `verdin_uptime_seconds` zerando (reinicializações).

### Painel Grafana

[`docker/grafana/verdin.json`](https://github.com/Verdin-CMS/verdin/blob/main/docker/grafana/verdin.json)
é um painel para estas métricas: taxa de requisições, proporção de `5xx` e quantis de latência
por área, método e classe de status, envios de webhook pendentes, assinantes de tempo real,
tráfego do barramento de eventos e, por função de plugin, taxa de chamadas, p95 e erros.
Importe-o no Grafana (**Dashboards → New → Import**) e escolha a sua fonte de dados Prometheus;
as variáveis `instance` e `area` no topo filtram todos os painéis.

## Traces (OpenTelemetry)

O Verdin pode exportar um trace de cada requisição para um coletor OpenTelemetry (o
OpenTelemetry Collector, Grafana Alloy ou Tempo, Jaeger, Honeycomb, Datadog…) por
OTLP/HTTP. Vem desativado:

```toml title="verdin.toml"
[telemetry]
enabled = true
endpoint = "http://otel-collector:4318"
```

As variáveis padrão também funcionam e prevalecem sobre o arquivo:

```sh
VERDIN_TELEMETRY__ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<key>
OTEL_SERVICE_NAME=cms-production
```

Cada trace contém:

- **Um span de requisição** (kind `server`), nomeado com o método e o caminho com os ids
  substituídos por `{id}` (`PUT /api/articles/{id}`), com `http.response.status_code` e um
  status de erro nos `5xx`. Uma requisição com um header W3C `traceparent` entra no trace de
  quem chamou.
- **Um span por instrução do banco de dados** (kind `client`) sob ele: `db.system.name`
  (`postgresql`, `mysql`, `mariadb` ou `sqlite`) e `db.query.text`, o SQL com os seus
  placeholders `?`. Os valores vinculados nunca são registrados, então conteúdo, senhas e
  tokens ficam fora dos traces. `COMMIT` e `ROLLBACK` têm os seus próprios spans e, no SQLite,
  um span `write lock` mostra quanto uma escrita esperou pelas escritas à sua frente.
- Os eventos de log gravados durante o atendimento da requisição, como eventos do span.

As instruções executadas fora de uma requisição (inicialização, migrações, jobs em segundo
plano) não são rastreadas. `[telemetry].sample_ratio` mantém uma parte dos traces (`0.1` mantém
um em cada dez); os spans são enviados em lotes e descarregados quando o servidor para. O nível
de log não filtra os traces: `[log].level = "warn"` ainda exporta todas as requisições.

## Relatório de erros (Sentry)

Defina um DSN para enviar panics e respostas `5xx` ao [Sentry](https://sentry.io) (ou a um
serviço compatível, como o GlitchTip):

```sh
SENTRY_DSN=https://<key>@o0.ingest.sentry.io/<project>
```

`[telemetry].sentry_dsn` também funciona; a variável prevalece. Um `5xx` chega como um evento
de erro `POST /api/articles answered 500`, com as tags `http.method`, `http.status_code` e
`request_id`, que coincide com o header `X-Request-Id` e com as linhas de log dessa requisição.
Os eventos levam a versão do Verdin como release e `production` (`verdin start`) ou
`development` (`verdin dev`) como ambiente, a menos que `SENTRY_ENVIRONMENT` ou
`[telemetry].sentry_environment` indique outro. As URLs são reportadas com os valores de query
que parecem segredos ocultos, como nos logs; corpos e headers de requisição nunca são enviados.

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
