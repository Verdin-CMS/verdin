---
title: Referência de configuração
description: Todas as seções e chaves do verdin.toml, com os padrões, e as variáveis de ambiente que o Verdin lê.
sidebar:
  order: 1
  label: Configuração
---

<!-- Written from crates/verdin/src/config.rs, crates/verdin-upload/src/config.rs and
crates/verdin-email/src/lib.rs, crates/verdin-upload/src/transform.rs,
crates/verdin-search/src/lib.rs, crates/verdin-api/src/cdn.rs and crates/verdin-api/src/ai.rs.
Keep it in step when keys change. -->

A configuração é feita em camadas: **padrões embutidos ← `verdin.toml` ← ambiente**. O arquivo é
opcional; toda chave tem um padrão. As chaves desconhecidas são rejeitadas, então um erro de
digitação falha na inicialização em vez de ser ignorado.

- Substitua qualquer chave com `VERDIN_<SECTION>__<KEY>` (dois underscores), por exemplo
  `VERDIN_SERVER__PORT=8080` ou `VERDIN_ADMIN__SECURE_COOKIES=false`. As tabelas aninhadas levam
  mais um `__`: `VERDIN_ADMIN__BRANDING__TITLE=ACME`. As chaves desconhecidas também são
  rejeitadas aqui, então qualquer variável que comece com `VERDIN_` e contenha `__` precisa
  nomear uma chave real.
- `VERDIN_DATABASE_URL` é um atalho para `database.url`.
- O arquivo é o `verdin.toml` no diretório de trabalho, ou o caminho informado com
  `-c, --config` ou `VERDIN_CONFIG`. Os caminhos relativos dentro dele (schema, plugins, uploads,
  arquivos SQLite) são resolvidos a partir do diretório do arquivo.
- Um arquivo `.env` ao lado da configuração é carregado primeiro; as variáveis já definidas no
  ambiente prevalecem.

