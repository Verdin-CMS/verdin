---
title: Checklist de produção
description: O que configurar antes de um projeto Verdin receber tráfego real — segredos, banco de dados, migrações, URLs, proxies, cookies, CORS, armazenamento de mídia, e-mail, backups e monitoramento.
sidebar:
  order: 1
---

Percorra esta lista antes de colocar um projeto Verdin na frente de usuários reais. Cada item
leva à página que o explica. As páginas das plataformas ([Docker](/pt-br/deploy/docker/),
[Fly.io](/pt-br/deploy/fly/), [Render](/pt-br/deploy/render/), [Railway](/pt-br/deploy/railway/),
[Kubernetes](/pt-br/deploy/kubernetes/)) aplicam essas configurações para você sempre que
possível.

## Rode o servidor de produção

- [ ] **Use `verdin start`, não `verdin dev`.** O `dev` deixa o construtor de tipos de conteúdo
      reescrever os arquivos de schema, aplica migrações a cada alteração e relaxa as regras de
      cookies e de webhooks para o trabalho local. Altere o schema em desenvolvimento, commite
      os arquivos e faça o deploy deles.
- [ ] **Aplique as migrações no momento do deploy.** O `verdin start` se recusa a rodar
      enquanto o banco de dados estiver atrás do schema. O `verdin start --migrate` aplica antes
      os passos *seguros* pendentes (é o comando padrão da imagem Docker). Os passos arriscados
      ou destrutivos (mudanças de tipo, novas restrições de unicidade, colunas removidas)
      precisam de `verdin migrate apply --allow risky|destructive`, rodado uma vez por você.
      Veja [Migrações de schema](/pt-br/concepts/schema-migrations/).
- [ ] **Leve o schema junto com o servidor.** Monte o diretório `schema/` como somente leitura,
      ou inclua-o na sua imagem, para que o que roda seja o que você commitou.

## Segredos

- [ ] **Gere os dois segredos obrigatórios uma vez** com `verdin secrets` e guarde-os no cofre
      de segredos da sua plataforma: `VERDIN_ADMIN_JWT_SECRET` assina os tokens de sessão, e
      `VERDIN_TOKEN_PEPPER` é a chave dos hashes dos tokens de API e de outros segredos
      armazenados. O `verdin start` falha se algum deles faltar ou tiver menos de 32 bytes. Os
      segredos são lidos apenas do ambiente, nunca do `verdin.toml`.
- [ ] **Mantenha-os estáveis.** Mudar o `VERDIN_TOKEN_PEPPER` faz todos os tokens de API
      pararem de funcionar, assim como os códigos de aplicativo autenticador e os códigos de
      recuperação dos administradores. Mudar o `VERDIN_ADMIN_JWT_SECRET` invalida os tokens de
      acesso de curta duração dos administradores e dos usuários finais, os links de
      pré-visualização abertos e os logins OAuth em andamento (o painel de administração e os
      clientes com tokens de renovação os renovam sozinhos). Todas as instâncias de um projeto
      precisam dos mesmos valores.
- [ ] Coloque também no ambiente os outros segredos que você usa: `VERDIN_EMAIL_SMTP_PASSWORD`
      ou `VERDIN_EMAIL_API_KEY`, `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`,
      `VERDIN_METRICS_TOKEN`, `VERDIN_SSO_<ID>_SECRET`, `VERDIN_IMAGE_SECRET`. A lista completa
      está na [referência de configuração](/pt-br/reference/configuration/).

## Banco de dados

- [ ] **Escolha o motor.** O PostgreSQL (14 ou posterior) é a escolha habitual e a que você
      deve fazer se for rodar [várias instâncias](/pt-br/deploy/scaling/). O MySQL 8.4+ e o
      MariaDB 10.11+ funcionam da mesma forma. O SQLite serve para uma única instância com
      disco persistente.
- [ ] **Defina `VERDIN_DATABASE_URL`**: `postgres://…`, `mysql://…` (MySQL e MariaDB) ou
      `sqlite:///data/verdin.db`. Adicione `?sslmode=require` para servidores PostgreSQL que
      exigem TLS.