Os segredos nunca são lidos do `verdin.toml`; veja
[Variáveis de ambiente](#variáveis-de-ambiente).

## `[server]`

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `host` | `"0.0.0.0"` | O endereço em que escutar. |
| `port` | `1337` | A porta em que escutar. |
| `public_url` | não definida | Onde os navegadores alcançam o servidor, por exemplo `"https://cms.example.com"`. Usada nos links dos e-mails e nos callbacks de SSO; o padrão é `http://localhost:{port}`. |
| `body_limit` | `"1mb"` | O maior corpo de requisição das requisições normais de API (os uploads têm o seu próprio limite). Um número de bytes ou uma string com `b`, `kb`, `mb` ou `gb`. |
| `request_timeout_secs` | `30` | O limite de tempo das requisições normais de API. |
| `sync_interval_secs` | `10` | Com que frequência ler as configurações alteradas por outras instâncias (recursos, interruptores de plugins, idiomas, fluxos de revisão); `0` desativa (uma única instância). |
| `trusted_proxies` | `[]` | Os proxies reversos (IPs ou faixas CIDR, por exemplo `["10.0.0.0/8"]`) cujo `X-Forwarded-For` indica o cliente. Os limites de taxa e os logs de auditoria usam esse endereço; sem isso, todos os clientes atrás do proxy compartilham um único endereço. |

## `[database]`

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `url` | não definida | A URL de conexão: `postgres://…`, `mysql://…` (MySQL e MariaDB) ou `sqlite://…`. Obrigatória; normalmente definida por `VERDIN_DATABASE_URL`. |
| `pool_max` | `10` | O número máximo de conexões no pool. |

## `[schema]`

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `path` | `"schema"` | O diretório do schema, relativo ao arquivo de configuração. |

## `[api]`

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `prefix` | `"/api"` | O caminho sob o qual a API de conteúdo é servida. Precisa começar com `/` e não terminar com uma. |
| `default_page_size` | `25` | O tamanho da página quando a requisição não define nenhum. Entre 1 e `max_page_size`. |
| `max_page_size` | `100` | O maior tamanho de página que uma requisição pode pedir. |
| `decimal_as_string` | `false` | Serializa os decimais como strings (exatas) em vez de números (compatível com o Strapi). |
| `public_rate_limit` | `0` | Requisições por minuto e por IP de cliente sem token (`0`: ilimitado). |
| `token_rate_limit` | `0` | Requisições por minuto e por token de API ou usuário final (`0`: ilimitado). |
| `cache_ttl_secs` | `0` | Mantém as leituras anônimas em memória por esse tempo (`0`: sem cache); as alterações esvaziam o cache. |
| `cache_entries` | `1000` | O número máximo de respostas em cache. |
| `cors_origins` | `[]` | As origens de navegador autorizadas a chamar a API de conteúdo e o GraphQL a partir de outro site (`["https://www.example.com"]`: esquema, host e porta, sem caminho), ou `["*"]` para qualquer uma (sozinho: `*` não pode ser combinado com origens). Vazio: apenas as páginas da mesma origem podem chamá-los a partir de um navegador. A API de administração nunca aceita chamadas cross-origin. |

## `[admin]`

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `path` | `"/admin"` | O caminho sob o qual o painel de administração é servido; a sua API fica em `{path}/api`. |
| `secure_cookies` | não definida | Marca o cookie de renovação como `Secure`. Não definida significa sim no `verdin start` e não no `verdin dev` (desenvolvimento local via HTTP simples). |
| `auth_rate_limit` | `20` | Tentativas de login, cadastro e renovação por IP de cliente e por minuto. |
| `assets_dir` | não definida | Serve o painel de administração a partir deste diretório (relativo ao arquivo de configuração) em vez da cópia embutida no binário. |

### `[admin.branding]`

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `title` | `"Verdin"` | Exibido na barra lateral, na página de login e na aba do navegador. |
| `logo` | não definida | Arquivo de imagem (SVG, PNG, WebP), relativo ao arquivo de configuração. |
| `favicon` | não definida | Arquivo de ícone (ICO, PNG, SVG), relativo ao arquivo de configuração. |
| `accent` | não definida | A cor `#rrggbb` dos botões, dos links e dos anéis de foco. |
| `translations` | `{}` | Os textos da administração substituídos por idioma, por exemplo `[admin.branding.translations.en]` com `"auth.login.title" = "Welcome to ACME"`. As chaves são as de `admin/public/i18n/en.json`. |

## `[upload]`

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `provider` | `{ name = "local", dir = "public/uploads" }` | Onde os arquivos são armazenados; veja abaixo. |
| `max_file_size` | `209715200` | O maior arquivo aceito, em bytes (200 MB). |
| `responsive_formats` | `true` | Gera os formatos responsivos para as imagens raster. |
| `breakpoints` | large 1000, medium 750, small 500 | Os formatos responsivos como tabelas `{ name, width }` (os `breakpoints` do Strapi). Os formatos mais largos que a imagem são pulados. |
| `max_image_megapixels` | `100` | O limite de decodificação contra bombas de descompressão, em megapixels. |
| `max_original_size` | não definida | Os originais raster maiores que esse número de pixels (em qualquer lado) são reduzidos no upload, o que também remove os seus metadados (EXIF, GPS). Não definida mantém os originais como enviados. |

```toml
[upload]
breakpoints = [{ name = "large", width = 1000 }, { name = "small", width = 500 }]
```

### Provedor local

Os arquivos ficam em `dir` (relativo ao projeto) e são servidos pelo Verdin em `/uploads`.

```toml
[upload]
provider = { name = "local", dir = "public/uploads" }
```

### `[upload.transforms]`

As transformações de imagem dos arquivos locais: `/uploads/<file>?preset=thumb`, ou
`?w=&h=&fit=&format=&q=` com uma assinatura. As renderizações ficam em cache no disco e são
descartadas quando o arquivo muda (inclusive o seu ponto focal). Os cortes cover mantêm o ponto
focal do arquivo visível; as imagens nunca são ampliadas. JPEG, PNG, WebP, TIFF e BMP podem ser
transformados (não os GIFs, que podem ser animados).

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `enabled` | `true` | Serve as transformações. |
| `presets` | `{}` | As transformações nomeadas, sempre permitidas: `{ w, h, fit, format, q }`. |
| `allow_arbitrary` | `false` | Aceita qualquer parâmetro sem assinatura. Cada URL distinta é renderizada e guardada em cache, então apenas para redes confiáveis. |
| `max_size` | `4096` | O maior `w` ou `h`, em pixels. |
| `cache_dir` | `".cache/transforms"` | Onde as renderizações são guardadas (relativo ao projeto; pode ser apagado com segurança). |

Parâmetros: `w`, `h` (pixels), `fit` (`cover`, o padrão, corta para a caixa; `inside` encaixa
dentro dela; `fill` estica), `format` (`jpeg`, `png`, `webp`; a saída WebP é sem perdas) e `q`
(qualidade JPEG, 1–100, padrão 80).

```toml
[upload.transforms.presets]
thumb = { w = 300, h = 300 }
hero = { w = 1600, h = 600, format = "webp" }
```

**URLs assinadas.** Com `VERDIN_IMAGE_SECRET` definido, `s` é o HMAC-SHA256 em hexadecimal de
`<file>?<canonical query>`, em que a query canônica lista os parâmetros não padrão ordenados por
nome (`fit`, `format`, `h`, `q`, `w`; `fit=cover` omitido):

```js
import { createHmac } from 'node:crypto';
const s = createHmac('sha256', process.env.VERDIN_IMAGE_SECRET)
  .update('photo_1a2b.jpg?format=webp&w=800')
  .digest('hex');
const url = `/uploads/photo_1a2b.jpg?format=webp&w=800&s=${s}`;
```

### Provedor S3

Qualquer serviço compatível com S3 (AWS, Cloudflare R2, MinIO, Backblaze B2…). As credenciais
vêm das variáveis de ambiente padrão `AWS_*` (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `bucket` | obrigatória | O nome do bucket. |
| `region` | não definida | A região do bucket. |
| `endpoint` | não definida | Um endpoint personalizado para serviços que não são da AWS, por exemplo `https://<account>.r2.cloudflarestorage.com`. |
| `public_url` | obrigatória | A URL base pública do bucket ou da sua CDN; os arquivos são vinculados como `{public_url}/{key}`. |
| `prefix` | `""` | O prefixo das chaves dentro do bucket. |
| `path_style` | `false` | Requisições no estilo path (MinIO e a maioria dos serviços auto-hospedados). |

```toml
[upload]
provider = { name = "s3", bucket = "media", region = "auto",
             endpoint = "https://<account>.r2.cloudflarestorage.com",
             public_url = "https://media.example.com" }
```

## `[webhooks]`

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `allow_private_networks` | não definida | Permite URLs de webhook em endereços de loopback, privados e link-local; também se aplica aos destinos de deploy e ao webhook do `[cdn]`. Não definida significa não no `verdin start` (caso contrário, um administrador poderia alcançar serviços internos) e sim no `verdin dev`. |
| `timeout_secs` | `10` | O limite de tempo de cada envio. |
| `retention_days` | `30` | Os dias durante os quais o log de envios é mantido. |

Veja [Webhooks](/pt-br/guides/integrations/webhooks/).

## `[history]`

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `max_versions` | `50` | As versões mantidas por documento (as mais antigas são removidas). |

## `[email]`

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `provider` | `"log"` | `log` (grava os e-mails no log), `smtp`, `resend` ou `postmark`. |
| `from` | `"Verdin <no-reply@localhost>"` | O remetente. |
| `reply_to` | não definida | O endereço de resposta. |

### `[email.smtp]`

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `host` | `"localhost"` | O servidor SMTP. |
| `port` | `587` | A porta SMTP. |
| `username` | não definida | O usuário SMTP; a senha vem de `VERDIN_EMAIL_SMTP_PASSWORD`. |
| `security` | `"starttls"` | `starttls`, `tls` (implícito, normalmente na porta 465) ou `none` (relays locais). |

## `[plugins]`

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `path` | `"plugins"` | O diretório dos plugins (um subdiretório por plugin), relativo ao arquivo de configuração. |
| `run_jobs` | `true` | Roda os jobs agendados dos plugins nesta instância (uma única instância quando há várias). |

Veja [Plugins](/pt-br/extending/plugins/).

## `[audit]`

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `retention_days` | `90` | Os dias durante os quais as entradas do log de auditoria são mantidas. |

## `[digest]`

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `enabled` | `true` | Envia o resumo diário a partir desta instância (uma única instância quando há várias). |
| `hour_utc` | `8` | A hora (UTC, 0–23) em que sai o resumo diário das alterações não vistas. |

## `[log]`

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `format` | `"pretty"` | `pretty` ou `json`. |
| `level` | não definida (`info`) | O filtro padrão; o `RUST_LOG` tem precedência quando definido. |

## `[metrics]`

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `enabled` | `false` | Serve as métricas Prometheus em `/_metrics`: requisições HTTP por área (`api`, `admin_api`, `graphql`, `mcp`, `uploads`…), método e classe de status com histogramas de latência, envios de webhook pendentes, streams de tempo real abertos e uptime. |
| `token` | não definida | Os scrapes precisam de `Authorization: Bearer <token>`. O `VERDIN_METRICS_TOKEN` prevalece sobre ele. Sem token, qualquer pessoa que alcance a porta pode ler as métricas. |

## `[ai]`

As ações de IA na administração (com o recurso **Ações de IA** ativado em Configurações →
Recursos): traduzir uma entrada para outro idioma, escrever o texto alternativo das imagens,
resumir textos, sugerir metadados de SEO. Elas retornam sugestões; nada é salvo sem o editor. A
chave é lida de `VERDIN_AI_KEY` (os servidores locais não precisam de uma).

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `provider` | `"none"` | `anthropic`, `openai` ou `openai-compatible` (Ollama, LM Studio, vLLM…). |
| `model` | `claude-sonnet-5` para `anthropic` | O modelo; obrigatório para os outros provedores. |
| `base_url` | o do provedor | Outro endpoint, por exemplo `http://localhost:11434/v1`. |
| `max_tokens` | `2048` | A resposta mais longa. |

```toml
[ai]
provider = "anthropic"
```

Cada administrador pode fazer 30 requisições de IA por minuto. O conteúdo e as imagens são
enviados ao provedor: escolha um que a sua organização permita.

## `[cdn]`

Limpa os caches da CDN quando o conteúdo muda publicamente. As respostas da API de conteúdo são
marcadas com as tags `vd` e `vd-<singularName>` (cabeçalhos `Cache-Tag` e `Surrogate-Key`).

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `provider` | `"none"` | `cloudflare`, `fastly` ou `webhook`. |
| `zone_id` | não definida | A zona da Cloudflare (limpeza por tag). |
| `service_id` | não definida | O serviço da Fastly (limpeza por surrogate key). |
| `url` | não definida | `webhook`: recebe `POST { "tags": [...] }`. |
| `debounce_ms` | `1000` | O intervalo em que as alterações são reunidas antes da limpeza. |

O token de API é lido de `VERDIN_CDN_TOKEN` (enviado como bearer token aos webhooks).

## `[search]`

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `enabled` | `false` | Ordena o `_q` com um índice full-text (Tantivy) em vez de `$containsi`. |
| `dir` | `"data/search"` | O diretório do índice, relativo ao projeto. Apagá-lo reconstrói o índice na próxima inicialização. |
| `memory_mb` | `50` | O orçamento de memória da indexação. |

O índice fica no disco da instância e acompanha as escritas dessa instância: com várias
instâncias, mantenha a busca em uma só (ou reconstrua-o após um deploy).

## Variáveis de ambiente

Além das substituições `VERDIN_<SECTION>__<KEY>`, o Verdin lê estas variáveis:

| Variável | Descrição |
| --- | --- |
| `VERDIN_CONFIG` | O caminho do arquivo de configuração (o mesmo que `--config`). |
| `VERDIN_DATABASE_URL` | Atalho para `database.url`. |
| `VERDIN_ADMIN_JWT_SECRET` | Assina os tokens de sessão da administração. Obrigatória, pelo menos 32 bytes; gere-a com `verdin secrets`. |
| `VERDIN_TOKEN_PEPPER` | Hash com chave para os tokens armazenados. Obrigatória, pelo menos 32 bytes; gere-a com `verdin secrets`. |
| `VERDIN_ADMIN_PASSWORD` | A senha para `verdin admin create` e `verdin admin reset-password` (caso contrário, lida da entrada padrão); veja a [referência da linha de comando](/pt-br/reference/cli/). |
| `VERDIN_EMAIL_SMTP_PASSWORD` | A senha SMTP. |
| `VERDIN_EMAIL_API_KEY` | A chave de API dos provedores Resend e Postmark. |
| `VERDIN_SSO_<ID>_SECRET` | O client secret de um provedor de SSO; `<ID>` é o id do provedor em maiúsculas, com `-` como `_` (veja [Login único](/pt-br/guides/auth/sso/)). |
| `VERDIN_OAUTH_<PROVIDER>_SECRET` | O client secret de um provedor OAuth de usuários finais, nomeado como os de SSO (veja [Usuários finais](/pt-br/guides/auth/end-users/)). |
| `VERDIN_AI_KEY` | A chave de API do provedor de `[ai]`. |
| `VERDIN_CDN_TOKEN` | O token de API do provedor de `[cdn]`. |
| `VERDIN_IMAGE_SECRET` | Assina as URLs de transformação de imagens (veja [`[upload.transforms]`](#uploadtransforms)). |
| `VERDIN_METRICS_TOKEN` | O bearer token para os scrapes de `/_metrics` quando `[metrics].enabled`; prevalece sobre `[metrics].token`. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | As credenciais do provedor de upload S3. |
| `RUST_LOG` | O filtro de logs; tem precedência sobre `[log].level`. |