- [ ] **Dimensione o pool.** Cada instância abre até `[database].pool_max` conexões (10).
      Mantenha `instâncias × pool_max` abaixo do limite de conexões do servidor.

## URLs, proxies e cookies

- [ ] **Sirva via HTTPS.** O Verdin fala HTTP simples; termine o TLS em um proxy reverso, em um
      load balancer ou na borda da sua plataforma.
- [ ] **Defina `[server].public_url`** (`VERDIN_SERVER__PUBLIC_URL`) com o endereço que os
      navegadores usam, como `https://cms.example.com`. Os links nos e-mails, os callbacks de
      SSO, o resumo diário e as chaves de acesso dependem dele; as chaves de acesso ficam
      vinculadas ao seu host.
- [ ] **Defina `[server].trusted_proxies`** com os endereços dos seus proxies reversos (IPs ou
      faixas CIDR). Só então o Verdin lê o endereço do cliente de `X-Forwarded-For`; sem isso,
      todos os clientes atrás do proxy compartilham um único endereço para os limites de taxa e
      os logs de auditoria.
- [ ] **Mantenha os cookies seguros ativados.** Com `verdin start`, o cookie de renovação da
      administração é `Secure` por padrão. Deixe `[admin].secure_cookies` sem definir; defini-lo
      como `false` em produção gera um aviso na inicialização.

## APIs

- [ ] **Conceda apenas o que o público precisa.** A API de conteúdo fica fechada até você
      conceder permissões públicas (**Configurações → Acesso público**) ou criar tokens de API.
      Veja [Permissões](/pt-br/concepts/permissions/).
- [ ] **Defina `[api].cors_origins`** se um navegador em outra origem chamar a API de conteúdo
      ou o GraphQL, por exemplo `["https://www.example.com"]`. Sem isso, apenas páginas da mesma
      origem podem chamá-los a partir de um navegador. A API de administração nunca responde a
      requisições cross-origin.
- [ ] **Considere limites de taxa** para o tráfego anônimo: `[api].public_rate_limit` e
      `[api].token_rate_limit` (requisições por minuto; `0`, o padrão, é ilimitado).

## Mídia

- [ ] **Armazene os uploads onde eles sobrevivam a um novo deploy.** O provedor local padrão
      grava em disco: dê a ele um volume persistente ou use o provedor S3 (AWS S3, Cloudflare
      R2, Backblaze B2, MinIO, Tigris…). Em plataformas com discos efêmeros, e com várias
      instâncias, use S3. Veja [Mídia](/pt-br/concepts/media/).

## E-mail

- [ ] **Configure um provedor real.** O padrão `[email].provider = "log"` grava os e-mails no
      log, e o `verdin start` avisa sobre isso. Os convites, as redefinições de senha, as
      confirmações de usuários finais, as menções em comentários e o resumo precisam de `smtp`,
      `resend` ou `postmark`, e de `[email].from` definido com um endereço que o seu provedor
      aceite.

## Backups e monitoramento

- [ ] **Faça backup do banco de dados e do armazenamento de mídia** com uma programação, e
      teste uma restauração. Veja [Backups](/pt-br/deploy/backups/).
- [ ] **Aponte os health checks para `/_ready`** e as verificações de liveness para `/_health`.
- [ ] **Registre os logs como JSON** (`[log].format = "json"`, o padrão da imagem Docker) e
      colete a saída de erro padrão.
- [ ] **Faça o scrape de `/_metrics`** se você usa Prometheus, com um `VERDIN_METRICS_TOKEN`.
      Veja [Monitoramento](/pt-br/deploy/monitoring/).

## Antes de entrar no ar

- [ ] Cadastre você mesmo o primeiro administrador logo após a primeira inicialização:
      enquanto não existir nenhum administrador, qualquer pessoa que chegue a `/admin/` pode se
      cadastrar como Super Admin. Você também pode criá-lo pela linha de comando com
      `verdin admin create --email …`.
- [ ] Revise o [modelo de segurança](/pt-br/deploy/security/) e ative a
      [autenticação de dois fatores](/pt-br/guides/auth/two-factor/) para os Super Admins.
